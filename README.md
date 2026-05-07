# 🎓 Cypress College Scheduler

A course-planning web app tailored for Cypress College students — search class sections, build conflict-free schedules, preview campus locations on a map, and get help from an AI assistant.

![Next.js](https://img.shields.io/badge/Next.js-App_Router-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)
![NextAuth](https://img.shields.io/badge/NextAuth-Google_OAuth-black?logo=google&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-Map-199900?logo=leaflet&logoColor=white)

---

## ✨ Features

- **Course Search** — Tokenized keyword search with relevance ranking across Cypress College's course catalog
- **Multi-Plan Scheduling** — Create and compare multiple schedule plans side-by-side
- **Conflict Detection** — Automatically flags time-overlap conflicts when building your schedule
- **Campus Map** — Visualize class building locations and walking routes with Leaflet
- **Schedule Optimizer** — AI-ranked schedule options based on your preferences
- **myGateway Import** — Paste your myGateway schedule to import existing classes
- **Manual Search Mode** — Class-focused filters for targeted section lookup
- **Cloud Save** — Signed-in users can persist and reload their schedules
- **Shareable Links** — Generate read-only links to share your schedule with others
- **AI Chat Assistant** — In-app assistant helps find classes and answer scheduling questions
- **Email Notifications** — Optional alerts when class status changes
- **Google Sign-In** — Secure authentication via NextAuth and Google OAuth

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript |
| Database | PostgreSQL (Supabase/Neon/local) |
| ORM | Prisma + `@prisma/adapter-pg` |
| Auth | NextAuth v4 (Google OAuth) |
| Map | Leaflet + React-Leaflet |
| Calendar | React Big Calendar |
| AI | OpenAI API / OpenRouter (with local fallback) |
| Styling | Tailwind CSS 4 |
| Security | Rate limiting, audit logging, Zod validation |

---

## 🚀 Setup & Running

### Prerequisites
- Node.js 20+, npm 10+
- PostgreSQL database (local or hosted via Supabase/Neon)
- Google OAuth credentials

### 1. Install

```bash
git clone https://github.com/ThaiBenjamin/cypress-scheduler.git
cd cypress-scheduler
npm install
```

### 2. Configure environment

Create a `.env` file:

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Auth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_secret

# AI chat (optional — falls back to local guidance if not set)
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini

# Optional: notifications
RESEND_API_KEY=your_key
NOTIFICATION_FROM_EMAIL=noreply@yourdomain.com
```

### 3. Run

```bash
npm run dev
```

Open **http://localhost:3000**.

### 4. Deploy to Vercel

1. Push to GitHub and import into Vercel
2. Add all env vars in Vercel project settings
3. Deploy — validate at `/api/health`

---

## 📁 Project Structure

```
app/
  api/          # Next.js API routes (courses, schedules, share, auth, ai-chat)
  components/   # CourseCard, CourseMap
  page.tsx      # Main scheduler UI
lib/
  scheduler/    # Buildings metadata, conflict logic
  security/     # Rate limiting, audit logging
  db.ts         # Prisma + pg client
  auth.ts       # NextAuth config
  share.ts      # Signed share tokens
  validation.ts # Zod schemas
prisma/
  schema.prisma # Database schema
```

---

## 🧠 What I Built and Why

Cypress College doesn't have a modern visual course scheduler — students manually cross-reference PDFs and the myGateway portal to avoid time conflicts. I wanted to solve that.

I built this app to give Cypress students a tool similar to AntAlmanac (UCI's scheduler) but tailored to our catalog. The biggest technical challenges were scraping and normalizing the course data (handled by a GitHub Actions-automated Python scraper), designing a conflict detection algorithm that handles split-day classes, and integrating an AI assistant that understands scheduling context rather than just answering generic questions.

It pushed me to work with the full production stack: database migrations, OAuth flows, signed share tokens, rate limiting, and automated data pipelines — all real-world concerns I wouldn't have encountered in a tutorial.

---

## 📬 Support

Questions or feedback: `cypressschedulersupport@gmail.com`
