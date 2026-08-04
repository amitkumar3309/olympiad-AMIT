# API_DOCUMENTATION.md

_Last updated: 2026-08-05 (Milestone 3 — RBAC and User Management Foundation)._

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

### `GET /api/v1/analytics/:studentId`
- **Auth**: `requirePermission('analytics:read:self')`. Fetching **someone else's** record additionally requires `analytics:read:any`, checked *freshly* against the database via `callerCanFresh()` — so a demoted admin stops being able to read other students' data immediately, not at token expiry. A student reading another ID gets **403**.
- **Response 200**: `{ success, data: AnalyticsData }` — the real `StudentAnalytics` document if one exists, **otherwise a hardcoded demo payload**. Since nothing creates those documents, this currently always returns demo data.
- **Errors**: `401`, `403`, `429`, `503`, `500`.
- **Called by**: `Analytics.tsx`, `Report.tsx`.

### `POST /api/v1/admin/generate-questions`
- **Auth**: `requirePermission('questions:write')` (admin and super admin).
- **Side effect**: writes a `questions.generated` audit entry.
- **Request**: `{ classLevel, subject, topic, difficulty?, questionType?, count }` — `count` is coerced to an integer and constrained to 1–20.
- **Behaviour**: generates `count` template-string questions (**not** an AI/LLM call — no AI provider is integrated) and `insertMany`s them.
- **Errors**: `400`, `401`/`403`, `429`, `503`, `500`.
- **Called by**: `AiGenerator.tsx`.
- **Note**: `topic` only appears inside the generated text; `Question` has no `topic` field.

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

### `GET /api/v1/questions`
- **Auth**: none (public).
- **Query params**: optional `classLevel`, `subject`, `difficulty`.
- **Validation** (`listQuestionsQuerySchema`): each must be a plain non-empty string; `difficulty` must be one of `Easy`/`Medium`/`Hard`. A repeated key (`?difficulty=a&difficulty=b`) arrives as an array and is rejected with 400, so no non-string value can reach the Mongoose filter — see [`SECURITY.md`](SECURITY.md).
- **Response 200**: `{ success: true, count: number, data: Question[] }`, hard-limited to 20 results, no pagination.
- **Frontend**: no page calls this yet.

---

## IMPLEMENTED — static mocks, no database, no frontend caller

These three pre-date Milestone 1 and were relocated unchanged into `routes/v1/misc.routes.ts`. They return hardcoded data and touch no database. They are **not** new fake APIs introduced by this milestone.

### `GET /api/v1/daily-challenge`
Returns a hardcoded challenge object (`title`, `rewardXP`, `difficulty`, `estimatedTime`, `fastestTime`, `todayWinner`). No frontend caller.

### `GET /api/v1/leaderboard`
Returns a hardcoded array of 5 fake students. No frontend caller — `Landing.tsx` and `Dashboard.tsx` render their own separate hardcoded arrays.

### `GET /api/v1/certificates/:studentId`
Returns the same hardcoded 2-item array regardless of `:studentId` (the parameter is accepted but unused). No frontend caller — `Certificate.tsx` renders from `AuthContext` state.

---

## PLANNED (not implemented)

No routes exist for: exam attempt submission, published results, real leaderboard computation, certificate issuance tied to a real result, payments/orders, XP/badges/levels, notifications, student self-service profile editing, or admin-initiated account deletion. Grep `backend/src/routes/v1/` before building against an assumed endpoint. (Password reset and email verification arrived in Milestone 2; student listing/management and audit logs in Milestone 3.)

## Checklist for adding a route

1. Put it in the right file under `backend/src/routes/v1/` (or add a new file and register it in `routes/v1/index.ts`).
2. Return the `{ success, ... }` envelope via `sendSuccess`/`sendError`.
3. Add a zod schema in `backend/src/validation/` and apply `validate({ body/query/params })`.
4. Gate it with `requirePermission('...')`, adding a new permission to `backend/src/lib/permissions.ts` if none fits. Do **not** compare `req.user.role` to a literal in the handler. Use `requireAuth(...)` only when the requirement really is an identity rather than a capability.
5. **Apply `ensureDb` if it touches the database**, after validation/auth. Forgetting this yields a route that works locally but fails in production. (`requirePermission` already includes it for privileged permissions; applying it again is harmless, since `connectDB()` caches.)
5b. If it changes an account, a role, or the question bank, call `recordAudit(req, {...})` with a matching action from `backend/src/models/AuditLog.ts`.
6. Document it here and update [`FEATURE_STATUS.md`](FEATURE_STATUS.md) in the same change.
