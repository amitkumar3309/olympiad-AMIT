# TESTING.md

_Last updated: 2026-08-04 (Milestone 1)._

## Current State

The backend has a working test suite: **12 passing tests across 5 files** (`backend/tests/`). The frontend still has **no test suite**.

| App | Runner | Tests | Status |
|---|---|---|---|
| `backend/` | vitest + supertest | 12 | Passing |
| `frontend/` | none configured | 0 | Not started |

## Commands

```bash
npm test --prefix backend
```

Other verification commands (all must pass before a milestone is considered done):

```bash
npm run typecheck --prefix backend
```

```bash
npm run lint --prefix backend
```

```bash
npm run build --prefix backend
```

```bash
npm run lint --prefix frontend
```

```bash
npm run build --prefix frontend
```

Watch mode during development: `npm run test:watch --prefix backend`.

## Framework Choice

vitest + supertest, chosen in [`DECISIONS.md`](DECISIONS.md) (2026-08-04). vitest was preferred over Jest for ESM-native startup and lower config overhead alongside `tsx`; supertest exercises the exported Express app in-process without binding a port. Frontend unit tests (vitest + React Testing Library) and end-to-end tests (Playwright) remain recommended but unimplemented — propose in `DECISIONS.md` before installing.

## What Is Covered

All current tests run against the app exported from `backend/src/app.ts` via supertest, with **no database required**.

- `health.test.ts` — `GET /health` returns 200 with an `ok` status and no DB dependency.
- `ready.test.ts` — `GET /ready` returns 200 when the connection module reports connected (module mocked).
- `ready-down.test.ts` — `GET /ready` returns 503 with `success:false` when it reports disconnected.
- `errorHandling.test.ts` — unknown routes return 404 in the standard `{success:false, error}` envelope; an unauthenticated request to a protected route returns 401; and the unversioned `/api` alias returns the same status as `/api/v1` (guards the frontend-compatibility promise).
- `validation.test.ts` — rejects a short password and a missing `fullName` with 400; rejects an invalid `difficulty` enum with 400; accepts a filter-less query; and asserts a *valid* query never produces a 500.

That last assertion exists because of a real bug this milestone hit: `req.query` is a getter-only accessor in Express 5, so the validation middleware's `req.query = parsed` assignment threw, producing a 500 on the **success** path only. The original test asserted merely `not.toBe(400)`, which passed while the endpoint was broken. Assertions here should name the status they forbid.

## Deliberately Untested

**Security behaviour is intentionally not covered by automated tests at this milestone, at the project owner's explicit instruction.** The security code is implemented and active — it is the *tests* that were deferred, not the protection:

- Rate limiting (`express-rate-limit` on auth + general routes)
- Security headers (`helmet`)
- CORS allow-list behaviour
- Query-operator / NoSQL-injection shapes
- JWT signing, expiry, and tampering
- The production fail-closed check on a missing `JWT_SECRET`

Also untested, for unrelated reasons:

- **Any real database round-trip.** Per [`DECISIONS.md`](DECISIONS.md), `mongodb-memory-server` was rejected for this milestone (it downloads a MongoDB binary on first run, and outbound access is not always available). No test proves a `Student` is actually written or read.
- **`ensureDb` middleware.** Verified manually only — a DB-backed route returned a clean 503 in 93ms with the database unreachable.
- **Graceful shutdown.** Signal handling is not exercised.
- **The entire frontend.** No component, hook, or routing tests exist.

## Test Environment Notes

- vitest sets `NODE_ENV=test`, which makes `config/env.ts` **skip** `dotenv.config()`. Tests therefore never pick up a developer's real `.env` — they run against schema defaults. This is deliberate; don't "fix" it by loading `.env` in tests.
- `tests/setup.ts` sets `mongoose.set('bufferCommands', false)` so a test that accidentally touches the database fails fast instead of hanging.
- `config.mongo.serverSelectionTimeoutMS` drops to 300ms under test (8s otherwise). Without this, the no-database path took Mongoose's default 30s and blew the 5s per-test timeout.
- `backend/tsconfig.json` (build) excludes `tests/`; `backend/tsconfig.test.json` includes them for type-checking and lint; `vitest.config.mts` excludes `dist/`. All three are needed together — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for the failure mode when they disagree.

## Manual Verification

Milestone 1 was additionally verified by running both servers together and exercising the API with `curl` plus a real browser load of the SPA. Any PR/commit that adds or changes a route should describe how it was manually verified, per the Definition of Done in [`CLAUDE.md`](CLAUDE.md). The Postman workspace under `postman/`/`.postman/` is still empty scaffolding.

## Priority Gaps To Close Next

1. **Integration tests against a real database** — needed before exam submission / results, where correctness actually matters. Revisit `mongodb-memory-server` then.
2. **Security tests** — re-enable once the owner wants them; the code is already in place.
3. **Auth happy paths** — no test currently proves a successful register-then-login round-trip.
4. **Frontend tests** — propose a framework in `DECISIONS.md` before installing one.
5. **CI** — nothing runs these commands automatically yet; they are manual.
