# DATABASE_SCHEMA.md

MongoDB via Mongoose. **Twenty-six models** — Milestone 20 added no collection: it extended `Question` with an embedded **`provenance`** subdocument and `GenerationLog` with `rejectedByReviewer`. Twenty-six as of Milestone 19, which added **`Payment`** and **`PaymentSettings`** — the transaction record and the administrator-editable entry fee. Twenty-four as of Milestone 18, which added `GenerationLog`. **Twenty-three models** as of Milestone 15, which **removed `StudentAnalytics`** and added three indexes but no collection — see "Analytics aggregations" at the end of this file for the queries that replaced it. Twenty-four as of Milestone 14, which added **`EmailOutbox`** (the email queue) and extended two existing collections: `Notification` gained `student` / `source` / `event` / `link` / `dedupeKey`, and `Student` gained an embedded `notificationPrefs`. Twenty-three as of Milestone 13, which added `Exam` and `Certificate` and **rewrote** `ExamAttempt` and `Result`. Twenty-one as of Milestone 12, which added `GalleryItem`, `Notification` and `NotificationRead`. **Eighteen models** as of Milestone 9, which added `RewardSettings` — a single-document collection holding the administrator's XP overrides, pinned by a unique index on a constant `key`. Seventeen as of Milestone 8, which added `DailyChallenge` and `DailyChallengeAttempt`. Fifteen as of Milestone 7, which added `MockTest` and `MockTestAttempt` (plus `attemptAnswer.ts`, a shared subdocument rather than a model of its own). Thirteen as of Milestone 6 (Milestone 5 added `StudentActivity`; Milestone 6 added `PracticeSession`). Previously eleven as of Milestone 4 (Milestone 2 added `RefreshToken` and `VerificationToken`; Milestone 3 added `AuditLog` and gave `Student` a `role`; Milestone 4 added `StudentPhoto` plus nine registration fields on `Student`, then `Subject` and `Topic` and a rewritten `Question` for the question bank). Each model lives in its own file under [backend/src/models/](backend/src/models/) (`Student.ts`, `StudentPhoto.ts`, `Subject.ts`, `Topic.ts`, `Question.ts`, `ExamAttempt.ts`, `Result.ts`, `StudentAnalytics.ts`, `RefreshToken.ts`, `VerificationToken.ts`, `AuditLog.ts`), re-exported from `models/index.ts`. They were originally moved out of the old single-file `server.ts` without any schema change; `Student` has since been extended by Milestones 2, 3 and 4. Each model now also has an exported TypeScript document interface (e.g. `StudentDocument`) so handlers are typed instead of using `any`. Connection string: `MONGO_URI` env var (default `mongodb://localhost:27017/amit-olympiad` if unset — see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)).

**That default is a trap worth knowing about.** Because it exists, a script or process with no `.env` loaded connects to a *local* database and works perfectly, writing to somewhere nobody is looking. This happened: a seed run from the wrong directory published 208 questions to localhost while production stayed empty. `config/env.ts` now anchors the `.env` lookup to the package root, and every write script calls `assertConfiguredForWrites()`. Use `npx tsx scripts/where-is-data.ts` to see which database is actually connected and what every collection really holds.

## Status legend
- `ACTIVE` — model is written to and/or read by at least one route.
- `DEAD` — model is declared but no route ever reads or writes it.

---

## `Student` — ACTIVE

Purpose: one document per registered student; the sole source of truth for student auth.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `fullName` | String | no | — | **Derived, never supplied.** A `pre('validate')` hook joins `firstName`, `middleName` and `lastName`. Kept because the admin list, its search, the session envelope and the certificate all read it. |
| `firstName` | String | **on create** | — | **Added in Milestone 4.** |
| `middleName` | String \| null | no | `null` | **Milestone 4.** Empty or whitespace normalises to `null`. |
| `lastName` | String | **on create** | — | **Milestone 4.** |
| `fatherName` | String | **on create** | — | **Milestone 4.** |
| `motherName` | String | **on create** | — | **Milestone 4.** |
| `dateOfBirth` | Date | **on create** | — | **Milestone 4.** Submitted as `YYYY-MM-DD`; validated as a real past date implying an age of 5–40. |
| `classLevel` | String enum | **on create** | — | **Milestone 4.** One of the ten values in `src/lib/classLevels.ts`: `Class 5`–`Class 11`, then `Class 12 - Science` / `- Commerce` / `- Humanities`. |
| `schoolName` | String | **on create** | — | **Milestone 4.** |
| `address` | String | **on create** | — | **Milestone 4.** Free text, 10–500 characters. |
| `mobile` | String | **yes** | — | `unique`, trimmed. Usable as a login identifier. |
| `email` | String | **yes** | — | `unique`, lowercased, trimmed. **Added in Milestone 2.** Usable as a login identifier, and the only channel for verification and password reset. |
| `passwordHash` | String | **yes** | — | bcrypt, cost 12 (4 under test for speed). **Excluded from query results at the schema level** (`select: false`) so it cannot leak through a route that forgets to project it away; the login handler opts in with `.select('+passwordHash')`. |
| `studentId` | String | **yes** | — | **`unique`**, with two namespaces since Milestone 11: `AMIT_0000`–`AMIT_9999` for entrants and `ADMIN_0000`–`ADMIN_9999` for the bootstrap staff account. `AMIT_xxxx` is the *competitor* numbering — the number a child writes on an exam paper and types into the public result portal — and there are only ten thousand of them, so staff are deliberately not given one. Both generators retry on a duplicate-key error, which fixes the silent-collision bug recorded in earlier versions of `PROJECT_STATE.md`. |
| `isEmailVerified` | Boolean | no | `false` | Login is refused while `false` (unless `REQUIRE_EMAIL_VERIFICATION=false`). Set by verifying, and also by completing a password reset (which proves mailbox control). |
| `status` | String enum | no | `'active'` | One of `active` / `suspended` / **`blocked`** / `deactivated` (`ACCOUNT_STATUSES`). Checked on login, on every `/auth/me`, on refresh, and on every privileged request — all three non-active values bar sign-in, and every gate is written `!== 'active'`, so adding `blocked` in **Milestone 11** barred it everywhere at once. They stay distinct because the audit trail must be able to say *which*: `suspended` is a temporary hold, `blocked` is a ban, `deactivated` is a closed account rather than one in trouble. |
| `role` | String enum | no | `'student'` | **Added in Milestone 3; widened in Milestone 11.** One of `student` / `admin` / `superadmin` (the full `ROLES`). Indexed. `student` and `admin` are set only by `PATCH /admin/users/:studentId/role` (`users:role:write`, super admin only). **`superadmin` is storable but not assignable**: `ASSIGNABLE_ROLES` omits it, so no API call can produce one — the only writer is the bootstrap in `services/rootAdminService.ts`, which provisions the root account on its first sign-in. |
| `roleUpdatedAt` | Date \| null | no | `null` | **Milestone 3.** When the role last changed. |
| `roleUpdatedBy` | String \| null | no | `null` | **Milestone 3.** Who changed it (label only; the full record is in `AuditLog`). |
| `mustChangePassword` | Boolean | no | `false` | **Milestone 11.** Set when staff issue a temporary password (`POST /admin/users/:studentId/reset-password`). Cleared in exactly one place — `POST /me/change-password` — and also by completing a `forgot-password` reset. While set, the frontend holds the whole app on a forced change screen. |
| `passwordResetAt` | Date \| null | no | `null` | **Milestone 11.** When staff last reset this account's password. |
| `passwordResetBy` | String \| null | no | `null` | **Milestone 11.** Which member of staff did (label only; the full record is in `AuditLog`). The password itself is never stored in readable form anywhere. |
| `tokenVersion` | Number | no | `0` | Incremented by `logout-all`, by a password reset, and (**Milestone 3**) by any role change or by a suspension/deactivation. Access tokens carry the value they were signed with (`tv`); a mismatch means the token predates the revocation and is rejected. |
| `failedLoginAttempts` | Number | no | `0` | Reset on a successful login. |
| `lockedUntil` | Date \| null | no | `null` | Set once `failedLoginAttempts` reaches `MAX_FAILED_LOGINS`; login returns `423` until it passes. |
| `lastLoginAt` | Date \| null | no | `null` | |
| `registeredAt` | Date | no | `Date.now` | |

Indexes: unique on `mobile`, `email`, and `studentId`; non-unique on `role` (the admin listing filters by it, and the authorization freshness check reads it on every privileged request).

**"Required **on create**"** means `required: function () { return this.isNew }` — enforced when a document is created (registration, the only creation path, where zod has already rejected a missing field with a 400) but **not** when an existing one is saved. Without that scoping, an administrative `save()` on an account that predates Milestone 4 — suspending it, changing its role — would fail validation on nine fields the administrator never touched. Every API view of these fields is therefore explicitly nullable, and the admin table renders `—`. See the Milestone 4 ADR in [`DECISIONS.md`](DECISIONS.md).

**Migration warning**: `email` is required and unique, so any `Student` document created before Milestone 2 has no email and will fail validation on its next save. Reads still work. There is no migration script — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). The Milestone 4 fields deliberately avoid repeating this, per the note above.

Relationships: `studentId` is the informal, human-facing key. **This note is now historical** — `ExamAttempt` and `Result` were rewritten in Milestone 13 to use real `ObjectId` refs, and `StudentAnalytics`, the last holder of a string `studentId`, was removed in Milestone 15. Every collection now references `Student` by `ObjectId`.

**Role model (Milestone 3)**: an account's `role` on this document is the authority. The access token carries a `role` claim as well, but for any privileged request the middleware re-reads this field and uses the database value, so a demotion cannot be outlived by an already-issued token. The environment-configured root administrator holds `superadmin` and has **no document here** — see [`DECISIONS.md`](DECISIONS.md).

## `StudentPhoto` — ACTIVE

Purpose: the mandatory registration photo, one document per account. **Added in Milestone 4.**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `student` | ObjectId → `Student` | **yes** | — | `unique` — one photo per account; re-uploading would replace the document rather than accumulate copies. A real `ObjectId` ref, not a `studentId` string. |
| `contentType` | String enum | **yes** | — | One of `image/jpeg` / `image/png` / `image/webp`. Validated against the file's actual magic bytes, not just the client's claim. |
| `size` | Number | **yes** | — | Bytes. Schema `max` is `MAX_PHOTO_BYTES` (2 MB). |
| `data` | Buffer | **yes** | — | The image itself. |
| `uploadedAt` | Date | no | `Date.now` | |

Indexes: unique on `student`. **No TTL** — a photo lasts as long as the account.

**Why a separate collection**: every `Student` query (the admin listing, the login lookup, the freshness read on each privileged request) would otherwise carry a 2 MB binary, and `select: false` would be one forgotten projection away from being very expensive. Keeping it separate also means a future move to object storage touches one collection instead of every account document.

**Capacity**: at 2 MB a photo, the Atlas free tier's 512 MB holds roughly **250 students**. This is the first thing that will force a paid tier or an image CDN — see the Milestone 4 ADR in [`DECISIONS.md`](DECISIONS.md).

Served by `GET /students/:studentId/photo` (see [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md)). Accounts registered before Milestone 4 have no row here, and that endpoint answers 404.

## `Subject` — ACTIVE

Purpose: the top level of the question taxonomy. **Added in Milestone 4.**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | String | **yes** | — | Max 80 chars. Unique **case-insensitively** (a collated index), so "Algebra" and "algebra" are one subject, not two. Plain text: `$`, `<` and `>` are rejected, because names render as labels and never through the maths renderer. |
| `slug` | String | **yes** | — | `unique`. Derived from `name` by `lib/slug.ts`, and re-derived on rename. A handle, **not** an authorization key. |
| `description` | String \| null | no | `null` | Max 500 chars. |
| `status` | String enum | no | `'active'` | `active` / `archived`. Indexed. |
| `displayOrder` | Number | no | `0` | Ascending sort key, so subjects need not be alphabetical. |
| `createdBy` / `createdByLabel` | ObjectId \| null / String \| null | no | `null` | Actor, with the label denormalised as in `AuditLog`. |
| `createdAt` / `updatedAt` | Date | auto | — | Mongoose `timestamps`. |

Indexes: unique on `slug`; unique collated on `name`; compound `status + displayOrder + name` for the listing.

---

## `Topic` — ACTIVE

Purpose: topics **and subtopics** — the same collection, distinguished by `parent`. **Added in Milestone 4.**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `subject` | ObjectId → `Subject` | **yes** | — | Indexed. |
| `parent` | ObjectId → `Topic` \| null | no | `null` | `null` for a top-level topic; a topic id makes this row a **subtopic**. |
| `depth` | Number | no | `0` | 0 = topic, 1 = subtopic. Derived from `parent` by the service, never sent by a client. Capped at `MAX_TOPIC_DEPTH` (1). |
| `name` | String | **yes** | — | Max 120 chars, plain text (same rule as `Subject.name`). |
| `slug` | String | **yes** | — | **Not globally unique** — see below. |
| `description` | String \| null | no | `null` | |
| `status` | String enum | no | `'active'` | `active` / `archived`. Indexed. |
| `displayOrder` | Number | no | `0` | |
| `createdBy` / `createdByLabel` | ObjectId \| null / String \| null | no | `null` | |
| `createdAt` / `updatedAt` | Date | auto | — | |

Indexes: unique compound on `subject + parent + slug`; compound `subject + parent + displayOrder + name`.

**Why uniqueness is scoped to the parent rather than global**: "Fractions" may legitimately exist under both Arithmetic and Algebra, and as a subtopic of each. A globally unique slug would reject that.

**Why one collection instead of a separate `Subtopic` model**: a second model would duplicate every field and every query, and would make "everything under this subject" two queries instead of one. The `depth` cap of 1 is a deliberate product limit, not a technical one — raising it means changing `MAX_TOPIC_DEPTH` and the admin form, not the schema. See the Milestone 4 ADR in [`DECISIONS.md`](DECISIONS.md).

**Archiving is refused** while published questions still reference the entry (as either `topic` or `subtopic`); the API answers 409 and says how many.

---

## `Question` — ACTIVE

Purpose: the Olympiad question bank. **Rewritten in Milestone 4** — questions are now authored through a real CRUD interface with an editorial workflow, rather than only being filled by the template generator.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `questionText` | String | **yes** | — | Max 5000. Plain text with LaTeX islands (`$…$`, `$$…$$`), validated by `lib/mathContent.ts`. |
| `type` | String enum | **yes** | — | `single_choice` / `multiple_choice` / `true_false` / `numeric` / **`fill_blank`** (Milestone 18). Determines which answer field is used — and which are **forbidden**. |
| `options` | [{ `key`, `text`, `isCorrect` }] | no | `[]` | Choice types only; max 8. `key` (`a`, `b`, …) is assigned by the **server**. |
| `booleanAnswer` | Boolean \| null | no | `null` | `true_false` only. |
| `numericAnswer` | Number \| null | no | `null` | `numeric` only. |
| `tolerance` | Number \| null | no | `null` | `numeric` only; null means an exact match is required. |
| `acceptedAnswers` | [String] | no | `[]` | **`fill_blank` only** (Milestone 18); max 8, first one canonical. Every spelling that counts as correct, matched through `normalizeAnswerText()` in the one grader — which forgives capitalisation, whitespace and a *sentence-final* full stop and **nothing else**. Two entries that normalise to the same string are refused at validation, because this list is what a reviewer reads to understand what will be marked right. |
| `solution` | String \| null | no | `null` | Max 8000, LaTeX-aware. **Required before publishing.** |
| `subject` | ObjectId → `Subject` | **yes** | — | Indexed. |
| `topic` | ObjectId → `Topic` | **yes** | — | Indexed. Must be `depth: 0` and belong to `subject`. |
| `subtopic` | ObjectId → `Topic` \| null | no | `null` | Must have `topic` as its parent. |
| `classLevel` | String enum | **yes** | — | One of `CLASS_LEVELS` — the same ten values registration uses. Indexed. |
| `difficulty` | String enum | no | `'Medium'` | `Easy`/`Medium`/`Hard`. Indexed. |
| `marks` | Number | **yes** | — | 0.25–100. |
| `negativeMarks` | Number | no | `0` | 0–100, a **magnitude to deduct**; `0` disables negative marking. Cannot exceed `marks`. |
| `status` | String enum | no | `'draft'` | `draft` / `in_review` / `published` / `archived`. Indexed. |
| `tags` | [String] | no | `[]` | Lowercased, trimmed, de-duplicated. Indexed. Max 20. |
| `revision` | Number | no | `1` | Incremented on every content edit, so an exam attempt can record which version it showed. |
| `createdBy` / `createdByLabel` | ObjectId \| null / String \| null | no | `null` | |
| `updatedBy` / `updatedByLabel` | ObjectId \| null / String \| null | no | `null` | |
| `publishedAt` | Date \| null | no | `null` | When last published. **Historical** — deliberately *not* cleared when a question returns to `draft`, because it is the witness the hard-delete guard tests. `status` is the authority on current visibility. |
| `archivedAt` | Date \| null | no | `null` | Cleared on restore. |
| `provenance` | subdocument | no | `{ source: 'human' }` | **Milestone 20.** Who wrote it. See below. |
| `createdAt` / `updatedAt` | Date | auto | — | |

### `Question.provenance` (Milestone 20) — an embedded subdocument

| Field | Type | Default | Notes |
|---|---|---|---|
| `source` | String enum | `'human'` | `human` / `ai_assisted`. `human` covers every question typed into the editor **and every question created before Milestone 20**, so a missing provenance block never has to be interpreted. |
| `generatorId` | String \| null | `null` | The registered generator, e.g. `gemini`. |
| `generatorKind` | String \| null | `null` | `model` only when a real language model produced the text. A statement of fact, not a label. |
| `modelName` | String \| null | `null` | The **exact** model that wrote it, not the deployment's current default. |
| `generationLog` | ObjectId → `GenerationLog` \| null | `null` | The run it came from, so the batch is traceable. |
| `generatedAt` | Date \| null | `null` | When the batch was generated (the log row's own timestamp). |
| `editedByReviewer` | Boolean | `false` | Whether the reviewer changed the text before approving. |
| `reviewedBy` / `reviewedByLabel` | ObjectId → `Student` \| null / String \| null | `null` | Who approved it. Distinct in *intent* from `createdBy` even when it is the same account: `createdBy` says who caused the row to exist, this says who took responsibility for its correctness. |
| `reviewedAt` | Date \| null | `null` | |

**Written only by `approveQuestions()`**, and every field is either derived from the server's own `GenerationLog` row or taken from the token. It is **not** part of `QuestionContentInput`, deliberately: content is what a reviewer may edit, and provenance is a fact about how the row came to exist that no request body should be able to set. A client cannot name a model it did not use, and — the field actually worth lying about — cannot file machine-written questions as hand-written ones.

**It holds no credential and no prompt text.** The examiner's instruction is not stored here; `GenerationLog.hadInstructions` records only that there was one. A model name and a reviewer are facts about the row; a prompt is a draft artefact.

**It is displayed, not merely stored.** `GET /admin/questions` serves it, the question bank prints a badge from it, and `?source=ai_assisted` filters on it. That matters: a stored field nothing reads is exactly the shape of thing Milestone 15 deleted when it removed `StudentAnalytics`.

**There is no separate review lifecycle.** A `DRAFT / PENDING_REVIEW / APPROVED / REJECTED` state was considered and not added: `status` (`draft` → `in_review` → `published` → `archived`) already *is* the editorial workflow, and a machine-drafted question that has been approved is an ordinary question-bank row. Two lifecycles would be two things to keep correct, and "rejected" has no row to live on — nothing is stored until approval.

Indexes: `status + createdAt`, `subject + topic + status`, `classLevel + difficulty + status`, `tags`, `provenance.source + createdAt`.

**The answer shape per type is exclusive.** Validation requires the fields a type uses *and rejects the ones it does not*, so a `numeric` question cannot carry an option list nothing will read, and an MCQ cannot carry a stray `numericAnswer` — the kind of bad data that later looks like a rendering bug.

**Answers are keyed, not text-matched.** The old model stored `correctAnswer` as the literal option *string*, so fixing a typo in an option silently invalidated every recorded answer. Correctness is now a per-option `isCorrect` flag against a stable server-assigned `key`.

**Deletion**: archiving is the normal path. A hard delete is permitted **only** for a question that has never been published (`publishedAt` is null) and requires the separate `questions:delete` permission.

### Breaking change — pre-Milestone-4 documents

The rewrite is **not** backward compatible: `subject` went from `String` to `ObjectId`, `topic` did not exist, `options` went from `[String]` to subdocuments, and `correctAnswer` is gone. A `String` where the schema now declares an `ObjectId` makes Mongoose throw a **cast error on read**, so a legacy document is unreadable through the model — the "required on create only" approach used for the Milestone 4 `Student` fields cannot rescue it.

Every document that could exist was produced by the old template generator and was never real content, and nothing references questions yet (`ExamAttempt` / `Result` are still unwired), so there is nothing of value to preserve. Run `npx tsx scripts/migrate-questions.ts` to report them, then re-run with `--delete` to remove them. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

---

## `Exam` (Milestone 13) — ACTIVE

The **official Olympiad sitting** — a fourth kind of paper, distinct from practice, mock tests and the daily challenge.

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | String | yes | ≤ 200 chars. |
| `examCode` | String | yes | **Unique**, uppercase, e.g. `AMIT-2026-C9`. Printed on every certificate for this sitting. |
| `classLevel` | String enum | yes | Indexed. A student may only sit their own class's paper. |
| `questions[]` | subdocs | — | `{ question, order, marks, negativeMarks }` — the paper's marks, not the bank's. |
| `durationMinutes` | Number | yes | 1–600. |
| `totalMarks` | Number | yes | Sum of `questions[].marks`, written by the service. |
| `opensAt` / `closesAt` | Date | **both yes** | The announced window. Mandatory here, unlike `MockTest`'s nullable pair: the organisers announce the timeline in advance, so an exam with no window is not an exam. |
| `status` | String enum | no | `draft` / `published` / `archived`, indexed. |
| `resultsPublishedAt` / `resultsPublishedBy` | Date \| String | no | Set when results are released. Until then no student sees a score, a rank or a certificate. |
| `meritThresholdPercent` | Number | yes | Default 60. **Per-exam**, because papers differ in difficulty. |
| `distinctionThresholdPercent` | Number | yes | Default 85. Validation refuses a value below merit. |

Indexes: `{status, classLevel, opensAt}` (the student listing) and `{status, createdAt: -1}` (the admin listing).

**Timing lives here; enforcement does not.** `ExamAttempt.expiresAt` is what actually holds the clock. See the Milestone 13 ADR.

---

## `ExamAttempt` (rewritten in Milestone 13) — ACTIVE

One student's **single** sitting. Previously declared-but-unused with a pre-Milestone-4 shape; see the breaking-change note below.

| Field | Type | Notes |
|---|---|---|
| `exam` / `student` | ObjectId | Both indexed. |
| `status` | String enum | `in_progress` / `submitted`. **No `expired`** — a paper whose time ran out is finished, not void. |
| `questions[]` | `attemptAnswer` subdocs | The paper as served, each carrying its own **answer-key snapshot**. |
| `totalQuestions` / `maxMarks` / `durationMinutes` | Number | Snapshotted at serve time. |
| `score` / `correctCount` / `incorrectCount` / `unansweredCount` / `accuracy` | Number | Written once at submission. `score` **may be negative** where negative marking applies. |
| `startedAt` / `expiresAt` / `submittedAt` | Date | `expiresAt` is computed once and **never recomputed**. |
| `timeTakenSeconds` | Number | Clamped by the deadline. |
| `submissionReason` | String enum \| null | `manual` / `time_expired`. |

**Unique index on `{exam, student}`** — this is what makes "one attempt, ever" true in the database rather than intended by a handler that counts first. Plus `{exam, status, score: -1}` for ranking.

### Breaking change — the previous shape

The old version keyed on a string `studentId`, stored `answers` as `{ questionId, selectedOption, isCorrect }`, and had **no answer-key snapshot**. It could not be marked by the grader this codebase now has, and could not survive a question being edited after a paper was served. **Nothing had ever written a document**, so there was nothing to migrate.

---

## `Result` (rewritten in Milestone 13) — ACTIVE

A **published** result. Created by the publication step, not by submission.

| Field | Type | Notes |
|---|---|---|
| `exam` / `student` / `attempt` | ObjectId | |
| `score` / `maxMarks` / `percentage` / `accuracy` | Number | Copied from the attempt so a result reads standalone. `percentage` is the basis for a certificate tier. |
| `rank` | Number | Within this exam's submitted attempts. **Equal scores share a rank** (1, 2, 2, 4), the same rule the leaderboard uses. |
| `totalCandidates` / `percentile` | Number | **Cohort facts** — true only relative to a particular set of candidates at a particular moment, so stored once at publication rather than recomputed on every read. |
| `isPublished` | Boolean | Indexed. Gates every student-facing read. |
| `publishedAt` / `publishedBy` | Date \| String | |

Unique index on `{exam, student}` — republishing updates the row rather than adding one.

**Why this exists when the attempt already has the score**: a score exists the moment a paper is graded, but a *result* is an announcement. Ranks cannot be computed until the window has closed, and the organisers decide when to release them. An attempt with no `Result` is a paper sat and not yet announced — a real and common state.

---

## `Certificate` (Milestone 13) — ACTIVE

| Field | Type | Notes |
|---|---|---|
| `certificateId` | String | **Unique.** Readable serial, `AMIT-CERT-2026-000123`. A reference, not a secret. |
| `verificationCode` | String | **Unique.** 16 symbols of `crypto` randomness in four groups. What public verification keys on. |
| `student` / `exam` / `result` | ObjectId | For administration and joins — **never for rendering.** |
| `tier` | String enum | `participation` / `merit` / `distinction`, indexed. |
| `studentName`, `studentIdLabel`, `classLevel`, `schoolName`, `examTitle`, `examCode`, `score`, `maxMarks`, `percentage`, `rank`, `totalCandidates`, `meritThresholdPercent`, `distinctionThresholdPercent` | — | **The snapshot.** Frozen at issuance. |
| `issuedAt` / `issuedBy` | Date \| String | |
| `revokedAt` / `revokedBy` / `revokedReason` | — | Revocation never deletes the row. |

Unique index on `{student, exam}`, which makes issuance **idempotent**: republishing results cannot produce a second certificate for the same sitting. Plus `{issuedAt: -1}` for the admin listing.

**Everything printable is duplicated on purpose and must not be "normalised away".** A certificate is a statement about a moment. Rendered from live joins, correcting a name would silently reissue every certificate a student holds with different text, and re-tuning a threshold would change what an old certificate claims. See the Milestone 13 ADR.

---

## `StudentAnalytics` — **REMOVED in Milestone 15**

Deleted, not migrated. It held per-student rolled-up performance metrics and "AI insight" strings, and **nothing ever wrote it** — it survived ten milestones as a read path over an empty collection.

Three reasons it went rather than being filled in:

- **It predated Milestone 4 and was the wrong shape.** `studentId` was a plain `String`, and `topicMetrics[].topicName` was **free text** with no reference to the `Topic` collection — so a topic rename would have silently orphaned a student's history, and two subjects with a same-named topic were indistinguishable.
- **A stored breakdown can drift from the answers behind it.** That is the same argument that keeps XP, levels, streaks and the leaderboard derived; analytics over attempt data is the same case, and it would additionally have needed invalidating on every submission from four different services.
- **Its `aiInsights` field was a documented bug.** `generateAIInsights()` mutated it in memory on every read and never saved, which was harmless only because the branch was unreachable. Both the field and the function are gone; strengths and weaknesses are now derived facts rather than generated prose, and nothing in the product claims to be AI.

Analytics are now computed on read by `services/analyticsService.ts`. There is **no analytics collection**. See "Analytics aggregations" below, and the Milestone 15 ADR in [`DECISIONS.md`](DECISIONS.md).

---

## `RefreshToken` — ACTIVE (added in Milestone 2)

Purpose: one document per issued refresh token. This collection is what makes sessions revocable.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `tokenHash` | String | **yes** | — | `unique`. **SHA-256 of the token; the raw value is never stored**, so a database leak yields no usable sessions. SHA-256 rather than bcrypt because these are 256 bits of randomness, not guessable passwords — there is nothing to brute-force and lookups must be fast. |
| `student` | ObjectId → `Student` | **yes** | — | Indexed. A real reference, unlike the legacy `studentId` strings. |
| `familyId` | String (UUID) | **yes** | — | Indexed. Shared by every token descended from one login, so a whole lineage can be revoked at once. |
| `expiresAt` | Date | **yes** | — | TTL index (`expireAfterSeconds: 0`) — MongoDB deletes expired rows itself, so no cleanup job is needed. |
| `revokedAt` | Date \| null | no | `null` | Set by logout, logout-all, password reset, or rotation. |
| `replacedByHash` | String \| null | no | `null` | Hash of the token that superseded this one. Its presence marks the token as already rotated, which is how reuse is detected. |
| `userAgent` | String | no | — | Audit context only. |
| `ip` | String | no | — | Audit context only. |
| `createdAt` | Date | no | `Date.now` | |

**Rotation and theft detection**: every refresh issues a new token, marks the old one revoked, and links the two. Presenting an already-rotated token means two parties hold the same credential — almost always theft or a replay — so the entire `familyId` is revoked, forcing a fresh login.

---

## `VerificationToken` — ACTIVE (added in Milestone 2)

Purpose: single-use, expiring tokens emailed to a student, for both email verification and password reset.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `tokenHash` | String | **yes** | — | `unique`. SHA-256 only; the raw token exists solely in the email that was sent. |
| `student` | ObjectId → `Student` | **yes** | — | Indexed. |
| `type` | String enum | **yes** | — | `email_verify` (24h) or `password_reset` (30 min). |
| `expiresAt` | Date | **yes** | — | TTL index (`expireAfterSeconds: 0`). |
| `usedAt` | Date \| null | no | `null` | Makes each token strictly one-shot. Consumed via `findOneAndUpdate` filtered on `usedAt: null`, so two concurrent redemptions cannot both succeed. |
| `createdAt` | Date | no | `Date.now` | |

Issuing a new token of a given type marks any outstanding token of that same type as used, so only the newest link in an inbox works.

---

## `AuditLog` — ACTIVE (added in Milestone 3)

Purpose: the administrative audit trail — who did what, to whom, when, and whether it was allowed.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `action` | String enum | **yes** | — | Closed list: `user.role.changed`, `student.status.changed`, `questions.generated`, `admin.session.started`, `authz.denied`. A closed list keeps the trail queryable; a free-text action would drift into unsearchable variants. |
| `actorRole` | String enum | **yes** | — | The role held **at the time**, one of `student` / `admin` / `superadmin`. Not looked up later, so history stays true after a demotion. |
| `actor` | ObjectId -> `Student` \| null | no | `null` | Indexed with `createdAt`. `null` for the env root administrator, which has no document. |
| `actorLabel` | String | **yes** | — | Denormalised, human-readable actor: `AMIT_xxxx` for an account-backed actor, the sign-in email for the root admin. Denormalised so an entry still reads correctly if the account is later deleted. |
| `targetType` | String enum | **yes** | — | `student` / `question` / `route` / `system`. |
| `targetId` | String \| null | no | `null` | The human-facing identifier acted upon — a `studentId`, or the request path for a refusal. |
| `targetLabel` | String \| null | no | `null` | Secondary descriptor, e.g. the target's email. |
| `outcome` | String enum | no | `'success'` | `success` or `denied`. |
| `metadata` | Mixed | no | — | Action-specific detail, e.g. `{ from: 'student', to: 'admin', reason: '...' }` for a role change, or `{ method, role, missing }` for a refusal. |
| `ip` | String \| null | no | `null` | |
| `userAgent` | String \| null | no | `null` | |
| `createdAt` | Date | no | `Date.now` | |

Indexes: `{ createdAt: -1 }`, `{ action: 1, createdAt: -1 }`, `{ actor: 1, createdAt: -1 }` — newest-first is the only order the admin UI offers, and the compound indexes back its action and actor filters.

**Deliberately no TTL index**, unlike `RefreshToken` and `VerificationToken`: an audit trail that silently deletes itself is not an audit trail. Retention is therefore unbounded; bounding it would be a policy decision for [`DECISIONS.md`](DECISIONS.md).

**Refusals are recorded on purpose.** An authenticated caller denied a privileged permission produces an `authz.denied` row, because a run of those against one account is what a privilege-escalation attempt looks like — invisible if only successes were stored. Only *authenticated* callers produce rows, so an unauthenticated flood cannot inflate the collection. Writes are best-effort: a failed audit write is logged at `error` level but never fails the action that had already completed (see [`DECISIONS.md`](DECISIONS.md)).

---

## `StudentActivity` — ACTIVE (added in Milestone 5)

Purpose: the append-only log of real student events. It is the **single source of truth for XP, levels, streaks and achievements** — none of those is stored anywhere else, and there is deliberately no progress-counter document (see [`DECISIONS.md`](DECISIONS.md)).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `student` | ObjectId -> `Student` | **yes** | — | Indexed with `createdAt` and with `occurredOn`. |
| `type` | String enum | **yes** | — | Closed list: `account_created`, `email_verified`, `daily_visit`, `profile_updated`, `photo_updated`, `password_changed`. Closed so nothing can quietly start awarding XP for an event nobody defined. |
| `xpAwarded` | Number | **yes** | — | What the event was worth **at the time**, copied from `XP_AWARDS` in `lib/xp.ts` at write time rather than looked up on read, so re-pricing an event later cannot silently restate what students already earned — the same reasoning as `AuditLog.actorRole`. Min 0. |
| `occurredOn` | String | **yes** | — | The competition-local calendar day, `YYYY-MM-DD`, from `lib/competitionDay.ts`. **IST, not UTC** — see the ADR. This is what the streak is computed from. |
| `dedupeKey` | String \| *absent* | no | — | Uniqueness token: `'once'` for a once-per-account type, the day key for a once-per-day type, and **genuinely absent** for a repeatable type. Absent rather than `null`, because the unique index below is partial on its *existence* — a stored `null` would make every repeatable event collide with the previous one. |
| `detail` | String \| null | no | `null` | Short human-readable detail for the feed, e.g. `Class 9 → Class 10`. |
| `createdAt` | Date | no | `Date.now` | |

Indexes:
- `{ student: 1, createdAt: -1 }` — the feed, newest first.
- `{ student: 1, occurredOn: -1 }` — backs the `distinct('occurredOn')` query the streak derives from.
- `{ occurredOn: -1 }` — **added in Milestone 10** for the period leaderboards, which narrow the whole collection to a window of competition days before grouping. The compound index above cannot serve them, because those queries have no `student` in the filter at all.
- `{ student: 1, type: 1, dedupeKey: 1 }` — **unique, partial** on `{ dedupeKey: { $exists: true } }`.

That partial unique index is what makes "once per day" and "once per account" true rather than merely intended. `recordActivity()` inserts and treats a duplicate-key error as "already counted", which is race-free in a way a read-then-write check across two serverless invocations would not be. It must be *partial* rather than plain (a plain unique index would forbid a student from ever editing their profile twice) and cannot be `sparse` (sparse skips only documents missing *every* indexed field, and these always have `student` and `type`).

**Deliberately no TTL index**, like `AuditLog` and unlike the two token collections: expiring a row would silently take XP away from a student who earned it.

**Writes are best-effort.** `recordActivity()` never throws — a failed log write must not fail the registration or password change it describes. The trade-off is that a lost write costs that event's XP, and shows up as an `error`-level log line (see [`DECISIONS.md`](DECISIONS.md)).

**This collection also backs every leaderboard.** Milestone 10 added scoped and periodised boards and a Hall of Fame **without adding a model**: a board is an aggregation over these rows joined to `Student`, so a standing cannot drift from the XP totals it claims to rank — it *is* those totals. There is still no `Leaderboard` collection, deliberately (see [`DECISIONS.md`](DECISIONS.md)). One consequence worth knowing when reading a board: the tie-break that orders equal-XP students is `$max` of `createdAt` over the rows counted in the window, so it means "when this student's counted total stopped changing", not "when they registered".

**Accounts created before Milestone 5 have no rows**, so they read as 0 XP with an empty feed. `backend/scripts/backfill-activity.ts` writes the `account_created` row — and, where `isEmailVerified` is genuinely true, `email_verified` — from facts already on the `Student` document, dated from its real `registeredAt`. It deliberately does **not** invent `daily_visit` rows, so nobody is handed a streak they did not keep. Idempotent; see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

---

## `GalleryItem` (Milestone 12) — ACTIVE

Photographs of real olympiad events, shown on the **public** gallery page.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `title` | String | yes | — | ≤ 150 chars. |
| `caption` | String \| null | no | `null` | ≤ 500 chars. |
| `eventDate` | Date \| null | no | `null` | When the event happened, not when the row was created. Nullable — not every photo has a known date. |
| `contentType` | String | yes | — | `image/jpeg`, `image/png` or `image/webp`. |
| `size` | Number | yes | — | Decoded byte length. |
| `data` | Buffer | yes | — | **`select: false`.** The admin listing pages twelve at a time; without the exclusion every page load would drag twelve megabytes of image bytes into memory to render a table of titles. One dedicated route opts back in with `+data`. |
| `status` | String enum | no | `'published'` | `published` / `archived`, indexed. Archiving stops the **bytes** being served too, not just the listing — otherwise anybody holding the URL would still see a taken-down photo. |
| `displayOrder` | Number | no | `0` | Ascending. Staff decide what leads, because "most recently uploaded" is not "best photo of the event". |
| `uploadedBy` | ObjectId \| null | no | `null` | → `Student`. |
| `uploadedByLabel` | String \| null | no | `null` | Denormalised, so the row still reads if the uploader's account is later removed. |
| `createdAt` / `updatedAt` | Date | — | now / `null` | |

Index: `{ status, displayOrder, createdAt: -1 }` — exactly the public page's query.

**Storage budget, because it is real and countable.** Images are capped at **1 MB** each (a quarter of a registration photo's 2 MB) and validated by magic bytes through the shared `imageDataUrl()` validator. Atlas's free tier is **512 MB in total**; registration photos already cap the roll near 250 students, and gallery images are bounded by nothing but staff enthusiasm — a hundred of them is ~100 MB, a fifth of the tier. This is the **second** thing that will force a paid tier or an image CDN. See the Milestone 12 ADR.

---

## `Notification` (Milestone 12, extended in Milestone 14) — ACTIVE

An in-app notification: either an announcement written by staff, or a notice generated from a real event. **In-app is the channel; email is an escalation of some of them** (see `EmailOutbox`) — nothing about email is stored here, because "what we told them" and "whether the SMTP handshake worked" are different facts with different lifetimes.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `title` | String | yes | — | ≤ 150 chars. |
| `body` | String | yes | — | ≤ 2000 chars. May contain newlines; the UI renders it with `white-space: pre-line` as a plain text node. |
| `kind` | String enum | no | `'announcement'` | `announcement` / `alert`. |
| `audience` | String enum | no | `'all'` | `all` / `class` / **`student`**, indexed. |
| `classLevel` | String enum \| null | no | `null` | Set only when `audience` is `class`; validation refuses `class` without one. |
| `student` | ObjectId \| null | no | `null` | **Milestone 14.** Set only when `audience` is `student`. → `Student`. |
| `source` | String enum | no | `'staff'` | **Milestone 14.** `staff` / `system`, indexed. A `system` row **cannot be edited** (409). |
| `event` | String \| null | no | `null` | **Milestone 14.** The `SystemEvent` code for a generated row; null for anything a human wrote. |
| `link` | String \| null | no | `null` | **Milestone 14.** A **relative** in-app path (`/result`). Relative on purpose: an absolute URL on thousands of rows would still point at the old host after a domain change. |
| `dedupeKey` | String \| null | no | `null` | **Milestone 14.** Partial-unique. |
| `isPublished` | Boolean | no | `false` | Indexed. Unpublished is a **draft** — invisible to students, editable by staff. A `system` row is published on creation; there is no draft state for something that already happened. |
| `publishedAt` | Date \| null | no | `null` | Stamped at **publication**, not creation, so a draft written last week and published today sorts as today's news. |
| `createdBy` / `createdByLabel` | ObjectId \| String \| null | no | `null` | `createdByLabel` is `'System'` for a generated row. |

Indexes:
- `{ isPublished, publishedAt: -1 }` — a student's inbox is "published, addressed to me, newest first".
- `{ student, publishedAt: -1 }` — the personal half of an inbox.
- **partial unique** on `dedupeKey` (where it is a string) — what makes "post this notice once" true in the database rather than intended by the caller. Releasing an exam's results is an idempotent administrative action that a nervous administrator *will* click twice, and the second click must not tell every candidate their results are out again. Partial, so the many rows with no key do not all collide on `null`.

**Nothing is fanned out.** A notification is **one document** carrying an audience *rule*, and each student's inbox is that rule evaluated at read time by `inboxFilter()`. Publishing to the whole roll writes one document rather than thousands, and a student who registers tomorrow sees the announcement written today — which is what a notice board does, and what a publish-time fan-out would silently get wrong. See the Milestone 12 ADR.

**`audience: 'student'` is system-only.** The staff composer's schemas accept `STAFF_AUDIENCES` (`all`, `class`) only, so it is unreachable from any API a human drives. A per-student notice carries a score, a rank and a certificate tier, so a filter that leaked one row across the class boundary would be a disclosure bug rather than a display bug. `inboxFilter()` is the single definition of visibility, shared by the inbox, the unread count and `isVisibleTo()` — three readers that must not be able to disagree. See the Milestone 14 ADR.

---

## `NotificationRead` (Milestone 12) — ACTIVE

That one student has read one notification.

| Field | Type | Required | Notes |
|---|---|---|---|
| `notification` | ObjectId | yes | → `Notification`. |
| `student` | ObjectId | yes | → `Student`. |
| `readAt` | Date | no (default now) | |

**Unique index on `{ student, notification }`.** This is what makes "mark as read" idempotent: a double-tapped button, a replayed request or two open tabs cannot create two rows. A separate collection rather than an array on the notification, because an announcement to every student would grow an unbounded `readBy` inside a single 16 MB document and marking one read would rewrite the whole thing.

---

## `EmailOutbox` (Milestone 14) — ACTIVE

One outbound email, persisted **before** anything tries to send it. This is the whole email queue; see `services/emailOutbox.ts`.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `to` | String | yes | — | |
| `subject` / `text` / `html` | String | yes | — | The rendered message, built once at enqueue time. |
| `category` | String enum | yes | — | `transactional` / `security` / `announcement` / `results`. The first two always send; the last two are switchable per student. |
| `student` | ObjectId \| null | no | `null` | → `Student`. Null for a message to a bare address. |
| `status` | String enum | no | `'pending'` | `pending` / `sent` / `failed`, indexed. `pending` covers both "never tried" and "tried, failed, due again". |
| `attempts` | Number | no | `0` | Incremented **by the claim**, so it reflects the attempt in flight. |
| `maxAttempts` | Number | no | `4` | |
| `nextAttemptAt` | Date | no | now | When the row may next be claimed — **and** the visibility timeout while in flight. |
| `lastAttemptAt` | Date \| null | no | `null` | |
| `lastError` | String \| null | no | `null` | The provider's own message, truncated to 500 chars, shown in the delivery console. |
| `sentAt` | Date \| null | no | `null` | |
| `dedupeKey` | String \| null | no | `null` | Application-level idempotency, e.g. `results:<examId>:<studentId>`. Partial-unique. |

Indexes:
- `{ status, nextAttemptAt }` — the drain's only query: what is pending and due, oldest deadline first.
- **partial unique** on `dedupeKey` (where it is a string) — so releasing the same exam's results twice cannot email the cohort twice. Partial is essential here: a verification email genuinely may be requested again, so the many keyless rows must not collide on `null`.
- `{ createdAt: -1 }` — the admin delivery view.

**Why there is no `sending` status.** A row is claimed by pushing `nextAttemptAt` into the future and incrementing `attempts` in the same conditional write — a visibility timeout, not a state change. A separate `sending` state would be a lie the moment a serverless container is frozen or recycled mid-send: the row would sit in `sending` for ever with nothing to move it, and the message would never arrive. With a timeout, a crashed attempt simply becomes due again. The honest consequence is **at-least-once** delivery.

**Deliberately no TTL**, like `AuditLog`. A delivery record is the evidence for "we did tell them", and for a competition that issues certificates and refuses late submissions that evidence is worth more than the bytes. Rows are a few KB and bounded by real events rather than by traffic.

---

## `Student.notificationPrefs` (Milestone 14) — an embedded subdocument

Not a model. Two booleans on the `Student` document:

| Field | Type | Default | Notes |
|---|---|---|---|
| `announcements` | Boolean | `true` | Email me when staff post an announcement. |
| `results` | Boolean | `true` | Email me when an official exam result is released. |

**These control email only, never the in-app inbox.** Everything is always written, so declining an email never costs a student the message — and read state would become meaningless if rows could be suppressed at write time, because "unread" and "never delivered" would be indistinguishable.

**Only the optional categories appear here.** There is no switch for `transactional` or `security`; those are absent from the update schema rather than ignored by the handler. Embedded rather than given its own collection because it is one small object per account, always wanted alongside the account, and never large.

The object itself has **no schema-level default**, so a pre-Milestone-14 document genuinely has none. `resolvePrefs()` is the single place a missing object is interpreted, and treats it as all-on — which is what those students were already receiving.

Deliberately **no TTL** — unlike the two token collections. Expiring a row would make a notification the student has already read reappear as unread, which reads as a bug rather than as tidying.

"Unread" is therefore an **anti-join** (`_id: { $nin: readIds }`), not a filter — which is why the inbox and the unread count share one `inboxFilter()`, so the number on the bell cannot disagree with the list.

---

## `GenerationLog` (Milestone 18, extended in Milestone 20) — ACTIVE

Purpose: one record of **asking a model for questions** — what was asked, what came back, and what survived. Written by `services/questionGeneratorService.ts`; read by `approveQuestions()` to recover provenance, and by whoever is diagnosing a bad prompt.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `actor` / `actorLabel` | ObjectId → `Student` \| null / String | no / **yes** | `null` / — | Who asked. |
| `purpose` | String enum | **yes** | — | `question_bank` / `mock_test` / `daily_challenge`, so cost can be attributed to a feature. |
| `generatorId` / `generatorKind` / `modelName` | String | **yes** | — | Which provider and **which model was actually called** — an examiner may have picked one for the batch, and a log naming the configured default while a different model wrote the questions is worse than no log. |
| `subject` / `chapters` | ObjectId / [ObjectId] | no | `null` / `[]` | What was asked for. |
| `classLevel` / `difficulty` / `questionType` / `language` | String | **yes** | — | |
| `bloomLevel` | String \| null | no | `null` | |
| `requested` | Number | **yes** | — | |
| `hadInstructions` | Boolean | no | `false` | **Whether** the examiner typed a steer, never what they typed. |
| `status` | String enum | **yes** | — | `succeeded` / `failed`. A failed generation writes a row too. |
| `returned` | Number | no | `0` | Candidates the model produced, before any checking. |
| `accepted` | Number | no | `0` | Passed validation and survived duplicate detection. |
| `rejected` / `rejectionReasons` | Number / [String] | no | `0` / `[]` | Failed `createQuestionSchema`, with up to ten reasons, so a bad prompt is diagnosable. |
| `duplicates` | Number | no | `0` | Refused as too similar to an existing question or to another candidate. |
| `approved` | Number | no | `0` | How many the examiner went on to approve. Written by the approval call. |
| `rejectedByReviewer` | Number | no | `0` | **Milestone 20.** How many the examiner threw away themselves. |
| `durationMs` | Number | no | `0` | |
| `error` | String \| null | no | `null` | The provider's own message when `status` is `failed`. **Never a key** — every message is scrubbed first. |
| `createdAt` / `updatedAt` | Date | auto | — | |

Indexes: `createdAt`, `status + createdAt`.

**Why this is separate from `AuditLog`.** The audit trail answers "who did what to the bank", and it already records an approval as `questions.generated`. This answers a different question: **"why did the generator behave like that?"** Those are debugging and cost facts, not administrative ones — and a *failed* generation, which writes a row here, is not an administrative act at all.

**`rejected` and `rejectedByReviewer` are both needed and they mean different things.** The first counts candidates that broke a rule; the second counts candidates that were perfectly valid and simply not worth keeping. The second is the far commoner failure, it is the honest measure of whether a prompt configuration works, and nothing else in the system would ever have noticed it — which is why `POST /admin/generate-questions/reject` exists despite having nothing to delete.

**It stores counts and parameters, never question text.** Candidates are either approved (and then live in `Question`, with their own history) or discarded — and keeping rejected model output indefinitely would be storing unreviewed machine text for no reader.

**No TTL**, for the reason `AuditLog` and `StudentActivity` have none: this is the evidence for "a model produced this, on this date, from this prompt configuration". A question in the bank can be traced back to the run that proposed it years later, which is exactly the question somebody will eventually ask about machine-written exam content.

---

## `Payment` (Milestone 19) — ACTIVE

One row per Razorpay **order**, created before any money moves and updated as it settles. Written by `services/paymentService.ts` only.

| Field | Type | Notes |
|---|---|---|
| `student` | `ObjectId` → `Student` | Required. The row is what entitles this account, so it can never be absent. |
| `purpose` | `String` enum | `olympiad_entry` today; the enum exists so a second purchasable thing does not need a second collection. |
| `amount` | `Number` | **Integer paise**, min 100. Never rupees, never a float — money in a floating-point type is a rounding bug waiting for a total. Every display divides by 100 at the edge. |
| `currency` | `String` | Default `INR`. |
| `razorpayOrderId` | `String` | **Unique.** One row per order, which is what makes capture and webhooks idempotent. |
| `razorpayPaymentId` | `String \| null` | `pay_…`. Absent until a payment is attempted against the order. |
| `razorpaySignature` | `String \| null` | Set only once verified server-side. **Never returned to any client** — it is derived from the secret, so publishing it would be an oracle for whether an order/payment pair is genuine. |
| `status` | `String` enum | `created` → `attempted` → `captured` / `failed`, plus `refunded`. |
| `statusSource` | `String \| null` | `checkout_verify` or `webhook` — which path last moved it. Both happen, and knowing which is what makes a support question answerable. |
| `failureReason` | `String \| null` | Razorpay's own text, verbatim, capped at 300 characters. |
| `method` | `String \| null` | card / upi / netbanking, as reported. Display only. |
| `capturedAt` | `Date \| null` | When the money was confirmed taken. The entitlement's effective date. |

**Indexes**: `{student, purpose, status}` (THE entitlement query — it runs on every gated request), `{student, createdAt: -1}` (the student's own history), `{status, createdAt: -1}` (the admin console).

**No TTL**, like `AuditLog` and `StudentActivity`. A payment record is financial evidence — that somebody paid, when, how much, and what it entitled them to. Expiring one would delete the proof of a transaction a student can be asked about years later.

**`amount` is a snapshot.** Changing the fee never re-prices a captured payment, exactly as `StudentActivity.xpAwarded` records what an event was worth at the time.

---

## `PaymentSettings` (Milestone 19) — ACTIVE

The fee, as a single administrator-editable document. Pinned by a unique index on a constant `key: 'default'`, the same pattern `RewardSettings` uses, so two concurrent saves cannot produce two settings documents that disagree about the price.

| Field | Type | Notes |
|---|---|---|
| `key` | `String` | Constant `'default'`, unique. |
| `olympiadEntryFee` | `Number` | Integer paise. Default **10 000 (₹100)**. `min: 100` mirrors Razorpay's own floor — an order below one rupee is refused by their API, so accepting it here would only move the failure later. |
| `currency` | `String` | Default `INR`. |
| `entryFeeEnabled` | `Boolean` | Default **`true`** since 2026-08-16. Turning it off admits every student to everything. |
| `updatedByLabel` | `String \| null` | Who last saved it. The `AuditLog` entry carries the before-and-after values. |

**Until somebody saves one, the code defaults apply** — there is nothing to seed and nothing to migrate. Note the consequence: a fresh database gates everything, because `entryFeeEnabled` reads as `true` when absent. That is deliberate (a paywall nobody remembered to switch on is not a paywall) and is recorded in [`DECISIONS.md`](DECISIONS.md).

**The fee is not an environment variable.** It is business configuration, not a credential: in `.env` it would be a redeploy to change, unchangeable by the person who decides it, and would leave no record of who changed it or when.

---

## The entitlement — derived, with no collection behind it

There is **no entitlement record and no `hasPaid` field on `Student`.** "May this student practise, rehearse, answer the daily challenge or sit the Olympiad?" is:

```
Payment.exists({ student, purpose: 'olympiad_entry', status: 'captured' })
```

…returning `true` unconditionally when `entryFeeEnabled` is off. This is the same discipline that keeps XP, levels, streaks, the leaderboard and analytics derived, applied where being wrong is worst: a stored boolean is a second source of truth about money, and when it drifts, either somebody who paid is refused or somebody who did not is admitted.

Reached through `middleware/requireEntry.ts` rather than called directly by routes, so no surface can be added that forgets to ask.

---

## Models Planned But Not Implemented

Based on the UI's implied needs (see [`FEATURE_STATUS.md`](FEATURE_STATUS.md)), there are no known missing models. `Exam` and `Certificate` were the last two on this list and both landed in Milestone 13. (`AdminAuditLog` was on this list and is now implemented as `AuditLog`; `Leaderboard` is on it no longer — Milestone 5 derives the standing by aggregating `StudentActivity` rather than storing it.) None of these should be added without a corresponding [`DECISIONS.md`](DECISIONS.md) entry and a matching [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) update.

## Note for whoever implements exam submission

`ExamAttempt` and `Result` are still **DEAD** (declared, unwritten), and they predate Milestone 4's `Question` rewrite: `ExamAttempt.studentId` is a `String`, its `answers[].selectedOption` a `String` rather than an option `key`, and `Result.examId` a free-text string with no exam entity behind it. They will need rewriting, not merely wiring.

One coupling to know about now: `progressService.getRecentExamPerformance()` — which powers the dashboard's "recent test performance" panel, currently and truthfully empty — queries `ExamAttempt.find({ studentId, status: 'Submitted' })` using the **human-facing `AMIT_xxxx` id**, because that is what the field is typed as. Whoever implements submission must either write that same value or change that one query.

---

## `PracticeSession` (Milestone 6)

Self-directed practice. **Deliberately not `ExamAttempt`** — see the ADR in [`DECISIONS.md`](DECISIONS.md): practice is unlimited and must never influence a ranking, and sharing a collection would mean every query about official performance had to remember to exclude it.

| Field | Type | Notes |
|---|---|---|
| `student` | ObjectId → `Student` | Indexed with `startedAt` for the history listing. |
| `status` | `in_progress` \| `submitted` \| `abandoned` | Only `submitted` may reveal answers. |
| `filters.subject` / `.topic` | ObjectId, nullable | What the student chose; null means "all". |
| `filters.difficulty` | `Easy` \| `Medium` \| `Hard`, nullable | Optional narrowing. |
| `filters.classLevel` | ClassLevel | The student's **own** class at start time. Never client-supplied. |
| `questions[]` | subdocument, `_id: false` | One per served question — see below. |
| `totalQuestions` | Number, min 1 | A session with no questions is refused at creation. |
| `maxMarks` | Number | Sum of the served questions' marks. |
| `score` | Number | Sum of awarded marks. **May be negative** under negative marking. |
| `correctCount` / `incorrectCount` / `unansweredCount` | Number | Written at submission. |
| `accuracy` | Number | Correct as a percentage of **answered**, not of served. |
| `startedAt` / `submittedAt` | Date | |
| `timeTakenSeconds` | Number | Start to submission, computed server-side. |

### `questions[]` — the answer-key snapshot

Each entry holds `question` (ref), `revision`, `type`, `marks`, `negativeMarks`, then **a copy of the answer key as it was when served**: `correctOptionKeys`, `booleanAnswer`, `numericAnswer`, `tolerance`. Then the student's response (`selectedOptionKeys`, `numericResponse`, `booleanResponse`, `answeredAt`) and the grading outcome (`isCorrect`, `awardedMarks`).

The snapshot exists because an author may edit or archive a question mid-session; grading against the live document would mark a student against a question they never saw, and a changed answer *shape* would fail outright. `revision` lets the review say "this question has been edited since you answered it".

**Consequence to respect:** the answer key now lives in a second collection. Nothing may project these fields before submission — `services/practiceService.ts` builds two explicit views for exactly that reason, and `sessionReviewView()` throws on an unsubmitted session.

No TTL, like `StudentActivity` and `AuditLog`: a practice history is a record of work the student did.

---

## `MockTest` (Milestone 7) — ACTIVE

A staff-authored, timed paper. **Deliberately neither a `PracticeSession` nor an `ExamAttempt`** — see the ADR in [`DECISIONS.md`](DECISIONS.md): practice is self-chosen and untimed, the official Olympiad is one ranked national sitting, and a mock test is an authored paper sat a fixed number of times.

| Field | Type | Notes |
|---|---|---|
| `title` | String, ≤200 | |
| `description` | String, ≤2000, nullable | One line, shown in the student's list. |
| `instructions` | String, ≤5000, nullable | Shown before starting. Plain text with LaTeX islands, rendered through `MathText` like a question. |
| `classLevel` | ClassLevel, indexed | A student may only sit their own class's tests. |
| `questions[]` | subdocument, `_id: false` | `{ question → Question, order, marks, negativeMarks }`. **The marks are the test's, not the bank's** — the same question may be worth 2 on a quiz and 6 on a final. `order` is stored explicitly so a reorder is data rather than array position. |
| `durationMinutes` | Number, 1–600 | |
| `totalMarks` | Number | **Computed by the service** on every save, never accepted from a client. Stored rather than derived on read only because the student's list prints it for many tests at once. |
| `availableFrom` / `availableTo` | Date, nullable | Null means "as soon as published" / "open indefinitely". |
| `maxAttempts` | Number, 1–10, default 1 | |
| `resultDisplay` | `immediate` \| `after_close` \| `hidden` | When the **score** may be shown. |
| `reviewPolicy` | `immediate` \| `after_close` \| `never` | When the **answers** may be shown. Separate from the above on purpose. |
| `status` | `draft` \| `published` \| `archived`, indexed | `published` is the only status a student may sit; `STUDENT_VISIBLE_TEST_STATUSES` is the single place that is written down. |
| `createdBy` / `createdByLabel` / `updatedBy` / `updatedByLabel` | | As on `Question`. |
| `publishedAt` / `archivedAt` | Date, nullable | `publishedAt` is historical and deliberately retained after unpublishing — it is what the hard-delete guard tests. |

Indexes: `{status, classLevel, availableFrom}` for the student listing, `{status, createdAt}` for the admin one.

**Editing rules** live in `services/mockTestService.ts`, not in the schema: once the test has attempts, the question list, the per-question marks and `durationMinutes` are frozen (409), because results already recorded against the test would otherwise stop being comparable. Everything else stays editable for the life of the test.

---

## `MockTestAttempt` (Milestone 7) — ACTIVE

One student's sitting of one `MockTest`. Modelled on `PracticeSession` and adds the three things an assessment needs.

| Field | Type | Notes |
|---|---|---|
| `test` | ObjectId → `MockTest` | |
| `student` | ObjectId → `Student` | Ownership is always part of the query, never an after-the-fact check. |
| `attemptNumber` | Number, min 1 | Bounded by the test's `maxAttempts`. |
| `status` | `in_progress` \| `submitted` | **No `expired` status** — an attempt whose time ran out is graded exactly like a submitted one. It is finished, not void. |
| `questions[]` | shared `attemptAnswerSchema` | The same subdocument `PracticeSession` uses — see below. |
| `totalQuestions` / `maxMarks` | Number | |
| `durationMinutes` | Number | The duration in force when the attempt began, for the record. |
| `score` | Number | Sum of awarded marks. **May be negative.** |
| `correctCount` / `incorrectCount` / `unansweredCount` / `accuracy` | Number | Written at submission. Accuracy is over **answered**, not served. |
| `startedAt` | Date | |
| **`expiresAt`** | Date, required | **The authoritative deadline.** `startedAt + durationMinutes`, clamped to the test's `availableTo`. Written once at creation and never recomputed — an author changing the duration mid-paper must not move a finishing line somebody is already running at. |
| `submittedAt` | Date, nullable | Clamped to `expiresAt`: nothing can have happened after the deadline. |
| `timeTakenSeconds` | Number | Start to submission, server-computed. |
| `submissionReason` | `manual` \| `time_expired`, nullable | Why it closed. |

**Unique index on `{test, student, attemptNumber}`** — this is what makes "one attempt per sitting" true in the database rather than intended by the handler that counts them. Two requests racing to start cannot both create one; the loser resumes the winner's attempt. Plus `{student, startedAt}` for the history and `{test, status, score}` for the results table and the expiry sweep.

No TTL, for the same reason as `PracticeSession`: this is the record of an assessment a student actually sat.

**Disclosure is not snapshotted here.** The attempt records what happened; whether the student may *see* it is read from the test's `resultDisplay` / `reviewPolicy` at request time, so an administrator can release results after the window closes or withdraw a review released too early.

---

## `attemptAnswer` — a shared subdocument, not a model

`models/attemptAnswer.ts` holds `AttemptAnswerEntry` and `attemptAnswerSchema`: one served question, with the answer-key snapshot taken at serve time, the student's response, and the grade it earned. It is embedded by **both** `PracticeSession.questions` and `MockTestAttempt.questions`, and `PracticeQuestionEntry` is now an alias of it.

Fields: `question` (ref), `revision`, `type`, `marks`, `negativeMarks` — then the snapshot (`correctOptionKeys`, `booleanAnswer`, `numericAnswer`, `tolerance`), the response (`selectedOptionKeys`, `numericResponse`, `booleanResponse`, `answeredAt`), and the outcome (`isCorrect`, `awardedMarks`).

Shared because the alternative is two definitions of what counts as correct and, sooner or later, two graders that disagree — and a grader that disagrees with the answer key is a wrong score on a student's report. For the same reason there is exactly one implementation of the marking rules, in `services/grading.ts`, used by both collections.

**Consequence to respect, twice over:** the answer key now lives in *two* collections beyond `Question`. Nothing may project these fields before the attempt is finished and disclosure is permitted. `practiceService.ts` and `mockTestService.ts` each build explicit views and never return a raw document; `sessionReviewView()` throws on an unsubmitted session, and `attemptReviewView()` throws unless the attempt is submitted **and** the test's review policy currently allows it.

**Milestone 15 note:** `answeredAt` is the **stored materialisation of `isAnswered()`**. Every write path sets it as `isAnswered(entry) ? now : null`, including when an answer is *cleared*, so it records whether a response currently stands. The analytics aggregations read it rather than re-deriving the per-type rule in aggregation expressions — which would have been a second grader by another name. `isCorrect` is three-valued on a stored entry (`true` / `false` / **`null` for unanswered**, written by `gradeEntries()`), so correctness must be counted as an explicit `true`; `$ne: false` would count every blank as correct.

---

# Analytics aggregations (Milestone 15)

Performance analytics have **no collection of their own**. Everything is derived on read from the four attempt collections. This section documents the queries and the indexes they depend on, as required by `CLAUDE.md`.

## Student analytics — `services/analyticsService.ts`

**Eight operations per page load, all narrowed by `student`, all run in parallel.**

### 1–4. The faceted aggregation, once per surface

Run against `PracticeSession`, `MockTestAttempt`, `DailyChallengeAttempt` and `ExamAttempt`:

```
$match  { student, status: 'submitted' }        ← index: {student, status, submittedAt}
$project  entries: <answers array, or the single answer>
$unwind   $entries
$lookup   questions  (pipeline: $project topic, subject, difficulty)
$unwind   $question                             ← non-preserving: see below
$lookup   topics     (pipeline: $project name)
$lookup   subjects   (pipeline: $project name)
$group    _id: { topic, topicName, subject, subjectName, difficulty, type }
          served, answered, correct, marksAwarded, marksAvailable
```

Four properties are deliberate:

- **One pipeline per collection, not one per facet.** Grouping on the *composite* `{topic, subject, difficulty, type}` key means topic, subject, difficulty and type breakdowns are all sums over rows already in memory rather than four more round trips. Cardinality is bounded by the distinct combinations the student actually met — a question has exactly one of each — so it is a few dozen rows at most.
- **The `$lookup` projects three fields.** Without the inner `pipeline`, the join drags the whole question — text, options, solution and the **answer key** — through the pipeline for every answer the student has ever given.
- **The `$unwind` after the join is non-preserving.** A served question whose document has since been deleted cannot be attributed to a topic, and inventing an "Unknown" bucket would be a fabricated category. `overall.servedIncludingDeletedQuestions` is counted separately from the attempts, so the difference is visible rather than absorbed.
- **Only raw counts are grouped, never percentages.** Percentages are computed once at the end, from summed counts. Combining `1/1` and `1/9` therefore gives 20%, not the 55% an average of percentages would produce. There is a test.

### 5–8. Attempt-level reads

Four projected `find()`s, not aggregations — each attempt document already stores its own `score`, `maxMarks`, `correctCount`, `unansweredCount`, `accuracy` and `timeTakenSeconds`, written once by `gradeEntries()` at submission. Recomputing them from the embedded answers would be slower **and** could disagree with the score the student was shown.

These feed the progress trend, the pace trend and accuracy-by-day (bucketed into IST competition days in code, using `lib/competitionDay.ts`).

## Admin analytics — `services/questionAnalyticsService.ts`

**Question performance:** one `$unwind` + `$group by question` per attempt collection, merged in code by summing raw counts, then a single `Question.find({_id: {$in: eligible}})` to join names for the rows that survive the `minAnswered` floor. The join is at the **end** deliberately — joining inside the group stage would multiply the lookup by the number of times each question has been served.

**Test performance:** one `$group by test/exam` per attempt collection. It `$push`es the individual score percentages because a **median** cannot be accumulated the way a mean can, and a mean alone is misleading on a small cohort — one student who submitted a blank moves it several points, which is exactly the case an invigilator wants to see. Bounded by one paper's cohort.

## Indexes added in Milestone 15

| Collection | Index | Why |
|---|---|---|
| `ExamAttempt` | `{student: 1, status: 1, submittedAt: 1}` | **This collection had no index on `student` at all.** The unique `{exam, student}` index cannot serve a query naming a student without an exam, because `student` is not its prefix — so every "everything this student has sat" read was a full collection scan. The dashboard's exam panel takes the same path. |
| `MockTestAttempt` | `{student: 1, status: 1, submittedAt: 1}` | `{student, startedAt}` narrows to the student but then fetches and discards every unfinished attempt, and returns them ordered by *start* rather than by submission — the wrong sequence for a progress trend. |
| `PracticeSession` | `{student: 1, status: 1, submittedAt: 1}` | Same reason: `{student, status, startedAt}` narrows correctly but sorts by start time, which for a session left open overnight is a genuinely different order. |

`DailyChallengeAttempt` needed nothing new — `{student, day: -1}` already covers its read.

## The one rule that governs all of it

**Grading reads the snapshot; analytics joins the live taxonomy.** A mark is a historical fact about one paper, so `services/grading.ts` reads the answer-key snapshot on the attempt and never the live `Question` — absolutely. But "how am I doing in Trigonometry?" is a question about the taxonomy *as it stands now*, so the analytics aggregations `$lookup` the current `topic`, `subject` and `difficulty`.

The honest cost, recorded in the Milestone 15 ADR: recategorising a question moves historical breakdowns, and deleting one drops its answers out of them. That is the right trade — the alternative, snapshotting the taxonomy onto every answer, would freeze a typo in a subject name into thousands of rows and describe a filing system nobody uses any more.
