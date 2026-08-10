# PROJECT_STATE.md

_Last updated: 2026-08-10 (Milestone 5 — Student Profile and Dashboard, implemented and verified)._

This file is the current snapshot. History belongs in [`CHANGELOG.md`](CHANGELOG.md). If this file and the code disagree, trust the code and fix this file.

## Current Development Phase

**Milestone 5 — Student Profile and Dashboard: implemented and verified end-to-end.** A student can now see and change their own account, and the dashboard reports real progress. The governing requirement was **no fake statistics**, and it holds: every figure on every page this milestone touched is derived from a database read, and where a student has no data the panel says so and explains why.

- **Profile and settings** — a new `/profile` page: edit the nine registration fields, replace the photo, change the password. This closes the two longest-standing gaps in the product ("no one can edit their own details after registering", and known bug #9 "a photo cannot be replaced or removed"), both of which previously needed a direct database edit.
- **Progress, derived not stored** — a new `StudentActivity` collection is the single source of truth for XP, levels, streaks and achievements. There is deliberately no counter document: XP is a `$sum` over real events, the level a pure function of it, the streak computed from the distinct days present. XP accrues only from events that really happen (account created 50, email verified 50, daily visit 10), so a freshly verified account holds an explainable **110** rather than a flattering number.
- **Dashboard rewritten** — the three invented stat tiles and the three-name fake leaderboard are gone, replaced by XP/level with progress to the next, current and best streak, leaderboard rank, achievements with real progress toward the locked ones, a real activity feed, practice availability from the published bank for the student's own class, and test performance.
- **Two mock endpoints became real** — `GET /leaderboard` aggregates actual XP, `GET /daily-challenge` returns a deterministic published question (and is now authenticated, where the mock was open), and a new `GET /public/stats` feeds the landing page. The landing page's invented "Today's Champions" and four headline figures are gone.

**The exam, results and certificate pages are still mock** — this milestone deliberately did not touch them. The dashboard's test-performance panel is a *real query* against `ExamAttempt`, which nothing writes to, so it truthfully shows an empty state and will light up on its own when exam submission lands.

Before that, **Milestone 4 — Complete Question Bank System: implemented and verified end-to-end.** Questions are authored, reviewed and published through a real admin interface: a subject / topic / subtopic taxonomy, four question types with per-type answer shapes, marks and negative marks, an editorial workflow, tags, and search / filter / sort / pagination. Mathematics is written as LaTeX and rendered with KaTeX through a text/math split that keeps author content out of every HTML sink. It also closed a serious hole: `GET /questions` was **unauthenticated and returned the answer key**.

Before that, **registration data capture: implemented and verified end-to-end.** Registration collects the full entrant record the owner specified — three name parts, both parents' names, date of birth, class, school, full address, mobile, email and a mandatory photo — and writes every field to MongoDB in the same request. Previously it stored only name/mobile/email/password. Photos live in a new `StudentPhoto` collection and are served by an authorization-checked endpoint.

Before that, **Milestone 3 — RBAC and User Management Foundation: implemented and verified end-to-end.** Authorization is now permission-based with a single role → permission table, three roles exist (`student` / `admin` / `superadmin`), administrators can be created and managed from the app, account status finally has a UI, and every administrative action — plus every refused one — is written to a queryable audit trail. Privileged requests re-read the caller's role from the database, so revoking access takes effect immediately rather than at token expiry.

No other product feature was touched. The exam, results, certificates and leaderboard pages are still mock — unchanged since Milestone 1. The admin *dashboard* is no longer mock: its figures are real counts.

## Last Completed Milestone

**Milestone 5 — Student Profile and Dashboard.** Preceded by Milestone 4 (complete question bank), Milestone 3 (RBAC and user management), Milestone 2 (complete authentication), Milestone 1 (backend & database foundation) and Phase 0 (repository audit).

## Current Milestone

None in progress. Milestone 5 is complete; awaiting owner selection of Milestone 6 (see "Immediate Next Task").

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
- **Question bank (Milestone 4)** — real end-to-end. `Subject` + `Topic` (topics and subtopics in one self-referencing collection, depth capped at 1) + a rewritten `Question` with four types (`single_choice`, `multiple_choice`, `true_false`, `numeric`), server-assigned option keys with `isCorrect` flags, marks and negative marks, a `draft → in_review → published` workflow plus reversible `archived`, tags, and a `revision` counter. Full admin CRUD with search (literal, regex-escaped, across text/tags/solutions), filters, allow-listed sorting and stable pagination. Business rules live in `src/services/`.
- **Mathematical content (Milestone 4)** — stored as plain text with LaTeX islands (`$…$`, `$$…$$`), rendered by KaTeX. Prose becomes React text nodes and only KaTeX's own output is inserted as HTML, so author text never reaches an HTML sink; the backend independently refuses link, file-inclusion and macro-definition commands, unbalanced delimiters, markup and control characters.
- **Template draft generator** — the page formerly called "AI Question Generator". Still a template-string filler and **not** AI (no AI provider is integrated anywhere), but it now requires real subject and topic ids and writes **drafts only**, so placeholder text cannot reach a student.
- **Registration data capture** — `POST /auth/register` collects and persists `firstName` / `middleName` / `lastName` (with `fullName` derived), `fatherName`, `motherName`, `dateOfBirth`, `classLevel` (ten fixed values, 5th–12th with the three 12th-class streams), `schoolName`, `address`, plus the existing mobile / email / password. A **mandatory photo** (≤2 MB, JPEG/PNG/WebP, magic-byte checked) is stored in the new `StudentPhoto` collection and served by `GET /students/:studentId/photo`, readable by the student themselves or by staff holding `students:read`. The admin table shows photo, class and school.
- **Student profile and account settings (Milestone 5)** — `/profile` is real end-to-end. A student can edit their nine descriptive registration fields (`fullName` re-derived server-side), replace their photo, and change their password. `email` and `mobile` are read-only and **absent from the update schema**, not merely filtered: they are the login identifiers and `email` anchors password reset, so changing one needs a confirm-at-the-new-address flow that does not exist yet. Self-service changes are written to the audit trail, naming the changed field names and never their values.
- **Progress: XP, levels, streaks, achievements (Milestone 5)** — real and **derived, never stored**. `StudentActivity` is an append-only log of real events; XP is a `$sum` over it, the level a pure function of the XP, the streak computed from the distinct days it contains. Once-per-day and once-per-account are enforced by a **partial unique index**, so concurrent requests cannot both earn the same event. A day is an **IST** calendar day. Eight achievements are evaluated from real facts on every read, with real progress toward the locked ones — and deliberately none that exam data would be needed to satisfy.
- **Student dashboard (Milestone 5)** — one request (`GET /me/dashboard`) supplies progress, activity, test performance, achievements, leaderboard-with-own-rank and available practice. No constant remains on the page. Loading, error and per-panel empty states throughout.
- **Real leaderboard and public figures (Milestone 5)** — `GET /leaderboard` aggregates actual XP with standard competition ranking, excludes accounts not in good standing, and leaves a zero-XP student genuinely unranked. Public by the owner's decision, so it publishes a first name plus a last initial only. `GET /public/stats` gives the landing page real counts. Both replaced hardcoded mocks.
- **Real daily challenge (Milestone 5)** — a deterministic published question for the caller's class, answer-stripped through the shared `studentQuestionView`, and now authenticated where the mock was open.
- **Backend test suite** — **306 passing tests** across 12 files, against a real in-memory MongoDB wherever a database is needed: 55 dashboard/progress and 27 profile tests (Milestone 5), 77 question-bank tests (Milestone 4), 62 RBAC / privilege-escalation tests (Milestone 3), 40 registration-detail tests, and 32 auth integration tests (Milestone 2). Test files run **sequentially** — see [`TESTING.md`](TESTING.md).

## Partially Completed Modules

- **Student analytics** — real model + route, but falls back to hardcoded demo data because nothing ever creates a `StudentAnalytics` document. Every real student sees only the fallback. Its *authorization* is now real and tested (own record vs. anyone's record).
- **Admin dashboard** — the account figures and recent-registration list are real; the weekly-accuracy chart is still sample data, now labelled as such in the UI because no exam results exist to chart.
- **AI insights** — real rule-based logic (not ML), reachable only on the currently-unpopulated real-data path.

## Pending / Not Started Modules (UI exists, no real backend wiring)

- **Exam / exam attempts** — still a client-side hardcoded 5-question quiz; nothing submitted. `ExamAttempt` model unused. **Both halves it needs now exist**: a published, filterable question bank to build a paper from (`GET /questions`, answer-stripped) and a dashboard panel already querying for its results. Wiring it up is the obvious next milestone. Note the model predates Milestone 4 and needs rewriting, not just wiring — see [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md).
- **Results** — fabricated client-side by hashing the entered Student ID. `Result` model unused, and also the wrong shape (a free-text `examId` with no exam entity behind it).
- **Certificates** — rendered client-side from the logged-in student's name/ID. `GET /certificates/:studentId` is **the last static mock left in the backend**, and is called by nothing.
- **Payments** — static QR image; no gateway, no verification, no transaction record. Registration still proceeds on a self-reported "I've paid" click.
- **Mobile/SMS verification** — deliberately dropped. The fake client-side OTP step was **deleted**; email verification replaces it. No SMS provider is integrated.
- **Practice zone / Mock tests / Journey map / Gallery / Notifications / Subscriptions** — not started. (XP, Levels, Badges-as-Achievements, Streaks and the Leaderboard left this list in Milestone 5.)
- **Changing your own email address or mobile number** — not possible. Everything else on a student's record is now editable by its owner; these two are excluded on purpose, because changing a login identifier safely needs a confirm-at-the-new-address flow (see [`DECISIONS.md`](DECISIONS.md)). The profile page says so rather than offering a field that would fail.
- **A dedicated Hall of Fame page** — the Landing page's public standing is now real, but there is no page for a past competition's results, which needs results to exist first.
- **Account deletion** — deliberately not built; deactivation is the reversible equivalent.

## Current Frontend State

React 19 SPA, **15 routes** (Milestone 5 added `/profile`, under `ProtectedRoute`; Milestone 3 added `/admin/users` and `/admin/audit-log`). The **Dashboard** is a real data view — one `GET /me/dashboard` call supplies every figure, with loading, error and per-panel empty states, and no hardcoded constant left on the page. The new **Profile** page reads `GET /me/profile` and offers editing, photo replacement and password change; a successful photo upload appends a changing `?v=` so the browser does not keep showing the cached previous image for five minutes. The **Landing** page's headline figures and champions list are fed by `GET /public/stats` and `GET /leaderboard`, and both degrade to an honest empty state rather than blocking the registration form if the API is unreachable. A small shared `src/lib/photo.ts` holds the client-side photo limits. The registration wizard on the landing page collects 13 fields grouped into *Student details* / *Photo* / *Contact & sign-in*, marks every required one with a red `*`, previews the chosen photo, and refuses an oversized or wrong-type file — and each missing field by name — before submitting. All API access flows through `frontend/src/api/client.ts`, which prefixes `API_BASE = '/api/v1'` and transparently refreshes an expired access token once before retrying, de-duplicating concurrent refreshes through a single shared promise. `AuthContext` exposes register / login / logout / logout-everywhere / verify / resend / forgot / reset, plus `role`, `permissions` and `can(permission)` — all supplied by the backend, so the UI keeps no copy of the authorization rules. `status` records only *which kind of account* is signed in (a student record, or the root admin); it must never be used to decide whether something administrative is allowed. Route guards are `ProtectedRoute` (student account) and `RequirePermission` (capability), the latter rendering an `Unauthorized` state for a signed-in user rather than silently redirecting. Administrative pages share an `AdminShell` whose sidebar is filtered by permission. Verified: `oxlint` passes (one pre-existing fast-refresh warning), `tsc -b && vite build` succeeds, and every flow was driven through a real browser with no console errors.

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
lib/mathContent.ts        LaTeX grammar + dangerous-command rejection
lib/slug.ts               name -> stable handle
lib/serviceError.ts       maps a thrown ApiError to the response envelope
lib/session.ts            session cookies + access-token claims (Milestone 5)
lib/xp.ts                 XP award table + level function (Milestone 5)
lib/achievements.ts       achievement catalogue, evaluated from real facts (M5)
lib/competitionDay.ts     the IST day boundary streaks are measured in (M5)
services/                 question + taxonomy rules (M4);
                          activity, progress + challenge derivation (M5);
                          questionView (the shared answer-stripped projection)
lib/audit.ts              audit-trail recorder (Milestone 3)
middleware/               auth (authenticate/requireAuth/requirePermission),
                          validate, errorHandler, rateLimiter,
                          requestLogger, ensureDb
models/                   12 models, one file each (+ StudentActivity)
routes/health.routes.ts   /health, /ready
routes/v1/                auth (12 routes), me (6 own-account routes, M5),
                          analytics, questions (student reads),
                          questionsAdmin (6 CRUD routes), taxonomy (6 routes),
                          admin, users (5 admin/audit routes),
                          misc (public stats + leaderboard, now real)
validation/               zod schemas for auth + questions + taxonomy + users
                          + profile/settings (Milestone 5)
scripts/                  dev-local, verify-email, migrate-questions,
                          backfill-activity (Milestone 5)
tests/                    12 suites, 306 tests
```

`ExamAttempt` and `Result` remain defined and unwritten — but `ExamAttempt` is now **read** by the dashboard's test-performance panel, so it stops being dead the moment anything writes to it. Exactly **one** static mock is left in the backend: `GET /certificates/:studentId`, which nothing calls. `GET /questions` is real and authenticated but **still has no student-page caller** — the exam is a hardcoded quiz; the daily-challenge route is the first thing to serve a real question to a student.

## Current Database State

MongoDB via Mongoose, **12 models**: `Student` (with `role` and the nine registration fields), `StudentPhoto`, `ExamAttempt`, `Result`, `StudentAnalytics`, `RefreshToken`, `VerificationToken`, `AuditLog`, Milestone 4's **`Subject`**, **`Topic`** and a rewritten **`Question`**, plus Milestone 5's **`StudentActivity`**. The two token collections store only SHA-256 hashes and carry TTL indexes; `AuditLog` and `StudentActivity` deliberately have **no** TTL — expiring a row would take XP away from a student who earned it. Unique indexes on `Student.mobile`, `Student.email`, `Student.studentId` and `StudentPhoto.student`; a non-unique index on `Student.role`; and a **partial unique** index on `StudentActivity` `{student, type, dedupeKey}` (partial on `dedupeKey` existing), which is what makes "once per day" and "once per account" true rather than merely intended.

**No progress or leaderboard collection exists, on purpose.** XP, levels, streaks, achievements and the standing are all derived from `StudentActivity` on read — see the ADR in [`DECISIONS.md`](DECISIONS.md).

**Accounts created before Milestone 5 read as 0 XP with an empty feed**, because the activity log is written going forward. `backend/scripts/backfill-activity.ts` writes the enrolment rows they already earned; it is report-only by default and deliberately fabricates no streaks. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

**Photo storage is bounded by the database.** At 2 MB a photo, the Atlas free tier's 512 MB holds roughly **250 students** — enough for a first cohort, and the first thing that will force a paid tier or an image CDN.

**Atlas connectivity is still unverified from this development sandbox** (outbound raw DNS/TCP is blocked). Milestone 2 was instead verified against a real MongoDB run locally on port 27017, which exercised the same code paths, indexes and constraints. The owner must still confirm Atlas works from their machine — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Current Authentication State

Complete for students; deliberately simpler for the root administrator. Implemented: bcrypt password hashing, email verification, login by mobile or email, access/refresh token split with rotation and theft detection, revocation (per-device and everywhere), password reset that revokes all sessions, account status (`active`/`suspended`/`deactivated`), failed-login lockout, per-endpoint rate limiting, and no account enumeration on login, forgot-password or resend-verification.

Milestone 3 added the authorization half: three roles, one permission table, `requirePermission` gates, database-fresh role checks on privileged requests, and immediate session revocation on role change or suspension. Admin accounts are now real database accounts and reuse everything above.

Milestone 5 added a **self-service password change** (`POST /me/change-password`). It requires the current password even though the caller already holds a session — otherwise a borrowed session could lock the real owner out. It revokes every other session and re-issues one for the calling device, so the student is not signed out of the page they are standing on, and a wrong guess deliberately does **not** touch the lockout counter. The session-cookie helpers moved to `lib/session.ts` so this route and the auth routes share one definition.

Still missing: CSRF tokens (see [`SECURITY.md`](SECURITY.md)) — now with student-facing state-mutating routes to protect as well as administrative ones — two-factor auth, and any way for a student to change their own email address or mobile number (excluded on purpose; see [`DECISIONS.md`](DECISIONS.md)).

## Current Payment State

None. No provider selected, no code. Static QR image only, with no link to the registration transaction — registration completes regardless of whether payment happened.

## Current Deployment State

Two independent Vercel projects, unchanged in structure. `backend/api/index.ts` imports the app from `src/app.ts`; the per-request `ensureDb` middleware is what makes the serverless path connect at all.

**Deployment ordering matters**: deploy the backend before the frontend, since the frontend calls `/api/v1/*`. Milestone 2 adds a second requirement: **set the SMTP and `FRONTEND_URL` env vars before students register in production**, or verification emails will not be delivered (they will only be written to the server log) and their links will point at the wrong host.

Milestone 5 adds **no new environment variables**, and student sessions survive the deploy (no cookie names changed). It does add **one optional post-deploy step**: run `npx tsx scripts/backfill-activity.ts --write` so accounts that predate it show the enrolment XP they already earned rather than a blank dashboard. Skipping it is safe — those students simply start from zero and accrue normally from their next visit.

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
| **Own-account routes (profile, settings, dashboard)** | [backend/src/routes/v1/me.routes.ts](backend/src/routes/v1/me.routes.ts) |
| **XP awards + level thresholds** | [backend/src/lib/xp.ts](backend/src/lib/xp.ts) |
| **Achievement catalogue** | [backend/src/lib/achievements.ts](backend/src/lib/achievements.ts) |
| The IST day boundary streaks are measured in | [backend/src/lib/competitionDay.ts](backend/src/lib/competitionDay.ts) |
| Activity log writer (the only place XP is awarded) | [backend/src/services/activityService.ts](backend/src/services/activityService.ts) |
| XP / streak / leaderboard derivation | [backend/src/services/progressService.ts](backend/src/services/progressService.ts) |
| Practice availability + daily challenge | [backend/src/services/challengeService.ts](backend/src/services/challengeService.ts) |
| Shared answer-stripped question projection | [backend/src/services/questionView.ts](backend/src/services/questionView.ts) |
| Session cookie helpers | [backend/src/lib/session.ts](backend/src/lib/session.ts) |
| Profile / settings validation | [backend/src/validation/profileSchemas.ts](backend/src/validation/profileSchemas.ts) |
| Profile + dashboard tests | [backend/tests/profile.test.ts](backend/tests/profile.test.ts), [backend/tests/dashboard.test.ts](backend/tests/dashboard.test.ts) |
| Student profile page | [frontend/src/pages/Profile/Profile.tsx](frontend/src/pages/Profile/Profile.tsx) |
| Student dashboard (all real data) | [frontend/src/pages/Dashboard/Dashboard.tsx](frontend/src/pages/Dashboard/Dashboard.tsx) |
| Frontend API client (auto-refresh) | [frontend/src/api/client.ts](frontend/src/api/client.ts) |
| Session/auth state | [frontend/src/context/AuthContext.tsx](frontend/src/context/AuthContext.tsx) |
| New auth pages | [frontend/src/pages/Auth/](frontend/src/pages/Auth/) |
| Frontend route guards + unauthorized state | [frontend/src/components/ProtectedRoute.tsx](frontend/src/components/ProtectedRoute.tsx), [frontend/src/components/Unauthorized.tsx](frontend/src/components/Unauthorized.tsx) |
| Admin shell + permission-aware nav | [frontend/src/pages/Admin/AdminShell.tsx](frontend/src/pages/Admin/AdminShell.tsx) |
| Admin user management / audit pages | [frontend/src/pages/Admin/Users.tsx](frontend/src/pages/Admin/Users.tsx), [frontend/src/pages/Admin/AuditLog.tsx](frontend/src/pages/Admin/AuditLog.tsx) |
| Dev server config | [.claude/launch.json](.claude/launch.json) |

## Current Environment Requirements

Milestones 3, 4 and 5 added **no new environment variables**. `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` keep their meaning but define the **root `superadmin`** rather than "the admin".

Backend: `MONGO_URI`, `JWT_SECRET` (mandatory in production), `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `FRONTEND_URL` (also the base for emailed links), and the SMTP group (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM`). Optional policy knobs: `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `ADMIN_TOKEN_TTL`, `REQUIRE_EMAIL_VERIFICATION`, `MAX_FAILED_LOGINS`, `ACCOUNT_LOCK_MINUTES`. Frontend: none. Full detail in [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

**SMTP now appears to be configured.** During Milestone 5 verification, a registration against a local database sent a **real email** through the SMTP settings in `backend/.env` (the log said "Email sent", not the "SMTP unconfigured" fallback), so `SMTP_HOST`/`PORT`/`USER`/`PASS`/`SECURE` and `EMAIL_FROM` all hold values. This corrects the previous note in this file, which said SMTP was outstanding.

Two caveats, since only the *send* was observed and not the delivery: nobody has confirmed a message actually arrives in a real inbox, and **`npm run dev:local` does not stop mail going out** — it overrides `MONGO_URI` but not the SMTP group, so a local registration to a made-up address emails a stranger or bounces against the owner's quota. Prefer `REQUIRE_EMAIL_VERIFICATION=false` for local work, or clear `SMTP_HOST` in the environment for that run. Use `npm run verify:email --prefix backend` to check delivery deliberately.

## Known Bugs

0. **Existing student documents predate `role`** — but harmlessly. Unlike the `email` problem below, `role` is optional with a schema default, so an old document simply reads as `role: 'student'` and needs no backfill. Worth knowing when reading a raw document that has no `role` field.
1. **Existing student documents predate `email`.** `email` is now required and unique, so any `Student` created before Milestone 2 lacks it and will fail validation the next time it is saved. Reads still work. There is no migration script. If the Atlas database holds real students, they must be given addresses (or removed) before they can log in — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
2. **Analytics never persisted** — `generateAIInsights()` mutates `aiInsights` in memory and never saves. Harmless only because the real-data branch is unreachable.
3. **Half-dead models** — `Result` is defined but untouched by any route. `ExamAttempt` is now **read** by the dashboard's test-performance panel but still written by nothing, so that panel is correctly empty. Both also predate Milestone 4 and are the wrong shape for the current `Question` (see [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)) — whoever builds exam submission is rewriting them, not wiring them.
4. **`/api/v1/auth/me` returns 503 when the database is unreachable** for account-backed callers (the root admin answers from the token alone). The frontend treats any failure as "guest", so behaviour is correct, but the status is broader than ideal.
5. **Privileged routes need the database to authorize.** Because the role is re-read per privileged request, an administrator sees **503** rather than 403 while MongoDB is down. This is deliberate (see [`DECISIONS.md`](DECISIONS.md)) — correctness over availability on admin endpoints — but it does mean the admin panel is unusable during a database outage.
6. **The root `superadmin` cannot be managed from the app.** It has no document, so it cannot be suspended, demoted or listed under `/admin/users`; withdrawing it means changing the environment variables and redeploying.
7. **No rate limit specific to the admin routes.** They sit behind the general `/api` limiter only.
8. **Photos are stored as uploaded** — not re-encoded and not stripped of metadata, so EXIF (including any GPS tags a phone wrote) is kept and served back to staff. Still true of the Milestone 5 replacement route, which reuses the same validation. Re-encoding through an image library would fix it; see [`SECURITY.md`](SECURITY.md).
9. **A photo cannot be *removed*, only replaced.** `PUT /me/photo` (Milestone 5) fixed the replacement half; deletion is deliberately not offered, because the photo is a required part of an entrant's record and "no photo" is a state registration cannot produce.
10. **Pre-Milestone-4 `Question` documents are unreadable** and must be deleted — `subject` changed from `String` to `ObjectId`, which is a cast error on read, not a tolerable missing field. Run `npx tsx scripts/migrate-questions.ts` (add `--delete`). All such documents are old template placeholders; nothing references them.
11. **No question-bank rate limit of its own.** Authoring routes sit behind the general `/api` limiter, like the other admin routes. (The Milestone 5 self-service routes *do* have one.)
12. **Question images are not supported.** A question is text plus LaTeX only, so a geometry diagram cannot be attached. Registration photos proved the storage pattern; nothing reuses it yet.
13. **Accounts created before Milestone 5 read as 0 XP with an empty activity feed**, because the activity log is written going forward. Not data loss — nothing was ever stored to lose. Fixed by running `npx tsx scripts/backfill-activity.ts --write`; see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
14. **A lost activity write silently costs XP.** `recordActivity()` never throws, by design, so a failed log write cannot fail the registration or password change it describes — but the student is quietly one event's XP short, visible only as an `error` log line. The alternative (failing the user's action because of a logging failure) is worse; the trade-off is recorded in [`DECISIONS.md`](DECISIONS.md).
15. **The leaderboard aggregates the whole activity collection on every request.** Correct at the scale this product is designed for (a few hundred students; photo storage caps it near 250) and isolated in `leaderboardPipeline()`, but it is the first query that will need a cache if the field grows an order of magnitude.
16. **XP currently measures consistency, not ability.** With no exam data, the only repeatable source is the daily visit, so the top of the leaderboard is whoever shows up most. That is honest, but worth telling entrants before the competition runs — and it resolves itself when exam scoring lands.

Fixed in Milestone 5: no way to edit your own details after registering; no way to replace a photo (bug #9's replacement half); the invented dashboard stat tiles and fake leaderboard; the invented landing-page figures and champions; the hardcoded `daily-challenge` and `leaderboard` mocks; and `optionalName` rejecting an explicit `null`, which made "remove my middle name" a 400.

Fixed in Milestone 4: `GET /questions` being **unauthenticated and returning the answer key**; `correctAnswer` stored as literal option text (so editing a typo invalidated recorded answers); `Question` having no `topic` field despite the generator asking for one; subjects and topics existing only as free-text strings; and the template generator being able to invent taxonomy nothing else knew about.

Fixed in Milestone 3: the absent admin tooling for account status, the inline role checks scattered across handlers, the analytics route's role comparison, the 15-minute window in which a demoted admin kept working, and `logout-all` being unusable by a non-student role.

Fixed in Milestone 2: the `studentId` collision risk (now uniquely indexed with retry-on-collision), the absent password reset, the absent email verification, and the inability to revoke a session.

## Technical Debt

- **Staff accounts are `Student` documents.** A promoted admin lives in the `Student` collection with `role: 'admin'`, so the model name is now narrower than what it stores. Renaming it needs a migration and was out of scope — see [`DECISIONS.md`](DECISIONS.md).
- `Result` still unused, and `ExamAttempt` read-but-never-written; both are also the wrong shape for the post-Milestone-4 `Question`.
- No migration tooling — the `email` backfill above has to be done by hand. There are now two ad-hoc scripts (`migrate-questions.ts`, `backfill-activity.ts`), which is the point at which a real migration runner starts to be worth it.
- **The leaderboard and progress aggregations are uncached**, deliberately, in exchange for having no counter that can drift. `leaderboardPipeline()` is the single place to add a materialised standing when the cohort outgrows it.
- The frontend mirrors the activity type names, their labels and the class list in `api/types.ts`. As with the permission names, the *rules* are not duplicated — only the labels — but adding an activity type means touching two places.
- `frontend/src/lib/` now exists (one file, `photo.ts`) with no stated convention in `CLAUDE.md` for what belongs there versus `components/`.
- Hardcoded production backend URL inside `frontend/vercel.json`.
- Mixed English/Hindi error strings are now gone from the auth routes, but `PROJECT_STATE`-era Hinglish may remain elsewhere; no deliberate localisation decision has been made.
- No CI pipeline; verification commands are run manually.
- No CSRF token mechanism (production cookies are `sameSite: 'none'` because the apps are on different domains).
- No frontend test suite at all — so the route guards, permission-aware navigation and unauthorized states are verified only by hand in a browser.
- **Two parsers implement the LaTeX grammar** — `backend/src/lib/mathContent.ts` and `frontend/src/components/MathText.tsx`. Both are deliberately a single left-to-right scan with no nesting so they can be checked against each other by reading them, and they differ in one intended way (the frontend renders an unclosed delimiter as literal text so a half-typed formula still previews). A change to one must be mirrored.
- The frontend mirrors the *names* of the permissions as a TypeScript union in `api/types.ts`. The mapping is not duplicated (it comes from the server), but adding a permission means adding its name in two places.
- The unversioned `/api/*` alias should eventually be removed.
- Pre-existing `npm audit` findings in `@vercel/node`'s build-time dependency tree.

## Immediate Next Task

**Owner actions, in this order:**

1. **Confirm an email actually arrives.** SMTP is configured (see "Current Environment Requirements"), but delivery to a real inbox has never been observed — only that the backend reported sending. Run `npm run verify:email --prefix backend` and check the inbox. This gates everything else, because login requires verification and admin promotion requires a verified account.
2. **Two deploy-time database steps**, both safe to run in report-only mode first:
   - `npx tsx scripts/migrate-questions.ts --delete` — removes pre-Milestone-4 question documents, which the current model cannot read at all. Until then the admin question list errors on any of them.
   - `npx tsx scripts/backfill-activity.ts --write` — gives accounts that predate Milestone 5 the enrolment XP they already earned, so their new dashboard is not blank. Both are idempotent; see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
3. **Decide whether the public leaderboard should show full names.** It currently publishes a first name and a last initial, because the entrants are minors and the landing page is public. If a national competition is expected to name its leaders in full, that is a one-line change in `displayNameFor()` — but it should be a deliberate choice, not a default.

**Owner decision: Milestone 6.** The strongest candidate is unchanged and now more strongly supported: **exam submission → `ExamAttempt` → real results**.

- Its supply side arrived in Milestone 4 (a published, class-and-topic-filtered bank behind an answer-stripping endpoint) and its *demand* side arrived in Milestone 5: the dashboard's test-performance panel, the analytics real-data branch, and the XP system are all already wired and waiting, so submission lights up three surfaces at once rather than needing new UI for each.
- It is the only path that makes XP a measure of ability rather than attendance, which is the one substantive caveat left on the leaderboard.
- It converts the three remaining mock surfaces (Exam, Results, Certificates) in one dependency chain, and needs no external account or spend.
- Be aware it is a **rewrite** of `ExamAttempt` and `Result`, not a wiring job — both predate the Milestone 4 `Question` and neither references it correctly. Read the note at the end of [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) first.

The alternative remains the payment gateway — the only thing between the current flow and collecting real money — but it needs a provider decision and cost approval, so it cannot start without the owner.

Smaller follow-ups worth doing either way: **CSRF tokens** (still the top security gap, and now with student-facing state-mutating routes to protect as well as administrative ones), a tighter rate limit on the admin routes, a way to change your own email address or mobile number behind a confirm-at-the-new-address flow, and re-encoding uploaded photos to strip EXIF.

## Recent Architectural Decisions

See [`DECISIONS.md`](DECISIONS.md). Milestone 5 added six ADRs: XP/levels/streaks derived from an activity log rather than stored as counters; XP earned only from events that really happen, so the sources are deliberately few; the competition day defined as an IST calendar day; self-service editing excluding the email address and mobile number; the public leaderboard publishing a first name and last initial; and a student's own edit of their account being written to the administrative audit trail.

Milestone 3 added four: three roles with the env account as `superadmin` and admins promoted from existing accounts; permission-based authorization held in one table; privileged requests re-reading the role from the database; and an audit trail that records refusals and never expires.

Milestone 2 added six: the access/refresh token split, login by mobile-or-email, verification-before-login, SMTP via nodemailer with a log fallback, admins having no refresh token, and adopting a real in-memory MongoDB for integration tests (superseding the Milestone 1 decision against it).
