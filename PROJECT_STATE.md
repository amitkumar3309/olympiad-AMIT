# PROJECT_STATE.md

_Last audited: 2026-08-04 (Phase 0 repository audit, no code changes made)._

This file is the current snapshot. History belongs in [`CHANGELOG.md`](CHANGELOG.md). If this file and the code disagree, trust the code and fix this file.

## Current Development Phase

**Phase 0 — Repository audit complete.** No new product features have been implemented in this session. The codebase was inherited from prior sessions (see `git log`) as a working demo/MVP with a real auth backbone but mostly mock/static product data.

## Last Completed Milestone

Commit `9dbdf27` — "Rebuild frontend in React, add real authentication, split into separate services." The project was rebuilt from an earlier (pre-React) form into: a React SPA (`frontend/`) + an Express/Mongoose API (`backend/`), with real bcrypt+JWT student and admin authentication, deployed as two separate Vercel projects.

## Current Milestone

Not yet defined by the owner. Recommended next milestone (pending approval — see end of audit report given in chat): decide which mock features become real first (likely leaderboard + exam submission + results, since the DB models already half-exist).

## Completed Modules (real, end-to-end)

- **Student registration** — `POST /api/auth/register`, writes to MongoDB, hashes password, issues JWT cookie.
- **Student login/logout/session check** — `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`.
- **Admin login** — single hardcoded-via-env admin account, JWT cookie, role-gated.
- **Route protection** — `ProtectedRoute` / `AdminRoute` on the frontend, `requireAuth()` on the backend.
- **AI Question Generator (partial)** — admin-only endpoint really writes generated question documents to MongoDB. The "AI" itself is a template-string generator, not a real model call (see [`FEATURE_STATUS.md`](FEATURE_STATUS.md)).
- **Question listing** — `GET /api/questions` really reads from MongoDB.

## Partially Completed Modules

- **Student analytics** — real Mongoose model + route (`GET /api/analytics/:studentId`), but falls back to hardcoded mock data when no `StudentAnalytics` document exists for a student — and **nothing in the codebase ever creates a `StudentAnalytics` document**, so every real student currently only ever sees the mock fallback.
- **AI insights** — `generateAIInsights()` is real logic (rule-based, not ML) but only runs on the (currently unreachable) real-data path.

## Pending / Not Started Modules (UI exists, no real backend wiring)

- **Exam / exam attempts** — `Exam.tsx` is a fully client-side, hardcoded 5-question quiz. `ExamAttempt` Mongoose model exists but no route ever reads/writes it. Nothing is submitted to the server.
- **Results** — `Result.tsx` computes a fake result by hashing the entered Student ID client-side (`mockLookup`). `Result` Mongoose model exists but is unused by any route.
- **Certificates** — `Certificate.tsx` renders a printable certificate from the logged-in student's name/ID only; the backend's `GET /api/certificates/:studentId` (hardcoded mock array) is never called by the frontend.
- **Leaderboard** — hardcoded in both `Landing.tsx` and `Dashboard.tsx`; the backend's `GET /api/leaderboard` (hardcoded mock) exists but is **never called** by the frontend.
- **Daily challenge** — backend route `GET /api/daily-challenge` (hardcoded mock) exists, **no frontend page calls it at all**.
- **Payments** — Landing page shows a static QR image and a button that immediately calls `register()` — there is no real payment gateway integration, no payment verification, no order/transaction record anywhere.
- **OTP / mobile verification** — frontend-only fake, hardcoded literal `'123456'`; no SMS provider integrated; backend never asked to verify anything.
- **Admin student management** — `Admin.tsx` table is a hardcoded 4-row array, not a fetch from `Student` collection. No route exists to list students at all.
- **XP / Levels / Badges / Achievements / Journey map / Gallery / Hall of Fame / Notifications / Audit logs / Subscriptions** — not started. No models, no routes, no UI beyond scattered decorative mentions (e.g., "XP" numbers hardcoded in UI copy).

## Current Frontend State

React 19 SPA, 9 routes (`/`, `/result`, `/certificate`, `/admin`, `/ai-generator`, `/dashboard`, `/analytics`, `/report`, `/exam`). Visually complete/polished for these routes; several pull from hardcoded arrays instead of the API. No page for a public daily-challenge/leaderboard view even though the backend has endpoints for them.

## Current Backend State

Single-file Express app (`backend/src/server.ts`, ~450 lines). Connects to MongoDB on cold start (Vercel-serverless-friendly `readyState` check). 5 Mongoose models declared; 2 of them (`ExamAttempt`, `Result`) are dead code today (defined, never used by any route). 11 routes total, of which 3 are pure hardcoded-mock endpoints with no DB access and no auth (`/api/daily-challenge`, `/api/leaderboard`, `/api/certificates/:studentId`).

## Current Database State

MongoDB (via `MONGO_URI`, defaults to `mongodb://localhost:27017/amit-olympiad` if unset). No migrations tooling, no seed script, no indexes beyond Mongoose's implicit `unique: true` on `Student.mobile`. Nobody has confirmed (in this audit) whether a real Atlas cluster is currently provisioned — the owner should confirm this (see beginner-instructions section of the audit reply).

## Current Authentication State

Real for both roles. Known weaknesses (see [`SECURITY.md`](SECURITY.md)): JWT falls back to an insecure default secret if `JWT_SECRET` is unset (only warns, doesn't refuse to start); no rate limiting on login/register; no account lockout; no password reset flow at all (`PROJECT_STATE.md` / `FEATURE_STATUS.md`: NOT_STARTED); no email verification (no email field even exists on `Student`).

## Current Payment State

None. No provider selected, no code, no `DECISIONS.md` entry yet. Purely a static QR image with no linkage to the registration transaction.

## Current Deployment State

Two independent Vercel projects:
- `backend/` — deployed as a serverless function (`api/index.ts` → Express app via `@vercel/node`), `vercel.json` rewrites everything to `/api`.
- `frontend/` — static Vite build, `vercel.json` rewrites `/api/*` to a **hardcoded** production backend URL (`https://amit-olympiad.vercel.app/api/$1`) and everything else to `index.html` (SPA fallback).
Local dev: Vite dev server proxies `/api` to `http://localhost:8081` (`vite.config.ts`); `.claude/launch.json` runs the backend on port 8081 and frontend on 5173.

## Important File Locations

| Concern | Location |
|---|---|
| All backend logic | [backend/src/server.ts](backend/src/server.ts) |
| Vercel serverless entry | [backend/api/index.ts](backend/api/index.ts) |
| Frontend routes | [frontend/src/App.tsx](frontend/src/App.tsx) |
| API fetch wrapper | [frontend/src/api/client.ts](frontend/src/api/client.ts) |
| Session/auth state | [frontend/src/context/AuthContext.tsx](frontend/src/context/AuthContext.tsx) |
| Route guards | [frontend/src/components/ProtectedRoute.tsx](frontend/src/components/ProtectedRoute.tsx) |
| Dev server config | [.claude/launch.json](.claude/launch.json) |

## Current Environment Requirements

Backend needs `MONGO_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, optionally `FRONTEND_URL`, `PORT`, `NODE_ENV`. Frontend needs no env vars (all API calls are relative paths). No `.env.example` exists yet for either app. Full detail in [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

## Known Bugs

1. **`studentId` collision risk** — generated as `AMIT_${Math.floor(Math.random()*10000)}` with no uniqueness check or DB constraint; two students can end up with the same ID.
2. **Analytics never persisted** — `generateAIInsights()` mutates a Mongoose document's `aiInsights` in memory but never calls `.save()`; harmless today only because the real-data branch is unreachable (see Partially Completed Modules above), but will silently no-op once analytics data starts being written.
3. **Potential NoSQL-injection-shaped query** in `GET /api/questions` — `req.query` fields are assigned directly into the Mongoose filter object without sanitization (see [`SECURITY.md`](SECURITY.md)).
4. **Permissive CORS fallback** — if `FRONTEND_URL` is not set in production, CORS `origin` becomes `true` (reflects any origin) while `credentials: true` — broader than intended.
5. **Dead models** — `ExamAttempt` and `Result` schemas exist with no route ever touching them; safe but misleading if not flagged.

## Technical Debt

- Entire backend in one file; no `models/`/`routes/` separation.
- No tests, no CI.
- No `.env.example` for either app.
- Hardcoded production backend URL inside `frontend/vercel.json` instead of an env-driven rewrite.
- Mixed English/Hindi user-facing error strings in backend (`"Kuch gadbad ho gayi"`) — inconsistent tone, not itself a bug but worth a deliberate decision if the app is meant to be bilingual.

## Immediate Next Task

Awaiting owner decision (see audit reply). No implementation should start until the owner picks a milestone from the "Recommended development order" list in the audit reply.

## Recent Architectural Decisions

See [`DECISIONS.md`](DECISIONS.md) for the full ADR log. Most recent: splitting frontend/backend into two independently deployed services (commit `9dbdf27`).
