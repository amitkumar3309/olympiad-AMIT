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
- **Auth**: short-lived access JWT + rotating opaque refresh token, both in `httpOnly` cookies; passwords hashed with `bcryptjs` (cost 12). Email via `nodemailer` over SMTP.
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
  src/lib/                    logger (pino), ApiError, apiResponse helpers,
                              mathContent (LaTeX grammar), slug, serviceError
  src/services/               question + taxonomy business rules (Milestone 4);
                              practice (M6), mockTest (M7), dailyChallenge (M8);
                              rewardService.ts — THE gamification engine (M9);
                              rootAdminService.ts — THE super-admin bootstrap (M11);
                              leaderboardService.ts — THE ranking (M10);
                              hallOfFameService.ts — the honours boards (M10);
                              notificationService.ts — inbox rules + read state (M12);
                              platformAnalyticsService.ts — THE admin figures (M12);
                              grading.ts — THE marking rules, shared by all;
                              routes do HTTP, services own the rules
  src/middleware/             auth, validate, errorHandler, rateLimiter,
                              requestLogger, ensureDb
  src/models/                 one Mongoose model per file + barrel index
  src/routes/health.routes.ts /health (liveness), /ready (readiness)
  src/routes/v1/              auth, me, analytics, practice, mockTests,
                              mockTestsAdmin, dailyChallenge,
                              dailyChallengesAdmin, rewards, leaderboard,
                              gallery, notifications, adminInsights (M12),
                              questions (student reads),
                              questionsAdmin, taxonomy, admin, users, misc
                              + barrel index
  src/validation/             zod schemas
  src/lib/permissions.ts      THE role -> permission table (start here for authz)
  src/lib/audit.ts            recordAudit() — the administrative audit trail
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

- **Never add a script named `build` to `backend/package.json`.** Vercel's zero-config sees a `build` script, runs it, and then fails the deployment with `No Output Directory named "public" found` — because the backend is a serverless function, not a static site. `@vercel/node` compiles `api/index.ts` and its TypeScript imports on its own, so no build step is wanted. The equivalent local command is deliberately named **`compile`**. This exact regression broke production once; see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- Keep the backend/frontend split. Do not merge them into one Vercel project unless [`DECISIONS.md`](DECISIONS.md) is updated first — this was a deliberate move (see the "Rebuild frontend in React, add real authentication, split into separate services" commit).
- The backend is already split into `config/`, `db/`, `lib/`, `middleware/`, `models/`, `routes/v1/`, `validation/` (Milestone 1, recorded in `DECISIONS.md`). Put new code in the matching folder; don't add logic back into `server.ts`, which is bootstrap-only.
- `src/app.ts` must stay the single place the app is assembled, because both the local server and the Vercel serverless entry import it. Anything that must run in production has to be wired there or into a route/middleware — **not** into `server.ts`, which never executes on the serverless path.
- New env vars go in the zod schema in `config/env.ts` and are consumed via the typed `config` object. Do not read `process.env` directly anywhere else.
- **`.env` is resolved from the backend package root, never from `process.cwd()`.** `config/env.ts` anchors the path to its own directory. Do not "simplify" it back to a bare `dotenv.config()`: that resolves relative to wherever the process was started, so a script run from `backend/scripts/` loaded **zero** variables, silently fell through to the `mongodb://localhost` default, and wrote 208 questions into the wrong database while reporting success. Use `__dirname`, not `import.meta.url` — this package compiles to CommonJS, where `import.meta` is a syntax error that would only surface on the Vercel build.
- **Any script that writes to the database must call `assertConfiguredForWrites()`** from `src/lib/envGuard.ts` as its first statement, and must be report-only unless given an explicit flag (`--write` / `--delete`). Every env var has a plausible default, which makes a misconfigured script silently successful; the guard prints the target database and refuses a local write without `--local`.
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
- Route guards: `ProtectedRoute` (requires a student account) and `RequirePermission` (requires a capability) in `src/components/ProtectedRoute.tsx`. `AdminRoute` was **removed** in Milestone 3 — use `RequirePermission permission="..."`, which renders the `Unauthorized` component for a signed-in user rather than silently redirecting.
- Read permissions with `can('...')` from `useAuth()`. The permission list arrives from the backend on every auth response; **never** reimplement the role → permission mapping on the frontend, and never branch on `state.status` to decide whether something administrative is allowed (`status` says which *kind* of account is signed in, not what it may do — a promoted admin has `status: 'student'`). Wrap new authenticated pages in these rather than checking `state.status` ad hoc in the page body (existing pages do check `state.status` for conditional rendering, e.g. to show a preview vs. real data — that's fine; the *route-level* gate should still use the wrapper).

## Backend Conventions

- There are **two** auth cookies: `access_token` (short-lived JWT) and `refresh_token` (opaque, rotating). Both `httpOnly`, `secure` only in production, `sameSite: 'none'` in prod / `'lax'` in dev (prod frontend and backend are different Vercel domains, so cross-site cookies are required). Do not change these without understanding the split-domain implication — see [`SECURITY.md`](SECURITY.md).
- **Never return a raw Mongoose document from a question endpoint.** `questions.routes.ts` and `questionsAdmin.routes.ts` each build an explicit view: the student view omits `isCorrect`, `solution`, `booleanAnswer`, `numericAnswer` and `tolerance`; the author view includes them. They are two functions rather than one with an `includeAnswers` flag on purpose — before Milestone 4 this endpoint was unauthenticated and served the whole answer key. Do not merge them.
- Author-written content that may contain maths must be validated with `validateMathContent()` from `lib/mathContent.ts`, and rendered only through `frontend/src/components/MathText.tsx`. Never put question content into `dangerouslySetInnerHTML` yourself — the safety of the whole scheme is that prose becomes a React text node and only KaTeX output becomes HTML.
- **The answer key must never reach the client before it should be revealed.** Two functions reveal a correct answer and no more may be added: `sessionReviewView()` in `services/practiceService.ts`, which throws unless the session is `submitted`, and `attemptReviewView()` in `services/mockTestService.ts`, which throws unless the attempt is submitted **and** the mock test's own `reviewPolicy` currently permits it. Every in-progress view composes the shared answer-stripped `services/questionView.ts`. If you add a surface that serves questions, reuse `studentQuestionView`; do not hand-write a projection, because a forgotten field is an answer leak. Grading is server-side, always: the browser is never given the means to mark its own work.
- **A mock test decides when a score and when an answer key may be shown**, through `resultDisplay` and `reviewPolicy`. `disclosureFor()` in `services/mockTestService.ts` is the only place either is interpreted — do not branch on them anywhere else, and do not snapshot them onto an attempt (an administrator has to be able to release results after the window closes).
- **Practice sessions and mock-test attempts snapshot the answer key at serve time.** Grading reads that snapshot, not the live `Question`, so editing or re-pricing a question cannot retroactively change a paper somebody has already sat. Do not "simplify" grading to re-read the question.
- **There is exactly one grader: `services/grading.ts`.** `isAnswered`, `gradeEntry` and `gradeEntries` are shared by practice, mock tests and the daily challenge, over the one served-question shape in `models/attemptAnswer.ts`. Do not write a second marking function for a new surface — two graders eventually disagree, and a grader that disagrees with the answer key is a wrong score on a student's report.
- **For a timed surface, the server owns the clock.** `MockTestAttempt.expiresAt` is computed and stored when the attempt is created and never recomputed. No request body may carry a time, an elapsed duration or a deadline; an answer arriving after the deadline is refused and **not stored**, and a late submission is graded as at the deadline. A countdown in the browser is a display derived from `secondsRemaining` — never an input.
- **A submission that must happen once is closed by a conditional write**, not a read-then-write check: `finalizeAttempt()` updates with `status: 'in_progress'` in the filter and reports whether that write won, which is what gates the XP award. On a serverless platform a check and its write can land in different invocations.
- **There is exactly one reward engine: `services/rewardService.ts`.** Call `grantReward()` — never `recordActivity()` directly (only the engine and `scripts/backfill-activity.ts` may), and never compute an XP amount in a route. A caller supplies *facts* about what happened (`context: { answeredCount }`); the engine decides eligibility and price. Adding a reward to a new surface means one call, not a new rule.
- **Never query a database from `lib/achievements.ts`, `lib/badges.ts` or `lib/journey.ts`.** All three are pure functions of `RewardFacts` (`lib/rewardFacts.ts`), assembled once by `buildRewardFacts()`. To award for something new, add a fact there and supply it in the engine — that two-step friction is deliberate, and it is what has kept unearnable rows off the dashboard.
- **XP amounts are administrator-tunable; the rules are not.** `RewardSettings` overrides amounts only. Cardinality (`ONCE_PER_DAY`), eligibility and the level thresholds stay in code. Re-pricing must never affect history: `StudentActivity.xpAwarded` is a snapshot, and a total is the sum of those recorded values — do not "optimise" that into a lookup against the current table.
- **There is exactly one ranking service: `services/leaderboardService.ts`.** Every standing the product shows goes through it — the landing page, the dashboard's rank tile, the `/leaderboard` page and the Hall of Fame's XP board — so a rank cannot disagree with itself on two screens. Do not write a second aggregation that orders students; add a scope or a period to the one pipeline. Three rules travel with it: **nothing is stored** (there is no `Leaderboard` collection; a board is a `$sum` over `StudentActivity`, so it cannot drift from the XP it ranks); **equal XP shares a rank**, with the listing order fixed by a *total* order (XP → who reached it first → account id, the last key being what makes pagination safe); and **no request may supply a ranked value** — XP, score and rank are absent from the query schema rather than filtered by the handler. The frontend renders rows in the order it receives them and never re-sorts.
- **`attachUserIfPresent` is not a gate.** It attaches session claims when a cookie is present and never rejects, and exists so one public endpoint (the leaderboard) can differ in *content* for a signed-in caller. Anything decided on it is a presentation decision; a capability decision still goes through `requirePermission`, which rejects and re-reads the role from the database. Do not reach for it to make a route "optionally authenticated" when what you mean is authorised.
- **A public list must stay a list, not a roll.** The leaderboard publishes children's names (masked to a first name and last initial by `displayNameFor()`, the only function allowed to decide that) and caps an anonymous caller at the top 100. If you add pagination or a new public board, re-check that cap — Milestone 5's page-size limit stopped protecting anything the moment pages arrived, and the property had to be restored deliberately. See [`SECURITY.md`](SECURITY.md).
- **`requirePermission('...')` is the gate for new routes**, not a role check. The role → permission table in `src/lib/permissions.ts` is the *only* place a role may be mapped to a capability — **never** compare `req.user.role` to a literal in a handler or route (see [`DECISIONS.md`](DECISIONS.md)). Add a permission to that table if none fits. `requireAuth(...roles)` still exists but only for gates that genuinely concern identity rather than capability (e.g. `/auth/logout-all`). For a decision that depends on the data being addressed rather than the path, use `callerCan()` / `callerCanFresh()` — the latter re-reads the role from the database and is what you want before granting access to *someone else's* data.
- Authentication is stateless (no DB read). **Authorization is not, for privileged permissions**: `requirePermission` re-reads `role`/`status`/`tokenVersion` from MongoDB so a demotion or suspension takes effect at once instead of surviving the access token's TTL. Do not "optimise" that read away. It also means privileged routes need a database connection in order to authorize, and answer 503 without one.
- Any route that changes an account, a role, or the question bank must call `recordAudit(req, {...})` from `src/lib/audit.ts` with an action from `src/models/AuditLog.ts`. Audit writes are best-effort by design and must never fail the action they describe.
- Never store a token in the database in plaintext. Use `hashToken()` from `lib/tokens.ts` (SHA-256) for refresh and email tokens; use `lib/password.ts` (bcrypt) for passwords. Never log a raw token outside the dev email transport.
- Auth responses must not reveal whether an account exists. Login uses one message for unknown-account and wrong-password; `forgot-password` and `resend-verification` always return the same generic 200.
- Every route returns JSON with a `success` boolean. Never return a bare array/object without it.

## Database Conventions

- **Never build a surface over `Result` or `ExamAttempt`.** They are read by the product and written by *nothing* — they belong to the official exam, which is not built. Milestone 12 deliberately shipped **twelve of fourteen** requested admin areas for this reason: there is no results console and no certificate management, because both would be permanently empty and would recreate the fabricated-data problem Milestone 5 spent a follow-up pass deleting. Real scored data lives in `MockTestAttempt`. See the Milestone 12 ADR.
- **Every figure on an admin page must be counted from a collection.** `services/platformAnalyticsService.ts` is the one place platform-wide figures are assembled, and it has no estimates, projections or "engagement scores". Where there is no data it returns `0`, or `null` for an average — "nothing has been sat" and "everybody scored zero" are different facts. If a number cannot be queried, report `null` and let the UI say so (the rewards overview does exactly this for streak achievements, which an aggregation cannot answer).
- **`shiftDay(key, n)` returns the key `n` days BEFORE `key`.** A negative value moves *forward*. Getting that backwards produced a future cut-off that matched nothing, so two analytics windows silently read zero however busy the platform was. There is a regression test.
- **A notification is one document with an audience rule** (`services/notificationService.ts`), never fanned out per recipient, and `inboxFilter()` is the single definition of what a student can see — shared by the inbox and the unread count so the bell cannot disagree with the list.
- MongoDB via Mongoose, one model per file in `src/models/` — **21 models** (see [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)), plus `attemptAnswer.ts`, which is a *shared subdocument* embedded by `PracticeSession`, `MockTestAttempt` and `DailyChallengeAttempt` rather than a model. `AuditLog`, `StudentActivity`, `PracticeSession`, `MockTestAttempt`, `DailyChallenge` and `DailyChallengeAttempt` deliberately have **no** TTL index, unlike the two token collections — expiring a row would take XP or a practice history away from a student who earned it. `ExamAttempt` and `Result` exist but are **not written by any route**: they belong to the *official* exam, which is not built. `ExamAttempt` is *read* by the dashboard, so it is not dead, merely empty. Do not assume either is populated, and do not reuse them for practice — practice has its own `PracticeSession` collection on purpose (see [`DECISIONS.md`](DECISIONS.md)).
- **`Question` was rewritten in Milestone 4** and cannot read documents created before it (`subject` went from `String` to `ObjectId`, which throws a cast error on read rather than being a tolerable missing field). Legacy documents must be deleted with `backend/scripts/migrate-questions.ts` — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- **A day's challenge is pinned, never recomputed.** `resolveChallengeFor()` returns the stored `DailyChallenge` for a `{day, classLevel}` and only computes one when none exists, writing it before serving it. Do not reintroduce a picker that derives today's question from the current bank on each read: `hash(day) % publishedCount` changed which question "today" was whenever anything was published, and made a past day unrecoverable.
- **Mock tests are their own two collections** (`MockTest`, `MockTestAttempt`) and are not practice, and not the official exam. Do not write mock attempts into `ExamAttempt`, and do not point the dashboard's official test panel at them — a mock is a rehearsal, and conflating the two is what the separation exists to prevent (see [`DECISIONS.md`](DECISIONS.md)).
- Topics **and subtopics** are the same `Topic` collection, distinguished by a nullable `parent` and a derived `depth` capped at 1. Do not add a separate `Subtopic` model without a `DECISIONS.md` entry.
- `backend/.env` holds the **production** Atlas URI, so `npm start` locally writes to live data. Use `npm run dev:local --prefix backend` for local work — it forces a localhost database, and since Milestone 7 also points SMTP at a dead port and turns off email verification, so a local registration cannot email a real person. Do not remove either override; `.env` holds working SMTP credentials and `dotenv` will not overwrite an already-set variable, which is what made a local test registration mail a stranger.
- `Student.passwordHash` is `select: false`. A query that needs it must opt in with `.select('+passwordHash')`; never remove that guard.
- `Student.email` is required and unique, and was added in Milestone 2, so **documents created before it lack the field** and will fail validation on save. There is no migration script — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- Any route that touches the database must have the `ensureDb` middleware applied **after** validation/auth. Without it the route will work locally but fail in production, because the serverless entry never runs the local bootstrap that connects at startup.
- Student lookups use Mongo's own `_id` for the token `sub`; the human-facing identifier is `studentId`, which has **two namespaces**: `AMIT_0000`–`AMIT_9999` for entrants and `ADMIN_0000`–`ADMIN_9999` for the bootstrap staff account. `AMIT_xxxx` is the competitor numbering — the number a child writes on an exam paper — and there are only ten thousand of them, so staff must never be given one. It is now **uniquely indexed**, with registration retrying on collision, so it is safe to rely on — but it is still a plain string, not an `ObjectId` reference.

## API Conventions

- REST-ish, prefixed **`/api/v1/...`** (canonical). The unversioned `/api/...` is a compatibility alias mounting the same router — add new routes to `routes/v1/` only, never to the alias separately. Remember the alias when reasoning about access control: a gate must hold on both prefixes (a test asserts it does).
- Non-public routes call `requirePermission('...')`. Use `requireAuth(...)` only for an identity-based gate.
- Daily-challenge scheduling is gated on `challenges:write`; answering one is an identity gate (`requireAuth()`), like the rest of `/me`.
- Mock-test authoring is gated on `mocktests:write`; sitting a test is gated on the student-level `exam:take`. Student attempt routes never accept a student id — the account comes from the token's `sub`, and ownership is part of every query.
- See [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) for the authoritative, currently-implemented list. Several routes exist on the backend but are **not called by the frontend at all** (`/api/daily-challenge`, `/api/leaderboard`, `/api/certificates/:studentId`) — don't assume a page is wired up just because a matching endpoint exists.

## Authentication Conventions

- **Three roles**: `student`, `admin`, `superadmin`. **Every one of them is a `Student` document** since Milestone 11 — including the root `superadmin`, which is auto-provisioned from `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` the first time anyone signs in at `/api/v1/auth/admin/login`. Those two variables are the **bootstrap seed, not the ongoing source of truth**: once the document exists, authentication runs against it. An `admin` is an ordinary account promoted by a super admin (`PATCH /api/v1/admin/users/:studentId/role`).
- **`superadmin` is storable but not assignable.** `ASSIGNABLE_ROLES` omits it, so no API call can mint a second one; the only writer is the bootstrap in `services/rootAdminService.ts`. Do not add an API path to it.
- **Never let `resolveRootSuperadmin()` upgrade an existing account.** It adopts a document only if it *already* holds `superadmin`, and registration refuses `ADMIN_EMAIL` outright. Both halves are needed: without them, anyone who learned the configured address could register it before the first admin sign-in and then authenticate with their own password to be handed the role. This is the escalation the whole bootstrap is shaped around.
- **There is exactly one password check: `authenticateAccount()` in `auth.routes.ts`.** Both sign-in routes go through it, so lockout, account status, email verification and the failure counter are defined once. Do not write a bespoke check for a privileged account — that is precisely where a missing status check goes unnoticed.
- A promoted admin is a `Student` document with `role: 'admin'`, so it keeps its student capabilities. Do not "fix" that by splitting staff into a separate collection without a `DECISIONS.md` entry first — the reuse is the point (see the Milestone 3 ADR).
- Students register via `/api/v1/auth/register` with fullName + mobile + **email** + password. `role` submitted at registration is ignored; the schema default is the only way it is set.
- Students log in with **either** their mobile number or their email (`identifier` field). Email verification is **real** and required before login; the old fake client-side OTP step has been deleted. Do not reintroduce any mock verification.
- **Every account gets a rotating refresh token**, the super admin included. There is no longer a longer-lived admin token and no `ADMIN_TOKEN_TTL`; the `root: true` claim is gone, and `resolveCurrentRole()` has **no exemption** — every privileged request re-reads the role from the database. Do not reintroduce a document-less identity (see the Milestone 11 ADR for the five things the old design could not do).
- **The bootstrap super admin signs in only at `/auth/admin/login`.** `/auth/login` refuses it — *after* verifying the password, so the refusal is not an enumeration oracle pointing at the most privileged account. It is staff: no class, no school, no photo, and the public login form is the most-attacked surface in the product. A *promoted* admin is unaffected and uses `/auth/login` normally.
- **The bootstrap super admin earns no XP.** `grantReward()` refuses it, because every leaderboard aggregates `StudentActivity` and a staff account must never rank above the children who competed. A *promoted* admin does earn — it genuinely registered.
- Registration deliberately does **not** create a session. Don't "helpfully" log the student in on registration.

## Security Rules

- Never hardcode secrets. `JWT_SECRET`, `MONGO_URI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `FRONTEND_URL` are env-only (see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)).
- Read [`SECURITY.md`](SECURITY.md) before touching auth, query building from `req.query`, or CORS config. The previously-documented issues (unvalidated query construction, permissive CORS fallback, insecure JWT default, missing headers/rate limiting) were **fixed in Milestone 1** — don't reintroduce those patterns. Still open: **no CSRF tokens** (the top gap, and more pressing now that Milestone 3 added real state-mutating admin routes) and no two-factor auth. Account lockout arrived in Milestone 2; the authorization model was rebuilt in Milestone 3 — read the "Authorization" section of `SECURITY.md` for the role and permission tables before touching either.
- Do not commit `.env` files (already gitignored). Do not weaken the JWT default-secret warning into a silent success.

## Testing Requirements

- The **backend** has a test suite: `vitest` + `supertest`, plus `mongodb-memory-server` for integration tests against a **real** MongoDB — **566 tests across 18 files**. Run with `npm test --prefix backend` (from inside `backend/` when offline; see [`TESTING.md`](TESTING.md)). The **frontend** still has none. See [`TESTING.md`](TESTING.md).
- `NODE_ENV=test` skips `.env` loading, so tests can never pick up real secrets, and also lowers bcrypt cost and disables rate limiters for speed/determinism. Don't "fix" any of that.
- Use `tests/helpers/db.ts` (real in-memory MongoDB) and `tests/helpers/auth.ts` (`registerVerifyLogin`, cookie parsing, real token extraction from the captured email) rather than writing new harnesses.
- **Rate limiting, security headers and CORS are implemented but not asserted by tests.** Absence of a test is not absence of the protection.
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
- [ ] `npm test --prefix backend` passes (and `npm run compile --prefix backend` still passes afterwards — these two have conflicted before)
- [ ] Production build passes (`npm run build` in the affected app)
- [ ] Docs updated: at minimum `PROJECT_STATE.md` + `FEATURE_STATUS.md`, plus any of the others this task touched

## Cost Constraint (MVP)

Target ₹0 spend. Prefer free tiers: MongoDB Atlas free tier, Vercel free tier (both projects), no paid SMS/OTP or payment gateway until explicitly approved. Do not add a paid dependency or service without discussing it first.

## Beginner Support Rule

The project owner is AI/ML-background, comparatively new to full-stack engineering. Whenever a task requires the owner to perform an external/manual action (Atlas setup, obtaining API keys, Vercel env var configuration, DNS, OAuth setup, payment provider signup, etc.), **stop and give exact, beginner-friendly, numbered instructions** — never claim to have performed an external account action on the owner's behalf.
