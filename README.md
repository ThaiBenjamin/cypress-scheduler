# Cypress College Scheduler

A course planner for Cypress College students. Search the catalog, build schedules
that don't conflict, see where the buildings actually are, and share a plan by link.

**Live:** https://cypress-scheduler-theta.vercel.app

## Why I built it

Cypress College has no visual course scheduler. Planning a term means cross-referencing
the published section list against the myGateway portal by hand — copying meeting times
into a spreadsheet, then checking every pair of classes for an overlap before your
registration window opens.

The work is mechanical, but the stakes aren't. One missed overlap and you register into
a week you can't attend, or give up a section you needed while re-planning around it.
UCI students have AntAlmanac for this. We didn't have anything.

## What it does

Add the courses you want and the app generates conflict-free schedules out of every
section combination available, ranked against your own constraints — no Fridays, nothing
before 10am, a cap on how loaded any single day gets. Options render as a week you can
step through, save to your account, and share.

A few things beyond the basics:

- Meeting locations plot on a Leaflet map with walking-time estimates between
  back-to-back classes, because a building code means nothing to a new student.
- Shared schedules are compressed and signed into the URL itself, so a link opens
  read-only for anyone with no account and no database row.
- You can paste your existing myGateway schedule in rather than re-entering it.
- Optional email alerts when a section's seat status changes.

## How the data stays current

A Python scraper pulls the district's public course and section JSON for three terms,
joins titles and units onto meeting times and seat counts, and seeds Postgres through
Prisma. GitHub Actions runs it on a schedule.

This is a deliberate trade: seat and waitlist counts are only as fresh as the last
scraper run, so the tool plans a term rather than tracking one minute to minute. In
exchange it never depends on holding a portal session.

## How schedules get generated

Each course you add expands into a pool of its sections. A depth-first walk takes one
section per course and abandons a branch the moment two meeting blocks overlap, so dead
schedules get pruned instead of scored. Times and dates are stored as plain strings, which
means no timezone can ever be applied to a class time by accident.

Surviving combinations are scored on Friday classes, how far the day starts before your
preferred hour, the busiest day's load, and how many days you're on campus. Lowest score
wins.

The enumeration runs in the browser, so work grows with the cross-product of sections and
a visit cap stands in for real pruning. That's ample for one student's term and would need
rethinking for anything wider.

## Stack

| Layer | What |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript |
| Database | PostgreSQL, Prisma with `@prisma/adapter-pg` |
| Auth | NextAuth v4, Google OAuth |
| Map | Leaflet + React-Leaflet |
| Calendar | React Big Calendar |
| AI chat | OpenAI / OpenRouter, with a local fallback if no key is set |
| Styling | Tailwind CSS 4 |
| Hardening | Rate limiting, audit logging, Zod validation |

## Running it locally

You'll need Node 20+, a PostgreSQL database (local, Supabase, or Neon), and Google OAuth
credentials.

```bash
git clone https://github.com/ThaiBenjamin/cypress-scheduler.git
cd cypress-scheduler
npm install
```

Create a `.env`:

```bash
DATABASE_URL=postgresql://user:password@host:5432/dbname

GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_secret

# Optional — the chat falls back to local guidance without these
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini

# Optional — status-change emails
RESEND_API_KEY=your_key
NOTIFICATION_FROM_EMAIL=noreply@yourdomain.com
```

Then `npm run dev` and open http://localhost:3000.

To deploy: push to GitHub, import into Vercel, add the same environment variables, and
check `/api/health` once it's up.

## Layout

```
app/
  api/          Route handlers (courses, schedules, share, auth, ai-chat)
  components/   CourseCard, CourseMap
  page.tsx      The scheduler itself
lib/
  scheduler/    Building metadata, conflict logic
  security/     Rate limiting, audit logging
  db.ts         Prisma + pg client
  auth.ts       NextAuth config
  share.ts      Signed share tokens
  validation.ts Zod schemas
prisma/
  schema.prisma
```

## Support

Questions or bug reports: cypressschedulersupport@gmail.com
