# API_DOCUMENTATION.md

_Last updated: 2026-08-12 (Milestone 7 — Mock Tests)._

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
| `access_token` | JWT (`role`, `sub`, `studentId`, `email`, `tv`, `root?`) | 15 min (`ACCESS_TOKEN_TTL`); 8 h for the root admin (`ADMIN_TOKEN_TTL`) | Session cookie — no `maxAge`; the `exp` claim is the authority. The `role` claim is a hint only: privileged requests re-read the role from the database. `root: true` marks the env-configured administrator, which has no document. |
| `refresh_token` | 32 random bytes, opaque | 30 days (`REFRESH_TOKEN_TTL_DAYS`) | Stored SHA-256-hashed; rotated on every use. |

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

### `POST /api/v1/auth/admin/login`
- **Auth**: none. **Rate limit**: 10/15 min. Requires `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`.
- This is the **root administrator**: it holds the `superadmin` role (the only role that can grant or revoke admin rights) and is the bootstrap identity, since nothing else can create the first admin.
- **Response 200**: `{ success, role: 'superadmin', permissions, admin: { email, role } }` + an 8-hour `access_token` marked `root`. **No refresh token** — see [`DECISIONS.md`](DECISIONS.md).
- **Side effect**: writes an `admin.session.started` audit entry (skipped with a warning if the database is unreachable, since this route deliberately works without one).
- **Errors**: `400`, `401` invalid credentials, `500` admin not configured.
- Administrators *promoted* from a student account do **not** use this route — they sign in through `POST /auth/login` like any other account.

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

### `GET /api/v1/analytics/:studentId` — no longer fabricates a result

Returns `{ data, reason?, xpByDay }`.

- `data` is the real `StudentAnalytics` document, or **`null`** with `reason: 'no-exam-data'`. It is null for every student today, because nothing writes that document.
- `xpByDay` is **real**: actual XP earned per competition day over the last 30 days, from the activity log, oldest first. Days with no activity are **omitted** rather than zero-filled — a flat line at zero would imply a measured zero.

**This endpoint used to lie.** When no document existed it returned a hardcoded object claiming 88% accuracy over 450 questions, a rising five-point learning curve, four topic breakdowns and "You are currently in the top 5% of all national Olympiad participants" — as the student's own measured performance. That fallback is deleted; a test asserts none of those strings can appear in a response.

Authorization is unchanged: `analytics:read:self` for your own record, with a **fresh** database-backed `analytics:read:any` check for anyone else's. A non-existent student ID now returns 404.
- **Auth**: `requirePermission('analytics:read:self')`. Fetching **someone else's** record additionally requires `analytics:read:any`, checked *freshly* against the database via `callerCanFresh()` — so a demoted admin stops being able to read other students' data immediately, not at token expiry. A student reading another ID gets **403**.
- **Response 200**: `{ success, data: AnalyticsData }` — the real `StudentAnalytics` document if one exists, **otherwise a hardcoded demo payload**. Since nothing creates those documents, this currently always returns demo data.
- **Errors**: `401`, `403`, `429`, `503`, `500`.
- **Called by**: `Analytics.tsx`, `Report.tsx`.

### `POST /api/v1/admin/generate-questions`
- **Auth**: `requirePermission('questions:write')` (admin and super admin).
- **Request** (**changed in Milestone 4**): `{ subject, topic, classLevel, difficulty?, count }`. `subject` and `topic` are now **ObjectIds of real taxonomy rows** — the bank no longer accepts a free-text subject, so the generator cannot invent classification nothing else knows about. `count` is 1–20.
- **Behaviour**: creates `count` **draft** questions from a template string (**not** an AI/LLM call — no AI provider is integrated anywhere in this backend). It goes through the same `createQuestion` service as a hand-authored question, so it cannot bypass the taxonomy consistency checks. Because everything it writes is a draft, template placeholder text can never reach a student.
- **Response 201**: `{ success, message, questions: [{ id, questionText, status }] }`.
- **Side effect**: writes a `questions.generated` audit entry.
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
- **Request**: `{ status: 'active' | 'suspended' | 'deactivated', reason?: string }` — `reason` is 3–500 chars and is stored in the audit entry.
- **Response 200**: `{ success, changed: boolean, student: ManagedAccount }`. `changed: false` when the status already matched, in which case nothing is written and no audit entry is made.
- **Side effects** when the status changes: suspending or deactivating revokes every refresh token and bumps `tokenVersion`, so live sessions end at once; reactivating also clears `failedLoginAttempts` and `lockedUntil`, otherwise the account would return still locked out. Always writes a `student.status.changed` audit entry.
- **Errors**: `400` unknown status or malformed ID, `401`, `403` (also when an ordinary admin targets an account that holds a role — only a super admin may act on an administrator), `404`, `409` acting on your own account, `429`, `503`, `500`.
- **This is what finally gives `status` a UI** — before Milestone 3 only a direct database edit could set it.

### `PATCH /api/v1/admin/users/:studentId/role`
- **Permission**: `users:role:write` — **super admin only**. An ordinary admin gets `403`, so a compromised admin session cannot mint more admins.
- **Request**: `{ role: 'student' | 'admin', reason?: string }`. `superadmin` is **not** in the enum: there is deliberately no API path to a second root administrator (asserted by a test).
- **Response 200**: `{ success, changed: boolean, student: ManagedAccount }`
- **Side effects** when the role changes: sets `roleUpdatedAt`/`roleUpdatedBy`, revokes every refresh token and bumps `tokenVersion` — so the target **must sign in again**, and cannot keep an old token carrying the old role. Writes a `user.role.changed` audit entry with `{ from, to, reason }`.
- **Errors**: `400` invalid role or malformed ID, `401`, `403` insufficient permission, `404`, `409` changing your own role, `409` promoting an account that is unverified or not active, `429`, `503`, `500`.

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

### `GET /api/v1/me/daily-challenge` (also `GET /api/v1/daily-challenge`)
Today's challenge question for the caller's class, as a full **answer-stripped** question via the shared `studentQuestionView` — so it cannot expose an answer key even by accident. Deterministic: the same day and class always resolve to the same question, so a reload cannot be used to shop for an easier one.

Answers `{ challenge: null, reason: 'none-published' | 'no-class' }` — a 200, not a 404, because "there is no challenge today" is a normal answer while the bank has nothing published for that class.

**This replaced a static mock and is now authenticated where the mock was open**, because it returns question content. Both paths are served: the `/me/` form because the resource depends on who is asking, and the bare path because that is what was already published here.

---

## Public reads (Milestone 5) — no authentication

Both were hardcoded mocks before Milestone 5 and are now real aggregations. Made public by an explicit decision of the project owner, so the landing page shows a real standing instead of an invented one — see [`DECISIONS.md`](DECISIONS.md).

### `GET /api/v1/public/stats`
`{ stats: { studentsRegistered, registeredToday, schoolsRepresented, studentsActiveToday } }`. Real counts of accounts in good standing, distinct school names among them, and students with any activity today. A fresh deployment truthfully answers zero for all four, and the landing page renders that.

### `GET /api/v1/leaderboard`
`{ leaderboard: [{ rank, studentId, displayName, classLevel, schoolName, xp }] }`, ordered by real XP. Query: `limit` (1–50, default 10) — validated and **capped**, so this returns a leaderboard and cannot be walked to enumerate the roll.

- `displayName` is a **first name plus a last initial** ("Ishaan V."). The entrants are schoolchildren and this endpoint is public and indexable, so a full legal name beside a school and a class is not published. Tests assert the full name, email address and mobile number are absent from the response.
- Suspended and deactivated accounts are excluded, filtered *before* the limit so a suspended account cannot silently consume a place in the top ten.
- Standard competition ranking: one plus the number of students strictly ahead, so a tie shares a rank.
- A student with no XP does not appear at all.

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

(Password reset and email verification arrived in Milestone 2; student listing/management and audit logs in Milestone 3; the question bank and taxonomy in Milestone 4; **self-service profile editing, photo replacement, password change, the dashboard, XP/levels/streaks/achievements, the real leaderboard and the real daily challenge in Milestone 5**.)

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
