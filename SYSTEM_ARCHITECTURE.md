# SYSTEM_ARCHITECTURE.md

Documents what **actually exists** in the repository today. Anything not literally in the code is marked `PLANNED`.

## High-Level Topology — CURRENT

```
┌─────────────────────┐        HTTPS (fetch, credentials:'include')        ┌──────────────────────────┐
│   frontend/ (SPA)    │ ───────────────────────────────────────────────▶ │  backend/ (Express app)  │
│  React 19 + Vite     │ ◀─────────────────────────────────────────────── │  single serverless fn    │
│  Deployed: Vercel #1 │        JSON, httpOnly JWT cookie (name: "token")  │  Deployed: Vercel #2      │
└─────────────────────┘                                                   └──────────────┬───────────┘
                                                                                           │ mongoose
                                                                                           ▼
                                                                              ┌─────────────────────┐
                                                                              │  MongoDB (MONGO_URI) │
                                                                              └─────────────────────┘
```

Two independently deployed Vercel projects, no shared build, no monorepo tool. They agree only via the HTTP contract in [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md).

## Frontend Architecture — CURRENT

- **Framework**: React 19, `react-router-dom` v7 `BrowserRouter` with 9 top-level routes, all declared in [frontend/src/App.tsx](frontend/src/App.tsx).
- **State**: One global context, `AuthContext` (`frontend/src/context/AuthContext.tsx`), a discriminated union `{status: 'loading'|'guest'|'student'|'admin', ...}`. No Redux/Zustand/React Query — every page manages its own `useState`/`useEffect` data fetching.
- **Data fetching**: `frontend/src/api/client.ts` — a thin `fetch` wrapper (`api.get`/`api.post`) that always sends `credentials: 'include'` and throws a typed `ApiError` on non-2xx. Pages call this directly in `useEffect`; there is no caching layer, so every page re-fetches on mount.
- **Styling**: CSS Modules per page/component (`*.module.css`) plus a small global stylesheet `src/styles/theme.css` and global utility classes (`container`, `card`, `form-group`, `form-control`, `error-text`) referenced by className string rather than imported — these are assumed to live in `theme.css`.
- **Charts**: `chart.js` + `react-chartjs-2`, wrapped in a single reusable `ChartCard` component supporting line/bar.
- **Icons/fonts**: loaded via CDN `<link>` tags in `index.html` (Phosphor Icons, Google Fonts) — not npm dependencies.
- **Build**: `tsc -b && vite build`, static output, deployed as a static Vercel site with SPA fallback rewrite.

### Frontend data-flow reality check

Several pages **do not** call the backend even though a matching endpoint exists:
- `Dashboard.tsx` and `Landing.tsx` leaderboards → hardcoded arrays, never call `GET /api/leaderboard`.
- `Certificate.tsx` → never calls `GET /api/certificates/:studentId`.
- No page calls `GET /api/daily-challenge` at all.
- `Result.tsx` → pure client-side hash-based fake lookup, no network call.
- `Exam.tsx` → no network call at submit time; score is computed and shown locally, then discarded on navigation.
- `Admin.tsx` student table/chart → hardcoded, no "list students" endpoint exists to call even if it wanted to.

Pages that **do** genuinely round-trip to the backend: `Landing` (register/login), `Admin` (admin login), `AiGenerator` (generate-questions), `Analytics` and `Report` (fetch analytics, same endpoint for both).

## Backend Architecture — CURRENT

- **Framework**: Express 5, TypeScript, executed via `tsx` locally (`npm run dev`/`start`) and as a Vercel serverless function in production via [backend/api/index.ts](backend/api/index.ts) (which just re-exports the Express `app` — `@vercel/node` handles the adaptation).
- **Everything lives in one file**: [backend/src/server.ts](backend/src/server.ts) — CORS/middleware setup, DB connection, all 5 Mongoose model definitions, the JWT auth middleware, and all 11 routes. No `routes/`, `controllers/`, or `models/` directories exist yet.
- **Middleware stack**: `cors` (origin from `FRONTEND_URL` env or `localhost:5173`, `credentials: true`), `express.json()`, `cookie-parser`. No `helmet`, no rate limiter, no request logger beyond `console.log`.
- **DB connection pattern**: a Vercel-serverless-aware guard (`if (mongoose.connection.readyState === 0)`) so repeated cold starts don't open duplicate connections; called once at module load, not lazily per-request.
- **Auth middleware**: `requireAuth(...roles)` reads the `token` cookie, verifies the JWT, checks the decoded `role` against the allowed roles for that route, attaches `req.user`.

## Database Architecture — CURRENT

See [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) for full field-level detail. Five collections declared: `Student`, `Question`, `ExamAttempt`, `Result`, `StudentAnalytics`. Of these, `ExamAttempt` and `Result` are declared but never referenced by any route (dead code today). No indexes beyond the implicit unique index on `Student.mobile`. No migration tool, no seed script.

## Authentication Architecture — CURRENT

- Stateless JWT (`jsonwebtoken`), signed with `JWT_SECRET` (env, insecure hardcoded fallback if unset — see [`SECURITY.md`](SECURITY.md)), 7-day expiry, delivered via an `httpOnly` cookie named `token`.
- Two payload shapes share one token type: `{role: 'student', sub, studentId}` or `{role: 'admin', email}`.
- No refresh tokens, no token revocation list — logout just clears the client cookie; a stolen token remains valid for up to 7 days.
- Admin identity is **not** in the database at all — it's two env vars (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`) compared directly in the login route. There is exactly one admin account, by design.

## API Architecture — CURRENT

REST-ish under `/api/*`, JSON in/out, consistent `{success: boolean, ...}` response envelope. See [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) for the full endpoint list split into implemented-and-wired vs. implemented-but-orphaned vs. planned.

## Storage Architecture — CURRENT / PLANNED

- **CURRENT**: Static image assets (`logo.png`, QR code, founder photo) are bundled into the frontend build via Vite's asset pipeline — not served from any external storage or CDN, not user-uploadable.
- **PLANNED**: No file/image upload feature exists anywhere (no multipart handling, no S3/Cloudinary/etc. integration). Needed eventually for things like certificate PDFs or a gallery, but nothing is wired up.

## Email Architecture — PLANNED (not started)

No email-sending library, no provider integration, no email field on any model. The registration "OTP" flow is entirely fake and client-side only.

## Payment Architecture — PLANNED (not started)

No payment gateway SDK/dependency in either `package.json`. The registration flow shows a static QR image and treats "I've paid" as a self-reported client click with no server-side verification, no order record, no webhook.

## Deployment Architecture — CURRENT

- `backend/vercel.json`: rewrites all paths to `/api` (the serverless function entry).
- `frontend/vercel.json`: rewrites `/api/*` to a **hardcoded absolute URL** `https://amit-olympiad.vercel.app/api/$1` (the backend's production deployment), and everything else to `/index.html` for SPA routing.
- This means the frontend's production build always points at one specific backend Vercel deployment URL — if the backend project's URL ever changes (e.g., project renamed), `frontend/vercel.json` must be updated manually.
- Local dev uses a different mechanism entirely: Vite's dev proxy (`vite.config.ts`) forwards `/api` to `http://localhost:8081`, matching the port in `.claude/launch.json`.

## Major Data Flows — CURRENT

**Registration**: Landing form (details → fake OTP → fake payment) → `POST /api/auth/register` → bcrypt hash → `Student.save()` → JWT cookie issued → frontend sets `AuthContext` state → redirect to `/dashboard`.

**Student login**: Landing modal → `POST /api/auth/login` → bcrypt compare → JWT cookie → `AuthContext` updated.

**Session restore**: On every SPA load, `AuthContext` calls `GET /api/auth/me` once; cookie absent/invalid → `guest` state.

**Admin question generation**: `AiGenerator.tsx` form → `POST /api/admin/generate-questions` (admin-only) → template-generates N question objects → `Question.insertMany()` → returned and rendered; these are real DB writes, but the "questions" are not written by an AI model.

**Analytics view**: `Analytics.tsx`/`Report.tsx` → `GET /api/analytics/:studentId` → looks up `StudentAnalytics` by `studentId` → **always missing today** → hardcoded mock JSON returned instead → rendered as if real.

**Exam / Results / Certificates / Leaderboard / Daily challenge**: each is either a closed client-side loop with no network call, or a backend endpoint with no frontend caller. No data flows between them today.
