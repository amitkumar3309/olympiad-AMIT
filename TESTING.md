# TESTING.md

_Last updated: 2026-08-15 (Milestone 18 — review before approval)._

## Current State

The backend has a working test suite: **1258 passing tests across 35 files** (`backend/tests/`), re-measured on 2026-08-31 at the close of Milestone 24, which added **five** — the IST rollover arithmetic (`dayStartsAt` / `nextDayStartsAt` / `secondsUntilNextDay`), the `rollover` block on the challenge endpoint in both its answerable and its empty state, and `challenge.source` distinguishing a staff-scheduled day from an automatically filled one. It was 1253 across the same 35 files at the close of Milestone 23 — **unchanged through all eight of its phases, because none of them touched `backend/`**; first measured on 2026-08-28 after Milestone 22 Phase C and the content reset (1138/31 before the milestone; 882/26 before Milestone 21). Read the number from `npm test --prefix backend` rather than quoting this line later.

**One helper default worth knowing before writing a test** (Milestone 19): `registerVerifyLogin()` grants the account a captured entry-fee payment, because the fee gates practice, mock tests, the daily challenge and the exam — a test student who cannot practise would be asserting behaviour no real student reaches. Pass `{ paid: false }` as the third argument when *not* having paid is the point. `createAdminSession()` is deliberately unpaid: staff are not entrants.

**`tests/questionGenerator.test.ts` — 52 tests, the Milestone 17 suite, rewritten for Milestone 18 and extended by 30 tests in Milestone 20.**

Milestone 20 replaced the `fetch`-level fixture with a **client-level seam**: `setGeminiClientFactory()` swaps the whole `@google/genai` client, so a fake is four lines rather than a hand-built HTTP response, and it still throws outside the test environment so it cannot be reached at runtime. **No test makes a network call**, and none needs an API key — `enableGemini()` sets an obviously-fake string, because `isAvailable()` only asks whether a key is present. What the new tests cover, all of it offline:

- **Retry classification**, which is the part most likely to cost real money if it regresses: a 429 retried once and then succeeding; a 403 **not** retried at all (the spy asserts one call); a 503 retried exactly `GEMINI_MAX_RETRIES` times and no more.
- **Key redaction** — a provider that echoes the credential back in its error text, asserting the response contains `[redacted]` and not the key.
- **Structured output** — the `responseSchema` actually sent: that a numeric request's schema has *no* `options` property, that the batch size and option count are pinned, and that `marks` is absent from it.
- **Prompt injection** — that the requirements appear *before* the examiner's instruction, and that a triple-quote fence inside that instruction cannot close the real one.
- **Cost limits** — a `count` or an instruction over the configured maximum is refused with **no provider call made** (`spy.calls === 0`).
- **Subtopics** — named in the prompt, saved on the row, and a subtopic from another chapter refused *before* a request is spent.
- **Provenance** — the model recorded from the server's own log, and a client's attempt to claim `source: 'human'` or a different model ignored.
- **The dry run** — that its verdict matches what approval actually does (the same batch is then approved, and the same one question is refused), and that it writes nothing.
- **Advisory warnings** — a figure reference, an answer missing from a solution, a loose tolerance, and batch-level answer-position bias — each asserting the candidate is **still returned**, because these annotate rather than reject.
- **Authorization on both prefixes** for the two new routes, guest and plain student.

One test is worth knowing about if it ever fails for a confusing reason: the position-bias test needs **four textually different** questions, because four near-identical ones are eaten by duplicate detection first and there is no batch left to find a pattern in.

Milestone 18's original description follows.

**The Milestone 18 rewrite.** Several tests now assert the question collection is **empty** after generating — the property the review-before-approval design exists for, and the one that would regress silently back into "saved as a draft". Its organising idea: **a generator is never trusted, so most of the file feeds the pipeline output a real model could plausibly produce and asserts it is refused** — a `\href` smuggled into LaTeX, `<script>` in question text, a single-choice question with two correct options, a numeric question carrying options, 40 questions when 2 were asked for, and a model trying to set its own subject, class and `status: 'published'`.

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

1. **Frontend tests** — the largest remaining hole; the auth and admin UI are verified only by manual browser walkthroughs. **Milestone 23 made this gap more visible rather than smaller.** Its eight phases drove a scripted browser over every route at four widths in two themes and found real defects that the backend suite could not see: an optimistic answer save that made a paper report "3 answered" and score 0/12, contrast failures in nine places, 28 headings at the wrong level, and a 404 page with no `h1`. Every one of those is a frontend-only assertion, and every one of them can silently come back, because nothing runs on a commit. What a suite would need to cover first, in the order the milestone found them: the two answer runners’ save-and-rollback, the route guards’ display logic, and the response shapes the admin pages assume (two Phase E defects were assumptions a client made about a payload). **Milestone 24 added a fourth candidate**: `components/ChallengeCountdown.tsx` is pure logic over two server figures — it should tick down, hold at zero, call `onElapsed` exactly once, and re-derive from the absolute instant rather than counting its own firings — and all of that is currently verified only by having watched it in a browser. Now more valuable than before Milestone 3, since there are route guards and permission-filtered navigation whose *display* logic nothing asserts (their enforcement is covered server-side). Propose a framework in `DECISIONS.md` before installing one.
2. **Rate-limit assertions** — would need a limiter that can be enabled per test rather than switched off wholesale.
3. **CI** — nothing runs these commands automatically yet; they are manual.
4. **Integration tests for future data features** (exam attempts, results) — the real-database harness now exists, so these are cheap to add.

---

## Milestone 22 Phase H — the regression pass, and what a browser adds

Thirteen areas, driven in a browser against a real backend rather than asserted from the suite.
**No regression was found.** What the pass is worth recording for is the *shape* of what it caught
across the whole milestone, none of which a backend test could see:

- a referral link generated by the API pointing at **a frontend route that did not exist** (Phase F);
- a `behavior: 'smooth'` scroll whose failure mode is doing nothing (Phase F);
- an assumed `created` field and ignored `publishFailures` in Milestone 21 Phase F, the precedent for
  all of the above.

Every one is a disagreement between the two halves, which is exactly what a suite that only runs one
half cannot detect — and the standing reason a browser pass is mandatory for a new page.

**Four false alarms in this pass, all of them the probe rather than the app**:
`/practice/availability` (it is `/practice/options`), `/rewards/me` (it is `/me/rewards`), saving an
answer with `POST` (it is `PUT`), and looking for a `solution` field in a review view that calls it
`correctAnswer`. A fifth was a `table tbody tr` selector on a page that renders cards. When a
hand-written probe disagrees with a well-tested backend, suspect the probe.

**The answer-key rule was re-checked by hand in both directions**, because it is the rule this
codebase has broken twice: an in-progress practice session carries options of only `key`/`text` and
none of `correctAnswer`, `explanation`, `outcome`, `solution`, `isCorrect`, `booleanAnswer`,
`numericAnswer` or `tolerance`; the same session once submitted carries the first three.

## `tests/referrals.test.ts` — 39 tests (Milestone 22, Phase E)

**A referral programme is a way to pay money out, so most of this file is about the ways it must
refuse to.** Self-referral, a code that does not resolve, a second attribution for the same
registration (asserted against the unique index itself, not a handler), a reward accruing before the
money arrives, the same reward accruing twice from a duplicate capture, a reward paid twice, a reward
paid without being approved, a reward rejected after being paid, and an amount changing after it was
earned.

**Nothing is faked and no rule was invented.** Several tests assert that with nothing configured a
converted referral accrues **zero** and reports `no_reward` — distinct from both "not converted" and
"owed money". The settings tests assert the defaults are off/₹0, because a plausible default would
have been indistinguishable from a decision somebody made.

**Payments go through the real path.** `payFor()` calls `capturePayment()` rather than setting
`status: 'captured'` by hand, because the referral hook lives *inside* it — a test that wrote the
field directly would pass against a build where the hook had been deleted.

Also: the code's shape and stability; two students getting different codes; the share link built from
`FRONTEND_URL` rather than a hardcoded domain; a lower-case code from a shared link still working; a
suspended referrer's code no longer resolving; masking on both the public validate endpoint and the
student's own list (asserted by searching the whole response for the surname); read-time
reconciliation healing a referral whose hook was missed; authorization on both URL prefixes; and the
student directory showing a code and who introduced whom.

**Phase F added no backend test, because it added no backend code** — and it is worth recording what
that cost. Two defects reached the browser pass that **no backend test could have caught**, both of
them about the seam between the two halves: the referral link `referralLinkFor()` generates points at
`/register`, and the frontend had no such route and no catch-all, so every referral link rendered a
blank page; and the scroll-to-form used `behavior: 'smooth'`, which silently does nothing in
environments that do not animate scrolling. A link generated on one side of the wire and consumed on
the other is exactly the shape a backend suite cannot see, which is the standing argument for the
browser pass being mandatory on a new page.

**One defect this suite caught before it shipped**, and it surfaced nowhere near its cause: eleven
tests failed with a 500 on the *root administrator's login*, because `Student.referralCode` had been
declared `unique + sparse` **with `default: null`** — which makes every document carry an explicit
null and lets exactly one exist. See `TROUBLESHOOTING.md`.

## `tests/contentReset.test.ts` — 22 tests (Milestone 22)

The most destructive capability in the product, so the file is weighted towards everything that
should **stop** it rather than towards the deletion.

**Authorization.** An *ordinary administrator* is refused, not merely a student — that is the whole
safety argument for `content:reset` existing as its own permission. One test then asserts the thing
a status-code-only test would miss: that a 403 **deleted nothing**, checked by counting the
collection afterwards.

**The confirmation phrase.** Missing (400, nothing deleted), wrong words (400, and the message names
the right ones), **another scope's phrase** (400 — the phrases differ precisely so one dialog's
confirmation cannot empty a different area), wrong case (400), and surrounding whitespace forgiven.
An unknown scope is a 400 rather than falling through to one that exists.

**Blockers.** Chapters refused while questions are filed under them, and the question bank refused
while a mock test is built from it — each asserting the **409 message names what to reset first**,
including singular verb agreement, and that the data is still there. Then the same three areas reset
cleanly in dependency order once the blockers are cleared.

**What must survive.** XP after mock tests are wiped (`StudentActivity` counted before and after),
the chapters after the question bank is wiped, the questions after the daily challenge is wiped, and
the `Subject` after the chapters are wiped — the last matters because `requireImplicitSubject()`
refuses a write without one, so deleting it would leave an administrator unable to create the first
replacement chapter.

**The trail.** A `content.reset` entry exists afterwards, with the scope in `targetId` and the
per-collection counts in its metadata.

## `tests/invoices.test.ts` — 26 tests (Milestone 22, Phase C)

Three properties, each of which fails silently in production:

**A student reaches their own invoice and nobody else's.** The id is in the URL, so the test that
matters is the one that changes it — asserting **404**, not 403, because ownership is part of the query.
Plus a malformed id (400), a well-formed id that does not exist (404), a guest (401), and the staff
route refused for a plain student on **both** URL prefixes.

**The number is stable and the download creates nothing.** Four consecutive downloads must yield one
number and leave the document count unchanged — which is the observable form of "there is no `Invoice`
collection". `invoiceNumberFor()` is also asserted against a **literal** (`AMIT-INV-2026-E5F60718293A`)
rather than against its own derivation, so a change to either half breaks a test instead of silently
renumbering every invoice ever issued.

**The money is the money that was taken.** One test captures a ₹100 payment, *then* raises the fee to
₹199 through `PaymentSettings`, and asserts the invoice still reads ₹100 in figures and in words. A
regression here hands a student a receipt for an amount they never paid.

Also: a non-captured payment refused with **409 naming its state** (attempted, failed, and refunded with
its own message); the signature absent from the preview JSON; `Invoice` vs `Tax Invoice` decided by
whether a GSTIN is configured, with no tax wording invented when it is not; Class 3 and Class 12 alike;
and **a name in Devanagari** — `pdf-lib` throws on a character its standard font cannot encode, and
registration accepts names in any Indian script, so without the sanitiser that student's download is a
500. `amountInWords()` has its own unit tests, including lakh/crore grouping, zero, and a paise
remainder.

## `tests/studentDirectory.test.ts` — 28 tests (Milestone 22, Phase B)

The admin student directory and its Excel export. Three organising ideas, each aimed at a failure the
happy path would not catch.

**Most of the file is about students who did not pay.** A directory that quietly listed only paying
students would be indistinguishable from a working one until somebody asked how many people had
registered — so the fixture builds one student in *every* payment state the platform can produce
(captured, failed, attempted, refunded, and no payment row at all) and asserts each appears in the
default listing, by state. One test covers the ordering rule that matters most: a student who failed
twice and then paid is `paid`, and the payment shown is the capture rather than the latest write.

**The export is the listing.** One test sends the same filters to both endpoints and compares the sets
of student ids, because an export built from its own query is an export that disagrees with the screen
the administrator pressed the button on. Others assert the amount arrives as a real number in rupees
(so the column sums), the payment date as a real `Date`, `scope=all` discarding every filter, and the
cover sheet naming both the filters and the administrator who took the file.

**What must never be in either.** The listing's whole JSON body and the workbook's cells are serialised
and searched for `passwordHash`, `tokenVersion`, a bcrypt prefix and a payment signature — searched as
text rather than field by field, because the hazard is a field nobody thought to check. `select: false`
does not apply to an aggregation, so the projection is the only thing standing between a hash and a
spreadsheet on somebody's desk.

Plus: the route-ordering regression (`/admin/students/export` must not be answered `400` by
`/admin/students/:studentId`), an inclusive date range whose upper bound is the *end* of the named day,
a literal `.*` search matching nothing, a rejected sort key, correct totals when a page is filtered, and
authorization for a plain student and a guest — on **both** URL prefixes.

## `tests/questionImport.test.ts` — 62 tests (Milestone 21, Phase B)

The bulk-import pipeline. Three organising ideas, and most of the file serves them:

1. **Nothing is saved by uploading.** Several tests assert the question collection is still *empty*
   after a successful preview — the property the whole feature rests on, and the one that would silently
   regress into "imported as drafts".
2. **A parser is never trusted, including on the way back.** A test takes a candidate that parsed
   cleanly, breaks it the way a reviewer really would (unticking the only correct option), and asserts it
   is refused with a reason rather than saved.
3. **A failure in one file must not lose the others.** Three files, the middle one throwing, and the
   assertion is two questions plus one named file error.

### The fake parser is the point

No real spreadsheet is read here — the format parsers arrive in Phases C–E. A **fake parser** registered
through the same `registerImportParser()` seam a real one uses is what makes the pipeline testable now,
and more usefully it is what makes the *failure* paths testable at all: a parser that throws, one that
returns a row naming a class that does not exist, one that returns two identical questions. None of those
can be produced on demand from a real file. `resetImportParsers()` in `afterEach` keeps them isolated.

The same argument as `setGeminiClientFactory()`: the interesting paths are the failing ones.

### Classes 3 and 4 are deliberately not exercised yet

They are not valid classes until Phase J extends `CLASS_LEVELS`, so a test asserting today that `"3"` is
refused would have to be inverted then. What is asserted is the classes that really exist (`5`–`12`,
including the bare-number, ordinal and `Grade` spellings a spreadsheet actually contains) plus the values
that stay invalid either way: **`2`, `13`, `0`, `-5`, `99`, `Class 13`, `nursery`, and empty**. Phase J
adds the 3 and 4 cases and flips nothing else.

Also asserted: that normalisation is **not** fuzzy beyond case and spacing (`Clss 8` and `eight` are
both `null`), because a class silently coerced to something plausible is a question served to the wrong
children.

### What else is covered

- **Upload validation**: bytes that are not really a workbook however labelled; an unsupported
  extension; a `.docx` posted to the Excel route; a bogus MIME type; three shapes of path separator in a
  filename; an oversized file; 21 files; two files of the same name; an empty list.
- **Taxonomy resolution**: defaults applied when a row is silent; a row overriding class, chapter and
  difficulty; an unresolvable class reported *with its row number* rather than defaulted; an unknown
  chapter reported **and asserted not to have been created**; a subtopic under the wrong chapter; a
  subtopic passed in the chapter field; an archived chapter.
- **Screening**: the shared schema rejecting two correct options on a single-choice question; unbalanced
  LaTeX; duplicates within a file, across two files, and against the existing bank; a parser note
  arriving as an advisory warning rather than a rejection.
- **Limits**: the configured ceiling honoured and reported as `truncated`; the remaining allowance passed
  to each successive file; the code ceiling capping a configured value of 100,000.
- **Approval**: drafts not published; provenance stamped from our row while the request *claims*
  `source: human`; re-validation refusing a broken correction; a mixed batch saving the good one and
  reporting the bad one; a forged `batchId`; the approval counter; `publish: true` blocked by the
  missing-solution rule and honoured when the question is publishable; the audit entry.
- **Authorization**: a student refused **403** on all five routes across **both** URL prefixes, an
  anonymous caller refused 401, and — so the negative assertions are about the gate rather than a
  missing route — the admin reaching the status route successfully.

One assertion worth keeping in mind when adding to this file: the duplicate detector compares
**vocabulary**, not digits. An early version of the truncation test generated `Question number 0 asks
about $0 + 0$`, `… 1 … $1 + 1$` and so on, and got one question back instead of three —
`fingerprint()` drops single-character tokens, so every row reduced to the same five words and the
de-duplicator was right to refuse them. Give generated fixtures genuinely different words.

---

## `tests/excelImport.test.ts` — 57 tests (Milestone 21, Phase C)

Unlike the Phase B suite, this one builds **real `.xlsx` files** with `exceljs` and pushes them
through the real route. That is the point of it: the interesting bugs in a spreadsheet parser are
all about what a real workbook actually contains, and none of them can be reached with a
hand-written fixture object.

**`cellText` gets a test per value shape exceljs really returns** — a plain string, a number, a
boolean, rich text, a formula with a cached result, a hyperlink, an error cell, and empty. Missing
one of these does not fail loudly; the cell silently reads as empty and the row is reported as
"no question text" for a row that plainly has some. That is why the list is exhaustive rather
than representative.

**The strongest single assertion in the file** is that the template the product hands out imports
cleanly through the product's own parser, into a deployment with nothing set up but one chapter.
A template whose examples the parser refuses is worse than no template, and that test is what
caught both Phase C defects.

### What else is covered

- **All five question types** from one sheet, with the answer key asserted per type.
- **Tolerance of the file**: any column order; loosely-matched headings (`Q`, `Ans`,
  `Explanation`, `Chapter`, `Penalty`); extra columns ignored; a header row below a title row; two
  sheets both read and named in `sourceRef`; a prose sheet skipped without losing the workbook;
  trailing blank rows ignored rather than reported as fifty failures.
- **Strictness about data**: a missing correct answer, an answer letter matching no option, an
  unsupported type named with the valid ones, a word in `Marks`, a gap in the option columns, a
  question-less row that has other values ("did a column shift?"), a `true_false` answer that is
  neither.
- **Notes**: an inferred type, a missing solution, options on a numeric row — each offered as a
  candidate with a warning rather than refused.
- **The screener still judging the question**: two correct options, unbalanced LaTeX, negative
  marks above the marks, and duplicate rows — all reported by the shared gate, in the words an
  author would read.
- **Per-row taxonomy from a real file**: a `Class` of `10` and `9th` honoured, a `Class` of `13`
  reported with its row number while the rest import, an unknown chapter reported **and asserted
  not created**, a chapter matched case-insensitively and shown back in the taxonomy's own
  spelling.
- **Corrupt files**: a zip that is not a workbook, and a workbook that cannot be opened — each a
  named failure on that file, never a 500 and never a lost batch.
- **Approval end to end**, including that an imported-and-published question then appears in a
  student's practice availability. That last one is the proof the whole feature is for: an
  imported question is an ordinary question, not a second-class row.

### A fixture trap worth knowing

A ZIP names each entry **twice** — once in the local header, once in the central directory. A test
that mangles a marker with `String.replace(...)` and a string pattern rewrites only the first
occurrence, so the marker survives and the assertion passes for the wrong reason. Use
`split(...).join(...)`. Relatedly, truncating a real workbook at its midpoint usually removes the
`xl/workbook.xml` entry entirely, so it exercises the "not a workbook" branch rather than the
"cannot be opened" one; to get the latter, build `PK\x03\x04` + `xl/workbook.xml` + junk.

---

## `tests/docxImport.test.ts` — 38 tests (Milestone 21, Phase D)

A `.docx` has no schema, so this parser is a heuristic over document conventions — which makes
these tests a different kind of thing from the Excel ones. **Each is a statement about one
convention an examiner might really use**, and the fixtures are built inline by
`tests/helpers/docx.ts` so the document a test describes is readable next to its assertion.

That helper builds a real `.docx` with `jszip` — already present as `mammoth`'s own dependency, so
nothing new was installed. It deliberately emits the *minimum* OOXML `mammoth` will read: a parser
that needed more would be relying on parts a "Save As → .docx" from another program might not
produce.

### The two cases that matter most

Both are failures that **look like success**, which is why each has its own fixture capability:

- **`{ numbered: true }`** renders a paragraph as a Word auto-numbered list item, so the number
  lives in the list definitions and *not* in the text. That is what the toolbar produces, and it
  is what would otherwise merge every question in a document into one.
- **`{ equation: true }`** inserts an `m:oMath` element, which `mammoth` silently drops. The test
  asserts the question still imports **and** that the loss is reported, because otherwise a
  question arrives looking complete with its formula missing from the middle of a sentence.

### What else is covered

- **`splitIntoBlocks` directly**: six numbering styles; a title dropped; the answer-terminated
  fallback; a solution kept with its own question; prose reported as nothing found; and that
  "Was 2020 a leap year?" is not read as question 2020.
- **All five question types** from one document, with the answer key asserted per type.
- **Option and label variety**: `a)`, `(1)`, `A.`; `Ans -`, `Correct option:`; `Explanation:`,
  `Working:`.
- **Wrapped paragraphs** rejoined into one stem and one option.
- **Metadata** applied per question and kept out of the question text — and a `Ravi says:` line
  left *in* it, because swallowing an unknown label would truncate the stem.
- **Failures**: no questions found (with the conventions in the message), a question with no
  answer named by its number, an answer matching no option, an `.xlsx` posted to this route, and a
  broken document beside a good one.
- **Notes**: an inferred type, a missing solution, and an unusually long stem — the symptom of a
  boundary the parser got wrong.
- **The shared gates**: two correct options, an invalid class reported with its question number, an
  unknown chapter asserted **not created**, and duplicate detection.
- **Provenance**: `docx_import`, `generatorKind: deterministic`, `modelName: null` — no model read
  a Word file, so nothing may claim one did.

### A note for whoever adds Phase E

Three assertions in the earlier suites broke when this phase landed, all of them stale rather than
wrong: two Excel tests asserted the *wording* of the type-inference note (which moved to
`lib/importAnswerText.ts` and is now phrased for every format, since a Word file has no "Type
column"), and one Phase B test asserted the parser registry had exactly **one** entry. That last
one is now written as "find the Excel entry" instead, precisely so Phase E does not have to edit a
count that never said anything useful.

---

## `tests/imageImport.test.ts` — 39 tests (Milestone 21, Phase E)

**Nothing here touches the network.** `setGeminiClientFactory()` is the same test-only hook the
generator's suite uses, and it throws outside the test environment — so the whole image path is
exercised, failing branches included, with no key and no request leaving the machine.

That matters more here than for the generator. The cases worth testing are a blurred page, a page
with no printed answer key, a transcribed answer letter matching no option, prose where JSON was
asked for, a blocked prompt, and a truncated reply — and **none of them can be produced on demand
against a real provider**, or at all in a suite that must run offline.

### The assertions that carry the most weight

- **A question with no printed answer is refused, not answered.** The single most consequential
  behaviour in the feature: a calculated answer is indistinguishable from a printed one, and real
  children would be marked against it. Asserted both ways — that the prompt forbids it, and that
  an empty `answer` becomes a named failure while the page's other questions still import.
- **The schema asks for a transcription, never an answer key.** Asserted negatively:
  `isCorrect`, `booleanAnswer`, `numericAnswer` and `marks` must all be **absent** from the
  schema sent to the provider. What is not in the schema cannot come back to be misinterpreted.
- **The answer key is derived by the shared readers.** `(b)`, `A and C`, `TRUE`, `60`,
  `3.14 | 3.14 approx` all read exactly as they do from a spreadsheet — evidence that this phase
  added no new answer reading, which is what `lib/importAnswerText.ts` was extracted to make true.
- **No student data is sent.** A real student is registered first, so the assertion is about what
  is *sent* rather than about an empty database.
- **No other format depends on a model credential.** With `GEMINI_API_KEY` unset, the image parser
  reports itself unavailable while Excel and DOCX stay available.
- **One call per image**, asserted directly, because that is the cost an owner needs to know.
- **Provenance cannot be forged**: a request sending `source: "human"` alongside its questions is
  ignored, and the row is stamped `image_import` with `generatorKind: 'model'`.

### A trap worth knowing, hit while writing this suite

The spy originally exposed only `JSON.stringify(contents)`, and an assertion about the most
important instruction in the prompt failed **while the instruction was present and correct** —
because `JSON.stringify` renders a real newline as the two characters `\` and `n`, so a pattern
spanning a wrapped line can never match. The spy now exposes `prompt` separately, pulled out of
the parts array. If you assert on prompt text, assert on the prompt, not on its serialisation.

### One earlier assertion changed meaning, correctly

`questionImport.test.ts`'s "accepts an image only on the image route" asserted a 503 saying *not
available* (no parser registered). A parser is now registered and reports itself *not configured*,
which is the more useful message. Both are the same answer to "the examiner is not at fault"; the
test asserts the current one.

---

## Phase F: the dry run, and what only a browser could catch

Seven tests were added to `tests/questionImport.test.ts` for `POST .../import/validate`. The one
worth copying if you add another gate sends **one batch to both the dry run and approval** and
asserts the refusal reasons match string-for-string, rather than asserting each against a
hand-written expectation — which is how two gates drift apart while both look tested.

The others pin: a clean batch saying `wouldSave: 1`; that it writes **neither a question nor an
`ImportBatch` row** (an examiner may press it on every keystroke); that a question added to the
bank *since* the preview is still caught, because the bank is re-read rather than trusted; that
a stray `batchId` cannot reach the handler; and a 403 for a student on both URL prefixes.

### A fixture trap in `similarity()` worth knowing

A duplicate-detection test failed with the obvious fixture `"What is $2 + 2$?"`. That is not a
bug: the shared fingerprint drops stop words and single characters, so that text reduces to the
**empty set**, and an empty fingerprint scores 0 against everything. **Very short questions are
not duplicate-checked at all** — acceptable, because the failure the check exists for is a model
or a spreadsheet re-emitting the same *worded* question — but it makes a two-digit arithmetic
question useless as a fixture. Use text with real topical words.

### The frontend still has no test suite, and this is what that costs

The review page was verified by driving it in a browser against the local dev database. **That
pass found a bug 1,086 backend tests could not**: the page rendered *"Saved undefined
questions"*, because it assumed the approve endpoint returns a `created` count. It does not.

Fixing it surfaced a second gap the first bug had been hiding — `published` and
`publishFailures` were ignored, so "Approve & publish" would have reported success for questions
that stayed as drafts because they had no solution.

Neither is reachable from the backend suite: both are assumptions the *client* makes about a
response shape. Until a frontend suite exists, **a browser pass is not optional for a new admin
page** — it is the only thing that checks the contract from the consuming side. Adding a
frontend test framework still needs a `DECISIONS.md` entry first.

---

## Phase G: bulk publishing and the practice preview (11 tests)

In `tests/questionBank.test.ts`. Two are worth knowing about specifically.

**"refuses a question with no solution while publishing the rest"** is the test that guards the
design. `changeQuestionStatusBulk()` loops over `changeQuestionStatus()` rather than issuing an
`updateMany`, and this asserts why: it publishes two questions where one has no solution, and
checks the refusal reason, the *label* naming which question, that the other one stayed
published, and that the response is **200 with per-question results** rather than a 400. If
somebody ever "optimises" that loop into a bulk write, this fails.

**"is not swallowed by the /:id route"** exists because it happened. `GET
`/admin/questions/practice-availability` was first added at the bottom of the routes file, where
`/admin/questions/:id` — declared 180 lines earlier — matched `practice-availability` as an id
and answered 400. Express matches in declaration order. The test asserts the status is 200 and
explicitly `not.toBe(400)`, which is the shape `TESTING.md` already asks for: name the status you
forbid.

The rest cover: a clean bulk publish; an unknown id reported without failing the batch; a
duplicated id and an empty selection both refused as 400; a 403 for a student on **both** URL
prefixes; that the preview counts only *published* questions; that it is scoped to the class
asked for; that it **never returns question text or an answer key** (asserted by field name); and
that an invalid class is a 400.

---

## `tests/chapterDetection.test.ts` — 24 tests

The detector is a **pure function**, so most of this file needs no database — which is the point of
keeping it pure. The tests that matter are the ones about **refusing to guess**.

- **"finds nothing rather than guessing"** — a question with no topical overlap must not be filed.
- **"refuses to choose between two chapters that fit equally well"** — returns `ambiguous` and
  names them. Picking one would be a coin toss presented as a decision, and both look reasonable
  to a reviewer skimming.
- **"spreads a whole-syllabus paper across chapters instead of taking the newest"** — seeds a
  second chapter *after* the first, so "the most recent N" would be all of it. This is the test
  that justifies the endpoint existing at all.
- **"never suggests an unpublished question"** — a mock test may only be published with published
  questions, so suggesting drafts would set the author up to fail at the last step.

The `stem` tests earn their place: one of them caught a real bug where `derivatives` stemmed to
`derivativ` while `derivative` stayed whole, so the two never compared equal and detection was
silently relying on the loose prefix fallback.

### A fixture trap

The test helper's `Taxonomy.subtopicId` is a plain `string`, and an **empty string is not a valid
ObjectId** — passing one as `subtopic` is a 400, not "no subtopic". To publish a question under a
second chapter, pass `{ subtopic: null }` explicitly: the fixture's subtopic belongs to the *first*
chapter, and the write path rightly refuses a subtopic that is not under the chosen one.

---

## Phase J: the class tests are driven from the constant

The registration class tests used to list the ten classes literally. When Phase J changed the
range, that test asserted the **old** list while the API accepted the new one — it had to be
rewritten rather than merely re-run, which is the tell that it was testing a copy rather than the
thing.

They now iterate `CLASS_LEVELS`, so "every class the platform offers can register" stays true
whatever that list becomes. One test asserts the range itself, once, in one place.

Added alongside: Class 3 and 4 accepted (both previously refused), Class 12 accepted with no
stream (previously refused), the three retired stream values **refused**, and the invalid set from
the owner's brief — `Class 2`, `Class 13`, `Class 0`, `Class -1`, plus the bare `2`/`13`/`0`/`-1`,
empty, and `Class` alone. Each asserts `not.toBe(500)` as well as the 400.

**If you change the class range again**, the only test that should need editing is the one that
asserts the range. If others break, they are asserting a copy.

---

## Phase L: what a green backend suite did not catch

Phase L ran the full gate and it was green — and then found **seven defects** by driving the
product in a browser. Every one lived in the frontend, which has no test suite, or in a service
path no test exercised with more than one subject in the database.

That is the lesson worth keeping: **most fixtures create exactly one subject**, so a bug whose
precondition is "two subjects exist" is invisible to almost the whole suite. The four new tests
all deliberately create a second one:

- `practice.test.ts` — options do not offer another subject’s chapters
- `practice.test.ts` — mixed practice draws from the implicit subject only (seven published
  questions for the class, of which only two may be dealt)
- `dailyChallenge.test.ts` — the automatic pick never lands on another subject (eleven Physics
  against one maths, so an unscoped pick fails by weight rather than by luck of the seed)
- `dashboard.test.ts` — the availability tile does not advertise another subject’s questions

### `createTaxonomy()` now reuses an existing subject

It used to `.expect(201)` on subject creation, so calling it twice with the same subject name
died on the unique index with a bare 409. A test that wants **two chapters of one subject** has
to call it twice, and since Phase J that is the ordinary case — reaching for a second subject
name to get a distinct chapter now means asserting on something a student can never reach.

One recommendations fixture was doing exactly that (`Physics/Optics` as "a topic never served")
and had to move onto a second mathematics chapter. If a fixture of yours starts failing after a
scoping change, check whether it is using a second *subject* where it only needed a second
*chapter*.
