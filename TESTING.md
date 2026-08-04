# TESTING.md

_Last updated: 2026-08-04 (Milestone 2 — Complete Authentication System)._

## Current State

The backend has a working test suite: **44 passing tests across 7 files** (`backend/tests/`). The frontend still has **no test suite**.

| App | Runner | Tests | Status |
|---|---|---|---|
| `backend/` | vitest + supertest (+ mongodb-memory-server) | 44 | Passing |
| `frontend/` | none configured | 0 | Not started |

**32 of those tests are auth integration tests that run against a real MongoDB** started in-process by `mongodb-memory-server`. That matters: the auth flows are defined by database behaviour — unique indexes, atomic single-use token consumption, rotation bookkeeping — none of which a mock would exercise. This supersedes the Milestone 1 decision to avoid a real database in tests; see [`DECISIONS.md`](DECISIONS.md).

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
npm run compile --prefix backend
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

### Auth integration suites (real database)

`tests/auth.flows.test.ts` — the two journeys the milestone required:
- **register → verify → login → protected route → refresh → logout**, asserting at each step: registration issues no session; login is refused with `EMAIL_NOT_VERIFIED` while unverified; the emailed token verifies; login sets both cookies; `/auth/me` and a protected route accept the session while an unauthenticated request gets 401; refresh rotates the refresh token and the new access token still works; and after logout the revoked refresh token can no longer buy a session.
- **forgot password → reset password → login with the new password**, asserting the old password stops working, the new one works, and sessions issued before the reset are revoked (both refresh and access).
- Login works with the mobile number as well as the email address.
- The password is never stored in plaintext, never returned, and the stored value is a real bcrypt hash.
- `forgot-password` returns byte-identical responses for known and unknown addresses.

`tests/auth.security.test.ts` — 27 tests covering:
- **Invalid tokens**: garbage verify/reset tokens; already-used verify and reset tokens; an access token signed with the wrong secret; a structurally malformed token; an unknown refresh token.
- **Expired tokens**: expired access token on both `/auth/me` and a protected route (signed with a negative lifetime); expired verification, reset, and refresh tokens (backdated in the database rather than waiting).
- **Rotation and theft detection**: replaying a rotated refresh token revokes the whole family, so even the legitimately rotated token stops working; refresh and verification tokens are stored only as hashes, never plaintext.
- **Revocation**: `logout-all` kills every device; a plain `logout` leaves other devices signed in.
- **Account status**: suspended and deactivated accounts cannot log in, and an existing session stops being honoured the moment the account is suspended; lockout after repeated failures, then recovery once the window passes.
- **Validation and conflicts**: weak passwords, a password with no digit, a malformed email, duplicate email vs duplicate mobile (distinct messages), unique `studentId` allocation, and one shared message for unknown-account vs wrong-password.

### Foundation suites (no database)

These run against the app exported from `backend/src/app.ts` via supertest, with **no database required**.

- `health.test.ts` — `GET /health` returns 200 with an `ok` status and no DB dependency.
- `ready.test.ts` — `GET /ready` returns 200 when the connection module reports connected (module mocked).
- `ready-down.test.ts` — `GET /ready` returns 503 with `success:false` when it reports disconnected.
- `errorHandling.test.ts` — unknown routes return 404 in the standard `{success:false, error}` envelope; an unauthenticated request to a protected route returns 401; and the unversioned `/api` alias returns the same status as `/api/v1` (guards the frontend-compatibility promise).
- `validation.test.ts` — rejects a short password and a missing `fullName` with 400; rejects an invalid `difficulty` enum with 400; accepts a filter-less query; and asserts a *valid* query never produces a 500.

That last assertion exists because of a real bug this milestone hit: `req.query` is a getter-only accessor in Express 5, so the validation middleware's `req.query = parsed` assignment threw, producing a 500 on the **success** path only. The original test asserted merely `not.toBe(400)`, which passed while the endpoint was broken. Assertions here should name the status they forbid.

## Deliberately Untested

Milestone 2 closed most of the previous gap — JWT tampering/expiry, token revocation, account status, lockout and password hashing are all now covered. What remains untested:

- **Rate limiting.** The limiters are active in production code but **disabled under `NODE_ENV=test`**, because the suite deliberately hammers the same endpoints from one IP and throttling would make results order-dependent. The configured limits are documented in [`SECURITY.md`](SECURITY.md) but not asserted.
- **Security headers and CORS.** `helmet` and the origin allow-list are applied but not asserted.
- **Real email delivery.** Tests use an in-memory transport, so SMTP configuration, provider auth and deliverability are unverified by automation. The token extracted from the captured email *is* the real one, so the flow logic is genuinely tested — only the transport is not.
- **The production fail-closed check on a missing `JWT_SECRET`.** Asserting it needs a separate process, since it throws at module load.
- **`ensureDb` middleware.** Verified manually (a clean 503 in 93ms with the database down), not by a test.
- **Graceful shutdown.** Signal handling is not exercised.
- **CSRF.** No mechanism exists yet, so there is nothing to test — see [`SECURITY.md`](SECURITY.md).
- **The entire frontend.** No component, hook, or routing tests exist. The auth UI was verified by driving a real browser, not by automation.

## Test Environment Notes

- vitest sets `NODE_ENV=test`, which makes `config/env.ts` **skip** `dotenv.config()`. Tests therefore never pick up a developer's real `.env` — they run against schema defaults. This is deliberate; don't "fix" it by loading `.env` in tests.
- `tests/setup.ts` sets `mongoose.set('bufferCommands', false)` so a test that accidentally touches the database fails fast instead of hanging.
- `config.mongo.serverSelectionTimeoutMS` drops to 300ms under test (8s otherwise). Without this, the no-database path took Mongoose's default 30s and blew the 5s per-test timeout.
- bcrypt cost drops to **4** under test (12 otherwise). At cost 12 each hash takes ~250ms, and the auth suites hash dozens of times; this keeps the suite fast without changing the code path.
- Rate limiters are skipped under test (see "Deliberately Untested").
- `tests/helpers/db.ts` starts one `MongoMemoryServer` per test file, then explicitly builds indexes with `createIndexes()`. The models are compiled before the connection exists (they are imported with the app), and `Model.init()` also tries to auto-create collections, which races a freshly opened connection — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- `tests/helpers/auth.ts` provides `registerVerifyLogin()` plus cookie parsing, and pulls the real token out of the captured email.
- `backend/tsconfig.json` (build) excludes `tests/`; `backend/tsconfig.test.json` includes them for type-checking and lint; `vitest.config.mts` excludes `dist/`. All three are needed together — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for the failure mode when they disagree.

## Manual Verification

Milestone 1 was additionally verified by running both servers together and exercising the API with `curl` plus a real browser load of the SPA. Any PR/commit that adds or changes a route should describe how it was manually verified, per the Definition of Done in [`CLAUDE.md`](CLAUDE.md). The Postman workspace under `postman/`/`.postman/` is still empty scaffolding.

## Priority Gaps To Close Next

1. **Frontend tests** — the largest remaining hole; the auth UI is verified only by manual browser walkthroughs. Propose a framework in `DECISIONS.md` before installing one.
2. **Rate-limit assertions** — would need a limiter that can be enabled per test rather than switched off wholesale.
3. **CI** — nothing runs these commands automatically yet; they are manual.
4. **Integration tests for future data features** (exam attempts, results) — the real-database harness now exists, so these are cheap to add.
