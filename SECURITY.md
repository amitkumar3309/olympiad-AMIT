# SECURITY.md

_Last updated: 2026-08-05 (Milestone 3 — RBAC and User Management Foundation)._

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

Rewritten in Milestone 3 from role checks to a permission model. `backend/src/lib/permissions.ts` is the **only** place a role is mapped to what it may do; comparing `req.user.role` to a literal anywhere else is forbidden (see [`DECISIONS.md`](DECISIONS.md)).

### Roles

| Role | Held by | Notes |
|---|---|---|
| `student` | every registered account by default | |
| `admin` | an account promoted by a super admin | A normal account with `role: 'admin'`, so it keeps student capabilities too. |
| `superadmin` | the `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` account only | The bootstrap root. Has **no database document**, so it cannot be suspended or demoted from the UI — withdrawing it means changing the environment variables. Not assignable through any API. |

### Permissions

| Permission | student | admin | superadmin |
|---|---|---|---|
| `analytics:read:self` | yes | yes | yes |
| `exam:take` | yes | yes | yes |
| `questions:read` | yes | yes | yes |
| `analytics:read:any` | — | yes | yes |
| `students:read` | — | yes | yes |
| `students:status:write` | — | yes | yes |
| `questions:write` | — | yes | yes |
| `audit:read` | — | yes | yes |
| `users:role:write` | — | — | **yes** |

`users:role:write` is confined to `superadmin` on purpose: an ordinary admin cannot create more admins, so one compromised admin session cannot widen itself.

### How a request is authorized

`requirePermission('...')` returns a chain: `authenticate → (ensureDb → freshRoleCheck) → permissionCheck`. The bracketed steps run only for a permission no `student` holds.

- **The token's `role` claim is a hint, not the authority.** For any privileged request the caller's `role`, `status` and `tokenVersion` are re-read from MongoDB and the database value decides. A demotion or suspension therefore takes effect immediately rather than at the end of the 15-minute access-token lifetime — the moment it matters most.
- Student-level requests stay stateless (no database read), so the common path is unchanged in cost.
- `callerCanFresh()` applies the same guarantee to in-handler decisions, used by `GET /analytics/:studentId` for reading someone else's record.
- Losing standing also revokes sessions: a role change or a suspension revokes every refresh token and bumps `tokenVersion`, so old access tokens are refused and cannot be refreshed.
- `verifyAccessToken()` rejects any token whose `role` is not a recognised role, so an absent or unknown role can never reach a permission lookup.
- **Lateral protection**: an ordinary admin cannot change the status of an account that holds a role (only a super admin can), and nobody can change their own role or their own status.
- Roles cannot be self-assigned at registration: the handler picks fields explicitly, the zod schema strips unknown keys, and `role` defaults to `student` in the schema.

Verified by `backend/tests/rbac.test.ts` (61 tests), which drives the escalation attempts directly rather than through the UI. See [`TESTING.md`](TESTING.md).

### The frontend is not a security boundary

Route guards, permission-aware navigation and the unauthorized state exist to make the UI honest, not to enforce anything. The permission array the client receives is a convenience; every permission is re-checked server-side on every request. Confirmed in a browser: cookies are `httpOnly` and invisible to JavaScript, no role or permission data is kept in `localStorage`/`sessionStorage`, and planting fake values there or sending forged headers changes nothing — the API still answers 403.

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
- The Milestone 3 admin listing follows the same rule: `GET /admin/students` builds its filter field by field from zod-parsed values and never spreads `req.query`. Its free-text `search` is **regex-escaped** before becoming a `RegExp`, so a term like `.*` matches literally rather than matching every account (asserted by a test), and `:studentId` path params are constrained to `AMIT_` plus four digits so a path segment cannot become a filter.
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

Implemented in Milestone 3 as a queryable `AuditLog` collection, readable in-app by anyone with `audit:read` (`GET /api/v1/admin/audit-logs`, surfaced by `AuditLog.tsx`). It records role changes, account-status changes, question generation, administrative sign-ins, **and refused privileged requests** (`authz.denied`, with the permission that was missing).

Recording refusals is the security-relevant part: a run of `authz.denied` rows against one account is the signature of a privilege-escalation attempt, and it would be invisible if only successes were stored. Only authenticated callers produce rows, so an unauthenticated flood cannot inflate the collection. There is no TTL — an audit trail that deletes itself is not an audit trail.

The structured logger still records the events it did before (refresh-token reuse with student and family id, account lockouts, email delivery failures) and now also logs every authorization denial and every role change at `warn`.

## Remaining Gaps, in priority order

1. **CSRF tokens** — now the clear top gap, and more pressing than before Milestone 3: there are real authenticated state-mutating routes to protect (role changes, account suspension), where previously there were almost none. Production cookies are `sameSite: 'none'` because the apps are on different domains, so `sameSite` is not doing this job.
2. **Shared-store rate limiting** — current limits are per-instance and weak on serverless.
3. **Two-factor authentication** — not started, and now more valuable: an admin account is worth more than it was.
4. **`JWT_SECRET` rotation** — no mechanism; rotating it invalidates every session at once.
5. **Rate limiting on the administrative routes** — they sit behind the general `/api` limiter only, with no tighter per-route limit of their own.
6. **Pre-existing `npm audit` findings** in `@vercel/node`'s build-time dependency tree; fixing needs a breaking major upgrade.
