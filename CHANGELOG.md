# CHANGELOG.md

Chronological development history. For current state, see [`PROJECT_STATE.md`](PROJECT_STATE.md) instead — do not let this file's older entries get treated as current fact.

## 2026-08-04 — Milestone 2: Complete Authentication System

Authentication is now real end-to-end: registration, email verification, login, token refresh, logout, password reset, revocation, account status and lockout. **No mock authentication and no fake logged-in users remain anywhere.**

**Database changes**
- `Student` extended: added `email` (required, unique, lowercased), `isEmailVerified`, `status` (`active`/`suspended`/`deactivated`), `tokenVersion`, `failedLoginAttempts`, `lockedUntil`, `lastLoginAt`. `studentId` is now **unique**, and `passwordHash` is `select: false` so it cannot leak through a route that forgets to exclude it.
- New `RefreshToken` collection: SHA-256 hash only, per-login `familyId`, rotation bookkeeping (`revokedAt`, `replacedByHash`), TTL index.
- New `VerificationToken` collection: SHA-256 hash only, `type` (`email_verify` | `password_reset`), single-use `usedAt`, TTL index.
- **Breaking for existing data**: `email` is required and unique, so `Student` documents created before this milestone will fail validation on their next save. No migration script — see `TROUBLESHOOTING.md`.

**API changes** (all under `/api/v1`)
- New: `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/refresh`, `POST /auth/logout-all`, `POST /auth/forgot-password`, `POST /auth/reset-password`.
- Changed: `POST /auth/register` now requires `email`, enforces a stronger password policy, returns `201`, and **no longer issues a session** — the student must verify first.
- Changed: `POST /auth/login` now takes `identifier` (mobile **or** email) instead of `mobile`, and can return `403` with `code: 'EMAIL_NOT_VERIFIED'` or `423` when locked out.
- Changed: `POST /auth/logout` revokes the presented refresh token server-side rather than only clearing a cookie.
- Changed: the auth cookie `token` is replaced by `access_token` (15 min) plus `refresh_token` (30 days). **Any session issued before this deploy is invalidated.**

**Security changes**
- Access/refresh token split with rotation and theft detection: replaying a rotated refresh token revokes the entire token family.
- Both refresh and email tokens are stored as SHA-256 hashes only; raw values never reach the database.
- Email tokens are single-use, consumed atomically via `findOneAndUpdate` on `usedAt: null` so concurrent redemptions cannot both succeed.
- bcrypt cost raised from 10 to 12.
- Password reset revokes every session and bumps `tokenVersion`.
- Account lockout after 5 failed logins for 15 minutes.
- Per-endpoint rate limits replacing the single shared auth limiter (tightest on the email-sending routes, which consume a third-party quota).
- No account enumeration on login, `forgot-password`, or `resend-verification` — asserted by a test comparing known/unknown responses.
- `studentId` collision bug fixed (unique index plus retry-on-duplicate).

**Email**
- New `lib/email.ts` using `nodemailer` over plain SMTP, so any free-tier provider works via env vars alone. Falls back to writing emails (with working links) to the structured log when SMTP is unset, and captures them in memory under test.
- **Owner action still required**: SMTP is not configured, so production would only log emails. See `ENVIRONMENT_VARIABLES.md`.

**Frontend**
- `api/client.ts` transparently refreshes an expired access token once and replays the request, de-duplicating concurrent refreshes through one shared promise (necessary, or the backend's reuse detection would correctly kill the session).
- `AuthContext` gained verify / resend / forgot / reset / logout-everywhere, and now restores sessions across a browser reload by falling back to one refresh attempt.
- New pages: `/verify-email`, `/forgot-password`, `/reset-password`.
- Registration form gained an email field and a stronger password rule; the post-registration step now says "check your email".
- **Removed the fake OTP step** that accepted the hardcoded string `123456`.

**Breaking changes**
- All existing sessions are invalidated (cookie names changed).
- `POST /auth/login` request shape changed (`mobile` → `identifier`).
- `POST /auth/register` requires `email` and no longer logs the user in.
- Pre-existing `Student` documents need an `email` before they can be saved or logged into.

**Verification**
- Backend: `typecheck`, `lint`, `test` (**44/44**, up from 12) and `build` all pass; tests still pass after a build.
- Frontend: `lint` passes (one pre-existing warning) and `build` succeeds.
- **32 auth integration tests run against a real MongoDB** (`mongodb-memory-server`), covering both required journeys plus invalid and expired tokens, rotation reuse, revocation, account status and lockout.
- Additionally verified by hand against a real database and a real browser: registered, was correctly blocked from logging in unverified, verified via the real emailed link, logged in with the mobile number, hit a protected route, refreshed (confirming rotation), replayed the old token (confirming family revocation), then reset the password through the UI and confirmed the old password and pre-reset sessions were dead.
- Atlas connectivity itself remains unverified from this sandbox (network-restricted); a local MongoDB was used instead.

---

## 2026-08-04 — Milestone 1: Backend & Database Foundation

Foundation work only — **no new product features, no new business endpoints**. All pre-existing route behaviour and response shapes were preserved.

**Structure**
- Split the single ~450-line `backend/src/server.ts` into a modular app: `config/`, `db/`, `lib/`, `middleware/`, `models/`, `routes/v1/`, `validation/`.
- `src/app.ts` now assembles the Express app (imported by both the local server and the Vercel entry); `src/server.ts` is reduced to process bootstrap plus graceful shutdown.
- `backend/api/index.ts` now imports from `src/app.ts` instead of `src/server.ts`.
- The 5 Mongoose models moved to one file each under `src/models/`, each with an exported TypeScript document interface. **No schema changes.**

**New capabilities**
- Environment validation via zod (`config/env.ts`) with a typed app config (`config/index.ts`); no other module reads `process.env`.
- MongoDB connection module with cached, de-duplicated connects and an explicit `serverSelectionTimeoutMS` (8s; 300ms under test) instead of Mongoose's 30s default.
- Structured logging (pino) and request logging (pino-http).
- Global error handler + 404 handler emitting the standard `{success:false, error}` envelope, hiding internals in production.
- Request validation architecture (`middleware/validate.ts`) with zod schemas per route.
- `GET /health` (liveness, no DB) and `GET /ready` (503 when Mongo is disconnected), both mounted before the rate limiter so probes are never throttled.
- Graceful shutdown on SIGTERM/SIGINT with a 10s forced-exit fallback.
- Backend test suite: vitest + supertest, 12 tests, no database required.
- ESLint + typescript-eslint for the backend; `build`, `typecheck`, `lint`, `test`, `test:watch` scripts.
- `backend/.env.example` with placeholder values.

**API changes**
- All routes are now served at **`/api/v1/*`** (canonical). The unversioned **`/api/*`** is retained as a compatibility alias mounting the same router, so existing clients keep working. A test asserts both return the same status.
- The frontend was migrated to the versioned API through a single `API_BASE = '/api/v1'` constant in `frontend/src/api/client.ts`; callers now pass version-agnostic paths (`/auth/login`). No deploy config changed, because both the Vite dev proxy and the Vercel `/api/(.*)` rewrite pass the remaining path through unchanged.

**Security changes**
- `JWT_SECRET` is now **mandatory in production** — startup throws instead of falling back to a hardcoded default (previously it only warned).
- CORS no longer falls back to reflecting any origin; it always uses an explicit allow-list and warns if `FRONTEND_URL` is unset in production.
- Added `helmet` and disabled `x-powered-by`.
- Added rate limiting: a general limiter on `/api` and a stricter limiter on the three auth routes.
- `GET /questions` query params are now schema-validated before any Mongoose filter is built.
- Corrected a factual error in `SECURITY.md`: the documented `qs` bracket-notation NoSQL-injection vector does not apply, because Express 5 defaults to the `'simple'` query parser. Verified empirically against Express 5.2.1.
- Per owner instruction, security behaviour is **implemented but deliberately not automatically tested** at this milestone (see `TESTING.md`).

**Bug fixes found by actually running the app**
- Restored `.env` loading. The refactor had dropped `dotenv.config()`, so locally the backend silently ignored `backend/.env` — falling back to `localhost:27017` and port 8080 instead of the configured Atlas URI and port 8081.
- Fixed the request-validation middleware crashing on success. `req.query` is a getter-only accessor in Express 5, so assigning the parsed value threw `Cannot set property query of #<IncomingMessage>`, returning 500 for otherwise-valid requests. Now uses `Object.defineProperty`.
- Added `middleware/ensureDb.ts`. The refactor had left the serverless path with **no database connection at all** (`api/index.ts` imports `app.ts`, which never called `connectDB()`), so production would have failed on every data route. DB-backed routes now connect lazily per request and return a clean 503 when the database is unreachable.
- Local boot no longer exits when MongoDB is unreachable; the server starts and `/ready` reports the true state, so a transient database problem doesn't require a manual restart.
- Fixed `npm run build` and `npm test` being mutually exclusive: `tsc` was compiling `tests/` into `dist/`, after which vitest tried to run the emitted CommonJS copies and crashed.

**Database changes**
- None. No schema, field, index, or collection changed.

**Breaking changes**
- None for API consumers (the unversioned alias preserves compatibility). One **deployment-ordering requirement**: deploy the backend before the frontend, since the frontend now calls `/api/v1/*`.

**Verification**
- Backend: `typecheck`, `lint`, `test` (12/12), and `build` all pass; `build` followed by `test` also passes.
- Frontend: `lint` passes (one pre-existing fast-refresh warning) and `build` succeeds.
- Both servers were run together: `/health` returned 200, `/ready` correctly returned 503 with the database unreachable, validation returned 400, unknown routes 404, protected routes 401, the versioned and aliased paths matched, and the SPA loaded in a browser with no console errors, reaching the backend through the Vite proxy.
- **Live MongoDB Atlas connectivity remains unverified** — blocked by sandbox network restrictions, not by credentials. See `TROUBLESHOOTING.md`.

---

## 2026-08-04 — Phase 0 repository audit (no code changes)

- Performed a full read-through of the existing repository: `frontend/` (React 19 + Vite SPA, 9 pages) and `backend/` (single-file Express + Mongoose API).
- Created the full project documentation set: `CLAUDE.md`, `PROJECT_STATE.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`, `FEATURE_STATUS.md`, `SECURITY.md`, `ENVIRONMENT_VARIABLES.md`, `DEPLOYMENT_GUIDE.md`, `TESTING.md`, `CHANGELOG.md`, `DECISIONS.md`, `TROUBLESHOOTING.md`.
- No source code was modified. No database changes. No API changes. No security changes (issues found are documented in `SECURITY.md`, not yet fixed).
- Key findings recorded: real auth (register/login/admin login) is genuinely wired to MongoDB; most "feature" pages (exam, results, certificates, leaderboard, daily challenge, admin student list, analytics for real students) are either hardcoded mock UI or backend endpoints the frontend never calls. Full detail in `FEATURE_STATUS.md`.

---

## Prior history (reconstructed from `git log`, pre-dates this documentation set)

- **`9dbdf27`** — Rebuilt the frontend in React (from an earlier non-React form), added real bcrypt+JWT authentication, and split the project into two independently deployed services (frontend/backend). This is the current architecture baseline.
- **`e19adb6`** — Pinned TypeScript to `5.9.3` in the backend to fix a Vercel build failure caused by a newer/incompatible TypeScript version.
- **`6df3e60`** — Merged a branch restructuring the project for a working Vercel deployment.
- **`1938876`** — Restructured the project layout to get Vercel deployment working.
- **`9bba7cf`** — Fixed Vercel configuration (earlier attempt).
- **`c32c717`** — Fixed Vercel deployment (earlier attempt).
- **`0fdd1b5`** — "all code" — initial/bulk commit of the original (pre-React-rebuild) codebase.

Note: commits prior to `9dbdf27` describe a different, earlier architecture (pre-dating the React rebuild and service split) that no longer reflects the current codebase — treat only `9dbdf27` onward as describing the current system.
