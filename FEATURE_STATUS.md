# FEATURE_STATUS.md

Status values: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED` (works end-to-end, verified by reading the actual data path — not just "a page exists"), `TESTED` (has automated test coverage), `DEPLOYED` (live in production).

A UI page existing with hardcoded/mock data is recorded as its own row/note — it does **not** count as `IMPLEMENTED` for the underlying feature.

**Infrastructure rows** (below the feature table) track the Milestone 1 backend foundation separately, since those are cross-cutting capabilities rather than user-facing features.

_Last updated: 2026-08-04, after Milestone 1. No user-facing feature moved from mock to real in that milestone — it was foundation work only._

| Feature | Frontend | Backend | Database | Testing | Notes |
|---|---|---|---|---|---|
| Registration | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | IN_PROGRESS | Real end-to-end: form → `/api/v1/auth/register` → `Student` doc → JWT cookie. Input now validated by a zod schema and rate limited. Tests cover the validation layer only, not a real DB round-trip. "OTP" step before it is fake (see Email verification). |
| Login | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | NOT_STARTED | `/api/v1/auth/login`, bcrypt compare, JWT cookie. Now validated + rate limited. No automated test of a successful login (needs a real DB). |
| Logout | IMPLEMENTED | IMPLEMENTED | N/A | NOT_STARTED | `/api/v1/auth/logout`, clears cookie. No DB access. |
| Email verification | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No email field on `Student` at all. "OTP" UI is a hardcoded client-side literal (`123456`), no SMS/email provider. |
| Forgot password | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No route, no UI. |
| Reset password | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Depends on Forgot password. |
| Student profile | NOT_STARTED | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `Student` model stores `fullName`/`mobile`/`studentId` only; no profile page/edit UI. |
| Admin authentication | IMPLEMENTED | IMPLEMENTED | N/A (env-based) | NOT_STARTED | Single admin account via `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` env vars, no admin registration flow (intentional). Now validated + rate limited. |
| RBAC | IMPLEMENTED | IMPLEMENTED | N/A | IN_PROGRESS | Two roles (`student`, `admin`) enforced via JWT payload + `requireAuth(...roles)`, now in `middleware/auth.ts`. A test asserts an unauthenticated request to a protected route gets 401. No finer-grained permissions. |
| Student dashboard | IN_PROGRESS | NOT_STARTED | N/A | NOT_STARTED | Page exists (`Dashboard.tsx`), shows real logged-in student name/ID, but leaderboard + stat tiles are hardcoded constants, not fetched. |
| Admin dashboard | IN_PROGRESS | NOT_STARTED | N/A | NOT_STARTED | Page exists (`Admin.tsx`), auth is real, but the students table and weekly-accuracy chart are hardcoded constants — no "list students" route exists. |
| Student management | NOT_STARTED | NOT_STARTED | N/A | NOT_STARTED | No route to list/search/edit/delete students. Table shown in Admin UI is 4 fake rows. |
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
| Analytics | IN_PROGRESS | IMPLEMENTED | IMPLEMENTED | NOT_STARTED | Route + model are real, but nothing in the app ever creates a `StudentAnalytics` document, so real students only ever see the built-in mock fallback. See AI performance analytics. |
| AI performance analytics | IN_PROGRESS | IMPLEMENTED | IMPLEMENTED | NOT_STARTED | `generateAIInsights()` is real rule-based logic (not an LLM/ML call), runs only on the (currently unreachable) real-data path. The "AI Question Generator" is a template-string generator, not a call to any AI model/API — no AI provider is integrated anywhere in the codebase despite the naming. |
| Payments | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Static QR code image only; no gateway, no order/transaction record, no verification before registration completes. |
| Subscriptions | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not applicable yet — one-time registration only. |
| Settings | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No account settings page for student or admin. |
| Audit logs | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No admin action logging. |
| Security (baseline hardening) | N/A | IMPLEMENTED | N/A | NOT_STARTED | Milestone 1 added `helmet`, an explicit CORS allow-list (no more reflect-any fallback), rate limiting on auth + general routes, zod request validation, and a production start-up failure when `JWT_SECRET` is unset. **Deliberately not automatically tested** at owner instruction — see [`TESTING.md`](TESTING.md). Still missing: CSRF tokens, account lockout. See [`SECURITY.md`](SECURITY.md). |
| Deployment | IMPLEMENTED | IMPLEMENTED | N/A | NOT_STARTED | Both apps have working Vercel configs; unchanged by Milestone 1 (the frontend's `/api/*` rewrite passes the `/v1` segment through). Production builds verified locally for both apps. **Deploy the backend before the frontend** — the frontend now calls `/api/v1`. Not verified live; owner should confirm both projects deploy and Atlas is reachable. |

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
| Backend testing foundation | IMPLEMENTED | TESTED | vitest + supertest, 12 passing tests, no real DB required. |

## Summary counts

- IMPLEMENTED end-to-end (user-facing): Registration, Login, Logout, Admin auth, RBAC, Question bank (read), Deployment config.
- IMPLEMENTED (infrastructure, Milestone 1): all rows in the table above.
- Mostly mock/frontend-only despite a real-looking page: Student dashboard, Admin dashboard, Exam/Attempts, Results, Certificates, Leaderboards, Daily challenge, Analytics (fallback path). **Unchanged by Milestone 1.**
- Not started at all: Email verification, Password reset, Student profile editing, Student management (admin CRUD), Subjects/Topics as real entities, Practice zone, Mock tests, XP/Levels/Badges/Achievements/Journey map, Notifications, Gallery, Hall of Fame, Payments, Subscriptions, Settings, Audit logs.
- Nothing anywhere is marked `DEPLOYED` — Milestone 1 has not been deployed or verified in production.
