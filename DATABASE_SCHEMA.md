# DATABASE_SCHEMA.md

MongoDB via Mongoose. As of Milestone 1 each model lives in its own file under [backend/src/models/](backend/src/models/) (`Student.ts`, `Question.ts`, `ExamAttempt.ts`, `Result.ts`, `StudentAnalytics.ts`), re-exported from `models/index.ts`. They were moved out of the old single-file `server.ts` **without any schema change** — every field, default, enum and constraint below is byte-for-byte what it was before. Each model now also has an exported TypeScript document interface (e.g. `StudentDocument`) so handlers are typed instead of using `any`. Connection string: `MONGO_URI` env var (default `mongodb://localhost:27017/amit-olympiad` if unset — see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)).

## Status legend
- `ACTIVE` — model is written to and/or read by at least one route.
- `DEAD` — model is declared but no route ever reads or writes it.

---

## `Student` — ACTIVE

Purpose: one document per registered student; the sole source of truth for student auth.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `fullName` | String | no | — | |
| `mobile` | String | **yes** | — | `unique: true` — Mongoose creates a unique index; this is the login identifier. |
| `passwordHash` | String | **yes** | — | bcrypt hash, 10 salt rounds. |
| `studentId` | String | no | — | App-generated as `AMIT_<0-9999 random>` at registration time. **No uniqueness constraint or collision check** — see known bug in [`PROJECT_STATE.md`](PROJECT_STATE.md). |
| `registeredAt` | Date | no | `Date.now` | |

Relationships: `studentId` (not `_id`) is used as the informal foreign key by `ExamAttempt`, `Result`, and `StudentAnalytics` — but since it's a plain unindexed String with no uniqueness guarantee, this is a soft, unenforced relationship, not a real Mongo reference (`ObjectId` ref).

No email field. No role field (role is inferred purely from which JWT was issued, not stored on the document).

---

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

## Models Planned But Not Implemented

None formally planned yet in code or docs prior to this audit. Based on the UI's implied needs (see [`FEATURE_STATUS.md`](FEATURE_STATUS.md)), future models will likely be needed for: `Exam` (definitions, distinct from attempts), `Leaderboard` (or derive it from `Result`), `Certificate`, `DailyChallenge`, `AdminAuditLog`. None of these should be added without a corresponding [`DECISIONS.md`](DECISIONS.md) entry and a matching [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) update.
