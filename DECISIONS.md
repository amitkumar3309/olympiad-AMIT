# DECISIONS.md

Lightweight Architecture Decision Records. Add a new entry (don't edit old ones except to add a "Superseded by" note) whenever a significant technology/architecture choice is made, so future sessions don't silently reverse it.

---

## 2026-08-04 — MongoDB (via Mongoose) as the database

**Decision**: Use MongoDB with Mongoose ODM for all persistence.
**Reason**: Already in place when this audit began (inherited decision, not made in this session) — `mongoose` is a backend dependency and all 5 models are Mongoose schemas. Documented here retroactively so it isn't silently changed to a relational DB later without discussion.
**Alternatives considered**: None recorded from prior sessions.
**Consequences**: Free-tier MongoDB Atlas fits the ₹0 cost constraint. Schema-less flexibility suits an evolving MVP. Tradeoff: no foreign-key enforcement (see `studentId`-as-soft-reference issue in [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)) — relationships must be enforced in application code, not the database.

---

## 2026-08-04 — JWT (httpOnly cookie) for session auth, not server-side sessions

**Decision**: Stateless JWT signed with a shared secret, delivered via `httpOnly` cookie; no session store (no Redis/Mongo session collection).
**Reason**: Inherited decision. Fits a serverless (Vercel) backend well, since there's no persistent server process to hold in-memory sessions, and avoids needing a separate session-store service (cost).
**Alternatives considered**: None recorded from prior sessions.
**Consequences**: No server-side session revocation — logout only clears the client cookie; a leaked token remains valid until its 7-day expiry. Acceptable for MVP; revisit if handling sensitive data (e.g. payments) at scale.

---

## 2026-08-04 — Two separate Vercel projects (frontend/backend split), not one

**Decision**: `frontend/` and `backend/` are deployed as independent Vercel projects with independent `vercel.json` configs, communicating over HTTPS with CORS + cross-site cookies.
**Reason**: Commit `9dbdf27` ("Rebuild frontend in React, add real authentication, split into separate services") deliberately moved away from an earlier combined structure — prior commits (`1938876`, `6df3e60`, `9bba7cf`, `c32c717`) show repeated struggles getting a single combined Vercel deployment working, suggesting the split was chosen to simplify each deployment's build/runtime concerns independently.
**Alternatives considered**: Single Vercel project serving both static frontend and API routes (attempted in earlier commits, apparently caused deploy friction — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)).
**Consequences**: Requires CORS + `sameSite: 'none'` cookies (cross-site) in production, which is a materially different security posture from same-origin — see [`SECURITY.md`](SECURITY.md) CSRF notes. Also means `frontend/vercel.json` must hardcode/track the backend's production URL manually.

---

## 2026-08-04 — TypeScript pinned to 5.9.3 (backend) / `~6.0.2` (frontend)

**Decision**: Backend pins `typescript@^5.9.3` specifically (commit `e19adb6`, "Pin TypeScript to stable 5.9.3 to fix Vercel build failure"). Frontend separately uses `~6.0.2`.
**Reason**: A newer/prerelease TypeScript version broke the Vercel build; pinning to a known-stable version fixed it.
**Alternatives considered**: None recorded.
**Consequences**: The two apps intentionally run different major TypeScript versions since they're independent npm projects — this is fine (no shared build), but don't "helpfully" unify them without first confirming both builds still pass on Vercel, given this exact class of issue caused a prior outage.

---

## 2026-08-04 — Single hardcoded admin account via env vars, no admin registration

**Decision**: Exactly one admin identity exists, defined by `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` env vars, compared directly in the login route. No `Admin` collection, no admin signup UI/route.
**Reason**: Inherited decision — appropriate for a small MVP with a single founder/operator ("Amit Kumar" branding throughout the UI implies a single-admin operation).
**Alternatives considered**: None recorded.
**Consequences**: Scaling to multiple admins later requires a real `Admin` model + registration/invite flow — not built yet; flag this as a future decision point rather than retrofitting silently.

---

## 2026-08-04 — No payment gateway integrated yet; static QR placeholder only

**Decision (implicit, by omission)**: Ship the registration flow with a static QR code image and a self-reported "I've paid" button, with no real payment verification, pending a real decision.
**Reason**: MVP needs to demonstrate the registration UX before committing to a specific payment provider (which likely has fees, KYC requirements, or isn't free-tier-friendly).
**Alternatives considered**: Not yet evaluated — needs owner input (Razorpay, Cashfree, etc. are common India-market options with free/low-cost test modes, but this has **not been decided** and must go through the owner per [`CLAUDE.md`](CLAUDE.md)'s cost-constraint rule before any SDK is added).
**Consequences**: Currently zero real payment collection is happening — registrations are effectively free regardless of the UI implying payment. Must be resolved before any real-money launch.

---

## Audit note

This is the first `DECISIONS.md` for the project (created during the 2026-08-04 Phase 0 audit). Entries dated 2026-08-04 above are **retroactive documentation of decisions already embedded in the existing code/git history**, not new decisions made during the audit itself. No new architectural decisions were made in this audit session.

---

## 2026-08-04 — Milestone 1: split `backend/src/server.ts` into a modular foundation

**Decision**: Break the single-file backend (`server.ts`, ~450 lines) into `config/`, `db/`, `lib/`, `middleware/`, `models/`, `routes/v1/`, `validation/`, with `app.ts` (builds the configured Express app, used by both the dev server and the Vercel serverless entry) and `server.ts` (dev/production process bootstrap: connects the DB, starts listening, handles graceful shutdown — not used by the Vercel serverless path).
**Reason**: This is the deliberate refactor `CLAUDE.md` anticipated ("When it grows, split into `models/`, `routes/`, `middleware/`... as a deliberate refactor recorded in `DECISIONS.md`"). Milestone 1 explicitly required env validation, structured logging, error handling, validation architecture, security headers, rate limiting, health/readiness checks, and a testing foundation — all of which need their own modules; cramming them into one file would make the foundation itself unreadable.
**Alternatives considered**: Keep everything in `server.ts` and just add more top-level consts/functions — rejected, defeats the purpose of "foundation" work and makes the new pieces (logger, error handler, validation) hard to unit test in isolation.
**Consequences**: All existing route **behavior and response shapes are unchanged** — this was a structural move, not a rewrite of business logic. `backend/api/index.ts` (Vercel entry) now imports the app from `src/app.ts` instead of `src/server.ts`.

---

## 2026-08-04 — API versioning: `/api/v1/*` as canonical, `/api/*` kept as a compatibility alias

**Decision**: All real routes are now defined once and mounted at both `/api/v1/...` (canonical, versioned) and `/api/...` (unversioned, for backward compatibility).
**Reason**: The milestone asked for API versioning as a foundation piece, but the deployed frontend (`frontend/src/api/client.ts` and every page) calls unversioned `/api/...` paths today, and `frontend/vercel.json` rewrites `/api/*` to the backend. Introducing `/api/v1` as the *only* path would silently break the frontend's already-working login/register/analytics flows — out of scope for a backend-only milestone and against the "don't break working functionality" rule in `CLAUDE.md`.
**Alternatives considered**: (a) Version-only, breaking the frontend — rejected, out of scope and destructive to working features. (b) No versioning at all — rejected, the milestone explicitly required it and unversioned APIs are a known long-term maintenance problem.
**Consequences**: New backend work should call/add routes under `/api/v1/...`.

**Update (same day, later in Milestone 1)**: the frontend migration originally deferred here **was completed** in this milestone. `frontend/src/api/client.ts` now owns a single `API_BASE = '/api/v1'` constant and every caller passes a version-agnostic path (`/auth/login`). This turned out to be low-risk rather than out-of-scope, because both the Vite dev proxy and the Vercel `/api/(.*)` rewrite pass the remainder of the path through unchanged, so no deploy configuration had to change — verified by loading the SPA and watching it call `/api/v1/auth/me` through the proxy. The unversioned `/api/*` alias is **kept** so any other client (or a stale cached frontend bundle) keeps working; a test asserts the two paths behave identically. Removing the alias remains a future follow-up. One new operational constraint: **deploy the backend before the frontend**, or a new frontend will call `/api/v1/*` against an old backend that only serves `/api/*`.

---

## 2026-08-04 — Chosen foundation libraries (all free, no paid infra)

**Decision**: `zod` (env + request validation), `pino` + `pino-http` (structured/request logging), `helmet` (security headers), `express-rate-limit` (rate limiting), `vitest` + `supertest` (backend test runner, per the framework choice already flagged as pending in `TESTING.md`), `eslint` + `typescript-eslint` (backend linting — the frontend's `oxlint` is not reused here since it's a separate npm project and oxlint's current config in this repo is React-focused).
**Reason**: All are free/open-source npm packages (₹0 cost constraint), widely used, and each maps directly to one Milestone 1 requirement. `mongodb-memory-server` was considered for DB-backed tests but rejected for this milestone (see Testing decision below).
**Alternatives considered**: Jest instead of Vitest (Vitest chosen for faster ESM-native startup and lower config overhead with `tsx`); Winston instead of Pino (Pino chosen for lower overhead and native JSON structured output); Joi instead of Zod (Zod chosen for TypeScript-first inference, avoids hand-maintaining separate types).
**Consequences**: `backend/package.json` gains these as new dependencies. None require a paid service or external account.

---

## 2026-08-04 — Backend tests do not require a real/in-memory MongoDB

**Decision**: Milestone 1's test suite (health, readiness, error handling, validation) uses `supertest` against the exported Express `app` with the Mongo connection state abstracted behind `src/db/connection.ts`'s `getConnectionState()`, which tests mock directly — no `mongodb-memory-server` and no real Atlas connection is used in automated tests.
**Reason**: `mongodb-memory-server` downloads a real MongoDB binary on first run, adding test flakiness/slowness and a dependency on outbound access that may not always be available (this sandbox's egress is HTTP(S)-only with raw DNS/TCP blocked — see `TROUBLESHOOTING.md`). Foundation-level tests (is the health check reachable, does the error handler format errors correctly, does validation reject bad input) don't need a real database to be meaningful.
**Alternatives considered**: `mongodb-memory-server` for full integration tests — deferred to a later milestone once real data-bearing routes (exam attempts, results) are built and actually need to be tested against real query behavior.
**Consequences**: Test coverage added in this milestone does not exercise real Mongoose queries end-to-end. That gap is intentional and documented in `TESTING.md`, not accidental.


---

## 2026-08-04 — Database connection is established per-request (`ensureDb`), not only at startup

**Decision**: DB-backed routes carry an `ensureDb` middleware that lazily connects (via the cached `connectDB()`) before the handler runs, applied **after** validation and auth. Startup also connects eagerly, but non-fatally.
**Reason**: Discovered while actually running the app: `backend/api/index.ts` (the Vercel entry) imports `src/app.ts`, and only `src/server.ts` called `connectDB()`. Because `server.ts` never executes on the serverless path, **production would have had no database connection at all** on every data route — a regression from the original single-file version, which connected at module load. Connecting per request is the standard serverless pattern and `connectDB()` already caches and de-duplicates, so warm containers pay nothing.
**Alternatives considered**: (a) Call `connectDB()` at module scope in `app.ts` — rejected: an unhandled rejection at import time in a serverless cold start is hard to surface, and it would connect even for `/health`. (b) One app-level `app.use(ensureDb)` before all routes — rejected: it would make malformed input return 503 instead of 400 when the DB is down, and would gate the static mock routes and 404s on a database they don't need.
**Consequences**: Ordering is load-bearing — `validate → requireAuth → ensureDb → handler`. Every new DB-touching route must add `ensureDb` explicitly; forgetting it produces a route that works locally (where startup connected) but fails in production. A side effect is that `/auth/me` answers 503 rather than 401 for guests while the DB is down; the frontend treats any failure as "guest", so this is acceptable and is logged in `PROJECT_STATE.md`.


---

## 2026-08-04 — Milestone 2: split tokens into a short-lived access JWT plus a rotating opaque refresh token

**Decision**: Replace the single 7-day JWT with two credentials. The access token is a JWT (15 minutes by default) carrying `role`, `sub`, `studentId` and a `tv` token-version claim. The refresh token is 32 bytes of `crypto.randomBytes`, opaque (not a JWT), stored in MongoDB **only as a SHA-256 hash**, rotated on every use, and grouped into a "family" per login.
**Reason**: The old design could not revoke anything — a stolen 7-day token stayed valid until expiry even after logout, which `SECURITY.md` recorded as an open issue. Splitting the two lets access checks stay stateless and cheap (no database read per request) while sessions become genuinely revocable, because the refresh token is a database row we can mark dead.
**Alternatives considered**: (a) Keep one long JWT and maintain a denylist — rejected: a denylist has to be consulted on every request, which is the database read we were trying to avoid, and it grows unboundedly. (b) Make refresh tokens JWTs too — rejected: a JWT is self-validating, so it cannot be revoked without the same denylist problem; an opaque token's authority *is* the database row. (c) Store refresh tokens in plaintext — rejected outright: a database leak would then hand out live sessions.
**Consequences**: Revocation of *access* is bounded by the access-token TTL (≤15 minutes); refresh tokens die instantly. That trade-off is written down in `SECURITY.md` rather than hidden. Reusing an already-rotated refresh token is treated as theft and revokes the entire family, which means a legitimate client that replays a token (e.g. two parallel refreshes) also gets signed out — the frontend therefore de-duplicates refreshes through a single shared promise in `api/client.ts`.

---

## 2026-08-04 — Login accepts either the mobile number or the email address

**Decision**: `POST /auth/login` takes one `identifier` field holding either value; the handler matches it against both columns.
**Reason**: Owner's explicit choice when asked. Email had to be added to `Student` because verification and password reset are impossible without it, but students had already been registering with mobile numbers, and `CLAUDE.md` forbids breaking working functionality. Accepting both keeps every existing login working while making email a first-class identifier.
**Alternatives considered**: (a) Mobile-only login, email purely for mail — rejected by the owner as needlessly restrictive. (b) Switch to email-only — rejected: it would strand anyone who registered with a mobile number.
**Consequences**: `email` is now required and unique on `Student`, so **any student document created before this milestone lacks it** and will fail validation on its next save. There is no migration script; see the "existing student documents" note in `TROUBLESHOOTING.md`. The lookup uses `$or` over two explicitly-normalised strings, never raw user input, so no query operator can be injected.

---

## 2026-08-04 — Registration does not sign the student in; email verification is required first

**Decision**: `POST /auth/register` creates an unverified account, emails a single-use link, and returns **no session cookies**. Login is refused with `403` and `code: 'EMAIL_NOT_VERIFIED'` until the link is clicked. Governed by `REQUIRE_EMAIL_VERIFICATION` (default `true`).
**Reason**: Owner's explicit choice, and it matches the register → verify → login sequence the milestone asked to be tested. It also means a mistyped address cannot produce a usable account, which matters because that address is the only password-recovery channel.
**Alternatives considered**: Sign in immediately and nag with a banner — rejected by the owner; it gives unverified accounts real access.
**Consequences**: The old registration flow ended with "you're logged in, go to your dashboard"; it now ends with "check your email". The fake client-side OTP step (which accepted the hardcoded string `123456`) was deleted rather than kept alongside real verification. The env flag is the escape hatch if mail delivery ever breaks — flipping it to `false` must be a deliberate, temporary act.

---

## 2026-08-04 — SMTP via nodemailer, with a logging transport when unconfigured

**Decision**: Send mail through `nodemailer` over plain SMTP, configured entirely by env vars. When SMTP is unset, write the email — including the action link — to the structured log. Under test, capture emails in memory.
**Reason**: SMTP is the lowest common denominator, so the owner can use any free tier (Brevo 300/day, Resend, Mailtrap, or a Gmail app password) by changing env vars alone, with no code change and no vendor SDK. The ₹0 constraint rules out anything paid. The log transport means the whole verification and reset flow is exercisable locally before the owner has signed up for anything.
**Alternatives considered**: A provider SDK such as Resend's — rejected: it locks the choice into code and adds a dependency for no gain over SMTP. Skipping email entirely and auto-verifying — rejected: that is exactly the mock authentication the milestone forbade.
**Consequences**: Delivery failures are logged and swallowed, never surfaced as a 500, because an auth route must not leak whether an address exists nor break because a mail provider is down. The log transport prints a real, working token, so **the backend log is sensitive in development** and must not be pasted into public issues.

---

## 2026-08-04 — Admins get a longer-lived access token and no refresh token

**Decision**: Admin login issues a single access token (8 hours by default) with no refresh token and no rotation.
**Reason**: The admin identity is two env vars, not a database row, so there is no `Student._id` to hang a refresh-token family off. Building a parallel refresh mechanism for exactly one account would add a schema and a code path for no real benefit.
**Alternatives considered**: Give `RefreshToken` a nullable student plus a `subjectType` discriminator — rejected as over-engineering for a single-operator MVP. Keep the admin on a 7-day token — rejected: 8 hours is a working day and much tighter than 7 days.
**Consequences**: Admins re-authenticate roughly daily. If multi-admin support ever lands (which needs a real `Admin` model anyway), refresh-token support should be added at the same time.

---

## 2026-08-04 — Integration tests run against a real in-memory MongoDB

**Decision**: Adopt `mongodb-memory-server` for the auth suites, superseding the Milestone 1 decision to avoid it.
**Reason**: That earlier decision was made because the tooling was unverified in this environment and foundation tests did not need a database. Milestone 2 changes both halves: the auth flows are *defined* by database behaviour — unique indexes, atomic single-use token consumption, rotation bookkeeping — and none of that can be meaningfully mocked. The package was verified working here before being adopted.
**Alternatives considered**: Mocking the Mongoose models — rejected: it would assert that our mocks behave as written, not that the flows work, and would have missed the duplicate-key and atomicity paths entirely.
**Consequences**: Auth tests are slower (a few seconds to boot a database per test file) and depend on a downloaded MongoDB binary. Supersedes the "Backend tests do not require a real/in-memory MongoDB" entry above for the auth suites; the Milestone 1 foundation tests still run without a database.

---

## 2026-08-05 — Three roles, with the env account as `superadmin` and admins promoted from existing accounts

**Decision**: Authorization has three roles — `student`, `admin`, `superadmin`. The environment-configured account (`ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`) now holds **`superadmin`** and remains the bootstrap root with no database document. A super admin grants or revokes `admin` on any existing verified account via `PATCH /api/v1/admin/users/:studentId/role`, which sets a new `role` field on that account's document. `superadmin` is deliberately **not** assignable through the API.
**Reason**: A third role only means anything if more than one admin can exist, and "admin account handling" is meaningless while admin is a single pair of env vars. Promoting an existing account reuses the entire Milestone 2 stack — login by mobile-or-email, bcrypt, lockout, email verification, refresh-token rotation, password reset — so an admin account gets all of it for free. Confining role assignment to a role no ordinary admin holds is the actual security win: a compromised admin session cannot mint more admins.
**Alternatives considered**: (a) Two roles only, documenting super admin as unnecessary — rejected: it leaves admin un-creatable and un-manageable, which is most of what this milestone asked for. (b) A separate `AdminUser` collection with its own login, invite and password-setup flow — rejected: it duplicates the whole authentication stack for a handful of staff accounts, roughly doubling the work and the surface area to keep secure. Chosen after presenting all three to the owner.
**Consequences**: Staff accounts are `Student` documents with `role: 'admin'`. The model name is now narrower than what it stores — renaming the collection was out of scope and would need a migration. A promoted admin therefore keeps their student capabilities (they can sit the exam and see their own analytics), which is intentional. Because the root account has no document, `superadmin` cannot be suspended or demoted from the UI: withdrawing it means changing the environment variables.

---

## 2026-08-05 — Authorization is permission-based, not role-based, and lives in one table

**Decision**: Routes declare a *permission* (`requirePermission('students:read')`), never a role. The role → permission mapping lives only in `backend/src/lib/permissions.ts`. Comparing `req.user.role` to a literal anywhere else is forbidden. The effective permission list is returned to the client on login, refresh and `/auth/me`, and the frontend drives guards and navigation from that array rather than from a copy of the table.
**Reason**: Role checks scattered through handlers are how authorization rots: moving a capability between roles means finding every site, and missing one is a vulnerability that looks like working code. One table also makes the whole policy reviewable in a single screen. Sending permissions to the client removes the second copy of the rules that a frontend would otherwise maintain and drift from.
**Alternatives considered**: (a) Keep `requireAuth('admin')` role gates — rejected: it hardcodes today's role layout into every route, which is exactly what a milestone named "RBAC foundation" should remove. (b) Mirror the permission table in the frontend — rejected: two copies of an access-control rule will disagree eventually, and the UI's copy would be the one silently wrong.
**Consequences**: `requireAuth(...roles)` still exists for the rare gate that genuinely is about identity rather than capability (`/auth/logout-all`). `requirePermission` returns a middleware *array*, so it bundles the freshness check below; this puts `ensureDb` before `validate` on privileged routes, inverting the order CLAUDE.md documents for data routes — deliberate, since refusing an unauthorized caller before doing any parsing work is the safer order. The client's permission array is a UI convenience only and is re-checked on every request.

---

## 2026-08-05 — Privileged requests re-read the role from the database

**Decision**: A request needing any permission a `student` does not hold re-reads the caller's `role`, `status` and `tokenVersion` from MongoDB and uses those, not the token's claims. Student-level requests stay stateless with no database read. The env root admin is exempt, having no document. Role changes and suspensions additionally revoke refresh tokens and bump `tokenVersion`.
**Reason**: The access token carries the role it was signed with and lives up to 15 minutes. Without this, revoking someone's admin rights would leave them administrative for the rest of that window — the one moment you most need the revocation to bite. Administrative traffic is a rounding error next to student traffic, so one indexed read per privileged request costs nothing measurable.
**Alternatives considered**: (a) Shorten the access-token TTL for admins — rejected: it narrows the window without closing it, and worsens the experience for everyone. (b) Maintain a revocation list in memory — rejected: serverless containers do not share memory, so it would be wrong on the platform this deploys to. (c) Accept the 15-minute window and document it — rejected: this milestone's explicit requirement is that a student can never reach an admin API, and a stale token is the most likely way that fails.
**Consequences**: Privileged routes now require a database connection to *authorize*, so they answer 503 when MongoDB is down instead of 403 — an availability-for-correctness trade that is right for administrative endpoints. `callerCanFresh()` provides the same guarantee for in-handler decisions such as reading another student's analytics. Tested by demoting an account directly in the database, leaving `tokenVersion` untouched, and confirming the still-valid token is refused.

---

## 2026-08-05 — The audit trail records refusals as well as actions, and never expires

**Decision**: A new `AuditLog` collection records administrative actions (`user.role.changed`, `student.status.changed`, `questions.generated`, `admin.session.started`) **and** refused privileged requests (`authz.denied`). It has no TTL index. A failed audit write is logged at `error` level but does not fail the request that triggered it.
**Reason**: Recording refusals is what makes the trail useful for detection rather than just accounting: a burst of `authz.denied` against one account is the signature of an escalation attempt, and it is invisible if only successes are stored. No TTL because an audit trail that silently deletes itself is not an audit trail — unlike `RefreshToken` and `VerificationToken`, where expiry *is* the point.
**Alternatives considered**: (a) Fail the request when the audit write fails (fail-closed) — rejected: the administrative action has already been committed by then, so reporting failure would be a lie that invites the admin to repeat a change that already happened. (b) Log refusals only to pino — rejected: platform logs are not queryable by an admin and roll off; the point is that an operator can see this in the app. (c) A TTL on denials to bound growth — rejected as premature; denials are bounded by the rate limiters.
**Consequences**: Only authenticated callers produce `authz.denied` rows, so an unauthenticated flood cannot inflate the collection. `actorLabel` is denormalised (`AMIT_xxxx`, or the root admin's email) so history stays true even if the account is later renamed or deleted. Retention is unbounded; if that ever needs a limit it is a policy decision and belongs here.

---

## 2026-08-05 — Registration photos are stored in MongoDB, in their own collection

**Decision**: The mandatory registration photo (max 2 MB) is stored as a `Buffer` in a new `StudentPhoto` collection, one document per account, rather than on the `Student` document or in external object storage. It is served by `GET /students/:studentId/photo` as raw image bytes.
**Reason**: The project targets ₹0 spend and the owner chose the option that needs no external account, so an image CDN was out. Given MongoDB, a separate collection rather than a `Student` field is what keeps the cost bounded: every student query — the admin list, the login lookup, the freshness read on each privileged request — would otherwise carry the binary, and `select: false` on a field is one forgotten projection away from being very expensive. A separate collection also means moving to object storage later is a change to one collection instead of a field migration across every account.
**Alternatives considered**: (a) Cloudinary/imgkit free tier — offered to the owner and declined; it needs a signup, API keys and a new env group. (b) A `photo` field on `Student` with `select: false` — rejected for the projection risk above. (c) GridFS — rejected: it exists for files over the 16 MB BSON limit, and a 2 MB cap is comfortably under it, so it would add chunking machinery for nothing.
**Consequences**: Storage is bounded by the database. At 2 MB a photo, the Atlas free tier's 512 MB holds roughly **250 students** — enough for a first cohort and a known ceiling to revisit before scale; this is the first thing that will force a paid tier or a CDN. Photos are personal data behind an authorization check, so the route sets `Cache-Control: private` and checks `students:read` *freshly* against the database before serving someone else's.

---

## 2026-08-05 — The photo is carried as a base64 data URL in the JSON body, not multipart

**Decision**: `POST /auth/register` takes the photo as a `data:image/...;base64,...` string inside the ordinary JSON body. Only that route is given a larger body limit (2.8 MB); every other endpoint keeps body-parser's 100 KB default.
**Reason**: It keeps registration a single atomic request — the account and its mandatory photo are created together, so there is no window in which one exists without the other. It also needs no new dependency (`multer`) and works unchanged with the existing `validate` middleware, the zod schemas and the `{ success, ... }` envelope, none of which understand multipart. Scoping the larger limit to one route means a large-payload flood has exactly one rate-limited door rather than the whole API.
**Alternatives considered**: (a) `multer` + multipart — rejected: a new dependency, a second body-parsing path, and every other route's validation would have to learn about a request shape it never sees. (b) A separate upload endpoint after registration — rejected: the photo is mandatory, so an account could exist without one whenever the second request failed, and something would then have to reconcile that. (c) Raising the global JSON limit — rejected: it widens the attack surface of every endpoint to solve a problem on one.
**Consequences**: Base64 inflates the payload by about a third, so a 2 MB photo travels as ~2.7 MB — comfortably inside Vercel's 4.5 MB request limit, but that limit, not the 2 MB rule, is the real ceiling and would bite first if the cap were ever raised. Because the client controls the declared MIME type, the validator checks the decoded bytes' **magic bytes** against it. If the photo write fails after the account is created, the account is deleted again rather than left photo-less: there is no transaction available (the local test database is a single node), so a compensating delete is the honest substitute.

---

## 2026-08-05 — New registration fields are required on creation only

**Decision**: The nine registration fields added in Milestone 4 are declared `required: function () { return this.isNew }` on the `Student` schema, rather than plainly `required: true`.
**Reason**: Registration is the only path that creates a `Student`, and its zod schema already rejects a missing field with a 400 — so the database-level requirement adds nothing for new accounts, but plainly-required fields would break *existing* ones. Accounts created before this change do not have the fields, and Mongoose validates the whole document on `save()`: suspending or promoting a legacy account would have failed on data the administrator never touched. This is the same class of problem already recorded for `Student.email` in `TROUBLESHOOTING.md`, and worth not repeating nine more times.
**Alternatives considered**: (a) Plain `required: true` plus a migration script — rejected for now: there is no migration tooling in the project, and the failure mode until one exists is an admin panel that errors on old accounts. (b) No database-level requirement at all — rejected: it would leave the schema silent about what a valid new account is, and the constraint is free where it matters. (c) Backfilling placeholder values — rejected: inventing a father's name or a date of birth puts fiction in the record.
**Consequences**: A legacy account reads back with these fields `undefined`, so every API view of them is explicitly nullable and the admin table renders `—`. A test writes a pre-Milestone-4 document straight to the collection and asserts an admin can still suspend it. If a backfill ever happens, the `isNew` scoping can be tightened to a plain `required` in the same change.

---

## 2026-08-05 — Topics and subtopics are one self-referencing collection

**Decision**: `Topic` holds both topics and subtopics, distinguished by a nullable `parent` pointing at another `Topic` in the same subject. `depth` (0 or 1) is derived from `parent` by the service layer and capped at `MAX_TOPIC_DEPTH = 1`. There is no `Subtopic` model.
**Reason**: a separate collection would duplicate every field, every index and every query, and "list everything under this subject" would become two queries and a merge instead of one `find`. A self-reference also means the depth limit is a constant rather than a structural fact, so raising it later is a change to one number and the admin form.
**Alternatives considered**: (a) A separate `Subtopic` collection — rejected for the duplication above. (b) An unbounded materialised-path tree — rejected as speculative: nothing in the syllabus needs three levels, and an arbitrary-depth tree makes both the admin UI and the question form materially harder to get right for no present benefit. (c) An array of subtopic strings on `Topic` — rejected because a question needs to *reference* a subtopic, and a string in an array has no stable id to reference.
**Consequences**: uniqueness has to be scoped (`subject + parent + slug`) rather than global, which is also what makes "Fractions" legitimately exist under both Arithmetic and Algebra. The service must check that a subtopic's parent belongs to the stated subject, because Mongoose refs are not foreign keys and a mismatch would produce a question no filter could ever find. Archiving is refused while published questions reference the entry as either `topic` or `subtopic`.

---

## 2026-08-05 — Mathematics is LaTeX in plain text, rendered by KaTeX with the text/math split

**Decision**: question content is stored as plain text containing LaTeX islands (`$…$` inline, `$$…$$` display). The frontend splits that text and renders prose as React text nodes while handing only the LaTeX to KaTeX (`trust: false`). The backend independently validates the same grammar at write time and rejects link, file-inclusion and macro-definition commands. Added `katex` (MIT, ~260 KB) as a frontend dependency.
**Reason**: "represented safely and correctly" needs both halves. *Correctly* means real typesetting — a maths olympiad cannot show `rac{-b \pm \sqrt{\Delta}}{2a}` as literal source. *Safely* means author-controlled text must never reach an HTML sink, which the split guarantees structurally rather than by sanitising: React escapes the prose, and the only HTML inserted is KaTeX's own output from a restricted grammar. Validating at the storage boundary as well means a future export or PDF generator inherits the guarantee instead of re-deriving it.
**Alternatives considered**: (a) Store HTML from a rich-text editor and sanitise on render — rejected: it makes every consumer responsible for sanitisation forever, and one missed sink is an XSS. (b) MathJax — rejected: much larger, and its default configuration is more permissive about the commands we specifically forbid. (c) Store LaTeX but display it as monospace source — safe and cheap, but not *correct*; the owner asked for both. (d) Render maths to images server-side — rejected: needs a TeX toolchain, which breaks the ₹0 and serverless constraints.
**Consequences**: KaTeX would have added ~300 KB to the initial bundle, so the question-bank routes are lazy-loaded via `React.lazy` and KaTeX lands in a separate chunk — the main bundle is unchanged at ~476 KB. Two parsers now exist for the same grammar (`lib/mathContent.ts` and `MathText.tsx`); both are a single left-to-right scan with no nesting *precisely* so they can be verified against each other by reading them, and a change to one must be mirrored. The two differ in one deliberate way: the frontend treats an unclosed delimiter as literal text so a half-typed formula still previews, while the backend refuses to save it.

---

## 2026-08-05 — Archive-first removal, with hard delete only for never-published questions

**Decision**: `archived` is a question status and the normal removal path, and it is reversible (`archived → draft`). `DELETE` exists but is refused for any question that is currently published *or* whose `publishedAt` is set, even if it has since returned to draft. It needs a separate `questions:delete` permission.
**Reason**: once a question has been visible to students it may have been answered, and deleting it would orphan the attempt that references it — with no way to reconstruct what the student saw. But a mistyped draft should not have to be kept forever, so a narrow delete is worth having. `publishedAt` is the witness, and it is deliberately *not* cleared on a return to draft: clearing it would let anyone sidestep the guard by unpublishing first and then deleting.
**Alternatives considered**: (a) No delete at all, as with accounts — defensible, and nearly chosen; rejected only because question drafts are created far more casually than accounts and accumulate faster. (b) A `deletedAt` soft-delete flag in addition to `archived` — rejected: two mechanisms for "not visible" is one more than the reader can keep straight, and `archived` already means it. (c) Cascade deletion of dependent attempt data — rejected: destroying a student's record to tidy the question bank is the wrong trade.
**Consequences**: `publishedAt` is documented as historical rather than current state, with `status` as the authority on visibility — a distinction that has to be stated because the field name suggests otherwise. The admin UI only offers a Delete button for a draft with no `publishedAt`, mirroring the server rule so the button is never a dead end.

---

## 2026-08-05 — A `services/` layer between routes and models

**Decision**: added `backend/src/services/` (`questionService.ts`, `taxonomyService.ts`). Route handlers do HTTP — parse, authorize, shape a response — and the services own the rules. Services signal refusals by throwing `ApiError`, which `lib/serviceError.ts` maps to the envelope.
**Reason**: the question bank's rules are the first in this codebase that more than one route needs. That a topic must belong to the stated subject is required by create *and* update; the status transition table is needed by the status route and implicitly by delete. Inlining them would mean two copies, and a copy that drifts is a silent data-integrity bug rather than a visible failure. It also keeps handlers readable at the size the rest of the codebase expects.
**Alternatives considered**: (a) Keep the logic in the route files, as Milestones 1–3 did — that was right when each rule had exactly one caller; it stops being right here. (b) Mongoose statics and middleware — rejected: the cross-document checks need to query other collections and return good error messages, which schema hooks do badly. (c) A full repository pattern abstracting Mongoose — rejected as ceremony with no present payoff.
**Consequences**: `CLAUDE.md`'s folder list gains a directory. Throwing `ApiError` from a service means a handler that forgets to catch would surface a 500, so every handler routes through `respondToServiceError`, which passes an `ApiError` through and logs anything else as a genuine bug — the distinction that stops a real fault being flattened into a tidy 4xx.
