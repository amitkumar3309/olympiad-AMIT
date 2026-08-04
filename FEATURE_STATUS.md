# FEATURE_STATUS.md

Status values: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED` (works end-to-end, verified by reading the actual data path — not just "a page exists"), `TESTED` (has automated test coverage), `DEPLOYED` (live in production).

A UI page existing with hardcoded/mock data is recorded as its own row/note — it does **not** count as `IMPLEMENTED` for the underlying feature.

**Infrastructure rows** (below the feature table) track the Milestone 1 backend foundation separately, since those are cross-cutting capabilities rather than user-facing features.

_Last updated: 2026-08-05, after Milestone 3. RBAC, student/admin account management and audit logging moved from not-started to implemented and tested. The exam/results/certificates/leaderboard surfaces are **unchanged** and still mock._

| Feature | Frontend | Backend | Database | Testing | Notes |
|---|---|---|---|---|---|
| Registration | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | Real end-to-end: form (now incl. email) → `/api/v1/auth/register` → `Student` doc → verification email. Issues **no session** — the student must verify first. Unique `mobile`/`email`/`studentId`, bcrypt cost 12, rate limited 10/hour. The fake OTP step was **deleted**. Covered by real-database integration tests. |
| Login | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | `/api/v1/auth/login` accepts **mobile or email**. bcrypt compare, access + refresh cookies, account-status and verification gates, lockout after 5 failures (423), no account enumeration. Fully covered by integration tests. |
| Logout | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | `/auth/logout` revokes the presented refresh token server-side (other devices stay signed in); `/auth/logout-all` revokes every session and bumps `tokenVersion`. Both tested. |
| Email verification | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | Real single-use, hashed, 24h token emailed via SMTP (`nodemailer`); `/verify-email` page + `/auth/resend-verification`. **Login is blocked until verified.** `VerificationToken` collection with TTL. **Owner action outstanding: SMTP not yet configured**, so emails are currently only written to the server log. |
| Forgot password | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | `/forgot-password` page → `POST /auth/forgot-password`, emails a single-use 30-minute hashed token. Always returns an identical generic response so accounts cannot be enumerated (asserted by test). Rate limited 5/hour. |
| Reset password | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | `/reset-password?token=` page → `POST /auth/reset-password`. Single-use token, revokes **every** session, bumps `tokenVersion`, clears lockout, marks the email verified. Tested incl. reuse and expiry. |
| Student profile | NOT_STARTED | NOT_STARTED | IMPLEMENTED | NOT_STARTED | `Student` now also stores `role`, exposed read-only via `/auth/me` alongside the effective permission list. An **administrator** can now view any account in full (`GET /admin/students/:studentId`). Still **no self-service profile page and no way for a student to edit anything** — that remains the gap. |
| Admin authentication | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | Two routes now. The env-configured **root** account (`POST /auth/admin/login`) holds `superadmin`, gets an 8h access token and **no refresh token** (no DB record to anchor a family to). **Promoted** admins are ordinary accounts with `role: 'admin'` and sign in through the normal `POST /auth/login`, inheriting lockout, verification, rotation and password reset. Both paths covered by `rbac.test.ts`. |
| RBAC | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | **Rebuilt in Milestone 3.** Three roles (`student`/`admin`/`superadmin`) and nine named permissions in one table (`lib/permissions.ts`); routes declare a permission via `requirePermission`, never a role. Privileged requests re-read the role from the database, so demotion/suspension bites immediately instead of at token expiry. Frontend guards and navigation are driven by the permission list the server sends. 61 tests drive escalation attempts directly at the API. |
| Student dashboard | IN_PROGRESS | NOT_STARTED | N/A | NOT_STARTED | Page exists (`Dashboard.tsx`), shows real logged-in student name/ID, but leaderboard + stat tiles are hardcoded constants, not fetched. |
| Admin dashboard | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | `Admin.tsx` now shows **real** figures — total accounts, administrator accounts, suspended accounts and the most recent registrations — all counted by `GET /admin/students`. The 4 fake student rows are gone. Sits in a shared `AdminShell` whose sidebar is permission-aware. The weekly-accuracy chart is still sample data and is now **labelled as such**, because no exam results are recorded anywhere yet. |
| Student management | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | `/admin/users` page: real paginated listing with search (literal, regex-escaped) and status/role filters, plus suspend / deactivate / reactivate and — for a super admin only — grant/revoke admin. Loading, error and empty states included. Backed by `GET /admin/students`, `GET /admin/students/:studentId`, `PATCH .../status`, `PATCH /admin/users/:studentId/role`. Suspension and role change end the target's live sessions immediately. **No delete route** — deliberately out of scope, deactivation is the reversible equivalent. |
| Question bank | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | IN_PROGRESS | `GET /api/v1/questions` reads real `Question` docs, with query params now validated by zod (rejects bad enums and repeated-key arrays). Questions are created only via the AI generator route. No manual question CRUD UI. |
| Subjects | NOT_STARTED | IN_PROGRESS | IN_PROGRESS | NOT_STARTED | `subject` is a free-text field on `Question`, no dedicated Subject model/list/admin UI. |
| Topics | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No `topic` field persisted on `Question` at all (the generator takes a `topic` input but never saves it to the schema). |
| Daily challenge | NOT_STARTED | IN_PROGRESS | NOT_STARTED | NOT_STARTED | `GET /api/daily-challenge` returns a hardcoded object, no model, **not called by any frontend page**. |
| Practice zone | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No route, no page. |
| Mock tests | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Distinct from "Exam" below; not present at all. |
| Attempts (exam) | IN_PROGRESS | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `Exam.tsx` is a fully client-side 5-question hardcoded quiz; nothing is ever sent to the server. `ExamAttempt` model exists but no route reads/writes it. |
| Results | IN_PROGRESS | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `Result.tsx` fabricates a deterministic fake result from a hash of the entered Student ID (`mockLookup`), entirely client-side. `Result` model exists but unused. |
| XP | NOT_STARTED | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `xpEarned` field exists on unused `Result` model; `rewardXP` appears in the hardcoded daily-challenge mock. No real accrual logic anywhere. |
| Levels | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Badges | NOT_STARTED | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `badges: [String]` field exists on unused `Result` model; UI shows static badge strings on the Landing page champions list only. |
| Achievements | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Journey map | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Leaderboards | IN_PROGRESS | IN_PROGRESS | NOT_STARTED | NOT_STARTED | `GET /api/leaderboard` returns a hardcoded array with no model backing it; frontend never calls it (uses its own separate hardcoded arrays instead). |
| Certificates | IN_PROGRESS | IN_PROGRESS | NOT_STARTED | NOT_STARTED | `Certificate.tsx` renders a printable certificate client-side from the logged-in student's real name/ID (no server-issued cert data). `GET /api/certificates/:studentId` returns an unrelated hardcoded mock array and is never called by the frontend. |
| Notifications | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Gallery | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Hall of Fame | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | The Landing page "Today's Champions" section is the closest analog, entirely hardcoded, no dedicated page. |
| Analytics | IN_PROGRESS | IMPLEMENTED | IMPLEMENTED | TESTED (authorization only) | Route + model are real, but nothing in the app ever creates a `StudentAnalytics` document, so real students only ever see the built-in mock fallback. Milestone 3 replaced its inline role check with `analytics:read:self` + a fresh `analytics:read:any` check, so cross-account reads are now permission-based and tested (own record, another student's record, admin reading any, demoted admin refused). See AI performance analytics. |
| AI performance analytics | IN_PROGRESS | IMPLEMENTED | IMPLEMENTED | NOT_STARTED | `generateAIInsights()` is real rule-based logic (not an LLM/ML call), runs only on the (currently unreachable) real-data path. The "AI Question Generator" is a template-string generator, not a call to any AI model/API — no AI provider is integrated anywhere in the codebase despite the naming. |
| Payments | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Static QR code image only; no gateway, no order/transaction record, no verification before registration completes. |
| Subscriptions | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not applicable yet — one-time registration only. |
| Settings | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No account settings page for student or admin. (Administrators can change *other* accounts' status and role via `/admin/users`; nobody can edit their own profile anywhere.) |
| Audit logs | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | TESTED | `AuditLog` collection + `/admin/audit-log` page (filter by action and outcome, paginated). Records role changes, status changes, question generation, administrative sign-ins, **and refused privileged requests** with the exact missing permission — a run of those is what an escalation attempt looks like. No TTL: the trail does not expire. Best-effort writes, so a failed audit write never fails the action it describes. |
| Security (baseline hardening) | N/A | IMPLEMENTED | IMPLEMENTED | IN_PROGRESS | Milestone 1 headers/CORS/validation; Milestone 2 token rotation with theft detection, hashed token storage, single-use email tokens, bcrypt cost 12, per-endpoint rate limits, account lockout, no enumeration; Milestone 3 permission-based authorization with database-fresh role checks, immediate session revocation on demotion/suspension, regex-escaped admin search, and an audit trail that records refusals. Rate limiting, headers and CORS are still not asserted by tests. **CSRF remains the top open gap**, and matters more now that real state-mutating admin routes exist — see [`SECURITY.md`](SECURITY.md). |
| Deployment | IMPLEMENTED | IMPLEMENTED | N/A | NOT_STARTED | Both apps have working Vercel configs; production builds verified locally. **Deploy the backend before the frontend.** Milestone 2 adds two prerequisites: set the `SMTP_*` vars (or students get no verification email) and set `FRONTEND_URL` (or emailed links point at localhost). Deploying also **signs everyone out**, because the cookie names changed. Not verified live. |

## Infrastructure / foundation (Milestone 1)

These are backend capabilities, not user-facing features. `TESTED` here means covered by `backend/tests/`.

| Capability | Status | Testing | Notes |
|---|---|---|---|
| Modular backend structure | IMPLEMENTED | N/A | `config/`, `db/`, `lib/`, `middleware/`, `models/`, `routes/v1/`, `validation/`; `app.ts` builds the app, `server.ts` bootstraps the process. |
| Environment validation | IMPLEMENTED | NOT_STARTED | zod schema in `config/env.ts`; loads `.env` via dotenv (skipped under `NODE_ENV=test` to keep tests hermetic). Production throws if `JWT_SECRET` is unset. |
| Application configuration | IMPLEMENTED | NOT_STARTED | Typed `config` object in `config/index.ts`; nothing else reads `process.env` directly. |
| MongoDB connection module | IMPLEMENTED | NOT_STARTED | `db/connection.ts` — cached/de-duplicated connect, explicit 8s server-selection timeout, state helpers. Live Atlas connectivity **unverified from the dev sandbox**. |
| Per-request DB gate | IMPLEMENTED | IN_PROGRESS | `middleware/ensureDb.ts` — required because the Vercel serverless entry imports the app directly and never runs `server.ts`. Returns 503 when the DB is unreachable. Verified manually (clean 503 in 93ms); no unit test. |
| API versioning | IMPLEMENTED | TESTED | `/api/v1/*` canonical, `/api/*` compatibility alias; a test asserts both return the same status. Frontend migrated to `/api/v1`. |
| Global error handling | IMPLEMENTED | TESTED | `middleware/errorHandler.ts` + 404 handler; consistent `{success:false, error}` envelope, internals hidden in production. |
| Consistent API response structure | IMPLEMENTED | TESTED | `lib/apiResponse.ts` (`sendSuccess`/`sendError`) + `lib/ApiError.ts`. |
| Request validation architecture | IMPLEMENTED | TESTED | `middleware/validate.ts` with zod schemas per route. Uses `Object.defineProperty` because `req.query` is getter-only in Express 5. |
| Structured logging | IMPLEMENTED | NOT_STARTED | pino; pretty in dev, JSON in production, silent in tests. |
| Request logging | IMPLEMENTED | NOT_STARTED | `pino-http`, log level derived from response status. |
| Security headers | IMPLEMENTED | NOT_STARTED (deliberate) | `helmet` with defaults, `x-powered-by` disabled. |
| CORS configuration | IMPLEMENTED | NOT_STARTED (deliberate) | Explicit origin allow-list; never falls back to reflecting any origin. |
| Rate limiting | IMPLEMENTED | NOT_STARTED (deliberate) | `express-rate-limit`: general limiter on `/api`, stricter limiter on the three auth routes. `/health` + `/ready` mounted before it so probes are never throttled. |
| Health endpoint | IMPLEMENTED | TESTED | `GET /health` — liveness, no DB dependency. Verified live: 200. |
| Readiness endpoint | IMPLEMENTED | TESTED | `GET /ready` — 200 when Mongo is connected, 503 otherwise. Verified live: correctly reported 503 with the DB down. |
| Graceful shutdown | IMPLEMENTED | NOT_STARTED | SIGTERM/SIGINT close the HTTP server, then Mongo, with a 10s forced-exit fallback. Local bootstrap only (not the serverless path). |
| Development scripts | IMPLEMENTED | N/A | `dev` (tsx watch), `start`. |
| Production build scripts | IMPLEMENTED | N/A | `build` (`tsc -p tsconfig.json`) emits only `src`/`api` to `dist/`. |
| Type checking | IMPLEMENTED | N/A | `typecheck` (`tsc -p tsconfig.test.json`) covers src + api + tests. Passes. |
| Linting (backend) | IMPLEMENTED | N/A | `eslint` + `typescript-eslint` flat config. Passes clean. |
| Centralized authorization | IMPLEMENTED | TESTED | `lib/permissions.ts` holds the only role → permission table; `middleware/auth.ts` exposes `requirePermission` (the preferred gate), `requireAuth` (identity-only gates), `callerCan` and `callerCanFresh`. No handler compares a role to a literal. |
| Database-fresh role checks | IMPLEMENTED | TESTED | Privileged requests re-read `role`/`status`/`tokenVersion` from MongoDB, so the token's role claim cannot outlive a demotion. Student-level requests remain stateless. The env root admin is exempt (no document). |
| Audit trail | IMPLEMENTED | TESTED | `AuditLog` model + `lib/audit.ts` recorder + `GET /admin/audit-logs`. Records successes and refusals; no TTL; best-effort writes that never fail the underlying action. |
| Permission-aware frontend guards | IMPLEMENTED | NOT_STARTED (no frontend test suite) | `RequirePermission` route guard, `Unauthorized` state component, `can()` from `AuthContext`, permission-filtered navigation in `Navbar` and `AdminShell`. Verified manually in a browser, including client-side tampering attempts. |
| Backend testing foundation | IMPLEMENTED | TESTED | vitest + supertest, **105 passing tests** across 8 files. 61 are the Milestone 3 RBAC/privilege-escalation suite; 32 are Milestone 2 auth integration tests; the rest need no database. |
| Access / refresh token service | IMPLEMENTED | TESTED | `lib/tokens.ts` — 15-min access JWT with a `tv` revocation claim, plus opaque 30-day refresh tokens stored SHA-256-hashed and rotated on use, with family-wide revocation on reuse. |
| Session / token revocation | IMPLEMENTED | TESTED | Per-device (`logout`), everywhere (`logout-all`), and automatic on password reset, **role change and suspension** (Milestone 3). For privileged requests the 15-minute access-token window is no longer a gap: the role is re-read from the database, so a revoked admin is refused at once. |
| Password hashing | IMPLEMENTED | TESTED | `lib/password.ts`, bcrypt cost 12 (4 under test). `passwordHash` is `select: false` so it cannot leak. |
| Email delivery | IMPLEMENTED | IN_PROGRESS | `lib/email.ts` — `nodemailer` over SMTP (provider-agnostic), with a log transport when unset and an in-memory transport under test. Flow logic is tested; **real delivery is unverified and SMTP is not yet configured**. |
| Account status handling | IMPLEMENTED | TESTED | `active`/`suspended`/`deactivated`, enforced at login, on refresh, on every `/auth/me`, and on every privileged request. **Milestone 3 adds the admin UI** (`/admin/users`) — a direct database edit is no longer the only way to set it. Suspending revokes sessions immediately; reactivating clears the lockout counters. |
| Account lockout | IMPLEMENTED | TESTED | 5 failed logins → 15-minute lock, returning 423 even for the correct password. |
| Auth state restoration | IMPLEMENTED | NOT_STARTED | `AuthContext` tries `/auth/me`, then one `/auth/refresh`, before concluding "guest". Verified by a real browser reload, not by automated test. |
| Transparent token refresh (frontend) | IMPLEMENTED | NOT_STARTED | `api/client.ts` retries once after a 401, de-duplicating concurrent refreshes through a shared promise so rotation cannot trip theft detection. Verified manually. |

## Summary counts

- IMPLEMENTED end-to-end (user-facing): Registration, Email verification, Login, Logout, Forgot password, Reset password, Admin auth (root + promoted), RBAC, **Student management**, **Admin dashboard**, **Audit logs**, Question bank (read), Deployment config.
- TESTED against a real database: Registration, Email verification, Login, Logout/logout-all, Forgot password, Reset password, RBAC and privilege escalation, token revocation, account status, lockout, role assignment, audit logging, admin listing/filtering/search.
- Mostly mock/frontend-only despite a real-looking page: Student dashboard, Exam/Attempts, Results, Certificates, Leaderboards, Daily challenge, Analytics (fallback path). **Unchanged by Milestones 1–3** — the Admin dashboard left this list in Milestone 3.
- Not started at all: Student *self-service* profile editing, account deletion, Subjects/Topics as real entities, Practice zone, Mock tests, XP/Levels/Badges/Achievements/Journey map, Notifications, Gallery, Hall of Fame, Payments, Subscriptions, Settings, CSRF protection, two-factor auth.
- Deliberately dropped: SMS/mobile OTP verification. The fake client-side OTP step was deleted and replaced by real email verification; no SMS provider is integrated (it would also breach the ₹0 constraint).
- Deliberately out of scope in Milestone 3: hard-deleting an account (deactivation is the reversible equivalent), a second super admin via the API, and a frontend test suite (which needs a `DECISIONS.md` entry first).
- Nothing anywhere is marked `DEPLOYED` — no milestone has been deployed or verified in production.
