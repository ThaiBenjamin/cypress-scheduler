# Cypress College Scheduler

A course-planning web app inspired by UCI's AntAlmanac, tailored for Cypress College.

## What this app currently does

- Search courses by term and keyword.
- Add courses to one or more schedules.
- Detect calendar time conflicts.
- Visualize class locations on a campus map.
- Export/share schedule screenshots.
- Save user preferences such as colors, visible columns, and theme.
- Create signed, read-only share links for schedules.
- View privacy policy, terms, and service status endpoint.

## Project structure (organized)

```txt
app/
  api/
    auth/[...nextauth]/route.ts   # NextAuth API route
    courses/route.ts              # Course search API
    schedules/route.ts            # Saved schedule API
  CourseMap.tsx                   # Map + building search + route lines
  page.tsx                        # Main scheduler UI (search, added classes, calendar)
lib/
  db.ts                           # Prisma DB client
  scheduler/
    buildings.ts                  # Shared building code/name/coords source of truth
prisma/
  schema.prisma                   # Database schema
```

## Local development

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables in `.env` (database + auth values).

   Recommended minimum variables:
   - `DATABASE_URL`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_URL`
   - `NEXTAUTH_SECRET`
   - `RESEND_API_KEY` (for email notifications)
   - `NOTIFICATION_FROM_EMAIL`
   - `ALLOWED_EMAIL_DOMAIN` (optional, e.g. `student.fullcoll.edu`)
   - `DB_SSL_REJECT_UNAUTHORIZED` (production default is strict; set `false` only if your DB provider requires it)

3. Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Contributor setup requirements

If you add another developer, this is the baseline setup they should have:

- **Node.js 20+** (recommended: latest LTS)
- **npm 10+**
- **PostgreSQL database access** (local or hosted)
- **Git + GitHub account**

### Should they use a virtual environment?

- For the **Next.js app**, use Node tooling (`npm`), not a Python virtualenv.
- For the optional `scraper.py`, using a Python virtual environment is recommended to isolate scraper dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt  # if/when requirements file is added
```

If you want, I can add a `requirements.txt` and a one-command bootstrap script for new contributors.

## Deploying for free on Vercel

You are already using the right platform for a free tier deploy.

1. Push this repo to GitHub.
2. Import the repository into Vercel.
3. In Vercel project settings, configure required environment variables.
4. If using Prisma + Postgres, point `DATABASE_URL` to your hosted DB.
5. Deploy.

### Recommended free database options

- Neon (Postgres)
- Supabase (Postgres)

## Next cleanup roadmap

- Extract scheduler domain types from `any` into typed interfaces.
- Split `app/page.tsx` into feature components (`SearchPanel`, `ScheduleList`, `CalendarPanel`, `SettingsMenu`).
- Add unit tests for helper functions (conflicts, time formatting, event generation).
- Add E2E smoke tests for search → add class → map flow.

## Production launch checklist (students)

- Enforce server-side auth checks on all schedule and notification APIs.
- Validate API payloads and query params with schemas.
- Add API rate limiting for search, schedule writes, and notifications.
- Publish Privacy Policy + Terms of Use and a support contact.
- Add error monitoring (Sentry or equivalent) and alerting.
- Define backup/restore and incident response runbooks.
- Perform an accessibility pass (keyboard nav, focus states, color contrast, screen reader labels).
- Add periodic health checks against `/api/health` in your deployment platform.

## Product questions to confirm next

To implement your vision cleanly, these decisions are helpful:

1. Should conflict detection allow overlaps between lecture/lab in same course section?
2. Do you want drag-and-drop schedule rearranging?
3. Should custom events support recurring ranges by date (not just weekday/time)?
4. Do you want public share links for schedules?

### Confirmed product decisions

- Saving schedules requires sign-in and cloud save.
- No travel-time warnings between back-to-back classes.
