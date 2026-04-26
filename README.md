# Cypress College Scheduler

Cypress College Scheduler is a course-planning web app inspired by AntAlmanac and tailored for Cypress College students.

It helps students:

- search class sections,
- build multiple schedule plans,
- preview classes on the map,
- save schedules to the cloud,
- share read-only schedule links,
- and create optional class-status notifications.
- chat with an in-app AI assistant for help using the scheduler.

---

## How the app works

### 1) Search + ranking

- The UI calls `GET /api/courses` with query + term.
- The API tries PostgreSQL first, applies tokenized keyword matching and relevance ranking, and returns the top results.
- If the database is unavailable (or no matches are found), it can fall back to the local `cypress_data.json` catalog.

### 2) Schedule building

- Users can create multiple plans and add/remove course sections.
- The scheduler converts meeting times to calendar events and checks for overlap conflicts.
- Signed-in users can persist schedules via `GET/POST/DELETE /api/schedules`.

### 3) Auth + identity

- Google sign-in is handled with NextAuth.
- Server routes enforce session checks before saving data tied to a user account.

### 4) Mapping + routing

- Building metadata is centralized in `lib/scheduler/buildings.ts`.
- `CourseMap` renders class markers and route lines for selected classes.

### 5) Sharing + notifications

- Signed schedule links are generated through `POST /api/share` and viewed at `/share` or `/share/s/[token]`.
- Email notifications are sent through `POST /api/notifications/email` when configured.

### 6) AI chat assistant

- The in-app assistant helps students with finding classes, schedule building, and app usage questions.
- The UI posts to `POST /api/ai-chat`.
- If `OPENAI_API_KEY` is configured, responses come from OpenAI.
- If OpenAI is unavailable but `OPENROUTER_API_KEY` is configured, responses come from OpenRouter (including free router/model options).
- If neither provider is configured, the app uses a built-in local guidance fallback.

---

## Tech stack

- **Framework:** Next.js App Router (React + TypeScript)
- **Database:** PostgreSQL (Supabase/Neon/local)
- **ORM:** Prisma + `@prisma/adapter-pg`
- **Auth:** NextAuth (Google provider)
- **Map UI:** Leaflet / React-Leaflet

---

## Project structure

```txt
app/
  api/
    auth/[...nextauth]/route.ts    # NextAuth route
    courses/route.ts               # Course search API
    health/route.ts                # Health + DB diagnostics
    notifications/email/route.ts   # Notification email sender
    schedules/route.ts             # User schedule CRUD
    share/route.ts                 # Signed share payload API
  components/CourseCard.tsx        # Reusable class card UI
  CourseMap.tsx                    # Campus map + route drawing
  page.tsx                         # Main scheduler experience
  privacy/page.tsx                 # Privacy policy page
  terms/page.tsx                   # Terms of use page
lib/
  auth.ts                          # Shared auth options
  db-url.ts                        # Resolves DATABASE_URL / Supabase parts
  db.ts                            # Prisma + pg pool client
  scheduler/buildings.ts           # Building metadata source of truth
  security/                        # Rate limit + audit helpers
  share.ts                         # Signed share token helpers
  validation.ts                    # Zod schemas
prisma/
  schema.prisma                    # DB schema
```

---

## Local setup

### Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL connection (local or hosted)

### 1) Install

```bash
npm install
```

### 2) Configure environment variables

Create `.env` and set:

```bash
# Database
DATABASE_URL=postgresql://...
# or use SUPABASE_DB_* split vars (host/user/password/etc.)
DB_SSL_REJECT_UNAUTHORIZED=false

# Auth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...

# Optional notifications
RESEND_API_KEY=...
NOTIFICATION_FROM_EMAIL=...

# Optional AI chat (recommended)
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/free

# Optional account restriction
ALLOWED_EMAIL_DOMAIN=student.fullcoll.edu
```

### 3) Run development server

```bash
npm run dev
```

Open `http://localhost:3000`.

### 4) Useful checks

```bash
npm run lint
npm run build
npm run test:ai-model
```

`test:ai-model` prints the active AI provider/model returned by `/api/ai-chat` (for example `openai`, `openrouter`, or `local-fallback`).

---

## Deployment (Vercel)

1. Push repository to GitHub.
2. Import project into Vercel.
3. Add all required env vars in Vercel project settings.
4. Deploy.
5. Validate health endpoint:
   - `https://<your-domain>/api/health`

---

## Core API endpoints

- `GET /api/courses` - search courses
- `GET /api/health` - service/db diagnostics
- `POST /api/ai-chat` - student help assistant replies
- `GET/POST/DELETE /api/schedules` - schedule persistence
- `POST /api/share` - create signed share payloads
- `POST /api/notifications/email` - send watch notifications

---

## Current product decisions

- Saving schedules requires sign-in.
- Travel-time warnings are currently disabled by product choice.
- Support contact: `cypressschedulersupport@gmail.com`.

---

## Suggested next improvements

- Split `app/page.tsx` into smaller feature modules.
- Add unit tests for ranking/conflict helpers.
- Add E2E tests for search -> add -> save -> share flow.
- Add monitoring/alerting for production APIs.
