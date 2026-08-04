# SECURITY.md

Reflects the actual state of [backend/src/server.ts](backend/src/server.ts) as audited. Fix items here before building new features on top of them.

## Authentication Security

- Passwords hashed with `bcryptjs`, 10 salt rounds — reasonable.
- JWT (`jsonwebtoken`), 7-day expiry, `httpOnly` cookie — cannot be read by client JS (good, mitigates XSS token theft).
- **Issue — insecure default secret**: `JWT_SECRET` falls back to the literal string `'dev_insecure_secret_change_me'` if the env var is unset. In production this only logs a `console.warn` — it does **not** refuse to start. If `JWT_SECRET` is ever missing in the real Vercel production env, every token becomes forgeable by anyone who reads the source. **Recommendation**: in production, throw/exit if `JWT_SECRET` is unset rather than warn-and-continue.
- **Issue — no rate limiting**: `/api/auth/login`, `/api/auth/register`, and `/api/auth/admin/login` have no throttling. A brute-force script can attempt unlimited password guesses. **Recommendation**: add a lightweight in-memory or Redis-backed rate limiter (`express-rate-limit`) on these three routes at minimum, especially the single admin account.
- No account lockout after repeated failures.
- No password reset flow exists — not a vulnerability per se, but means there is currently no way for a locked-out student to regain access except re-registering (which will fail on the unique `mobile` constraint).

## Authorization

- `requireAuth(...roles)` correctly checks the JWT's `role` claim against an allow-list per route.
- `GET /api/analytics/:studentId` correctly restricts students to their own ID; admins can view any — appropriate.
- No route currently lets an admin list/manage students, so there's no broader admin-authorization surface to audit yet.

## Password Storage

- Never stored in plaintext. `bcryptjs.hash(password, 10)` on register, `bcryptjs.compare` on login. No password complexity rules beyond a 6-character minimum length (frontend and backend both enforce this).

## JWT Handling

- Signed with `HS256` (jsonwebtoken default), single shared secret for both student and admin tokens.
- No `iss`/`aud` claims, no key rotation mechanism, no revocation list — a compromised token is valid until natural expiry (7 days) even after logout.

## Cookies

- `httpOnly: true` always — good.
- `secure: isProd` — correctly only sent over HTTPS in production.
- `sameSite: isProd ? 'none' : 'lax'` — `'none'` is required in production because the frontend and backend are on different Vercel domains (cross-site cookie), which is a legitimate reason, but it does mean CSRF defenses can't rely on `SameSite` alone in production (see CSRF below).

## CORS

- `origin`: array of `[FRONTEND_URL, 'http://localhost:5173']` (falsy filtered out), with `credentials: true`.
- **Issue — permissive fallback**: if `FRONTEND_URL` is unset in production, `allowedOrigins` collapses to just `['http://localhost:5173']`... but the code's fallback logic (`allowedOrigins.length > 0 ? allowedOrigins : true`) means if that array were ever empty, CORS would reflect **any** origin (`origin: true`) while still sending credentials — the most permissive possible CORS configuration. Currently `localhost:5173` keeps the array non-empty, but this is fragile: any refactor that removes the hardcoded localhost fallback would silently open this up. **Recommendation**: require `FRONTEND_URL` to be set in production and fail closed (empty allow-list, not `true`) if it's missing.

## CSRF

- No CSRF token mechanism exists. In production, cookies are `sameSite: 'none'`, which means a malicious site *can* trigger cross-site requests with the cookie attached (the browser will send it). The only mitigation currently in place is CORS blocking cross-origin `fetch` reads of the response for *browser-based* attacks that need to read the response — but a pure CSRF (fire-and-forget POST, e.g. via a hidden form) is not blocked by CORS at all. **Recommendation**: add a CSRF token (double-submit cookie or header check) before adding any destructive state-changing route (there are none highly sensitive yet beyond auth itself, but this should be fixed before adding payments or account-mutating admin actions).

## Rate Limiting

Not implemented anywhere. See Authentication Security above.

## Validation

- Manual `if` checks only, no schema validation library (no `zod`/`joi`/`express-validator`). Works for the current small set of routes but will get error-prone as routes grow. **Recommendation**: introduce `zod` (free, no infra cost) the next time a new route with a non-trivial body is added.

## NoSQL Injection Protection

- **Resolved in Milestone 1** — `GET /api/v1/questions` (formerly `GET /api/questions`) now validates `req.query` through a zod schema (`listQuestionsQuerySchema` in `backend/src/validation/questionSchemas.ts`) before the handler ever builds the Mongoose filter. Any query value that isn't a plain string — including an array from a repeated key like `?classLevel=a&classLevel=b` — is rejected with a `400` before reaching the database layer. Covered by `backend/tests/validation.test.ts`.
- **Correction to the original finding**: this was previously written assuming Express's `qs`-based `'extended'` query parser, which turns `?classLevel[$ne]=null` into a nested object (`classLevel = { $ne: 'null' }`) that could be merged into a Mongo filter as an operator. **That assumption was wrong for this codebase.** Express 5 changed its default query parser to `'simple'` (Node's built-in `querystring`), which does **not** do bracket-notation nesting — `?classLevel[$ne]=null` arrives as a flat, literal key `"classLevel[$ne]"` with a string value, never as a nested object. This was verified empirically against the actual running app (`node -e` against a minimal Express 5 server) before correcting this document, rather than assumed. The classic `$ne`/`$gt`/`$regex`-via-query-string injection shape therefore was **never exploitable** on this route under this app's real configuration.
- The type-confusion risk that *is* real (a repeated query key producing an array instead of a string) is now closed by the validation layer above — and that same validation continues to protect the route defensively even if the query parser is ever reconfigured to `'extended'` in the future (e.g. via `app.set('query parser', 'extended')`), which would reintroduce bracket-notation nesting.
- No other route currently builds a dynamic Mongo filter from user input.

## Security Headers

Not set. No `helmet` or manual header middleware. **Recommendation**: add `helmet` (free) for baseline headers (`X-Content-Type-Options`, `X-Frame-Options`, etc.) before public launch.

## File Upload Security

Not applicable — no file upload feature exists anywhere in the codebase.

## Payment / Webhook Security

Not applicable yet — no payment gateway is integrated. When one is added, webhook signature verification must be implemented from day one (flag this in [`DECISIONS.md`](DECISIONS.md) when a provider is chosen).

## Secrets Management

- Secrets are correctly kept out of source: `JWT_SECRET`, `MONGO_URI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` are all read from `process.env`, never hardcoded.
- `.env` and `.env*` are gitignored at the repo root (`.gitignore`) — good.
- **Gap**: no `.env.example` exists for either app, so a new contributor has no template to know which vars are needed without reading `server.ts` or [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md). Create one next time env vars are touched.
- `ADMIN_PASSWORD_HASH` is meant to be a pre-computed bcrypt hash supplied via env (never the plaintext password) — this is the correct pattern; make sure deployment instructions never ask the owner to paste a plaintext admin password into an env var.

## Audit Logging

Not implemented — no admin action is logged anywhere. Low priority until real admin CRUD operations (e.g., student management, question editing/deletion) exist, but should be added alongside those features rather than retrofitted later.

## Priority fix order

Status as of Milestone 1 (backend foundation) — items 1–6 are now **done**; nothing below is currently outstanding for this list.

1. ~~Make `JWT_SECRET` mandatory-and-fail-closed in production.~~ Done — `backend/src/config/index.ts` throws at startup if `JWT_SECRET` is unset in production.
2. ~~Fix the `GET /api/questions` query-injection shape.~~ Done — see "NoSQL Injection Protection" above.
3. ~~Fail closed (not open) on missing `FRONTEND_URL` in CORS.~~ Done — `backend/src/config/index.ts` never falls back to `origin: true`; CORS always uses an explicit origin allow-list and only warns (doesn't open up) if `FRONTEND_URL` is unset in production.
4. ~~Add rate limiting to the three auth routes.~~ Done — `backend/src/middleware/rateLimiter.ts` (`authLimiter`), applied in `backend/src/routes/v1/auth.routes.ts`.
5. ~~Add `.env.example` files.~~ Done for the backend (`backend/.env.example`). The frontend still doesn't need one (no env vars read anywhere in `frontend/src`).
6. ~~Add `helmet`.~~ Done — applied in `backend/src/app.ts`.

Remaining known gaps not covered by Milestone 1 (unchanged from before): no CSRF token mechanism, no account lockout, no password reset flow, the pre-existing `@vercel/node` build-time dependency vulnerabilities noted in `TROUBLESHOOTING.md`.
