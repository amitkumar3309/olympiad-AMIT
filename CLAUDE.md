# CLAUDE.md — AMIT Maths Olympiad

Permanent instructions for every Claude Code session working on this repository.

## BEFORE STARTING ANY TASK

1. Read this file (`CLAUDE.md`) and [`PROJECT_STATE.md`](PROJECT_STATE.md) in full.
2. When the task touches a specific area, also read the relevant doc:
   - Architecture / data flow → [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md)
   - Mongoose models / collections → [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)
   - Any backend endpoint → [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md)
   - "Is X actually built?" → [`FEATURE_STATUS.md`](FEATURE_STATUS.md)
   - Auth, secrets, validation → [`SECURITY.md`](SECURITY.md)
   - Why something was built a certain way → [`DECISIONS.md`](DECISIONS.md)
3. Repository documentation and the actual source code are the source of truth — not this conversation's history, and not assumptions from a page "looking done."

## AFTER COMPLETING ANY TASK

- Update every doc affected by the change. At minimum, [`PROJECT_STATE.md`](PROJECT_STATE.md) and [`FEATURE_STATUS.md`](FEATURE_STATUS.md) must be updated whenever functionality changes.
- Add an entry to [`CHANGELOG.md`](CHANGELOG.md) for any meaningful completed feature/module.
- Add an ADR to [`DECISIONS.md`](DECISIONS.md) for any architectural or dependency choice.
- If a bug/setup/deploy issue was solved, log it in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Project Purpose

AMIT Maths Olympiad is a national-level math competition web platform: student registration, an online exam, results, certificates, a leaderboard, and an admin panel for managing students/questions. Founder/brand name referenced throughout the UI: "Amit Kumar".

## Technology Stack

- **Frontend**: React 19 + TypeScript, Vite 8, `react-router-dom` v7, `chart.js` / `react-chartjs-2`, CSS Modules (no UI framework/Tailwind). Linter: `oxlint`.
- **Backend**: Node.js + Express 5 + TypeScript, run via `tsx`. Modular structure since Milestone 1 (`config/`, `db/`, `lib/`, `middleware/`, `models/`, `routes/v1/`, `validation/`). Uses `zod` (validation), `pino` (logging), `helmet`, `express-rate-limit`. Linter: `eslint` + `typescript-eslint`. Tests: `vitest` + `supertest`.
- **Database**: MongoDB via Mongoose.
- **Auth**: JWT (`jsonwebtoken`) stored in an `httpOnly` cookie, passwords hashed with `bcryptjs`.
- **Deployment target**: Vercel, two **separate projects** — `frontend/` and `backend/` each have their own `vercel.json`. There is no monorepo-level Vercel config.
- **Package manager**: npm (separate `package-lock.json` per app — no workspaces).

## Repository Structure

```
/frontend                  React SPA (Vite)
  src/pages/<Page>/         one folder per route, colocated .module.css
  src/components/           shared presentational components
  src/context/AuthContext.tsx   session state (loading/guest/student/admin)
  src/api/client.ts         fetch wrapper (credentials: 'include')
  src/api/types.ts          shared response DTOs
  vercel.json               rewrites /api/* to the deployed backend URL
  vite.config.ts            dev-only proxy of /api -> localhost:8081

/backend
  src/app.ts                  builds the configured Express app (used by BOTH entries)
  src/server.ts               local process bootstrap: connect, listen, graceful shutdown
                              (NOT run on the Vercel serverless path)
  src/config/env.ts           dotenv load + zod validation of process.env
  src/config/index.ts         typed config (the ONLY place deriving app config from env)
  src/db/connection.ts        cached connect/disconnect + connection-state helpers
  src/lib/                    logger (pino), ApiError, apiResponse helpers
  src/middleware/             auth, validate, errorHandler, rateLimiter,
                              requestLogger, ensureDb
  src/models/                 one Mongoose model per file + barrel index
  src/routes/health.routes.ts /health (liveness), /ready (readiness)
  src/routes/v1/              auth, analytics, questions, admin, misc + barrel index
  src/validation/             zod schemas
  tests/                      vitest + supertest suite
  api/index.ts                Vercel serverless entry (imports src/app.ts)
  tsconfig.json               BUILD config (src + api only; excludes tests)
  tsconfig.test.json          TYPECHECK/LINT config (adds tests; noEmit)
  vercel.json                 rewrites everything to /api (the serverless function)

.claude/launch.json          dev server definitions (backend :8081, frontend :5173)
.postman/, postman/          empty Postman workspace scaffolding, unused so far
```

There is currently **no shared package**, **no `/docs` folder in use**, **no monorepo tool** (no Turborepo/Nx/workspaces). Frontend and backend are independent npm projects that only agree via the HTTP API contract.

## Architecture Rules

- Keep the backend/frontend split. Do not merge them into one Vercel project unless [`DECISIONS.md`](DECISIONS.md) is updated first — this was a deliberate move (see the "Rebuild frontend in React, add real authentication, split into separate services" commit).
- The backend is already split into `config/`, `db/`, `lib/`, `middleware/`, `models/`, `routes/v1/`, `validation/` (Milestone 1, recorded in `DECISIONS.md`). Put new code in the matching folder; don't add logic back into `server.ts`, which is bootstrap-only.
- `src/app.ts` must stay the single place the app is assembled, because both the local server and the Vercel serverless entry import it. Anything that must run in production has to be wired there or into a route/middleware — **not** into `server.ts`, which never executes on the serverless path.
- New env vars go in the zod schema in `config/env.ts` and are consumed via the typed `config` object. Do not read `process.env` directly anywhere else.
- Any new Mongoose model belongs in [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) before/with the code change.
- Any new route belongs in [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) before/with the code change.

## Coding Conventions

- TypeScript `strict: true` on the **backend** `tsconfig` (`backend/tsconfig.json`, along with `noUncheckedIndexedAccess: true`) — do not weaken this. The **frontend** does not currently set `strict` at all (`frontend/tsconfig.app.json`/`tsconfig.node.json` only enable `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`) — don't assume frontend code is strict-checked; if you want frontend strict mode, that's a deliberate opt-in change to propose, not an existing rule to "not weaken."
- Frontend: functional components, hooks, one folder per page containing `<Page>.tsx` + `<Page>.module.css`. Shared visuals go in `src/components/`.
- Naming: `camelCase` for variables/functions, `PascalCase` for components/types, kebab-case is not used for filenames (existing files are PascalCase per component).
- Backend: Express route handlers are `async (req, res) => { try {...} catch { ... } }` and return the `{ success, ... }` / `{ success:false, error }` envelope via the `sendSuccess`/`sendError` helpers in `lib/apiResponse.ts`. New routes must match it so `frontend/src/api/client.ts`'s error handling keeps working. A global error handler exists as a safety net, but keep the explicit try/catch.

## TypeScript Rules

- No `any`. The `any` usages that previously existed around query building and AI-insight generation were removed in Milestone 1 — the codebase is now `any`-free in `src/`. Do not reintroduce it; add a zod schema or a model interface instead.
- Do not disable `strict` or `noUncheckedIndexedAccess` on the backend `tsconfig` to make a change compile faster — fix the actual type issue.

## Frontend Conventions

- All API calls go through `api.get`/`api.post` in `src/api/client.ts` (adds `credentials: 'include'`, JSON headers, and throws `ApiError` on non-2xx). Do not call `fetch` directly in a page/component.
- Auth state is read via `useAuth()` from `AuthContext` — never re-implement session state locally in a page.
- Route guards: `ProtectedRoute` (student-only) and `AdminRoute` (admin-only) in `src/components/ProtectedRoute.tsx`. Wrap new authenticated pages in these rather than checking `state.status` ad hoc in the page body (existing pages do check `state.status` for conditional rendering, e.g. to show a preview vs. real data — that's fine; the *route-level* gate should still use the wrapper).

## Backend Conventions

- Auth cookie name is `token`, `httpOnly`, `secure` only in production, `sameSite: 'none'` in prod / `'lax'` in dev (because prod frontend and backend are different Vercel domains, so cross-site cookies are required). Do not change these without understanding the split-domain cookie implication — see [`SECURITY.md`](SECURITY.md).
- `requireAuth(...roles)` middleware is the only auth gate — reuse it; do not hand-roll JWT verification in a new route.
- Every route returns JSON with a `success` boolean. Never return a bare array/object without it.

## Database Conventions

- MongoDB via Mongoose, one model per file in `src/models/` (see [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)). `ExamAttempt` and `Result` models exist but are **not yet wired to any route** — do not assume they are populated.
- Any route that touches the database must have the `ensureDb` middleware applied **after** validation/auth. Without it the route will work locally but fail in production, because the serverless entry never runs the local bootstrap that connects at startup.
- Student lookups use Mongo's own `_id` for the JWT `sub`, but the human-facing identifier is the app-generated `studentId` (`AMIT_<random 0-9999>`). This ID is **not guaranteed unique** — see [`SECURITY.md`](SECURITY.md) / [`PROJECT_STATE.md`](PROJECT_STATE.md) known bugs. Fix collision risk before relying on `studentId` as a primary key for anything new.

## API Conventions

- REST-ish, prefixed **`/api/v1/...`** (canonical). The unversioned `/api/...` is a compatibility alias mounting the same router — add new routes to `routes/v1/` only, never to the alias separately. Auth-required routes call `requireAuth('student')`, `requireAuth('admin')`, or both.
- See [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) for the authoritative, currently-implemented list. Several routes exist on the backend but are **not called by the frontend at all** (`/api/daily-challenge`, `/api/leaderboard`, `/api/certificates/:studentId`) — don't assume a page is wired up just because a matching endpoint exists.

## Authentication Conventions

- Two independent identities: `student` (registered via `/api/auth/register`, mobile+password) and `admin` (single account, credentials from env vars, no admin registration flow/UI exists — by design, see [`DECISIONS.md`](DECISIONS.md)).
- There is no email/SMS verification on the backend. The frontend's "OTP" step in registration is a **client-side-only fake** (hardcoded literal `123456`) — do not treat it as real verification when building features that depend on a verified phone number.

## Security Rules

- Never hardcode secrets. `JWT_SECRET`, `MONGO_URI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `FRONTEND_URL` are env-only (see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)).
- Read [`SECURITY.md`](SECURITY.md) before touching auth, query building from `req.query`, or CORS config. The previously-documented issues (unvalidated query construction, permissive CORS fallback, insecure JWT default, missing headers/rate limiting) were **fixed in Milestone 1** — don't reintroduce those patterns. Still open: no CSRF tokens, no account lockout.
- Do not commit `.env` files (already gitignored). Do not weaken the JWT default-secret warning into a silent success.

## Testing Requirements

- The **backend** has a test suite: `vitest` + `supertest`, run with `npm test --prefix backend`. The **frontend** still has none. See [`TESTING.md`](TESTING.md).
- Backend tests deliberately run **without a database** (`NODE_ENV=test` skips `.env` loading so they can't pick up real secrets). Don't add a test that silently requires a live MongoDB; if you need one, propose `mongodb-memory-server` in [`DECISIONS.md`](DECISIONS.md) first.
- **Security behaviour is currently not automatically tested, by owner instruction** — the code is active, the tests are deferred. Don't interpret the absence of security tests as absence of security.
- Write assertions that name the status they forbid (`expect(res.status).not.toBe(500)`), not vague ones. A weak `not.toBe(400)` assertion hid a real 500 bug during Milestone 1.
- Adding a frontend test framework requires a `DECISIONS.md` entry first.

## Environment Variable Rules

- Every env var must be documented in [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) with a fake example value — never a real secret.
- `backend/.env.example` exists (placeholders only). When you add a variable, update the zod schema in `config/env.ts`, `.env.example`, **and** `ENVIRONMENT_VARIABLES.md` in the same change. The frontend reads no env vars, so it has no `.env.example`.

## Git Workflow

- Recent history shows direct commits to fix Vercel deploys reactively (pin TypeScript, restructure project) — prefer catching config issues locally (`npm run build` in both `frontend/` and `backend/`) before pushing when touching deploy config.
- Create new commits rather than amending; don't force-push shared branches.

## Documentation Requirements

- This project's persistent memory is the doc set in the repo root, not chat history. A brand-new Claude session must be able to read [`PROJECT_STATE.md`](PROJECT_STATE.md) and know exactly where things stand.
- Do not let `PROJECT_STATE.md` become a historical log — history goes in [`CHANGELOG.md`](CHANGELOG.md).

## Definition of Done

A task is complete only when, as applicable:

- [ ] Implementation is complete (no placeholder/mock left where real behavior was requested)
- [ ] Frontend is connected to the real backend (not a hardcoded mock array) when the task is about real data
- [ ] Backend is connected to the real database for any new persisted data
- [ ] Input validation exists for new user input
- [ ] Auth/authorization applied where required (`requireAuth` with correct roles)
- [ ] Error handling matches the existing `{ success, error }` envelope
- [ ] Loading / error / empty states exist in any new frontend view
- [ ] `npm run typecheck --prefix backend` passes / `tsc -b` passes for the frontend
- [ ] `npm run lint` passes in the affected app(s) (`eslint` backend, `oxlint` frontend)
- [ ] `npm test --prefix backend` passes (and `npm run build --prefix backend` still passes afterwards — these two have conflicted before)
- [ ] Production build passes (`npm run build` in the affected app)
- [ ] Docs updated: at minimum `PROJECT_STATE.md` + `FEATURE_STATUS.md`, plus any of the others this task touched

## Cost Constraint (MVP)

Target ₹0 spend. Prefer free tiers: MongoDB Atlas free tier, Vercel free tier (both projects), no paid SMS/OTP or payment gateway until explicitly approved. Do not add a paid dependency or service without discussing it first.

## Beginner Support Rule

The project owner is AI/ML-background, comparatively new to full-stack engineering. Whenever a task requires the owner to perform an external/manual action (Atlas setup, obtaining API keys, Vercel env var configuration, DNS, OAuth setup, payment provider signup, etc.), **stop and give exact, beginner-friendly, numbered instructions** — never claim to have performed an external account action on the owner's behalf.
