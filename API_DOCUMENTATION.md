# API_DOCUMENTATION.md

Base path: `/api`. All routes live in [backend/src/server.ts](backend/src/server.ts). Response envelope convention: `{ success: true, ... }` or `{ success: false, error: string }`.

## IMPLEMENTED — and called by the frontend

### `POST /api/auth/register`
- **Auth**: none (public).
- **Request**: `{ fullName: string, mobile: string, password: string }`
- **Validation**: all three required; `password.length >= 6`; `mobile` must not already exist in `Student` (409 if so).
- **Response 200**: `{ success: true, message: string, student: { fullName, mobile, studentId } }` + sets `token` httpOnly cookie.
- **Errors**: `400` missing fields/short password, `409` duplicate mobile, `500` on unexpected error (generic message, not translated/localized consistently — some backend error strings are in Hindi/Hinglish, e.g. `"Kuch gadbad ho gayi"`).

### `POST /api/auth/login`
- **Auth**: none (public).
- **Request**: `{ mobile: string, password: string }`
- **Response 200**: `{ success: true, student: { fullName, mobile, studentId } }` + sets `token` cookie.
- **Errors**: `400` missing fields, `401` invalid credentials, `500` unexpected.

### `POST /api/auth/admin/login`
- **Auth**: none (public) — but requires server-side `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` env vars to be set.
- **Request**: `{ email: string, password: string }`
- **Response 200**: `{ success: true, admin: { email } }` + sets `token` cookie (role `admin`).
- **Errors**: `401` invalid credentials or mismatched email, `500` if admin env vars are missing (`"Admin account is not configured."`).

### `POST /api/auth/logout`
- **Auth**: none required (safe no-op if already logged out).
- **Response 200**: `{ success: true }`, clears the `token` cookie.

### `GET /api/auth/me`
- **Auth**: reads the `token` cookie itself (not via `requireAuth`, since it must also succeed for guests).
- **Response 200 (student)**: `{ success: true, role: 'student', student: { fullName, mobile, studentId } }`
- **Response 200 (admin)**: `{ success: true, role: 'admin', admin: { email } }`
- **Errors**: `401` if no/invalid/expired cookie, or if the student `_id` in the token no longer resolves to a `Student` document.

### `GET /api/analytics/:studentId`
- **Auth**: `requireAuth('student', 'admin')`.
- **Authorization**: a student can only fetch their own `:studentId` (403 otherwise); admins can fetch any.
- **Response 200**: `{ success: true, data: AnalyticsData }` — real `StudentAnalytics` document if one exists for that `studentId`, **otherwise a hardcoded mock payload** (see [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)). The response shape is identical either way, so callers cannot currently distinguish real vs. mock data from the response alone.
- **Called by**: `Analytics.tsx`, `Report.tsx`.

### `POST /api/admin/generate-questions`
- **Auth**: `requireAuth('admin')`.
- **Request**: `{ classLevel: string, subject: string, topic: string, difficulty: string, questionType?: unknown (accepted, unused), count: number }`
- **Behavior**: generates `count` template-string questions (not an AI/LLM call) with 4 fixed-pattern options, `Question.insertMany()`s them.
- **Response 200**: `{ success: true, message: string, data: Question[] }`
- **Errors**: `500` generic on any failure. No validation on `count` (no min/max enforced server-side, even though the UI caps the input at 20) — a large or negative `count` is not rejected.
- **Called by**: `AiGenerator.tsx`.

### `GET /api/questions`
- **Auth**: none (public).
- **Query params**: optional `classLevel`, `subject`, `difficulty` — passed directly into a Mongoose filter object built from `req.query` with **no sanitization** (see [`SECURITY.md`](SECURITY.md) for the injection-shaped risk).
- **Response 200**: `{ success: true, count: number, data: Question[] }`, hard-limited to 20 results, no pagination.
- **Called by**: nothing in the current frontend (built, but no consumer page exists yet).

---

## IMPLEMENTED — but orphaned (no frontend caller today)

### `GET /api/daily-challenge`
- **Auth**: none.
- **Response**: fully hardcoded object (`title`, `rewardXP`, `difficulty`, `estimatedTime`, `fastestTime`, `todayWinner`). No DB access.
- **Frontend**: not called anywhere.

### `GET /api/leaderboard`
- **Auth**: none.
- **Response**: fully hardcoded array of 5 fake students. No DB access.
- **Frontend**: not called anywhere — both `Landing.tsx` and `Dashboard.tsx` render their own separate hardcoded leaderboard arrays instead.

### `GET /api/certificates/:studentId`
- **Auth**: none. `:studentId` is accepted but **not used** in the handler at all — the same 2-item hardcoded array is returned regardless of which ID is requested.
- **Frontend**: not called anywhere — `Certificate.tsx` renders its own certificate view from `AuthContext` state directly.

---

## PLANNED (not implemented at all)

No routes exist yet for: exam attempt submission, published results, admin student listing/management, password reset, email verification, leaderboard/result computation from real data, certificate issuance tied to a real exam result, payments/orders, XP/badges/levels, notifications, audit logs. Do not assume any of these exist — grep `server.ts` before building against an assumed endpoint.

## Cross-cutting notes for anyone adding a route

- Always return the `{success, ...}` / `{success:false, error}` shape.
- Add `requireAuth(...)` with the correct role(s) for anything touching a specific student's or admin's data.
- Update this file and [`FEATURE_STATUS.md`](FEATURE_STATUS.md) in the same change.
