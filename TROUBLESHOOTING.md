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

**Since Milestone 7 it also stops local work from sending real email** — see the next entry.

---

## Registering a test student locally emails a real stranger

**Problem**: registering `someone@example.com` (or any made-up address) against the **local** database sent a genuine verification email through the owner's real mail provider — to whoever actually owns that address. It also consumed the provider's free-tier quota, and against a plausible-looking address it meant mailing a real person about an account they never created.

**Cause**: `backend/.env` holds working SMTP credentials, and `dotenv` does not overwrite a variable that is already set — so `dev:local` could override `MONGO_URI` (which it did) but the SMTP group was still loaded from the file. `lib/email.ts` only falls back to its log transport when `SMTP_HOST` is *absent*, and there is no way to make an environment variable absent before dotenv reads the file. The documented workaround was "remember to set `REQUIRE_EMAIL_VERIFICATION=false`, or clear `SMTP_HOST` for that run" — the second half of which the env schema correctly rejects, since it requires a non-empty string when present.

**Solution**: `scripts/dev-local.ts` now also sets `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025` and `REQUIRE_EMAIL_VERIFICATION=false`, each only if not already set. Nothing is listening on that port, so delivery fails — and `lib/email.ts` logs and swallows delivery failures by design, precisely so a dead mail provider cannot turn an auth route into a 500. Registration therefore completes normally while nothing leaves the machine, and with verification off the new account can sign in at once.

To test delivery deliberately, either set `SMTP_HOST` in the environment for that run, or use the script that exists for it:

```bash
npm run verify:email --prefix backend
```

**Verification**: the start-up banner now reads `SMTP points at 127.0.0.1:1025 (nothing listening), so no real email is sent.` A registration against the local database during Milestone 7 verification returned 201 with `requiresEmailVerification: false`, the account signed in immediately, and the server log recorded `Email delivery failed` rather than `Email sent`.

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

## A student registered before Milestone 5 shows 0 XP and an empty activity feed

**Problem**: an account that has existed for a while, and has plainly registered and verified its email, opens the dashboard and sees 0 XP, level 1, no streak and "Nothing recorded yet".
**Cause**: Milestone 5 derives XP, levels, streaks and achievements entirely from the `StudentActivity` collection, which is written going forward. An account created before that milestone has no rows, so the honest derivation is zero. This is not data loss — nothing was ever stored to lose.
**Solution**: run the backfill, which writes the enrolment rows from facts already on the `Student` document. It is **report-only by default**, so the first command changes nothing:

```bash
npx tsx scripts/backfill-activity.ts
```

Then, from the `backend/` directory, apply it:

```bash
npx tsx scripts/backfill-activity.ts --write
```

Notes:
- It is **idempotent** — the partial unique index on the collection refuses a duplicate, so running it twice writes nothing the second time and reports `0`.
- `account_created` is dated from the account's real `registeredAt`; `email_verified` is written **only** where `isEmailVerified` is genuinely true.
- It deliberately does **not** invent `daily_visit` rows. A backfilled account therefore starts with a real XP total and a streak of **zero** until the next time the student actually shows up — because a streak it did not keep would be exactly the fabricated statistic this milestone exists to avoid.
- It targets whatever `MONGO_URI` points at, which for `backend/.env` is **production**. Override it for a local run: `MONGO_URI=mongodb://127.0.0.1:27017/amit-olympiad-local npx tsx scripts/backfill-activity.ts --write`.

**Verification**: the student's dashboard shows 100 XP (50 + 50) and an activity feed with "Joined the Olympiad" and "Verified your email address", both dated from the original registration.

## The dashboard's "Recent test performance" panel is always empty

**Problem**: the panel says "No results yet. Scored exams are not running yet."
**Cause**: this is correct and expected. Nothing writes an `ExamAttempt`, because the *official* exam is not built. Note this is **not** the Practice Zone, which is real, persisted and separate by design — practice sessions live in `PracticeSession` and deliberately do not become official results (see [`DECISIONS.md`](DECISIONS.md)). The dashboard runs a **real query** against the empty collection rather than returning a hardcoded `[]`, so the panel starts working on its own the moment official exam submission exists.
**Solution**: none needed. When implementing exam submission, note that `progressService.getRecentExamPerformance()` matches on the human-facing `AMIT_xxxx` id, because that is what `ExamAttempt.studentId` is typed as — see the note at the end of [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md).

## A streak breaks even though the student visited "yesterday"

**Problem**: a student who used the site late at night finds their streak reset.
**Cause**: check whether the visit fell after **18:30 UTC**, which is midnight IST. The competition day is an IST calendar day (`lib/competitionDay.ts`), so a visit at 00:30 IST belongs to the new day — which is the *correct* behaviour and the reason the module exists. A genuine break means no `daily_visit` row exists for either today or yesterday; note that a streak stays alive while the last visit was yesterday, because today has not been lost yet.
**Solution**: inspect the raw days with `db.studentactivities.distinct('occurredOn', { student: ObjectId('...') })` and compare against the IST date. If the keys disagree with the IST calendar date, that is a real bug in `dayKeyOf` — covered by tests in `tests/dashboard.test.ts`.

## A photo change does not appear on the profile page

**Problem**: `PUT /api/v1/me/photo` returns 200, but the picture on screen is the old one.
**Cause**: `GET /students/:studentId/photo` sends `Cache-Control: private, max-age=300`, so the browser holds the previous image for five minutes.
**Solution**: the profile page already appends a changing `?v=` query parameter after a successful upload, which is what makes the new photo appear immediately. If you are calling the endpoint yourself, do the same, or hard-reload. The stored document really has changed — check `db.studentphotos.findOne({...}).contentType` and `.size`.

---

## The Practice Zone says "Nothing to practise yet"

**Cause.** There are no *published* questions for that student's class. The Practice Zone counts only `status: 'published'` questions matching the student's own `classLevel` — drafts and questions published for another class are invisible to it, correctly.

**Check** which classes actually have content, then either author questions through `/admin/questions` or run the Class 12 seed.

## Seeding the Class 12 question bank

208 validated questions (104 Mathematics, 104 Physics) for `Class 12 - Science`, across 26 topics.

**Run it from inside `backend/`, not the repo root** — the path is relative to that directory, and running it from the root gives `ERR_MODULE_NOT_FOUND`.

```bash
cd backend && npx tsx scripts/seed-class12.ts
```

That reports what it *would* do and writes nothing. To publish:

```bash
cd backend && npx tsx scripts/seed-class12.ts --write
```

**It is idempotent.** A question is identified by its text within its class, so re-running skips what already exists rather than creating duplicates — safe to run again after an interruption.

**It validates before writing.** Every question goes through the same zod schema and LaTeX checks as `POST /admin/questions`, and the script exits non-zero if any question is rejected. If you see `Rejected (invalid)` above zero, nothing about those questions was written and the message names the field.

Two failure modes worth knowing:
- *"Two options have the same text"* — the duplicate-option check compares case-insensitively, so two options differing only by letter case (`$D$` and `$d$`, common in physics) collide. Rename one of the symbols.
- *Connection failure* — the script uses `MONGO_URI` from `backend/.env`, which is the **production** Atlas database. Override it for a local run: `MONGO_URI="mongodb://127.0.0.1:27017/amit-olympiad-local" npx tsx scripts/seed-class12.ts --write`.

---

## A script reported success but the data is not in Atlas

**Symptom.** `seed-class12.ts` printed `Published: 208`, but the Atlas collection is empty and the live site shows no questions. The first line of the output said:

```
◇ injected env (0) from .env
MONGO_URI: mongodb://localhost:27017/amit-olympiad
```

**Cause.** `injected env (0)` means **no environment variables were loaded**. `dotenv` used to resolve `.env` relative to the *current working directory*, so running a script from `backend/scripts/` instead of `backend/` found no `.env`, loaded nothing, and `MONGO_URI` fell through to its built-in `mongodb://localhost:27017/...` default. The script then wrote to a **local** database and correctly reported success — for that database. The accompanying `JWT_SECRET is not set` and `SMTP is not configured` warnings are the same cause: no `.env` was read.

**Fixed in the code, two ways:**

1. `config/env.ts` now resolves `.env` from **its own location** (`path.resolve(__dirname, '..', '..', '.env')`) rather than from `process.cwd()`, so the load no longer depends on where the process was started. Running from `backend/scripts/` now correctly reports `injected env (13) from ..\.env`.
2. Every write script calls `assertConfiguredForWrites()` from `src/lib/envGuard.ts`, which prints the target database and **exits 2** rather than writing to a local database unless `--local` is passed. The mistake is now loud instead of silent.

**If you hit the old behaviour, the data is on your own machine.** Point the diagnostic at the local database to confirm:

```bash
cd backend && MONGO_URI="mongodb://localhost:27017/amit-olympiad" npx tsx scripts/where-is-data.ts
```

Then re-run the seed against Atlas from the `backend` directory. It is idempotent, so nothing is duplicated:

```bash
cd backend && npx tsx scripts/seed-class12.ts --write
```

**The one number that matters** in the output is `Target database`. If it does not start `mongodb+srv://` and name your cluster, the run is not going to production.

## Which database is the live site using?

Visit `/ready` on the deployed backend. It reports the database the serverless function is actually connected to:

```
{"success":true,"status":"ready","db":"connected","dbName":"amit-olympiad"}
```

If `dbName` is not what you seeded, then Vercel's `MONGO_URI` environment variable differs from `backend/.env` — the two are configured independently, and Vercel does not read your local file.

---

## `querySrv ECONNREFUSED _mongodb._tcp.<cluster>`

**This is a DNS failure, not a database or credentials problem.** Nothing reached Atlas. The `mongodb+srv://` scheme must resolve a DNS **SRV** record before it can connect, and a fair number of resolvers refuse SRV queries — several Indian ISPs, most corporate DNS, some VPNs, and ad-blocking resolvers.

The two obvious guesses are both wrong here and both waste time: a bad password fails *later* with an authentication error, and a missing IP-allowlist entry fails *later* with a server-selection timeout. `connectDB()` now prints this distinction when it sees the error.

**Fixes, easiest first:**

1. **Change your DNS** to `1.1.1.1` or `8.8.8.8` and retry. Windows: Settings → Network → Adapter options → Properties → IPv4 → Use the following DNS servers.
2. **Disconnect from any VPN**, or try another network — a phone hotspot is a fast test.
3. **Use the direct, non-SRV connection string**, which needs no SRV lookup at all:

```bash
cd backend && npx tsx scripts/atlas-direct-uri.ts --with-credentials
```

That resolves the SRV record over **HTTPS** (bypassing the broken resolver) and prints an equivalent `mongodb://` URI listing the shard hosts explicitly. Paste it into `backend/.env` as `MONGO_URI`. Same hosts, same replica set, same TLS — the only trade-off is that it will not track a change to the cluster's topology, so re-run it if Atlas ever rescales the shards. Without `--with-credentials` it prints a redacted version, safe to paste into a chat.

The same string is available from the Atlas UI: **Connect → Drivers → driver version "Node.js 2.2.12 or later"**.

**Note that Vercel is unaffected.** It resolves SRV records fine, so production keeps working with the `mongodb+srv://` form even while your laptop cannot. Only change Vercel's `MONGO_URI` if the deployed backend is failing too.

---

## A promoted admin is told "Invalid admin credentials" at `/admin`

**Problem**: A super admin promotes a student to `admin` — the `/admin/users` row correctly shows the **Admin** badge and **Active** — but when that person signs in at the admin portal they get `Invalid admin credentials.` Their password is right, and it still works on the home-page login.

**Cause**: The two administrative identities authenticate against **different endpoints**, and the portal only ever posted to the first:

- the **root** super admin lives in the environment (`ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`), has no database record, and signs in at `POST /auth/admin/login`;
- a **promoted** admin is an ordinary `Student` document carrying `role: 'admin'`, and signs in at the normal `POST /auth/login`.

`POST /auth/admin/login` compares the submitted email against `config.admin.email` and nothing else, so *any* promoted admin is refused there by design — correctly, but with a message that reads as a broken account rather than as the wrong door. The only signpost was a line of hint text under the form.

**Solution**: `adminLogin()` in `frontend/src/context/AuthContext.tsx` now tries `/auth/admin/login` first and, **on a 401 specifically**, falls back to `/auth/login` with the typed value as `identifier` (which accepts an email or a mobile number). One form now serves both identities. The backend was not changed — there is still exactly one authentication path per identity, and the root endpoint still accepts nothing but the environment credentials.

`/auth/admin/login` was also added to `NO_REFRESH_PATHS` in `frontend/src/api/client.ts`. A 401 there means "wrong credentials", not "token expired", so the refresh-and-replay cycle could not help and only spent a second login attempt against the rate limiter and the account's failed-login counter.

**Verification**: Four tests in `backend/tests/rbac.test.ts` (`the admin portal accepts both administrative identities`) pin the contract — including that the refusal is a **401**, since changing it to 403 would silently strand every promoted admin. Confirmed live against a local database: the portal's network trace shows `POST /auth/admin/login → 401` followed immediately by `POST /auth/login → 200`, and the promoted admin lands on the admin dashboard.

**Related trap worth knowing**: both identities use the same `access_token` cookie name. Signing in as a student in another tab overwrites an open super-admin session, after which the admin UI keeps rendering (its permission list is still in React memory) while every request 403s. If admin pages start refusing you for no clear reason, check `GET /api/v1/auth/me` — it reports the role the server actually sees.
