# API_DOCUMENTATION.md

_Last updated: 2026-08-04 (Milestone 1)._

**Base path: `/api/v1`** (canonical). The unversioned `/api` prefix is retained as a backward-compatibility alias mounting the exact same router — see [`DECISIONS.md`](DECISIONS.md). Add new routes to `backend/src/routes/v1/` only; they become available under both prefixes automatically.

Response envelope: `{ success: true, ... }` or `{ success: false, error: string }`, produced by `sendSuccess`/`sendError` in `backend/src/lib/apiResponse.ts`. Validation failures additionally include a `details` array.

Middleware order on data routes: `rateLimit → validate → requireAuth → ensureDb → handler`. Consequences worth knowing when reading the error lists below:
- Malformed input returns **400** without touching the database.
- An unreachable database returns **503** (`"Database unavailable. Please try again shortly."`), not a 500 or a hang.
- All `/api*` routes are rate limited (general limiter); the three auth routes have a stricter limiter. Exceeding either returns **429**.

---

## Operational endpoints (unversioned, no `/api` prefix)

### `GET /health`
- **Auth**: none. **Rate limited**: no — mounted before the limiter so probes are never throttled.
- **DB**: not touched; this is a liveness check for the process only.
- **Response 200**: `{ success: true, status: 'ok', uptimeSeconds: number }`
- Verified live: returns 200 even with MongoDB unreachable.

### `GET /ready`
- **Auth**: none. **Rate limited**: no.
- **DB**: inspects the Mongoose connection state (does not open a connection).
- **Response 200**: `{ success: true, status: 'ready', db: 'connected' }`
- **Response 503**: `{ success: false, error: 'Not ready', db: 'disconnected' }`
- Use this for uptime monitoring and deployment gating; use `/health` to check only that the process is alive.

---

## IMPLEMENTED — and called by the frontend

The frontend calls these through `api.get`/`api.post` in `frontend/src/api/client.ts`, which prefixes `API_BASE = '/api/v1'`.

### `POST /api/v1/auth/register`
- **Auth**: none (public). Stricter auth rate limiter applies.
- **Request**: `{ fullName: string, mobile: string, password: string }`
- **Validation** (`registerSchema`, zod): all three required; `fullName`/`mobile` trimmed and non-empty; `password` at least 6 characters. Rejected before any DB access.
- **Response 200**: `{ success: true, message: string, student: { fullName, mobile, studentId } }` + sets the `token` httpOnly cookie.
- **Errors**: `400` validation (with `details`), `409` duplicate mobile, `429` rate limited, `503` DB unavailable, `500` unexpected (message is Hinglish: `"Kuch gadbad ho gayi"`, carried over verbatim).
- **Note**: `studentId` is generated as `AMIT_<random 0-9999>` with **no uniqueness check** — see known bugs in [`PROJECT_STATE.md`](PROJECT_STATE.md).

### `POST /api/v1/auth/login`
- **Auth**: none (public). Stricter auth rate limiter applies.
- **Request**: `{ mobile: string, password: string }`
- **Validation** (`loginSchema`): both required and non-empty.
- **Response 200**: `{ success: true, student: { fullName, mobile, studentId } }` + sets `token` cookie.
- **Errors**: `400` validation, `401` invalid credentials, `429`, `503`, `500`.

### `POST /api/v1/auth/admin/login`
- **Auth**: none (public), but requires `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` configured server-side. Stricter auth rate limiter applies.
- **Request**: `{ email: string, password: string }`
- **Response 200**: `{ success: true, admin: { email } }` + sets `token` cookie with role `admin`.
- **Errors**: `400` validation, `401` invalid credentials, `500` if the admin env vars are missing (`"Admin account is not configured."`), `429`, `503`.

### `POST /api/v1/auth/logout`
- **Auth**: none required (safe no-op if already logged out). **DB**: not touched.
- **Response 200**: `{ success: true }`, clears the `token` cookie.

### `GET /api/v1/auth/me`
- **Auth**: reads the `token` cookie directly rather than via `requireAuth`, since it must also answer for guests.
- **Response 200 (student)**: `{ success: true, role: 'student', student: { fullName, mobile, studentId } }`
- **Response 200 (admin)**: `{ success: true, role: 'admin', admin: { email } }`
- **Errors**: `401` no/invalid/expired cookie, or the token's student `_id` no longer resolves. `503` if the database is unreachable.
- **Known nuance**: `ensureDb` runs before the cookie check, so a guest receives `503` instead of `401` while the database is down. The frontend treats any failure as "guest", so behaviour is correct — logged in [`PROJECT_STATE.md`](PROJECT_STATE.md).

### `GET /api/v1/analytics/:studentId`
- **Auth**: `requireAuth('student', 'admin')`.
- **Authorization**: a student may only fetch their own `:studentId` (403 otherwise); an admin may fetch any.
- **Response 200**: `{ success: true, data: AnalyticsData }` — the real `StudentAnalytics` document if one exists, **otherwise a hardcoded demo payload**. The shape is identical either way, so callers cannot distinguish real from demo data. Because nothing in the codebase ever creates a `StudentAnalytics` document, this currently **always** returns the demo payload.
- **Errors**: `401`, `403`, `429`, `503`, `500`.
- **Called by**: `Analytics.tsx`, `Report.tsx`.

### `POST /api/v1/admin/generate-questions`
- **Auth**: `requireAuth('admin')`.
- **Request**: `{ classLevel: string, subject: string, topic: string, difficulty?: 'Easy'|'Medium'|'Hard', questionType?: unknown, count: number }`
- **Validation** (`generateQuestionsSchema`): `classLevel`/`subject`/`topic` required and non-empty; `difficulty` must be one of the three values (defaults to `Medium`); `count` coerced to an integer and constrained to **1–20** (previously unbounded server-side).
- **Behaviour**: generates `count` template-string questions (**not** an AI/LLM call — no AI provider is integrated anywhere in this codebase) and `insertMany`s them.
- **Response 200**: `{ success: true, message: string, data: Question[] }`
- **Errors**: `400` validation, `401`/`403` not an admin, `429`, `503`, `500`.
- **Called by**: `AiGenerator.tsx`.
- **Note**: `topic` is used only inside the generated `questionText`; the `Question` schema has no `topic` field, so it is not separately queryable.

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

No routes exist for: exam attempt submission, published results, admin student listing/management, password reset, email/phone verification, real leaderboard computation, certificate issuance tied to a real result, payments/orders, XP/badges/levels, notifications, or audit logs. Grep `backend/src/routes/v1/` before building against an assumed endpoint.

## Checklist for adding a route

1. Put it in the right file under `backend/src/routes/v1/` (or add a new file and register it in `routes/v1/index.ts`).
2. Return the `{ success, ... }` envelope via `sendSuccess`/`sendError`.
3. Add a zod schema in `backend/src/validation/` and apply `validate({ body/query/params })`.
4. Apply `requireAuth(...)` with the correct roles if it isn't public.
5. **Apply `ensureDb` if it touches the database**, after validation/auth. Forgetting this yields a route that works locally but fails in production.
6. Document it here and update [`FEATURE_STATUS.md`](FEATURE_STATUS.md) in the same change.
