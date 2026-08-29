# SECURITY.md

_Last updated: 2026-08-17 (complete security audit)._

Reflects the actual state of the code. Fix items here before building new features on top of them.

> **Milestone 23 (the UI/UX modernisation, Phases A–H) changed nothing in this file.** No
> authentication, authorization, validation, CORS, CSRF or rate-limiting code was touched — no
> backend file was modified in any of the eight phases. Two properties it *relies* on were
> re-verified in the browser during the Phase H regression, because a redesign is exactly where they
> could have been broken by accident. The leaderboard and the public referral check still publish a
> **masked** name (`displayName` — "Asha V.", "Regression H."), and an in-progress practice paper
> still carries **no correctness at all**: the payload for session `6a9255a1...` contained no
> `isCorrect`, no `solution`, no `numericAnswer` and no `booleanAnswer`, and its option objects were
> empty of any key beyond what a student needs to answer. The entry-fee paywall was **not**
> exercised, because the local database has no exam scheduled and `requireEntry` is mounted only on
> `POST /exams/:id/attempt` — it is covered by the backend suite, which is unchanged. The one
> client-side change with any security surface is that a failed answer save now **rolls back**
> rather than displaying an answer the server does not hold — a correctness fix, not a boundary
> change.


## Image import and the model boundary (Milestone 21, Phase E)

The image path is the only importer that sends anything to a third party, so what it sends is
worth stating precisely: **one image the examiner chose, plus a fixed instruction.** Nothing
else. No student data, no account identifiers, no question bank contents — there is a test that
registers a real student and then asserts the request body contains none of their fields.

The same three rules the question generator follows apply unchanged, and they are enforced in
shared code rather than restated here: the key travels as a header and never in a URL, every
message leaving the module passes through `redact()`, and the call goes through the one
`requestGeminiJson()` so there is no second client with its own habits.

**The image is untrusted input, and nothing in it is treated as an instruction.** A photograph
could contain text saying "ignore your instructions" — the defence is not prompt engineering, it
is that **nothing the model returns is trusted**: every transcription goes through
`createQuestionSchema` and the shared screener exactly as a hand-authored question does, and a
human approves each one before anything is written. There is no examiner-supplied free text in
this prompt at all, so the injection ordering the generator has to manage does not arise here.

**Cost is a security property on this route.** One model call **per image**, so a twenty-image
request is twenty calls — which is why `importLimiter` is mounted ahead of the permission check
(cheapest rejection first, and an unauthenticated flood must not reach the database read that
authorization performs) and why `MAX_IMPORT_FILES` and `MAX_IMPORT_REQUEST_BYTES` are bounded.

**What is deliberately not claimed**: the transcription is not verified. OCR of mathematical
notation fails quietly — a dropped exponent, a minus read as a hyphen — producing a question that
reads plausibly and is wrong. Every image import carries a standing warning saying so, and the
mandatory human review is the control. Nothing in the UI or the API may imply otherwise.

---

## The 2026-08-17 audit, in one page

The whole application — backend and frontend — was reviewed against authentication, authorization bypass, IDOR, privilege escalation, JWT handling, refresh tokens, password storage, CORS, CSRF, XSS, NoSQL injection, input validation, rate limiting, brute force, mass assignment, information and error leakage, file upload, payment and webhook handling, secret exposure, and administrative endpoint protection.

**Five findings were confirmed and fixed.** Each is described in its own section below.

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | **No CSRF defence.** Production cookies are `sameSite: 'none'`, and the routes that need **no request body** were reachable cross-site by a hidden auto-submitting form — including `POST /payments/orders`. | High | `middleware/csrf.ts`: `Origin`/`Referer` verified against the CORS allow-list for every state-changing method, mounted once for the whole API. |
| 2 | **`http://localhost:5173` was a permitted CORS origin in production**, so any page a visitor happened to be serving on that port could make credentialed cross-origin reads of live student data — and it was a permanently "allowed" origin for finding 1's fix. | Medium | Localhost is admitted only outside production. Fails closed. |
| 3 | **The public result and certificate lookups published entrants' full legal names**, keyed on `AMIT_0000`–`AMIT_9999` — ten thousand identifiers, walkable, returning more about the same children than the leaderboard is permitted to. | Medium‑high | Both publish through `displayNameFor()` now, and both are rate limited. The holder's own certificate is unchanged. |
| 4 | **The frontend deployment sent no security headers at all** — no `X-Frame-Options`, no `frame-ancestors`. An authenticated SPA with `sameSite: 'none'` cookies could be framed and clickjacked. | Medium | `frontend/vercel.json` now sets `X-Frame-Options`, CSP `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`. |
| 5 | **No rate limit on the routes with a third-party cost or a credential-issuing effect**: `POST /payments/orders`, `POST /payments/reconcile`, and the administrative password reset / session revocation / account deletion. | Low‑medium | `paymentLimiter`, `adminActionLimiter` and `publicLookupLimiter` (see "Rate Limiting"). |

**What was checked and found genuinely sound**, so a future reader does not re-derive it: the answer-key rules; grading and the timing model; the reward and ranking engines; the permission table and its fresh database re-check; `refuseIfProtected()`; the root-superadmin bootstrap and the escalation it refuses; refresh-token rotation and family revocation; password storage and the single `authenticateAccount()`; every Mongo filter built from zod-parsed values with escaped regexes; every upload validated by magic bytes; the payment signature, ownership and idempotency rules; and the KaTeX text/math split. No IDOR was found — every owner-scoped route puts the account in the **query** rather than checking it afterwards, and every route in `routes/v1/` carries a gate.

**Not verified in this pass, and honestly outstanding**: `npm audit` (see "Remaining Gaps"), and nothing was driven through a real browser.

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
| `content:reset` | — | — | **yes** |

**A certificate cannot be manufactured, by anybody.** There is no issuance endpoint: certificates are minted only as a side effect of releasing an official exam's results, from a graded attempt. No student and no administrator can nominate a recipient, which makes “the frontend must not manufacture certificate eligibility” true structurally rather than by validation — the frontend is never asked.

**Verification keys on a secret, not on the serial.** `certificateId` is readable and effectively guessable; `verificationCode` is 16 symbols (~80 bits) of `crypto` randomness. Keying public verification on the serial would be an enumeration oracle: anybody noticing that certificates are numbered sequentially could walk them and harvest the name, school and rank of every entrant. A **revoked** certificate reports as revoked rather than missing, and can no longer be downloaded — continuing to issue fresh copies would undermine the revocation.

**The official exam never leaks its answer key or an unreleased mark.** The served paper composes the shared `studentQuestionView`, so no hand-written projection can forget a field; submission returns **no score at all**; and a `Result` row is created only by the publication step, with `isPublished` in the query rather than filtered afterwards. An answer arriving after `expiresAt` is refused and **not stored** — a browser is free to keep its countdown running, which is precisely why the clock is never taken from a request.

## Notifications and email (Milestone 14)

**A per-student notification is a disclosure surface, and is treated as one.** `audience: 'student'` carries a score, a rank and a certificate tier, so `inboxFilter()` scopes it by `student` and nothing else. It is **absent from the staff composer's schemas** (`STAFF_AUDIENCES`) rather than filtered out in a handler, so no API a human drives can address one person. `isVisibleTo()` composes the same filter, which is what makes the inbox, the unread count and the mark-as-read check unable to disagree — a test drives two students in the *same* class to prove the audience clause holds independently of the class clause. A notification the caller may not see returns **404, not 403**: the route must not confirm that an id it will not show nevertheless exists.

**Queueing email closed a timing oracle.** `/auth/forgot-password` deliberately returns an identical message for a known and an unknown address so it cannot be used to enumerate accounts — but before Milestone 14 it *awaited a real SMTP round trip* only when the account existed. The wording was identical and the latency was not, which leaked exactly the fact the wording was hiding. Both paths now do one indexed insert and return.

**Security email is deliberately not a preference.** A password change, a status change and a role change always email the account holder, whatever their settings. That asymmetry is a control, not an oversight: the "your password was changed" message is the standard way somebody notices a stolen session and recovers the account with "Forgot password", so an option to silence it would be a feature for an attacker. `isOptionalCategory()` is the only place the distinction lives, and the switchable categories are absent from the update schema rather than ignored by it.

Note the rule order inside `emailAllowedFor()`: the **category** check runs before the **account-status** check, so a *suspension notice* still reaches the account it suspends. Reversing them would swallow the one message a suspended user must receive.

**The delivery console shows subjects, never bodies.** `/admin/email-deliveries` exists so a failed delivery is visible with the provider's own error text, but a delivery record has no business reproducing the contents of somebody's password-reset email to staff. Tokens are never logged outside the dev transport, as before.

**Broadcast volume is capped rather than unbounded.** `EMAIL_BROADCAST_CAP` is 500 and the cap is reported to the caller. This is a spam-and-reputation control as much as a cost one: a free-tier sender that suddenly emits a thousand messages is a sender whose deliverability collapses, and the entrants' addresses are frequently their parents'.

**The gallery is the only surface published to the open internet** (Milestone 12), which is why it holds its own permission rather than riding on `questions:write`: a mistake there is visible to anybody, not just to a signed-in cohort. Uploads are validated by **magic bytes** through the shared `imageDataUrl()` validator, so a file that merely *claims* to be a PNG is refused — a browser or a script controls the MIME type in a data URL, and trusting it would mean storing arbitrary bytes and serving them back with an image content type. Archiving stops the bytes being served, not just the listing, so a taken-down photo is genuinely gone for anyone holding the URL.

**`notifications:write` is narrow because it reaches everybody at once.** An announcement is visible to every matching student the moment it is published, and withdrawing one afterwards does not unsee it — so publication is audited as its own operation, distinct from an edit.

**A notification a student may not see returns `404`, not `403`.** Marking one read, or reading one addressed to another class, must not confirm that an id exists — otherwise the route becomes a way to probe the collection. The same reasoning as the answer-key rules elsewhere in this file.

**The super administrator cannot use the student login.** `POST /auth/login` refuses `role: 'superadmin'` with a `403` pointing at the administrator portal. The refusal is applied **after** the password is verified, and that ordering is load-bearing: refusing earlier would answer differently for the administrator's address than for any other, which is an account-enumeration oracle aimed at the most privileged account in the system. A caller who does not already know the password gets the same generic failure as for any other wrong guess, and no session is established either way.

**Staff do not hold competitor identifiers.** The bootstrap account's `studentId` is `ADMIN_xxxx`, not `AMIT_xxxx`. There are only ten thousand `AMIT_` numbers and they are what a child writes on an exam paper, so staff are not given one — and the namespace makes a staff actor obvious at a glance in the audit trail.

**The line between `admin` and `superadmin` is reversibility.** Everything an admin may do can be undone — a suspension lifted, a status restored, a password reset again. The three withheld capabilities cannot be: `users:role:write` can mint another administrator, `users:delete` destroys an account, and `content:reset` (Milestone 22) empties a whole content area — the question bank included. Confining escalation to the super admin is what stops a compromised admin session widening itself; confining deletion is what stops it erasing the evidence of having tried.

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

- Explicit origin allow-list built from `FRONTEND_URL`, with `credentials: true`. It **never** falls back to reflecting an arbitrary origin.
- **`http://localhost:5173` is admitted only outside production** — changed by the 2026-08-17 audit (finding 2). It used to be unconditional, which meant the deployed API accepted credentialed cross-origin requests from *any* page a visitor happened to be serving on that port of their own machine: a development server left running, or anything they were talked into starting. That is a genuine cross-origin read of a signed-in student's data, and it also punched a permanent hole in the origin check below, because `localhost:5173` would always have counted as an allowed origin for a forged request.
- With `FRONTEND_URL` unset in production the list is now **empty**, which fails closed: no cross-origin request is allowed at all. The deployed site is unaffected either way, because the frontend proxies `/api/*` through a Vercel rewrite and the browser therefore never issues a cross-origin request to this backend. The startup log already reports the misconfiguration as an error, because the same variable builds every emailed verification link.
- The allow-list is also what the CSRF check below is made against, derived from `config.cors.origins` rather than copied, so the two cannot drift apart.

## CSRF

**Closed on 2026-08-17** (audit finding 1) by `backend/src/middleware/csrf.ts`, mounted once in `app.ts` for the whole API.

### What was actually exposed

Production cookies are `sameSite: 'none'`, because the frontend and backend are on different Vercel domains, so a browser attaches a signed-in student's session to a request issued by any other site. Two **incidental** defences narrowed that and had been relied on:

- **Only `express.json()` is mounted** — there is no `urlencoded` parser. A cross-site HTML form can only send `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`, none of which `express.json()` parses, so the body arrives empty and validation returns 400.
- **CORS uses an explicit origin allow-list.** A cross-origin `fetch` carrying `Content-Type: application/json` is not a simple request, so it is preflighted, and the preflight fails.

Both are real, and **neither covers a route that needs no body at all**. A hidden auto-submitting form reaches those with no preflight and nothing for the JSON parser to refuse: `POST /auth/logout`, `/auth/logout-all`, `/auth/refresh`, `/payments/orders`, `/payments/reconcile`, `/me/notifications/read-all` and `/me/notifications/:id/read`. The earlier wording here called that "session nuisance", which was accurate in Milestone 5 and stopped being accurate in Milestone 19: the list now includes creating a payment order against a student's account.

### The defence

For every `POST`, `PUT`, `PATCH` and `DELETE` under `/api` (both prefixes — the gate is mounted before the router, so the alias cannot be used to step around it):

1. If an `Origin` header is present, its host must be in the allow-list, or equal to the request's own host.
2. If `Origin` is absent, `Referer` is checked the same way. `Referer` is second because a page can suppress it with a referrer policy and cannot suppress `Origin`.
3. If neither is present, the request is allowed.

Reads are not policed: a cross-origin read is already governed by CORS, and refusing `GET` would break ordinary clients while protecting nothing.

### Why this works, and why rule 3 is not a hole

A browser sends `Origin` on **every** request whose method is not `GET` or `HEAD`, including a cross-site form post, and `Origin` is a forbidden header name — page script cannot set or strip it. So a browser-issued cross-site state change always arrives with an `Origin` this backend can judge, and `Origin: null` (a sandboxed iframe, a `data:` document) is not a URL and is therefore refused rather than treated as absent.

A request with neither header is not browser-issued, and CSRF is by definition a browser attack: the attacker's leverage is *the victim's browser attaching the victim's cookies*. Refusing those would break every API client — `curl`, the test suite, and Razorpay's server-to-server webhook, which is separately authenticated by an HMAC over its raw body — while protecting nobody.

Comparison is on **host**, not full origin, so a TLS-terminating proxy deciding what scheme this process sees cannot break the check. An attacker controls neither the host nor the port.

### Why not a double-submit token

A double-submit cookie is the other standard answer and remains a reasonable second layer. It is deliberately **not** stacked on top of this, for two reasons worth writing down rather than rediscovering: it buys nothing over the origin check for browser-issued requests, which is the only category CSRF has; and it requires every client to read a cookie and echo it in a header, which is a change to 610 call sites in the test suite and to every future API consumer. If it is added later, the right shape is a non-`httpOnly` `csrf_token` cookie issued alongside the session and required in an `x-csrf-token` header — not a replacement for the origin check.

### What this does not cover

- A browser that omits `Origin` on a cross-site unsafe method. No current browser does; a sufficiently old one would be admitted.
- Anything reachable with no ambient session — login, registration and password reset are unaffected either way, because an attacker forging them supplies the credentials themselves.

### Frontend delivery headers

Fixed at the same time (finding 4). `frontend/vercel.json` previously set **no** security headers, so the signed-in SPA could be framed by any site — the classic pairing with `sameSite: 'none'` cookies, because the frame is authenticated. It now sends:

| Header | Value | Why |
|---|---|---|
| `X-Frame-Options` | `DENY` | Clickjacking. Nothing in this product is meant to be framed. |
| `Content-Security-Policy` | `frame-ancestors 'none'` | The modern form of the same control, which `X-Frame-Options` no longer covers everywhere. Deliberately **only** `frame-ancestors`: a `default-src` policy would have to enumerate Google Fonts, unpkg and Razorpay's checkout, and a CSP written blind is a broken page rather than a safer one. |
| `X-Content-Type-Options` | `nosniff` | Matches what `helmet` already sends from the API. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | A URL in this app can name a student's own resources; it should not travel to third-party sites in full. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Nothing here uses them. `payment=()` is deliberately **absent** — Razorpay's checkout can use the Payment Request API, and disabling it would break paying. |

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
| self-service account changes (`accountUpdateLimiter`) | 20 / hour |
| practice start/submit | 120 / hour |
| mock-test start/submit | 60 / hour |
| daily challenge | 30 / hour |
| **`payments/orders`, `payments/reconcile`** (`paymentLimiter`) | 30 / hour |
| **admin password reset / revoke-sessions / delete** (`adminActionLimiter`) | 60 / hour |
| **`results/:studentId`, `certificates/:studentId`** (`publicLookupLimiter`) | 60 / 15 min |

The email-sending endpoints are tightest because each request consumes a third-party mail quota as well as touching an account. `/health` and `/ready` are mounted before the limiter so monitoring probes are never throttled.

The last three arrived with the 2026-08-17 audit (finding 5) and each closes a different kind of hole. The **payment** routes are the only place in this product where one request has a direct third-party cost: neither takes money, but each spends a Razorpay API call and the first writes a row, so an authenticated student could otherwise loop them for free at the platform's expense. The **administrative** ones are the acts whose damage scales with repetition — above all the staff password reset, which mints a *working credential* for another account, so a stolen admin session looping it is how a whole cohort gets taken at once. Administrative *reads* are deliberately not limited: staff legitimately page through hundreds of accounts, and throttling that would only teach them the console is broken. The **public lookups** are keyed on an identifier with ten thousand possible values, so bounding the walk is a second line behind the name masking described under "Public data exposure".

Two caveats, and the second is worse than the first:

- Limits are **per instance** and held in memory. On Vercel's serverless platform each cold container has its own counters, so effective limits are looser than the numbers above. A shared store (e.g. Redis) would be needed for strict enforcement — not free-tier friendly, so deferred.
- **`trust proxy` is not set, so `req.ip` is the connection's peer, not the caller.** Behind Vercel's proxy that is very likely a *constant*, which means every per-IP limiter is effectively a single shared bucket: a handful of failed logins from anyone could exhaust the login limiter for everybody, and the `ip` recorded on audit entries and refresh tokens is not the caller's address. This was examined during the audit and deliberately **left alone**, because the obvious fix is worse than the problem: setting `trust proxy` makes `req.ip` come from `X-Forwarded-For`, and if the platform *appends* to that header rather than overwriting it, an attacker can put any value in front and bypass every per-IP limit at will. Changing it needs a verified answer to "does this platform overwrite `X-Forwarded-For`?" and a test proving a spoofed header does not move `req.ip`. Until then the current setting fails toward shared throttling rather than toward no throttling, which is the right direction.

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

**Razorpay, integrated in Milestone 19 (2026-08-16).** Signature verification was implemented from day one, as this section previously required. CSRF was not — see the note at the end.

**The browser is never believed about money.** It may ask for an order and report back three ids; it can never assert that a payment succeeded, how much was paid, or what was bought.

- **The amount is never accepted from a request.** `POST /payments/orders` has no request body at all: the amount comes from the `PaymentSettings` document and the student from the token's `sub`. A client-supplied amount is how a ₹199 fee gets paid as ₹1.
- **Both capture paths verify an HMAC-SHA256 signature** computed with `RAZORPAY_KEY_SECRET`, compared with `crypto.timingSafeEqual`. A `===` comparison leaks, through timing, how many leading characters an attacker guessed right, turning forgery into a character-at-a-time search; lengths are compared first because `timingSafeEqual` throws on a mismatch and a digest length is not a secret.
- **A signature proves a payment is genuine, not that it is yours.** Ownership is checked separately against the token — without it, a student could verify somebody else's order and, since the entitlement is keyed on the row's `student`, hand *them* the entry while appearing to have paid. There is a test.
- **The webhook verifies the raw request body**, which is why `app.ts` preserves it. `JSON.parse` followed by `JSON.stringify` does not reproduce the bytes Razorpay signed — key order, whitespace and unicode escaping all differ — so verifying against a re-serialised object fails for legitimate webhooks, and the predictable "fix" for that is to stop verifying. With no `RAZORPAY_WEBHOOK_SECRET` set, **every** webhook is refused: an unverifiable webhook is an anonymous request that grants entitlements.
- **The webhook never creates a payment.** An order this server did not create belongs to nobody, so it is acknowledged and dropped.
- **Capture is idempotent** by conditional write, so a replayed webhook changes nothing, and a late `payment.failed` cannot revoke a capture.
- **The signature is never returned to any client.** It is derived from the secret, so publishing it would be an oracle for whether an order/payment pair is genuine.
- **The key secret never leaves the process.** Only `RAZORPAY_KEY_ID`, which is public by design, reaches the browser — and it is sent by the server rather than built into the bundle, so the two cannot drift apart.

**The paywall itself is an authorization surface**, not just a commercial one: `middleware/requireEntry.ts` gates **the official Olympiad, and nothing else**. (It briefly gated practice, mock tests and the daily challenge too, on 2026-08-16; the owner reversed that the next day — a student prepares for free and pays only to compete. An earlier revision of this line still described the wider version.) It runs **before** the resource is looked up, so an absent id returns 402 rather than 404 — otherwise an unpaid caller could probe which exams exist. It is derived from the payment record on every request, never from a stored flag and never from anything the client sends.

**CSRF here: closed on 2026-08-17.** This document had said a token should land before payments, and it did not. `POST /payments/orders` and `POST /payments/reconcile` are authenticated, state-mutating and take **no request body**, which is exactly the shape the incidental JSON-only defence never covered — a hidden auto-submitting form reached both. The realistic harm was a forced order creation (which takes no money and creates a `created` row) rather than a forced payment, but "an attacker can make orders appear against a child's account" is not something to leave standing. Both are now behind the origin check described in the CSRF section, and behind `paymentLimiter`.

**Payments and the origin check.** Razorpay's checkout runs in an iframe on our own page, so the `POST /payments/verify` that follows a successful payment is issued by our origin and passes. The **webhook** arrives server-to-server with no `Origin` and no `Referer`, so the origin check does not apply to it — correctly, because it is authenticated by an HMAC over its raw body instead, and refusing it for lacking a browser header would break the only push path we have.

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

### The result portal and the public certificate listing (fixed 2026-08-17)

`GET /results/:studentId` and `GET /certificates/:studentId` are unauthenticated on purpose — a parent or a school checking a child's result should not need an account — and the three properties recorded above still hold: only `isPublished` rows are visible, "no such account" and "no published result" are byte-identical answers, and no email, mobile, address or date of birth is in the payload.

What the audit found is that they answered the *name* question differently from everything else public. Both were returning the **full legal name**, and both are keyed on `AMIT_0000`–`AMIT_9999` — ten thousand identifiers. Once results are released, that is a walk of the entire roll producing every entrant's full name beside their score, national rank and percentile: precisely the shape the leaderboard was given `displayNameFor()` and an anonymous depth cap to avoid. It was never a decision anybody took; it was two surfaces answering the same question two ways.

Both now publish through **`displayNameFor()`**, so there is still exactly one place this product decides how much of a child's name goes on a public page, and both sit behind `publicLookupLimiter`. A parent still gets enough to confirm the right child — a first name, a last initial, the student ID they typed in, and the marks. Widening it stays a one-line change and the owner's call.

**The holder's own certificate is unchanged.** `GET /me/certificates` and the PDF render from the certificate's own snapshot and carry the full name and the verification code, because that is the document in their hand. The `/certificate` page was pointed at that authenticated endpoint as part of this change; it had been calling the public one with its own student ID, which also meant it printed the database row id where the certificate serial belongs.

The **public verification** route (`GET /verify/:code`) still returns the full name, and correctly: it keys on 16 symbols of `crypto` randomness rather than on a walkable serial, so the caller is confirming a document they are holding.

## AI question generation (Milestone 17, hardened in Milestone 20)

The one place this product calls a language model. Five properties, all of them enforced in
`services/questionGeneratorService.ts` or `services/geminiQuestionGenerator.ts` rather than in a
route, so a second caller could not skip them.

**The credential never leaves the backend.** `GEMINI_API_KEY` is read only through the typed
`config` object, is sent to Google as the `x-goog-api-key` **header** rather than in a URL (a URL
is the thing most likely to end up in a log line, an error message or a proxy's access log), and
appears in no API response. It is not a frontend variable — the frontend reads no environment
variables at all, and anything placed in the frontend Vercel project would be compiled into a
public bundle.

**Provider errors are surfaced verbatim, which is only safe because they are scrubbed.** An
expired key, a spent quota, a blocked prompt and a retired model name need four different fixes
and only Google knows which happened, so the message reaches the examiner unedited — after
passing through `redact()`, which removes the API key from it. There is a test that fails if a
key can appear in an error body. No stack trace and no infrastructure detail is ever returned;
the route answers **502** (the provider failed) or **503** (no key configured, naming the
variable), never 500 with internals.

**No student data is sent.** The whole request is a subject name, chapter names, an optional
subtopic name, a class level, a difficulty, the marks, question text already in the bank, and the
examiner's own instruction. A test asserts the outgoing request body contains no student email,
`AMIT_` identifier, mobile number or password hash. Adding a second AI call means answering the
children's-privacy question again, from scratch, with the owner.

**The examiner's instruction is untrusted input, and the prompt is ordered accordingly.** It is
staff-authored, but it is still user-controlled text on its way into a prompt. Three things
contain it: every constraint that matters (class, chapters, subtopic, type, count, language,
marks, formatting rules, output shape) is stated as a **requirement before** the instruction is
reached; the instruction is introduced as a *preference* that explicitly cannot override any of
them; and the fence delimiter is **stripped out of the instruction text**, so it cannot close the
quotation early and continue as though it were the system talking. A test asserts both the
ordering and the fencing.

Prompt injection is nonetheless treated as *unpreventable in principle* rather than solved: the
real defence is that **nothing the model returns is trusted**. Every candidate passes
`createQuestionSchema` — the same schema and the same `validateMathContent()` a hand-authored
question passes, so a model cannot smuggle `\href`, HTML or a script tag into question text — the
taxonomy is attached from the request rather than from the response, and **nothing is stored
until a human approves it**. A successfully injected prompt can therefore produce a bad question
for a reviewer to reject; it cannot produce a stored one, a misfiled one, or an XSS sink.

**Cost is a security property here.** `POST /admin/generate-questions` is the only route whose
every call spends third-party quota, so `generationLimiter` (`GENERATION_RATE_LIMIT_PER_HOUR`,
default 60/hour/IP) is mounted **ahead of the permission check** — the cheapest rejection is the
right one, and an unauthenticated flood should not reach the database read that authorization
performs. `GENERATION_MAX_QUESTIONS` and `GENERATION_MAX_INSTRUCTION_CHARS` bound one request,
enforced in the zod schema so the browser cannot exceed them. Retries are conservative and
**ours, not the SDK's**: only 429/5xx/timeout, bounded by `GEMINI_MAX_RETRIES`, sharing one time
budget so a retry can neither inherit a spent deadline nor outlive a serverless invocation. A
rejected key or a retired model name is never retried — that would spend quota to receive the
same refusal.

**Provenance cannot be forged.** `Question.provenance` records which model wrote a question and
who approved it, and every field is read back from the server's own `GenerationLog` row using the
`logId` we issued — never from the request body. The one field worth lying about would be
`source`, and a client cannot set it: it cannot claim a model it did not use, and it cannot file
machine-written questions as hand-written ones.

---

## Remaining Gaps, in priority order

Items 1 and 5 of the previous list — CSRF and administrative rate limiting — were closed by the 2026-08-17 audit and now have sections of their own above.

1. **Dependency vulnerabilities are unverified as of 2026-08-17.** `npm audit` could not be run in the session that performed the audit, so the standing entry below is carried forward on trust rather than re-checked, which is exactly the state this document is supposed to make impossible. **Run `npm audit` in both `backend/` and `frontend/` and record the result here.** The previously-known finding is in `@vercel/node`'s *build-time* dependency tree, where fixing needs a breaking major upgrade; that is a different risk from a runtime dependency and should be recorded as such.
2. **`trust proxy` and `req.ip`** — every per-IP rate limit is effectively one shared bucket on serverless, and the `ip` on audit entries is not the caller's. Deliberately not changed, because the naive fix makes the limits spoofable. See the caveat under "Rate Limiting" for what a correct fix has to prove first.
3. **Shared-store rate limiting** — limits are per-instance and weak on serverless. Compounds item 2.
4. **Two-factor authentication** — not started, and now more valuable: an admin account is worth more than it was.
5. **`JWT_SECRET` rotation** — no mechanism; rotating it invalidates every session at once.
6. **Changing your own email address or mobile number** — not possible at all, because doing it safely needs a confirm-at-the-new-address flow. Recorded here rather than only as a missing feature, because the reason it is absent is a security one.
7. **A double-submit CSRF token** as a second layer behind the origin check. Optional rather than required — see "Why not a double-submit token" for the shape it should take if it is ever added.
8. **Registration photos are not re-encoded**, so EXIF (including GPS tags a phone camera wrote) is stored and served as uploaded. Unchanged since Milestone 4.
9. **Account lockout is a denial-of-service primitive against a known address** — five wrong guesses lock an account for fifteen minutes, and the address is the student's email. Accepted: the alternative is no lockout, which is worse, and the reset path is self-service.

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

---

## Refer & Earn (Milestone 22, Phase E)

A referral programme is a mechanism for paying money out, so it is an abuse surface by
construction. Six things carry it.

### The abuse rules are enforced by an index, not by checks

A unique index on `Referral.referred` is what makes **one referrer per registration**, **no
duplicate attribution** and **no changing who referred you afterwards** true at the same time.
A handler check would be a read followed by a write, and on serverless those land in different
invocations. There is also no route that re-attributes — attribution happens once, inside
registration, and nothing else writes a `Referral`.

### A referral converts on captured money, never on a registration

The hook runs inside `capturePayment()`, the single place a payment becomes real, and its own
update is conditional on the row still being `pending_conversion` — so a duplicate webhook, a
reconcile and a browser return journey arriving in the same second cannot accrue two rewards.

It deliberately does **not** call `hasEntryEntitlement()`, which returns `true` when the fee is
switched off. That function answers "may this student compete?"; "did money arrive?" is a
different question, and using the wrong one would pay out on every registration the moment an
administrator switched the paywall off.

### The code is not the student id

`AMIT_0000`–`AMIT_9999` is ten thousand identifiers and walkable in an afternoon — which is
exactly why the public result and certificate lookups had to be masked and rate limited. A
referral code is posted in WhatsApp groups and typed by strangers, so it gets its own value: six
characters from a 31-symbol alphabet, `crypto.randomInt`, ~30 bits.

### The public validate endpoint publishes a masked name

`GET /referrals/validate` has to be unauthenticated — the person following a referral link has
no account yet. Two things keep that safe: the name comes from `displayNameFor()` (the
leaderboard's masking, so "Rahul S."), and `publicLookupLimiter` bounds how fast codes can be
tried from one address. Without the masking this would be an endpoint that converts codes into
children's names.

A code also stops resolving the moment its owner's account is no longer `active`: a code is a
live invitation, and an account that has lost standing should not keep recruiting.

### No request may supply an amount

`rewardAmount` is snapshotted onto the referral at conversion, from the settings. The three
administrative routes only move a row along a fixed path — they cannot create a reward, choose
an amount, or pay somebody who was never introduced. A test sends `rewardAmount: 999999` to the
approve route and asserts the stored amount does not move. This is the same rule that keeps XP,
ranks and the entry fee out of request bodies.

### Approving and paying are two acts, and both are conditional writes

`accrued → approved → paid`, each a `findOneAndUpdate` naming the state it may move from. Two
administrators pressing "mark paid" at once produce one payout and one 409. Paying is not
reachable from `accrued`, so there is always one checkpoint between "this looks payable" and
"money has left", and every act writes an audit entry carrying the amount.

## The content reset (Milestone 22)

A button that empties the question bank is the largest single piece of damage anybody can do
through this application. Five things carry it, and they are deliberately of different kinds — one
authorization, one integrity, three human-error.

### `content:reset` is super admin only

It sits beside `users:delete` in `SUPERADMIN_ONLY_PERMISSIONS`, on the line that table already
draws: every other administrative act in this product is reversible and these are not. A
**compromised admin session cannot empty the question bank**, which is the whole reason the
permission exists rather than folding this into `questions:delete`. That permission removes one
never-published question and refuses anything a student could have seen; this one removes published
questions in bulk, and that is a different decision made by a different person.

Note that this **deliberately overrides** `deleteQuestion()`'s rule that a published question can
never be hard-deleted. Overriding a safety rule is exactly why the override is confined to one
role, needs a typed phrase, and is audited.

### It refuses rather than cascades

A reset that would orphan rows is refused with a **409 naming its blockers**, re-checked against
the database at the moment of the write rather than only in the dialog the administrator confirmed
— which may be minutes old, and which another administrator may have invalidated. A cascade would
be one click that destroyed four areas instead of one.

### A typed phrase, per scope

`RESET QUESTIONS`, `RESET MOCK TESTS`, `RESET DAILY CHALLENGES`, `RESET CHAPTERS` — compared exactly
after trimming, wrong case refused, and **different per scope** so muscle memory from one dialog
cannot confirm another. This is a guard against the wrong click and the wrong area, **not** an
authorization check; the permission is. A bare `POST` with no body is a 400.

### The dialog states real counts, and what survives

`previewReset()` writes nothing and counts every collection involved, so the confirmation reads
"208 questions" rather than "this cannot be undone". It also lists what is **preserved** — XP,
practice history, certificates — because a warning that only threatens gets clicked through, and
because the honest answer to "will this take the students' XP?" is what makes the feature usable
rather than something staff avoid and work around.

### Every reset is on the record

A `content.reset` audit entry is written after the delete with the per-collection counts
denormalised into it, because afterwards there is nothing left to count and an entry reading "a
reset happened" answers none of the questions anybody will ask. The service also logs at `warn`,
so it stands out in the platform log without a filter — this is the entry somebody goes looking for
when a question bank is unexpectedly empty.

## Student invoices (Milestone 22, Phase C)

An invoice names a child, their school class, their contact details and what they paid. Four things
carry it.

### Ownership is in the query, not in a check

`Payment.findOne({ _id, student })`. Changing the id in the URL returns **404, not 403** — the row is
simply not found — which also means the endpoint cannot be used to discover which payment ids exist.
This is the pattern every owner-scoped route in this product follows and the reason the 2026-08-17
audit found no IDOR; the invoice routes were written to match it rather than to check afterwards.

### There is no public or guessable invoice URL

The only identifiers are Mongo `ObjectId`s behind an authenticated, owner-scoped route. The **invoice
number** is derived from the payment id and printed on the document, but it is not an access key:
nothing accepts it as input. Compare `Certificate`, where public verification is a *feature* and is
therefore keyed on 80 bits of `crypto` randomness rather than on the readable serial.

### Staff access is a separate, permissioned route

`GET /admin/payments/:paymentId/invoice` requires `students:read` — the same gate as the payments
console, because it discloses the same class of data. It is a different route rather than a role branch
inside the student one, so "may I read my own?" and "may I read anyone's?" cannot be confused.

### Nothing is invented on a financial document

With no `INVOICE_GSTIN` and no `INVOICE_TAX_NOTE` the invoice carries no tax line, no rate and no
"inclusive of all taxes". Each would be a legal claim about the owner's business that this codebase has
no basis for. The same applies to the address: unset means absent, never a placeholder.

One operational note: `pdf-lib` **throws** on a character its standard font cannot encode, and
registration deliberately accepts names in any Indian script. Every string reaching the PDF therefore
goes through a sanitiser; without it, every student with a Devanagari name would meet a 500 instead of
their receipt. There is a test.

## The admin student directory and its export (Milestone 22, Phase B)

The directory publishes every registered account, with its entry-payment state, to anyone holding
`students:read` — and the export puts the same data into a file that leaves the platform. Four things
carry the security of it.

### An aggregation bypasses `select: false`

`Student.passwordHash` is excluded at the schema level. That protects `find()` and **nothing else** — an
aggregation pipeline reads the raw document, so the schema guard is simply not in the path. Every stage
that can reach a response therefore ends in an explicit `$project` **allow-list**
(`ACCOUNT_PROJECTION` in `services/studentDirectoryService.ts`), and the joined payment rows are
projected by name too, which is what keeps `razorpaySignature` out of both surfaces.

It must stay an allow-list rather than becoming an exclusion list. With an exclusion list, a field added
to `Student` later is published by default — and the field most likely to be added to a student record is
another secret.

Two tests assert this from the outside rather than field by field: the listing's whole JSON body and the
workbook's cells are searched for `passwordHash`, `tokenVersion`, a bcrypt prefix and a signature.

### The export can only write what the view holds

There is no separate query behind the spreadsheet. `services/studentExportExcel.ts` renders
`StudentDirectoryEntry` values and has no database access at all, so adding a secret to the file would
take a deliberate change in two other files first. That is a structural property rather than a careful
one, which is the only kind worth relying on for a file that gets emailed and filed.

### It is bounded, and refuses rather than truncating

`EXPORT_MAX_ROWS` (20,000) bounds the memory and time one request can spend inside a serverless
function, and `exportLimiter` (30/hour per IP) bounds the repetition. The read-only admin listings are
deliberately *not* limited — an administrator legitimately pages through hundreds of accounts — and this
is the exception that shows why: a listing reads twenty rows, an export reads the whole result set.

Exceeding the cap is a **413 naming the cap**, never a silent truncation. A spreadsheet quietly missing
its last few thousand rows looks complete, gets filed, and is reconciled against months later.

### Query parameters never reach Mongo unparsed

Every filter is an enum, a bounded string or a date parsed by zod before a stage is built; the search
term is regex-escaped; and `sort` is an **allow-list mapped to a field name**, never passed through — a
raw sort value lets a caller order by any field, including unindexed ones, which is a cheap way to make
the database do expensive work.

## Bulk question import — upload security (Milestone 21, Phase B)

The importer accepts `.xlsx`, `.docx`, `.jpg`, `.jpeg`, `.png` and `.webp` from an administrator. That
makes it the third upload surface after the registration photo and the event gallery, and the first that
accepts a **container format** rather than an image.

### Nothing is written to disk, which removes a whole class of risk

Uploads travel as **base64 data URLs inside the JSON body** — the same route the registration photo and
the gallery take (see the Milestone 4 ADR) — and are parsed from a `Buffer`. There is no temporary
file, no upload directory and no filename ever joined onto a path. So **path traversal, temporary-file
cleanup and unsafe filenames are absent risks here rather than mitigated ones**, and no uploaded file is
ever in a position to be executed.

The filename is kept only as a *label* — echoed into the error report and stored on `ImportBatch` so an
examiner can tell which of ten photographs failed. It is still validated (no path separator, no
Windows-reserved character, no control character including NUL, not `.` or `..`), because a name that
contains one is either a client bug or an attempt at something, and neither should be stored and
displayed to staff.

### The declared MIME type is not evidence

Three signals are checked, in ascending order of how much they are trusted:

1. **The bytes.** `.xlsx` and `.docx` are both ZIP archives, so both must begin with the local-file-header
   signature `50 4B 03 04`; images are checked against their own signatures. This is the only signal a
   client cannot forge without actually supplying a file of that shape. `PK\x05\x06` (empty archive) and
   `PK\x07\x08` (spanned) are refused — neither can be a valid workbook, and letting them through would
   only move the failure into the decompressor.
2. **The extension**, from an allow-list, which is what selects the parser. `.xls` is deliberately absent:
   the legacy binary format is not OOXML and would produce a confusing parse failure rather than the
   clear "save it as .xlsx" the examiner needs.
3. **The declared MIME type**, checked against a permissive allow-list and trusted least. Permissive on
   purpose — real browsers send the canonical OOXML type when the OS knows it and `application/octet-stream`
   when it does not, and refusing the second would reject genuine files over a signal that proves nothing.

The **authoritative** check is none of these three: it is that the parser finds the OOXML part it
needs, and both halves now exist in `lib/ooxml.ts`. `looksLikeWorkbook()` and
`looksLikeWordDocument()` search the bytes for the `xl/workbook.xml` / `word/document.xml` **entry
name** — stored uncompressed in every ZIP — so they answer **without inflating anything**. That
ordering is worth keeping: a decompression bomb that is not the format we expected is refused
before `exceljs` or `mammoth` is ever handed the file. Each route also tells a misdirected file
what it is ("that is a Word document — use the Word import"), since the magic bytes cannot.

A byte search can in principle be fooled the other way — a `.docx` containing a *file named*
`xl/workbook.xml` would pass — but that only earns a clear parse error from the real library a
moment later. It is a cheap early discriminator, **not a security boundary**; the boundary is that
nothing a parser returns is trusted.

### Server-side limits, and why the total matters as much as the per-file one

| Limit | Value | Enforced by |
| --- | --- | --- |
| Per file | 5 MB office, 6 MB image | `importFileSchema()` |
| Per request, decoded | 24 MB | `importFilesSchema()` **and** the body-parser limit in `app.ts` |
| Files per request | 20 | `importFilesSchema()` |
| Questions per import | `IMPORT_MAX_QUESTIONS` (200) under `IMPORT_HARD_MAX` (500) in code | `questionImportService` |
| Uploads per hour per IP | `IMPORT_RATE_LIMIT_PER_HOUR` (20) | `importLimiter` |

A per-file limit alone is not a limit: twenty 6 MB images is 120 MB, which no serverless invocation
survives. The large body allowance is granted to the **import path prefix only**, exactly as the photo
allowance is — every other endpoint keeps body-parser's 100 KB default, so a large-payload flood has a
countable number of doors and all of them are rate limited. Both `/api/v1` and `/api` are listed,
because the unversioned prefix is an alias for the same router and a limit holding on only one would be
bypassed by using the other.

`importLimiter` is mounted **ahead of the permission check**, like `generationLimiter`: the cheapest
possible rejection is the right one when a request costs money, and an unauthenticated flood should not
reach the database read that authorization performs.

### Authorization

Every import route is gated on **`questions:write`**, which is an *elevated* permission — so each
request re-reads the caller's role from the database and a demoted or suspended administrator loses
access at once rather than at token expiry. No new permission was added: importing produces exactly the
rows the editor produces. A test asserts a student receives **403** on all five routes across **both**
URL prefixes.

### The trust boundary is unchanged

A parser is never trusted. Every candidate passes `createQuestionSchema` — the same schema, and the same
`validateMathContent()`, a hand-authored question passes — and **approval re-validates from scratch**,
because what it receives is whatever the review screen sent after the examiner corrected it. A bad
candidate is **rejected and reported, never repaired**. Nothing is stored before a human approves it,
and questions are created as `draft`: importing is not publishing.

A parser also cannot supply an id — it reports the taxonomy it read as *names*, resolved server-side —
so **an importer cannot create taxonomy rows**. One bad spreadsheet cannot reshape the syllabus; an
unknown chapter is an error reported against that row.

### Open, and deliberately not attempted

1. **No decompression-bomb defence beyond a size cap.** A small ZIP can expand enormously, and neither
   `exceljs` nor `mammoth` exposes a limit on what it will inflate. The mitigations are the input size
   cap, the independent bound on how many rows a parser may return, and the hard memory ceiling of a
   serverless invocation. Recorded here as a residual risk rather than treated as solved.
2. **No malware scanning and no re-encoding** — the same open gap already recorded for the registration
   photo.
3. **`exceljs` carries one transitive advisory** (`uuid` < 11.1.1, a missing buffer bounds check in
   v3/v5/v6 when `buf` is supplied). It is **not reachable**: exceljs calls only `uuid.v4()` and never
   passes `buf`, verified by reading `node_modules/exceljs/lib`. Worth re-checking if exceljs is ever
   upgraded or its usage changes.
