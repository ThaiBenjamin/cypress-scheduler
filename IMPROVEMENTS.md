# Cypress Scheduler — Improvement Backlog

Prioritized suggestions, grouped by area. Items marked **[done]** were implemented in this pass
(the data-pipeline fixes). Everything else is proposed, not yet built.

---

## 0. Data pipeline reliability (the "DB not updating → local fallback" bug)

**Root causes found**

1. The daily GitHub Actions job scraped and seeded but **never synced the schema**
   (`prisma db push` / `migrate deploy` was missing). If the production DB schema didn't exist or
   drifted from `schema.prisma`, `seed.ts` threw and the site silently served stale local JSON.
2. `seed.ts` did `deleteMany({})` **before** inserting, with no guard — an empty/failed scrape or a
   single bad row could blank or half-fill the table.
3. The committed `cypress_data.json` (the fallback) was a stale **raw** NOCCCD dump the job never
   refreshed, and `mapTermCodeToLabel` mapped term codes incorrectly (`10` → treated as
   Winter/Spring instead of Fall).

**Fixes applied [done]**

- `.github/workflows/scraper.yaml`: fail fast if `DATABASE_URL` secret is missing; `npm ci`;
  verify the scrape returned ≥1 section **before** seeding; **`npx prisma db push --skip-generate`**
  to sync schema; then seed; then **commit the refreshed `cypress_data.json`** back so the fallback
  stays fresh.
- `seed.ts`: abort if the scrape file is empty/not an array (protects existing data); wrap each
  upsert in try/catch so one bad row can't abort the run; print `inserted/skipped/failed` counts and
  fail if nothing inserted.
- `app/api/courses/route.ts`: corrected `mapTermCodeToLabel` term-code math, and made the fallback
  understand **both** JSON formats (raw dump *and* the scraper's richer processed output).

**Still worth doing**

- **Alerting:** the courses API swallows DB errors into fallback, so failures are invisible. Add a
  daily health assertion — e.g. a workflow step that hits `/api/health` after deploy, or a check
  that `SELECT count(*) FROM "Course"` is above a floor — and notify (email/Discord) on failure.
- **Versioned migrations:** move from `db push` to `prisma migrate` so schema changes are reviewable
  and reversible, and switch the workflow to `migrate deploy`.
- **Incremental seed:** the seed wipes and reloads every course nightly. Switch to a diff/upsert-only
  approach keyed on `(crn, term)` and delete only sections that disappeared, to avoid a window where
  the table is empty and to preserve IDs.

---

## 1. Correctness & data quality

- **Split-day / multiple meeting patterns:** confirm conflict detection handles a section with two
  meeting rows (e.g. lecture MW + lab F). Add unit tests around the conflict algorithm in
  `lib/scheduler/`.
- **Instructor list:** `seed.ts` stores only the first instructor (`[course.sectInstrName]`).
  NOCCCD sections can list multiple; capture all.
- **Units:** the raw-dump fallback reports `units: 0`. Now that the fallback also reads the scraper
  format, prefer regenerating the committed file via the workflow so units are real.
- **Term source of truth:** centralize the NOCCCD term-code ↔ label mapping in one shared module
  imported by `scraper.py`(via a generated constant), `seed.ts`, and `route.ts`, so the three can't
  drift again.

## 2. Performance & scale

- **DB search uses `contains` with `mode: insensitive` across 5 columns** — this is a sequential
  scan per token. Add a Postgres full-text index (`tsvector`) or `pg_trgm` GIN indexes on
  `title`/`description`/`subject` and query with them. Also add a plain index on `term`.
- **`SELECT SELECT 1` health check** is fine, but the app opens a `pg.Pool` per serverless instance;
  ensure pool size is small (`max: 1–3`) for serverless/Fluid Compute to avoid exhausting Supabase
  connection limits. Consider Supabase's transaction pooler (port 6543).
- **Ship the fallback smaller:** `cypress_data.json` is ~2.5 MB and bundled/read on every fallback.
  Store only Cypress sections and only the fields the fallback uses.

## 3. Security & abuse

- **Rate limiting and audit logs are in-memory** — they reset per instance and don't coordinate
  across regions. Move to a shared store (Upstash Redis / Vercel KV-equivalent) if abuse becomes real.
- **CSP allows `'unsafe-inline'` and `'unsafe-eval'`** in `proxy.ts`. Tighten once the app's inline
  script needs are known (nonces).
- **Share tokens:** verify `lib/share.ts` uses a constant-time comparison and a rotating secret;
  document token expiry.

## 4. Features / UX

- **"Data source" transparency:** the UI already shows Database vs Local fallback. Add a subtle
  "last updated" timestamp (max `Course.updatedAt`) so users know data freshness.
- **Waitlist display:** the schema tracks `waitCount`/`waitCapacity` — surface "Waitlist X/Y" on
  `CourseCard` and let users filter to open-seat sections.
- **Email notifications:** `RESEND_API_KEY` is wired but there's no scheduler that compares seat
  counts between scrapes and emails watchers. Add a step in the daily job that diffs seats and
  triggers `/api/notifications/email`.
- **Saved schedule limits:** cap `SavedSchedule` rows per user and add a "duplicate plan" action.

## 5. Testing & DX

- **No tests exist** beyond `scripts/test-ai-model.mjs`. Add: conflict-detection unit tests, a
  `route.ts` fallback-format test (feed it both JSON shapes), and a term-mapping table test.
- **CI on PRs:** add a workflow running `npm run lint` + `tsc --noEmit` + tests on pull requests.
- **`.env.example`:** commit a template of all env vars (see CLAUDE.md §4) so setup is copy-paste.
- **Type the Prisma client properly:** `lib/db.ts` and `seed.ts` cast `PrismaClient` through `any`.
  Prisma 7 with driver adapters can be typed directly — remove the `as any` casts.

## 6. Deployment (Vercel)

- Add `vercel.json`/`vercel.ts` documenting the framework and a post-deploy `/api/health` check.
- Consider **Vercel Cron** as an alternative/backup trigger for a lightweight "reseat" refresh
  during the day (the heavy full scrape stays on GitHub Actions because it needs Python).
