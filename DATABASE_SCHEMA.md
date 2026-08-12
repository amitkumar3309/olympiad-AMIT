# DATABASE_SCHEMA.md

MongoDB via Mongoose. **Thirteen models** as of Milestone 6 (Milestone 5 added `StudentActivity`; Milestone 6 added `PracticeSession`). Previously eleven as of Milestone 4 (Milestone 2 added `RefreshToken` and `VerificationToken`; Milestone 3 added `AuditLog` and gave `Student` a `role`; Milestone 4 added `StudentPhoto` plus nine registration fields on `Student`, then `Subject` and `Topic` and a rewritten `Question` for the question bank). Each model lives in its own file under [backend/src/models/](backend/src/models/) (`Student.ts`, `StudentPhoto.ts`, `Subject.ts`, `Topic.ts`, `Question.ts`, `ExamAttempt.ts`, `Result.ts`, `StudentAnalytics.ts`, `RefreshToken.ts`, `VerificationToken.ts`, `AuditLog.ts`), re-exported from `models/index.ts`. They were originally moved out of the old single-file `server.ts` without any schema change; `Student` has since been extended by Milestones 2, 3 and 4. Each model now also has an exported TypeScript document interface (e.g. `StudentDocument`) so handlers are typed instead of using `any`. Connection string: `MONGO_URI` env var (default `mongodb://localhost:27017/amit-olympiad` if unset — see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)).

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
| `studentId` | String | **yes** | — | `AMIT_0000`–`AMIT_9999`, now **`unique`**. Registration retries on a duplicate-key error, which fixes the silent-collision bug recorded in earlier versions of `PROJECT_STATE.md`. |
| `isEmailVerified` | Boolean | no | `false` | Login is refused while `false` (unless `REQUIRE_EMAIL_VERIFICATION=false`). Set by verifying, and also by completing a password reset (which proves mailbox control). |
| `status` | String enum | no | `'active'` | One of `active` / `suspended` / `deactivated`. Checked on login, on every `/auth/me`, on refresh, and on every privileged request. **Milestone 3 gives it a real admin UI** (`PATCH /admin/students/:studentId/status`); it is no longer settable only by hand. |
| `role` | String enum | no | `'student'` | **Added in Milestone 3.** One of `student` / `admin`. Indexed. Set only by `PATCH /admin/users/:studentId/role`, which requires the `users:role:write` permission (super admin only). `superadmin` is **not** a valid value here — the root administrator comes from environment variables and has no document. |
| `roleUpdatedAt` | Date \| null | no | `null` | **Milestone 3.** When the role last changed. |
| `roleUpdatedBy` | String \| null | no | `null` | **Milestone 3.** Who changed it (label only; the full record is in `AuditLog`). |
| `tokenVersion` | Number | no | `0` | Incremented by `logout-all`, by a password reset, and (**Milestone 3**) by any role change or by a suspension/deactivation. Access tokens carry the value they were signed with (`tv`); a mismatch means the token predates the revocation and is rejected. |
| `failedLoginAttempts` | Number | no | `0` | Reset on a successful login. |
| `lockedUntil` | Date \| null | no | `null` | Set once `failedLoginAttempts` reaches `MAX_FAILED_LOGINS`; login returns `423` until it passes. |
| `lastLoginAt` | Date \| null | no | `null` | |
| `registeredAt` | Date | no | `Date.now` | |

Indexes: unique on `mobile`, `email`, and `studentId`; non-unique on `role` (the admin listing filters by it, and the authorization freshness check reads it on every privileged request).

**"Required **on create**"** means `required: function () { return this.isNew }` — enforced when a document is created (registration, the only creation path, where zod has already rejected a missing field with a 400) but **not** when an existing one is saved. Without that scoping, an administrative `save()` on an account that predates Milestone 4 — suspending it, changing its role — would fail validation on nine fields the administrator never touched. Every API view of these fields is therefore explicitly nullable, and the admin table renders `—`. See the Milestone 4 ADR in [`DECISIONS.md`](DECISIONS.md).

**Migration warning**: `email` is required and unique, so any `Student` document created before Milestone 2 has no email and will fail validation on its next save. Reads still work. There is no migration script — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). The Milestone 4 fields deliberately avoid repeating this, per the note above.

Relationships: `studentId` remains the informal, human-facing key used by `ExamAttempt`, `Result` and `StudentAnalytics`. It is now unique, but those are still plain strings rather than real `ObjectId` references. The new auth collections below correctly use an `ObjectId` ref to `Student`.

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
| `type` | String enum | **yes** | — | `single_choice` / `multiple_choice` / `true_false` / `numeric`. Determines which answer field is used — and which are **forbidden**. |
| `options` | [{ `key`, `text`, `isCorrect` }] | no | `[]` | Choice types only; max 8. `key` (`a`, `b`, …) is assigned by the **server**. |
| `booleanAnswer` | Boolean \| null | no | `null` | `true_false` only. |
| `numericAnswer` | Number \| null | no | `null` | `numeric` only. |
| `tolerance` | Number \| null | no | `null` | `numeric` only; null means an exact match is required. |
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
| `createdAt` / `updatedAt` | Date | auto | — | |

Indexes: `status + createdAt`, `subject + topic + status`, `classLevel + difficulty + status`, `tags`.

**The answer shape per type is exclusive.** Validation requires the fields a type uses *and rejects the ones it does not*, so a `numeric` question cannot carry an option list nothing will read, and an MCQ cannot carry a stray `numericAnswer` — the kind of bad data that later looks like a rendering bug.

**Answers are keyed, not text-matched.** The old model stored `correctAnswer` as the literal option *string*, so fixing a typo in an option silently invalidated every recorded answer. Correctness is now a per-option `isCorrect` flag against a stable server-assigned `key`.

**Deletion**: archiving is the normal path. A hard delete is permitted **only** for a question that has never been published (`publishedAt` is null) and requires the separate `questions:delete` permission.

### Breaking change — pre-Milestone-4 documents

The rewrite is **not** backward compatible: `subject` went from `String` to `ObjectId`, `topic` did not exist, `options` went from `[String]` to subdocuments, and `correctAnswer` is gone. A `String` where the schema now declares an `ObjectId` makes Mongoose throw a **cast error on read**, so a legacy document is unreadable through the model — the "required on create only" approach used for the Milestone 4 `Student` fields cannot rescue it.

Every document that could exist was produced by the old template generator and was never real content, and nothing references questions yet (`ExamAttempt` / `Result` are still unwired), so there is nothing of value to preserve. Run `npx tsx scripts/migrate-questions.ts` to report them, then re-run with `--delete` to remove them. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

---

## `ExamAttempt` — DEAD (declared, unused)

Purpose (intended): one document per student's attempt at an exam.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `studentId` | String | **yes** | — | |
| `startTime` | Date | no | `Date.now` | |
| `endTime` | Date | no | — | |
| `totalScore` | Number | no | `0` | |
| `accuracy` | Number | no | `0` | |
| `timeTakenSeconds` | Number | no | `0` | |
| `answers` | Array of `{questionId: String, selectedOption: String, isCorrect: Boolean}` | no | — | |
| `status` | String enum | no | `"In Progress"` | One of `In Progress`/`Submitted`/`Suspended`. |

No route currently creates, reads, updates, or deletes this. `Exam.tsx` on the frontend is entirely client-side and never posts anything here.

---

## `Result` — DEAD (declared, unused)

Purpose (intended): published result per student per exam.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `studentId` | String | **yes** | — | |
| `examId` | String | **yes** | — | No `Exam` model exists to reference. |
| `nationalRank` | Number | no | — | |
| `stateRank` | Number | no | — | |
| `percentile` | Number | no | — | |
| `xpEarned` | Number | no | `0` | |
| `badges` | [String] | no | — | |
| `isPublished` | Boolean | no | `false` | |

No route currently touches this. `Result.tsx` on the frontend fabricates a fake result client-side instead.

---

## `StudentAnalytics` — ACTIVE (read path only, never written)

Purpose: per-student rolled-up performance metrics + AI-generated insight strings.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `studentId` | String | **yes** | — | `unique: true`. |
| `overallAccuracy` | Number | no | `0` | |
| `averageSpeedPerQuestion` | Number | no | `0` | |
| `totalQuestionsAttempted` | Number | no | `0` | |
| `topicMetrics` | Array of subdocument (`{topicName: String (required), attempted: Number, correct: Number, averageTimeSeconds: Number}`, `_id: false`) | no | — | |
| `learningCurve` | Array of `{date: String, accuracy: Number}` | no | — | |
| `aiInsights` | [String] | no | — | Overwritten in-memory by `generateAIInsights()` on every read, but that mutation is **never `.save()`d** — see known bug in [`PROJECT_STATE.md`](PROJECT_STATE.md). |
| `lastUpdated` | Date | no | `Date.now` | Never actually updated by any write path, since nothing writes to this collection at all today. |

`GET /api/v1/analytics/:studentId` does `findOne` on this collection; if not found, returns a hardcoded mock payload instead of a 404 — meaning the API contract for "not found" is currently indistinguishable from "found, with demo data." Nothing in the codebase ever inserts a `StudentAnalytics` document, so this collection is likely empty in any real deployment.

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
- `{ student: 1, type: 1, dedupeKey: 1 }` — **unique, partial** on `{ dedupeKey: { $exists: true } }`.

That partial unique index is what makes "once per day" and "once per account" true rather than merely intended. `recordActivity()` inserts and treats a duplicate-key error as "already counted", which is race-free in a way a read-then-write check across two serverless invocations would not be. It must be *partial* rather than plain (a plain unique index would forbid a student from ever editing their profile twice) and cannot be `sparse` (sparse skips only documents missing *every* indexed field, and these always have `student` and `type`).

**Deliberately no TTL index**, like `AuditLog` and unlike the two token collections: expiring a row would silently take XP away from a student who earned it.

**Writes are best-effort.** `recordActivity()` never throws — a failed log write must not fail the registration or password change it describes. The trade-off is that a lost write costs that event's XP, and shows up as an `error`-level log line (see [`DECISIONS.md`](DECISIONS.md)).

**Accounts created before Milestone 5 have no rows**, so they read as 0 XP with an empty feed. `backend/scripts/backfill-activity.ts` writes the `account_created` row — and, where `isEmailVerified` is genuinely true, `email_verified` — from facts already on the `Student` document, dated from its real `registeredAt`. It deliberately does **not** invent `daily_visit` rows, so nobody is handed a streak they did not keep. Idempotent; see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

---

## Models Planned But Not Implemented

Based on the UI's implied needs (see [`FEATURE_STATUS.md`](FEATURE_STATUS.md)), future models will likely be needed for: `Exam` (definitions, distinct from attempts), `Certificate`, and possibly `DailyChallenge`. (`AdminAuditLog` was on this list and is now implemented as `AuditLog`; `Leaderboard` is on it no longer — Milestone 5 derives the standing by aggregating `StudentActivity` rather than storing it.) None of these should be added without a corresponding [`DECISIONS.md`](DECISIONS.md) entry and a matching [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) update.

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
