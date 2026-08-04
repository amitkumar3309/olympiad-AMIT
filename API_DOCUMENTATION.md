# API_DOCUMENTATION.md

_Last updated: 2026-08-04 (Milestone 2 — Complete Authentication System)._

**Base path: `/api/v1`** (canonical). The unversioned `/api` prefix is retained as a backward-compatibility alias mounting the exact same router — see [`DECISIONS.md`](DECISIONS.md). Add new routes to `backend/src/routes/v1/` only; they become available under both prefixes automatically.

Response envelope: `{ success: true, ... }` or `{ success: false, error: string }`, produced by `sendSuccess`/`sendError` in `backend/src/lib/apiResponse.ts`. Validation failures additionally include a `details` array.

Middleware order on data routes: `rateLimit → validate → requireAuth → ensureDb → handler`. Validation therefore runs before any database work, and before the auth gate on public routes. Consequences worth knowing when reading the error lists below:
- Malformed input returns **400** without touching the database.
- An unreachable database returns **503** (`"Database unavailable. Please try again shortly."`), not a 500 or a hang.
- All `/api*` routes are rate limited (general limiter). Sensitive auth routes have their own tighter limiters, listed per endpoint below. Exceeding any of them returns **429**.

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
| `access_token` | JWT (`role`, `sub`, `studentId`, `email`, `tv`) | 15 min (`ACCESS_TOKEN_TTL`) | Session cookie — no `maxAge`; the `exp` claim is the authority. |
| `refresh_token` | 32 random bytes, opaque | 30 days (`REFRESH_TOKEN_TTL_DAYS`) | Stored SHA-256-hashed; rotated on every use. |

Both are `httpOnly`, `secure` in production, and `sameSite: 'none'` in production (the apps are on different domains). `tv` is the student's `tokenVersion`; a mismatch means the session was revoked.

### `POST /api/v1/auth/register`
- **Auth**: none. **Rate limit**: 10/hour per IP.
- **Request**: `{ fullName, mobile, email, password }`
- **Validation**: `fullName` 2–120 chars; `mobile` 10–15 digits (spaces/dashes stripped); `email` a valid address, lowercased; `password` ≥8 chars containing at least one letter and one number.
- **Response 201**: `{ success, message, requiresEmailVerification, student }` — and **no session cookies**. The student must verify first.
- **Errors**: `400` validation, `409` duplicate email *or* duplicate mobile (distinct messages), `429`, `503`, `500`.
- **Side effect**: emails a single-use verification link valid for 24 hours.

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
- **Response 200**: `{ success, student }` + sets both cookies.
- **Errors**:
  - `400` validation.
  - `401` invalid credentials — identical message for "no such account" and "wrong password", to prevent enumeration.
  - `403` account `suspended` / `deactivated`.
  - `403` with `code: 'EMAIL_NOT_VERIFIED'` when the address is unverified and `REQUIRE_EMAIL_VERIFICATION` is on. The frontend keys off `code` to offer a resend link.
  - `423` account temporarily locked (after `MAX_FAILED_LOGINS`, for `ACCOUNT_LOCK_MINUTES`). The message includes the remaining minutes.
  - `429`, `503`, `500`.

### `POST /api/v1/auth/admin/login`
- **Auth**: none. **Rate limit**: 10/15 min. Requires `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`.
- **Response 200**: `{ success, admin: { email } }` + an 8-hour `access_token`. **No refresh token** — see [`DECISIONS.md`](DECISIONS.md).
- **Errors**: `400`, `401` invalid credentials, `500` admin not configured.

### `POST /api/v1/auth/refresh`
- **Auth**: the `refresh_token` cookie. **Rate limit**: 60/15 min.
- **Response 200**: `{ success, student }` + a **new** access token and a **rotated** refresh token.
- **Errors**: `401` when the token is missing, unknown, expired, or belongs to a non-active account — cookies are cleared in every case.
- **Theft detection**: presenting an already-rotated token revokes the entire token family and returns `401` (`"…ended for security reasons…"`). Clients must therefore not refresh concurrently; the frontend de-duplicates through one shared promise.

### `POST /api/v1/auth/logout`
- **Auth**: none required (safe to call when already signed out).
- Revokes **only** the presented refresh token, so other devices stay signed in, and clears both cookies. Never fails: cookies are cleared even if the database write errors.

### `POST /api/v1/auth/logout-all`
- **Auth**: `requireAuth('student')`.
- Revokes every refresh token for the student **and** increments `tokenVersion`, which invalidates all outstanding access tokens at their next `/auth/me` or refresh.

### `GET /api/v1/auth/me`
- **Auth**: reads the `access_token` cookie directly (not via `requireAuth`) because it must also answer for guests.
- **Response 200 (student)**: `{ success, role: 'student', student }`
- **Response 200 (admin)**: `{ success, role: 'admin', admin: { email } }` — answered from the token alone, so it works even when MongoDB is down.
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
- **Auth**: `requireAuth('student', 'admin')`. A student may fetch only their own ID (403 otherwise); admins may fetch any.
- **Response 200**: `{ success, data: AnalyticsData }` — the real `StudentAnalytics` document if one exists, **otherwise a hardcoded demo payload**. Since nothing creates those documents, this currently always returns demo data.
- **Errors**: `401`, `403`, `429`, `503`, `500`.
- **Called by**: `Analytics.tsx`, `Report.tsx`.

### `POST /api/v1/admin/generate-questions`
- **Auth**: `requireAuth('admin')`.
- **Request**: `{ classLevel, subject, topic, difficulty?, questionType?, count }` — `count` is coerced to an integer and constrained to 1–20.
- **Behaviour**: generates `count` template-string questions (**not** an AI/LLM call — no AI provider is integrated) and `insertMany`s them.
- **Errors**: `400`, `401`/`403`, `429`, `503`, `500`.
- **Called by**: `AiGenerator.tsx`.
- **Note**: `topic` only appears inside the generated text; `Question` has no `topic` field.

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

No routes exist for: exam attempt submission, published results, admin student listing/management, password reset, email/phone verification, real leaderboard computation, certificate issuance tied to a real result, payments/orders, XP/badges/levels, notifications, or audit logs. Grep `backend/src/routes/v1/` before building against an assumed endpoint.

## Checklist for adding a route

1. Put it in the right file under `backend/src/routes/v1/` (or add a new file and register it in `routes/v1/index.ts`).
2. Return the `{ success, ... }` envelope via `sendSuccess`/`sendError`.
3. Add a zod schema in `backend/src/validation/` and apply `validate({ body/query/params })`.
4. Apply `requireAuth(...)` with the correct roles if it isn't public.
5. **Apply `ensureDb` if it touches the database**, after validation/auth. Forgetting this yields a route that works locally but fails in production.
6. Document it here and update [`FEATURE_STATUS.md`](FEATURE_STATUS.md) in the same change.
