# PROJECT_STATE.md

_Last updated: 2026-08-05 (registration now collects and persists the full entrant record, including a photo)._

This file is the current snapshot. History belongs in [`CHANGELOG.md`](CHANGELOG.md). If this file and the code disagree, trust the code and fix this file.

## Current Development Phase

**Registration data capture: implemented and verified end-to-end.** Registration collects the full entrant record the owner specified — three name parts, both parents' names, date of birth, class, school, full address, mobile, email and a mandatory photo — and writes every field to MongoDB in the same request. Previously it stored only name/mobile/email/password. Photos live in a new `StudentPhoto` collection and are served by an authorization-checked endpoint.

Before that, **Milestone 3 — RBAC and User Management Foundation: implemented and verified end-to-end.** Authorization is now permission-based with a single role → permission table, three roles exist (`student` / `admin` / `superadmin`), administrators can be created and managed from the app, account status finally has a UI, and every administrative action — plus every refused one — is written to a queryable audit trail. Privileged requests re-read the caller's role from the database, so revoking access takes effect immediately rather than at token expiry.

No other product feature was touched. The exam, results, certificates and leaderboard pages are still mock — unchanged since Milestone 1. The admin *dashboard* is no longer mock: its figures are real counts.

## Last Completed Milestone

**Milestone 3 — RBAC and User Management Foundation.** Preceded by Milestone 2 (complete authentication), Milestone 1 (backend & database foundation) and Phase 0 (repository audit).

## Current Milestone

None formally in progress. The registration-data work above was an owner-requested fix rather than a numbered milestone; Milestone 4 is still to be chosen (see "Immediate Next Task").

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
- **Authorization (Milestone 3)** — permission-based and centralized:
  - Three roles (`student` / `admin` / `superadmin`) and nine named permissions, mapped in exactly one place (`backend/src/lib/permissions.ts`).
  - Routes declare a permission via `requirePermission`; no handler compares a role to a literal. `requireAuth(...)` survives only for identity-only gates.
  - Privileged requests re-read `role`, `status` and `tokenVersion` from MongoDB, so a demotion or suspension is effective at once instead of surviving the access token's 15 minutes. Student-level requests remain stateless.
  - Frontend: `RequirePermission` route guard, a real `Unauthorized` state, and navigation filtered by the permission list the server sends (never a client-side copy of the rules).
- **Admin accounts (Milestone 3)** — the env-configured **root** account holds `superadmin` and is the bootstrap identity (8-hour token, no refresh token, no database record, by design). It can promote any verified active account to `admin`, which revokes that account's sessions so the new role is picked up on a fresh sign-in. Promoted admins sign in through the normal student login and inherit lockout, rotation, verification and password reset. `superadmin` is not assignable through any API.
- **Student & admin account management (Milestone 3)** — `/admin/users`: real paginated listing with literal (regex-escaped) search and status/role filters, suspend / deactivate / reactivate, and grant/revoke admin for a super admin only. Suspension ends live sessions immediately; reactivation clears the lockout counters. `status` is no longer settable only by a direct database edit.
- **Audit trail (Milestone 3)** — `AuditLog` collection and `/admin/audit-log` page. Records role changes, status changes, question generation, administrative sign-ins, **and refused privileged requests** with the exact missing permission. No TTL. Writes are best-effort so a failed audit write never fails the action it describes.
- **Question listing** — `GET /api/v1/questions` reads real documents with validated query params.
- **AI Question Generator (partial)** — admin-only, really writes to MongoDB; the "AI" is a template-string generator, not a model call.
- **Registration data capture** — `POST /auth/register` collects and persists `firstName` / `middleName` / `lastName` (with `fullName` derived), `fatherName`, `motherName`, `dateOfBirth`, `classLevel` (ten fixed values, 5th–12th with the three 12th-class streams), `schoolName`, `address`, plus the existing mobile / email / password. A **mandatory photo** (≤2 MB, JPEG/PNG/WebP, magic-byte checked) is stored in the new `StudentPhoto` collection and served by `GET /students/:studentId/photo`, readable by the student themselves or by staff holding `students:read`. The admin table shows photo, class and school.
- **Backend test suite** — **147 passing tests** across 9 files, all against a real in-memory MongoDB where a database is needed: 62 RBAC / privilege-escalation tests (Milestone 3), 40 registration-detail tests, and 32 auth integration tests (Milestone 2).

## Partially Completed Modules

- **Student analytics** — real model + route, but falls back to hardcoded demo data because nothing ever creates a `StudentAnalytics` document. Every real student sees only the fallback. Its *authorization* is now real and tested (own record vs. anyone's record).
- **Admin dashboard** — the account figures and recent-registration list are real; the weekly-accuracy chart is still sample data, now labelled as such in the UI because no exam results exist to chart.
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
- **XP / Levels / Badges / Achievements / Journey map / Gallery / Hall of Fame / Notifications / Subscriptions** — not started.
- **Student self-service profile editing** — still nothing. Registration now captures a full record and an admin can view and manage any account, but **no one can edit their own details after registering**, and there is no way to replace a photo. That gap is wider than it was, now that there is more data to correct.
- **Account deletion** — deliberately not built; deactivation is the reversible equivalent.

## Current Frontend State

React 19 SPA, 14 routes (2 added in Milestone 3: `/admin/users`, `/admin/audit-log`). The registration wizard on the landing page now collects 13 fields grouped into *Student details* / *Photo* / *Contact & sign-in*, marks every required one with a red `*`, previews the chosen photo, and refuses an oversized or wrong-type file — and each missing field by name — before submitting. All API access flows through `frontend/src/api/client.ts`, which prefixes `API_BASE = '/api/v1'` and transparently refreshes an expired access token once before retrying, de-duplicating concurrent refreshes through a single shared promise. `AuthContext` exposes register / login / logout / logout-everywhere / verify / resend / forgot / reset, plus `role`, `permissions` and `can(permission)` — all supplied by the backend, so the UI keeps no copy of the authorization rules. `status` records only *which kind of account* is signed in (a student record, or the root admin); it must never be used to decide whether something administrative is allowed. Route guards are `ProtectedRoute` (student account) and `RequirePermission` (capability), the latter rendering an `Unauthorized` state for a signed-in user rather than silently redirecting. Administrative pages share an `AdminShell` whose sidebar is filtered by permission. Verified: `oxlint` passes (one pre-existing fast-refresh warning), `tsc -b && vite build` succeeds, and every flow was driven through a real browser with no console errors.

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
lib/permissions.ts        THE role -> permission table (Milestone 3)
lib/classLevels.ts        the ten offered classes (5th-12th + 12th streams)
lib/audit.ts              audit-trail recorder (Milestone 3)
middleware/               auth (authenticate/requireAuth/requirePermission),
                          validate, errorHandler, rateLimiter,
                          requestLogger, ensureDb
models/                   9 models, one file each (+ StudentPhoto)
routes/health.routes.ts   /health, /ready
routes/v1/                auth (12 routes), analytics, questions, admin,
                          users (5 admin/audit routes), misc
validation/               zod schemas for auth + questions + users
tests/                    9 suites, 147 tests (real-DB auth + RBAC + registration)
```

`ExamAttempt` and `Result` remain defined but unused. Three routes (`daily-challenge`, `leaderboard`, `certificates/:studentId`) are still static mocks.

## Current Database State

MongoDB via Mongoose, **9 models**: `Student` (now with `role` and the nine registration fields), `Question`, `ExamAttempt`, `Result`, `StudentAnalytics`, `RefreshToken`, `VerificationToken`, `AuditLog`, plus new **`StudentPhoto`**. The two token collections store only SHA-256 hashes and carry TTL indexes; `AuditLog` deliberately has **no** TTL. Unique indexes on `Student.mobile`, `Student.email`, `Student.studentId` and `StudentPhoto.student`, and a non-unique index on `Student.role`.

**Photo storage is bounded by the database.** At 2 MB a photo, the Atlas free tier's 512 MB holds roughly **250 students** — enough for a first cohort, and the first thing that will force a paid tier or an image CDN.

**Atlas connectivity is still unverified from this development sandbox** (outbound raw DNS/TCP is blocked). Milestone 2 was instead verified against a real MongoDB run locally on port 27017, which exercised the same code paths, indexes and constraints. The owner must still confirm Atlas works from their machine — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Current Authentication State

Complete for students; deliberately simpler for the root administrator. Implemented: bcrypt password hashing, email verification, login by mobile or email, access/refresh token split with rotation and theft detection, revocation (per-device and everywhere), password reset that revokes all sessions, account status (`active`/`suspended`/`deactivated`), failed-login lockout, per-endpoint rate limiting, and no account enumeration on login, forgot-password or resend-verification.

Milestone 3 added the authorization half: three roles, one permission table, `requirePermission` gates, database-fresh role checks on privileged requests, and immediate session revocation on role change or suspension. Admin accounts are now real database accounts and reuse everything above.

Still missing: CSRF tokens (see [`SECURITY.md`](SECURITY.md)) and two-factor auth.

## Current Payment State

None. No provider selected, no code. Static QR image only, with no link to the registration transaction — registration completes regardless of whether payment happened.

## Current Deployment State

Two independent Vercel projects, unchanged in structure. `backend/api/index.ts` imports the app from `src/app.ts`; the per-request `ensureDb` middleware is what makes the serverless path connect at all.

**Deployment ordering matters**: deploy the backend before the frontend, since the frontend calls `/api/v1/*`. Milestone 2 adds a second requirement: **set the SMTP and `FRONTEND_URL` env vars before students register in production**, or verification emails will not be delivered (they will only be written to the server log) and their links will point at the wrong host.

Milestone 3 adds no new environment variables and no new deploy step, but two things are worth knowing before deploying it:
- **Student sessions keep working**, unlike the Milestone 2 deploy — the cookie names did not change. **The root administrator's session does not**: its old token carries `role: 'admin'` with no `sub` and no `root` flag, so it is refused with 401 and the root admin must sign in again. That refusal is deliberate and covered by a test (it must not degrade into matching an arbitrary account).
- **The first admin can only be created by the root account.** Promotion requires the target account to be email-verified, so in production this depends on SMTP being configured first.

## Important File Locations

| Concern | Location |
|---|---|
| Express app assembly | [backend/src/app.ts](backend/src/app.ts) |
| Auth routes (all 12) | [backend/src/routes/v1/auth.routes.ts](backend/src/routes/v1/auth.routes.ts) |
| Token service | [backend/src/lib/tokens.ts](backend/src/lib/tokens.ts) |
| Password hashing | [backend/src/lib/password.ts](backend/src/lib/password.ts) |
| Email service + templates | [backend/src/lib/email.ts](backend/src/lib/email.ts) |
| **Permission table (start here for authorization)** | [backend/src/lib/permissions.ts](backend/src/lib/permissions.ts) |
| Authorization middleware | [backend/src/middleware/auth.ts](backend/src/middleware/auth.ts) |
| Audit-trail recorder | [backend/src/lib/audit.ts](backend/src/lib/audit.ts) |
| Admin user-management + audit routes | [backend/src/routes/v1/users.routes.ts](backend/src/routes/v1/users.routes.ts) |
| Rate limiters | [backend/src/middleware/rateLimiter.ts](backend/src/middleware/rateLimiter.ts) |
| Auth validation schemas | [backend/src/validation/authSchemas.ts](backend/src/validation/authSchemas.ts) |
| Student / token / audit models | [backend/src/models/](backend/src/models/) |
| Auth integration tests | [backend/tests/auth.flows.test.ts](backend/tests/auth.flows.test.ts), [backend/tests/auth.security.test.ts](backend/tests/auth.security.test.ts) |
| **Privilege-escalation tests** | [backend/tests/rbac.test.ts](backend/tests/rbac.test.ts) |
| Frontend API client (auto-refresh) | [frontend/src/api/client.ts](frontend/src/api/client.ts) |
| Session/auth state | [frontend/src/context/AuthContext.tsx](frontend/src/context/AuthContext.tsx) |
| New auth pages | [frontend/src/pages/Auth/](frontend/src/pages/Auth/) |
| Frontend route guards + unauthorized state | [frontend/src/components/ProtectedRoute.tsx](frontend/src/components/ProtectedRoute.tsx), [frontend/src/components/Unauthorized.tsx](frontend/src/components/Unauthorized.tsx) |
| Admin shell + permission-aware nav | [frontend/src/pages/Admin/AdminShell.tsx](frontend/src/pages/Admin/AdminShell.tsx) |
| Admin user management / audit pages | [frontend/src/pages/Admin/Users.tsx](frontend/src/pages/Admin/Users.tsx), [frontend/src/pages/Admin/AuditLog.tsx](frontend/src/pages/Admin/AuditLog.tsx) |
| Dev server config | [.claude/launch.json](.claude/launch.json) |

## Current Environment Requirements

Milestone 3 added **no new environment variables**. `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` keep their meaning but now define the **root `superadmin`** rather than "the admin".

Backend: `MONGO_URI`, `JWT_SECRET` (mandatory in production), `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `FRONTEND_URL` (now also the base for emailed links), and the SMTP group (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM`). Optional policy knobs: `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `ADMIN_TOKEN_TTL`, `REQUIRE_EMAIL_VERIFICATION`, `MAX_FAILED_LOGINS`, `ACCOUNT_LOCK_MINUTES`. Frontend: none. Full detail in [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

**SMTP is not yet configured** — until the owner sets it, emails are written to the backend log rather than delivered.

## Known Bugs

0. **Existing student documents predate `role`** — but harmlessly. Unlike the `email` problem below, `role` is optional with a schema default, so an old document simply reads as `role: 'student'` and needs no backfill. Worth knowing when reading a raw document that has no `role` field.
1. **Existing student documents predate `email`.** `email` is now required and unique, so any `Student` created before Milestone 2 lacks it and will fail validation the next time it is saved. Reads still work. There is no migration script. If the Atlas database holds real students, they must be given addresses (or removed) before they can log in — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
2. **Analytics never persisted** — `generateAIInsights()` mutates `aiInsights` in memory and never saves. Harmless only because the real-data branch is unreachable.
3. **Dead models** — `ExamAttempt` and `Result` are defined but untouched by any route.
4. **`/api/v1/auth/me` returns 503 when the database is unreachable** for account-backed callers (the root admin answers from the token alone). The frontend treats any failure as "guest", so behaviour is correct, but the status is broader than ideal.
5. **Privileged routes need the database to authorize.** Because the role is re-read per privileged request, an administrator sees **503** rather than 403 while MongoDB is down. This is deliberate (see [`DECISIONS.md`](DECISIONS.md)) — correctness over availability on admin endpoints — but it does mean the admin panel is unusable during a database outage.
6. **The root `superadmin` cannot be managed from the app.** It has no document, so it cannot be suspended, demoted or listed under `/admin/users`; withdrawing it means changing the environment variables and redeploying.
7. **No rate limit specific to the admin routes.** They sit behind the general `/api` limiter only.
8. **Registration photos are stored as uploaded** — not re-encoded and not stripped of metadata, so EXIF (including any GPS tags a phone wrote) is kept and served back to staff. Re-encoding through an image library would fix it; see [`SECURITY.md`](SECURITY.md).
9. **A photo cannot be replaced or removed.** There is no upload route beyond registration, so a wrong photo currently needs a direct database edit.

Fixed in Milestone 3: the absent admin tooling for account status, the inline role checks scattered across handlers, the analytics route's role comparison, the 15-minute window in which a demoted admin kept working, and `logout-all` being unusable by a non-student role.

Fixed in Milestone 2: the `studentId` collision risk (now uniquely indexed with retry-on-collision), the absent password reset, the absent email verification, and the inability to revoke a session.

## Technical Debt

- **Staff accounts are `Student` documents.** A promoted admin lives in the `Student` collection with `role: 'admin'`, so the model name is now narrower than what it stores. Renaming it needs a migration and was out of scope — see [`DECISIONS.md`](DECISIONS.md).
- `ExamAttempt` / `Result` models still unused.
- No migration tooling — the `email` backfill above has to be done by hand.
- Hardcoded production backend URL inside `frontend/vercel.json`.
- Mixed English/Hindi error strings are now gone from the auth routes, but `PROJECT_STATE`-era Hinglish may remain elsewhere; no deliberate localisation decision has been made.
- No CI pipeline; verification commands are run manually.
- No CSRF token mechanism (production cookies are `sameSite: 'none'` because the apps are on different domains).
- No frontend test suite at all — so the route guards, permission-aware navigation and unauthorized states are verified only by hand in a browser.
- The frontend mirrors the *names* of the permissions as a TypeScript union in `api/types.ts`. The mapping is not duplicated (it comes from the server), but adding a permission means adding its name in two places.
- The unversioned `/api/*` alias should eventually be removed.
- Pre-existing `npm audit` findings in `@vercel/node`'s build-time dependency tree.

## Immediate Next Task

Two things gate a real launch, in this order:

1. **Owner action: configure SMTP** (see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)). Still outstanding, and unchanged by Milestone 3: until it is set, no student can receive a verification link in production, which also means no new account can be promoted to admin (promotion requires a verified account).
2. **Owner decision: Milestone 4.** With authorization and account management done, the strongest candidate is now **exam submission → `ExamAttempt` → real results**: both models already exist and are unused, it is the only path that makes the analytics real branch reachable, it converts the four remaining mock surfaces (Exam, Results, Certificates, Leaderboard) in one dependency chain, and it needs no external account or spend. The alternative is the payment gateway, which is the only thing between the current flow and collecting real money but requires a provider decision and cost approval.

Smaller follow-ups worth considering either way: CSRF tokens (now the top security gap, with real state-mutating admin routes to protect), a tighter rate limit on the admin routes, and a student self-service profile page — the last of which grew more valuable now that registration captures nine more fields a student may need to correct, and a photo they cannot currently replace.

## Recent Architectural Decisions

See [`DECISIONS.md`](DECISIONS.md). Milestone 3 added four ADRs: three roles with the env account as `superadmin` and admins promoted from existing accounts; permission-based authorization held in one table; privileged requests re-reading the role from the database; and an audit trail that records refusals and never expires.

Milestone 2 added six: the access/refresh token split, login by mobile-or-email, verification-before-login, SMTP via nodemailer with a log fallback, admins having no refresh token, and adopting a real in-memory MongoDB for integration tests (superseding the Milestone 1 decision against it).
