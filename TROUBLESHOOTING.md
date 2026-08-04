# TROUBLESHOOTING.md

Log real problems + solutions here as they're encountered, so we don't re-solve them. This file starts with issues reconstructed from git history plus proactive notes from the Phase 0 audit — add to it going forward.

---

## Vercel build failure from TypeScript version mismatch

**Problem**: Production build on Vercel failed after a TypeScript dependency update.
**Cause**: Backend's `typescript` dependency floated to a version incompatible with the Vercel build environment (per commit `e19adb6`, "Pin TypeScript to stable 5.9.3 to fix Vercel build failure").
**Solution**: Pinned `backend/package.json`'s `typescript` to `^5.9.3` specifically instead of a broader range.
**Verification**: Vercel build succeeded after the pin. If bumping TypeScript in the backend again, verify `npm run build` (or the Vercel build) succeeds before merging — don't assume a newer TS version is safe.

---

## Repeated Vercel deployment restructuring

**Problem**: Multiple commits in a row (`9bba7cf`, `c32c717`, `1938876`, `6df3e60`) were needed to get a working Vercel deployment.
**Cause**: Not fully documented in commit messages, but the eventual resolution (per commit `9dbdf27`) was to split the project into two independent Vercel projects (`frontend/`, `backend/`) rather than trying to serve both from one project/config. A single combined Vercel project with both a static frontend and Express serverless functions appears to have been the source of the friction.
**Solution**: Two-project split (see [`DECISIONS.md`](DECISIONS.md)). Each app has its own `vercel.json` and is deployed as its own Vercel project with its own Root Directory setting.
**Verification**: Both `backend/vercel.json` and `frontend/vercel.json` exist today and are simple/working (single-purpose rewrites each). If deployment problems recur, check whether someone tried to re-merge the two projects — revert that before debugging further.

---

## (Anticipated) Login works locally but fails in production ("cookie not being set/sent")

**Problem** (not yet encountered, but likely given the architecture — recorded proactively): after deploying, login appears to succeed (200 response) but `GET /api/auth/me` still reports `guest`.
**Likely cause**: In production, the frontend and backend are on different domains, so the `token` cookie requires `sameSite: 'none'` + `secure: true` (already correctly conditional on `NODE_ENV === 'production'` in `server.ts`) **and** the browser must consider both `credentials: 'include'` (frontend's `fetch`, already set in `api/client.ts`) **and** CORS must echo the exact calling origin with `Access-Control-Allow-Credentials: true` (only works if `FRONTEND_URL` env var on the backend exactly matches the deployed frontend's origin, including `https://` and no trailing slash).
**Likely fix**: Confirm `FRONTEND_URL` on the backend Vercel project exactly matches the frontend's production URL, and redeploy the backend after setting/changing it (env var changes require a redeploy to take effect on Vercel).
**Verification**: Open browser devtools → Network tab on the deployed frontend, check the `/api/auth/login` response has a `Set-Cookie` header, and that subsequent requests include a `Cookie: token=...` header.

---

## (Anticipated) `MONGO_URI` unset in production silently falls back to `localhost`

**Problem** (proactive note): if `MONGO_URI` is never set on the backend's Vercel project, the code falls back to `mongodb://localhost:27017/amit-olympiad` — which does not exist inside a Vercel serverless function, so every DB operation will fail/hang.
**Cause**: `backend/src/server.ts`'s `dbLink` fallback is meant for local dev convenience but has no environment guard preventing it from being used in production.
**Fix**: Always explicitly set `MONGO_URI` in the backend's Vercel project settings (see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)) — never rely on the fallback in production.
**Verification**: Check Vercel function logs for `"🔴 DATABASE CONNECTION FAILED"` — if seen in production, `MONGO_URI` is missing or wrong.

---

## `.env` silently ignored after the backend refactor

**Problem**: After the Milestone 1 refactor the backend connected to `mongodb://localhost:27017` and listened on port **8080**, ignoring the real Atlas URI and `PORT=8081` in `backend/.env`. It also logged "JWT_SECRET is not set".
**Cause**: The old single-file `server.ts` called `dotenv.config()` at the top. The refactor moved configuration into `config/env.ts` but never carried that call across, so nothing ever loaded `.env` and every value fell back to a schema default. It was invisible in production (Vercel injects env vars directly) and only broke local development.
**Solution**: Call `dotenv.config()` at the top of `backend/src/config/env.ts`, before the zod parse. It is skipped when `NODE_ENV=test` so tests can't pick up a developer's real secrets.
**Verification**: Restarted the backend and confirmed the log line `injected env (7) from .env`, the JWT warning gone, port 8081 in use, and the Atlas hostname (not localhost) in the connection attempt.

---

## Serverless deployment would never connect to MongoDB

**Problem**: Every database-backed route would have failed in production, while working locally.
**Cause**: `backend/api/index.ts` (the Vercel entry) imports the app from `src/app.ts`, but only `src/server.ts` called `connectDB()`. Since `server.ts` never runs on the serverless path, no connection was ever opened there. The original single-file version called `connectDB()` at module load, so importing the app was enough — the refactor lost that.
**Solution**: Added `backend/src/middleware/ensureDb.ts`, applied per-route to every DB-backed route *after* validation and auth. `connectDB()` caches and de-duplicates, so it is cheap on warm containers. If the database is unreachable it returns a clean 503 instead of a 500 or a hang.
**Verification**: With the database unreachable, `GET /api/v1/questions?difficulty=Easy` returned `503 {"success":false,"error":"Database unavailable. Please try again shortly."}` in 93ms; validation errors still returned 400 without touching the database.
**Note**: `ensureDb` runs before the cookie check on `/auth/me`, so a guest gets 503 rather than 401 while the database is down. The frontend treats any failure as "guest", so behaviour is correct — logged as a known nuance in `PROJECT_STATE.md`.

---

## Request validation returned 500 on valid input (Express 5)

**Problem**: `GET /api/v1/questions?difficulty=Easy` returned `500 {"error":"Cannot set property query of #<IncomingMessage> which has only a getter"}`. Invalid input correctly returned 400, so only the **success** path was broken.
**Cause**: Express 5 defines `req.query` as a getter-only accessor. The validation middleware did `req.query = schema.parse(req.query)`, which throws once the parse succeeds. A weak test assertion (`expect(res.status).not.toBe(400)`) passed anyway and hid it.
**Solution**: Use `Object.defineProperty(req, 'query', { value, writable: true, configurable: true })` for `query` and `params`. `req.body` is a normal writable property and can still be assigned.
**Verification**: The route now returns 503 (database down) rather than 500, and a regression test explicitly asserts `not.toBe(500)` for a valid query.

---

## `npm run build` and `npm test` could not both work

**Problem**: Running `npm run build` then `npm test` failed 6 of 10 test files with *"Vitest cannot be imported in a CommonJS module using require()"*.
**Cause**: `tsc` compiled `tests/` and `vitest.config.mts` into `dist/`, and vitest then discovered `dist/tests/*.test.js` as additional test files. Those emitted files are CommonJS and cannot import vitest. Tests passed in isolation and only broke after a build, which made it look intermittent.
**Solution**: Three coordinated changes — `backend/tsconfig.json` (the build config) sets `"include": ["src", "api"]`; a new `backend/tsconfig.test.json` extends it with `noEmit` and adds `tests` for type-checking and linting; `vitest.config.mts` excludes `**/dist/**`. Scripts point at the right config (`build` → `tsconfig.json`, `typecheck` → `tsconfig.test.json`).
**Verification**: `npm run build` emits no `*.test.js` into `dist/`, and `npm test` passes 12/12 both before and after a build.

---

## Tests timed out after adding the per-request DB gate

**Problem**: Two tests began failing with *"Test timed out in 5000ms"*.
**Cause**: `ensureDb` awaits `connectDB()`, and Mongoose's default `serverSelectionTimeoutMS` is 30s — far beyond the 5s per-test limit. Previously the route failed immediately because `bufferCommands` was disabled.
**Solution**: Set `serverSelectionTimeoutMS` explicitly in `config`: 300ms under test, 8s otherwise. The shorter production value is a genuine improvement too — 30s exceeds a Vercel function's own timeout, so a dead database would hang until the platform killed the request instead of returning a 503.
**Verification**: Full suite passes in ~3s.

---

## MongoDB Atlas unreachable from the development sandbox

**Problem**: Connecting to Atlas fails with `querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net`.
**Cause**: This development sandbox permits outbound HTTP(S) but blocks raw DNS and TCP. A control test confirmed it: a plain HTTPS request to `registry.npmjs.org` returned 200 while `dns.resolve()` for the same host failed with `ECONNREFUSED`. MongoDB's `mongodb+srv://` scheme requires a DNS SRV lookup, so the driver cannot even discover the cluster. **The credentials in `backend/.env` were never shown to be wrong.**
**Solution**: None available inside the sandbox — this is an environment limitation, not a code or configuration defect. The application was made resilient to it instead: the server boots without a database, `/ready` truthfully reports 503, and data routes return a clean 503.
**Verification (must be done by the owner, locally)**:
1. Open a terminal in `backend/`.
2. Run `npm run dev`.
3. Look for `MongoDB connected successfully` in the output. If you instead see `MongoDB connection failed`, note the error message.
4. In a second terminal, run `curl http://localhost:8081/ready` — a healthy setup returns `{"success":true,"status":"ready","db":"connected"}`; a broken one returns 503.
5. If it fails with an authentication error, re-check the username/password in `MONGO_URI`. If it fails with a timeout or `ECONNREFUSED`, open MongoDB Atlas → **Network Access** and confirm your current IP (or `0.0.0.0/0`) is allowed.

---

## Existing student documents have no `email` after Milestone 2

**Problem**: `Student.email` is now required and unique. Any student document created before Milestone 2 lacks it, so saving that document fails validation, and the student cannot complete flows that write to their record (including login, which updates `lastLoginAt`).
**Cause**: The field was added because email verification and password reset are impossible without an address. No migration was written, because it is unknown whether the Atlas database holds real students or only test rows.
**Solution**: Decide per database.
- If the rows are throwaway test data, delete them: connect with MongoDB Compass or `mongosh` and run `db.students.deleteMany({ email: { $exists: false } })`.
- If they are real students, give each one an address and mark it unverified so they are forced through verification:
  `db.students.updateMany({ email: { $exists: false } }, { $set: { isEmailVerified: false, status: 'active', tokenVersion: 0, failedLoginAttempts: 0 } })` — then set `email` individually, since it must be unique per student.
**Verification**: `db.students.countDocuments({ email: { $exists: false } })` returns `0`, and an affected student can log in.

---

## `Model.init()` fails in tests with "Cannot read properties of undefined (reading 'createCollection')"

**Problem**: The first auth integration test run failed at setup with that error, and every test in the file was skipped.
**Cause**: `tests/helpers/db.ts` called `Model.init()` after connecting to the in-memory MongoDB. `init()` also performs `autoCreate`, i.e. it tries to create the collection — and because the models are compiled at import time (they come in with `src/app.ts`, before any connection exists), that auto-create raced the freshly opened connection and found `connection.db` still undefined. It reproduced only in the test environment; a standalone script that compiled its model *after* connecting worked fine.
**Solution**: Await `mongoose.connection.asPromise()`, then build indexes with `Model.createIndexes()` instead of `init()`. Indexes are what the tests actually need (unique constraints), and `createIndexes` does not try to create collections — MongoDB creates those implicitly on first insert.
**Verification**: All 32 auth integration tests pass, including the duplicate-email and duplicate-mobile assertions that only mean anything once unique indexes exist.

---

## Auth tests timed out at 5000ms after adding the database

**Problem**: Two tests began failing with "Test timed out in 5000ms".
**Cause**: Two separate costs. bcrypt at cost 12 takes ~250ms per hash and the auth suites hash dozens of times; and Mongoose's default `serverSelectionTimeoutMS` of 30s applies whenever a route touches an unreachable database.
**Solution**: Drop bcrypt cost to 4 and `serverSelectionTimeoutMS` to 300ms when `NODE_ENV=test` (both live in `config/index.ts`). Neither changes the code path — the same functions run, just faster. The shorter selection timeout is also better in production than Mongoose's default, which exceeds a Vercel function's own limit.
**Verification**: The full 44-test suite runs in about 5 seconds.

---

## Verification and reset emails are not arriving

**Problem**: A student registers but no email appears.
**Cause**: Almost always that SMTP is unconfigured. With `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` unset, the app deliberately writes the email to the server log instead of sending it, and logs a startup warning saying so. This is intended for local development; in production it means students get nothing.
**Solution**: Configure SMTP — step-by-step instructions for Brevo's free tier are in `ENVIRONMENT_VARIABLES.md`. Then redeploy (Vercel does not apply new env vars to a running deployment).
**Verification**: The startup warning disappears; a real registration produces an email; the log shows `Email sent`. To continue locally *without* SMTP, pull the link straight out of the backend log:
```bash
grep -o "http://localhost:5173/verify-email?token=[a-f0-9]*" backend.log | tail -1
```
**Note**: that log line contains a live, working token, so a development log is sensitive — don't paste it publicly.

---

## Emailed links point at localhost in production

**Problem**: Students receive verification/reset emails whose links go to `http://localhost:5173`.
**Cause**: Link bases come from `FRONTEND_URL`, which falls back to the local dev origin when unset. In Milestone 1 that variable only affected CORS, so it was easy to leave unset.
**Solution**: Set `FRONTEND_URL` on the **backend** Vercel project to the real frontend URL (no trailing slash), then redeploy the backend.
**Verification**: Register a test account in production and confirm the link host is correct.

---

## Everyone was signed out after deploying Milestone 2

**Problem**: All existing users are suddenly logged out.
**Cause**: Expected, not a bug. The single `token` cookie was replaced by `access_token` + `refresh_token`, so no pre-existing cookie is recognised.
**Solution**: None needed — users sign in again. Worth mentioning in any release note so it doesn't look like an outage.
**Verification**: A fresh login works and sets both new cookies.

---

## Backend Vercel deploy fails: `No Output Directory named "public" found`

**Problem**: The backend build on Vercel completes `tsc` and then fails with
`Error: No Output Directory named "public" found after the Build completed.`

**Cause**: A regression introduced in Milestone 1. The backend is a serverless function, not a static site — but Milestone 1 added a `"build": "tsc -p tsconfig.json"` script to `backend/package.json` for local verification. Vercel's zero-config detection sees any script named `build`, runs it, and then looks for static output in `public/`. There is none, so the deploy fails. It went unnoticed for two milestones because neither was actually deployed; the last successful backend deploy (commit `9dbdf27`, Aug 2) predated the script.

**Solution**: Rename the script. It is now `compile`, so Vercel's detection finds no build step and simply packages `api/index.ts`, which is what worked before. `@vercel/node` compiles the TypeScript entrypoint and its imports itself, so no build step is needed or wanted during deployment. `CLAUDE.md` now carries an explicit rule against reintroducing a `build` script here.

**Verification**: `npm run compile --prefix backend` still type-emits locally, and the Vercel backend deploy proceeds to "Ready" instead of erroring on the output directory. Afterwards `GET /health` returns 200 (it 404s on the old code), which confirms the new code is actually live.

---

## Registration succeeds and the email arrives, but no student appears in MongoDB

**Problem**: A student registers, the API returns 201, the verification email is delivered — yet the `students` collection in Atlas looks empty.

**Cause**: `MONGO_URI` had no database name. A connection string that ends at the host, e.g.
`mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net` with no `/name` path, connects perfectly well but uses MongoDB's **default database, which is called `test`**. Every write succeeded — into `test`, not `amit-olympiad` — so the data appears to vanish simply because you are looking at the wrong database in Atlas. Nothing was lost.

**Solution**: Append the database name (and keep any query string after it):
```
mongodb+srv://<user>:<password>@<cluster>.mongodb.net/amit-olympiad?retryWrites=true&w=majority
```
Update it in **both** `backend/.env` and the backend's Vercel environment variables, then redeploy. Documents already written to `test` are not moved by this — either re-register, or copy the collections across in Atlas.

**Verification**: `GET /ready` now reports the database it is actually using:
```json
{"success":true,"status":"ready","db":"connected","dbName":"amit-olympiad"}
```
If `dbName` says `test`, the URI is still missing its path. That field was added specifically so this failure can never be silent again.

---

## /ready reports "disconnected" on Vercel even though the database is fine

**Problem**: `GET /ready` returned `503 {"db":"disconnected"}` in production, but hitting any database-backed route immediately afterwards worked, and a second `/ready` then returned `200 {"db":"connected"}`.

**Cause**: The original readiness handler only *inspected* `mongoose.connection.readyState`; it never tried to connect. On Vercel every request can land on a freshly started container which has not opened a connection yet, because connections are established lazily by the `ensureDb` middleware on data routes. So a cold container truthfully reported "no connection in this container" — which reads as "the database is down" and is useless for an uptime monitor or a deploy gate. It was not reproducible locally, where the long-lived process connects once at boot.

**Solution**: `/ready` now *attempts* a connection via `connectDB()` before reporting, catching failures and falling through to 503. `connectDB()` caches and de-duplicates in-flight connects, so on a warm container this adds nothing.

**Verification**: `/ready` returns 200 on the first call to a cold deployment, and still returns 503 when the database genuinely cannot be reached.

---


## Admin question list errors after deploying Milestone 4: `Cast to ObjectId failed for value "Mathematics"`

**Symptom**: after deploying Milestone 4, `GET /admin/questions` (and the `/admin/questions` page) returns 500, with a Mongoose `CastError` in the logs naming a string like `"Mathematics"` or `"Maths"` for path `subject`.

**Cause**: Milestone 4 rewrote the `Question` schema. `subject` changed from a free-text `String` to an `ObjectId` reference to the new `Subject` collection, and `topic` became a required reference that did not exist before. Mongoose casts on read, so a document holding a string where the schema declares an `ObjectId` cannot be read through the model at all. This is unlike the Milestone 4 `Student` fields, which are merely *absent* on old documents and are therefore tolerable — a missing field reads as `undefined`, a wrong type throws.

**Fix**: delete the legacy documents. Every one was produced by the old template generator (their text reads `...What is the advanced solution for X? [Sample 1]`), so none is real content, and nothing references questions yet — `ExamAttempt` and `Result` are still unwired — so there are no attempts to orphan.

From `backend/`, first see what is there (this makes no change):

```bash
npx tsx scripts/migrate-questions.ts
```

Then remove them:

```bash
npx tsx scripts/migrate-questions.ts --delete
```

The script identifies a legacy document by **shape**, not by date: `subject` is a string, or the removed `correctAnswer` field is present, or the now-required `topic` is missing. It reads through the raw MongoDB driver rather than the Mongoose model, deliberately — the model is the thing that cannot cast them.

Afterwards the bank is empty. Create a subject and topic at `/admin/taxonomy`, then author real questions at `/admin/questions`.

## Running the app locally writes to the production database

**Symptom**: subjects, topics or questions created while developing show up for real users; or you are reluctant to click anything locally in case it touches live data.

**Cause**: `backend/.env` holds the production MongoDB Atlas connection string, because that is what a deployed-style run needs. `npm start` and `npm run dev` both read it, so the obvious local command talks to production.

**Fix**: use the local entry point added in Milestone 4, which forces `MONGO_URI` to localhost regardless of `.env`:

```bash
npm run dev:local --prefix backend
```

It prints the URI it is using, and sets a known root-admin credential (`root@localhost` / `LocalDevAdmin9`) so you can sign in to a fresh empty local database — the production `ADMIN_PASSWORD_HASH` has no plaintext anyone has locally. It requires a MongoDB on `localhost:27017`; override with `LOCAL_MONGO_URI` if yours is elsewhere.

This cannot affect any deployed environment: Vercel runs `api/index.ts`, never this script.

## Template for new entries

```
## <short title>

**Problem**: what broke, symptoms.
**Cause**: root cause once found.
**Solution**: what fixed it.
**Verification**: how we confirmed the fix worked.
```

---

## Auth integration tests time out after 60s in an offline environment

**Problem**: `npm test --prefix backend` fails three test files (`auth.flows`, `auth.security`, `rbac`) with `Hook timed out in 60000ms` at `beforeAll(startTestDb)`, while the five database-free suites pass. Running the same tests from a different directory passes all 105.
**Cause**: `mongodb-memory-server` resolves its cached MongoDB binary **relative to the working directory**, and `npm --prefix` changes where npm looks for `package.json` without making `backend/` the cache-resolution root. When the cache is not found it tries to download MongoDB, and in a network-restricted environment that hangs until the hook times out. Nothing is wrong with the code — the same commit passes from inside `backend/`.
**Solution**: run the suite from inside the backend directory in offline environments:

```bash
cd backend && npm test
```

**Verification**: identical commit and identical `dist/`, `npm test --prefix backend` → 3 files failed; `cd backend && npm test` → 105 passed. If the machine has network access, either form works because the binary is downloaded on first use.
**Note**: this is *not* the "`npm run build` and `npm test` could not both work" problem recorded above — that one was about `dist/` being discovered as test files and is genuinely fixed. Verify by checking whether the failure is a `beforeAll` timeout (this issue) or a "Vitest cannot be imported in a CommonJS module" error (that one).

---

## Root administrator gets 401 immediately after deploying Milestone 3

**Problem**: after the RBAC deploy, an already-signed-in root administrator is signed out, and any request to an admin route returns `401 "Your session is no longer valid."` until they log in again.
**Cause**: intended behaviour, not a bug. Access tokens issued before Milestone 3 carry `role: 'admin'` with no `sub` and no `root: true` flag. The authorization layer now re-reads the caller's role from the database for privileged requests, finds no document to read, and refuses. Refusing is the correct outcome — the alternative (treating a subject-less token as a match) would be a serious hole, and a test now asserts it stays refused.
**Solution**: sign in again at `/admin`. The new token carries `role: 'superadmin'` and `root: true`.
**Verification**: `GET /api/v1/auth/me` returns `role: 'superadmin'` with `users:role:write` in its `permissions` array.
**Note**: student sessions are **not** affected — the cookie names did not change in this milestone (unlike Milestone 2).

---

## Cannot promote anyone to admin: "Only a verified, active account can be made an administrator"

**Problem**: `PATCH /api/v1/admin/users/:studentId/role` returns `409` with that message, even though the account plainly exists.
**Cause**: promotion deliberately requires the target to have a verified email address and `status: 'active'`, so administrative access is never handed to an account whose owner has not proven control of the mailbox. In production, **an unconfigured SMTP setup makes this unreachable**: verification links are only written to the server log, so nobody can verify, so nobody can be promoted.
**Solution**: configure SMTP (see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)) and have the prospective admin complete the verification link. In local development the link is printed in the backend log and works as-is.
**Verification**: `GET /api/v1/admin/students/AMIT_xxxx` shows `isEmailVerified: true` and `status: "active"`, after which the promotion returns `200` with `changed: true`.
