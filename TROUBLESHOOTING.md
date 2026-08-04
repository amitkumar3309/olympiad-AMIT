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

## Template for new entries

```
## <short title>

**Problem**: what broke, symptoms.
**Cause**: root cause once found.
**Solution**: what fixed it.
**Verification**: how we confirmed the fix worked.
```
