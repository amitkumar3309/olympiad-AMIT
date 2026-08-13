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

---

## 2026-08-10 — XP, levels and streaks are derived from an activity log, never stored as counters

**Decision**: Milestone 5 added one new collection, `StudentActivity`, an append-only log of real student events carrying the XP each was worth at the time. Total XP is a `$sum` over that collection, the level is a pure function of the total (`lib/xp.ts`), and the streak is computed from the distinct days the collection contains. There is **no** `StudentProgress` document and no stored `xp` field anywhere.
**Reason**: this milestone's actual requirement was "do not display fake statistics". A denormalised counter is the standard way that requirement gets broken — not by anyone inventing a number, but by a counter drifting from the events behind it until it shows a figure nobody can account for. With one source of truth every number on the dashboard traces to rows a person can read, and "why do I have 60 XP?" has an exact answer. It also removes a class of bug outright: there is no increment to double-apply and no counter to keep in step.
**Alternatives considered**: (a) A `StudentProgress` document with counters updated on each event — the conventional choice, rejected for the drift reason above; it is the right change *later*, as a cache, once read cost actually matters. (b) Storing the level alongside the XP — rejected: it is a function of the XP, so storing it creates a second thing that can disagree. (c) Deriving XP but storing the streak, since the streak needs day arithmetic — rejected as an inconsistent half-measure; `distinct('occurredOn')` is bounded by days active, not by event count, so it stays small.
**Consequences**: one aggregation per dashboard load, plus a pair for the leaderboard, which groups the whole collection. That is correct for a first cohort of a few hundred (photo storage caps it near 250 anyway) and is isolated in `leaderboardPipeline()`, the one place to change if the field grows an order of magnitude. Re-pricing an event later does not restate history, because `xpAwarded` is copied at write time — the same reasoning as `AuditLog.actorRole`.

---

## 2026-08-10 — XP is earned only from events that really happen, so the sources are deliberately few

**Decision**: XP accrues from exactly three events today — `account_created` (50), `email_verified` (50) and `daily_visit` (10, once per competition day). `profile_updated`, `photo_updated` and `password_changed` appear on the feed but are worth **0**. There is no exam XP, because no exam attempt is recorded anywhere in the product.
**Reason**: chosen by the project owner when the alternative — showing 0 XP everywhere until the exam milestone — was put to them. Each of the three is a real, dated, verifiable event, so a new student's 110 XP is a true statement about things they did rather than an encouraging fiction. The zeros matter as much as the awards: editing a profile is repeatable at will, so paying for it would make XP a measure of how often you pressed Save, and the leaderboard sortable by fidgeting.
**Alternatives considered**: (a) Exam XP only — honest, but leaves the entire progress panel empty for an unknown number of months. (b) Account milestones without the daily visit — rejected because nothing would then record per-day presence, so the streak would have to be dropped rather than merely read zero. (c) XP for profile completeness — rejected: registration already makes every field mandatory, so it would pay everyone equally for nothing.
**Consequences**: the top of the leaderboard currently measures consistency, not ability, and will until exam scores exist — worth stating plainly to entrants before the competition runs. Adding exam XP is an entry in `ACTIVITY_TYPES` and `XP_AWARDS`, not new machinery. Achievements follow the same rule: no exam or accuracy achievement is listed, because a permanently unearnable row with a bar that can never move is a fake statistic wearing a lock icon.

---

## 2026-08-10 — The competition day is an IST calendar day, not a UTC one

**Decision**: `lib/competitionDay.ts` defines a day as a calendar day in Indian Standard Time, implemented as a fixed UTC+05:30 offset with no timezone database. Every activity row stores `occurredOn` as that `YYYY-MM-DD` key.
**Reason**: a streak counts consecutive days, so something must decide when a day ends, and UTC gets it wrong for these users: a student practising at 00:30 IST would have the visit filed under the previous UTC day and see a streak they had in fact kept reported as broken. IST observes no daylight saving, which is precisely what makes a plain fixed offset correct rather than an approximation — and it keeps the ₹0 dependency budget intact.
**Alternatives considered**: (a) UTC days — simplest, and wrong by five and a half hours for every entrant. (b) A per-student timezone — rejected: this is a national Indian competition, and a streak meaning different things for different students is not comparable on a leaderboard. (c) `Intl` or a tz library — unnecessary while the zone has no DST, and one more dependency to audit.
**Consequences**: if the competition ever runs somewhere that observes DST, `competitionDay.ts` is the only module that changes — everything else speaks solely in the opaque keys it returns. Stored keys are timezone-tagged by convention only, which makes that module's comment load-bearing documentation.

---

## 2026-08-10 — Self-service profile editing excludes the email address and mobile number

**Decision**: `PATCH /api/v1/me/profile` accepts the nine descriptive registration fields. `email` and `mobile` are shown on the profile page as read-only with an explanation, and are absent from the zod schema entirely.
**Reason**: both are unique login identifiers, and `email` additionally anchors email verification and password reset. Letting a student set an address in one request creates an account-takeover primitive: change the address, then use "forgot password". Doing it safely needs a confirm-at-the-new-address flow — issue a token to the *new* address, switch only on redemption — which is its own piece of work. Offering a field that cannot be made safe in this milestone would be worse than not offering it.
**Alternatives considered**: (a) Allow the change and re-send verification, reverting on failure — rejected: the account sits in an ambiguous state in between and the reset path is open throughout. (b) Allow only the mobile number, which anchors nothing — rejected as an inconsistency that still needs uniqueness handling for no real gain. (c) Route the change through an administrator — plausible, and left for the owner to ask for rather than built on speculation.
**Consequences**: a student with a typo'd address still cannot fix it themselves; the page tells them to contact the organisers. Omitting the fields from the *schema* rather than filtering them in the handler is what makes it safe — `validate` replaces the body with the parse result, so extra keys cannot reach the update. A test sends `email`, `mobile`, `studentId`, `role`, `status`, `isEmailVerified` and `tokenVersion` and asserts none of them changes.

---

## 2026-08-10 — The public leaderboard publishes a first name and a last initial

**Decision**: `GET /api/v1/leaderboard` is readable without signing in — an explicit decision by the project owner, taken so the landing page shows a real standing instead of the invented one it carried. Names are rendered by `displayNameFor()` as a first name plus a last initial ("Ishaan V."), alongside class, school and XP.
**Reason**: the owner chose a real public leaderboard over keeping the fake one or deleting the section. The masking is this implementation's own addition: the entrants are children in classes 5–12 and the landing page is public and indexable, so a full legal name beside a school and a class would identify a minor to anyone on the internet. The masked form is still real, still ranked, and still recognisable to the student — the dashboard additionally labels the caller's own row "You".
**Alternatives considered**: (a) Full names, as a printed prize list would carry — the plain reading of the owner's choice, and a one-line change in `displayNameFor`; not taken by default because the safer form loses nothing the section needs. (b) Requiring a session to read it — defeats the purpose of the landing-page section. (c) Student IDs only — rejected: `AMIT_3028` is not something to celebrate.
**Consequences**: `limit` is validated and capped at 50, so the endpoint returns a leaderboard rather than an enumerable roll; suspended and deactivated accounts are excluded by a `$lookup` that runs *before* the `$limit`, so a suspended account cannot silently consume a place in the top ten; a student with no XP is genuinely unranked (`rank: null`) rather than listed last. Widening the name format is the owner's call and one function to change. Tests assert the full name, email address and mobile number do not appear in the response.

---

## 2026-08-10 — A student's edit of their own account is written to the administrative audit trail

**Decision**: three audit actions were added — `student.profile.updated`, `student.photo.updated`, `student.password.changed` — recorded when the account's *own owner* makes the change. Metadata names the fields that changed, never their values.
**Reason**: `CLAUDE.md` requires any route that changes an account to call `recordAudit`, and the rule is worth keeping literal rather than carving out a self-service exception: the trail exists to answer "who changed this school name, and when?", and "the student did, last Tuesday" is a valid and useful answer. An unexpected password change is also what a compromised account looks like — exactly what the trail should make visible.
**Alternatives considered**: (a) Record nothing, treating the trail as administrative-only — rejected; it would leave a gap precisely where account data changes most often. (b) Record before/after values, as a change log would — rejected on privacy grounds: the trail is readable by anyone holding `audit:read`, and a student's home address and date of birth must not be copied into it. A test asserts the address value is absent from the entry.
**Consequences**: the audit list is noisier than before, so the admin page's action filter matters more; three new labels were added there. Volume is bounded by the new per-route limiter (20/hour).

---

## 2026-08-11 — Surfaces that cannot yet have real data show an empty state, never a placeholder

**Decision**: every remaining piece of fabricated data was removed rather than relabelled. The result portal, certificate page, exam paper, student report, analytics page and admin chart now each query the real collection and render an explicit empty state when it is empty. Nothing anywhere returns a hardcoded figure, including things previously *labelled* as sample data.
**Reason**: the project owner's instruction was "no fake stats, strictly", and the audit found that a labelled invention is still an invention — the admin dashboard's "Weekly Accuracy Trend (sample data)" was the clearest case, an accuracy trend for a competition where no answer has ever been scored. Two of the finds were worse than decoration: the result portal *computed* a score, national rank and percentile from a hash of whatever ID was typed, publicly, and the certificate page printed an achievement award for anyone signed in. A parent could have believed either.
**Alternatives considered**: (a) Keep them behind a clearer "demo" label — rejected; the label is not what a user takes away from a printed certificate or a percentile. (b) Hide the pages entirely until the exam exists — rejected: the pages answer a real question ("is my result out yet?") and an honest "not yet" answers it. (c) Return hardcoded empty arrays from the frontend without an endpoint — rejected, and this is the subtle one: a hardcoded `[]` is something a human has to remember to replace later, whereas a live query against an empty collection starts working by itself.
**Consequences**: several pages are visibly emptier than before, which is the point. Each empty state says *why* it is empty and what will fill it, because "no data" and "not measured yet" are different messages. `services/resultService.ts` centralises the lookups. The result portal is public, so it deliberately answers identically for "no such account" and "no published result" — otherwise it becomes a student-ID enumerator — and only ever exposes `isPublished` results, so marks cannot be read before release.

---

## 2026-08-11 — One global theme, light by default, applied to the document element

**Decision**: a `ThemeContext` toggles a single `theme-dark` class on `document.documentElement`, persisted in `localStorage`, defaulting to **light**. The per-page `theme-dark` classes on the dashboard, admin shell and admin login are removed. A `ThemeToggle` appears in all three shells.
**Reason**: the app was inconsistent — public pages light, interior pages hardcoded dark — so signing in changed the colour scheme underneath the user, and the admin sign-in form was dark beneath a light navbar. Applying the theme once, at the document root, is what makes that impossible to reintroduce: a new page inherits it and cannot forget to opt in, and no two pages can disagree. Light as the default was the owner's explicit choice.
**Alternatives considered**: (a) Follow `prefers-color-scheme` — rejected on the owner's instruction, and it would mean two users seeing different colours with no shared baseline for screenshots or support. (b) A per-page or per-route theme — that is what was already there, and what caused the problem. (c) Storing the preference on the account — rejected: the theme is a per-device display preference, not account data, and it would then require a session to work at all on the public pages.
**Consequences**: the background is painted on `html`, `body` **and** `#root` — belt and braces, because relying on body's background propagating to the canvas holds only while `html` has no background of its own, and pages without a full-height wrapper would otherwise show dark cards on a light canvas. All hardcoded `#fff` in the previously dark-only stylesheets were checked and sit on saturated backgrounds, so they stay correct in light mode. Live switching could not be visually confirmed in the preview browser, which does not invalidate `var()` substitutions on a runtime custom-property change — an engine artifact, not a CSS fault (a fresh element picks up the new value while existing ones do not, and even an inline write on the root fails); the load path is correct in both themes and the standards-correct implementation was kept rather than hacked around.

---

## 2026-08-11 — Practice is its own collection, not a reuse of `ExamAttempt`

**Decision**: Milestone 6 introduced a new `PracticeSession` collection. `ExamAttempt` and `Result` are left alone for the official Olympiad.
**Reason**: they describe different things. Practice is unlimited, self-selected by subject and topic, and must never influence a ranking; the official exam is one marked, ranked sitting that produces a published result and a certificate. Sharing a collection would mean every query about official performance had to remember to exclude practice rows — and the first one that forgot would award a national rank for a practice run. The dashboard's test-performance panel and the result portal both already query for official attempts, so the failure would have been silent and in production.
**Alternatives considered**: (a) One collection with a `kind: 'practice' | 'official'` discriminator — rejected for the reason above: it makes correctness depend on every future caller remembering a filter. (b) Rewriting `ExamAttempt` now to serve both — rejected as scope: that model needs rewriting anyway (it stores a single `selectedOption` string, so it cannot represent a multiple-choice answer at all), and doing it as a side effect of the Practice Zone would have coupled two milestones.
**Consequences**: two collections with a similar shape, which is real duplication. It buys the guarantee that no practice attempt can ever be mistaken for an official one. When the official exam lands it should be written against the current `Question` model rather than the pre-Milestone-4 shape `ExamAttempt` still has.

---

## 2026-08-11 — A practice session snapshots the answer key when it serves a question

**Decision**: each question in a `PracticeSession` stores a copy of what counts as correct — the correct option keys, the boolean or numeric answer and its tolerance, plus the marks, negative marks and the question's `revision` — taken at the moment it was served. Grading uses the snapshot, not the live `Question`.
**Reason**: an author can edit or archive a question while a session is open. Grading against the live document would mark a student against a question they were never shown, and if the edit changed the answer *shape* (say choice to numeric) grading would fail outright. Recording `revision` also lets the review tell the student the question has changed since they answered it, instead of silently showing different text above their old answer.
**Alternatives considered**: (a) Re-read the `Question` at submit time — simpler and avoids duplicating the key, but wrong for the reason above. (b) Forbid editing a published question while any session references it — rejected: it would let one abandoned session block an urgently needed correction.
**Consequences**: the answer key now exists in a second collection, so projection discipline matters more, not less. `practiceService.ts` therefore builds two explicit views and never returns a raw document, `sessionReviewView()` throws unless the session is submitted, and tests assert the forbidden field names are absent from whole in-progress response bodies rather than checking one field at a time.

---

## 2026-08-11 — Practice XP is once per day, not once per session

**Decision**: submitting a practice session with at least one answered question records `practice_completed` (25 XP), deduplicated by competition day through the existing partial unique index. Further sessions the same day are stored in full but earn no more XP.
**Reason**: XP feeds a public leaderboard, so it has to resist farming. Paying per session would be trivially farmable — start, submit empty, repeat. Paying per correct answer is the fairest measure but would need its own daily cap to resist the same attack, which means new machinery; keying on the day reuses the index that already makes `daily_visit` race-free across concurrent serverless invocations.
**Alternatives considered**: (a) XP per correct answer with a daily ceiling — better signal, more moving parts; worth revisiting when official exam scoring lands and ability is measured properly there. (b) No XP for practice at all — rejected: practice is the first thing on this platform that involves actually answering questions, and it would have been odd for the one genuinely effortful action to be worth nothing.
**Consequences**: XP still measures consistency more than ability, which remains recorded as a known limitation. A student who practises hard for one day and not again is not distinguished from one who practised lightly. Empty submissions earn nothing at all, which is asserted by test.

---

## 2026-08-11 — Unanswered practice questions are never penalised, and multiple choice needs the exact set

**Decision**: a question with no response scores 0 and no negative marks. `multiple_choice` is correct only when the chosen set exactly equals the correct set — no partial credit. A wrong answer costs `negativeMarks`, so a session score may be negative and is reported unclamped.
**Reason**: a blank is not a wrong answer; penalising it would push students to guess, which is the opposite of what practice is for. Partial credit sounds kinder but needs a second policy — how much to deduct for a partially-right answer under negative marking — and the question bank has no field to express it, so any rule would have been invented here rather than authored per question.
**Alternatives considered**: clamping the displayed score at zero — rejected, because a negative total is the honest consequence of negative marking and hiding it would misrepresent the arithmetic the student is being taught.
**Consequences**: accuracy is reported over *answered* questions rather than over the paper, so skipping is not punished twice; the unanswered count is shown next to it so the figure cannot flatter by omission. Adding partial credit later means adding a field to `Question` first.

---

## 2026-08-11 — Resolve `.env` from the package root, and make write scripts refuse an unintended database

**Decision**: `config/env.ts` resolves `backend/.env` from its own directory (`path.resolve(__dirname, '..', '..', '.env')`) rather than calling a bare `dotenv.config()`. Separately, every script that writes to the database calls `assertConfiguredForWrites()` (`lib/envGuard.ts`) as its first statement, which prints the target database and exits non-zero rather than writing to a local one without an explicit `--local`.

**Reason**: a seed run reported "Published: 208" while writing to a local database, leaving production empty. `dotenv.config()` searches `process.cwd()`, so running the script from `backend/scripts/` instead of `backend/` found no `.env`, loaded **zero** variables, and every setting fell back to its default — including `MONGO_URI`, which defaults to `mongodb://localhost:27017/...`. The script then behaved perfectly, for the wrong database, and said nothing. The root cause is that sensible defaults, which make `npm test` and first-run local development pleasant, also make a misconfigured script silently successful.

**Alternatives considered**:
- *(a) Remove the `MONGO_URI` default so it must always be set.* Rejected: it would break the zero-configuration local start that `dev:local` and the test suite depend on, and it addresses only this one variable — `JWT_SECRET` and the SMTP group have the same shape of problem.
- *(b) Only fix the path resolution.* Rejected as insufficient. It fixes the reported case but not a mistyped URI, a genuinely absent `.env`, or a deliberate override pointing somewhere unintended. The guard is cheap and covers all of them.
- *(c) Require an interactive "type the database name to confirm" prompt.* Rejected: these scripts need to be runnable non-interactively, and a prompt that is always answered the same way stops being read.
- *(d) Make the guard a warning rather than a hard stop.* Rejected — the original failure was precisely a warning nobody noticed (`injected env (0)` was right there in the output, as were `JWT_SECRET is not set` and `SMTP is not configured`). A warning in a wall of log lines is not a control.

**Consequences**: `__dirname` is used rather than `import.meta.url`, because this package compiles to CommonJS where `import.meta` is a syntax error — `tsx` tolerates both, so that mistake would have surfaced only at `npm run compile`, i.e. on the Vercel build. Scripts now print `Target database` and `Loaded .env` before doing anything, which is the line to read first when a run goes wrong. Local development against a local database now needs `--local` on the write scripts, which is mild friction accepted deliberately in exchange for the production case being safe by default. `config/env.ts` also exports `envFileLoaded`, the first thing outside `config/` to depend on *how* configuration was obtained rather than just its values.

---

## 2026-08-12 — Mock tests are a third collection, not a variant of practice or of the official exam

**Decision**: Milestone 7 introduced `MockTest` (the paper an author assembles) and `MockTestAttempt` (one student's sitting of it). `PracticeSession` is untouched, and `ExamAttempt` / `Result` remain reserved for the official Olympiad.

**Reason**: three genuinely different things. Practice is unlimited, self-selected by subject and topic, untimed, and must never influence a ranking. A mock test is authored — the *staff* choose the questions, the marks, the clock and the window — sat a fixed number of times, and identical for everyone who sits it. The official Olympiad is one national sitting that produces a published result, a rank and a certificate. Expressing a mock test as a practice session would mean `filters` describing a choice the student never made, and `PracticeSession` acquiring `expiresAt`, `attemptNumber` and a disclosure policy that mean nothing for practice; expressing it as an `ExamAttempt` would put unofficial marks in the collection the result portal and the dashboard's official panel read.

**Alternatives considered**: (a) One attempt collection with a `kind` discriminator — rejected for the reason the Milestone 6 ADR gives about practice: correctness would depend on every future query remembering a filter, and the first one that forgot would show a mock score as an Olympiad result. (b) A `timed: boolean` plus a nullable `test` reference on `PracticeSession` — rejected: half its fields would then be meaningful in only one mode, which is the shape that invites a reader to use the wrong one.

**Consequences**: three collections with a family resemblance. What is deliberately **not** duplicated is the part where duplication would be dangerous: the served-question shape lives once in `models/attemptAnswer.ts` and the marking rules once in `services/grading.ts`, both shared by practice and mock tests, so there is exactly one definition of what counts as correct. `PracticeQuestionEntry` is now an alias of the shared `AttemptAnswerEntry`, and `practiceService.ts` re-exports `gradeEntry` / `isAnswered` so its own callers and tests were unchanged.

---

## 2026-08-12 — The attempt deadline is computed and stored by the server, and clamped to the closing time

**Decision**: `MockTestAttempt.expiresAt` is written once, when the attempt is created, as `startedAt + durationMinutes`, lowered to `availableTo` when the window shuts first. Every later decision — whether an answer may be saved, when the paper is graded, what time is recorded — reads that stored value against the server's own clock. No request body anywhere in the mock-test API carries a time, and an attempt cannot be started with under 60 seconds of window left.

**Reason**: "never trust the frontend timer" only means something if there is a server-side deadline to compare against. Storing it rather than recomputing it per request also protects the student: an author may lengthen or shorten `durationMinutes` while somebody is mid-paper, and recomputing would move the finishing line of an attempt already under way, in either direction. Clamping to the closing time is what stops a paper started five minutes before the window shuts from running an hour past the end of it; the 60-second floor exists because the alternative is handing a late arrival a 20-second attempt that also consumes their only try.

**Alternatives considered**: (a) Recompute `startedAt + duration` on every request — rejected for the mid-paper-edit problem above. (b) Accept a client-reported elapsed time and validate it loosely — rejected: that is the defect being avoided, and a loose bound is still a bound the client chooses. (c) Let a clamped attempt run its full duration past the closing time — rejected: the window is the point of a window.

**Consequences**: the client is *told* `secondsRemaining` and counts down from it, which is a display only — it re-syncs from every answer-save response, and derives its deadline as *now + secondsRemaining* rather than from the absolute `expiresAt`, so a wrong system clock still shows the right remaining time. When the countdown reaches zero the page submits, purely so the student sees their result without reloading; the server would grade the paper at its deadline regardless. A late answer is refused with 409 and **not stored** — not stored late, not stored and ignored at grading.

---

## 2026-08-12 — An expired attempt is finalised lazily, on the next touch, not by a scheduler

**Decision**: an attempt whose deadline has passed is graded the next time anything looks at it — the student returning to it, the student listing their attempts, or an administrator opening the results table, which sweeps that test's attempts before it aggregates. There is no background job.

**Reason**: the deployment target is Vercel's free tier, where there is no always-on process and no cron within the ₹0 constraint. Laziness costs nothing that matters **because grading uses `expiresAt`, not the moment of discovery**: an attempt finalised a week late is marked exactly as it would have been the second the clock ran out, with the same `submittedAt` and the same `timeTakenSeconds`. What had to be avoided is an expired attempt staying unmarked until somebody presses something, and sweeping on read achieves that for both audiences who could notice.

**Alternatives considered**: (a) A Vercel cron job — rejected: anything frequent needs a paid plan, and the free tier's daily schedule would leave a student's result unavailable for up to a day. (b) A sweep on server start-up — rejected: the serverless entry has no reliable start-up hook, which is the same reason `ensureDb` exists. (c) Grading at the moment of discovery rather than at the deadline — rejected: it would record a time taken longer than the test allowed.

**Consequences**: an attempt abandoned by a student who never returns stays `in_progress` in the database until somebody reads it. Nothing user-facing is wrong while it sits there — the student sees "unfinished" and staff see "in progress", both true — but a count of submitted attempts is only accurate after a read, which is why `testResults()` sweeps first rather than last.

---

## 2026-08-12 — Exactly one submission per attempt, enforced by a conditional write

**Decision**: `finalizeAttempt()` grades in memory and then closes the attempt with an update conditional on `status: 'in_progress'`, returning whether that write won (`graded`). A second submission — a double-clicked button, a retry, the countdown firing at the same moment as the button — receives the stored result with `alreadySubmitted: true`. Separately, a unique index on `{test, student, attemptNumber}` stops two requests racing to *start* an attempt from both creating one.

**Reason**: a read-then-write check ("is it still in progress? then grade it") is two round trips with a gap, and on a serverless platform the two halves can be in different invocations. Making the guard part of the write removes the gap. Reporting which call won is what lets the route award XP and write an audit entry only for the submission that actually did something — otherwise a retry would pay twice.

**Alternatives considered**: (a) A `submitted` boolean checked in the handler — rejected: that is the gap above. (b) A MongoDB transaction — rejected as heavier than needed; a single-document conditional update is atomic on its own, and transactions need a replica set that the local development database does not have. (c) Answering the loser with a 409 — rejected: from the student's point of view their paper *is* submitted, and an error would invite them to press again.

**Consequences**: submitting twice is idempotent rather than an error, so the client needs no guard of its own beyond a disabled button. The in-memory grades computed by the losing call are discarded and the stored document is re-read, because the copy in hand was produced by a call that did not win. Two tests cover this: sequential submissions, and genuinely concurrent ones through `Promise.all`, asserting one lot of XP.

---

## 2026-08-12 — When a student sees a score and when they see the answers are separate settings

**Decision**: `MockTest` carries `resultDisplay` (`immediate` / `after_close` / `hidden`) and `reviewPolicy` (`immediate` / `after_close` / `never`) independently. `disclosureFor()` is the only place either is interpreted, and `attemptReviewView()` — the only function that reveals a correct answer — refuses unless it says so. Both are read at request time and deliberately **not** snapshotted onto the attempt.

**Reason**: showing a mark and showing the answer key are different sizes of disclosure, and a real assessment commonly wants the first at once and the second only once nobody can still be sitting the paper — releasing the key while the window is open lets the first student to finish hand the answers to everyone who has not. Reading the policy live rather than snapshotting it is what lets an administrator release results after the window closes, or withdraw a review released too early; a snapshot would freeze that decision at the moment of submission, which is the one moment the author is not present for.

**Alternatives considered**: (a) A single `showResults` enum covering both — rejected: it cannot express "your mark now, the answers later", which is the most common real configuration. (b) Snapshotting the policy for auditability — rejected for the reason above; the audit trail records the author's changes instead. (c) Defaulting `reviewPolicy` to `after_close` because it is the safer policy — rejected as a *default* only: it requires a closing time to be relative to, so an otherwise complete request would fail on a field the author never sent. The default is `immediate`, and the form's help text recommends `after_close`.

**Consequences**: three shapes exist for a finished attempt — full review, score without answers, and submitted-with-nothing-released — so the API returns whichever the policy allows and the frontend has a three-member discriminated union. A withheld score is `null` in the history view too, not merely hidden by the page rendering it. Staff always see real marks on the admin results page: `resultDisplay` governs what a *student* is told, not whether the person who set the test may read their own cohort's results.

---

## 2026-08-12 — A paper and its clock freeze once anybody has sat it

**Decision**: `updateMockTest()` refuses a change to the question list, to any question's marks, or to `durationMinutes` once the test has attempts. Everything else — title, description, instructions, availability window, attempt limit, both disclosure settings — stays editable for the life of the test.

**Reason**: existing attempts snapshot their own paper, so their *marks* would stay correct — but the test's `totalMarks` and the meaning of "this test" would change underneath results already recorded against it, and two students' scores would stop being comparable while still sitting in the same results table and the same ranking. The editable half is exactly the set an administrator legitimately needs after publishing: extend a window, release results, fix a typo in the instructions.

**Alternatives considered**: (a) Allow the edit and re-grade existing attempts against the new paper — rejected: it would mark students on questions they were never shown. (b) Allow the edit and leave old attempts alone — rejected: that is the silent incomparability above. (c) Freeze everything once published — rejected: it would make releasing results after the fact impossible, which is a setting the product deliberately offers.

**Consequences**: changing a live paper means publishing a new test, which is the honest answer and leaves the old results intact. The admin detail endpoint reports `attemptsCount` so the editor can disable the frozen fields and explain why, rather than letting an author rearrange a paper and discover at Save that it was never going to be accepted. Unpublishing is deliberately *not* blocked, and does not disturb an attempt already under way — a student half-way through a paper an administrator pulls still finishes and is marked.

---

## 2026-08-12 — Mock-test XP is 50, once per competition day

**Decision**: submitting a graded mock test with at least one answered question earns `mock_test_completed`, worth 50 XP, at most once per IST calendar day.

**Reason**: the same anti-farming reasoning as `practice_completed` (25 XP, once per day), and worth more because it is a harder thing to do — a timed paper the student did not choose the questions for. Paying per attempt would reward starting papers rather than doing them, and most tests allow only one attempt anyway, so a per-attempt award would also make XP depend on how many tests staff happened to publish that week.

**Alternatives considered**: (a) XP proportional to the score — rejected for now: it is the right idea, and it is what the *official* exam should do, but doing it here would make a mock test worth more XP than the Olympiad it rehearses. (b) Once per test rather than once per day — rejected: it grows with the number of published tests, which is a staff decision rather than a student achievement.

**Consequences**: known bug #16 ("XP measures consistency more than ability") is narrowed again but not closed — a student who scores 40/40 earns the same 50 XP as one who scores 4/40. Official exam scoring is still what will measure ability properly. Extra mock tests on the same day are recorded in full as attempts; they simply do not multiply XP.

---

## 2026-08-12 — `npm run dev:local` sends no email and requires no verification

**Decision**: `scripts/dev-local.ts` now also points SMTP at a dead local port (`127.0.0.1:1025`) and sets `REQUIRE_EMAIL_VERIFICATION=false`, both with `??` so either can be overridden for a run that genuinely wants to exercise delivery.

**Reason**: the same reason the script already overrides `MONGO_URI` — the safe local default should not depend on anyone remembering. `backend/.env` holds **working** SMTP credentials and `dotenv` will not overwrite a variable that is already set, so registering a made-up address against the local database sent a real message through the owner's real provider, to whoever owns the address that was typed. `lib/email.ts` logs and swallows delivery failures by design, so a refused connection leaves registration working while nothing leaves the machine. Verification then has to be off, because with no email arriving there is no link to click and no way to sign in to a fresh local database.

**Alternatives considered**: (a) Document it and rely on the developer setting the variables — that *was* the state, and it is what produced the risk. (b) Make `SMTP_HOST` absent so the log transport prints the link instead — not achievable: the value comes from `.env`, and there is no way to make a variable *absent* from the environment before dotenv reads the file. (c) Add a local mail-catcher dependency — rejected against the ₹0 and no-new-dependency constraints; `npm run verify:email` already exists for testing delivery deliberately.

**Consequences**: a local registration is now a single step, which is what made the Milestone 7 browser verification possible without emailing a stranger. The trade-off is that delivery cannot be observed through `dev:local` at all — that is what `npm run verify:email` is for, and the start-up banner now says so in as many words.

---

## 2026-08-12 — A day's challenge is pinned to a document, not recomputed on every request

**Decision**: `DailyChallenge` is a real collection with one document per `{day, classLevel}`. A day nobody scheduled is **materialised on first request** — the deterministic pick is computed once, written, and served from then on. Every later read, and every attempt, refers to that document.

**Reason**: the previous implementation took `hash(day) % countOfPublishedQuestions` and `skip`ped that far into the bank on every request. That is stable only while the bank is, and the bank is not: **publishing a single question changed which question "today" was, mid-day, for every student in the class.** It also made a past day unrecoverable — "what was Tuesday's challenge?" could only be answered by re-running the hash against a bank that had since moved, which is to say it could not be answered. Once students can *answer* the challenge, both problems stop being cosmetic: an attempt has to refer to something fixed.

**Alternatives considered**: (a) Keep it computed and store only the question id on each attempt — fixes the attempt but not the "today changed under me" case, and still cannot say what a day was for a student who did not answer. (b) Require staff to schedule every day — rejected: the realistic outcome is a day nobody remembered, and a challenge feature that silently has no challenge on a Sunday. (c) Materialise a year ahead by cron — no scheduler on the free tier, and it would freeze the bank's future picks against today's contents.

**Consequences**: two students arriving in the same instant both compute the same question and both try to insert it, so the unique index on `{day, classLevel}` arbitrates and the loser re-reads the winner's row — which is *why* the automatic pick has to stay deterministic even though it is now persisted. The collection grows by one document per class per day (a few hundred rows a year) and never expires, because an attempt points at it. `source` records whether a day was chosen by staff or filled in, so the admin list can tell the two apart honestly.

---

## 2026-08-12 — The daily reward is guarded twice, by two different unique indexes

**Decision**: a student may hold at most one `DailyChallengeAttempt` per `{student, day}` (unique index), and `recordActivity()` independently caps `daily_challenge_completed` at once per competition day (the partial unique index on `StudentActivity`). A second submission returns the stored attempt with `alreadyAnswered: true` and **200, not 409**.

**Reason**: this is the one feature in the product whose entire purpose is a repeatable daily reward, so "claim it twice" is the obvious thing to try and must be impossible rather than discouraged. The two guards are independent — different collections, different keys, written at different moments — so a bug in either one is not a paid exploit. The 200 is deliberate: from the student's point of view they *have* answered today, and an error would read as "try again".

**Alternatives considered**: (a) The unique index alone, with the XP awarded unconditionally after it — one mechanism, and the XP path is the one that pays. (b) A read-then-write check ("has this student answered today?") — on the serverless path two concurrent requests can both pass it. (c) Answering the duplicate with 409 — rejected as above; the *effect* is what matters, and it is already correct.

**Consequences**: the response's top-level `xpAwarded` is what **this request** awarded and is 0 on a repeat, while the attempt's own `xpAwarded` stays as the record of what the first submission earned. That distinction was not academic: returning the attempt's figure let the UI show "+15 XP" every time the button was pressed, which is the half of a double claim a student would actually notice, and it is now covered by a test.

---

## 2026-08-12 — The daily challenge reveals immediately, and pays for answering rather than for being right

**Decision**: submitting reveals the correct answer and the author's explanation at once — there is no disclosure policy, unlike a mock test. The reward is `daily_challenge_completed`, 15 XP, once per competition day, awarded for a **graded submission regardless of correctness**. A blank submission is refused rather than stored. Negative marking is forced to 0 whatever the question carries.

**Reason**: the challenge is a teaching mechanic, not an assessment — one question a day, worth explaining while the student still remembers thinking about it. Withholding the explanation until some later window would defeat the only thing it is for. Paying for correctness on a single question would reward looking the answer up rather than working it out, and would make a student who thought hard and got it wrong worse off than one who did not try; measuring ability is the official exam's job (see the Milestone 6 and 7 ADRs). Refusing a blank keeps that honest without a special case in the reward path: there is no way to claim the day by pressing Submit on nothing.

**Alternatives considered**: (a) A second activity type for a correct answer, worth a bonus — workable and unfarmable, but it puts two rows in the feed for one event and starts making XP a partial measure of ability, which the exam should own. (b) XP proportional to the marks — breaks the invariant that `lib/xp.ts` is the only place an event's worth is stated. (c) Revealing only at end of day, like a newspaper puzzle — rejected: it would mean a student cannot learn from the question on the day they engaged with it, and the answer is already in their hands the moment they submit.

**Consequences**: correctness is recorded on the attempt, shown immediately, aggregated for staff, and counted by the challenge achievements — it simply is not what the XP is for. A wrong answer scores 0 rather than a negative, so the result screen never punishes taking part.

---

## 2026-08-12 — Challenges reach XP and achievements only through service seams

**Decision**: `dailyChallengeService` never writes a `StudentActivity` row and never states what an event is worth — the route calls `recordActivity()`. The achievement catalogue never reads the database — it declares two facts (`challengesCompleted`, `longestChallengeStreak`) on `ProgressFacts`, and `getChallengeFacts()` supplies them.

**Reason**: this is the same rule the codebase already applies to XP (`activityService` is the only writer, `lib/xp.ts` the only pricer) extended to a second direction. Without the seam, the natural implementation is a challenge service that inserts its own activity row with its own number and a catalogue that queries attempts directly — at which point "what is a challenge worth?" has two answers and the achievement rules can no longer be reviewed by reading one file.

**Alternatives considered**: (a) Let the challenge service award its own XP — one fewer indirection, and the exact drift `activityService` exists to prevent. (b) Let `lib/achievements.ts` query the attempt collection — it would turn a pure, synchronously testable rule set into an async one with a database dependency, and every achievement test would need a database.

**Consequences**: adding a challenge-based achievement means adding a fact to `ProgressFacts` and supplying it at the two call sites that build it — mildly repetitive, and the repetition is what keeps the catalogue pure. `NO_CHALLENGE_FACTS` exists for the callers that cannot read the history (no class, no database), so an achievement row shows an honest `0 / 1` rather than vanishing.

---

## 2026-08-13 — One reward engine: `grantReward()` is the only way anything earns XP

**Decision**: `services/rewardService.ts` is the single public entry point for granting a reward. Routes call it and nothing else; `recordActivity()` becomes the layer beneath it (still the only writer of a `StudentActivity` row) and is called by the engine and the backfill script only. Eligibility rules — "practice pays only if something was answered" — move out of the routes into a table in the engine. Callers supply *facts* about what happened (`context: { answeredCount }`), not decisions.

**Reason**: by Milestone 8 the pieces were right and the shape was wrong. Pricing was already centralised in `lib/xp.ts` and writing in `activityService`, but **five routes each decided for themselves whether an event deserved paying for**, with the rule inline next to the HTTP handling. Nothing was broken; a sixth surface would have written a sixth rule, and the answer to "when does practice pay?" would have lived in a route. The milestone brief said it plainly — do not calculate XP independently across controllers — and the honest reading of that is not just "don't compute amounts" but "don't decide entitlement either".

**Alternatives considered**: (a) Leave the eligibility `if`s in the routes and only centralise pricing — that was the status quo, and it is what a sixth surface would have copied. (b) Have the engine infer eligibility by reading the attempt collections itself — rejected: it would couple the reward engine to three attempt schemas, and the route already has the document in hand. (c) Pass a boolean `eligible` from the route — rejected as centralisation theatre: the decision would still be the route's, just spelled differently.

**Consequences**: `recordActivity` gained an optional `xpOverride`, passed only by the engine, which is the one loophole through which a caller could invent a number — so the rule is stated in the parameter's own doc comment rather than assumed. `touchDailyVisit()` moved to `grantDailyVisit()`. Twelve call sites changed and the full suite passed unchanged, which is the useful evidence that the refactor was behaviour-preserving. Idempotency deliberately stayed *below* the engine, in the partial unique index: a check inside `grantReward` would be a read-then-write across two serverless invocations, which is exactly the race the index exists to lose safely.

---

## 2026-08-13 — Badges are tiered families; achievements are one-off goals

**Decision**: badges become a distinct concept from achievements. A **badge** is a family held at a tier (bronze / silver / gold) that keeps levelling as the student does more of the same thing; an **achievement** is a one-off goal that is earned once and stops changing. Five badge families, ten achievements, both derived from the same facts.

**Reason**: `FEATURE_STATUS.md` recorded badges as "delivered as Achievements", which was honest but meant the product listed one idea under two names. Milestone 9 asked for both, and two names for one list is not two features. Making them genuinely different gives each a job: achievements answer *what have I done*, badges answer *how far along am I*. A student with ten practice sessions has one achievement and a silver Practitioner badge — those say different things, and the second keeps saying something new at 50.

**Alternatives considered**: (a) Keep one list and rename half of it — rejected; the split has to be real or it is a relabelling exercise. (b) Make badges awardable by staff — rejected: everything else in this product's progress system is derived from recorded events precisely so it cannot be granted by a bug or a favour, and a hand-awarded badge would be the one figure on the page nobody could explain. (c) Store held tiers on the student — rejected for the same reason XP is not stored: a counter that can disagree with the events behind it eventually does.

**Consequences**: a third catalogue, so `ProgressFacts` moved to `lib/rewardFacts.ts` as `RewardFacts` and is now shared by achievements, badges and the journey. All three stay pure functions of it, testable without a database — the boundary cases (a value *equal* to a threshold holds that tier; a value past gold does not overfill the bar) are unit tests over a plain object. Two new facts were needed, `practiceSessionsCompleted` and `mockTestsCompleted`, and adding a fact remains a deliberate two-step act.

---

## 2026-08-13 — The journey map is ordered, gated in presentation, and measured on cumulative facts

**Decision**: nine stages in a fixed order, exactly one marked `current` (the first incomplete one), each a pure predicate over `RewardFacts`. Stages measure **cumulative** facts — `longestStreak`, not `currentStreak`.

**Reason**: achievements and badges both answer questions about the past. Neither answers the one a new student actually has — *what should I do next?* — and that question has a right answer, because the product has an intended order: verify, practise where nothing is at stake, meet the daily habit, then sit a timed paper. Ordering the stages and highlighting exactly one is what turns a list into a route.

The cumulative-facts rule is the one real trap here and is worth stating: measuring "three days running" on the *current* streak would un-complete the stage the day a student missed. The map would walk backwards, which is not what a journey does and would read as the site taking something away.

**Alternatives considered**: (a) Hide stages ahead of the current one — rejected: seeing what is coming is most of the value, and the sequence is not a secret. (b) Hard-gate later stages so they cannot complete early — rejected: a student who sits a mock test before their first practice has genuinely done it, and telling them otherwise would be a lie in service of a diagram.

**Consequences**: `currentStageId` is null for a student who has finished the path, and the page says so rather than highlighting nothing. The stage list is code, so extending the journey when the official exam lands is a diff rather than a migration.

---

## 2026-08-13 — XP amounts are administrator-tunable; the rules are not

**Decision**: a single-document `RewardSettings` collection holds per-event XP overrides, editable at `/admin/reward-settings` under a new `rewards:write` permission, bounded to 0–500 per event. Which events exist, how often each may be earned, what makes one eligible and where the level thresholds fall all stay in code.

**Reason**: this is safe **only because of a decision made at Milestone 5** — `StudentActivity.xpAwarded` is a snapshot written at grant time, and a student's total is the sum of those recorded values. Re-pricing therefore cannot restate what anybody has already earned; it changes what the next event pays and nothing else. That property is what turns "let staff tune XP" from a way to silently rewrite history into an ordinary setting. It has its own test, and the admin page states it in a panel rather than a footnote, because an administrator who does not know it will either avoid the feature or misuse it.

The amounts/rules split is the other half. An amount is a balancing decision somebody might reasonably want to make on a Tuesday afternoon; a rule is something that should be reviewed in a diff. Making cardinality or eligibility configurable would put "can this be farmed?" behind a form.

**Alternatives considered**: (a) Configure the level thresholds too — rejected: they interact with every badge and achievement target, so a slider there silently moves a dozen other things. (b) Store the whole award table rather than overrides — rejected: adding a new activity type would then require editing the document before the event could ever pay, and forgetting would look like a bug in the new feature. (c) Cache the settings in-process — rejected: grants are rare, the read is one indexed document, and on serverless a per-container cache would buy nothing while making "why is it still paying the old amount?" a real question.

**Consequences**: one extra document read per grant, accepted deliberately. A settings read that fails falls back to the code table and logs, because a configuration outage must not stop a student being paid for work they did. An override is removed by clearing the box — the endpoint takes the whole set, so an absent key means "use the default", and there is no separate reset action to forget about.

---

## 2026-08-13 — Leaderboards stay derived; scope and period are filters, not variants

**Decision**: leaderboards remain an aggregation over `StudentActivity` with no stored standing, and the new scopes (overall / per class) and periods (all time / 30 / 7 / 1 competition days) are `$match` stages on that one pipeline. `services/leaderboardService.ts` is the only place a rank is decided; the ranking code moved out of `progressService.ts`.

**Reason**: this extends the Milestone 5 ADR ("no progress or leaderboard collection") rather than revisiting it. The temptation with class and period boards is to materialise them — five classes times four periods is twenty boards, and each looks like a candidate for a cached document. But a stored standing is a number that can disagree with the events behind it, and the whole requirement of this product is that no displayed figure is invented. Because a board *is* the sum of the same rows XP is derived from, a leaderboard cannot drift from the XP totals it claims to rank.

Putting it in its own service matters for a second reason: by Milestone 10 four surfaces show a standing (landing page, dashboard, the leaderboard page, the Hall of Fame's XP board). Two ranking implementations would eventually disagree, and a rank that disagrees with itself on two pages is worse than no rank at all — so the Hall of Fame's XP board calls `getLeaderboardPage()` rather than writing its own aggregation.

**Alternatives considered**: (a) A materialised `Leaderboard` collection refreshed on a schedule — rejected: the free tier has no scheduler (the same constraint that made mock-test expiry lazy), and a stale board is a wrong board. (b) Rolling time windows measured from `createdAt` — rejected in favour of competition days, so every student's "week" starts at the same instant and a window is a `$gte` on the day key an activity row already carries, with no timezone in the query. (c) Leaving ranking in `progressService.ts` — rejected: it had grown there as a corner of "the dashboard's figures", and scope, period and pagination are a subject of their own.

**Consequences**: the all-time overall board groups the whole activity collection on every request — correct at the scale this product is designed for (a few hundred students; photo storage caps it near 250) and isolated in one function, which is where a cache goes if a cohort ever outgrows it. Period boards are cheaper, because the new `{occurredOn: -1}` index narrows them before grouping. A page costs three aggregations.

---

## 2026-08-13 — Equal XP shares a rank; the order within a tie is deterministic

**Decision**: standard competition ranking — two students on the same XP hold the **same** rank, so a board reads 1, 2, 2, 4. The *order* in which tied students are listed is a total order: XP descending, then whoever reached that total first (`$max` of the counted rows' `createdAt`, ascending), then the account id ascending.

**Reason**: sharing a rank is the honest answer. They earned the same amount, and picking a winner between them would be exactly the kind of fabricated distinction this product does not ship — the same instinct that deleted the invented dashboard tiles in Milestone 5. `getStanding()` has computed rank as "one plus the number strictly ahead" since Milestone 5; this states it as the rule rather than leaving it as an implementation detail, and applies it to the listing too.

But a list still has an order, and "deterministic" is not optional. The second key is the only tie-break with a defensible meaning: of two students on 300 XP, the one who got there yesterday did it first. Sorting by name would advantage the alphabet; leaving it to Mongo's natural order would mean the same board reordered itself between two page loads. The third key exists because the second can itself tie — and without a final *unique* key, pagination can show a row on two pages or on none, which is a data-integrity bug that only appears once the cohort is big enough to page.

**Alternatives considered**: (a) A strict total order with no shared ranks (1, 2, 3, 4) — rejected: it would tell one of two equal students they came second, which is not true. (b) Dense ranking (1, 2, 2, 3) — rejected: it hides how many people are ahead of you, which is the number a rank is for. (c) `$setWindowFields` with `$rank` — it computes exactly this, but was rejected so the correctness of a student's rank does not depend on the MongoDB server version underneath it; the count-ahead approach is two extra `$count`s and works anywhere.

**Consequences**: a page's ranks are computed from one count-ahead plus a walk over the page, because the first row is the only one whose rank cannot be derived locally — a tie may straddle the page boundary. That case has its own test. A board can legitimately show six students at rank 6 and nothing at all at rank 7 through 11.

---

## 2026-08-13 — A signed-out visitor sees the top of the board, not all of it

**Decision**: `GET /leaderboard` stays public, and pagination is capped for an anonymous caller at the first 100 rows (403 beyond it). A signed-in student may page the whole board. Implemented with `attachUserIfPresent`, a middleware that attaches session claims when present and never rejects.

**Reason**: the leaderboard has been public since Milestone 5 by the owner's explicit decision, protected by three things: masked names, no contact details, and a 50-row cap that meant the endpoint returned *a leaderboard* rather than the roll. Pagination silently removes the third — fifty rows at a time, repeatedly, is the whole list. The entrants are children and the page is indexable, so the property had to be restored deliberately rather than lost as a side effect of a feature.

The asymmetry is the point. A signed-in student is already part of this list, and the one thing they most need is to find themselves in it, which requires paging to wherever they are. An anonymous visitor needs to see that the competition is real, which the top hundred shows.

**Alternatives considered**: (a) Require sign-in for the whole leaderboard — rejected: it would hide the competition from exactly the people it is meant to attract, and the landing page's champions section would have to go. (b) Cap page size instead of depth — that is what already existed, and it does not survive pagination. (c) A second, authenticated ranking endpoint — rejected: two ranking surfaces that could disagree, to express one difference in visibility.

**Consequences**: `attachUserIfPresent` is a new kind of middleware in this codebase and is easy to misuse. It grants nothing and must never be used as a gate: anything decided on the strength of `req.user` there is a *presentation* decision, and a capability decision still goes through `requirePermission`, which rejects and re-reads the role from the database. Its docblock says so.

---

## 2026-08-13 — The Hall of Fame measures achievement, not more XP

**Decision**: five boards in `services/hallOfFameService.ts` — XP champions, best mock-test paper (by percentage), longest streak, most correct daily challenges, most practice sessions submitted. A board with no data is returned empty with a reason. There is no official-exam board.

**Reason**: XP measures participation more than ability — a student who scores 40/40 on a mock test earns exactly what one who scores 4/40 earns (known bugs #16, #23, #29). A hall of fame that only re-ranked XP would therefore be the leaderboard with a nicer heading and would honour turning up rather than doing well. Three of the five boards measure performance instead, and each is a real, dated feat.

Several details follow from the same instinct. Papers rank by **percentage**, because 40/40 on a quiz and 40/80 on a final are not the same achievement. Only papers above zero appear, because negative marking makes 0% reachable and "0% of the paper" is not an honour. Streaks use `longest` and never `current`, so a broken run cannot withdraw something a student really did — the same reasoning the journey map's cumulative facts use. Challenges count **correct** answers, because the XP is paid for answering (right for a daily habit) and would otherwise be a third participation count. Practice counts **submitted** sessions, so the board cannot be filled by opening papers and walking away.

The absent exam board is the important omission. `ExamAttempt` and `Result` are read by the product and written by nothing, so a "national champions" board would be permanently empty at best and fabricated at worst. It belongs to the milestone that makes an official sitting exist.

**Alternatives considered**: (a) One board with a category filter — rejected: five things measured in five units read as one ranking, and a visitor would compare a percentage against a day count. (b) Storing a `HallOfFame` document per season — rejected for the same reason as the leaderboard, and there are no seasons yet. (c) Padding an empty board with the nearest thing available — rejected outright; that is the class of invention Milestone 5 spent a follow-up pass removing.

**Consequences**: the streak board loads one array of day keys per active student and computes runs in this process, using the same `summariseStreak()` the dashboard uses so the honoured number and the student's own page cannot disagree. Bounded by the cohort, and carrying the same scale note as the leaderboard. A brand-new deployment shows five empty boards and a panel saying every board is still open, which is true and is the intended first impression.

---

## 2026-08-13 — The super administrator gets a database account (reversing Milestone 3)

**Decision**: the root administrator is now a real `Student` document with `role: 'superadmin'`, auto-provisioned from `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` the first time it signs in. It holds a rotating refresh token, a `tokenVersion`, a `studentId` and a row in the account listing, exactly like every other account. `ADMIN_TOKEN_TTL` is removed. The `root: true` token claim is gone, and `resolveCurrentRole()` no longer has an exemption — **every** caller's role is now re-read from the database on a privileged request.

This directly reverses the Milestone 3 decision that the environment-configured account "remains the bootstrap root with no database document".

**Reason**: the document-less design kept the bootstrap trivially simple, and paid for it everywhere else. With no document there was no refresh token, so the session could not rotate, could not be revoked, and simply died after eight hours with nothing to renew it — which is what the owner reported as "my superadmin privileges are not working". There was no `tokenVersion`, so a leaked root token was valid until expiry and could not be withdrawn without editing an environment variable and redeploying. There was no `actor` id on its audit entries, so "everything the super admin ever did" was a string match on an email rather than a query. It could not appear in `/admin/users`, so the most privileged identity in the product was the only one nobody could see. And it had no password of its own, so rotating the credential meant a redeploy.

Every one of those is a consequence of the same missing row.

**Alternatives considered**: (a) Keep it document-less and give it a refresh token anyway — rejected: a refresh-token family is anchored to a student `_id`, so this means inventing a second, parallel session mechanism for one account. (b) A separate `Staff` collection — rejected for the same reason the Milestone 3 ADR rejected it: promoted admins are already `Student` documents, and splitting staff across two collections means every account query becomes two. (c) Provision it with a migration script instead of on sign-in — rejected as the *default* because it makes deployment a two-step operation with a lockout in the gap; auto-provisioning means the environment credentials keep working and the change needs no operator action.

**Consequences**, and the one that matters most: **`superadmin` is storable but still not assignable.** `ASSIGNABLE_ROLES` omits it, so no API call can mint a second one, and the only writer is the bootstrap. The escalation this opens up had to be closed explicitly in two places: `resolveRootSuperadmin()` adopts an existing document **only** if it already holds `superadmin` (never upgrading a student who happens to hold the address), and registration refuses `ADMIN_EMAIL` outright. Without both, anyone who learned the configured address could register it before the first administrative sign-in and then authenticate with their own password.

Three smaller consequences. `POST /auth/admin/login` now needs a database connection, where it used to answer from the environment alone — acceptable, because every privileged route already needs one to authorize, so a session created without a database could do nothing anyway. The super admin earns **no XP**: `grantReward()` refuses it, because XP is derived from `StudentActivity` and every leaderboard aggregates that same log, so a single daily-visit row would place a staff account on a public board above the children who competed. And `getAdminStats()` excludes it from student counts, since it never registered for anything.

---

## 2026-08-13 — An admin is strictly weaker than a super admin, structurally

**Decision**: `SUPERADMIN_PERMISSIONS` is defined as `[...ADMIN_PERMISSIONS, ...SUPERADMIN_ONLY_PERMISSIONS]`, and the super-admin-only list holds exactly two entries: `users:role:write` and `users:delete`. Admins gain `users:password:reset` and `users:sessions:revoke` alongside their existing capabilities. A data-level guard, `refuseIfProtected()`, additionally confines an admin to acting on plain `student` accounts and refuses everybody on a `superadmin`.

**Reason**: "an admin can do everything a super admin can, except…" is a property that decays. Written as two independent lists it stays true only for as long as everyone remembers to add each new permission to both, and the first divergence is silent. Defining the super admin as a *superset* makes the property structural: there is no second place to add a permission, so it cannot drift. A test asserts the subset relation by reading the table rather than a copied list.

The line itself is drawn at **reversibility**. Everything an admin may do can be undone — a suspension lifted, a status restored, a password reset again. The two withheld capabilities cannot: a role assignment can mint another administrator, and a deletion is final. Confining privilege escalation to the super admin is what stops a compromised admin session widening itself; confining deletion is what stops it erasing the evidence.

`refuseIfProtected()` exists because a permission gate answers "may you do this action", not "may you do it to *this account*". Without it, an admin holding `users:password:reset` could issue themselves a working credential for a peer administrator — a lateral move against the very people who could stop them.

**Alternatives considered**: (a) A numeric privilege level per role — rejected: it implies a total order that does not exist (a student is not "one below" an admin at everything) and it re-introduces role comparisons in handlers, which `lib/permissions.ts` exists to eliminate. (b) Letting admins delete unverified accounts too — rejected: deletion is the one act with no undo, and an abandoned registration is not urgent enough to widen who can destroy data. (c) Emailing a reset link instead of a temporary password — considered seriously and rejected by the owner: the entrants are schoolchildren who often cannot reach the address they registered with, which is exactly when they need help most.

**Consequences**: the temporary password is returned **once**, in the reset response, and never stored in readable form or written to the audit trail — the trail records that a reset happened and who did it. `mustChangePassword` then holds the account on a forced-change screen, and clears in exactly one place (the change-password route), so it cannot be dismissed by anything except actually changing the password. That screen is a *user-interface* gate, not a security boundary: the API remains reachable with the temporary password, as it is with any working credential. What it guarantees is that the ordinary way through the product ends in a password only the student knows.

---

## 2026-08-13 — Results and certificates stay unbuilt until an official exam exists

**Decision**: Milestone 12 completes twelve of the fourteen requested admin areas and deliberately **excludes results and certificates**. No admin console is built over `Result` or `ExamAttempt`, and `getPlatformAnalytics()` does not read either collection. The assessment figures on the analytics page come from `MockTestAttempt`, `PracticeSession` and `DailyChallengeAttempt` instead, and the page states in plain words why there are no official results on it.

**Reason**: both collections are **read by the product and written by nothing**. They belong to the official sitting, which has never been built. An administrative results console over them would be permanently empty at best, and at worst would invite exactly the failure this repository has already paid for once: the Milestone 5 follow-up pass existed to delete a result portal that hashed a typed student ID into a score, and a certificate page that printed "For outstanding participation and achievement" for anybody signed in, dated today. Nobody had earned anything.

Building a *second* surface over the same empty collections would re-create the conditions for that, with an administrator's authority behind it. The owner chose this explicitly when asked.

**Alternatives considered**: (a) Issue certificates against mock-test performance — genuinely real and available today, and the strongest of the three; rejected by the owner in favour of waiting for the official exam, so that a certificate means the thing its wording claims. (b) Let staff issue certificates manually with a free-text reason — real, but it makes a certificate an administrative artefact rather than an earned one, with no criteria to check it against. (c) Build the console now and let it render empty — rejected: an empty console is indistinguishable from a broken one, and it creates pressure to fill it.

**Consequences**: two of the fourteen areas remain openly unbuilt, and `FEATURE_STATUS.md` records them as such rather than as done. When the official exam lands, results and certificates are its natural first consumers, and `platformAnalyticsService.ts` carries a marked note where they belong. Until then the honest answer to "where are the results?" is that no exam has been sat.

---

## 2026-08-13 — A notification is one document with an audience rule, not a fan-out

**Decision**: `Notification` stores an audience *rule* (`all`, or a single `classLevel`) and is never expanded into per-recipient rows. A student's inbox is that rule evaluated at read time by `inboxFilter()`. Read state lives in a separate `NotificationRead` collection with a unique index on `{student, notification}`. Delivery is **in-app only** — nothing is emailed.

**Reason**: fanning out at publish time writes one document per student for a single announcement, and then silently misses everybody who registers afterwards — a notice board only the people already in the room can read. Evaluating the rule on read costs one indexed query and means a new student sees the announcement written yesterday, which is what a notice board does. Changing a student's class correctly changes what they see.

Read state cannot then live on the notification, because there is no per-recipient row to mark, and an array would be worse: an announcement to the whole roll would grow an unbounded `readBy` inside one 16 MB document, and marking one read would rewrite the entire thing. A row per pair is bounded, indexable, and exists only for notifications somebody actually opened. The unique index is what makes "mark as read" idempotent against a double-tapped button or two open tabs.

**Alternatives considered**: (a) Fan out to per-recipient rows at publish — rejected above. (b) `readBy: [ObjectId]` on the notification — rejected above. (c) Email as well as in-app — rejected by the owner: broadcasting to the whole roll is a deliverability and provider-limit problem on a free tier, and the addresses often belong to parents rather than the entrant. If email is added later it belongs *behind* this model, not as a second way of saying the same thing.

**Consequences**: "unread" is an **anti-join** (`_id: { $nin: readIds }`), not a filter, which is why `listInbox()` and `unreadCount()` share `inboxFilter()` — two definitions of unread would eventually disagree with the number on the bell. Deleting an announcement also deletes its receipts, because a receipt pointing at nothing would skew that anti-join for everybody who had read it.

---

## 2026-08-13 — The gallery stores image bytes in MongoDB, with a stated ceiling

**Decision**: `GalleryItem` holds the image as a `Buffer` in MongoDB, capped at **1 MB** per photo and validated by magic bytes through the shared `imageDataUrl()` validator. `data` is `select: false`, and one dedicated route serves bytes. Archiving stops the bytes being served, not merely the listing.

**Reason**: there is no object store, and adding one means a paid service against a ₹0 budget. `StudentPhoto` already established the pattern, so this is consistency rather than a new bet.

The ceiling is written down because it is real and countable rather than theoretical. Atlas's free tier is **512 MB in total**; registration photos are the biggest tenant at up to 2 MB each, which caps the roll near 250 students. Gallery images are bounded by nothing except staff enthusiasm, so at 1 MB each a hundred photos is ~100 MB — a fifth of the entire tier spent on decoration. `PROJECT_STATE.md` now records the gallery as the **second** thing that will force a paid tier or an image CDN.

**Alternatives considered**: (a) External image URLs pasted by staff — zero storage cost, rejected by the owner: it depends on links elsewhere staying alive, and a broken gallery looks worse than none. (b) A curated toppers wall built from leaderboard data with no uploads — real and free, but a different feature, not a gallery. (c) 2 MB to match registration photos — rejected: photos have a natural bound (one per entrant) and gallery images do not.

**Consequences**: `imageDataUrl()` was extracted from `authSchemas.ts` so registration and the gallery share one signature check. That mattered more than the deduplication: a second copy is how one of them ends up trusting the declared MIME type, which is exactly the hole magic-byte checking exists to close. The gallery image route sets `Cache-Control: public`, unlike a student photo's `private` — this content has no authorization behind it, so a shared cache is safe and wanted.

---

## 2026-08-13 — The official exam is its own collection, and `ExamAttempt`/`Result` were rewritten

**Decision**: the official Olympiad is a new `Exam` collection with a **mandatory** announced window, plus rewritten `ExamAttempt` and `Result`. It is not a `MockTest` with `maxAttempts: 1`. One attempt per student is enforced by a **unique index** on `{exam, student}`. Submitting grades the paper and shows no score; releasing results is a separate administrative act that computes ranks and mints certificates in one operation.

**Reason**: Milestone 12 recorded that `ExamAttempt` and `Result` were read by the product and written by nothing, and that certificates therefore could not be built. This milestone builds the exam so that they can be.

Expressing the sitting as a mock test would have been a lie in a field. Every mock test would then be one settings change away from minting certificates, and CLAUDE.md's rule that a mock is not the exam would live only in a comment. The separation is what makes "a certificate can only come from an official exam" true in the schema rather than intended by a handler.

The two rewrites were unavoidable rather than chosen. `ExamAttempt` predated Milestone 4: `studentId` was a plain string, `answers` was `{ questionId, selectedOption }`, and there was **no answer-key snapshot at all** — a shape the current grader cannot mark and that cannot survive a question being edited after the paper was served. `Result` referenced an `examId` string for a collection that did not exist. Neither had ever been written, so there were no documents to migrate.

**Alternatives considered**: (a) A flag on `MockTest` — rejected above. (b) Counting attempts in the handler instead of a unique index — rejected: on a serverless platform a read and its write can land in different invocations, so "count, then insert" has a race a unique index does not. (c) Showing the score on submission, as a mock test does — rejected: ranks are a cohort fact and cannot exist until the window closes, and a mark released before the organisers announce results is a leak.

**Consequences**: the window is **required** here where `MockTest.availableFrom`/`availableTo` are nullable — an exam with no announced timeline is not an exam. `deadlineFor()` takes the sooner of the duration and the window close, so starting five minutes before the close gives five minutes, not the full duration. Publication **sweeps expired attempts first**, so an abandoned paper is graded and ranked rather than silently excluded, which would otherwise flatter everybody else's rank. Equal scores **share** a rank (1, 2, 2, 4), the same rule the leaderboard uses. The paper is frozen once anybody has sat it: questions, duration and class become uneditable, while the window and thresholds stay editable, because releasing late or re-deciding a grade boundary do not rewrite what anyone sat. `snapshotOf()` moved to `services/attemptSnapshot.ts` so mock tests and the exam share one answer-key snapshot — two copies is how one of them ends up missing a key field, and a missing key field is a wrong mark on a student's report.

---

## 2026-08-13 — A certificate is a frozen snapshot, verified by a code that is not its serial

**Decision**: `Certificate` duplicates the name, class, school, exam, score, rank and thresholds that also live on `Student`, `Exam` and `Result`. Every printable field is **snapshotted at issuance** and the PDF is rendered from the snapshot alone. Certificates carry **two** identifiers: a readable serial (`AMIT-CERT-2026-000123`) and a separate 16-symbol `crypto` verification code, and public verification keys on the **code**. There is **no issuance route** — certificates are minted only by publishing an exam's results. Revocation never deletes. Tiers are participation / merit / distinction from **per-exam** thresholds.

**Reason**: a certificate is a statement about a moment — *this person, this paper, this score, this date*. Rendered by joining live documents, correcting a spelling in a student's name would silently reissue every certificate they hold with different text, and re-tuning an exam's merit threshold would change what a two-year-old certificate claims the holder achieved. Worse, verification would then confirm a document that no longer matches the one in somebody's hand.

The two identifiers exist because keying verification on the serial would be an **enumeration oracle**: anybody who noticed certificates are numbered sequentially could walk them and harvest the name, school and rank of every entrant. The serial is a reference, not a secret; the code is ~80 bits and is not walkable. Its alphabet omits `0`/`O` and `1`/`I`/`L`, because it is read off paper and typed by hand, and a misread code makes a genuine certificate look forged.

No issuance route is what answers the brief's "do not allow the frontend to manufacture certificate eligibility": the frontend cannot, because it is never asked. Neither can an administrator — there is no endpoint anywhere that takes a recipient.

**Alternatives considered**: (a) Render from live joins — rejected above. (b) One identifier for both purposes — rejected above. (c) Delete a bad certificate — rejected: a printed copy exists in the world regardless, and telling its holder "no such certificate" reads as a system fault rather than as a decision somebody made, so revoked reports as *revoked* with a mandatory reason. (d) Global merit thresholds — rejected: papers differ in difficulty, and 60% on one is not 60% on another. (e) Merit-only eligibility — rejected by the owner: a student who sat a national olympiad and did badly still sat it.

**Consequences**: `pdf-lib` is a new dependency, chosen because it is pure JavaScript with no native binary and no headless browser, so it works inside a Vercel serverless function on the free tier — the ₹0 constraint rules out both a rendering service and Puppeteer's ~300 MB Chromium. The **seal is drawn from primitives** rather than embedded, so there is no image asset to lose and it stays crisp at any scale; the **gold signature** is Times italic in `#D4AF37` rather than an embedded script font, avoiding another licensed binary in the repository. Issuance is idempotent through the unique index on `{student, exam}`, so republishing results cannot produce a second certificate for the same sitting. A revoked certificate cannot be downloaded again — continuing to hand out fresh copies would undermine the revocation entirely.
