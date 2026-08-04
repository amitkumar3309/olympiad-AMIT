# CHANGELOG.md

Chronological development history. For current state, see [`PROJECT_STATE.md`](PROJECT_STATE.md) instead — do not let this file's older entries get treated as current fact.

## 2026-08-05 — Navbar: expose the Admin link to guests

The navbar's **Admin** link previously rendered only for someone already holding `students:read`, so a logged-out visitor had no way to reach the admin sign-in form except by typing `/admin` by hand. It now also renders for guests. It stays hidden for a signed-in plain student, who would only reach the `Unauthorized` screen by following it. No authorization behaviour changed — the link is navigation only, and every admin route is still gated server-side.

## 2026-08-05 — Milestone 3: RBAC and User Management Foundation

Authorization moved from scattered role checks to a single permission table, admin accounts became real and manageable, and administrative actions are now audited. **No exam, results, certificate or leaderboard behaviour changed.**

**Roles**
- Three roles: `student`, `admin`, `superadmin`. The env-configured account (`ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH`) now holds **`superadmin`** and is the bootstrap root, still with no database document.
- A super admin grants or revokes `admin` on any existing verified account. Promoted admins are ordinary accounts with `role: 'admin'`, so they inherit login-by-mobile-or-email, lockout, refresh-token rotation, email verification and password reset — and keep their student capabilities.
- `superadmin` is **not assignable through any API**: there is deliberately no path to a second root administrator.

**Authorization**
- New `backend/src/lib/permissions.ts` — nine named permissions and the only role → permission mapping in the codebase. Comparing `req.user.role` to a literal is now forbidden outside that file.
- `middleware/auth.ts` rewritten: `requirePermission(...)` is the gate routes should use, with `requireAuth(...)` kept for the rare identity-only gate. Adds `callerCan` / `callerCanFresh` for decisions that depend on the data being addressed.
- **Privileged requests re-read `role`, `status` and `tokenVersion` from MongoDB** rather than trusting the access token, so a demotion or suspension takes effect immediately instead of surviving up to 15 minutes. Student-level requests stay stateless.
- `verifyAccessToken()` now rejects any token whose `role` is not a recognised role.
- Role changes and suspensions revoke every refresh token and bump `tokenVersion`.
- `GET /analytics/:studentId` lost its inline `role !== 'admin'` check in favour of `analytics:read:self` plus a database-fresh `analytics:read:any`.

**Database changes**
- `Student` gained `role` (`student`|`admin`, indexed, default `student`), `roleUpdatedAt` and `roleUpdatedBy`.
- New `AuditLog` collection: action, actor (role + id + denormalised label), target, outcome, metadata, ip, user agent. Indexed newest-first plus by action and by actor. **No TTL** — unlike the token collections, this must not expire.

**API changes** (all under `/api/v1`)
- New: `GET /admin/students`, `GET /admin/students/:studentId`, `PATCH /admin/students/:studentId/status`, `PATCH /admin/users/:studentId/role`, `GET /admin/audit-logs`.
- Changed: `POST /auth/login`, `POST /auth/refresh` and `GET /auth/me` now return `role` and the caller's effective `permissions` array.
- Changed: `POST /auth/admin/login` returns `role: 'superadmin'` and issues a token marked `root`.
- Changed: `POST /auth/logout-all` is now `requireAuth()` rather than `requireAuth('student')`, which would have locked promoted admins out of their own session management.
- Changed: `POST /admin/generate-questions` is gated on `questions:write` and writes an audit entry.

**Security**
- `users:role:write` belongs to `superadmin` alone, so a compromised admin session cannot mint more admins.
- An ordinary admin cannot change the status of an account that holds a role; nobody can change their own role or status; an unverified or inactive account cannot be promoted.
- The admin listing's free-text search is regex-escaped, so `.*` matches literally instead of matching every account. `:studentId` params are constrained to `AMIT_` plus four digits.
- Refused privileged requests are recorded as `authz.denied` with the missing permission — a run of them is the signature of an escalation attempt.

**Frontend**
- `AuthContext` now carries `role` and `permissions` from the server and exposes `can(permission)`. `status` distinguishes only *which kind of account* is signed in, never what it may do.
- `AdminRoute` replaced by `RequirePermission`, which shows a real **unauthorized state** to a signed-in user instead of silently redirecting.
- New `Unauthorized` component; permission-filtered navigation in `Navbar` and in a new shared `AdminShell`.
- New pages: `/admin/users` (real paginated listing, search, status and role filters, suspend/reactivate, grant/revoke admin for a super admin) and `/admin/audit-log` (filter by action and outcome).
- `Admin.tsx`'s four hardcoded student rows and invented "15,000+ students" tiles are **gone**, replaced by real counts. The weekly-accuracy chart remains sample data and is now labelled as such.
- `api/client.ts` gained `patch`.

**Testing**
- New `backend/tests/rbac.test.ts` — **62 tests**, taking the suite from 44 to **106**. Covers: every admin route refused to a student (403) and to a guest (401), including through the unversioned `/api` alias; forged, role-tampered, unknown-role and role-less tokens; `role` submitted at registration being ignored; a demoted admin's still-valid token; suspended and deleted accounts; an admin trying to promote anyone or suspend a peer; cross-account analytics reads; and every audit entry, including refusals.
- `tests/setup.ts` provisions root-admin credentials in-process so the real admin-login path is exercised without committing a password hash.

**Verified**
- `npm test` (105 passed), `npm run typecheck`, `npm run lint`, `npm run compile` in `backend/`; `tsc -b && vite build` and `oxlint` in `frontend/`.
- Driven end-to-end in a browser against a real MongoDB: root admin sign-in, promotion, suspension, the audit trail, the promoted admin's reduced UI, and a student's unauthorized states. Escalation attempts were then made **directly against the API**, bypassing the UI entirely, plus cookie/`localStorage`/header tampering — all refused with 403 and no data leaked.

---

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
