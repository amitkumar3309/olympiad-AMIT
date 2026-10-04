# Interaction audit (R1)

_Phase 0 baseline, 2026-10-04, read from the code at `a8bfad0`. Re-verified in Phase 5 after the redesign — the
**Final** column is filled then._

Status key: ✅ works · ⚠️ works but wrong/misleading · ❌ broken · — not yet re-verified.

Paths are relative to `frontend/src/`. Routes are declared only in `App.tsx`; guards live in
`components/ProtectedRoute.tsx`.

## Global greps

| Check | Result |
|---|---|
| `href="#…"` | 1 hit — `components/layout/AppShell.tsx:321` `#main-content`, the skip link (legitimate) |
| `javascript:` | 0 |
| empty `onClick` handlers | 0 (`AiGenerator.tsx:269` `.catch(() => undefined)` is a deliberate fire-and-forget) |
| `to=` / `navigate()` targets not declared as routes | 0 (`/design-system` is dev-only and only linked from itself) |

## Defects found in Phase 0

| # | Where | Problem | Severity | Fix in phase |
|---|---|---|---|---|
| D1 | `pages/DailyChallenge/DailyChallenge.tsx:91-117,301` + `backend/src/routes/v1/dailyChallenge.routes.ts:246-250` | A `fill_blank` daily challenge can never be answered: the page has no text input, and the route drops `textResponse` even though the schema accepts it. The automatic picker does not exclude the type. | **High** — a whole day's quiz can be unanswerable | 2 |
| D2 | `pages/Leaderboard/Leaderboard.tsx:303`, `pages/NotFound/NotFound.tsx:37` | "Sign in" / "My dashboard" link to `/dashboard`; a guest is bounced by `ProtectedRoute` to `/` **without** the sign-in dialog opening | Medium | 5 (and `ProtectedRoute` should send guests to `/#login?next=` — Phase 3 Login Gate work) |
| D3 | `pages/Profile/Profile.tsx:575` | Password hint says "8 characters, a letter and a number"; the real policy also needs upper, lower and a special character, and the form does not check before sending | Medium | 5 |
| D4 | `pages/Landing/Landing.tsx:418` | Four feature cards are `interactive` (hover lift) but do nothing — `Card` documents `interactive` as "only for a card that is genuinely a link" | Low | 3 (landing rebuild) |
| D5 | `pages/Rewards/Rewards.tsx:212-217` | `<Link><Button>` — a button nested in a link (invalid interactive nesting) | Low | 5 |
| D6 | `components/Footer.tsx:53` vs `navigation.ts:104` | Two certificate pages, `/certificate` (footer) and `/my-certificates` (sidebar), both read `/me/certificates` | Low | 5 — pick one, redirect the other |
| D7 | `components/layout/navigation.ts:141` | Admin "Dashboard" item has no permission while its route needs `students:read` (only staff ever see the admin shell, so not reachable as a dead end today) | Low | 5 |
| D8 | `pages/Gallery/Gallery.tsx:104-107` | Lightbox overlay is a clickable `div` with no Escape handling or focus trap (should be `ui/Modal`) | Low | 5 |
| D9 | `context/AuthContext.tsx` session probe (found in Phase 1) | A **signed-out** page logs `401` errors to the console: `GET /auth/me` → 401, then `POST /auth/refresh` → 401 (doubled by React StrictMode in development). The browser logs every failed request as a console error, so the brief's crawler (§9: "no console errors") would fail every public page. Needs a probe that answers a guest without an error status (e.g. a `200 { authenticated: false }` session endpoint) — a backend contract change, so it is decided in Phase 5 rather than slipped in | Medium | 5 |

## Route inventory (52 declared)

Everything is `lazy()` except `Landing`. "Works" = calls real endpoints, no hardcoded data found.

| Path | Component | Guard | Status | Final |
|---|---|---|---|---|
| `/` | Landing | public | ✅ | — |
| `/register` | Register (+ Auth/RegisterForm) | public | ✅ | — |
| `/verify-email` | Auth/VerifyEmail | public | ✅ | — |
| `/forgot-password` | Auth/ForgotPassword | public | ✅ | — |
| `/reset-password` | Auth/ResetPassword | public | ✅ | — |
| `/result` | Result | public | ✅ | — |
| `/certificate` | Certificate | public (guest prompted to sign in) | ⚠️ D6 | — |
| `/leaderboard` | Leaderboard | public | ⚠️ D2 | — |
| `/hall-of-fame` | HallOfFame | public | ✅ | — |
| `/gallery` | Gallery | public | ⚠️ D8 | — |
| `/verify`, `/verify/:code` | Certificates/Verify | public | ✅ | — |
| `/payment` | Payment | ProtectedRoute | ✅ | — |
| `/dashboard` | Dashboard | ProtectedRoute | ✅ | — |
| `/profile` | Profile | ProtectedRoute | ⚠️ D3 | — |
| `/analytics` | Analytics | ProtectedRoute | ✅ | — |
| `/report` | Report | ProtectedRoute | ✅ | — |
| `/practice`, `/practice/:sessionId` | Practice, PracticeSession | ProtectedRoute | ✅ | — |
| `/mock-tests`, `/mock-tests/attempts/:attemptId` | MockTests, MockTestAttempt | ProtectedRoute | ✅ | — |
| `/rewards` | Rewards (XP, badges, achievements, journey) | ProtectedRoute | ⚠️ D5 | — |
| `/referrals` | Referrals | ProtectedRoute | ✅ | — |
| `/daily-challenge` | DailyChallenge | ProtectedRoute | ❌ D1 (fill_blank only) | — |
| `/notifications` | Notifications | ProtectedRoute | ✅ | — |
| `/my-certificates` | Certificates/Certificates | ProtectedRoute | ⚠️ D6 | — |
| `/exam`, `/exam/:attemptId` | Exam/Exams, ExamAttempt | RequirePaidEntry | ✅ | — |
| `/admin` | Admin | RequirePermission `students:read` | ✅ | — |
| `/admin/users` | Admin/Users | `students:read` | ✅ | — |
| `/admin/payments` | Admin/Payments | `students:read` | ✅ | — |
| `/admin/referrals` | Admin/Referrals | `students:read` | ✅ | — |
| `/admin/standings` | Admin/Standings | `students:read` | ✅ | — |
| `/admin/audit-log` | Admin/AuditLog | `audit:read` | ✅ | — |
| `/admin/system` | Admin/System | `content:reset` | ✅ | — |
| `/admin/exams` | Admin/Exams | `exam:write` | ✅ | — |
| `/admin/certificates` | Admin/Certificates | `certificates:write` | ✅ | — |
| `/admin/gallery` | Admin/Gallery | `gallery:write` | ✅ | — |
| `/admin/notifications` | Admin/Notifications | `notifications:write` | ✅ | — |
| `/admin/email-deliveries` | Admin/EmailDeliveries | `notifications:write` | ✅ | — |
| `/admin/analytics` | Admin/Analytics | `analytics:read:any` | ✅ | — |
| `/admin/performance` | Admin/QuestionPerformance | `analytics:read:any` | ✅ | — |
| `/admin/questions` (+ `/new`, `/import`, `/:id/edit`) | Admin/Questions, QuestionForm, QuestionImport | `questions:write` | ✅ | — |
| `/admin/taxonomy` | Admin/Taxonomy | `taxonomy:write` | ✅ | — |
| `/admin/mock-tests` (+ `/new`, `/:id/edit`, `/:id/results`) | Admin/MockTests, MockTestForm, MockTestResults | `mocktests:write` | ✅ | — |
| `/admin/daily-challenges` | Admin/DailyChallenges | `challenges:write` | ✅ | — |
| `/admin/reward-settings` | Admin/RewardSettings | `rewards:write` | ✅ | — |
| `/ai-generator` | AiGenerator | `questions:write` | ✅ | — |
| `/design-system` | DesignSystem | DEV only | ✅ (absent from prod build) | — |
| `*` | NotFound | public | ⚠️ D2 | — |

**Missing routes the spec needs:** `/daily-quiz` (rename of `/daily-challenge`, old path redirects), `/rewards/rules`,
`/privacy`, `/terms`, `/refund-policy`, `/contact`, the 6-month journey page (if approved), a profile
"Daily Quiz history" section. Dashboard sidebar items in the mockup with no route today: **Previous Papers**,
**Concepts**, **Help & Support** → "Soon" pill per §3 unless built.

## Interaction inventory — public surfaces

| Component | Label | Element | Destination / action | Status | Final |
|---|---|---|---|---|---|
| Navbar.tsx:95 | Leaderboard · Hall of Fame · Gallery · Verify a certificate | Link | `/leaderboard` `/hall-of-fame` `/gallery` `/verify` | ✅ | — |
| Navbar.tsx:116 | Admin (if `students:read`) | ButtonLink | `/admin` | ✅ | — |
| Navbar.tsx:121 | Dashboard (student) | ButtonLink | `/dashboard` | ✅ | — |
| Navbar.tsx:125 | Sign out | Button | `logout()` → `/` | ✅ | — |
| Navbar.tsx:131 | Sign in (guest) | ButtonLink | `/#login` (opens dialog) | ✅ | — |
| Navbar.tsx:134 | Register (guest) | ButtonLink | `/register` | ✅ | — |
| Navbar.tsx:166 | Logo | Link | `/` | ✅ | — |
| Navbar.tsx:181/186 | Theme toggle | button | toggle theme | ✅ | — |
| Navbar.tsx:187/214 | Open/Close menu, backdrop | button / div | mobile panel | ✅ | — |
| Footer.tsx:45-47 | Leaderboard · Hall of Fame · Event gallery | Link | routes | ✅ | — |
| Footer.tsx:52-54 | Check a result · Certificate · Verify a certificate | Link | `/result` `/certificate` `/verify` | ⚠️ D6 | — |
| Footer.tsx:59-60 | Sign in · Register | Link | `/#login`, `/register` | ✅ | — |
| Footer.tsx:80 | +91 9782870716 | `tel:` | `tel:+919782870716` | ✅ (differs from mockup — see PLAN §owner questions) | — |
| Footer.tsx:84 | support@amitolympiad.com | `mailto:` | same | ✅ (differs from mockup) | — |
| DeveloperCredit.tsx:38 | Sachin Kukkar | a, new tab, `noopener noreferrer` | sachinkukkar.tech | ✅ | — |
| Landing.tsx:363 / 582 | Register | ButtonLink | `/register` (`?ref=` carried) | ✅ | — |
| Landing.tsx:366 / 585 | Sign in · I already have an account | Button | opens LoginDialog | ✅ | — |
| Landing.tsx:418 | 4 feature cards | Card `interactive` | none | ⚠️ D4 | — |
| Landing.tsx:484 | Verify a certificate | Link | `/verify` | ✅ | — |
| Landing.tsx:539/543 | See the full leaderboard · Hall of Fame | Link | routes | ✅ | — |
| Landing.tsx:565 | FAQ items | details/summary | expand | ✅ | — |
| LoginDialog.tsx:124/132 | Cancel · Sign in | Button / submit | close · `POST /auth/login` → `roleHome()` | ✅ | — |
| LoginDialog.tsx:143 | Send me a new verification link | Link | `/verify-email` | ✅ | — |
| LoginDialog.tsx:178 | Forgot your password? | Link | `/forgot-password` | ✅ | — |
| ForgotPassword / ResetPassword / VerifyEmail | all buttons + links (12) | various | real routes / real endpoints | ✅ | — |
| RegisterForm.tsx:356-728 | Review and continue · error summary · Remove photo · Back · Create my account · I have verified · Resend · support mailto | various | real | ✅ | — |
| Leaderboard.tsx:145-296 | scope, class, period, paging, retry | buttons / select | real | ✅ | — |
| Leaderboard.tsx:303 | Sign in | Link | `/dashboard` | ⚠️ D2 | — |
| HallOfFame.tsx:103/182 | Try again · See the full leaderboard | | | ✅ | — |
| Gallery.tsx:75-107 | item · paging · lightbox close | | | ⚠️ D8 | — |
| NotFound.tsx:32/37 | Go to the home page · My dashboard | ButtonLink | `/` · `/dashboard` | ⚠️ D2 | — |

## Interaction inventory — student surfaces

| Component | Label | Element | Destination / action | Status | Final |
|---|---|---|---|---|---|
| AppShell.tsx:224 | every nav item (16, see below) | Link | declared routes | ✅ | — |
| AppShell.tsx:259 | brand | Link | `/dashboard` | ✅ | — |
| AppShell.tsx:274/332/375/404 | Close menu · Open menu · backdrop · More | button / div | drawer | ✅ | — |
| AppShell.tsx:306/307 | Theme toggle · Sign out | button | | ✅ | — |
| AppShell.tsx:321 | Skip to content | a | `#main-content` | ✅ | — |
| AppShell.tsx:352 | Notifications (N unread) | Link | `/notifications` | ✅ | — |
| AppShell.tsx:393 | bottom bar: Home · Practice · Tests · Challenge | Link | routes | ✅ | — |
| Dashboard.tsx:169-534 | Try again · 3 action cards · Start · Update my profile · See mock tests · Show earlier activity · All rewards · Full board | Link / Button | real | ✅ | — |
| EntryFeeBanner.tsx:65 | Pay ₹… | Link | `/payment` | ✅ | — |
| DailyChallengeCard.tsx:135 | Answer today's challenge / See your answer | ButtonLink | `/daily-challenge` | ✅ | — |
| DailyChallenge.tsx:151-301 | retry · Go to my profile · Practise · options · True/False · Submit answer | | | ❌ D1 | — |
| Profile.tsx:305-665 | photo, edit, save, cancel, change password, sign out everywhere, prefs, admin link | | | ⚠️ D3 | — |
| Rewards.tsx:69 | Try again | Button | | ✅ | — |
| Rewards.tsx:212-216 | Earn some XP · Today's challenge | `<Link><Button>` | `/practice`, `/daily-challenge` | ⚠️ D5 | — |

Student navigation (`navigation.ts:70-130`): Dashboard · Practice Zone · Mock Tests · Daily Challenge ·
Performance · Printable report · XP & badges · Leaderboard · Hall of Fame · Official Olympiad (padlock if unpaid) ·
Entry fee & receipts · Result · Certificates · Refer & Earn · Notifications · My Profile. All resolve.

## Interaction inventory — admin surfaces

Admin navigation (`navigation.ts:141-227`): 25 items across Students / Question bank / Assessments / Insights /
Communication / Settings / System, each filtered by its permission; all resolve to declared routes (D7 aside).
Admin page internals were not itemised in Phase 0 — the admin area is not being redesigned, and Phase 5's crawler
covers its links. Rows will be added for the new Daily Quiz admin screens in Phase 2.
