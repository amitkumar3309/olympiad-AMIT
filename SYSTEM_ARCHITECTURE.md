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
- **Data fetching**: `frontend/src/api/client.ts` — a thin `fetch` wrapper (`api.get`/`api.post`) that always sends `credentials: 'include'` and throws a typed `ApiError` on non-2xx. Pages call this directly in `useEffect`; there is no caching layer, so every page re-fetches on mount. It also owns `API_BASE = '/api/v1'` and prefixes every request, so callers pass version-agnostic paths (`/auth/login`, not `/api/auth/login`) and the API version changes in exactly one place.
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

_Restructured in Milestone 1 (2026-08-04). Previously all logic lived in a single ~450-line `server.ts`._

- **Framework**: Express 5 + TypeScript, run via `tsx` locally and as a Vercel serverless function in production.
- **Two entry points, one app**:
  - `src/app.ts` — `createApp()` assembles middleware and routes and exports a configured app. Imported by **both** the local server and the Vercel entry (`api/index.ts`).
  - `src/server.ts` — local/standalone process bootstrap only: eagerly connects to MongoDB (non-fatally), starts the HTTP listener, and installs SIGTERM/SIGINT graceful-shutdown handlers. **Never executed on the serverless path.**
- **Module layout**:

```
src/
  app.ts                  Express app assembly (middleware order matters, see below)
  server.ts               local bootstrap + graceful shutdown
  config/env.ts           dotenv load + zod validation of process.env
  config/index.ts          typed config derived from env (the only consumer of env.ts)
  db/connection.ts        connect/disconnect, cached + de-duplicated, state helpers
  lib/logger.ts           pino instance
  lib/ApiError.ts         operational error class with status code + factories
  lib/apiResponse.ts      sendSuccess / sendError (the { success, ... } envelope)
  middleware/auth.ts          requireAuth(...roles)
  middleware/validate.ts      zod validation for body/query/params
  middleware/errorHandler.ts  global error handler + 404 handler
  middleware/rateLimiter.ts   general + auth limiters
  middleware/requestLogger.ts pino-http
  middleware/ensureDb.ts      per-request DB connection gate
  models/                 one Mongoose model per file + barrel index
  routes/health.routes.ts /health, /ready
  routes/v1/              auth, analytics, questions, admin, misc + barrel index
  validation/             zod schemas (authSchemas, questionSchemas)
```

- **Middleware order in `app.ts`** (deliberate):
  1. `helmet` + `x-powered-by` disabled
  2. request logging (`pino-http`)
  3. CORS (explicit allow-list, `credentials: true`)
  4. `express.json`, `cookie-parser`
  5. **health routes** — mounted *before* the rate limiter so monitoring probes are never throttled and never depend on the DB
  6. general rate limiter
  7. `/api/v1` routes, then the same router again at `/api` (compatibility alias)
  8. 404 handler, then the global error handler
- **Per-route middleware order** for data routes: `rateLimit → validate → requireAuth → ensureDb → handler`. Validation runs *before* the DB gate so malformed input returns 400 even when the database is down.
- **Error handling**: routes retain their own `try/catch` returning the `{ success, error }` envelope; the global handler is the safety net for validation failures, 404s, thrown `ApiError`s, and anything an async handler rejects with (Express 5 forwards those automatically).

## Database Architecture — CURRENT

**Connection strategy (Milestone 1)**: `db/connection.ts` owns a single cached connection. `connectDB()` returns immediately if already connected and de-duplicates concurrent calls via a shared in-flight promise, so it is safe to call per request. It is invoked from two places: eagerly by `server.ts` at local boot (non-fatally — a failure logs and the server still starts, with `/ready` reporting 503), and lazily by the `ensureDb` middleware on every DB-backed route. The lazy path is what makes production work at all: the Vercel serverless entry imports `app.ts` directly and never runs `server.ts`, so without `ensureDb` no connection would ever be opened. `serverSelectionTimeoutMS` is set explicitly (8s normally, 300ms under test) rather than relying on Mongoose's 30s default, which exceeds a serverless function's own timeout.

See [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) for full field-level detail. Five collections declared: `Student`, `Question`, `ExamAttempt`, `Result`, `StudentAnalytics`. Of these, `ExamAttempt` and `Result` are declared but never referenced by any route (dead code today). No indexes beyond the implicit unique index on `Student.mobile`. No migration tool, no seed script.

## Authentication Architecture — CURRENT

- Stateless JWT (`jsonwebtoken`), signed with `JWT_SECRET` (env, insecure hardcoded fallback if unset — see [`SECURITY.md`](SECURITY.md)), 7-day expiry, delivered via an `httpOnly` cookie named `token`.
- Two payload shapes share one token type: `{role: 'student', sub, studentId}` or `{role: 'admin', email}`.
- No refresh tokens, no token revocation list — logout just clears the client cookie; a stolen token remains valid for up to 7 days.
- Admin identity is **not** in the database at all — it's two env vars (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`) compared directly in the login route. There is exactly one admin account, by design.

## API Architecture — CURRENT

REST-ish under `/api/v1/*` (canonical) with `/api/*` retained as a backward-compatible alias mounting the same router — see [`DECISIONS.md`](DECISIONS.md). JSON in/out, consistent `{success: boolean, ...}` response envelope produced by `lib/apiResponse.ts`. Request bodies and query params are validated by zod schemas via `middleware/validate.ts` before any handler runs. See [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) for the full endpoint list split into implemented-and-wired vs. implemented-but-orphaned vs. planned.

## Storage Architecture — CURRENT / PLANNED

- **CURRENT**: Static image assets (`logo.png`, QR code, founder photo) are bundled into the frontend build via Vite's asset pipeline — not served from any external storage or CDN, not user-uploadable.
- **PLANNED**: No file/image upload feature exists anywhere (no multipart handling, no S3/Cloudinary/etc. integration). Needed eventually for things like certificate PDFs or a gallery, but nothing is wired up.

## Email Architecture — PLANNED (not started)

No email-sending library, no provider integration, no email field on any model. The registration "OTP" flow is entirely fake and client-side only.

## Payment Architecture — PLANNED (not started)

No payment gateway SDK/dependency in either `package.json`. The registration flow shows a static QR image and treats "I've paid" as a self-reported client click with no server-side verification, no order record, no webhook.

## Deployment Architecture — CURRENT

- `backend/vercel.json`: rewrites all paths to `/api` (the serverless function entry). `api/index.ts` imports the app from `src/app.ts` (not `src/server.ts`), so the serverless path never runs the local bootstrap — DB connection there is handled by the `ensureDb` middleware.
- `frontend/vercel.json`: rewrites `/api/*` to a **hardcoded absolute URL** `https://amit-olympiad.vercel.app/api/$1` (the backend's production deployment), and everything else to `/index.html` for SPA routing.
- Since the frontend now requests `/api/v1/...`, and both the Vite dev proxy and the Vercel `/api/(.*)` rewrite pass the remainder of the path through unchanged, **no deploy config needed to change** for versioning. It does introduce a deployment-ordering requirement: deploy the **backend first**, otherwise a newly deployed frontend calls `/api/v1/*` against an older backend that only serves `/api/*` and every request 404s.
- This means the frontend's production build always points at one specific backend Vercel deployment URL — if the backend project's URL ever changes (e.g., project renamed), `frontend/vercel.json` must be updated manually.
- Local dev uses a different mechanism entirely: Vite's dev proxy (`vite.config.ts`) forwards `/api` to `http://localhost:8081`, matching the port in `.claude/launch.json`.

## Major Data Flows — CURRENT

**Liveness / readiness probing**: `GET /health` returns 200 from the process with no DB involvement. `GET /ready` inspects the Mongoose connection state and returns 200 `{status:'ready'}` or 503 `{db:'disconnected'}`. Both are mounted before the rate limiter, so probes are never throttled.

**Any DB-backed request**: rate limiter → zod validation → `requireAuth` (where applicable) → `ensureDb` (connect-or-503) → handler. A malformed request therefore returns 400 without ever touching the database, and an unreachable database returns a clean 503 rather than a 500 or a hang.

**Registration**: Landing form (details → fake OTP → fake payment) → `POST /api/v1/auth/register` → bcrypt hash → `Student.save()` → JWT cookie issued → frontend sets `AuthContext` state → redirect to `/dashboard`.

**Student login**: Landing modal → `POST /api/v1/auth/login` → bcrypt compare → JWT cookie → `AuthContext` updated.

**Session restore**: On every SPA load, `AuthContext` calls `GET /api/v1/auth/me` once; cookie absent/invalid → `guest` state.

**Admin question generation**: `AiGenerator.tsx` form → `POST /api/v1/admin/generate-questions` (admin-only) → template-generates N question objects → `Question.insertMany()` → returned and rendered; these are real DB writes, but the "questions" are not written by an AI model.

**Analytics view**: `Analytics.tsx`/`Report.tsx` → `GET /api/v1/analytics/:studentId` → looks up `StudentAnalytics` by `studentId` → **always missing today** → hardcoded mock JSON returned instead → rendered as if real.

**Exam / Results / Certificates / Leaderboard / Daily challenge**: each is either a closed client-side loop with no network call, or a backend endpoint with no frontend caller. No data flows between them today.
