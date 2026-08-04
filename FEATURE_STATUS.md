# FEATURE_STATUS.md

Status values: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED` (works end-to-end, verified by reading the actual data path — not just "a page exists"), `TESTED` (has automated test coverage), `DEPLOYED` (live in production).

A UI page existing with hardcoded/mock data is recorded as its own row/note — it does **not** count as `IMPLEMENTED` for the underlying feature.

| Feature | Frontend | Backend | Database | Testing | Notes |
|---|---|---|---|---|---|
| Registration | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | NOT_STARTED | Real end-to-end: form → `/api/auth/register` → `Student` doc → JWT cookie. "OTP" step before it is fake (see Email verification). |
| Login | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | NOT_STARTED | `/api/auth/login`, bcrypt compare, JWT cookie. |
| Logout | IMPLEMENTED | IMPLEMENTED | N/A | NOT_STARTED | Clears cookie. |
| Email verification | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No email field on `Student` at all. "OTP" UI is a hardcoded client-side literal (`123456`), no SMS/email provider. |
| Forgot password | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No route, no UI. |
| Reset password | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Depends on Forgot password. |
| Student profile | NOT_STARTED | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `Student` model stores `fullName`/`mobile`/`studentId` only; no profile page/edit UI. |
| Admin authentication | IMPLEMENTED | IMPLEMENTED | N/A (env-based) | NOT_STARTED | Single admin account via `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` env vars, no admin registration flow (intentional). |
| RBAC | IMPLEMENTED | IMPLEMENTED | N/A | NOT_STARTED | Two roles (`student`, `admin`) enforced via JWT payload + `requireAuth(...roles)`. No finer-grained permissions. |
| Student dashboard | IN_PROGRESS | NOT_STARTED | N/A | NOT_STARTED | Page exists (`Dashboard.tsx`), shows real logged-in student name/ID, but leaderboard + stat tiles are hardcoded constants, not fetched. |
| Admin dashboard | IN_PROGRESS | NOT_STARTED | N/A | NOT_STARTED | Page exists (`Admin.tsx`), auth is real, but the students table and weekly-accuracy chart are hardcoded constants — no "list students" route exists. |
| Student management | NOT_STARTED | NOT_STARTED | N/A | NOT_STARTED | No route to list/search/edit/delete students. Table shown in Admin UI is 4 fake rows. |
| Question bank | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | NOT_STARTED | `GET /api/questions` reads real `Question` docs; questions are created only via the AI generator route. No manual question CRUD UI. |
| Subjects | NOT_STARTED | IN_PROGRESS | IN_PROGRESS | NOT_STARTED | `subject` is a free-text field on `Question`, no dedicated Subject model/list/admin UI. |
| Topics | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No `topic` field persisted on `Question` at all (the generator takes a `topic` input but never saves it to the schema). |
| Daily challenge | NOT_STARTED | IN_PROGRESS | NOT_STARTED | NOT_STARTED | `GET /api/daily-challenge` returns a hardcoded object, no model, **not called by any frontend page**. |
| Practice zone | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No route, no page. |
| Mock tests | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Distinct from "Exam" below; not present at all. |
| Attempts (exam) | IN_PROGRESS | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `Exam.tsx` is a fully client-side 5-question hardcoded quiz; nothing is ever sent to the server. `ExamAttempt` model exists but no route reads/writes it. |
| Results | IN_PROGRESS | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `Result.tsx` fabricates a deterministic fake result from a hash of the entered Student ID (`mockLookup`), entirely client-side. `Result` model exists but unused. |
| XP | NOT_STARTED | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `xpEarned` field exists on unused `Result` model; `rewardXP` appears in the hardcoded daily-challenge mock. No real accrual logic anywhere. |
| Levels | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Badges | NOT_STARTED | NOT_STARTED | IN_PROGRESS | NOT_STARTED | `badges: [String]` field exists on unused `Result` model; UI shows static badge strings on the Landing page champions list only. |
| Achievements | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Journey map | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Leaderboards | IN_PROGRESS | IN_PROGRESS | NOT_STARTED | NOT_STARTED | `GET /api/leaderboard` returns a hardcoded array with no model backing it; frontend never calls it (uses its own separate hardcoded arrays instead). |
| Certificates | IN_PROGRESS | IN_PROGRESS | NOT_STARTED | NOT_STARTED | `Certificate.tsx` renders a printable certificate client-side from the logged-in student's real name/ID (no server-issued cert data). `GET /api/certificates/:studentId` returns an unrelated hardcoded mock array and is never called by the frontend. |
| Notifications | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Gallery | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not present. |
| Hall of Fame | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | The Landing page "Today's Champions" section is the closest analog, entirely hardcoded, no dedicated page. |
| Analytics | IN_PROGRESS | IMPLEMENTED | IMPLEMENTED | NOT_STARTED | Route + model are real, but nothing in the app ever creates a `StudentAnalytics` document, so real students only ever see the built-in mock fallback. See AI performance analytics. |
| AI performance analytics | IN_PROGRESS | IMPLEMENTED | IMPLEMENTED | NOT_STARTED | `generateAIInsights()` is real rule-based logic (not an LLM/ML call), runs only on the (currently unreachable) real-data path. The "AI Question Generator" is a template-string generator, not a call to any AI model/API — no AI provider is integrated anywhere in the codebase despite the naming. |
| Payments | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Static QR code image only; no gateway, no order/transaction record, no verification before registration completes. |
| Subscriptions | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | Not applicable yet — one-time registration only. |
| Settings | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No account settings page for student or admin. |
| Audit logs | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | No admin action logging. |
| Security (baseline hardening) | N/A | IN_PROGRESS | N/A | NOT_STARTED | Real bcrypt+JWT, but missing rate limiting, security headers, input sanitization in places — see [`SECURITY.md`](SECURITY.md). |
| Deployment | IMPLEMENTED | IMPLEMENTED | N/A | NOT_STARTED | Both apps have working Vercel configs (per git history, deploy issues were fixed already). Not verified live in this audit — owner should confirm both projects are currently deployed and the Atlas cluster is live. |

## Summary counts

- IMPLEMENTED end-to-end: Registration, Login, Logout, Admin auth, RBAC, Question bank (read), Deployment config.
- Mostly mock/frontend-only despite a real-looking page: Student dashboard, Admin dashboard, Exam/Attempts, Results, Certificates, Leaderboards, Daily challenge, Analytics (fallback path).
- Not started at all: Email verification, Password reset, Student profile editing, Student management (admin CRUD), Subjects/Topics as real entities, Practice zone, Mock tests, XP/Levels/Badges/Achievements/Journey map, Notifications, Gallery, Hall of Fame, Payments, Subscriptions, Settings, Audit logs.
