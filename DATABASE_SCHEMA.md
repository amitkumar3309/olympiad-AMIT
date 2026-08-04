# DATABASE_SCHEMA.md

MongoDB via Mongoose. **Eight models** as of Milestone 3 (Milestone 2 added `RefreshToken` and `VerificationToken`; Milestone 3 added `AuditLog` and gave `Student` a `role`). Each model lives in its own file under [backend/src/models/](backend/src/models/) (`Student.ts`, `Question.ts`, `ExamAttempt.ts`, `Result.ts`, `StudentAnalytics.ts`, `RefreshToken.ts`, `VerificationToken.ts`, `AuditLog.ts`), re-exported from `models/index.ts`. They were moved out of the old single-file `server.ts` **without any schema change** — every field, default, enum and constraint below is byte-for-byte what it was before. Each model now also has an exported TypeScript document interface (e.g. `StudentDocument`) so handlers are typed instead of using `any`. Connection string: `MONGO_URI` env var (default `mongodb://localhost:27017/amit-olympiad` if unset — see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)).

## Status legend
- `ACTIVE` — model is written to and/or read by at least one route.
- `DEAD` — model is declared but no route ever reads or writes it.

---

## `Student` — ACTIVE

Purpose: one document per registered student; the sole source of truth for student auth.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `fullName` | String | no | — | |
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

**Migration warning**: `email` is required and unique, so any `Student` document created before Milestone 2 has no email and will fail validation on its next save. Reads still work. There is no migration script — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

Relationships: `studentId` remains the informal, human-facing key used by `ExamAttempt`, `Result` and `StudentAnalytics`. It is now unique, but those are still plain strings rather than real `ObjectId` references. The new auth collections below correctly use an `ObjectId` ref to `Student`.

**Role model (Milestone 3)**: an account's `role` on this document is the authority. The access token carries a `role` claim as well, but for any privileged request the middleware re-reads this field and uses the database value, so a demotion cannot be outlived by an already-issued token. The environment-configured root administrator holds `superadmin` and has **no document here** — see [`DECISIONS.md`](DECISIONS.md).

## `Question` — ACTIVE

Purpose: Olympiad question bank, populated only via the AI-generator admin route today. Read queries against it are now validated by `listQuestionsQuerySchema` before a filter is built.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `questionText` | String | **yes** | — | |
| `options` | [String] (each required) | **yes** (array items) | — | No enforced length (UI assumes 4 options but schema doesn't enforce it). |
| `correctAnswer` | String | **yes** | — | Stored as the literal option text, not an index — fragile if option text is edited later. |
| `classLevel` | String | **yes** | — | Free text, e.g. `"Class 8"`. |
| `subject` | String | no | `"Mathematics"` | |
| `difficulty` | String enum | no | `"Medium"` | One of `Easy`/`Medium`/`Hard`. |
| `createdAt` | Date | no | `Date.now` | |

Note: the AI generator accepts a `topic` input from the admin form but **the schema has no `topic` field**, so the topic is baked only into `questionText` as a string and is not separately queryable.

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

## Models Planned But Not Implemented

None formally planned yet in code or docs prior to this audit. Based on the UI's implied needs (see [`FEATURE_STATUS.md`](FEATURE_STATUS.md)), future models will likely be needed for: `Exam` (definitions, distinct from attempts), `Leaderboard` (or derive it from `Result`), `Certificate` and `DailyChallenge`. (`AdminAuditLog` was on this list and is now implemented as `AuditLog`, above.) None of these should be added without a corresponding [`DECISIONS.md`](DECISIONS.md) entry and a matching [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) update.
