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
