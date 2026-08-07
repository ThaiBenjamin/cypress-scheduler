@AGENTS.md

# Cypress Scheduler — Project Guide

A course-planning web app for **Cypress College** students: search class sections, build
conflict-free schedules, preview building locations on a map, import a myGateway schedule, save to
the cloud, share read-only links, and chat with an AI assistant.

> **Next.js version note:** This repo pins **Next.js 16** (App Router, React 19). APIs and
> conventions differ from older Next.js. When unsure, read `node_modules/next/dist/docs/` before
> writing framework code (see `AGENTS.md`).

---

## 1. Architecture at a glance

```
NOCCCD open data (schedule.nocccd.edu/data/<termCode>/{sections,courses}.json)
        │  scraper.py  (GitHub Actions, daily)
        ▼
cypress_data.json  ──────────────┐
        │  seed.ts               │  (also the app's local fallback catalog)
        ▼                        │
PostgreSQL (Prisma + pg adapter) │
        │  app/api/courses       │
        ▼                        ▼
Next.js App Router UI  ◄── falls back to cypress_data.json on DB error/empty
```

- **Framework:** Next.js 16 App Router, React 19, TypeScript 5.
- **DB:** PostgreSQL via **Prisma 7 with the driver adapter** `@prisma/adapter-pg` (a `pg.Pool`).
  `schema.prisma` intentionally has **no `url`** in its datasource — the URL is supplied at runtime
  by `lib/db-url.ts` (app) and `prisma.config.ts` (CLI).
- **Auth:** NextAuth v4, Google OAuth (`lib/auth.ts`).
- **AI chat:** OpenAI/OpenRouter-compatible API, with a built-in local guidance fallback if no key.
- **Map:** Leaflet + React-Leaflet. **Calendar:** react-big-calendar.
- **Styling:** Tailwind CSS 4.

---

## 2. Data model (`prisma/schema.prisma`)

- **`Course`** — one row per section. Unique key **`@@unique([crn, term])`**. Has `subject`,
  `courseNumber`, `title`, `units`, `instructionMode`, `description`, `seatsAvailable`,
  `maxEnrollment`, `waitCount`, `waitCapacity`, `professors String[]`, and `meetings Meeting[]`.
- **`Meeting`** — `type`, `days String[]` (e.g. `["M","W"]`), `startTime`/`endTime` (`"HH:MM"`),
  `building`, `room`. Cascade-deletes with its `Course`.
- **`SavedSchedule`** — cloud-saved plan for a signed-in user: `userEmail`, `name`, `courses Json`
  (full array of classes + custom events), timestamps.

**Term labels are strings** shared end-to-end: `"2026-Winter/Spring"`, `"2026-Summer"`,
`"2026-Fall"`. The scraper produces these from NOCCCD term codes. **Keep the following code mapping
consistent everywhere** (scraper, `seed.ts`, and the courses fallback):

| NOCCCD code suffix | Season          | Year rule            | Example → label          |
|--------------------|-----------------|----------------------|--------------------------|
| `10`               | Fall            | year = `YYYY`        | `202610` → `2026-Fall`   |
| `20`               | Winter/Spring   | year = `YYYY + 1`    | `202520` → `2026-Winter/Spring` |
| `30`               | Summer          | year = `YYYY + 1`    | `202530` → `2026-Summer` |

If you ever change a term label, you must update `scraper.py` `TERMS`, the fallback
`mapTermCodeToLabel` in `app/api/courses/route.ts`, and the `<option>` values in `app/page.tsx`.

---

## 3. Key files

| Path | Responsibility |
|---|---|
| `scraper.py` | Fetches NOCCCD sections + catalog, filters to Cypress (`sectCampCode == "1"`), stitches title/units/description, writes `cypress_data.json`. |
| `seed.ts` | Reads `cypress_data.json`, wipes `Course`, upserts sections + meetings into Postgres. Run with `npx tsx seed.ts`. |
| `cypress_data.json` | Scraper output **and** the app's local fallback catalog. |
| `lib/db.ts` | Runtime Prisma client (pg Pool + adapter). Chooses SSL based on host (Supabase pooler vs direct). |
| `lib/db-url.ts` | Resolves the DB URL from `DATABASE_URL`, else `SUPABASE_DB_URL`, else `SUPABASE_DB_*` parts. |
| `prisma.config.ts` | Feeds the resolved URL to Prisma **CLI** commands (`db push`, `studio`, etc.). |
| `app/api/courses/route.ts` | Search endpoint. DB-first, then DB any-term, then local fallback. Sets `X-Course-Source` = `db`\|`fallback` and `X-Course-Source-Reason`. |
| `app/api/schedules/route.ts` | CRUD for `SavedSchedule` (auth-gated, rate-limited, Zod-validated). |
| `app/api/share/route.ts` + `lib/share.ts` | Signed, read-only share tokens. |
| `app/api/ai-chat/route.ts` | AI assistant (OpenAI/OpenRouter) with local fallback. |
| `app/api/health/route.ts` | `/api/health` — reports DB reachability, URL source, host, TLS setting. **First thing to check when debugging fallback.** |
| `app/page.tsx` | The entire scheduler UI (search, calendar, map tab, import, save/share). Shows "Data source: Database / Local fallback catalog". |
| `proxy.ts` | Security headers / CSP (Next.js proxy/middleware). |
| `lib/security/*` | In-memory rate limiting + audit logging. |
| `.github/workflows/scraper.yaml` | Daily cron: scrape → **schema push** → seed → commit refreshed data. |

---

## 4. Environment variables

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **Yes** | Postgres connection string. Also accepts `SUPABASE_DB_URL` or `SUPABASE_DB_{HOST,USER,PASSWORD,PORT,NAME,SSLMODE}`. |
| `DB_SSL_REJECT_UNAUTHORIZED` | No | Override TLS cert check (`true`/`false`). Auto: `false` for Supabase pooler, else on in prod. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Yes (auth) | Google OAuth. |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | Yes (auth) | NextAuth. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | No | AI chat; falls back to local guidance if unset. |
| `RESEND_API_KEY` / `NOTIFICATION_FROM_EMAIL` | No | Email notifications. |

The daily GitHub Actions job needs `DATABASE_URL` set as a **repo secret** (Settings → Secrets and
variables → Actions).

---

## 5. Common commands

```bash
npm install            # installs + runs `prisma generate` (postinstall)
npm run dev            # Next.js dev server on :3000
npm run build          # prisma generate && next build
npm run lint           # eslint

# Data pipeline (needs DATABASE_URL in env / .env):
python scraper.py      # refresh cypress_data.json from NOCCCD
npx prisma db push     # sync schema.prisma -> database (no migration files)
npx tsx seed.ts        # load cypress_data.json into the database
npx prisma studio      # inspect data
```

There are **no migration files** — schema is applied with `prisma db push` (driver-adapter setup).
If you want versioned history, initialize `prisma migrate` and switch the workflow to
`migrate deploy`.

---

## 6. The DB-vs-fallback contract (important)

`/api/courses` **never hard-fails** on a DB problem — it silently returns the local
`cypress_data.json` and marks the response `X-Course-Source: fallback`. So "the site works but data
looks stale/wrong" almost always means **the DB path is broken and you're seeing fallback**.

**Debug order when users report stale/fallback data:**
1. `GET /api/health` — is `ok: true`? Check `databaseUrlSet`, `databaseUrlSource`, `databaseHost`,
   and the `database.error` code.
2. Check the latest **Daily Cypress Scraper** run in GitHub Actions — did scrape, `db push`, and
   seed all succeed?
3. Look at the response header `X-Course-Source-Reason` (`db_error`, `db_empty_after_search`,
   `exact_term_match`, …) to see *why* fallback engaged.
4. Confirm term labels match across scraper/DB/UI (see §2 table).

---

## 7. Conventions

- Prefer the existing `withSource(...)` helper for course responses so the source headers stay set.
- All mutating/user endpoints are **auth-gated + rate-limited + Zod-validated** — follow that
  pattern for new endpoints (`lib/security/*`, `lib/validation.ts`).
- Rate limiting and audit logs are **in-memory** — they reset per serverless instance and don't
  share state across regions. Fine for light abuse control; not a security boundary.
- Times are stored as `"HH:MM"` 24h strings; days as short tokens `M Tu W Th F Sa Su`.
