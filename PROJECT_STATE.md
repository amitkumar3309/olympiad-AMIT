# PROJECT_STATE.md

_Last updated: 2026-08-04 (Milestone 1 — Backend & Database Foundation, implemented)._

This file is the current snapshot. History belongs in [`CHANGELOG.md`](CHANGELOG.md). If this file and the code disagree, trust the code and fix this file.

## Current Development Phase

**Milestone 1 — Backend and Database Foundation: implemented and verified locally.** The backend was refactored from a single 450-line file into a modular Express 5 + TypeScript application with environment validation, structured logging, a global error handler, a request-validation architecture, security middleware, health/readiness endpoints, graceful shutdown, and a working test suite.

Product features were deliberately **not** added in this milestone — no new business endpoints exist.

## Last Completed Milestone

**Milestone 1 — Backend and Database Foundation.** Preceded by Phase 0 (repository audit, commit `cc1399b`).

## Current Milestone

None in progress. Awaiting owner selection of Milestone 2 (see "Immediate Next Task").

## Completed Modules (real, end-to-end)

- **Backend foundation** — modular structure, env validation (zod, fail-closed on missing `JWT_SECRET` in production), typed config, MongoDB connection module with serverless-safe caching, structured logging (pino), request logging, global error handler + 404 handler, request validation middleware, `helmet`, explicit CORS allow-list, rate limiting, `/health` + `/ready`, graceful shutdown on SIGTERM/SIGINT.
- **API versioning** — all routes served at `/api/v1/*` (canonical) and `/api/*` (compatibility alias). The frontend now calls `/api/v1` via a single `API_BASE` constant.
- **Student registration / login / logout / session check** — real bcrypt + JWT + MongoDB.
- **Admin login** — single env-configured account, JWT cookie, role-gated.
- **Route protection** — `ProtectedRoute` / `AdminRoute` on the frontend, `requireAuth()` on the backend.
- **Question listing** — `GET /api/v1/questions` reads real `Question` documents, now with validated query params.
- **AI Question Generator (partial)** — admin-only endpoint really writes to MongoDB. The "AI" is a template-string generator, not a model call.
- **Backend test suite** — 12 passing tests (vitest + supertest) covering health, readiness, error envelopes, the version alias, and request validation.

## Partially Completed Modules

- **Student analytics** — real model + route, but falls back to hardcoded demo data when no `StudentAnalytics` document exists, and **nothing in the codebase ever creates one**. Every real student therefore sees only the fallback.
- **AI insights** — real rule-based logic (not ML), reachable only on the currently-unpopulated real-data path.

## Pending / Not Started Modules (UI exists, no real backend wiring)

Unchanged by Milestone 1 — all still mock or absent:

- **Exam / exam attempts** — `Exam.tsx` is a client-side hardcoded 5-question quiz; nothing is submitted. `ExamAttempt` model unused.
- **Results** — `Result.tsx` fabricates results by hashing the entered Student ID client-side. `Result` model unused.
- **Certificates** — rendered client-side from the logged-in student's name/ID; the backend certificates route is never called.
- **Leaderboard** — hardcoded in `Landing.tsx` and `Dashboard.tsx`; the backend route exists but is never called.
- **Daily challenge** — backend route exists (static mock), no frontend page calls it.
- **Payments** — static QR image; no gateway, no verification, no transaction record.
- **OTP / mobile verification** — frontend-only fake (hardcoded `'123456'`), no SMS provider.
- **Admin student management** — `Admin.tsx` table is a hardcoded 4-row array; no list-students route exists.
- **XP / Levels / Badges / Achievements / Journey map / Gallery / Hall of Fame / Notifications / Audit logs / Subscriptions** — not started.

## Current Frontend State

React 19 SPA, 9 routes. All API access flows through `frontend/src/api/client.ts`, which now prefixes a single `API_BASE = '/api/v1'`; callers pass version-agnostic paths (`/auth/login`). Verified: `oxlint` passes (one pre-existing fast-refresh warning in `AuthContext.tsx`), `tsc -b && vite build` succeeds, the app boots with no console errors and reaches the backend through the Vite proxy. Pages still render hardcoded data where noted above.

## Current Backend State

Modular Express 5 app under `backend/src/`:

```
app.ts              builds the configured Express app (used by dev + serverless)
server.ts           local process bootstrap: connect, listen, graceful shutdown
config/env.ts       loads .env (dotenv) + validates via zod
config/index.ts     typed config; fails closed on missing prod JWT_SECRET
db/connection.ts    cached connect/disconnect + connection-state helpers
lib/                logger (pino), ApiError, response helpers
middleware/         auth, validate, errorHandler, rateLimiter, requestLogger, ensureDb
models/             5 Mongoose models, one file each
routes/health.routes.ts   /health, /ready
routes/v1/          auth, analytics, questions, admin, misc
validation/         zod schemas for auth + questions
```

`ExamAttempt` and `Result` models remain defined but unused by any route. Three routes (`daily-challenge`, `leaderboard`, `certificates/:studentId`) are still static mocks with no DB access, relocated unchanged into `routes/v1/misc.routes.ts`.

## Current Database State

MongoDB via Mongoose. `MONGO_URI` is read from `backend/.env` locally (a real Atlas cluster is configured) and from Vercel env vars in production. Connection is opened by the local bootstrap **and** lazily per-request by the `ensureDb` middleware, which is what makes the Vercel serverless path work. `serverSelectionTimeoutMS` is set explicitly (8s normally, 300ms in tests) instead of Mongoose's 30s default. No migrations tooling, no seed script, no indexes beyond the implicit unique index on `Student.mobile`.

**Live connectivity is unverified from this development sandbox** — outbound raw DNS/TCP is blocked here (`querySrv ECONNREFUSED`), so Atlas cannot be reached. The credentials themselves were never proven wrong. The owner must confirm connectivity locally; see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Current Authentication State

Real for both roles. Improved in Milestone 1: production now **refuses to start** without `JWT_SECRET` (previously it warned and continued with a hardcoded default), and the three auth routes are rate limited. Still missing: account lockout, password reset, email/phone verification (no email field on `Student`), CSRF tokens.

## Current Payment State

None. No provider selected, no code. Static QR image only, with no link to the registration transaction.

## Current Deployment State

Two independent Vercel projects, unchanged in structure:
- `backend/` — serverless function via `api/index.ts`, which now imports the app from `src/app.ts`.
- `frontend/` — static Vite build; `vercel.json` rewrites `/api/*` to a hardcoded backend URL and everything else to `index.html`.

Because the frontend now requests `/api/v1/...` and both the Vite dev proxy and the Vercel rewrite pass the remaining path through unchanged, no deploy config changed. **Deployment ordering matters**: deploy the backend before the frontend, or the frontend's `/api/v1` calls will hit an older backend that lacks those paths.

## Important File Locations

| Concern | Location |
|---|---|
| Express app assembly | [backend/src/app.ts](backend/src/app.ts) |
| Local bootstrap / shutdown | [backend/src/server.ts](backend/src/server.ts) |
| Vercel serverless entry | [backend/api/index.ts](backend/api/index.ts) |
| Env loading + validation | [backend/src/config/env.ts](backend/src/config/env.ts) |
| Typed config | [backend/src/config/index.ts](backend/src/config/index.ts) |
| DB connection | [backend/src/db/connection.ts](backend/src/db/connection.ts) |
| Per-request DB gate | [backend/src/middleware/ensureDb.ts](backend/src/middleware/ensureDb.ts) |
| Validation middleware | [backend/src/middleware/validate.ts](backend/src/middleware/validate.ts) |
| Health / readiness | [backend/src/routes/health.routes.ts](backend/src/routes/health.routes.ts) |
| Backend tests | [backend/tests/](backend/tests/) |
| Frontend API client | [frontend/src/api/client.ts](frontend/src/api/client.ts) |
| Session/auth state | [frontend/src/context/AuthContext.tsx](frontend/src/context/AuthContext.tsx) |
| Dev server config | [.claude/launch.json](.claude/launch.json) |

## Current Environment Requirements

Backend: `MONGO_URI`, `JWT_SECRET` (mandatory in production), `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, optionally `FRONTEND_URL`, `PORT`, `NODE_ENV`. Frontend: none. `backend/.env.example` now exists with placeholders. Full detail in [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

## Known Bugs

1. **`studentId` collision risk** — still generated as `AMIT_${Math.floor(Math.random()*10000)}` with no uniqueness check or unique index. Two students can collide. **Not fixed in Milestone 1.**
2. **Analytics never persisted** — `generateAIInsights()` mutates `aiInsights` in memory and never saves. Harmless only because the real-data branch is unreachable; will silently no-op once analytics are written.
3. **Dead models** — `ExamAttempt` and `Result` are defined but untouched by any route.
4. **`/api/v1/auth/me` returns 503 when the database is down even for guests** — the DB gate runs before the cookie check, so a visitor with no session gets 503 instead of 401. The frontend treats any failure as "guest", so behaviour is correct, but the status code is broader than ideal.

Fixed in Milestone 1: the insecure `JWT_SECRET` fallback, the permissive CORS fallback, missing security headers, missing rate limiting, and the unvalidated `req.query` filter construction.

## Technical Debt

- `ExamAttempt` / `Result` models still unused.
- Hardcoded production backend URL inside `frontend/vercel.json` instead of an env-driven rewrite.
- Mixed English/Hindi user-facing error strings in the backend (`"Kuch gadbad ho gayi"`) — carried over verbatim; worth a deliberate localisation decision.
- No CI pipeline; the verification commands are run manually.
- No integration tests against a real database (deliberate — see [`TESTING.md`](TESTING.md)).
- The unversioned `/api/*` alias should eventually be removed once nothing depends on it.
- Pre-existing high/moderate `npm audit` findings in `@vercel/node`'s build-time dependency tree; fixing requires a breaking `@vercel/node` v4 upgrade.

## Immediate Next Task

Awaiting owner decision on Milestone 2. The highest-value candidates, in the order recommended after Phase 0:

1. Wire the **leaderboard** to real data.
2. Wire **exam submission** → `ExamAttempt` → real **results** (both models already exist, unused).
3. Real **admin student management** (no list-students route exists at all).
4. Populate **`StudentAnalytics`** so analytics stop being a demo fallback.

Fixing the `studentId` collision risk should be folded into whichever of these first depends on `studentId` as a key.

## Recent Architectural Decisions

See [`DECISIONS.md`](DECISIONS.md). Milestone 1 added four ADRs: the modular backend split, `/api/v1` versioning with a compatibility alias, the chosen foundation libraries, and the decision that backend tests do not require a real MongoDB.
