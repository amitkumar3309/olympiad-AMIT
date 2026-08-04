# PROJECT_STATE.md

_Last updated: 2026-08-04 (Milestone 2 — Complete Authentication System, implemented)._

This file is the current snapshot. History belongs in [`CHANGELOG.md`](CHANGELOG.md). If this file and the code disagree, trust the code and fix this file.

## Current Development Phase

**Milestone 2 — Complete Authentication System: implemented and verified end-to-end.** Registration, email verification, login (mobile *or* email), short-lived access tokens with rotating refresh tokens, password reset, session revocation, account status handling and lockout are all real, database-backed, and covered by integration tests against a real MongoDB.

No other product feature was touched. The exam, results, certificates, leaderboard and analytics pages are still mock — unchanged from Milestone 1.

## Last Completed Milestone

**Milestone 2 — Complete Authentication System.** Preceded by Milestone 1 (backend & database foundation) and Phase 0 (repository audit).

## Current Milestone

None in progress. Awaiting owner selection of Milestone 3.

## Completed Modules (real, end-to-end)

- **Backend foundation** (Milestone 1) — modular structure, env validation, typed config, DB connection module, structured + request logging, global error handling, request validation, `helmet`, CORS allow-list, rate limiting, `/health` + `/ready`, graceful shutdown.
- **API versioning** — `/api/v1/*` canonical, `/api/*` compatibility alias.
- **Authentication (Milestone 2)** — all of the following are real and tested:
  - Registration with `fullName`, `mobile`, `email`, `password`; bcrypt (cost 12); unique `mobile`/`email`/`studentId`.
  - Email verification via a single-use, hashed, 24-hour token emailed to the student. Login is blocked until verified.
  - Login by **mobile number or email**, with account-status checks and lockout after 5 failed attempts (15 minutes).
  - Access tokens (15 min JWT, `httpOnly` cookie) + opaque refresh tokens (30 days, rotated on use, stored SHA-256-hashed) with reuse/theft detection that revokes the whole token family.
  - `/auth/refresh`, `/auth/logout` (this device), `/auth/logout-all` (everywhere, bumps `tokenVersion`).
  - Forgot password → single-use 30-minute reset token → reset, which also revokes every session. No account enumeration on either endpoint.
  - Current-user endpoint, and frontend session restoration across a browser reload (tries `/auth/me`, falls back to one refresh).
  - Per-endpoint rate limiting on every sensitive route.
- **Route protection** — `requireAuth(...roles)` on the backend; `ProtectedRoute` / `AdminRoute` on the frontend.
- **Admin login** — single env-configured account, 8-hour access token, no refresh token (by design).
- **Question listing** — `GET /api/v1/questions` reads real documents with validated query params.
- **AI Question Generator (partial)** — admin-only, really writes to MongoDB; the "AI" is a template-string generator, not a model call.
- **Backend test suite** — 44 passing tests, including 32 auth integration tests against a real in-memory MongoDB.

## Partially Completed Modules

- **Student analytics** — real model + route, but falls back to hardcoded demo data because nothing ever creates a `StudentAnalytics` document. Every real student sees only the fallback.
- **AI insights** — real rule-based logic (not ML), reachable only on the currently-unpopulated real-data path.

## Pending / Not Started Modules (UI exists, no real backend wiring)

Unchanged by Milestone 2:

- **Exam / exam attempts** — client-side hardcoded 5-question quiz; nothing submitted. `ExamAttempt` model unused.
- **Results** — fabricated client-side by hashing the entered Student ID. `Result` model unused.
- **Certificates** — rendered client-side from the logged-in student's name/ID.
- **Leaderboard** — hardcoded in `Landing.tsx` and `Dashboard.tsx`; the backend route exists but is never called.
- **Daily challenge** — backend route exists (static mock), no frontend caller.
- **Payments** — static QR image; no gateway, no verification, no transaction record. Registration still proceeds on a self-reported "I've paid" click.
- **Mobile/SMS verification** — deliberately dropped. The fake client-side OTP step was **deleted**; email verification replaces it. No SMS provider is integrated.
- **Admin student management** — hardcoded 4-row table; no list-students route.
- **XP / Levels / Badges / Achievements / Journey map / Gallery / Hall of Fame / Notifications / Audit logs / Subscriptions** — not started.

## Current Frontend State

React 19 SPA, 12 routes (3 new: `/verify-email`, `/forgot-password`, `/reset-password`). All API access flows through `frontend/src/api/client.ts`, which prefixes `API_BASE = '/api/v1'` and transparently refreshes an expired access token once before retrying, de-duplicating concurrent refreshes through a single shared promise. `AuthContext` exposes register / login / logout / logout-everywhere / verify / resend / forgot / reset and restores the session on load. Verified: `oxlint` passes (one pre-existing fast-refresh warning), `tsc -b && vite build` succeeds, and the full flow was driven through a real browser with no console errors.

## Current Backend State

Modular Express 5 app under `backend/src/`:

```
app.ts                    Express app assembly
server.ts                 local bootstrap + graceful shutdown
config/env.ts             dotenv + zod validation (now incl. token/email settings)
config/index.ts           typed config; separate access/refresh cookie options
db/connection.ts          cached connect/disconnect + state helpers
lib/logger.ts             pino
lib/ApiError.ts           typed operational errors
lib/apiResponse.ts        { success, ... } envelope helpers
lib/password.ts           bcrypt hash/verify (cost 12; 4 under test for speed)
lib/tokens.ts             access JWTs, refresh-token rotation, single-use tokens
lib/email.ts              nodemailer SMTP + log/in-memory transports + templates
middleware/               auth, validate, errorHandler, rateLimiter,
                          requestLogger, ensureDb
models/                   7 models, one file each
routes/health.routes.ts   /health, /ready
routes/v1/                auth (12 routes), analytics, questions, admin, misc
validation/               zod schemas for auth + questions
tests/                    7 suites, 44 tests (incl. real-DB auth integration)
```

`ExamAttempt` and `Result` remain defined but unused. Three routes (`daily-challenge`, `leaderboard`, `certificates/:studentId`) are still static mocks.

## Current Database State

MongoDB via Mongoose, **7 models**: `Student` (extended), `Question`, `ExamAttempt`, `Result`, `StudentAnalytics`, plus new `RefreshToken` and `VerificationToken`. Both new collections store only SHA-256 hashes of their tokens and carry TTL indexes so expired rows are removed automatically. Unique indexes now exist on `Student.mobile`, `Student.email` and `Student.studentId`.

**Atlas connectivity is still unverified from this development sandbox** (outbound raw DNS/TCP is blocked). Milestone 2 was instead verified against a real MongoDB run locally on port 27017, which exercised the same code paths, indexes and constraints. The owner must still confirm Atlas works from their machine — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Current Authentication State

Complete for students; deliberately simpler for the single admin. Implemented: bcrypt password hashing, email verification, login by mobile or email, access/refresh token split with rotation and theft detection, revocation (per-device and everywhere), password reset that revokes all sessions, account status (`active`/`suspended`/`deactivated`), failed-login lockout, per-endpoint rate limiting, and no account enumeration on login, forgot-password or resend-verification.

Still missing: CSRF tokens (see [`SECURITY.md`](SECURITY.md)), two-factor auth, and any admin-facing tooling to change a student's status (the field exists; nothing but a direct database edit sets it).

## Current Payment State

None. No provider selected, no code. Static QR image only, with no link to the registration transaction — registration completes regardless of whether payment happened.

## Current Deployment State

Two independent Vercel projects, unchanged in structure. `backend/api/index.ts` imports the app from `src/app.ts`; the per-request `ensureDb` middleware is what makes the serverless path connect at all.

**Deployment ordering matters**: deploy the backend before the frontend, since the frontend calls `/api/v1/*`. Milestone 2 adds a second requirement: **set the SMTP and `FRONTEND_URL` env vars before students register in production**, or verification emails will not be delivered (they will only be written to the server log) and their links will point at the wrong host.

## Important File Locations

| Concern | Location |
|---|---|
| Express app assembly | [backend/src/app.ts](backend/src/app.ts) |
| Auth routes (all 12) | [backend/src/routes/v1/auth.routes.ts](backend/src/routes/v1/auth.routes.ts) |
| Token service | [backend/src/lib/tokens.ts](backend/src/lib/tokens.ts) |
| Password hashing | [backend/src/lib/password.ts](backend/src/lib/password.ts) |
| Email service + templates | [backend/src/lib/email.ts](backend/src/lib/email.ts) |
| Auth middleware | [backend/src/middleware/auth.ts](backend/src/middleware/auth.ts) |
| Rate limiters | [backend/src/middleware/rateLimiter.ts](backend/src/middleware/rateLimiter.ts) |
| Auth validation schemas | [backend/src/validation/authSchemas.ts](backend/src/validation/authSchemas.ts) |
| Student / token models | [backend/src/models/](backend/src/models/) |
| Auth integration tests | [backend/tests/auth.flows.test.ts](backend/tests/auth.flows.test.ts), [backend/tests/auth.security.test.ts](backend/tests/auth.security.test.ts) |
| Frontend API client (auto-refresh) | [frontend/src/api/client.ts](frontend/src/api/client.ts) |
| Session/auth state | [frontend/src/context/AuthContext.tsx](frontend/src/context/AuthContext.tsx) |
| New auth pages | [frontend/src/pages/Auth/](frontend/src/pages/Auth/) |
| Dev server config | [.claude/launch.json](.claude/launch.json) |

## Current Environment Requirements

Backend: `MONGO_URI`, `JWT_SECRET` (mandatory in production), `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `FRONTEND_URL` (now also the base for emailed links), and the SMTP group (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM`). Optional policy knobs: `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `ADMIN_TOKEN_TTL`, `REQUIRE_EMAIL_VERIFICATION`, `MAX_FAILED_LOGINS`, `ACCOUNT_LOCK_MINUTES`. Frontend: none. Full detail in [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

**SMTP is not yet configured** — until the owner sets it, emails are written to the backend log rather than delivered.

## Known Bugs

1. **Existing student documents predate `email`.** `email` is now required and unique, so any `Student` created before Milestone 2 lacks it and will fail validation the next time it is saved. Reads still work. There is no migration script. If the Atlas database holds real students, they must be given addresses (or removed) before they can log in — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
2. **Analytics never persisted** — `generateAIInsights()` mutates `aiInsights` in memory and never saves. Harmless only because the real-data branch is unreachable.
3. **Dead models** — `ExamAttempt` and `Result` are defined but untouched by any route.
4. **`/api/v1/auth/me` returns 503 when the database is unreachable** for students (admins answer from the token alone). The frontend treats any failure as "guest", so behaviour is correct, but the status is broader than ideal.
5. **No admin tooling for account status.** `status` is enforced on login and on every `/auth/me`, but only a direct database edit can set it.

Fixed in Milestone 2: the `studentId` collision risk (now uniquely indexed with retry-on-collision), the absent password reset, the absent email verification, and the inability to revoke a session.

## Technical Debt

- `ExamAttempt` / `Result` models still unused.
- No migration tooling — the `email` backfill above has to be done by hand.
- Hardcoded production backend URL inside `frontend/vercel.json`.
- Mixed English/Hindi error strings are now gone from the auth routes, but `PROJECT_STATE`-era Hinglish may remain elsewhere; no deliberate localisation decision has been made.
- No CI pipeline; verification commands are run manually.
- No CSRF token mechanism (production cookies are `sameSite: 'none'` because the apps are on different domains).
- No frontend test suite at all.
- The unversioned `/api/*` alias should eventually be removed.
- Pre-existing `npm audit` findings in `@vercel/node`'s build-time dependency tree.

## Immediate Next Task

Two things gate a real launch, in this order:

1. **Owner action: configure SMTP** (see the instructions at the end of the Milestone 2 hand-off, and [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)). Until then, no student can receive a verification link in production.
2. **Owner decision: Milestone 3.** Strongest candidates: wire exam submission → `ExamAttempt` → real results (both models exist, unused); real admin student management (would also give `status` a UI); or the payment gateway decision, which is the only thing standing between the current flow and collecting real money.

## Recent Architectural Decisions

See [`DECISIONS.md`](DECISIONS.md). Milestone 2 added six ADRs: the access/refresh token split, login by mobile-or-email, verification-before-login, SMTP via nodemailer with a log fallback, admins having no refresh token, and adopting a real in-memory MongoDB for integration tests (superseding the Milestone 1 decision against it).
