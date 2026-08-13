# SECURITY.md

_Last updated: 2026-08-13 (Milestone 9 — Gamification Engine)._

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
| `superadmin` | the bootstrap root account only | **Changed in Milestone 11**: it now *has* a database document, auto-provisioned from `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` on first sign-in, so it holds a rotating refresh token and a revocable `tokenVersion` like any account. Still **not assignable** through any API, and still not manageable through one: `refuseIfProtected()` blocks suspending, demoting, password-resetting or deleting it, by anybody including itself. Withdrawing it means changing the environment and redeploying. |

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
| `questions:delete` | — | yes | yes |
| `taxonomy:write` | — | yes | yes |
| `mocktests:write` | — | yes | yes |
| `challenges:write` | — | yes | yes |
| `rewards:write` | — | yes | yes |
| `audit:read` | — | yes | yes |
| `users:password:reset` | — | yes | yes |
| `users:sessions:revoke` | — | yes | yes |
| `gallery:write` | — | yes | yes |
| `exam:write` | — | yes | yes |
| `certificates:write` | — | yes | yes |
| `notifications:write` | — | yes | yes |
| `users:role:write` | — | — | **yes** |
| `users:delete` | — | — | **yes** |

**A certificate cannot be manufactured, by anybody.** There is no issuance endpoint: certificates are minted only as a side effect of releasing an official exam's results, from a graded attempt. No student and no administrator can nominate a recipient, which makes “the frontend must not manufacture certificate eligibility” true structurally rather than by validation — the frontend is never asked.

**Verification keys on a secret, not on the serial.** `certificateId` is readable and effectively guessable; `verificationCode` is 16 symbols (~80 bits) of `crypto` randomness. Keying public verification on the serial would be an enumeration oracle: anybody noticing that certificates are numbered sequentially could walk them and harvest the name, school and rank of every entrant. A **revoked** certificate reports as revoked rather than missing, and can no longer be downloaded — continuing to issue fresh copies would undermine the revocation.

**The official exam never leaks its answer key or an unreleased mark.** The served paper composes the shared `studentQuestionView`, so no hand-written projection can forget a field; submission returns **no score at all**; and a `Result` row is created only by the publication step, with `isPublished` in the query rather than filtered afterwards. An answer arriving after `expiresAt` is refused and **not stored** — a browser is free to keep its countdown running, which is precisely why the clock is never taken from a request.

**The gallery is the only surface published to the open internet** (Milestone 12), which is why it holds its own permission rather than riding on `questions:write`: a mistake there is visible to anybody, not just to a signed-in cohort. Uploads are validated by **magic bytes** through the shared `imageDataUrl()` validator, so a file that merely *claims* to be a PNG is refused — a browser or a script controls the MIME type in a data URL, and trusting it would mean storing arbitrary bytes and serving them back with an image content type. Archiving stops the bytes being served, not just the listing, so a taken-down photo is genuinely gone for anyone holding the URL.

**`notifications:write` is narrow because it reaches everybody at once.** An announcement is visible to every matching student the moment it is published, and withdrawing one afterwards does not unsee it — so publication is audited as its own operation, distinct from an edit.

**A notification a student may not see returns `404`, not `403`.** Marking one read, or reading one addressed to another class, must not confirm that an id exists — otherwise the route becomes a way to probe the collection. The same reasoning as the answer-key rules elsewhere in this file.

**The super administrator cannot use the student login.** `POST /auth/login` refuses `role: 'superadmin'` with a `403` pointing at the administrator portal. The refusal is applied **after** the password is verified, and that ordering is load-bearing: refusing earlier would answer differently for the administrator's address than for any other, which is an account-enumeration oracle aimed at the most privileged account in the system. A caller who does not already know the password gets the same generic failure as for any other wrong guess, and no session is established either way.

**Staff do not hold competitor identifiers.** The bootstrap account's `studentId` is `ADMIN_xxxx`, not `AMIT_xxxx`. There are only ten thousand `AMIT_` numbers and they are what a child writes on an exam paper, so staff are not given one — and the namespace makes a staff actor obvious at a glance in the audit trail.

**The line between `admin` and `superadmin` is reversibility.** Everything an admin may do can be undone — a suspension lifted, a status restored, a password reset again. The two withheld capabilities cannot be: `users:role:write` can mint another administrator, and `users:delete` destroys data. Confining escalation to the super admin is what stops a compromised admin session widening itself; confining deletion is what stops it erasing the evidence of having tried.

That relationship is **structural, not conventional**. `SUPERADMIN_PERMISSIONS` is defined as `[...ADMIN_PERMISSIONS, ...SUPERADMIN_ONLY_PERMISSIONS]`, so there is no second list to forget to update, and a test asserts the subset relation by reading the table rather than a copy of it.

### Acting on a *particular* account

A permission answers "may you do this action", not "may you do it to **this** account". `refuseIfProtected()` in `users.routes.ts` is the single place that answers the second question, and every account-management route calls it before doing anything:

1. **Nobody may manage the `superadmin` account** — not suspend, demote, password-reset or delete it. It is the account that can restore all the others, so a mistake here is the one with no way back.
2. **An ordinary `admin` may only act on plain `student` accounts.** Without this, an admin holding `users:password:reset` could issue themselves a working credential for a peer administrator — a lateral move against exactly the people who could stop a misbehaving admin.

### Staff-issued temporary passwords (Milestone 11)

`POST /admin/users/:studentId/reset-password` generates a 16-character password from `crypto.randomInt` and returns it **once**. It is never stored in readable form and is deliberately **absent from the audit entry** — the trail records that a reset happened and who did it, which is what matters afterwards; a test asserts the password does not appear in it. The alphabet omits `0`/`O` and `1`/`l`/`I`, because a password that is misread when dictated over the phone gets replaced by a shared one.

Every session for the account is revoked first: a reset exists because control of the account is in doubt, so leaving the current holder signed in would defeat it. `mustChangePassword` then holds the account on a forced-change screen that clears in exactly one place, the change-password route.

**That screen is a user-interface gate, not a security boundary.** The API remains reachable with the temporary password, exactly as with any working credential — what the flow guarantees is that the ordinary way through the product ends with a password only the student knows. The residual risk is deliberate and was the owner's call: the entrants are schoolchildren who frequently cannot reach the address they registered with, which is precisely when they need help. The mitigations are that the credential is short-lived in practice, single-purpose, fully audited, and cannot be issued for any account that holds a role.

`mocktests:write` (Milestone 7) is separate from `questions:write` for a reason worth stating: assembling and scheduling an assessment is a different job from authoring the questions in the bank, and — unlike authoring — it carries **the right to read every student's marks** for a test. Both sit with `admin` today, so splitting them buys nothing immediately; it means confining results-reading later is a one-line change to this table rather than a route audit. Students sit tests under the existing `exam:take`, which is a student-level permission and therefore stateless: the mock-test attempt routes do no extra database read to authorize, and ownership is enforced by putting `student` in every query.

`questions:delete` (Milestone 4) is separate from `questions:write` because it is the only question-bank action that **destroys** data rather than changing it. Archiving — the normal removal path, and reversible — needs only `questions:write`. Both currently sit with `admin`, but splitting them now means restricting deletion later is a one-line change to this table rather than a route audit.

`questions:read` is held by every student and now also gates the taxonomy reads (`GET /subjects`, `GET /topics`): a practice or exam filter is built from those lists, and they carry no answer data.

### How a request is authorized

`requirePermission('...')` returns a chain: `authenticate → (ensureDb → freshRoleCheck) → permissionCheck`. The bracketed steps run only for a permission no `student` holds.

- **The token's `role` claim is a hint, not the authority.** For any privileged request the caller's `role`, `status` and `tokenVersion` are re-read from MongoDB and the database value decides. A demotion or suspension therefore takes effect immediately rather than at the end of the 15-minute access-token lifetime — the moment it matters most.
- Student-level requests stay stateless (no database read), so the common path is unchanged in cost.
- `callerCanFresh()` applies the same guarantee to in-handler decisions, used by `GET /analytics/:studentId` for reading someone else's record.
- Losing standing also revokes sessions: a role change or a suspension revokes every refresh token and bumps `tokenVersion`, so old access tokens are refused and cannot be refreshed.
- `verifyAccessToken()` rejects any token whose `role` is not a recognised role, so an absent or unknown role can never reach a permission lookup.
- **Lateral protection**: an ordinary admin cannot change the status of an account that holds a role (only a super admin can), and nobody can change their own role or their own status.
- Roles cannot be self-assigned at registration: the handler picks fields explicitly, the zod schema strips unknown keys, and `role` defaults to `student` in the schema.

Verified by `backend/tests/rbac.test.ts` (62 tests), which drives the escalation attempts directly rather than through the UI. See [`TESTING.md`](TESTING.md).

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

**Still open, but narrower than this document previously claimed.** There is no CSRF token mechanism, and in production cookies are `sameSite: 'none'`, so a browser *will* attach them to a cross-site request.

The practical exposure was re-examined on 2026-08-11 and is **smaller** than the earlier wording implied, because of two incidental defences:

- **Only `express.json()` is mounted** — there is no `urlencoded` parser. A cross-site HTML form can only send `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`, none of which `express.json()` parses, so the body arrives empty and validation returns 400.
- **CORS uses an explicit origin allow-list.** A cross-origin `fetch` carrying `Content-Type: application/json` is not a simple request, so it is preflighted, and the preflight fails.

Together those mean every route needing a JSON body — the profile edit, the password change, the role and status changes, practice submission — is effectively protected today. `PATCH`, `PUT` and `DELETE` are additionally never simple methods, so they are always preflighted regardless of body.

**What remains genuinely exposed** is the set of `POST` routes that need no body: `/auth/logout`, `/auth/logout-all` and `/auth/refresh`. A hidden auto-submitting form can trigger those cross-site. The consequence is session nuisance — someone can sign you out — not data modification or account takeover.

This is still worth fixing, and it is **not** the emergency the previous wording implied. Note that the defences above are incidental rather than designed: adding a `urlencoded` parser, or loosening the CORS allow-list, would silently remove them. A double-submit cookie or header-based token remains the correct fix.

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

One upload exists as of Milestone 4: the mandatory registration photo on `POST /auth/register`. It is carried as a base64 data URL inside the JSON body (see [`DECISIONS.md`](DECISIONS.md)), not as multipart, so it goes through the same zod validation as every other field.

Controls in place:

- **Size** — 2 MB decoded, enforced in the zod schema and again as a `max` on the `StudentPhoto.size` path. Separately, `express.json` grants its larger 2.8 MB limit **only** to the registration path; every other endpoint keeps body-parser's 100 KB default, so a large-payload flood has one rate-limited door rather than the whole API.
- **Type** — an allow-list of `image/jpeg`, `image/png`, `image/webp`. The client controls the MIME type in the data URL, so it is **not trusted**: the decoded bytes' magic bytes are checked against it. Without that, `data:image/png;base64,<any bytes at all>` would be stored and later served back under an image content type.
- **Serving** — `GET /students/:studentId/photo` sets the stored `Content-Type` explicitly and the app sends `X-Content-Type-Options: nosniff` (helmet), so a browser will not re-interpret the bytes as something executable. `Cache-Control: private` keeps personal data out of shared caches.
- **Access** — a student may read only their own photo; anyone else's needs `students:read`, re-read from the database per request rather than taken from the access token.

Not done, and worth knowing: the image is **not** re-encoded or stripped of metadata, so EXIF (including any GPS tags a phone camera wrote) is stored and served as uploaded. Nor is it scanned for malware. Re-encoding through an image library would address both and is the obvious next step if photos are ever exposed beyond staff and the student themselves.

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

## Answer-key exposure — fixed in Milestone 4

Before Milestone 4, `GET /api/v1/questions` had **no authentication middleware at all** and returned raw Mongoose documents. The old `Question` model stored the answer in a `correctAnswer` field, so **anyone on the internet could fetch the answer key** for every question in the bank with a single unauthenticated request. Nothing exploited it only because no page ever called the endpoint and the bank held nothing but template placeholders.

Three things now stand between a student and the answers:

1. **The endpoint is authenticated.** `requirePermission('questions:read')` — a guest gets 401, asserted on both `/api/v1` and the unversioned `/api` alias.
2. **The response is an allow-list that omits every answer field.** `studentQuestionView` in `questions.routes.ts` builds the payload field by field: options carry only `key` and `text`, and `isCorrect`, `solution`, `booleanAnswer`, `numericAnswer` and `tolerance` are never included. Adding one is a deliberate edit, not an accident of returning a document. Tests assert none of those names appears in the body.
3. **The author view is a separate function.** `adminQuestionView` (which does include the answers) lives in a different file behind `questions:write`. Deliberately two functions rather than one with an `includeAnswers` boolean — a boolean parameter is one mistaken argument away from serving the answer key to students; two functions cannot be confused at a call site.

Related: unpublished questions are invisible to students, and a student asking for a draft by id gets **404, not 403** — 403 would confirm that a draft with that id is being prepared.

## Mathematical content

Question content is stored as **plain text with LaTeX islands** (`$…$`, `$$…$$`). It is never stored as HTML and never rendered through an HTML sink.

The safety property is a split, not a sanitiser:

- **Prose** is rendered as a React text node, which React escapes. Author text therefore cannot become markup, because it never takes the HTML path at all.
- **LaTeX** is compiled by KaTeX, and only KaTeX's own output is inserted as HTML. KaTeX runs with `trust: false` (its default, set explicitly in `MathText.tsx`), which refuses `\href`, `\url` and `\includegraphics`.

So the only HTML on the page is HTML KaTeX generated from a restricted grammar. That does not depend on sanitising anything.

The storage boundary enforces the same rules independently (`backend/src/lib/mathContent.ts`), so a second consumer — an export, an email, a future PDF generator — inherits them instead of re-deriving them:

- **Balanced delimiters**, with `\$` for a literal dollar sign; unclosed or empty math is refused.
- **Forbidden LaTeX commands**: `\href`/`\url` (inject a link into what should be an equation), `\input`/`\include`/`\write`/`\openout`/`\read`/`\includegraphics` (file and I/O access in a real TeX pipeline — harmless in KaTeX, catastrophic if the content is ever fed to one), and `\def`/`\let`/`\newcommand`/`\csname`/`\expandafter`/`\catcode`/`\loop`/`\repeat` (macro expansion, which enables exponential-expansion denial of service in the reader's browser).
- **Markup and event handlers** (`<script`, `<iframe`, `javascript:`, `on…=`) are refused anywhere in the text. They cannot execute given the rendering split above, but their presence means either an attack attempt or a confused author.
- **Control characters** are refused; math islands are length- and count-capped (500 chars each, 40 per question) as a cheap complexity bound.

Relying on one render-time flag for a stored-content guarantee is the kind of single point of failure that stops being true when someone adds MathJax or flips a default, which is why both halves exist. Verified in a real browser: a `<script>` tag in a question produces **zero** script elements in the DOM and displays as escaped text; unparseable LaTeX shows its own source flagged in red rather than a blank.

## Self-service account changes (Milestone 5)

Three routes now let a student change their own account, so each was given a gate of its own.

**Profile editing** (`PATCH /me/profile`) accepts only the nine descriptive fields. `email`, `mobile`, `studentId`, `role`, `status`, `isEmailVerified` and `tokenVersion` are **absent from the zod schema**, not filtered out in the handler — `validate` replaces the body with the parse result, so extra keys in a request cannot reach the update. A test posts all of them alongside the legitimate fields and asserts none changes. The email address and mobile number are excluded deliberately: both are unique login identifiers and `email` anchors password reset, so a one-request change would be an account-takeover primitive (set the address, then use "forgot password"). Changing them safely needs a confirm-at-the-new-address flow, which is not built — see [`DECISIONS.md`](DECISIONS.md).

**Password change** (`POST /me/change-password`) requires the **current** password even though the caller already holds a valid session. That is the point: without it, a borrowed or stolen session could lock the real owner out of their own account. On success every refresh token is revoked and `tokenVersion` is bumped, then the calling device is issued a fresh session — so other devices are evicted while the student is not signed out of the page they are standing on. A wrong current password returns 401 and deliberately **does not** touch the failed-login counter: letting a wrong guess lock the account would hand any borrowed session an easy denial of service against the owner. The audit entry records that a change happened and never the password; a test asserts neither value appears in the stored document.

**Photo replacement** (`PUT /me/photo`) reuses registration's validation unchanged — ≤2 MB, with the declared MIME type checked against the file's **magic bytes** rather than trusted. It is now one of only two paths granted a body limit above body-parser's 100 KB default; both the `/api/v1/me/photo` and `/api/me/photo` forms are listed in `app.ts`, because a limit holding on only one prefix would be bypassed by using the other. Both it and the password route sit behind a dedicated `accountUpdateLimiter` (20/hour) rather than only the general `/api` limiter.

Photos still are **not re-encoded**, so EXIF (including any GPS tags a phone wrote) survives a replacement exactly as it survives a registration upload — unchanged from Milestone 4, and still open.

**The audit trail now records self-service changes** (`student.profile.updated`, `student.photo.updated`, `student.password.changed`). Metadata names the changed **field names only**: the trail is readable by anyone holding `audit:read`, so a student's home address and date of birth are not copied into it. A test asserts the address value is absent.

## Public data exposure (Milestone 5, extended in Milestone 10)

`GET /leaderboard`, `GET /hall-of-fame` and `GET /public/stats` are readable **without authentication** — an explicit decision by the project owner, taken so the landing page shows a real standing rather than the invented one it carried. What bounds the exposure:

- Names are published as a **first name plus a last initial** ("Ishaan V."), never in full. The entrants are children in classes 5–12 and the landing page is public and indexable, so a full legal name beside a school and a class would identify a minor to anyone on the internet. `displayNameFor()` in `services/leaderboardService.ts` is the single place that decides this — the Hall of Fame publishes through the same function, so Milestone 10's four new boards did not add a second answer to "how much of a child's name does this product publish?". Widening it is a deliberate one-line change and the owner's call.
- No email address, mobile number, home address, date of birth or parent name is in the payload. Tests stringify the **whole** response body and assert the surname, email address, mobile number and address are absent — not just that the fields the page reads are clean.
- `limit` is validated and **capped at 50**.
- **Depth is capped for an anonymous caller at the first 100 rows** (403 beyond), which is what keeps a *paginated* leaderboard from being walked to enumerate the roll. Milestone 5's page-size cap achieved that on its own; pagination removed the guarantee, so it was restored explicitly rather than lost as a side effect. A signed-in student may page the whole board — they are already part of this list and need to find themselves in it. See the ADR in [`DECISIONS.md`](DECISIONS.md).
- **No request may supply a ranked value.** XP, score and rank are absent from the leaderboard query schema rather than filtered out by the handler, and `validate()` replaces `req.query` with the parse result, so an injected key cannot reach the service. There is no write method on either resource. Tested.
- The leaderboard uses `attachUserIfPresent`, which attaches session claims when a cookie is present and **never rejects**. It grants nothing and must not be used as a gate: what it enables is a *presentation* difference (own standing, depth cap) on one public endpoint, rather than a second authenticated ranking surface that could disagree with the first.
- Suspended and deactivated accounts are excluded, filtered before the limit is applied, on every board.
- `studentId` **is** returned, so a client can identify its own row. It is a public-facing identifier by design (it appears on certificates) rather than a secret — but note it is the parameter for `GET /students/:studentId/photo`, which remains gated on being that student or holding `students:read`, re-checked against the database.

`/public/stats` returns only aggregate counts, which cannot be resolved to an individual.

## Remaining Gaps, in priority order

1. **CSRF tokens** — the clear top gap, and more pressing again after Milestone 5: alongside the administrative state-mutating routes, there are now student-facing ones on every account (`PATCH /me/profile`, `PUT /me/photo`, `POST /me/change-password`). The password route is partly self-protecting, since an attacker would also need the current password; the profile and photo routes are not. Production cookies are `sameSite: 'none'` because the apps are on different domains, so `sameSite` is not doing this job.
2. **Shared-store rate limiting** — current limits are per-instance and weak on serverless.
3. **Two-factor authentication** — not started, and now more valuable: an admin account is worth more than it was.
4. **`JWT_SECRET` rotation** — no mechanism; rotating it invalidates every session at once.
5. **Rate limiting on the administrative routes** — they sit behind the general `/api` limiter only, with no tighter per-route limit of their own. (The self-service account routes added in Milestone 5 do have one, `accountUpdateLimiter`; the admin routes still do not.)
6. **Changing your own email address or mobile number** — not possible at all, because doing it safely needs a confirm-at-the-new-address flow. Recorded here rather than only as a missing feature, because the reason it is absent is a security one.
7. **Pre-existing `npm audit` findings** in `@vercel/node`'s build-time dependency tree; fixing needs a breaking major upgrade.

---

## Answer integrity (Milestone 6)

The Practice Zone marks work, so the correct answers are the thing an attacker most wants and the thing a student most benefits from not having. Four properties, each enforced in exactly one place:

1. **Two views, never one with a flag.** `sessionInProgressView()` composes the shared answer-stripped `studentQuestionView`; `sessionReviewView()` is the *only* function anywhere that emits `correctAnswer` or `explanation`, and it **throws** unless the session status is `submitted`. An `includeAnswers` boolean was deliberately rejected, for the same reason the two question views were kept separate in Milestone 4: one call site passing the wrong value becomes a silent leak, whereas a function that refuses cannot.
2. **Grading is server-side.** The browser is never given the answer key, so it cannot mark its own work even dishonestly. Every response is scored from the session document by `gradeSession()`.
3. **The key is snapshotted at draw time.** The session stores the correct options, boolean and numeric answers, marks and negative marks as they were when the paper was drawn. Editing or archiving a question afterwards cannot retroactively change a graded paper, nor make an in-progress one ungradeable.
4. **Ownership is checked on every read and write.** A session belonging to another student is reported as **404, not 403** — a 403 would confirm the id exists, which is an enumeration oracle over session ids.

Asserted by tests: no `isCorrect`, `solution`, `numericAnswer`, `booleanAnswer` or `tolerance` appears in the start, resume or save responses; review is refused before submission; another student's session is indistinguishable from one that does not exist; and a session cannot be submitted twice.

## Answer integrity under a disclosure policy (Milestone 7)

Mock tests keep all four properties above and add a fifth condition, because "submitted" is no longer sufficient authority to reveal an answer — **the test's own `reviewPolicy` decides**, and it may say `after_close` or `never`.

- `disclosureFor()` is the only place either disclosure setting is interpreted. It refuses everything for an unsubmitted attempt first, as a floor, before consulting the policy at all.
- `attemptReviewView()` is the only function that emits `correctAnswer` or `explanation` for a mock test, and it throws unless the attempt is submitted **and** the policy currently permits it. Three response shapes therefore exist — full review, score without answers, and submitted-with-nothing-released — rather than one shape with fields the page is trusted not to render.
- A withheld score is `null` in the history view and **absent** from the attempt payload, not merely hidden by CSS or a conditional render.
- The policy is read live rather than snapshotted onto the attempt, so an administrator can release results after the window closes or withdraw a review released too early.

Tests stringify whole response bodies and require the forbidden names and the literal correct values to be absent — including *after* submission when the policy is `never`, and while the window is still open when it is `after_close`. That case is new: every earlier surface in this codebase could reveal an answer as soon as the work was graded.

## Timing integrity (Milestone 7)

A timed assessment has a second thing worth attacking: the clock. The rule is that **no client-supplied time is ever read**.

- `MockTestAttempt.expiresAt` is computed server-side when the attempt is created and stored. Every timing decision compares it against the server's own `Date`.
- An answer arriving after `expiresAt` is refused with 409 and **not stored** — not stored late, not stored and discarded at grading.
- A submission arriving after `expiresAt` is still graded, but *as at the deadline*: `submittedAt` is clamped to it, so `timeTakenSeconds` can never exceed the duration the test allowed.
- No request body on any mock-test route contains a time field. A test posts `expiresAt`, `secondsRemaining`, `durationMinutes`, `timeTakenSeconds` and `startedAt` alongside a legitimate answer and asserts the stored deadline, start time and duration are unchanged — the schema simply has no such fields, and `validate` replaces `req.body` with the parse result, so they cannot reach a handler.
- The countdown in the browser is a display derived from `secondsRemaining`. Tampering with it, pausing the tab or running a wrong system clock changes nothing about the mark.
- Exactly one submission is guaranteed by a conditional write (`status: 'in_progress'` in the update filter) rather than a read-then-write check, which on a serverless platform can straddle two invocations. A concurrent-submission test asserts one grading and one XP award.

## Reward integrity (Milestone 8)

The daily challenge is the one feature whose purpose is a **repeatable daily reward**, which makes "claim it twice" the obvious thing to try. It is guarded twice over, by two independent unique indexes in two different collections:

- `DailyChallengeAttempt {student, day}` — a second attempt for the same competition day cannot be inserted at all.
- `StudentActivity {student, type, dedupeKey}` — `recordActivity()` caps `daily_challenge_completed` at once per day, independently of whether an attempt exists.

Neither is a check the code performs; both are constraints the database enforces, so two concurrent submissions cannot both pass. The API answers a repeat with **200 and `alreadyAnswered: true`** rather than an error — the student really has answered today — and reports `xpAwarded: 0`, because the figure a client displays must be what *this* request awarded rather than what the stored attempt is worth. (Reporting the latter was a real defect caught by a test: the ledger stayed correct while the page could show "+15 XP" on every press.)

**The day is never client-supplied.** No daily-challenge route accepts a day, so a student cannot name yesterday to claim a missed reward, and a browser in another timezone cannot disagree about which challenge is today's. The day comes from `lib/competitionDay.ts`, an IST calendar day, and it is what both guards key on.

**A blank submission is refused**, not stored — otherwise pressing Submit on nothing would claim the day.

## Reward integrity (Milestone 9)

Every XP grant in this backend goes through one function, `grantReward()`, and that is a security property as much as an architectural one: a reward path that can be reached by five different routes each applying their own rule is a path where one of them is eventually wrong, and a wrong reward is invisible until a student notices their total does not add up.

- **One entry point.** Routes cannot write an activity row; `recordActivity()` is reachable only from the engine and the backfill script. A route supplies facts about what happened and never an amount.
- **One pricer.** `lib/xp.ts` plus any administrator override, resolved in one place. `recordActivity` accepts an `xpOverride` and the engine is the only caller permitted to pass it — the one loophole through which an amount could be invented, so the rule is stated on the parameter itself.
- **Duplicate grants are refused by the database, not by a check.** The partial unique index on `StudentActivity {student, type, dedupeKey}` decides; the engine reports the outcome. Tested with concurrent grants, because a read-then-write check would pass a sequential test and fail a real one.
- **Ineligible events leave no trace.** An attempt with nothing answered is refused before any write, so there is no row to suggest a reward was earned.

**Configuration cannot rewrite history.** `RewardSettings` tunes what future events pay. It cannot alter a single point anybody already holds, because `StudentActivity.xpAwarded` is a snapshot taken at grant time and a total is the sum of those recorded values. This is worth stating in a security document rather than only a design one: it means the `rewards:write` permission is a *balancing* capability, not a way to inflate or erase a student's standing. `rewards:write` is nevertheless kept separate from the other authoring permissions precisely because it changes what every future event is worth for everybody at once.

## Handling of database credentials

`backend/.env` holds the production Atlas URI, including its password. Two operational points that are security-relevant rather than merely awkward:

- **Never paste a connection string into a chat, an issue or a screenshot.** It grants full read/write access to production data. If one is exposed, rotate it immediately: Atlas → Database Access → Edit → Edit Password → Autogenerate, then update `backend/.env` **and** the Vercel environment variable, which are configured independently of each other.
- **Scripts print a redacted URI.** `redactUri()` in `lib/envGuard.ts` strips credentials before any script logs its target, so script output can be shared safely. `where-is-data.ts` and the three write scripts all use it.
