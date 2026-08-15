# API_DOCUMENTATION.md

_Last updated: 2026-08-15 (Milestone 17 — AI question drafting: `POST /admin/generate-questions` rewritten behind a generator seam, plus `GET /admin/question-generator`). Before that, Milestone 16 — intelligent performance recommendations: one new route, `GET /analytics/:studentId/recommendations`. Before that, Milestone 15 — performance analytics: `/analytics/:studentId` rewritten to serve derived data, plus two admin performance routes._

**Base path: `/api/v1`** (canonical). The unversioned `/api` prefix is retained as a backward-compatibility alias mounting the exact same router — see [`DECISIONS.md`](DECISIONS.md). Add new routes to `backend/src/routes/v1/` only; they become available under both prefixes automatically.

Response envelope: `{ success: true, ... }` or `{ success: false, error: string }`, produced by `sendSuccess`/`sendError` in `backend/src/lib/apiResponse.ts`. Validation failures additionally include a `details` array.

**Authorization model (Milestone 3)**: routes declare a *permission*, not a role. The role → permission table lives only in `backend/src/lib/permissions.ts`; see [`SECURITY.md`](SECURITY.md) for the table itself. Three roles exist — `student`, `admin`, `superadmin` — and every authenticated response carries the caller's effective `permissions` array so the frontend never keeps its own copy of the rules.

Middleware order on data routes: `rateLimit → validate → requireAuth → ensureDb → handler`. Validation therefore runs before any database work, and before the auth gate on public routes. Consequences worth knowing when reading the error lists below:
- Malformed input returns **400** without touching the database.
- An unreachable database returns **503** (`"Database unavailable. Please try again shortly."`), not a 500 or a hang.
- All `/api*` routes are rate limited (general limiter). Sensitive auth routes have their own tighter limiters, listed per endpoint below. Exceeding any of them returns **429**.
- Routes gated by `requirePermission` run `authenticate → ensureDb → freshRoleCheck → permissionCheck` **before** `validate`, so an unauthorized caller is refused before any input is parsed. On those routes a privileged caller sees **503** if MongoDB is down, because the role can no longer be verified — see [`DECISIONS.md`](DECISIONS.md).
- Refusal statuses: **401** not authenticated (missing, forged, expired or revoked token), **403** authenticated but lacking the permission, **409** a request that conflicts with a safety rule (acting on your own account, promoting an unverified one).

---

## Operational endpoints (unversioned, no `/api` prefix)

### `GET /health`
- **Auth**: none. **Rate limited**: no — mounted before the limiter so probes are never throttled.
- **DB**: not touched; this is a liveness check for the process only.
- **Response 200**: `{ success: true, status: 'ok', uptimeSeconds: number }`
- Verified live: returns 200 even with MongoDB unreachable.

### `GET /ready`
- **Auth**: none. **Rate limited**: no.
- **DB**: *attempts* a connection if the current container has none, then reports the result. Necessary on serverless, where a cold container would otherwise report "disconnected" despite a healthy database (see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)).
- **Response 200**: `{ success: true, status: 'ready', db: 'connected', dbName: 'amit-olympiad' }` — `dbName` is the database actually in use, which catches a `MONGO_URI` missing its database path (see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)).
- **Response 503**: `{ success: false, error: 'Not ready', db: 'disconnected' }`
- Use this for uptime monitoring and deployment gating; use `/health` to check only that the process is alive.

---

## Authentication (Milestone 2)

All auth routes live in `backend/src/routes/v1/auth.routes.ts`. Two cookies are involved:

| Cookie | Contents | Lifetime | Notes |
|---|---|---|---|
| `access_token` | JWT (`role`, `sub`, `studentId`, `email`, `tv`) | 15 min (`ACCESS_TOKEN_TTL`) for **every** account | Session cookie — no `maxAge`; the `exp` claim is the authority. The `role` claim is a hint only: privileged requests re-read the role from the database, now with **no exemption**. |
| `refresh_token` | 32 random bytes, opaque | 30 days (`REFRESH_TOKEN_TTL_DAYS`) | Stored SHA-256-hashed; rotated on every use. Issued to **every** account, the super admin included. |

**Changed in Milestone 11.** The `root: true` claim and `ADMIN_TOKEN_TTL` are gone: the super administrator now has a database account, so it gets the ordinary TTL and a rotating refresh token like everybody else. A token issued before that change carries no `sub`, resolves to no account, and is refused — sign in again.

Both are `httpOnly`, `secure` in production, and `sameSite: 'none'` in production (the apps are on different domains). `tv` is the student's `tokenVersion`; a mismatch means the session was revoked.

### `POST /api/v1/auth/register`
- **Auth**: none. **Rate limit**: 10/hour per IP.
- **Request** (Milestone 4 — every field below is required except `middleName`):
  ```
  { firstName, middleName?, lastName, fatherName, motherName,
    dateOfBirth, classLevel, schoolName, address,
    mobile, email, password, photo }
  ```
- **Validation**:
  - Names (`firstName`, `middleName`, `lastName`, `fatherName`, `motherName`) 2–60 chars, letters in **any script** plus spaces, apostrophes, hyphens and full stops — no digits. `middleName` may be omitted or empty, and stores as `null`.
  - `dateOfBirth` — `YYYY-MM-DD`, a real date, not in the future, implying an age of 5–40.
  - `classLevel` — one of the ten values in `backend/src/lib/classLevels.ts`: `Class 5`…`Class 11`, `Class 12 - Science`, `Class 12 - Commerce`, `Class 12 - Humanities`.
  - `schoolName` 2–150 chars; `address` 10–500 chars.
  - `mobile` 10–15 digits (spaces/dashes stripped); `email` a valid address, lowercased; `password` ≥8 chars containing at least one letter and one number.
  - `photo` — a base64 data URL (`data:image/jpeg;base64,…`). JPEG, PNG or WebP; **2 MB maximum decoded**. The declared MIME type is checked against the file's actual magic bytes, so a non-image cannot be stored and later served back as one.
- **Body limit**: this is the only route that accepts a large body (2.8 MB, to allow for base64 inflation). Every other endpoint keeps body-parser's 100 KB default.
- **Response 201**: `{ success, message, requiresEmailVerification, student }` — and **no session cookies**. The student must verify first. `student` now includes the registration details (`dateOfBirth` as `YYYY-MM-DD`), but never the photo bytes.
- **Errors**: `400` validation, `409` duplicate email *or* duplicate mobile (distinct messages), `413` body too large, `429`, `503`, `500`.
- **Side effects**: writes a `StudentPhoto` document, and emails a single-use verification link valid for 24 hours. `fullName` is **derived** from the three name parts by the schema — do not send it. If the photo write fails, the just-created account is deleted again, so an account never exists without its mandatory photo.

### `POST /api/v1/auth/verify-email`
- **Auth**: none (the token *is* the credential). **Rate limit**: 20/15 min.
- **Request**: `{ token }` — the value from the emailed link.
- **Response 200**: `{ success, message, student }` with `isEmailVerified: true`.
- **Errors**: `400` invalid / already used / expired (each with its own message), `429`, `503`.
- Tokens are single-use and consumed atomically, so a link cannot be redeemed twice even under a race.

### `POST /api/v1/auth/resend-verification`
- **Auth**: none. **Rate limit**: 5/hour.
- **Request**: `{ email }`
- **Response 200**: always the same generic message, whether or not the address exists or is already verified — this endpoint must not reveal which addresses are registered.

### `POST /api/v1/auth/login`
- **Auth**: none. **Rate limit**: 10/15 min per IP, plus per-account lockout.
- **Request**: `{ identifier, password }` — `identifier` is the **mobile number or the email address**.
- **Response 200**: `{ success, role, permissions, student }` + sets both cookies. `role` is the account's current role and `permissions` its effective list — the frontend drives its guards and navigation from these rather than assuming a mapping.
- **Side effect**: a sign-in by an account holding an elevated role writes an `admin.session.started` audit entry.
- **Errors**:
  - `400` validation.
  - `401` invalid credentials — identical message for "no such account" and "wrong password", to prevent enumeration.
  - `403` account `suspended` / `deactivated`.
  - `403` with `code: 'EMAIL_NOT_VERIFIED'` when the address is unverified and `REQUIRE_EMAIL_VERIFICATION` is on. The frontend keys off `code` to offer a resend link.
  - `423` account temporarily locked (after `MAX_FAILED_LOGINS`, for `ACCOUNT_LOCK_MINUTES`). The message includes the remaining minutes.
  - `429`, `503`, `500`.

> **Account identifiers.** `:studentId` path params accept `AMIT_0000`–`AMIT_9999` (entrants) and `ADMIN_0000`–`ADMIN_9999` (the bootstrap staff account). `ADMIN_` is accepted deliberately even though that account can never be acted on: rejecting it at the schema would answer "must look like AMIT_0000", a format complaint about a well-formed id, instead of the true "this account is not managed through the API".

### `POST /api/v1/auth/admin/login`
- **Auth**: none. **Rate limit**: 10/15 min. Requires `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`. **Now requires a database connection** (`ensureDb`).
- This is the **root administrator**: it holds `superadmin`, the only role that can grant or revoke admin rights, and is the bootstrap identity since nothing else can create the first admin.
- **Rewritten in Milestone 11.** On the first successful sign-in it **provisions a `Student` document** with `role: 'superadmin'`, seeded from the two environment variables. From then on those variables are ignored and authentication runs against the document — through `authenticateAccount()`, the same single password check the ordinary login uses, so lockout, status and verification all apply.
- **Response 200**: `{ success, role: 'superadmin', permissions, student, mustChangePassword }` + the ordinary 15-minute `access_token` **and a rotating refresh token**.
- **Side effect**: writes an `admin.session.started` audit entry, with `via: 'root-bootstrap'` on the provisioning sign-in and `via: 'root-credentials'` thereafter.
- **Errors**: `400`, `401` these are not the bootstrap credentials, `403` barred status, `423` locked out, `500` admin not configured, `500` the configured address belongs to another account (see below), `503` no database.
- **It will not adopt an account that does not already hold `superadmin`.** If `ADMIN_EMAIL` names an ordinary account, the route refuses with `500` and logs loudly rather than granting the role — otherwise anyone who learned the address could register it first and then authenticate with their own password. Registration refuses that address for the same reason.
- Administrators *promoted* from a student account do **not** need this route — they sign in through `POST /auth/login`. The `/admin` portal tries this endpoint first and falls back to `/auth/login` on a `401`, so one form serves both.
- **This is the only door the super administrator may use.** `POST /auth/login` refuses it with `403` — see that route for why the refusal happens *after* the password check.

### `POST /api/v1/auth/refresh`
- **Auth**: the `refresh_token` cookie. **Rate limit**: 60/15 min.
- **Response 200**: `{ success, role, permissions, student }` + a **new** access token and a **rotated** refresh token. Both the token and the returned permissions are rebuilt from the account as it is now, so a role change reaches the client here.
- **Errors**: `401` when the token is missing, unknown, expired, or belongs to a non-active account — cookies are cleared in every case.
- **Theft detection**: presenting an already-rotated token revokes the entire token family and returns `401` (`"…ended for security reasons…"`). Clients must therefore not refresh concurrently; the frontend de-duplicates through one shared promise.

### `POST /api/v1/auth/logout`
- **Auth**: none required (safe to call when already signed out).
- Revokes **only** the presented refresh token, so other devices stay signed in, and clears both cookies. Never fails: cookies are cleared even if the database write errors.

### `POST /api/v1/auth/logout-all`
- **Auth**: `requireAuth()` — any signed-in account, including a promoted admin. (It was `requireAuth('student')` before Milestone 3, which would have locked promoted admins out of their own session management.)
- Revokes every refresh token for the student **and** increments `tokenVersion`, which invalidates all outstanding access tokens at their next `/auth/me` or refresh.

### `GET /api/v1/auth/me`
- **Auth**: reads the `access_token` cookie directly (not via `requireAuth`) because it must also answer for guests.
- **Response 200 (account-backed)**: `{ success, role, permissions, student }` — `role` and `permissions` are read from the account, so a promotion or demotion is reflected on the next page load without a re-login.
- **Response 200 (root admin)**: `{ success, role: 'superadmin', permissions, admin: { email, role } }` — answered from the token alone, so it works even when MongoDB is down.
- **Errors**: `401` no/invalid/expired token, unknown student, or a stale `tv` (revoked session); `403` account no longer active; `503` database unreachable.

### `POST /api/v1/auth/forgot-password`
- **Auth**: none. **Rate limit**: 5/hour.
- **Request**: `{ email }`
- **Response 200**: always the same generic message regardless of whether the account exists. Verified by a test that asserts the responses are byte-identical.
- **Side effect**: for an active account, emails a single-use reset link valid 30 minutes. Issuing a new link invalidates any previous outstanding one.

### `POST /api/v1/auth/reset-password`
- **Auth**: none (the token is the credential). **Rate limit**: 20/15 min.
- **Request**: `{ token, password }` — same password policy as registration.
- **Response 200**: `{ success, message }`
- **Errors**: `400` invalid / already used / expired token, `429`, `503`.
- **Side effects**: sets the new hash, increments `tokenVersion`, revokes **every** refresh token, clears the lockout counters, marks the email verified (completing a reset proves mailbox control), and clears cookies.

---

## Other implemented routes called by the frontend

### `GET /api/v1/analytics/:studentId` — real, derived on read (rewritten in Milestone 15)

Returns `{ analytics, xpByDay }`. **The shape changed in Milestone 15** — the old `{ data, reason }` pair is gone with the `StudentAnalytics` model that backed it.

- **Auth**: `requirePermission('analytics:read:self')`. Fetching **someone else's** record additionally requires `analytics:read:any`, checked *freshly* against the database via `callerCanFresh()` — so a demoted admin stops being able to read other students' data immediately, not at token expiry. A student reading another ID gets **403**. A non-existent student ID returns **404**.
- **Errors**: `401`, `403`, `404`, `429`, `503`, `500`.
- **Called by**: `Analytics.tsx`, `Report.tsx`.

`analytics` is derived on every read from **submitted** attempts in `PracticeSession`, `MockTestAttempt`, `DailyChallengeAttempt` and `ExamAttempt`. There is no analytics collection. Its fields:

| Field | Meaning |
|---|---|
| `hasData` | False when nothing has been submitted anywhere. The UI shows one honest message rather than a page of dashes. |
| `overall` | Counts plus `accuracyPercent`, `scorePercent`, `attempts`, `averageSecondsPerQuestion`, and `servedIncludingDeletedQuestions`. |
| `bySurface` | The four surfaces, each always present. |
| `byTopic` / `bySubject` | Named rows, ordered by how much the student has answered. A topic row carries its `subjectName`, so two same-named topics stay distinguishable. |
| `byDifficulty` / `byType` | **Fixed axes** — every difficulty and every question type is always present, with `null` percentages where untouched, so a chart cannot lose its axis when empty. |
| `strongAreas` / `weakAreas` | Up to five each, across topics, subjects and difficulties. Requires `minimumAreaSample` (5) answers. |
| `accuracyByDay` | Bucketed by **IST** competition day. |
| `progressTrend` | One point per submitted sitting, chronological by submission. |
| `paceTrend` | Seconds per question **per attempt**. Excludes the daily challenge, which has no clock. |
| `notes` | Machine-readable reasons a section is empty, e.g. `nothing-submitted-yet`, `pace-unavailable-daily-challenge-has-no-clock`. |

Three contracts a client must respect:

- **`null` is not `0`.** Every percentage is `number | null`; null means "nothing answered here", which is a different fact from "answered, all wrong". Rendering the first as `0%` throws away the distinction the API preserves.
- **Percentages are already weighted.** Do not average them — the server sums raw counts and derives once, so combining 1/1 and 1/9 gives 20%, not 55%.
- **The client computes nothing.** Same rule as the leaderboard: a second implementation is a second thing to disagree with the first.

`xpByDay` is unchanged and stays alongside: actual XP earned per competition day over the last 30 days, oldest first, days with no activity **omitted** rather than zero-filled. It measures participation where the rest measures ability.

**This endpoint used to lie.** When no document existed it returned a hardcoded object claiming 88% accuracy over 450 questions, a rising five-point learning curve, four topic breakdowns and "You are currently in the top 5% of all national Olympiad participants" — as the student's own measured performance. That fallback was deleted in the Milestone 5 follow-up, and a test still asserts none of those strings can appear in a response.

### `GET /api/v1/analytics/:studentId/recommendations` (Milestone 16)

Returns `{ recommendations }` — what the student should work on next, derived on read from the same submitted attempts as the endpoint above plus the **published question bank for their own class**. There is no recommendation collection.

- **Auth**: identical to `GET /analytics/:studentId`, through the same function — `requirePermission('analytics:read:self')`, plus a fresh `analytics:read:any` check to read somebody else's. It exposes the same student's record and quotes their accuracy in its own text, so one gate being looser than the other would be a disclosure bug. A student reading another ID gets **403**; an unknown ID **404**.
- **Errors**: `401`, `403`, `404`, `429`, `503`, `500`.
- **Called by**: `Analytics.tsx`, alongside (not inside) the analytics request.

| Field | Meaning |
|---|---|
| `engine` | `{ id, label, kind, basis }` — **written by the server, never by the engine**. `kind` is `'statistical'` or `'model'`, and `'model'` may only be set when a real model produced the output. `basis` is a sentence the UI prints verbatim. |
| `hasData` | False when nothing has been submitted. Stamped from the analytics facts, so an engine cannot claim data a student does not have. |
| `minimumSample` | Answers an area needs before it may be called a strength or weakness — the same `MIN_AREA_SAMPLE` (5) the analytics endpoint reports. |
| `weakTopics` / `strongTopics` | Topics asserted **on a 95% Wilson interval**, from the conservative end: a weakness on the upper bound, a strength on the lower. So 2 of 5 (40%) is not a weakness while 30 of 80 (37.5%) is. |
| `difficulty` | At most one entry per level, and never contradictory: if a level is flagged for consolidation, no step-up above it is offered. |
| `practice` | Actionable, and **only ever addressed at questions the class bank really has**. Each carries an `action.href` into `/practice?subject=&topic=`. |
| `insights` | Observations about the record as a whole — trend, blank rate, pace, surface mix. |
| `notes` | Machine-readable reasons a section is empty, e.g. `no-published-questions-for-your-class`, `no-topic-is-confidently-below-par`. |

Every recommendation carries a required **`basis`**: `answered`, `correct`, `accuracyPercent`, the interval bounds, and a `figures` map of any other counts its sentence quotes. This is not decoration — a recommendation that cannot state its evidence cannot be constructed, which is the structural form of the rule that deleted `generateAIInsights()` in Milestone 15.

Two contracts a client must respect, both the same as the analytics endpoint: **the client computes nothing** (ordering and wording arrive decided), and **`null` is not `0`**.

**The engine is swappable** (`RECOMMENDATION_ENGINE`, see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)). The default is statistical and requires no credentials, no network and no paid service. An engine that throws is caught and the statistical engine answers instead, so a failing model costs this panel rather than the page. **No AI provider is integrated anywhere in the codebase** — see the Milestone 16 ADRs.

### `GET /api/v1/admin/analytics/questions` (Milestone 15)
- **Permission**: `analytics:read:any`.
- **Query**: `page`, `limit`, `classLevel`, `difficulty`, `subject` (id), `sort` (`hardest` | `easiest` | `most-served` | `most-skipped`, default `hardest`), `minAnswered` (1–100, default 3).
- **Response 200**: `{ success, questions, questionsWithData, minAnswered, notes, pagination }`.
- Each row carries `served`, `answered`, `correct`, `accuracyPercent`, **`skipRatePercent`** and the joined topic/subject/difficulty. Counted from every submitted attempt across all four surfaces and **merged by summing raw counts**, so a question used in both practice and a mock test reports one combined figure.
- **`minAnswered` is a floor, not a filter on data quality.** A question answered once, wrongly, is a real 0% and a useless diagnosis; without the floor it would head the hardest list for ever. The value in force is returned so the UI can state it, and `questionsWithData` reports how many questions have any data at all, so an empty table can distinguish "nothing answered yet" from "nothing meets the floor".
- **No caller may supply or filter on a measured value.** Accuracy, counts and skip rate are absent from the query schema — the same discipline the leaderboard uses for ranked values.

### `GET /api/v1/admin/analytics/tests` (Milestone 15)
- **Permission**: `analytics:read:any`. No query parameters.
- **Response 200**: `{ success, tests, notes }` — every mock test and official exam with at least one attempt, official exams first.
- Each row: `attemptsStarted`, `attemptsSubmitted`, `completionPercent`, `distinctStudents`, `averageScorePercent`, **`medianScorePercent`**, `highestScorePercent`, `lowestScorePercent`, `averageAccuracyPercent`, `averageSecondsPerQuestion`.
- **The median is reported beside the mean** because on a cohort of a few dozen one student who submitted a blank moves the mean several points — exactly the case an invigilator wants to see rather than have smoothed away.
- **`kind`** (`mock_test` | `official_exam`) is on every row, so a rehearsal can never be read as the Olympiad.

### `GET /api/v1/admin/question-generator` (Milestone 17)
- **Permission**: `questions:write`.
- **Response 200**: `{ success, generator, available, alternatives }`, where `generator` is `{ id, label, kind, basis }` and `kind` is `'template'` or `'model'`.
- Exists so the admin page can state whether AI drafting is configured **before** the button is pressed. "Is this on?" should not be a question you answer by trying it, especially when the answer depends on an environment variable set on another website.

### `POST /api/v1/admin/generate-questions`
- **Auth**: `requirePermission('questions:write')` (admin and super admin).
- **Request**: `{ subject, topic, classLevel, difficulty?, count, instructions? }`. `subject` and `topic` are **ObjectIds of real taxonomy rows** (Milestone 4) — the bank does not accept a free-text subject, so the generator cannot invent classification nothing else knows about. `count` is 1–20. `instructions` (Milestone 17, ≤500 chars) is an optional steer for a model-backed generator and is ignored by the template one.
- **Behaviour (rewritten in Milestone 17)**: resolves a generator from the registry in `services/questionGeneratorService.ts` and asks it for candidates. With `GEMINI_API_KEY` set that is **Google Gemini**; with no key it is the blank-template generator, which is the supported default and needs no credential, network or paid service.

  Whatever produced them, **candidates are not trusted**:
  - The **taxonomy is attached from this request**, never from the generator — a `GeneratedCandidate` has no subject/topic/class/difficulty field to carry.
  - Every candidate is parsed by **`createQuestionSchema`**, the same schema a hand-authored question passes, including `validateMathContent()`. There is deliberately no model-specific validator.
  - A failure is **rejected and reported with its reason**, never repaired.
  - Everything stored is a **draft**, because `createQuestion()` has no other mode.
  - A generator returning more than `count` is truncated to `count`.

  If the generator is unavailable or throws (quota, timeout, unusable output), the **template generator runs instead** and the response says so with the provider's own error text.
- **Response 201**: `{ success, message, generator: { id, label, kind, basis }, requested, rejected: [{ index, reason }], notes, questions: [{ id, questionText, type, status }] }`. `generator` is written by the service from the registry entry it actually invoked — a generator cannot describe itself.
- **Side effect**: writes a `questions.generated` audit entry recording `generator` and `generatorKind` alongside `count`, `created` and `rejected`, so "was this question written by a machine?" stays answerable. `count` keeps its original name because the audit trail is append-only and has no TTL.
- **Errors**: `400` (unknown subject/topic, or a topic from another subject), `401`/`403`, `429`, `503`, `500`.
- **Called by**: `AiGenerator.tsx`.

---

## Question bank (Milestone 4)

Taxonomy routes live in `backend/src/routes/v1/taxonomy.routes.ts`; question routes are split between `questions.routes.ts` (student-facing reads) and `questionsAdmin.routes.ts` (authoring). Business rules are in `backend/src/services/`.

### Taxonomy — reading

Reading the taxonomy needs only `questions:read`, which **every student holds**: subject and topic lists are what a practice or exam filter is built from, and they carry no answer data.

#### `GET /api/v1/subjects`
- **Permission**: `questions:read`.
- **Query**: `status` (`active`/`archived`), optional. Omit for both.
- **Response 200**: `{ success, subjects: Subject[] }`, ordered by `displayOrder` then `name`.

#### `GET /api/v1/topics`
- **Permission**: `questions:read`.
- **Query**: `subject` (id), `parent`, `status` — all optional. **`parent=root`** returns top-level topics only; `parent=<topicId>` returns that topic's subtopics; omitting `parent` returns every level. A literal `root` sentinel is used rather than an empty string, because an empty query value is indistinguishable from an absent parameter.
- **Response 200**: `{ success, topics: Topic[] }` — each with `parent` and `depth` (0 = topic, 1 = subtopic).

### Taxonomy — writing

Both require **`taxonomy:write`** (admin and super admin; no student holds it). Both write a `subject.changed` / `topic.changed` audit entry.

#### `POST /api/v1/admin/subjects`
- **Request**: `{ name, description?, displayOrder? }`. `slug` is derived — do not send it.
- **Response 201**: `{ success, subject }`.
- **Errors**: `400` (name contains `$`, `<` or `>`), `409` duplicate name (case-insensitive), `401`/`403`.

#### `PATCH /api/v1/admin/subjects/:id`
- **Request**: any of `{ name, description, displayOrder, status }`. A genuine patch — an **empty body is rejected with 400** rather than reported as a no-op success. Renaming re-derives the slug.
- **Errors**: `400`, `404`, `409` duplicate name, **`409` when archiving a subject that still has published questions** (the message says how many).

#### `POST /api/v1/admin/topics`
- **Request**: `{ subject, parent?, name, description?, displayOrder? }`. Supplying `parent` makes the row a **subtopic**; omitting it makes a top-level topic. `depth` is derived, never sent.
- **Errors**: `400` (unknown subject/parent, a parent from a **different subject**, or nesting deeper than subtopic), `409` duplicate name **within the same parent** (the same name under a different parent is allowed), `401`/`403`.

#### `PATCH /api/v1/admin/topics/:id`
- **Request**: any of `{ name, description, displayOrder, status }`; empty body → 400.
- **Errors**: as above, plus `409` when archiving with published questions attached (checked against both `topic` and `subtopic` references).

### Questions — student-facing reads

#### `GET /api/v1/questions`
- **Permission**: `questions:read`. **This endpoint had no authentication at all before Milestone 4** and returned raw documents including `correctAnswer` — the entire answer key was readable by anyone on the internet. See [`SECURITY.md`](SECURITY.md).
- **Query**: `page`, `limit` (≤50), `sort`, `order`, `search`, `subject`, `topic`, `subtopic`, `classLevel`, `difficulty`, `type`, `tag`. There is deliberately **no `status` parameter**: the route pins the visible statuses to `published`, and accepting the parameter would imply it could be changed.
- **Response 200**: `{ success, questions, pagination }`. Each question is an explicit allow-list that **omits every answer field** — options carry only `key` and `text` (never `isCorrect`), and `solution`, `booleanAnswer`, `numericAnswer` and `tolerance` are absent. A test asserts none of those names appears in the body.
- **Errors**: `400` bad query, `401`, `429`, `503`.

#### `GET /api/v1/questions/:id`
- **Permission**: `questions:read`. Same stripped view.
- **Errors**: `400` malformed id, `401`, **`404` for a question that exists but is not published** — 403 would confirm that a draft with that id is being prepared, which is not a student's business.

### Questions — authoring

All require **`questions:write`** except the delete, which requires **`questions:delete`**.

#### `GET /api/v1/admin/questions`
- **Query**: `page` (≥1), `limit` (1–100), `sort`, `order` (`asc`/`desc`), `search`, `status`, `subject`, `topic`, `subtopic`, `classLevel`, `difficulty`, `type`, `tag`.
- `sort` is constrained to an **allow-list** (`createdAt`, `updatedAt`, `marks`, `difficulty`, `classLevel`); anything else is 400. Passing the parameter through would let a caller sort by an unindexed field, which is a cheap way to make the database do expensive work.
- `search` matches `questionText`, `tags` and `solution`, case-insensitively and **literally** — the term is regex-escaped, so `.*` matches nothing rather than everything (asserted by a test). It searches the LaTeX source, so an author can find `x^2-9`.
- Filters combine as **AND**. `_id` is appended to every sort as a tiebreaker, so pagination is stable and no question can appear on two pages.
- **Response 200**: `{ success, questions, pagination }` — the **author's** view, including `isCorrect`, `solution` and the answer fields. This is a separate function from the student view rather than one function with an `includeAnswers` flag, so the two cannot be confused at a call site.

#### `GET /api/v1/admin/questions/:id`
- **Response 200**: `{ success, question }` (author's view). `400` malformed id, `404` unknown.

#### `POST /api/v1/admin/questions`
- **Request**: `{ questionText, type, options[], booleanAnswer, numericAnswer, tolerance, solution, subject, topic, subtopic, classLevel, difficulty, marks, negativeMarks, tags[] }`.
- **Always created as a `draft`** — "saved" and "visible to students" can never be the same keystroke. Option `key`s are assigned by the server.
- **Validation**: per-type answer rules (a choice type needs ≥2 options and exactly one / at least two correct; `true_false` needs `booleanAnswer`; `numeric` needs `numericAnswer`), **plus rejection of the fields a type does not use**. Duplicate option text, all-options-correct, `negativeMarks > marks`, and every LaTeX rule in `lib/mathContent.ts` are refused.
- **Response 201**: `{ success, question }`. Writes a `question.created` audit entry.
- **Errors**: `400` validation or an inconsistent taxonomy triplet (topic from another subject, subtopic from another topic, a subtopic passed as `topic`), `401`/`403`, `429`, `503`.

#### `PUT /api/v1/admin/questions/:id`
- Takes the **whole content**, not a patch: whether `options` is required depends on `type`, so a partial update could leave the document in a state no create request could produce.
- Increments `revision`. **409 if the question is archived** — restore it to a draft first.
- Writes a `question.updated` audit entry.

#### `PATCH /api/v1/admin/questions/:id/status`
- **Request**: `{ status, reason? }`.
- Permitted transitions: `draft → in_review|published|archived`, `in_review → draft|published|archived`, `published → archived|draft`, `archived → draft`. Anything else is **409**, as is moving to the status it already has.
- **Publishing additionally requires a `solution`** and a resolvable answer key — a published question is one a student is graded on, so the things that would make grading wrong or unexplainable are blocked here rather than discovered later.
- Writes a `question.status.changed` audit entry.

#### `DELETE /api/v1/admin/questions/:id`
- **Permission**: `questions:delete` — separate from `questions:write` because it is the one question-bank action that destroys data rather than changing it.
- Permitted **only** for a question that has never been published. A currently-published question is refused, and so is one whose `publishedAt` is set even if it has since returned to draft — so unpublishing first is not a way around it. Once a question could have been answered, deleting it would orphan the attempt that references it.
- Reads the question **before** deleting so the audit entry can still name what was destroyed. Writes `question.deleted`.
- **Errors**: `400`, `403`, `404`, `409` (archive it instead).

---

## User management and audit trail (Milestone 3)

All in `backend/src/routes/v1/users.routes.ts`. Every route here is gated by `requirePermission`, which re-reads the caller's role from the database before deciding — see [`DECISIONS.md`](DECISIONS.md).

### `GET /api/v1/admin/students`
- **Permission**: `students:read` (admin, super admin).
- **Query**: `page` (≥1, default 1), `limit` (1–100, default 20), `search` (1–120 chars), `status` (`active`/`suspended`/`deactivated`), `role` (`student`/`admin`), `verified` (`true`/`false`). All parsed by zod before any filter is built.
- **Response 200**: `{ success, students: ManagedAccount[], pagination: { page, limit, total, totalPages } }`
- `search` matches `fullName`, `email`, `mobile` or `studentId`, **case-insensitively and literally** — the term is regex-escaped, so `.*` matches nothing rather than everything (asserted by a test).
- `ManagedAccount` is an explicit allow-list: `id`, `studentId`, `fullName`, `email`, `mobile`, `role`, `status`, `isEmailVerified`, `registeredAt`, `lastLoginAt`, `lockedUntil`, `roleUpdatedAt`, `roleUpdatedBy`, plus the Milestone 4 registration details (`firstName`, `middleName`, `lastName`, `fatherName`, `motherName`, `dateOfBirth`, `classLevel`, `schoolName`, `address`) — each `null` on an account created before Milestone 4. The photo is **not** included; fetch it from `GET /students/:studentId/photo`. A test asserts no password hash can appear in the response.
- **Errors**: `400` bad query, `401`, `403`, `429`, `503`, `500`.
- **Called by**: `Admin.tsx` (dashboard counts and recent list), `Users.tsx`.

### `GET /api/v1/admin/students/:studentId`
- **Permission**: `students:read`.
- **Params**: `studentId` must match `AMIT_` followed by exactly four digits — pinning the shape stops a path parameter from becoming a filter.
- **Response 200**: `{ success, student: ManagedAccount }`
- **Errors**: `400` malformed ID, `401`, `403`, `404` no such account, `429`, `503`, `500`.

### `PATCH /api/v1/admin/students/:studentId/status`
- **Permission**: `students:status:write` (admin, super admin).
- **Request**: `{ status: 'active' | 'suspended' | 'blocked' | 'deactivated', reason?: string }` — `reason` is 3–500 chars and is stored in the audit entry. **`blocked` was added in Milestone 11**: `suspended` is a temporary hold, `blocked` is a permanent bar (a ban), `deactivated` is a closed account rather than one in trouble. All three bar sign-in; they are distinct so the audit trail can say *which* a year later.
- **Response 200**: `{ success, changed: boolean, student: ManagedAccount }`. `changed: false` when the status already matched, in which case nothing is written and no audit entry is made.
- **Side effects** when the status changes: suspending or deactivating revokes every refresh token and bumps `tokenVersion`, so live sessions end at once; reactivating also clears `failedLoginAttempts` and `lockedUntil`, otherwise the account would return still locked out. Always writes a `student.status.changed` audit entry.
- **Errors**: `400` unknown status or malformed ID, `401`, `403` (also when an ordinary admin targets an account that holds a role — only a super admin may act on an administrator), `404`, `409` acting on your own account, `429`, `503`, `500`.
- **This is what finally gives `status` a UI** — before Milestone 3 only a direct database edit could set it.

### `PATCH /api/v1/admin/users/:studentId/role`
- **Permission**: `users:role:write` — **super admin only**. An ordinary admin gets `403`, so a compromised admin session cannot mint more admins.
- **Request**: `{ role: 'student' | 'admin', reason?: string }`. `superadmin` is **not** in the enum: there is deliberately no API path to a second root administrator (asserted by a test).
- **Response 200**: `{ success, changed: boolean, student: ManagedAccount }`
- **Side effects** when the role changes: sets `roleUpdatedAt`/`roleUpdatedBy`, revokes every refresh token and bumps `tokenVersion` — so the target **must sign in again**, and cannot keep an old token carrying the old role. Writes a `user.role.changed` audit entry with `{ from, to, reason }`.
- **Errors**: `400` invalid role or malformed ID, `401`, `403` insufficient permission, `403` targeting the super administrator, `404`, `409` changing your own role, `409` promoting an account that is unverified or not active, `429`, `503`, `500`.

### `POST /api/v1/admin/users/:studentId/reset-password` — **Milestone 11**
- **Permission**: `users:password:reset` (admin **and** super admin). Password recovery is routine competition-desk work, so it is not withheld from admins — but see the data-level guard below.
- **Request**: `{ reason?: string }`
- **Response 200**: `{ success, temporaryPassword: string, student: ManagedAccount, message: string }`
- **The temporary password is returned once and never again.** It is not stored in readable form and is deliberately **absent from the audit entry** — the trail records that a reset happened and who did it, which is the part that matters afterwards. A test asserts the password does not appear in the entry.
- **Side effects**: replaces the password hash, sets `mustChangePassword: true`, clears `failedLoginAttempts`/`lockedUntil` (being locked out of a password you were just handed is the most confusing possible outcome of asking for help), revokes every refresh token and bumps `tokenVersion`. Writes a `user.password.reset` audit entry.
- **The holder is then held on a forced change screen** until they choose their own password. `mustChangePassword` clears in exactly one place — `POST /me/change-password` — so it cannot be dismissed any other way. Note this is a *UI* gate: the API is still reachable with the temporary password, as with any working credential.
- **Errors**: `400` malformed ID, `401`, `403` an ordinary admin targeting an account that holds a role, `403` targeting the super administrator, `404`, `409` targeting your own account (use account settings), `429`, `503`, `500`.

### `POST /api/v1/admin/users/:studentId/revoke-sessions` — **Milestone 11**
- **Permission**: `users:sessions:revoke` (admin and super admin).
- **Request**: `{ reason?: string }` → **Response 200**: `{ success, student: ManagedAccount }`
- Ends every live session and nothing else — the account stays active, verified and on the same password. The mild remedy ("left signed in on a school computer"), kept separate from suspension precisely so it does **not** mark the account as being in any trouble. Writes a `user.sessions.revoked` audit entry.
- **Errors**: `400`, `401`, `403` (admin targeting a role-holder, or anyone targeting the super admin), `404`, `429`, `503`, `500`.

### `DELETE /api/v1/admin/users/:studentId` — **Milestone 11**
- **Permission**: `users:delete` — **super admin only**. Withheld from admins deliberately: every other administrative act in this product is reversible and this one is not.
- **Request**: `{ confirmStudentId: string, reason?: string }` — the caller must retype the account's own `AMIT_xxxx`. This is not authorization (the permission gate already happened); it is a guard against acting on the wrong row, which is why the confirmation has to be something only someone looking at the right account can supply.
- **Response 200**: `{ success, deleted: true, student: { studentId, email, fullName, registeredAt } }`
- **Only an unverified account can be deleted.** Login is gated on verification, so an unverified account cannot have sat a paper, earned XP or appeared on a board — what this destroys is an abandoned registration, not a competitor's history. A verified account returns `409` pointing at deactivation instead, which is reversible and keeps the results of everyone that account competed against intact.
- **Side effects**: removes the `Student` and its `StudentPhoto`, revokes its refresh tokens, and writes a `user.deleted` audit entry with the identifiers **denormalised into the entry** — afterwards there is no document left to join against.
- **Errors**: `400` confirmation does not match, `401`, `403` not a super admin / targeting the super admin, `404`, `409` account is verified, `409` deleting your own account, `429`, `503`, `500`.

### `GET /api/v1/students/:studentId/photo`
- **Auth**: any signed-in account. **Added in Milestone 4.**
- **Authorization**: a student may read **their own** photo. Reading anyone else's requires `students:read`, checked **freshly against the database** (`callerCanFresh`) rather than from the access token — this is someone else's personal data, so a demoted admin must not keep reading it for the rest of the token's life. This is an identity-plus-capability gate, which is why it uses `requireAuth()` rather than a single `requirePermission`.
- **Params**: `studentId` must match `AMIT_` followed by exactly four digits.
- **Response 200**: **raw image bytes** — not the `{ success, ... }` envelope. `Content-Type` is the stored type (`image/jpeg` / `image/png` / `image/webp`), plus `Content-Length` and `Cache-Control: private, max-age=300` (`private` because the bytes sit behind an authorization check and must never reach a shared cache).
- **Errors**: `400` malformed ID, `401` not signed in, `403` another student's photo, `404` no such account **or** no photo on file (every account registered before Milestone 4), `429`, `503`, `500`.
- **Called by**: `Users.tsx` (the admin table thumbnail), via a plain `<img src>` rather than `api.get` — the response is an image, not JSON. The request is same-origin in both environments because `frontend/vercel.json` rewrites `/api/*` to the backend, so the session cookie is sent normally.

### `GET /api/v1/admin/audit-logs`
- **Permission**: `audit:read` (admin, super admin).
- **Query**: `page`, `limit` (1–100, default 20), `action` (one of the five audit actions), `outcome` (`success`/`denied`). An unrecognised `action` returns `400` rather than being silently ignored.
- **Response 200**: `{ success, entries: AuditEntry[], pagination }`, newest first.
- **Errors**: `400`, `401`, `403`, `429`, `503`, `500`.
- **Called by**: `AuditLog.tsx`.

---

## Event gallery — Milestone 12

The only content in this product **published to the open internet**, which is why it has its own permission and why every mutation is audited. Image bytes are never in a listing (`GalleryItem.data` is `select: false`); one route serves them.

### `GET /api/v1/gallery`
- **Auth**: none — public, like the leaderboard and Hall of Fame. Carries no personal data.
- **Query**: `page`, `limit` (1–100, default 20).
- **Response 200**: `{ success, gallery: GalleryItem[], pagination }` — **published items only**, in the `displayOrder` staff chose (newest first within an order), each with an `imageUrl`.
- **Errors**: `400`, `429`, `503`, `500`.

### `GET /api/v1/gallery/:id/image`
- **Auth**: none, but only for a **published** item — an archived photo has been taken down, and continuing to serve its bytes to anyone holding the URL would make archiving a UI change rather than a removal (asserted by a test).
- **Response 200**: raw image bytes, `Cache-Control: public, max-age=3600`. Public with no authorization behind it, so a shared cache is safe — unlike a student photo, which is `private`.
- **Errors**: `400` malformed id, `404` unknown **or archived**, `503`, `500`.

### `GET /api/v1/admin/gallery`
- **Permission**: `gallery:write` (admin, super admin).
- **Query**: `page`, `limit`, `status` (`published`/`archived`), `search` (literal, regex-escaped, over title and caption).
- **Response 200**: `{ success, gallery: GalleryItem[], pagination }` — all statuses.

### `POST /api/v1/admin/gallery`
- **Permission**: `gallery:write`. **Request**: `{ title, caption?, eventDate?, displayOrder?, status?, image }`.
- `image` is a base64 data URL — JPEG/PNG/WebP, **≤ 1 MB**, validated by **magic bytes** via the shared `imageDataUrl()` validator, so a file that merely claims to be a PNG is refused (asserted by a test). The 1 MB cap is a quarter of a registration photo's: photos are bounded by the number of entrants, gallery images by nothing, and both share a 512 MB free tier.
- **Response 201**: `{ success, item: GalleryItem }`. Writes a `gallery.changed` audit entry.
- **Errors**: `400` (validation, bad image, oversize), `401`, `403`, `429`, `503`, `500`.

### `PATCH /api/v1/admin/gallery/:id`
- **Permission**: `gallery:write`. **Request**: any of `title`, `caption`, `eventDate`, `displayOrder`, `status`.
- **Deliberately does not accept a new image**: replacing the bytes under an existing id would leave a cached public URL pointing at a different photograph. Upload a new item and archive the old one.
- **Errors**: `400`, `401`, `403`, `404`, `429`, `503`, `500`.

### `DELETE /api/v1/admin/gallery/:id`
- **Permission**: `gallery:write` — **not** reserved for a super admin, unlike account deletion: this is staff-authored content with no student history hanging off it, the same reasoning that lets an admin hard-delete a never-published question. Archiving remains the reversible option and is what the UI leads with.
- **Response 200**: `{ success, deleted: true, item: { id, title, size } }`. Audited.

---

## In-app notifications — Milestone 12

Staff write **one** document carrying an audience *rule*; each student's inbox is that rule evaluated at read time. Nothing is fanned out per recipient. See the Milestone 12 ADR.

**Milestone 14** added a third audience (`student`, system-only), automated notifications for six real events, and **email** as an escalation of some of them. Email itself is never sent inside a request — see "Email delivery" below.

### `GET /api/v1/me/notifications`
- **Auth**: `requireAuth()` — an identity gate, like the rest of `/me`: an inbox is yours because it is yours, not because of a capability.
- **Query**: `page`, `limit`, `unreadOnly` (`true`/`false`).
- **Response 200**: `{ success, notifications: InboxNotification[], unread, pagination }` — published notifications addressed to `all`, to the caller's own class, **or to the caller personally**, newest first, each with real `read`/`readAt` plus `source` (`staff`/`system`) and `link` (a relative in-app path, or null).
- A student with no `classLevel` (a legacy account, or the bootstrap super admin) sees `all` announcements only.

### `GET /api/v1/me/notifications/unread-count`
- **Auth**: `requireAuth()`. **Response 200**: `{ success, unread }`. Shares `inboxFilter()` with the list above, so the number on the bell cannot disagree with what the inbox shows.

### `POST /api/v1/me/notifications/:id/read` · `POST /api/v1/me/notifications/read-all`
- **Auth**: `requireAuth()`. **Response 200**: `{ success, read: true, unread }` / `{ success, marked, unread }`.
- **Idempotent**: an upsert against the unique index on `{student, notification}`, so a double-tapped button, a replayed request or two open tabs cannot create two rows or return an error the user did nothing to cause.
- **`404` for a notification the caller cannot see** — including one addressed to another class or to another student. Not `403`: the route must not confirm that an id it will not show nevertheless exists (asserted by a test).
- Visibility is decided by `isVisibleTo()`, which composes `inboxFilter()`. **Milestone 14 fixed a latent bug here**: the route used to hand-write the audience comparison, which was correct for the two audiences that existed and would have silently refused every per-student notification.

### `GET /api/v1/me/notification-preferences` (Milestone 14)
- **Auth**: `requireAuth()`.
- **Response 200**: `{ success, preferences: { announcements, results }, always: [{ category, reason }], inAppAlwaysOn: true }`.
- `always` names the streams that **cannot** be switched off (`transactional`, `security`) **with their reasons**, so the UI can state them rather than silently offering only two toggles. A missing stored object reads as all-on, matching what a pre-Milestone-14 account was already receiving.

### `PATCH /api/v1/me/notification-preferences` (Milestone 14)
- **Auth**: `requireAuth()`. **Request**: `{ announcements?, results? }` — at least one (`400` otherwise).
- There is deliberately **no field** for `transactional` or `security`: they are absent from the schema rather than ignored by the handler, so "I turned it off and it kept sending" is not a state the API can be asked to produce.
- **These control email only.** In-app rows are always written, so declining an email never costs the student the message.
- **Response 200**: `{ success, preferences }`. Writes `student.profile.updated` naming the changed field names.

### `GET /api/v1/admin/notifications`
- **Permission**: `notifications:write` (admin, super admin).
- **Query**: `page`, `limit`, `audience`, `classLevel`, `published` (`true`/`false`), **`source`** (`staff`/`system`/`all`), `search` (literal, over title and body).
- **`source` omitted means `staff`, not everything.** Releasing one national exam's results writes a system row per candidate, so listing both by default would bury the handful of announcements this page exists to manage. `source=all` gives the combined view.
- **Response 200**: `{ success, notifications: AdminNotification[], pagination }`. Each carries **`readCount`** — how many students actually opened it, from one grouped aggregation for the whole page. The only honest reach figure — plus `source`, `event` and `link`.

### `POST /api/v1/admin/notifications`
- **Permission**: `notifications:write`. **Request**: `{ title, body, kind?, audience?, classLevel?, isPublished?, emailBroadcast? }`.
- `audience` accepts `all` or `class` only. **`student` is not addressable here** — it exists for system notices about one person, and is absent from the schema rather than rejected in the handler.
- `audience: 'class'` **requires** `classLevel` (`400` otherwise) — a class-targeted announcement with no class would reach nobody and look sent.
- Unpublished is a **draft**: invisible to students, editable by staff. `publishedAt` is stamped at publication, not creation, so a draft written last week and published today sorts as today's news.
- **`emailBroadcast: true`** additionally queues one email per eligible recipient. Only meaningful together with publication — a draft emails nobody. Default **false**, deliberately: see the Milestone 14 ADR.
- **Response 201**: `{ success, notification, broadcast: { recipients, queued, suppressed, cappedAt } | null }`. `suppressed` counts recipients who switched announcement email off, reported rather than hidden — staff who see "0 queued" with no explanation will conclude it is broken and send it again. `cappedAt` is set when the recipient list hit the 500 cap. Writes `notification.changed` with `emailBroadcast` and `emailsQueued`.

### `PATCH /api/v1/admin/notifications/:id`
- **Permission**: `notifications:write`. Any field, plus `isPublished` to publish or withdraw, plus `emailBroadcast`.
- **`409` for a `source: 'system'` notification.** Editing the text of a record of something that happened would turn it into a claim about something that did not — and it would then disagree with the email already delivered from it.
- Switching `audience` back to `all` clears `classLevel`, so the two cannot disagree. Withdrawing and republishing keeps the original `publishedAt` — it is the same announcement. The audit `operation` distinguishes `published` / `withdrawn` / `updated`.
- Asking for `emailBroadcast` again is **safe**: each message is keyed on `{announcement, student}`, so publishing, withdrawing and re-publishing cannot email the same person twice.

### `DELETE /api/v1/admin/notifications/:id`
- **Permission**: `notifications:write`. Deletes the notification **and every read receipt for it** — a receipt pointing at nothing would skew the anti-join the unread count relies on, making the count wrong for everybody who had read it.
- Allowed for a `system` row, unlike editing: housekeeping is not falsification.

---

## Email delivery (Milestone 14)

**No user-facing request ever waits on SMTP.** Every message is written to `EmailOutbox` before anything tries to send it; delivery happens off the request path with backoff and a terminal give-up. See `services/emailOutbox.ts` and the Milestone 14 ADR.

Because the free tier has no scheduler, delivery is driven by an opportunistic kick at enqueue time plus a lazy sweep on later requests — neither of which is a deadline. That is why the drain is also an explicit staff action rather than a hidden one.

### `GET /api/v1/admin/email-deliveries`
- **Permission**: `notifications:write`.
- **Query**: `page`, `limit`, `status` (`pending`/`sent`/`failed`), `category` (`transactional`/`security`/`announcement`/`results`).
- **Response 200**: `{ success, deliveries: EmailDelivery[], stats: { pending, sent, failed, oldestPendingAt }, pagination }`.
- Each row carries `to`, `subject`, `category`, `status`, `attempts`/`maxAttempts`, `nextAttemptAt`, `lastAttemptAt`, `lastError` and `sentAt`. **The body is never returned** — a delivery record has no business reproducing the contents of somebody's password-reset email.
- `oldestPendingAt` is the only figure that answers "is the queue stuck?"; a pending count alone cannot, because three queued messages is healthy if they arrived a second ago and a problem if the oldest has waited since Tuesday.

### `POST /api/v1/admin/email-deliveries/drain`
- **Permission**: `notifications:write`. **Response 200**: `{ success, drain: { claimed, sent, failed, retrying }, stats }`.
- Sends up to 10 due messages. Safe to press twice — the claim is a conditional write, so two concurrent drains cannot pick up the same row. Reports an empty drain honestly (`claimed: 0`) rather than claiming success.

### `POST /api/v1/admin/email-deliveries/retry`
- **Permission**: `notifications:write`. **Response 200**: `{ success, requeued, drain, stats }`.
- Puts every `failed` row back with a fresh attempt budget, then drains. The counterpart to a terminal give-up: that state has to exist or a dead address would be retried for ever, but somebody who has just corrected their SMTP settings needs a way to say "try again" that is not editing the database by hand. Writes `notification.changed` with `operation: 'retry-failed'`.

---

---

## Official exam — Milestone 13

The national sitting. **Not** a mock test: its window is announced in advance, a student gets **one** attempt, and submitting reveals no score — results are released by the organisers.

### `GET /api/v1/exams`
- **Permission**: `exam:take` (every student). Reuses the capability mock tests established: sitting a paper is the same kind of act whichever paper it is.
- **Response 200**: `{ success, exams: StudentExam[] }` — published exams for the caller's **own class only**, with the window state and their own attempt if any. Never the questions. A student with no `classLevel` gets `{ exams: [], reason: 'no-class' }`.
- Expired attempts are swept on the way through, so the listing cannot offer to resume a paper whose clock has run out.

### `POST /api/v1/exams/:id/attempt`
- **Permission**: `exam:take`. **Response 201** on a new attempt, **200** when resuming (`created: false`).
- **One attempt, ever.** Resuming returns the *same* attempt with the *same* deadline — which is what stops "start again" being a way to buy time. A **submitted** attempt is a `409`, not a new attempt.
- The paper is served with the answer key **snapshotted** onto the attempt and stripped from the response (`studentQuestionView`). `expiresAt` is computed here and never recomputed.
- **Errors**: `403` wrong class or no class on the account, `409` outside the announced window / already sat / under a minute left / paper has no questions, `404`, `401`, `503`.

### `GET /api/v1/exams/attempts/:attemptId`
- **Permission**: `exam:take`, and **ownership is in the query** — somebody else's attempt is a `404`, not a `403`, because the route never loads it.
- **Response 200**: the paper with `secondsRemaining` from the server's clock. Returning to a paper whose time ran out **closes it** rather than showing a countdown at zero.

### `PATCH /api/v1/exams/attempts/:attemptId/questions/:questionId`
- **Permission**: `exam:take`. **Request**: one of `selectedOptionKeys`, `numericResponse`, `booleanResponse`.
- **The body may not carry a time of any kind** — no elapsed duration, no client timestamp, no remaining seconds. Accepting one would hand the clock to the browser.
- **An answer arriving after `expiresAt` is refused with `409` and is not stored.** Not stored late, not stored quietly, not stored and ignored at grading (asserted by a test that moves the deadline into the past and then reads the document back).
- **Errors**: `400` unknown option key or a numeric answer on a choice question, `404` question not on this paper, `409` submitted or past the deadline.

### `POST /api/v1/exams/attempts/:attemptId/submit`
- **Permission**: `exam:take`. **Response 200**: `{ success, submitted: true, attempt: {...}, resultsPending: true, message }`.
- **Returns no score, no accuracy and no answer key.** This is the whole difference from a mock test. Idempotent and race-safe: the write is conditional on `status: 'in_progress'`, so of two concurrent submissions exactly one grades.
- `submittedAt` is clamped to the deadline, so a late submission is marked as at the deadline rather than recording a time longer than the exam allowed.

### `GET /api/v1/me/exam-results`
- **Permission**: `exam:take`. **Response 200**: the caller's **published** results only — `isPublished` is in the query, so an unreleased result is invisible however long ago the paper was sat.

### `GET`/`POST`/`PATCH /api/v1/admin/exams`…
- **Permission**: `exam:write` (admin, super admin) — separate from `mocktests:write` because releasing an official result fixes a national rank and mints certificates, where a mock test is a rehearsal.
- `POST` creates a **draft**. `opensAt`/`closesAt` are both **mandatory**, `closesAt` must be after `opensAt`, and `distinctionThresholdPercent` must be at least `meritThresholdPercent` — otherwise every distinction would also qualify as merit.
- Questions must exist and be **published**: an official paper made partly of drafts would refuse to start once somebody sat down, which is a far worse place to find out.
- `PATCH` **freezes the paper once anybody has sat it**: questions, duration and class become `409`. The window and thresholds stay editable, because releasing late or re-deciding a grade boundary do not rewrite what anyone sat.
- `PATCH /:id/status` publishes / unpublishes / archives. Publishing an exam with no questions is a `409`.

### `GET /api/v1/admin/exams/:id/attempts`
- **Permission**: `exam:write`. Sweeps expired attempts first, then returns every attempt with real marks and the student's identity.

### `POST /api/v1/admin/exams/:id/publish-results`
- **Permission**: `exam:write`. The single most consequential act in the product: it fixes every rank **and mints every certificate for the sitting, in one operation** — a result without a certificate, or a certificate without a published result, is a state nothing knows how to describe.
- **Refused with `409` while the window is still open.** Ranks are a cohort fact; publishing early would rank a student against whoever happened to finish first.
- Sweeps expired attempts first, so an abandoned paper is graded and counted rather than silently dropped — which would flatter every other rank.
- **Equal scores share a rank** (1, 2, 2, 4), the same rule the leaderboard uses.
- **Idempotent**: re-running recomputes ranks and updates the same `Result` rows, and the unique index on `{student, exam}` means no student gets a second certificate. The response reports `certificates.issued` and `certificates.skipped`.
- **Response 200**: `{ success, exam, publication: { candidates, resultsWritten }, certificates: { issued, skipped } }`. Writes an `exam.results.published` audit entry carrying those counts.

---

## Certificates — Milestone 13

**There is no issuance endpoint.** Certificates are minted only by publishing an exam's results. No student and no administrator can nominate a recipient, which is what makes "the frontend cannot manufacture eligibility" structural rather than validated — the frontend is never asked.

### `GET /api/v1/verify/:code`
- **Auth**: none. **Public and unauthenticated** — a school, parent or employer must be able to check a document without an account.
- Keyed on the **verification code**, never the readable serial: the serial is effectively guessable, so keying on it would let anybody walk the numbers and harvest every entrant's name, school and rank.
- The code is accepted with or without dashes and in any case, because it is read off paper and typed by hand — rejecting a correctly-remembered code over punctuation would make a genuine certificate look forged. A malformed code is a `400`.
- **Response 200**: `{ success, valid, status: 'valid' | 'revoked' | 'not-found', certificate?, revokedAt?, revokedReason? }`.
- A **revoked** certificate reports `revoked` **with** its details, not `not-found`: a printed copy exists in the world regardless, and its holder needs to be told it was withdrawn rather than that it never existed. A forged code returns no certificate object at all.
- Everything returned is the certificate's own **snapshot**, so this confirms the document in somebody's hand rather than what the live records say today.

### `GET /api/v1/me/certificates`
- **Auth**: `requireAuth()` — an identity gate, like the rest of `/me`.
- **Response 200**: the caller's certificates, **including the verification code** (the holder needs it to prove their own certificate, and it is printed on their PDF anyway).

### `GET /api/v1/me/certificates/:id/download`
- **Auth**: `requireAuth()`, with ownership in the query — somebody else's certificate is a `404`.
- **Response 200**: `application/pdf`, rendered server-side by `pdf-lib` from the certificate's snapshot alone. `Cache-Control: private, no-store`, because this is personal data behind an authorization check.
- A **revoked** certificate is a `409`: continuing to hand out fresh copies of a withdrawn document would undermine the revocation entirely.

### `GET /api/v1/admin/certificates`
- **Permission**: `certificates:write` (admin, super admin).
- **Query**: `page`, `limit`, `tier`, `examCode`, `revoked` (`true`/`false`), `search` (literal, over name, student ID and certificate number).

### `POST /api/v1/admin/certificates/:id/revoke`
- **Permission**: `certificates:write`. **Request**: `{ reason }` — **mandatory**, 3–500 chars.
- **Never deletes.** The row stays so verification can tell the truth. Re-revoking is a no-op (`changed: false`). Writes a `certificate.revoked` audit entry.

### `GET /api/v1/admin/certificates/:id/download`
- **Permission**: `certificates:write`. Staff copy of any certificate, for support and reissue.

---

## Administrative insight — Milestone 12

Three read-only surfaces. **Every figure is counted from a collection**; nothing is estimated or projected.

### `GET /api/v1/admin/analytics`
- **Permission**: `analytics:read:any` — this is precisely "read analytics that are not your own", so no new permission was invented.
- **Query**: `days` (7–90, default 30). Outside that range is `400`, not silently clamped.
- **Response 200**: `{ success, analytics: PlatformAnalytics }` — account counts by verification and status, engagement (ever / 7-day / 30-day active, plus daily registration and activity series bucketed by **IST** day so the axis lines up with streaks and XP), content counts, assessment counts, XP totals, and a per-class breakdown.
- **Entrants only**: the bootstrap super admin is excluded from every student count — it never registered for anything. Active-student counts join to `students`, so a deleted account's leftover activity rows cannot make the platform look busier than it is (this really happened: 12 active against 11 registered).
- **`null`, not `0`, for an average that does not exist yet.** `mockAveragePercent` is `null` until a paper has been sat, because 0% would read as "everybody scored nothing".
- **Nothing here reads `Result` or `ExamAttempt`** — see the Milestone 12 ADR. Assessment figures come from mock tests, practice sessions and daily challenges, which are real.
- Every offered class appears in `byClass`, including empty ones: an absent row reads as missing data, a zero is a fact about the cohort.

### `GET /api/v1/admin/leaderboard`
- **Permission**: `students:read`.
- **Query**: `page`, `limit`, `classLevel`, `period` (`all`/`month`/`week`/`today`). An unknown class or period is `400`.
- **Response 200**: `{ success, leaderboard: AdminLeaderboardRow[], period, classLevel, pagination }` — **full names, student IDs, emails and account status**, which the public board deliberately masks because the entrants are children and that page is indexable. That difference is the whole reason this endpoint exists rather than a flag on the public one.
- Reuses `periodWindow()` from `leaderboardService`, so staff and students get the same "this week". Ranks are positions in the **full ordering**, not in the page. The super admin never appears — it earns no XP.

### `GET /api/v1/admin/rewards/overview`
- **Permission**: `rewards:write` — this is the evidence needed *before* re-pricing the award table, so it belongs to the same job.
- **Response 200**: `{ success, overview: RewardsOverview }` — students per level (from the same thresholds a student's own page uses), XP earners, and holders per achievement.
- **`holders: null` where a count would be a lie.** Streak achievements ("visited on 3 consecutive days") cannot be answered by aggregation — "answered five challenges" and "answered on five consecutive days" are different facts — so those report `null` and the UI says "not counted" rather than showing a plausible wrong number. Asserted by a test.
- `neverEarned` is normally `0`, because registration itself grants XP. A non-zero value means accounts predating the activity log, which `scripts/backfill-activity.ts` repairs.

---

## IMPLEMENTED — but not called by the frontend

`GET /api/v1/questions` and `GET /api/v1/questions/:id` are documented under "Question bank (Milestone 4)" above. They are real, authenticated and answer-stripped, but **no student-facing page calls them yet** — `Exam.tsx` is still a hardcoded five-question quiz. Wiring the exam to them is the next milestone's work.

---

## Own profile, settings and dashboard (Milestone 5)

All in `routes/v1/me.routes.ts`. Gated with `requireAuth()` rather than `requirePermission(...)`, because the requirement is an identity ("this is my own account") and not a capability — the same reasoning `/auth/logout-all` and the own-photo route use. **No route here takes a student id**: each resolves the caller's own document from the token's `sub`, so there is no path on which one student could address another's record.

The environment-configured root administrator has no `Student` document, so every one of these answers **404** with an explanatory message rather than a 500.

### `GET /api/v1/me/profile`
The caller's full profile: the nine registration fields plus `mobile`, `email`, `isEmailVerified`, `status`, `role`, `registeredAt`, `lastLoginAt` and `hasPhoto`. Photo *existence* only — the bytes are served separately, so a profile load never drags a 2 MB image through the response. Never includes `passwordHash` (asserted by test).

### `PATCH /api/v1/me/profile`
Edits the caller's own details. Body: `firstName`, `middleName` (nullable), `lastName`, `fatherName`, `motherName`, `dateOfBirth` (`YYYY-MM-DD`), `classLevel`, `schoolName`, `address` — a full replacement of the editable set, so a missing field is a validation error rather than a silent no-change. `fullName` is re-derived by the schema, never submitted.

**`email` and `mobile` cannot be changed here**, and are absent from the schema rather than filtered in the handler — see the ADR in [`DECISIONS.md`](DECISIONS.md). Nor can `studentId`, `role`, `status`, `isEmailVerified` or `tokenVersion`; sending them changes nothing (asserted by test).

Returns `{ changed, profile }`. Records a `profile_updated` activity (0 XP) and a `student.profile.updated` audit entry naming the changed **field names, never their values**. Rate limited 20/hour.

### `PUT /api/v1/me/photo`
Replaces the caller's profile photo. Body `{ photo }` as a base64 data URL, same rules as registration — ≤2 MB, JPEG/PNG/WebP, checked against the file's **magic bytes** rather than its declared MIME type. Upserts, so it also works on a legacy account with no photo. There is deliberately **no delete**: the photo is a required part of an entrant's record, so "remove" would leave the account in a state registration cannot produce.

This is one of only two routes granted a body limit above body-parser's 100 KB default (see `app.ts`); both `/api/v1/me/photo` and the `/api/me/photo` alias are listed, since a limit holding on only one prefix would be trivially bypassed. Records `photo_updated` and `student.photo.updated`. Rate limited 20/hour.

### `POST /api/v1/me/change-password`
Body `{ currentPassword, newPassword }`. The current password is required even though the caller already holds a valid session — that is what stops a borrowed or stolen session locking the real owner out. The new password must differ from the current one and meets the same policy as registration.

On success **every** session is revoked (refresh tokens deleted, `tokenVersion` bumped) and then *this* device is issued a fresh session, so the caller stays signed in where they are while other devices are evicted. A wrong current password returns 401 and deliberately does **not** touch the lockout counter — letting a wrong guess lock the account would hand any borrowed session an easy denial of service against the owner. Records `password_changed` (0 XP) and `student.password.changed`. Rate limited 20/hour.

### `GET /api/v1/me/dashboard`
Everything the student dashboard shows, in one request. **Every figure is a real database read**; there is no sample data and no fallback.

`{ dashboard: { student, progress, activity, recentTests, achievements, leaderboard: { top, me }, challenges, today } }` where:
- `progress` — `xp`, `level`, `levelStartsAt`, `nextLevelAt`, `xpIntoLevel`, `xpForNextLevel`, `percentToNextLevel`, and `streak` (`current`, `longest`, `activeDays`, `lastActiveOn`, `countedToday`). All derived from `StudentActivity`; nothing is stored.
- `activity` — the 8 newest real events.
- `recentTests` — up to 5 submitted `ExamAttempt` records. **A live query against a collection nothing writes to yet**, so it is honestly `[]` today and the UI shows its empty state. Written as a query rather than a hardcoded `[]` so the panel starts working the moment exam submission exists.
- `achievements` — `{ earnedCount, total, earned, next }`, each evaluated from real facts with real progress toward the locked ones. No exam or accuracy achievement is listed, because none could be satisfied yet.
- `leaderboard.me` — `{ rank, xp, totalRanked }`; `rank` is `null` when the student has no XP, i.e. genuinely unranked rather than last.
- `challenges` — published-question availability for the caller's own class, grouped by subject.

**One deliberate side effect**: opening the dashboard records the day's `daily_visit`, which is what a streak is made of. Idempotent per competition day, enforced by a unique index rather than by a check, so a page refresh cannot inflate it.

### `GET /api/v1/me/activity`
The full activity feed, paginated (`page`, `limit` ≤ 100). The dashboard carries only the newest few.

### `GET /api/v1/me/daily-challenge` — **superseded by Milestone 8**

See "Daily challenge (Milestone 8)" at the end of this file: the endpoint now also reports the caller's own attempt, the streak and the reward, and the challenge is a pinned document rather than a value recomputed per request. The description below is kept for the shape it had in Milestone 5.

#### Milestone 5 behaviour
Today's challenge question for the caller's class, as a full **answer-stripped** question via the shared `studentQuestionView` — so it cannot expose an answer key even by accident. Deterministic: the same day and class always resolve to the same question, so a reload cannot be used to shop for an easier one.

Answers `{ challenge: null, reason: 'none-published' | 'no-class' }` — a 200, not a 404, because "there is no challenge today" is a normal answer while the bank has nothing published for that class.

**This replaced a static mock and is now authenticated where the mock was open**, because it returns question content. Both paths are served: the `/me/` form because the resource depends on who is asking, and the bare path because that is what was already published here.

---

## Public reads — no authentication

Real aggregations, all of them. `public/stats` and `leaderboard` were hardcoded mocks before Milestone 5; `hall-of-fame` arrived real in Milestone 10. Made public by an explicit decision of the project owner, so the landing page shows a real standing instead of an invented one — see [`DECISIONS.md`](DECISIONS.md).

`GET /leaderboard` and `GET /hall-of-fame` live in `routes/v1/leaderboard.routes.ts` (the leaderboard moved there from `misc.routes.ts` in Milestone 10). The leaderboard applies `attachUserIfPresent`, which attaches session claims when a cookie is present and **never rejects** — it grants nothing and is not a gate, it exists so one public endpoint can differ in *content* for a signed-in caller rather than being duplicated as a second ranking surface.

### `GET /api/v1/public/stats`
`{ stats: { studentsRegistered, registeredToday, schoolsRepresented, studentsActiveToday } }`. Real counts of accounts in good standing, distinct school names among them, and students with any activity today. A fresh deployment truthfully answers zero for all four, and the landing page renders that.

### `GET /api/v1/leaderboard`
**Extended in Milestone 10** with scopes, periods, pagination and the caller's own standing. The response still carries the same `leaderboard` array it always did, so existing callers (the landing page, the dashboard) were unaffected — everything else is an addition alongside it.

```
{ leaderboard: [{ rank, studentId, displayName, classLevel, schoolName, xp }],
  scope, classLevel, period,
  window: { from, to },
  pagination: { page, limit, total, totalPages },
  me: { rank, xp, totalRanked } | null,
  maxRankedDepth: number | null,
  today }
```

Query parameters — **and this is the entire input surface**:

| Param | Values | Default |
|---|---|---|
| `scope` | `overall`, `class` | `overall` |
| `classLevel` | one of the ten offered classes | — (**required** when `scope=class`; 400 otherwise) |
| `period` | `all_time`, `monthly`, `weekly`, `daily` | `all_time` |
| `page` | ≥ 1 | 1 |
| `limit` | 1–50 | 10 |

- **No request may state an XP total, a score or a rank.** Those fields are not filtered out by the handler — they are absent from the zod schema, and `validate()` replaces the query with the parse result, so an extra key cannot reach the service. Every number is a `$sum` over rows this backend wrote. A test sends `?xp=999999&rank=1&displayName=Hacker` and asserts nothing changes; there is no write method on this resource.
- `displayName` is a **first name plus a last initial** ("Ishaan V."). The entrants are schoolchildren and this endpoint is public and indexable, so a full legal name beside a school and a class is not published. Tests assert the full name, email address, mobile number and address are absent from the whole response body.
- **Scope.** A class board ranks *within* the class — the Class 9 leader is #1 there even if they are #6 overall.
- **Period.** A period board sums XP earned inside a window of **competition days** (IST), so everyone's week begins at the same instant. `window` states the days summed, so a page never has to guess. `from` is `null` for all time.
- **Ties share a rank** (standard competition ranking: 1, 2, 2, 4). The order *within* a tie is deterministic: XP descending, then whoever reached the total first, then the account id. See [`DECISIONS.md`](DECISIONS.md).
- Suspended and deactivated accounts are excluded, filtered *before* the limit so one cannot silently consume a place. A student with no XP in the window does not appear.
- `me` is the caller's own standing on **this** board, present only when signed in. `rank` is `null` for three real situations — no XP in the window, an account not in good standing, and a class board that is not theirs — while `xp` stays honest.
- `maxRankedDepth` is `100` for a signed-out caller and `null` for a signed-in one. Paging past it returns **403**: pagination would otherwise let the public endpoint be walked to enumerate the roll, which the old 50-row cap prevented on its own.

### `GET /api/v1/hall-of-fame`
**New in Milestone 10.** Public. `{ hallOfFame: { boards, totals, generatedFor } }`.

Five fixed boards, each `{ code, title, description, icon, entries, emptyReason }`, with entries `{ rank, studentId, displayName, classLevel, schoolName, value, valueLabel, achievedOn, detail }`. Query: `limit` (1–20, default 5) — the board size. Unpaginated by design: an honours list is short, because being on it should mean something.

| Board | Measures | Notes |
|---|---|---|
| `xp_champions` | Lifetime XP | The leaderboard's own first page, reused so the two cannot disagree |
| `mock_masters` | Best mock test, as a **percentage** of the paper | Each student's best only; papers scoring 0 or below are excluded |
| `streak_legends` | **Longest** run of consecutive days | Never `current`, so a broken streak withdraws nothing; minimum 2 days |
| `challenge_champions` | Daily challenges answered **correctly** | Correct only — the XP is paid for answering, so "answered" is a participation count |
| `practice_devotees` | Practice sessions **submitted** | Not started, so the board cannot be filled by abandoning papers |

- **A board with nothing behind it comes back empty with an `emptyReason`** naming what would fill it. Nothing is ever padded with a placeholder entry.
- **There is deliberately no official-exam board.** `ExamAttempt` and `Result` are written by nothing, so it would be permanently empty at best and fabricated at worst.
- `totals` — `studentsRanked`, `xpAwarded`, `mockTestsGraded`, `challengesAnswered`, `practiceSessionsCompleted`. All live counts.
- Same name masking and same exclusion of accounts not in good standing as the leaderboard, through the same `displayNameFor()`.

---

## Results, certificates and admin statistics (2026-08-11)

### `GET /api/v1/results/:studentId` — public
`{ result, reason? }`. Returns a **published** result from the real `Result` + `ExamAttempt` collections, or `{ result: null, reason: 'not-published' }`. Nothing writes a result yet, so that is today's answer for everyone.

**Replaced the worst fabrication in the product.** The result page used to hash whatever string was typed into its search box and derive a score, national rank and percentile from it — client-side, no server call — so any visitor could enter any ID and be shown an authoritative-looking result for a competition that has not been held.

Deliberately unauthenticated, because a public result portal is the point (a parent or school should not need an account). Three properties keep that safe:
- only `isPublished` results are visible, so marks cannot be read before release;
- the response for "no such account" and "no published result" is **identical**, so the portal cannot be used to enumerate which student IDs exist (asserted by test);
- marks and ranks only — no email, mobile, address or date of birth (asserted by test).

A malformed id is a 400. "No result" is a **200**, not a 404, because it is the ordinary expected answer.

### `GET /api/v1/certificates/:studentId` — now real
`{ certificates: [...] }`, containing only certificates backed by a **published result**. Returns `[]` for everyone today.

Was a hardcoded two-item array (`CERT-2026-01`, "National Math Olympiad Finalist") returned for any id including a non-existent one. The page it feeds used to print "For outstanding participation and achievement" for anyone signed in, dated today, with their student ID as the certificate number. `issuedAt` is `null` rather than today's date, because no issue date is stored — inventing one is what made the old certificate look genuine.

### `GET /api/v1/admin/stats`
Requires `students:read`. `{ stats: { registrationsByDay, activeStudentsByDay, totalStudents, totalActiveToday } }` — two real 14-day series bucketed by **IST** calendar day, so they line up with the streak and XP days used everywhere else.

Replaced the admin dashboard's hardcoded "Weekly Accuracy Trend" (`72, 78, 75, 82, 88, 90, 92` against Mon–Sun). Days with no activity **are** zero-filled here, unlike the student XP chart: for a platform-wide operational chart "no registrations on Tuesday" is itself a real observation, whereas for one student a gap means only that nothing was recorded.

---

## No static mocks remain

Every endpoint in `routes/v1/` now reads from the database. The three that were hardcoded — `daily-challenge`, `leaderboard` and `certificates/:studentId` — are all real, and the analytics fallback that invented a student's accuracy is deleted. Several endpoints return empty results because the collections behind them are empty, which is a different thing: they are live queries that will start returning data the moment exam submission writes any.

---

## PLANNED (not implemented)

No routes exist for: exam attempt submission, published results, certificate issuance tied to a real result, payments/orders, notifications, practice/mock-test sessions, changing your own email address or mobile number, or admin-initiated account deletion. Grep `backend/src/routes/v1/` before building against an assumed endpoint.

(Password reset and email verification arrived in Milestone 2; student listing/management and audit logs in Milestone 3; the question bank and taxonomy in Milestone 4; self-service profile editing, photo replacement, password change, the dashboard, XP/levels/streaks/achievements, the real leaderboard and the real daily challenge in Milestone 5; the Practice Zone in Milestone 6; mock tests in Milestone 7; the daily challenge in Milestone 8; the gamification engine in Milestone 9; **scoped, periodised, paginated leaderboards and the Hall of Fame in Milestone 10**.)

## Checklist for adding a route

1. Put it in the right file under `backend/src/routes/v1/` (or add a new file and register it in `routes/v1/index.ts`).
2. Return the `{ success, ... }` envelope via `sendSuccess`/`sendError`.
3. Add a zod schema in `backend/src/validation/` and apply `validate({ body/query/params })`.
4. Gate it with `requirePermission('...')`, adding a new permission to `backend/src/lib/permissions.ts` if none fits. Do **not** compare `req.user.role` to a literal in the handler. Use `requireAuth(...)` only when the requirement really is an identity rather than a capability.
5. **Apply `ensureDb` if it touches the database**, after validation/auth. Forgetting this yields a route that works locally but fails in production. (`requirePermission` already includes it for privileged permissions; applying it again is harmless, since `connectDB()` caches.)
5b. If it changes an account, a role, or the question bank, call `recordAudit(req, {...})` with a matching action from `backend/src/models/AuditLog.ts`.
6. Document it here and update [`FEATURE_STATUS.md`](FEATURE_STATUS.md) in the same change.

---

## Practice Zone (Milestone 6)

All six routes are gated on `requireAuth()` and resolve the caller's own account from the token's `sub`. **No route accepts a student id**, and every session lookup puts `student` in the query rather than checking ownership afterwards — so another student's session is indistinguishable from one that does not exist (404, never 403, asserted by test).

### `GET /api/v1/practice/options`
Real availability for the caller's class: subjects → topics with per-topic question counts and only the difficulties that actually exist. An empty bank returns `{ subjects: [] }`; an account with no class returns `reason: 'no-class'`. The picker is built from this, so a combination with nothing behind it can never be selected.

### `POST /api/v1/practice/sessions`
Body: optional `subjectId`, `topicId`, `difficulty`; `questionCount` (1–50, default 10). **`classLevel` is not accepted** — the paper is always drawn for the student's own class, so a Class 6 student cannot request the Class 12 paper (asserted by test).

Draws with `$sample`, so repeating the same filters gives fresh questions — the opposite of the daily challenge, which is deterministic on purpose. Fewer questions than asked for is not an error. Returns **409** when nothing published matches, rather than opening an empty session. Rate limited (120/hour).

Responds with the in-progress view: question text, options (`key` + `text` only), taxonomy, marks — and **no answer key**.

### `GET /api/v1/practice/sessions/:sessionId`
Answer-stripped while in progress, fully marked once submitted. One URL for both, so a student can resume an unfinished session or revisit a review.

### `PUT /api/v1/practice/sessions/:sessionId/answers`
Body: `questionId` plus whichever of `selectedOptionKeys` / `numericResponse` / `booleanResponse` fits. Only the field belonging to the question's own type is stored. An option key the question never offered is a **400**; more than one key on a `single_choice` question is a **400**; a question outside the session is a **404**; a submitted session is a **409**.

Per-answer rather than one bulk save, so closing the browser mid-session loses nothing. The response deliberately carries **no correctness** — saying whether the answer was right would reveal the key before submission. Not rate limited, because a student working a 50-question paper legitimately saves dozens of answers.

### `POST /api/v1/practice/sessions/:sessionId/submit`
Grades server-side against the snapshot and returns the full review plus `xpAwarded`. A second submission is a **409**, so a score cannot be re-rolled after the answers have been revealed. Earns `practice_completed` (25 XP) **once per competition day**, and nothing at all for a paper with no answers.

### `GET /api/v1/practice/sessions`
The student's own history, newest first, paginated. Scores and accuracy, but **no per-question detail and no answers** — the review endpoint is the only route to those (asserted by test).

---

## Mock tests (Milestone 7)

Two groups of routes: **authoring**, gated on the new `mocktests:write` permission, and **sitting**, gated on the existing student permission `exam:take`.

The student routes resolve the caller's own account from the token's `sub`. **No student route accepts a student id**, and every attempt lookup puts `student` in the query rather than checking ownership afterwards — so another student's attempt is indistinguishable from one that does not exist (404, never 403, asserted by test).

**The clock is the server's.** No request body on any route here carries a time. `expiresAt` is computed and stored when the attempt is created (`startedAt + durationMinutes`, clamped to the test's `availableTo`) and every timing decision reads that stored value. A test posts `expiresAt`, `secondsRemaining`, `durationMinutes`, `timeTakenSeconds` and `startedAt` alongside a legitimate answer and asserts the stored deadline does not move.

### Authoring

#### `GET /api/v1/admin/mock-tests`
Paginated list. Filters: `status`, `classLevel`, `search` (title, matched literally — the pattern is regex-escaped). Carries no question text; the list is a table of titles.

#### `GET /api/v1/admin/mock-tests/:id`
Full detail including the paper — each question's id, order, per-test marks, and its text, type, difficulty and bank status so the editor can identify it. Also returns **`attemptsCount`**, which is what tells the editor the paper is frozen (see below).

#### `POST /api/v1/admin/mock-tests`
Body: `title`, `classLevel`, `questions` (1–100 × `{ question, marks, negativeMarks }`), `durationMinutes` (1–600), and optionally `description`, `instructions`, `availableFrom`, `availableTo`, `maxAttempts` (1–10, default 1), `resultDisplay`, `reviewPolicy`.

Created as a **draft**; `totalMarks` is computed by the server and is not accepted from a client. Refusals: a question that does not exist or belongs to another class is a **400**; `negativeMarks` above `marks` is a **400**; the same question twice is a **400**; `availableTo` not after `availableFrom` is a **400**; a disclosure setting of `after_close` with no closing time is a **400** (it would otherwise silently mean "never").

#### `PUT /api/v1/admin/mock-tests/:id`
Sends the whole test, like a question edit. **Once the test has attempts, the question list, any question's marks and `durationMinutes` are frozen** and a change to them is a **409** — results already recorded would otherwise stop being comparable. Everything else stays editable for the life of the test: title, description, instructions, window, attempt limit and both disclosure settings.

#### `PATCH /api/v1/admin/mock-tests/:id/status`
Body: `status` (`draft` / `published` / `archived`), optional `reason` recorded in the audit trail.

Publishing requires at least one question, **every** question already published (**409** naming how many are not), and a closing time if either disclosure setting is `after_close`. Unpublishing to `draft` withdraws the test and refuses new attempts but deliberately does not interrupt an attempt under way.

#### `DELETE /api/v1/admin/mock-tests/:id`
Hard delete, permitted only for a test that has **never been published** and that nobody has attempted — a **409** otherwise, naming which. Archiving is the removal path for everything else, exactly as in the question bank.

#### `GET /api/v1/admin/mock-tests/:id/results`
Cohort statistics, a ranked row per attempt, and per-question outcomes.

Ranking is standard competition ranking (ties share a rank). Statistics with no attempts behind them are **`null`**, not 0. `questionStats[].correctPercent` is of the students who *answered* that question, and `null` when nobody did.

Staff see real marks whatever the test's `resultDisplay` says — that setting governs what a *student* is told, not whether the person who set the test may read their cohort's results.

**Reading this endpoint finalises expired attempts** for that test before aggregating, so a paper whose clock ran out is reported as the graded thing it is rather than as "in progress" indefinitely. There is no scheduler on the free tier to do it in the background (see [`DECISIONS.md`](DECISIONS.md)).

### Sitting a test

#### `GET /api/v1/mock-tests`
Published tests for the caller's own class, with their own attempt state on each: attempts used and left, `resumeAttemptId`, availability and the reason when unavailable. **No questions.** An account with no class returns `reason: 'no-class'`.

#### `GET /api/v1/mock-tests/:id`
The pre-start briefing — instructions, duration, marks, window, attempts left, and the disclosure settings so the student knows in advance whether they will see their score. Still **no questions**. A draft, archived or other-class test is a **404**, so the endpoint cannot enumerate unpublished tests.

#### `POST /api/v1/mock-tests/:id/attempts`
Starts the test, or **resumes** an attempt already open — returned with its original deadline, which is what makes a reload safe and stops "start again" buying a fresh clock. `201` for a new attempt, `200` with `resumed: true` for a resumption.

Refusals: outside the window is a **409** (`not opened yet` / `closed`); under 60 seconds of window left is a **409**; the attempt limit is a **409**; another class's test is a **403**; a test whose paper references a missing question is a **409** rather than a short paper, because everyone sitting a test must sit the same one. Rate limited (60/hour).

Responds with the answer-stripped paper plus `expiresAt` and `secondsRemaining` — the first and only point at which the questions are served.

#### `GET /api/v1/mock-tests/attempts/:attemptId`
Serves whichever of four shapes the attempt and the test's settings permit: the open paper with remaining time; the full marked review; the score and summary without the answers; or the bare fact that it was submitted, with a `disclosure.reason`. **An open attempt whose deadline has passed is graded on the way in**, so a student who closed their laptop returns to their marked paper.

#### `PUT /api/v1/mock-tests/attempts/:attemptId/answers`
Body: `questionId` plus whichever of `selectedOptionKeys` / `numericResponse` / `booleanResponse` fits. Only the field belonging to the question's own type is stored. An option key never served is a **400**; a second key on a `single_choice` question is a **400**; a question outside the attempt is a **404**.

**After the deadline it is a 409 and the answer is not stored**, and the attempt is graded in the same request. The response carries **no correctness** — that would reveal the key one question at a time — but does carry `secondsRemaining`, which is how a drifted client resynchronises. Deliberately **not** rate limited: a student under a clock that does not stop saves an answer every few seconds.

#### `POST /api/v1/mock-tests/attempts/:attemptId/submit`
Grades server-side against the snapshot taken when the paper was served. Returns whichever disclosure shape applies, plus `xpAwarded` and `alreadySubmitted`.

A second submission is **200, not 409**: from the student's point of view the paper *is* submitted, and an error would invite them to press again. It returns the stored result with `alreadySubmitted: true` and cannot re-grade, re-roll the score or award XP twice — the closing write is conditional on the attempt still being open. Arriving after the deadline still grades, *as at the deadline*, recorded as `time_expired`.

Earns `mock_test_completed` (50 XP) **once per competition day**, and nothing at all for a paper with no answers. Rate limited (60/hour).

#### `GET /api/v1/mock-tests/attempts`
The student's own attempts across every test, newest first, paginated. Honours each test's result policy: a score the student may not yet see is `null` here too. No per-question detail and no answers.

---

## Daily challenge (Milestone 8)

One question a day per class. Student routes gate on `requireAuth()` (identity, like the rest of `/me`); scheduling gates on the new `challenges:write` permission.

**No student route accepts a day.** Which day it is comes from `lib/competitionDay.ts` — an IST calendar day — so a student cannot claim yesterday's reward by naming yesterday, and a browser in another timezone cannot disagree about which challenge is today's. No student route accepts anything about the outcome either: grading is server-side, and the reward is awarded by `recordActivity()`.

**A day's challenge is a stored document.** The first request for a `{day, classLevel}` with nothing scheduled pins the deterministic pick and writes it; everything after that reads the same row. Publishing more questions therefore cannot change what today's challenge is — which the previous, recompute-on-read implementation could not promise.

### Sitting today's challenge

#### `GET /api/v1/me/daily-challenge` (also `GET /api/v1/daily-challenge`)
Today's challenge for the caller's class, and their own attempt at it.

- **Not answered yet** → `challenge` (answer-stripped) and `attempt: null`. Nothing in the payload can reveal the answer; a test stringifies the whole body and forbids the field names and the literal correct values.
- **Answered** → the same question plus `attempt`: what they chose, whether it was right, the correct answer and the author's explanation.

Also carries `streak` (current and longest), `completedCount`, `reward: { xp, claimed }` and the server's `today`. Answers `challenge: null` with `reason: 'none-published'` (nothing published for that class) or `reason: 'no-class'` (an account predating the class field) — both **200**, because neither is an error.

The reveal is safe here in a way it would not be for a mock test: an attempt document only exists once the student has answered, so there is no path that discloses anything to someone who has not. A daily challenge has **no disclosure policy** on purpose — its point is to teach one question a day, and withholding the explanation would defeat that.

#### `POST /api/v1/me/daily-challenge/answer`
Body: whichever of `selectedOptionKeys` / `numericResponse` / `booleanResponse` fits the question's type. Grades server-side against a snapshot taken at submission, using the shared grader.

Refusals: an option key never offered is **400**; a second key on a `single_choice` question is **400**; a **blank** submission is **400** (a challenge is one question — a blank is either a mis-click or an attempt to claim the day for nothing); no class on the account is **409**; no challenge for the class today is **409**.

**A repeat submission is 200, not 409.** The student really has answered today, and an error would invite them to press again. It returns the stored attempt with `alreadyAnswered: true` and **`xpAwarded: 0`** — the top-level figure is what *this* request awarded, not the attempt's stored total, so a client cannot show "+15 XP" twice. Nothing is re-graded: the first answer is the one that stands.

Earns `daily_challenge_completed` (15 XP) once per competition day, for **answering rather than for being right**. Negative marking is forced to 0, so a wrong answer scores 0 and is never a penalty. Rate limited (30/hour).

#### `GET /api/v1/me/daily-challenge/history`
The caller's own past challenges, newest day first, paginated, with `streak` and `completedCount`. Each row names the question the **attempt** snapshotted, not whatever its challenge points at now — a future day can be re-pointed, and a history row must describe what the student actually answered.

### Scheduling

#### `GET /api/v1/admin/daily-challenges`
Scheduled and already-served days, newest first. Filters: `classLevel`, `from`, `to` (day keys — `YYYY-MM-DD` sorts chronologically, so the range is a plain string range). Each row carries `source` (`scheduled` / `automatic`), how many students answered, how many were right, and `correctPercent` — of those who *answered*, and `null` when nobody did.

Also returns `today` and `upcoming` (14 days). Both come from the server because a competition day is an IST day: a browser computing it locally could schedule against the wrong one.

#### `POST /api/v1/admin/daily-challenges`
Body: `day`, `classLevel`, `questionId`.

Refusals: a day in the past is **400** (a past day is the record of what a class was set, not a plan); a malformed or impossible date such as `2026-02-30` is **400**; a question for another class is **400**; an unpublished question is **409** (it would show unreviewed content to a whole class); a day that class already has is **409**, enforced by the unique index rather than by looking first.

#### `PUT /api/v1/admin/daily-challenges/:id`
Body: `questionId` — only the question may change. Moving a challenge to another day or class is deliberately not expressible: it is indistinguishable from deleting one and adding another, and the two-step version is safe because of the unique index.

Refused with **409** once anybody has answered it, and for a past day. A future day can be re-pointed freely, which is the point of scheduling ahead. Re-pointing an automatically-filled day marks it `scheduled`, because it has become a staff decision.

#### `DELETE /api/v1/admin/daily-challenges/:id`
Clears a scheduled day. **409** once anybody has answered it — their attempt refers to it, and it is part of their record.

---

## Gamification (Milestone 9)

Two surfaces: a student's whole standing, and the administrator's award table.

**Every XP grant in this backend goes through one function** (`services/rewardService.ts` → `grantReward()`), so there is no endpoint here that "awards" anything — rewards are a side effect of the action that earned them, on the practice, mock-test, daily-challenge and auth routes. What these endpoints do is *report* and *configure*.

### `GET /api/v1/me/rewards`

Gated on `requireAuth()`, like the rest of `/me`. The caller's own standing, in one response:

- `xp` and `level` — the level, the XP into it, and what the next one costs. A pure function of the total, never stored.
- `streak` and `challengeStreak` — current and longest, derived from the distinct days in the activity log.
- `badges` — five tiered families, each with the tier held (`bronze` / `silver` / `gold` / `null`), the real count behind it, the next tier and progress toward it.
- `achievements` — the **whole** catalogue, not the dashboard's top three: this is where a student comes to see everything, including what is a long way off.
- `journey` — nine ordered stages with exactly one `current`, plus `completedCount` and `percent`.
- `totals` — the real counts the catalogues were evaluated from (practice sessions, mock tests, daily challenges, active days), so the page can print the number beside the badge that measures it.

**Nothing here is stored.** All of it is derived from `StudentActivity` and the attempt collections on every read, through one facts object. The dashboard's achievement panel and this endpoint call the same function, so they cannot disagree.

The root administrator has no student record and therefore no standing: **404**, not an empty shape.

### `GET /api/v1/admin/reward-settings`

Gated on `rewards:write` (elevated, so the role is re-read from the database). Returns one row per activity type with three figures: `defaultXp` (what the code ships with), `overrideXp` (what an administrator set, or `null`), and `effectiveXp` (what a grant would pay right now). All three, deliberately — "someone changed this" and "this is how it ships" are different facts.

### `PUT /api/v1/admin/reward-settings`

Body: `{ xpOverrides: { <activityType>: number } }`, each 0–500 and a whole number.

Sends the **whole** override set. An event absent from the payload reverts to its code default, which is the only way back to it — a partial patch would make "remove this override" and "leave it alone" the same request.

Refusals: an unknown event name is **400**; a negative, fractional or out-of-range amount is **400**. Nothing is written when any entry is rejected.

**This cannot re-price history.** `StudentActivity.xpAwarded` is a snapshot written when the event happened and a student's total is the sum of those recorded values, so a change here decides what the *next* event pays and nothing else. It is a property of the data model rather than a promise made by this endpoint, and it has its own test. Audited as `reward.settings.updated`.

Only **amounts** are configurable. Which events exist, how often each may be earned (`ONCE_PER_DAY` / `ONCE_PER_ACCOUNT`), what makes one eligible, and where the level thresholds fall all stay in code.
