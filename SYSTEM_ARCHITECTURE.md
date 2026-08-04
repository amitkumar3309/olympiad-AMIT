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
  lib/permissions.ts      THE role -> permission table (single source of truth)
  lib/audit.ts            recordAudit() — writes the administrative audit trail
  middleware/auth.ts          authenticate / requireAuth(...roles) /
                              requirePermission(...) — the only authz gate
  middleware/validate.ts      zod validation for body/query/params
  middleware/errorHandler.ts  global error handler + 404 handler
  middleware/rateLimiter.ts   general + auth limiters
  middleware/requestLogger.ts pino-http
  middleware/ensureDb.ts      per-request DB connection gate
  models/                 one Mongoose model per file + barrel index
  routes/health.routes.ts /health, /ready
  routes/v1/              auth, analytics, questions, admin, users, misc
                          + barrel index
  validation/             zod schemas (authSchemas, questionSchemas,
                          userSchemas)
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
- **Privileged routes invert that order**: `requirePermission` expands to `authenticate → ensureDb → freshRoleCheck → permissionCheck`, which runs *before* `validate`. An unauthorized caller is refused before any input is parsed, and the role is re-read from the database rather than trusted from the token — see [`DECISIONS.md`](DECISIONS.md).
- **Error handling**: routes retain their own `try/catch` returning the `{ success, error }` envelope; the global handler is the safety net for validation failures, 404s, thrown `ApiError`s, and anything an async handler rejects with (Express 5 forwards those automatically).

## Database Architecture — CURRENT

**Connection strategy (Milestone 1)**: `db/connection.ts` owns a single cached connection. `connectDB()` returns immediately if already connected and de-duplicates concurrent calls via a shared in-flight promise, so it is safe to call per request. It is invoked from two places: eagerly by `server.ts` at local boot (non-fatally — a failure logs and the server still starts, with `/ready` reporting 503), and lazily by the `ensureDb` middleware on every DB-backed route. The lazy path is what makes production work at all: the Vercel serverless entry imports `app.ts` directly and never runs `server.ts`, so without `ensureDb` no connection would ever be opened. `serverSelectionTimeoutMS` is set explicitly (8s normally, 300ms under test) rather than relying on Mongoose's 30s default, which exceeds a serverless function's own timeout.

See [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) for full field-level detail. Five collections declared: `Student`, `Question`, `ExamAttempt`, `Result`, `StudentAnalytics`. Of these, `ExamAttempt` and `Result` are declared but never referenced by any route (dead code today). No indexes beyond the implicit unique index on `Student.mobile`. No migration tool, no seed script.

## Authentication Architecture — CURRENT

_Rewritten in Milestone 2. The previous design was a single 7-day JWT with no revocation._

**Two credentials, different jobs:**

- **Access token** — a JWT signed with `JWT_SECRET` (mandatory in production), 15 minutes (8 hours for the root administrator), `httpOnly` session cookie `access_token`. Claims: `role`, `sub`, `studentId`, `email`, `tv`, and `root` for the environment-configured administrator. Authentication is stateless — signature and expiry only, no database read — and a token whose `role` is not a recognised role is rejected outright. **Authorization is not stateless for privileged requests**: the `role` claim is treated as a hint and the current role is re-read from MongoDB, so revoking someone's access takes effect immediately rather than at the end of the token's lifetime.
- **Refresh token** — 32 bytes of `crypto.randomBytes`, opaque, 30 days, `httpOnly` cookie `refresh_token`. Persisted in the `RefreshToken` collection as a **SHA-256 hash only**, rotated on every use, and grouped into a per-login "family".

**Rotation and theft response**: each refresh mints a new token, revokes the old one, and links them. Replaying an already-rotated token revokes the entire family, since two holders of one token means theft or replay.

**Revocation model**: `logout` revokes just the presented refresh token; `logout-all` and password resets revoke every token *and* bump `Student.tokenVersion`, which invalidates outstanding access tokens (checked as `tv` on `/auth/me`). Because access-token checks are stateless, a revoked session can survive at most one access-token lifetime — a deliberate trade-off documented in [`SECURITY.md`](SECURITY.md).

**Email-bound flows**: verification (24h) and password reset (30 min) use single-use tokens from the `VerificationToken` collection, also stored hashed, consumed atomically so a link cannot be redeemed twice.

**Identity**: students log in with **either** their mobile number or their email address. Login is refused until the email is verified (`REQUIRE_EMAIL_VERIFICATION`). Accounts carry a `status` (`active`/`suspended`/`deactivated`) enforced at login, on refresh, and on every `/auth/me`, plus failed-login lockout.

**Admin** identity is still **not** in the database — two env vars compared in the login route. It gets a single longer-lived access token (8h) and **no** refresh token, because there is no student record to anchor a token family to (see [`DECISIONS.md`](DECISIONS.md)).

## API Architecture — CURRENT

REST-ish under `/api/v1/*` (canonical) with `/api/*` retained as a backward-compatible alias mounting the same router — see [`DECISIONS.md`](DECISIONS.md). JSON in/out, consistent `{success: boolean, ...}` response envelope produced by `lib/apiResponse.ts`. Request bodies and query params are validated by zod schemas via `middleware/validate.ts` before any handler runs. See [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) for the full endpoint list split into implemented-and-wired vs. implemented-but-orphaned vs. planned.

## Storage Architecture — CURRENT / PLANNED

- **CURRENT**: Static image assets (`logo.png`, QR code, founder photo) are bundled into the frontend build via Vite's asset pipeline — not served from any external storage or CDN, not user-uploadable.
- **PLANNED**: No file/image upload feature exists anywhere (no multipart handling, no S3/Cloudinary/etc. integration). Needed eventually for things like certificate PDFs or a gallery, but nothing is wired up.

## Email Architecture — CURRENT

_Implemented in Milestone 2. The fake client-side "OTP" step was deleted._

- `lib/email.ts` sends through **`nodemailer` over plain SMTP**, configured entirely by env vars, so any free-tier provider (Brevo, Resend, Mailtrap, a Gmail app password) works without a code change or vendor SDK.
- Three transports, chosen by environment:
  - **test** → captured in memory, letting tests assert on the real generated link;
  - **SMTP configured** → real delivery;
  - **SMTP unset** → written to the structured log, including the working link, so local development works before any provider exists.
- Two templates: email verification and password reset. Link bases come from `FRONTEND_URL`.
- Delivery failures are logged and swallowed, never surfaced, so a dead provider cannot become a 500 or leak whether an address exists.
- **Not yet configured** — until the owner sets `SMTP_*`, production would only log emails. See [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

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

**Any DB-backed request**: rate limiter → zod validation → `requireAuth` (where applicable) → `ensureDb` (connect-or-503) → handler. Privileged (`requirePermission`) routes authenticate and authorize first, so they can answer 401/403 before parsing and answer 503 when the database is down, because the role cannot then be verified. A malformed request therefore returns 400 without ever touching the database, and an unreachable database returns a clean 503 rather than a 500 or a hang.

**Registration (Milestone 2)**: Landing form (details → payment placeholder) → `POST /api/v1/auth/register` → bcrypt hash (cost 12) → `Student` created unverified with a unique `studentId` (retrying on collision) → single-use token stored hashed → verification email → **no session issued**. The UI then says "check your email".

**Email verification**: emailed link → `/verify-email?token=…` → `POST /api/v1/auth/verify-email` → token consumed atomically → `isEmailVerified: true` → student can now sign in.

**Login**: `POST /api/v1/auth/login` with mobile *or* email → lockout check → bcrypt compare (incrementing the failure counter and locking after 5) → status check → verification check → access + refresh cookies issued, refresh row written hashed.

**Authenticated request**: `access_token` cookie → stateless verification → handler for student-level permissions; for an administrative permission the chain additionally re-reads `role`/`status`/`tokenVersion` from the database and uses those values.

**Administrative request**: `requirePermission('...')` consults the single role → permission table in `lib/permissions.ts`; on success the handler runs and calls `recordAudit()`; on refusal the caller gets 403 and an `authz.denied` row is written to `AuditLog`. Every authenticated response also carries the caller's effective permission list, which is what the frontend's guards and navigation are built from — the UI never keeps its own copy of the mapping. On a 401 the frontend client transparently calls `/auth/refresh` once (de-duplicated through a shared promise) and replays the request.

**Refresh**: `refresh_token` cookie → hash lookup → reuse/expiry checks → new token minted, old one revoked and linked → both cookies re-set.

**Password reset**: `POST /auth/forgot-password` (always a generic 200) → hashed single-use token → emailed link → `/reset-password?token=…` → new hash written, `tokenVersion` bumped, **all** refresh tokens revoked, email marked verified, cookies cleared.

**Session restoration after reload**: `AuthContext` calls `/auth/me`; if that fails it attempts one `/auth/refresh` and retries before concluding the visitor is a guest. This is what keeps a signed-in student signed in across a browser refresh, given the access cookie is a session cookie.

**Legacy registration flow (removed)**: Landing form (details → fake OTP → fake payment) → `POST /api/v1/auth/register` → bcrypt hash → `Student.save()` → JWT cookie issued → frontend sets `AuthContext` state → redirect to `/dashboard`.

**Student login**: Landing modal → `POST /api/v1/auth/login` → bcrypt compare → JWT cookie → `AuthContext` updated.

**Session restore**: On every SPA load, `AuthContext` calls `GET /api/v1/auth/me` once; cookie absent/invalid → `guest` state.

**Admin question generation**: `AiGenerator.tsx` form → `POST /api/v1/admin/generate-questions` (admin-only) → template-generates N question objects → `Question.insertMany()` → returned and rendered; these are real DB writes, but the "questions" are not written by an AI model.

**Analytics view**: `Analytics.tsx`/`Report.tsx` → `GET /api/v1/analytics/:studentId` → looks up `StudentAnalytics` by `studentId` → **always missing today** → hardcoded mock JSON returned instead → rendered as if real.

**Exam / Results / Certificates / Leaderboard / Daily challenge**: each is either a closed client-side loop with no network call, or a backend endpoint with no frontend caller. No data flows between them today.
