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

## Template for new entries

```
## <short title>

**Problem**: what broke, symptoms.
**Cause**: root cause once found.
**Solution**: what fixed it.
**Verification**: how we confirmed the fix worked.
```
