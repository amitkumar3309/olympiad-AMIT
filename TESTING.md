# TESTING.md

_Last updated: 2026-08-15 (Milestone 18 — review before approval)._

## Current State

The backend has a working test suite: **830 passing tests across 25 files** (`backend/tests/`). The frontend still has **no test suite**.

**One helper default worth knowing before writing a test** (Milestone 19): `registerVerifyLogin()` grants the account a captured entry-fee payment, because the fee gates practice, mock tests, the daily challenge and the exam — a test student who cannot practise would be asserting behaviour no real student reaches. Pass `{ paid: false }` as the third argument when *not* having paid is the point. `createAdminSession()` is deliberately unpaid: staff are not entrants.

**`tests/questionGenerator.test.ts` — 21 tests, the Milestone 17 suite, rewritten for Milestone 18.** Several tests now assert the question collection is **empty** after generating — the property the review-before-approval design exists for, and the one that would regress silently back into "saved as a draft". Its organising idea: **a generator is never trusted, so most of the file feeds the pipeline output a real model could plausibly produce and asserts it is refused** — a `\href` smuggled into LaTeX, `<script>` in question text, a single-choice question with two correct options, a numeric question carrying options, 40 questions when 2 were asked for, and a model trying to set its own subject, class and `status: 'published'`.

Nothing touches the network. `setGeminiTransport()` is a test-only hook — it throws outside the test environment, and one test asserts that — and it is what makes the failure paths testable at all:

```ts
setGeminiTransport(() => Promise.resolve(new Response(
  JSON.stringify({ error: { message: 'Quota exceeded...' } }), { status: 429 })))
```

Three properties get the most attention: **the taxonomy comes from the request** (a model's chosen subject/class/status is ignored and the request's values are stored), **no student data is sent** (the request body is asserted not to contain an email, an `AMIT_` id or a mobile number), and **a failure is reported rather than papered over** (quota, prose-instead-of-JSON and an unreachable network each produce a 502 carrying the provider's own words, and **save nothing** — Milestone 18 deleted the template fallback, because filler where an examiner expected questions is worse than an error).

**`tests/recommendations.test.ts` — 36 tests, the Milestone 16 suite.** It inherits the Milestone 15 organising idea and sharpens it: **a test that only asserts a recommendation was produced would pass just as happily against a fabricated one**, so a large share of this file asserts that a finding is *not* produced.

The headline case is a single pair of assertions that justifies the whole design:

```ts
await seedTopicRecord(studentId, noisyIds, 5, 2);    // 2 of 5  → 40%
await seedTopicRecord(studentId, realIds, 80, 30);   // 30 of 80 → 37.5%

expect(names).toContain('Optics');      // the real finding
expect(names).not.toContain('Vectors'); // one bad session, not a weakness
```

Ranking on the percentage would have put the 40% topic first. Ranking on the 95% Wilson interval excludes it altogether. The mirror cases are pinned too: a **perfect five is not a strength**, and a four-answer topic is below the shared `MIN_AREA_SAMPLE` floor whatever its accuracy.

The rest divides into three groups:

- **Advice the product cannot honour.** No practice suggestion may name a topic with no published questions for that student's class; a weakness in such a topic is still reported, but with `action: null`. No difficulty recommendation may name a level the bank does not publish, and "consolidate Easy" suppresses any step-up above it.
- **Provenance cannot be self-declared.** One test registers an engine that smuggles `engine`, `hasData` and `generatedAt` onto its draft, and asserts all three are ignored in favour of the service's own. Another registers an engine that throws and asserts the statistical engine answers instead, with the real finding intact.
- **Purity.** The engine is called with a hand-built facts object and no database involvement at all — if that ever needs a connection, the wall between the service and the engine has been breached. A separate test runs the same record twice and asserts identical ordering, because advice that reshuffles between reloads while claiming to be a measurement is not a measurement.

**`tests/analytics.test.ts` — 32 tests, the Milestone 15 suite.** Its organising idea is that **an analytics test asserting only that a number is present would pass just as happily against a fabricated one**. So every case declares its outcomes up front and asserts the exact figure that must follow:

```ts
await seedPracticeSession({
  studentId, questionIds: ids,
  outcomes: ['correct', 'correct', 'wrong', 'blank'],   // → 3 answered, 66.7%
});
```

`tests/helpers/analytics.ts` builds those attempts through the **real** `snapshotOf()` and `gradeEntries()`, so the stored documents are byte-for-byte what a genuine sitting produces. A hand-written approximation would let the analytics agree with the fixture while both disagreed with the product.

Three properties get the most attention, because each is a way of being wrong that looks right:

- **Weighted, not averaged.** 1/1 in practice plus 1/9 on a mock must give 20%, not 55%.
- **`null` is not `0`.** An untouched difficulty band reports `null`, not a measured zero.
- **Blanks are not wrong answers.** `isCorrect` is `null` for an unanswered entry, so a careless `$ne: false` would count every blank as correct.

One test is a **cross-check rather than an assertion about a value**: it asserts the aggregation's `answered` count equals the attempt's own `totalQuestions - unansweredCount`, which `gradeEntries()` wrote. The aggregation reads `answeredAt` and the grader used `isAnswered()`; if those ever diverge, every accuracy figure in the product shifts silently, so the agreement is pinned rather than assumed.

**`tests/notifications.test.ts` — 46 tests, the Milestone 14 suite.** Its organising idea is that the *failure* path of an email system is the one nobody exercises by accident: the happy path runs on every registration, and the retry path runs only when somebody's provider is down. So most of the file breaks delivery deliberately, using a **test-only** hook in `lib/email.ts`:

```ts
failNextDeliveries(1);         // fail once, then succeed — tests recovery
failNextDeliveries(Infinity);  // fail every attempt — tests giving up
```

It throws outside `config.isTest`, so it cannot be turned on in production, and `clearTestInbox()` resets it. What that buys, specifically: a registration that still returns 201 with a dead provider; a message *retried* rather than lost; a **recovered** provider that genuinely delivers on a later attempt (the case a fail-always test cannot prove); a terminal give-up that keeps the row and the provider's error; two concurrent drains that cannot double-send; and `forgot-password` staying a generic 200 rather than becoming a timing oracle.

Two things about it are worth knowing when adding tests here:
- **The drain is awaited inline under test**, so an assertion can read the captured message immediately after the request that caused it. The non-blocking property lives in `enqueueEmail()` returning after one insert, which is identical in both modes — this only removes a race from the suite.
- **`createAdminSession()` reads a real verification token out of the captured email**, so it cannot run while delivery is failing. Create the admin *before* calling `failNextDeliveries()`.

| App | Runner | Tests | Status |
|---|---|---|---|
| `backend/` | vitest + supertest (+ mongodb-memory-server) | 535 | Passing |
| `frontend/` | none configured | 0 | Not started |

Per file, as measured by the JSON reporter rather than estimated: `questionBank` 76, `dashboard` 71, `rbac` 62, `mockTests` 54, **`leaderboard` 49** (Milestone 10), `practice` 42, `registration.details` 40, `dailyChallenge` 37, `gamification` 31, `auth.security` 27, `profile` 27, `validation` 8, `auth.flows` 5, `errorHandling` 3, and one each for `health`, `ready` and `ready-down`.

**Most of those run against a real MongoDB** started in-process by `mongodb-memory-server`. A subset of the Milestone 5 dashboard suite is pure-function testing of the day, level, streak and achievement rules and needs no database.

**What the Milestone 10 suite is for.** Ranking is the one feature whose output a student will compare against another student's screen, so `leaderboard.test.ts` is weighted toward the ways a rank goes quietly wrong rather than toward the happy path: a tie sharing a rank *and* the next rank being skipped (1, 2, 2, 4 — not 1, 2, 3, 4 and not 1, 2, 2, 3); the same query returning the identical order twice when six students are indistinguishable but for the final tie-break; a tie **split across a page boundary**, which is the case a naive `skip + index + 1` gets wrong; three pages read separately equalling the whole board read at once; the inclusive edge of a period window (day 7 back is in, day 8 is out); a suspended account not consuming a place; and `?xp=999999&rank=1` changing nothing. Most fixtures write activity rows directly, because the suite is about ranking a set of totals — the reward rules that produce them already have their own suite.

**Test files run one at a time** (`fileParallelism: false` in `vitest.config.mts`). Eleven suites now start their own `mongod`; run in parallel they contended for CPU and ports, and the failure that produced was not a clean error — it surfaced as unrelated duplicate-key 409s in whichever suite lost the race. The whole run takes about 90 seconds sequentially, which is a good trade for not chasing phantom failures. Relatedly, `clearTestDb()` now **throws** when there is no connection instead of silently doing nothing; the silent no-op is what turned a harness problem into a pile of confusing assertion failures. That matters: the auth flows are defined by database behaviour — unique indexes, atomic single-use token consumption, rotation bookkeeping — none of which a mock would exercise. This supersedes the Milestone 1 decision to avoid a real database in tests; see [`DECISIONS.md`](DECISIONS.md).

## Commands

```bash
npm test --prefix backend
```

**In an offline environment, run it from inside `backend/` instead** — `mongodb-memory-server` resolves its cached MongoDB binary relative to the working directory, and `--prefix` changes that:

```bash
cd backend && npm test
```

Other verification commands (all must pass before a milestone is considered done):

```bash
npm run typecheck --prefix backend
```

```bash
npm run lint --prefix backend
```

```bash
npm run compile --prefix backend
```

```bash
npm run lint --prefix frontend
```

```bash
npm run build --prefix frontend
```

Watch mode during development: `npm run test:watch --prefix backend`.

## Framework Choice

vitest + supertest, chosen in [`DECISIONS.md`](DECISIONS.md) (2026-08-04). vitest was preferred over Jest for ESM-native startup and lower config overhead alongside `tsx`; supertest exercises the exported Express app in-process without binding a port. Frontend unit tests (vitest + React Testing Library) and end-to-end tests (Playwright) remain recommended but unimplemented — propose in `DECISIONS.md` before installing.

## What Is Covered

### Auth integration suites (real database)

`tests/auth.flows.test.ts` — the two journeys the milestone required:
- **register → verify → login → protected route → refresh → logout**, asserting at each step: registration issues no session; login is refused with `EMAIL_NOT_VERIFIED` while unverified; the emailed token verifies; login sets both cookies; `/auth/me` and a protected route accept the session while an unauthenticated request gets 401; refresh rotates the refresh token and the new access token still works; and after logout the revoked refresh token can no longer buy a session.
- **forgot password → reset password → login with the new password**, asserting the old password stops working, the new one works, and sessions issued before the reset are revoked (both refresh and access).
- Login works with the mobile number as well as the email address.
- The password is never stored in plaintext, never returned, and the stored value is a real bcrypt hash.
- `forgot-password` returns byte-identical responses for known and unknown addresses.

`tests/auth.security.test.ts` — 27 tests covering:
- **Invalid tokens**: garbage verify/reset tokens; already-used verify and reset tokens; an access token signed with the wrong secret; a structurally malformed token; an unknown refresh token.
- **Expired tokens**: expired access token on both `/auth/me` and a protected route (signed with a negative lifetime); expired verification, reset, and refresh tokens (backdated in the database rather than waiting).
- **Rotation and theft detection**: replaying a rotated refresh token revokes the whole family, so even the legitimately rotated token stops working; refresh and verification tokens are stored only as hashes, never plaintext.
- **Revocation**: `logout-all` kills every device; a plain `logout` leaves other devices signed in.
- **Account status**: suspended and deactivated accounts cannot log in, and an existing session stops being honoured the moment the account is suspended; lockout after repeated failures, then recovery once the window passes.
- **Validation and conflicts**: weak passwords, a password with no digit, a malformed email, duplicate email vs duplicate mobile (distinct messages), unique `studentId` allocation, and one shared message for unknown-account vs wrong-password.

### RBAC and privilege escalation (real database)

`tests/rbac.test.ts` — **62 tests**, the Milestone 3 suite. Its organising idea is that authorization must be attacked at the API, not through the UI, so every case issues raw HTTP requests with hand-built cookies.

- **The permission surface**: a student's token grants only student permissions; the root account is `superadmin` and holds `users:role:write`; a promoted admin holds the administrative permissions but *not* `users:role:write`.
- **A student cannot reach admin APIs**: every one of the six admin endpoints is asserted to return **403** for a student and **401** for a guest, via `it.each` so a newly added endpoint cannot quietly skip the check. Also asserted through the unversioned `/api` alias, so the compatibility mount is not a way around the gate, and asserted not to leak another account's email in the refusal body.
- **Token manipulation**: a `superadmin` token signed with the wrong secret; an unknown role (`root`); no role claim at all; a genuinely-signed token whose `role` claim lies about a student account (refused **403**, because the database is the authority); a `superadmin` claim attached to a student account; and a Milestone 2 style admin token that has a role but no subject (refused **401** — it must not degrade into matching an arbitrary account).
- **Self-assignment**: `role` submitted in the registration body is ignored; `superadmin` is rejected by the role endpoint's enum, so no API path creates a second root admin.
- **Losing privileges immediately**: an admin demoted *directly in the database* — leaving `tokenVersion` untouched, so only the freshness check can catch it — is refused on the next request with a still-valid token. Likewise a suspended admin, and a deleted account. Role changes and suspensions are asserted to end the target's sessions.
- **No lateral or upward movement**: an admin cannot promote anyone (including itself), cannot suspend a peer admin, and cannot change its own status; a super admin can suspend an admin; an unverified account cannot be promoted.
- **Cross-account reads**: a student cannot read another student's analytics but can read their own; an admin can read anyone's; a demoted admin immediately cannot.
- **The audit trail**: role changes, status changes, question generation and administrative sign-ins each write an entry with the expected actor, target and `from`/`to` metadata; a refused request writes `authz.denied` naming the missing permission; an admin can read the trail and a student cannot; filters work and an unknown action filter returns 400.
- **Listing behaviour**: pagination totals; no password hash anywhere in a response; role and status filters; a `.*` search term matching nothing (proving the regex escape); malformed IDs and unknown statuses rejected with 400; 404 for a missing account; reactivation clearing the lockout; and an unchanged status writing no audit entry.
- **A promoted admin keeps its student capabilities**: it can read its own analytics, refresh its session (getting `role: 'admin'` back), and sign out everywhere.

### Registration details and photo (real database)

`tests/registration.details.test.ts` — **40 tests**, the Milestone 4 suite. Its organising idea is that a field is only "saved" if it can be **read back out of MongoDB**, so the assertions query the collection rather than trusting the response body — the bug this milestone fixed was data being collected and not stored.

- **Persistence**: every one of the nine new fields is read back from the `students` collection after a registration; `fullName` is derived as `First Middle Last`, and as `First Last` when there is no middle name.
- **Required fields**: an `it.each`-style loop asserts that omitting any one of the eleven mandatory fields returns **400** and leaves the collection empty. `middleName` is asserted to be genuinely optional, and to normalise whitespace to `null`.
- **Class**: all ten offered classes are registered successfully in one test; `Class 4` and a bare `Class 12` (no stream) are refused.
- **Date of birth**: a future date, an implausible year and a non-date string are each refused.
- **Names**: a Devanagari name is accepted — this caught a real bug, since Indic vowel signs are Unicode *marks* rather than letters and a `\p{L}`-only pattern rejected `अमित`. Digits and a one-character name are refused.
- **Photo**: stored in `StudentPhoto` with the right content type and byte length, and asserted **not** to appear anywhere on the student document; over-2 MB, a non-image with an image MIME type (the magic-byte check), a disallowed image type, and a non-data-URL are each refused with no account created.
- **Reading a photo back**: a student gets their own with `Content-Type: image/jpeg` and `Cache-Control: private`; a guest gets 401; **another student gets 403**; an admin gets 200; a missing account does not 500; and the gate is asserted on the unversioned `/api` alias too.
- **Legacy accounts**: a pre-Milestone-4 document is inserted straight into the collection, bypassing the model, and an admin is asserted to still be able to suspend it — the regression that plain `required: true` would have caused.

### Question bank (real database)

`tests/questionBank.test.ts` — **77 tests**, the Milestone 4 suite. Everything goes through the **API** rather than inserting documents directly, so each test exercises the same validation and authorization a real author would hit.

- **The full CRUD flow in one test**: create → read → update → publish → archive → restore → delete-refused → delete-a-fresh-draft-succeeds. It asserts the draft default, the server-assigned option keys (`a`–`d`), the revision bump, tag normalisation, and that `publishedAt` survives a return to draft while `archivedAt` is cleared.
- **Taxonomy**: slug derivation, case-insensitive duplicate rejection, rename re-deriving the slug, an empty PATCH body rejected rather than reported as success, and archiving refused while published questions reference the entry.
- **Subtopics**: depth 0 vs 1 in one collection, a third level refused, a parent from a different subject refused, the same topic name allowed under two subjects but not twice under one parent, and `parent=root` vs `parent=<id>` listing.
- **Taxonomy consistency on a question**: a topic from another subject, a subtopic from another topic, and a subtopic passed in the `topic` field are each refused — these are the mismatches Mongoose refs cannot prevent and that would produce a question no filter could find.
- **Per-type answer rules**: all four types accepted; wrong correct-option counts, duplicate option text, all-options-correct, a single option, and every "must not carry" case (a numeric answer on an MCQ, options on a numeric, tolerance on a non-numeric) refused.
- **Marks**: stored, defaulted to no negative marking, and refused when negative marks exceed the marks awarded, when signed, or when absurd.
- **Mathematics**: LaTeX stored verbatim; escaped `\$` accepted; unbalanced and empty delimiters refused; **macro-definition bombs** (`\def`, `
ewcommand`, `\csname`) refused; `\href`/`\includegraphics`/`\input` refused; `<script>`, `onerror=` and `<iframe>` refused; and the same rules asserted on options and solutions, not just the stem.
- **Editorial workflow**: publishing without a solution refused; `draft → in_review → published` accepted; `archived → published` refused; a no-op transition refused; an unknown status rejected with 400.
- **Search / filter / sort / paginate**: stable pagination with no question on two pages, a past-the-end page returning empty rather than erroring, filters combining as AND, a `.*` search term matching **nothing** (proving the regex escape), LaTeX source being searchable, sorting both directions, and an off-allow-list sort key or over-large page size rejected.
- **Answer-key protection**: from a real student session, neither the listing nor a single read contains `isCorrect`, `solution`, `numericAnswer` or `booleanAnswer` — while the options themselves are still present, because a student has to answer. Drafts are invisible; a draft asked for by id returns **404, not 403**. Every admin endpoint is refused to a student (403) and a guest (401), including through the unversioned `/api` alias.

### Own profile and account settings (real database)

`tests/profile.test.ts` — **27 tests**, Milestone 5. Assertions read the saved documents back rather than trusting the response body: the milestone's point is that the data is genuinely persisted, so a test that only inspected the echo would prove nothing.

- **Reading**: every stored registration field is returned; `passwordHash` appears nowhere in the body; unauthenticated is 401 on both `/api/v1` and the unversioned alias; the root admin (which has no `Student` document) gets a clean **404, not a 500**.
- **Editing**: each changed field is read back out of MongoDB; `fullName` is re-derived from the edited parts; an identical submission reports `changed: false` and records no activity row.
- **Privilege**: a request carrying `email`, `mobile`, `studentId`, `role: 'admin'`, `status: 'suspended'`, `isEmailVerified: false` and `tokenVersion: 999` alongside the legitimate fields changes **none** of them — the schema omits them, so they cannot reach the update.
- **Validation**: an out-of-range class, a future date of birth, a name containing digits, a too-short address and a one-character school name are each 400 rather than 500.
- **Photo replacement**: the stored document is replaced, not duplicated (count stays 1), the bytes and content type actually change, and the existing photo endpoint then serves the new type. A payload declaring PNG but containing text, a non-image content type, and an over-2 MB image are each refused.
- **Password change**: the old password stops working and the new one starts; a wrong current password is 401 and leaves the old password working (a failed guess must not lock the owner out); a new password identical to the current one, or failing the policy, is 400. A second device is evicted while the device that made the change stays signed in.
- **Recording**: the activity rows are written with 0 XP; the audit entries exist with `actorLabel` set to the student's own `AMIT_xxxx`; the profile entry's metadata names the changed **fields** and does **not** contain the address value; and neither password appears anywhere in the audit document.

### Progress, dashboard and leaderboard

`tests/dashboard.test.ts` — **55 tests**, Milestone 5. The rules (day boundary, levels, streaks, achievements, name masking) are tested as pure functions; the rest goes through the API against a real database.

- **Competition day**: `2026-06-01T19:30:00Z` files under `2026-06-02` because that is 01:00 IST, while 12:30Z the same day does not; day arithmetic crosses month ends and a leap year (`2028-03-01` back one day is `2028-02-29`); `2026-02-30` and `01-06-2026` are rejected as keys.
- **Levels**: a new account is level 1 at 0 XP; 99 is still level 1 and 100 is level 2 (the threshold is exact, not approximate); the position inside a level is coherent; levels continue past the end of the threshold table; negative input clamps rather than producing a negative level.
- **Streaks**: zero for no activity; a run kept **alive when the last visit was yesterday**, because today is not yet lost; broken once a whole day is missed, while the historical run still counts as the longest; a longest run reported correctly when the current one is shorter; duplicate and unsorted input handled.
- **XP, end to end**: a freshly registered, verified, signed-in account holds exactly **110** — asserted against the sum of the three award constants *and* against the literal, so a change to either has to be deliberate. Opening the dashboard three times does not change it. A replayed `email_verified` is refused by the unique index. Two genuine prior visits produce a 3-day streak and exactly 3 × the daily award.
- **Honest empty states**: `recentTests` is `[]` and contains no `accuracy` or `score` key at all; the challenge list is empty when nothing is published for the student's class, when the published questions are for a *different* class, and when they exist but are still drafts.
- **No fake data**: the dashboard response is asserted not to contain `Ananya Sharma`, `Rahul Verma`, `Priya Singh`, `Rapid Calculus Sprint`, `Aarav Gupta`, `8.91` or `450+` — the exact figures this milestone deleted.
- **Achievements**: only what the facts support is earned; the verification badge follows the real flag; a locked achievement carries real progress (`2/3`), not an empty bar; progress is capped at the target so a bar cannot overfill; and **no achievement code contains `exam` or `accuracy`**, because none could be satisfied yet.
- **Leaderboard**: ordered by real XP with correct ranks; readable unauthenticated but publishing only `Test S.` — the full name, email address and mobile number are asserted absent; a suspended account disappears from the board; a student with no XP does not appear; `limit=500` is rejected; an empty board is a 200 with `[]`, not an error.
- **Public stats**: real counts for two students at two schools, and **all four figures zero** on an empty deployment rather than a headline number.
- **Daily challenge**: no answer-key field (`isCorrect`, `solution`, `booleanAnswer`, `numericAnswer`, `tolerance`) appears; the same question is returned twice in a row, so it cannot be rerolled by reloading; `challenge: null` with a reason when nothing is published; and the legacy `/daily-challenge` path now requires a session and no longer mentions the mock it replaced.
- **Activity feed**: paginated correctly; 401 unauthenticated; an over-range `limit` rejected rather than honoured.

### Foundation suites (no database)

These run against the app exported from `backend/src/app.ts` via supertest, with **no database required**.

- `health.test.ts` — `GET /health` returns 200 with an `ok` status and no DB dependency.
- `ready.test.ts` — `GET /ready` returns 200 when the connection module reports connected (module mocked).
- `ready-down.test.ts` — `GET /ready` returns 503 with `success:false` when it reports disconnected.
- `errorHandling.test.ts` — unknown routes return 404 in the standard `{success:false, error}` envelope; an unauthenticated request to a protected route returns 401; and the unversioned `/api` alias returns the same status as `/api/v1` (guards the frontend-compatibility promise).
- `validation.test.ts` — rejects a short password and a missing `fullName` with 400; rejects an invalid `difficulty` enum with 400; accepts a filter-less query; and asserts a *valid* query never produces a 500.

That last assertion exists because of a real bug this milestone hit: `req.query` is a getter-only accessor in Express 5, so the validation middleware's `req.query = parsed` assignment threw, producing a 500 on the **success** path only. The original test asserted merely `not.toBe(400)`, which passed while the endpoint was broken. Assertions here should name the status they forbid.

## Deliberately Untested

Milestone 2 closed most of the previous gap — JWT tampering/expiry, token revocation, account status, lockout and password hashing are all now covered. What remains untested:

- **Rate limiting.** The limiters are active in production code but **disabled under `NODE_ENV=test`**, because the suite deliberately hammers the same endpoints from one IP and throttling would make results order-dependent. The configured limits are documented in [`SECURITY.md`](SECURITY.md) but not asserted.
- **Security headers and CORS.** `helmet` and the origin allow-list are applied but not asserted.
- **Real email delivery.** Tests use an in-memory transport, so SMTP configuration, provider auth and deliverability are unverified by automation. The token extracted from the captured email *is* the real one, so the flow logic is genuinely tested — only the transport is not.
- **The production fail-closed check on a missing `JWT_SECRET`.** Asserting it needs a separate process, since it throws at module load.
- **`ensureDb` middleware.** Verified manually (a clean 503 in 93ms with the database down), not by a test.
- **The 503-on-privileged-routes path.** That a privileged route answers 503 rather than 403 when the database is unreachable is documented in [`DECISIONS.md`](DECISIONS.md) but not asserted.
- **Audit-write failure.** That a failed audit write does not fail the action it describes is implemented and commented, but not exercised by a test.
- **Graceful shutdown.** Signal handling is not exercised.
- **CSRF.** No mechanism exists yet, so there is nothing to test — see [`SECURITY.md`](SECURITY.md).
- **The entire frontend.** No component, hook, or routing tests exist — so `RequirePermission`, the `Unauthorized` state, `can()` and the permission-filtered navigation are verified only by driving a real browser. Notably, the *backend* half of every one of those permissions **is** tested, so a frontend regression could show the wrong menu but could not grant real access.

## Test Environment Notes

- vitest sets `NODE_ENV=test`, which makes `config/env.ts` **skip** `dotenv.config()`. Tests therefore never pick up a developer's real `.env` — they run against schema defaults. This is deliberate; don't "fix" it by loading `.env` in tests.
- `tests/setup.ts` sets `mongoose.set('bufferCommands', false)` so a test that accidentally touches the database fails fast instead of hanging.
- `config.mongo.serverSelectionTimeoutMS` drops to 300ms under test (8s otherwise). Without this, the no-database path took Mongoose's default 30s and blew the 5s per-test timeout.
- bcrypt cost drops to **4** under test (12 otherwise). At cost 12 each hash takes ~250ms, and the auth suites hash dozens of times; this keeps the suite fast without changing the code path.
- Rate limiters are skipped under test (see "Deliberately Untested").
- `tests/helpers/db.ts` starts one `MongoMemoryServer` per test file, then explicitly builds indexes with `createIndexes()`. The models are compiled before the connection exists (they are imported with the app), and `Model.init()` also tries to auto-create collections, which races a freshly opened connection — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- `tests/helpers/auth.ts` provides `registerVerifyLogin()`, `loginRootAdmin()` and `createAdminSession()` (which registers, has the root admin promote, then signs in again — the only way an admin account comes to exist), plus cookie parsing and real-token extraction from the captured email.
- `tests/setup.ts` also puts root-administrator credentials into `process.env` before any test file imports `src/config`, so the real `/auth/admin/login` path is exercised. The password hash is computed at runtime rather than committed, so no hash — even a throwaway one — lives in the repository.
- `backend/tsconfig.json` (build) excludes `tests/`; `backend/tsconfig.test.json` includes them for type-checking and lint; `vitest.config.mts` excludes `dist/`. All three are needed together — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for the failure mode when they disagree.

## Manual Verification

Milestone 1 was additionally verified by running both servers together and exercising the API with `curl` plus a real browser load of the SPA. Any PR/commit that adds or changes a route should describe how it was manually verified, per the Definition of Done in [`CLAUDE.md`](CLAUDE.md). The Postman workspace under `postman/`/`.postman/` is still empty scaffolding.

## Priority Gaps To Close Next

1. **Frontend tests** — the largest remaining hole; the auth and admin UI are verified only by manual browser walkthroughs. Now more valuable than before Milestone 3, since there are route guards and permission-filtered navigation whose *display* logic nothing asserts (their enforcement is covered server-side). Propose a framework in `DECISIONS.md` before installing one.
2. **Rate-limit assertions** — would need a limiter that can be enabled per test rather than switched off wholesale.
3. **CI** — nothing runs these commands automatically yet; they are manual.
4. **Integration tests for future data features** (exam attempts, results) — the real-database harness now exists, so these are cheap to add.
