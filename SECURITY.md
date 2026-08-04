# SECURITY.md

_Last updated: 2026-08-04 (Milestone 2 — Complete Authentication System)._

Reflects the actual state of the code. Fix items here before building new features on top of them.

## Authentication Security

- **Passwords**: bcrypt (`bcryptjs`), cost **12** (4 under test purely for speed). bcrypt embeds its cost in the hash, so raising the factor does not invalidate existing hashes.
- **Password policy**: minimum 8 characters, must contain at least one letter and one number, maximum 200. Deliberately length-first rather than a thicket of character classes — length is what resists guessing, and over-strict class rules push people toward predictable substitutions like `Password1!`.
- **Two-token design**: a short-lived access JWT (15 min) plus a long-lived opaque refresh token (30 days). See "Token Handling" below.
- **Email verification is required before login** (`REQUIRE_EMAIL_VERIFICATION`, default on). A mistyped address therefore cannot yield a usable account — which matters, because that address is the only password-recovery channel.
- **Account lockout**: after `MAX_FAILED_LOGINS` (5) failed attempts the account is locked for `ACCOUNT_LOCK_MINUTES` (15) and login returns `423`, even with the correct password. The counter resets on success.
- **No account enumeration**:
  - Login returns one identical message for "no such account" and "wrong password".
  - `forgot-password` and `resend-verification` always return the same generic 200 regardless of whether the address exists. A test asserts the known/unknown responses are byte-identical.
- **Rate limiting** is applied per endpoint, not globally — see "Rate Limiting".
- **Account status**: `active` / `suspended` / `deactivated`, enforced at login, on every `/auth/me`, and on refresh, so suspending an account kills live sessions rather than only blocking new logins.

## Authorization

- `requireAuth(...roles)` checks the token's `role` claim against a per-route allow-list. It is the only auth gate; routes must not hand-roll verification.
- `GET /api/v1/analytics/:studentId` restricts students to their own ID; admins may view any.
- No route lets an admin list or mutate students, so there is no broader admin-authorization surface yet.

## Password Storage

- Never stored in plaintext. `passwordHash` is additionally marked `select: false` at the schema level, so it is omitted from query results unless a caller explicitly opts in with `.select('+passwordHash')` — a route that forgets to project it away cannot leak it. Tests assert the hash never appears in a response body and that the stored value is a real bcrypt hash.

## Token Handling

**Access token** — JWT, `HS256`, 15 minutes, `httpOnly` session cookie (`access_token`). Claims: `role`, `sub`, `studentId`, `email`, and `tv` (the student's `tokenVersion`). Verification is deliberately **stateless**: signature, expiry and role only, with no database read, so it stays cheap on every request.

**Refresh token** — 32 bytes from `crypto.randomBytes`, opaque (not a JWT), 30 days, `httpOnly` cookie (`refresh_token`). Stored in MongoDB as a **SHA-256 hash only**; the raw value never touches the database. SHA-256 rather than bcrypt is correct here: these are high-entropy random values, not guessable passwords, so there is nothing to slow down an attacker about and lookups need to be deterministic.

**Rotation and theft detection** — every refresh issues a new token, marks the old one revoked, and records which token replaced it. Presenting an already-rotated token means two parties hold the same credential, which is almost always theft or a replay, so the **entire token family** (all tokens descended from that login) is revoked and a fresh login is required.

**Known trade-off — revocation latency.** Because access tokens are verified without a database read, revoking a session does not instantly invalidate an already-issued access token. Refresh tokens are killed immediately in the database, so a revoked session cannot survive longer than one access-token lifetime (≤15 minutes by default). `/auth/me` additionally compares `tv` against the stored `tokenVersion`, so `logout-all` and password resets *are* reflected immediately on that endpoint. This is a deliberate choice, recorded in [`DECISIONS.md`](DECISIONS.md); shortening `ACCESS_TOKEN_TTL` narrows the window at the cost of more refresh traffic.

**Single-use email tokens** — verification (24h) and password reset (30 min) tokens are also 32 random bytes stored SHA-256-hashed, with a `usedAt` marker. They are consumed via `findOneAndUpdate` filtered on `usedAt: null`, so two concurrent redemptions cannot both succeed. Issuing a new token of a type invalidates any outstanding one, so only the newest link in an inbox works.

**Revocation surfaces**: `logout` (this device only), `logout-all` (every device, bumps `tokenVersion`), and a password reset (revokes everything). No key rotation mechanism exists for `JWT_SECRET`.

## Cookies

- `httpOnly: true` always — unreadable by client JS, which mitigates token theft via XSS.
- `secure: true` in production only (so local HTTP development works).
- `sameSite: 'none'` in production, `'lax'` in development. `'none'` is required because the frontend and backend are on different Vercel domains, and it is the reason `SameSite` cannot be relied on for CSRF defence in production (see below).
- The access cookie is a **session cookie** (no `maxAge`) — the JWT's `exp` is the real authority, and the cookie should not outlive the browser session. The refresh cookie carries an explicit `maxAge` matching its TTL.

## CORS

- Explicit origin allow-list built from `FRONTEND_URL` plus `http://localhost:5173`, with `credentials: true`. It **never** falls back to reflecting an arbitrary origin; if `FRONTEND_URL` is unset in production the app logs a warning and allows only localhost, which fails closed rather than open.

## CSRF

**Still open — the most significant remaining gap.** There is no CSRF token mechanism. In production, cookies are `sameSite: 'none'`, so a browser *will* attach them to a cross-site request. CORS does not help against a fire-and-forget POST (e.g. a hidden auto-submitting form), because the attacker does not need to read the response.

Practical exposure today: `logout`, `logout-all`, and `refresh` could be triggered cross-site (nuisance rather than data loss), and registration/login/reset all require knowledge the attacker does not have. It becomes serious the moment an authenticated, state-mutating route exists — payments, profile edits, or admin actions. **A double-submit cookie or a header-based CSRF token should be added before any of those ship.**

## Rate Limiting

Implemented per endpoint via `express-rate-limit` (`backend/src/middleware/rateLimiter.ts`). Disabled under `NODE_ENV=test` so the suite can hammer endpoints deterministically.

| Endpoint(s) | Limit |
|---|---|
| All `/api*` (general) | 300 / 15 min |
| `login`, `admin/login` | 10 / 15 min |
| `register` | 10 / hour |
| `forgot-password`, `resend-verification` | 5 / hour |
| `verify-email`, `reset-password` | 20 / 15 min |
| `refresh` | 60 / 15 min |

The email-sending endpoints are tightest because each request consumes a third-party mail quota as well as touching an account. `/health` and `/ready` are mounted before the limiter so monitoring probes are never throttled.

Caveat: limits are per instance and held in memory. On Vercel's serverless platform each cold container has its own counters, so effective limits are looser than the numbers above. A shared store (e.g. Redis) would be needed for strict enforcement — not free-tier friendly, so deferred.

## Validation

All request bodies and query params are validated by zod schemas via `middleware/validate.ts` before any handler runs, so malformed input returns `400` without touching the database. Note that `req.query`/`req.params` are getter-only in Express 5, so the middleware swaps in parsed values with `Object.defineProperty` — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## NoSQL Injection Protection

- Query filters are never built from raw user input. The login lookup uses `$or` over two explicitly-normalised strings (`identifier.toLowerCase()` and a digits-only mobile), and `GET /questions` validates every filter through a zod schema that rejects anything that isn't a plain string.
- **Correction retained from Milestone 1**: the classic `?field[$ne]=x` operator-injection shape was never exploitable here, because Express 5 defaults to the `'simple'` query parser, which does not do bracket-notation nesting. Verified empirically against Express 5.2.1. The real risk — a repeated key arriving as an array — is closed by the validation layer, which also keeps holding if the parser is ever switched to `'extended'`.

## Security Headers

`helmet` with defaults, and `x-powered-by` disabled.

## Email Security

- Verification and reset links are the only credentials in those flows, so they are single-use, short-lived, and stored hashed.
- Delivery failures are logged and swallowed rather than surfaced, so a dead mail provider cannot turn into a 500 or leak whether an address exists.
- **Development caveat**: when SMTP is unconfigured, emails — including working tokens — are written to the backend log. **A development log is therefore sensitive** and must not be pasted into public issues or shared screenshots.

## File Upload Security

Not applicable — no file upload feature exists.

## Payment / Webhook Security

Not applicable yet — no gateway is integrated. When one is added, webhook signature verification must be implemented from day one, and CSRF protection should land first.

## Secrets Management

- All secrets come from `process.env` via a validated, typed config; no module reads `process.env` directly. Nothing is hardcoded.
- `JWT_SECRET` is **mandatory in production** — the process throws at startup rather than falling back to a default.
- `.env*` is gitignored, with `!.env.example` so the placeholder template stays tracked. `backend/.env` has never been committed (verified against git history).
- `ADMIN_PASSWORD_HASH` and `SMTP_PASS` are secrets; the former must be a bcrypt hash, never a plaintext password.

## Audit Logging

Not implemented as a queryable trail, but the structured logger records security-relevant events: refresh-token reuse (with the student and family id), account lockouts, and email delivery failures. A real `AdminAuditLog` collection should arrive with admin CRUD.

## Remaining Gaps, in priority order

1. **CSRF tokens** — required before any authenticated state-mutating route (payments, profile edits, admin actions).
2. **Admin tooling for account status** — `status` is enforced everywhere but only a direct database edit can set it.
3. **Shared-store rate limiting** — current limits are per-instance and weak on serverless.
4. **Two-factor authentication** — not started.
5. **`JWT_SECRET` rotation** — no mechanism; rotating it invalidates every session at once.
6. **Pre-existing `npm audit` findings** in `@vercel/node`'s build-time dependency tree; fixing needs a breaking major upgrade.
