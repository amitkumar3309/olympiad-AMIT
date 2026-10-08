# Interaction audit (R1)

_Phase 0 baseline, 2026-10-04, read from the code at `a8bfad0`. **Re-verified in Phase 5 (2026-10-05)** — the
**Final** column; how, in the next section. **Phase 6 (2026-10-05)** added axe on every crawled page and a
keyboard suite: D17 is resolved, and D18–D21 were found and fixed. Its follow-up measured interactions
(INP) and found D22–D23._

Status key: ✅ works · ⚠️ works but wrong/misleading · ❌ broken · — not yet re-verified.

Paths are relative to `frontend/src/`. Routes are declared only in `App.tsx`; guards live in
`components/ProtectedRoute.tsx`.

## How Phase 5 verified it

- **Lint** — `npm run lint` in `frontend/` runs oxlint with its `jsx-a11y` rules and
  `scripts/check-handlers.mjs`: no `href="#"`, no `javascript:`, no handler that does nothing, no
  click handler on a non-interactive element, no unlabelled control. It fails the build on one
  (checked by planting one of each).
- **The link crawler** — `e2e/crawler.spec.ts`, part of `npm run e2e`. **Guest** from `/`: 19 pages.
  **Student** from `/dashboard` and `/`: 27 pages. Both identical at 1280px and 390px. **Administrator**
  from `/admin`: 51 pages at 1280px, including a question's edit page and a quiz's page on the seeded
  data. On every page: not the 404 page, no console error, no uncaught exception, no failed or ≥400
  request, no dead link, no new-tab link without `noopener noreferrer`, every rendered control named,
  and at 390px every button at least 44×44px; every `tel:` and `mailto:` is the owner's. The pages each
  crawl reached are written to `test-results/<test>/visited.txt`.
- **The flows** — `daily-quiz.spec.ts`, `homepage.spec.ts` and `dashboard.spec.ts`, at both widths, click
  through the quiz, the Login Gate, register → verify → quiz, the guarded-page hand-over, the bell,
  the account menu, the drawer and the bottom bar. 24 passed, 2 skipped by design (4.2 minutes),
  against a production build of the frontend.
- **By hand, in Edge** (local servers): the routes no link reaches (`/reset-password`, `/verify-email`,
  `/certificate`, `/daily-challenge`, an unknown path) as a guest and as a student; the reset form's
  validation; the profile's password form at 390 and 1280; Enter on the four admin settings forms,
  with every write intercepted so the database was not touched.
- **States** — hover, `:focus-visible`, active, disabled and loading come from `ui/Button` and the one
  global focus ring in `base.css`; every asynchronous submit passes `loading` (spinner, `aria-busy`,
  disabled — no double submission). The search and filter forms have nothing to wait for.
- **Not machine-verified**: pages that need a record the test database does not hold — a practice
  session, a mock-test attempt, an exam attempt, a certificate code, a mock test's edit and results
  pages. Their entry links were ✅ in Phase 0 and nothing in Phase 5 touched them.

## Global greps

| Check | Result |
|---|---|
| `href="#…"` | 1 hit — `components/layout/AppShell.tsx:321` `#main-content`, the skip link (legitimate). **Phase 5: `href="#"` itself fails `npm run lint`** |
| `javascript:` | 0 — **fails `npm run lint` since Phase 5** |
| empty `onClick` handlers | 0 (`AiGenerator.tsx:269` `.catch(() => undefined)` is a deliberate fire-and-forget). **Phase 5:** two empty `onChange`s on `ui/OptionTile` groups removed (the prop is optional now); any no-op handler fails `npm run lint` |
| `to=` / `navigate()` targets not declared as routes | 0 (`/design-system` is dev-only and only linked from itself). **Phase 5: the crawler found no link to a missing route** |

## Defects found in Phase 0

| # | Where | Problem | Severity | Fix in phase |
|---|---|---|---|---|
| D1 | `pages/DailyChallenge/DailyChallenge.tsx:91-117,301` + `backend/src/routes/v1/dailyChallenge.routes.ts:246-250` | A `fill_blank` daily challenge can never be answered: the page has no text input, and the route drops `textResponse` even though the schema accepts it. The automatic picker does not exclude the type. | **High** — a whole day's quiz can be unanswerable | ✅ **Resolved in Phase 2** — the page and the automatic picker are gone; a Daily Quiz is single choice by construction (`quizQuestionProblem()`) |
| D2 | `pages/Leaderboard/Leaderboard.tsx:303`, `pages/NotFound/NotFound.tsx:37` | "Sign in" / "My dashboard" link to `/dashboard`; a guest is bounced by `ProtectedRoute` to `/` **without** the sign-in dialog opening | Medium | ✅ **Resolved in Phase 3** — `ProtectedRoute` and `RequirePaidEntry` send a guest to `/?next=<page>#login`: the sign-in dialog opens and signing in returns to the page (E2E `homepage.spec.ts`). The two `/dashboard` links now reach the dialog that way |
| D3 | `pages/Profile/Profile.tsx:575` | Password hint says "8 characters, a letter and a number"; the real policy also needs upper, lower and a special character, and the form does not check before sending | Medium | ✅ **Resolved in Phase 5** — `components/PasswordRules` (the live checklist) under all four forms that set a password — registration, the reset link, the forced change, the profile — and each checks with `passwordProblem()` before sending; the profile's hint and the forced change's old letter-and-number check are gone. The profile's three fields are `ui/PasswordInput` now (D15) |
| D4 | `pages/Landing/Landing.tsx:418` | Four feature cards are `interactive` (hover lift) but do nothing — `Card` documents `interactive` as "only for a card that is genuinely a link" | Low | ✅ **Resolved in Phase 3** — every About card is a real link (Practice, Mock tests, Insights) or runs the Daily Quiz flow |
| D5 | `pages/Rewards/Rewards.tsx:212-217` | `<Link><Button>` — a button nested in a link (invalid interactive nesting) | Low | ✅ **Resolved in Phase 5** — two `ButtonLink`s |
| D6 | `components/Footer.tsx:53` vs `navigation.ts:104` | Two certificate pages, `/certificate` (footer) and `/my-certificates` (sidebar), both read `/me/certificates` | Low | ✅ **Resolved in Phase 5** — `/certificate` redirects to `/my-certificates` (a guest is asked to sign in first), the footer links there, and the old page is deleted |
| D7 | `components/layout/navigation.ts:141` | Admin "Dashboard" item has no permission while its route needs `students:read` (only staff ever see the admin shell, so not reachable as a dead end today) | Low | ✅ **Resolved in Phase 5** — the item carries `permission: 'students:read'` |
| D8 | `pages/Gallery/Gallery.tsx:104-107` | Lightbox overlay is a clickable `div` with no Escape handling or focus trap (should be `ui/Modal`) | Low | ✅ **Resolved in Phase 5** — a `ui/Modal` (Escape, focus trap, focus returns to the photo); the last `#fff` in `src/` went with it |
| D9 | `context/AuthContext.tsx` session probe (found in Phase 1) | A **signed-out** page logs `401` errors to the console: `GET /auth/me` → 401, then `POST /auth/refresh` → 401 (doubled by React StrictMode in development). The browser logs every failed request as a console error, so the brief's crawler (§9: "no console errors") would fail every public page. Needs a probe that answers a guest without an error status (e.g. a `200 { authenticated: false }` session endpoint) — a backend contract change, so it is decided in Phase 5 rather than slipped in | Medium | ✅ **Resolved in Phase 5** — `GET /auth/session` answers a guest `200 { authenticated: false, canRefresh }`; `AuthContext` refreshes only when there is a refresh cookie, and falls back to `/auth/me` on a `404` (a backend deployed after its frontend). The crawler finds no console error on any page |
| D10 | `context/AuthContext.tsx` `login()` + `backend/src/routes/v1/auth.routes.ts` (found by the Phase 5 admin crawl) | **On a brand-new database the root administrator cannot be provisioned from the sign-in dialog.** `/auth/login` hands over to `/auth/admin/login` (`ADMIN_PORTAL_REQUIRED`) only for a super-admin account that already exists, and the account is created by its first sign-in at `/auth/admin/login` — which since Milestone 28 has no form of its own. Production is unaffected: its administrator exists. A new environment (staging, a restored backup without it) is not | Medium | ✅ **Fixed in Phase 7a** (owner's yes, 2026-10-08): `/auth/login` answers `ADMIN_PORTAL_REQUIRED` for the configured `ADMIN_EMAIL` once the password matches `ADMIN_PASSWORD_HASH`, before the account exists — still never to somebody who is guessing (`isRootBootstrapCredentials()`, two tests) |
| D11 | `pages/Admin/Users.tsx` (Phase 5 admin crawl) | The directory asked for a photo for every row; every account without one — the root administrator's always — was a 404 in the console on each visit | Low | ✅ **Resolved in Phase 5** — `hasPhoto` on `GET /admin/students`; the photo is asked for only when it exists |
| D12 | `pages/AiGenerator/AiGenerator.tsx` + `GET /admin/question-generator/models` (Phase 5 admin crawl) | With no `GEMINI_API_KEY` the model list answered **500**, on every visit | Low | ✅ **Resolved in Phase 5** — `503` naming the variable, as generation answers; the page asks only when a key is configured |
| D13 | `ThemeToggle`, `ui/PasswordInput`, `layout/AccountMenu` (Phase 5 crawl at 390px) | Three icon-only controls under 44px wide on a touch screen: the theme switch (34px), the password eye and the account chip (40px) — the base rule gives every button a 44px height, not a width | Low | ✅ **Resolved in Phase 5** — 44×44 under `pointer: coarse`; the password field's padding grows with its eye |
| D14 | `components/ui/Input.tsx` (seen in a Phase 5 screenshot) | Microsoft Edge drew its own reveal eye beside `PasswordInput`'s — two eyes in every password field | Low | ✅ **Resolved in Phase 5** — `::-ms-reveal` hidden for `PasswordInput` only |
| D15 | `pages/Profile/Profile.tsx` | The password change used three plain password inputs (no show/hide), against CLAUDE.md's rule | Low | ✅ **Resolved in Phase 5** — `ui/Field` + `ui/PasswordInput` |
| D16 | `pages/Admin/{DailyQuiz,Payments,Referrals,RewardSettings}.tsx`, `MockTestForm.tsx` | Four settings screens saved on a click only (Enter did nothing), and several saves had no spinner | Low | ✅ **Resolved in Phase 5** — real forms (`type="submit"`), `loading` on every save. The mock-test editor stays click-to-save on purpose: an editor full of search fields, where Enter-to-save would surprise |
| D17 | `context/AuthContext.tsx` (pre-existing) | A failed session check at page load — offline, a 5xx, a 429 — is treated as signed out, so a signed-in student on a guarded page is sent to the sign-in dialog. `/auth/me` behaved the same before Phase 5 | Low | ✅ **Resolved in Phase 6** — a failure that may pass (no answer, a timeout, a 5xx, a 429) is retried twice, after 1 s and 3 s, before the visitor is read as signed out; a 4xx is an answer and is not retried. `e2e/resilience.spec.ts` fails the first check and expects the student to stay on their page |
| D18 | `components/Navbar.tsx`; `pages/Gallery`, `pages/Certificates/Verify`, `pages/NotFound` (Phase 6 crawler check) | The public pages had no "Skip to content" link — only the app shell had one — and three public pages had no `#main-content` for one to land on | Low | ✅ **Resolved in Phase 6** — `ui/SkipLink` (a primitive now, shared with the shell) in the public header; `id="main-content"` on every page's main region. The crawler fails on a page without either, and `keyboard.spec.ts` checks the first Tab reaches it |
| D19 | `components/ChartCard.tsx` (axe, `role-img-alt`) | `react-chartjs-2` gives its canvas a `role="img"` of its own, so inside the card's labelled image a reader met a second, nameless one | Low | ✅ **Resolved in Phase 6** — the canvas is `aria-hidden`; the wrapper carries the summary and the numbers are in the table beside it |
| D20 | `pages/Rewards/Rewards.tsx` + `.module.css` (axe, `color-contrast`) | Unearned badges and locked achievements faded the **whole** card, which took their descriptions — how to earn them — below 4.5:1; "earned" was said by a tick alone | Low | ✅ **Resolved in Phase 6** — only the icon fades; "Earned" and "Progress:" are in the text for a screen reader |
| D21 | `pages/Admin/QuestionImport.tsx` (Phase 6 review of `role="tab"`) | The file-format choice was marked up as tabs (`role="tab"`, `aria-selected`) with no panels, `aria-controls` or arrow keys — the defect CLAUDE.md's `Tabs` rule names | Low | ✅ **Resolved in Phase 6** — a labelled group of pressed buttons ("File format", `aria-pressed`), the filter pattern |
| D22 | `context/ThemeContext.tsx` (Phase 6 follow-up, `e2e/responsiveness.spec.ts`) | The theme switch took ~390 ms to show anything on a phone slowed 4× — React applies the class in an effect before a click's next frame, and restyling the whole homepage is the slow part | Medium | ✅ **Resolved in the Phase 6 follow-up** — a change is applied after the next paint: the switch flips at once (24 ms), the page recolours a moment later |
| D23 | `pages/Landing/Landing.tsx` (same test) | Opening the sign-in dialog re-rendered every section of the homepage (the dialog's open state lives in `Landing`) — ~220 ms | Low | ✅ **Resolved in the Phase 6 follow-up** — the page is memoised on what its sections read; opening a dialog renders the dialog (168–184 ms) |

## Route inventory (52 declared)

Everything is `lazy()` except `Landing`. "Works" = calls real endpoints, no hardcoded data found.

| Path | Component | Guard | Status | Final |
|---|---|---|---|---|
| `/` | Landing | public | ✅ | ✅ crawled — guest, student, admin; 1280 + 390 |
| `/register` | Register (+ Auth/RegisterForm) | public | ✅ | ✅ crawled; E2E registers through it |
| `/verify-email` | Auth/VerifyEmail | public | ✅ | ✅ E2E (register → verify); a bad token by hand |
| `/forgot-password` | Auth/ForgotPassword | public | ✅ | ✅ crawled (guest) |
| `/reset-password` | Auth/ResetPassword | public | ✅ | ✅ by hand — checklist, inline errors, no request until valid, Enter, the server's refusal shown (only an email links here) |
| `/result` | Result | public | ✅ | ✅ crawled |
| `/certificate` | redirect → `/my-certificates` (Phase 5) | ProtectedRoute | ✅ | ✅ D6 — redirects to `/my-certificates` (by hand, guest and student) |
| `/leaderboard` | Leaderboard | public | ✅ D2 resolved | ✅ crawled (also `?scope=class&period=daily`) |
| `/hall-of-fame` | HallOfFame | public | ✅ | ✅ crawled |
| `/gallery` | Gallery | public | ✅ D8 resolved | ✅ crawled; the lightbox is `ui/Modal` (D8) |
| `/verify`, `/verify/:code` | Certificates/Verify | public | ✅ | ✅ crawled (`/verify`); `/verify/:code` needs a certificate — not reached |
| `/payment` | Payment | ProtectedRoute | ✅ | ✅ crawled (student; a guest gets the sign-in dialog) |
| `/dashboard` | Dashboard | ProtectedRoute | ✅ | ✅ crawled + E2E |
| `/profile` | Profile | ProtectedRoute | ✅ D3 resolved | ✅ crawled; D3 and D15 resolved |
| `/analytics` | Analytics | ProtectedRoute | ✅ | ✅ crawled |
| `/report` | Report | ProtectedRoute | ✅ | ✅ crawled (student, admin) |
| `/practice`, `/practice/:sessionId` | Practice, PracticeSession | ProtectedRoute | ✅ | ✅ crawled (`/practice`); a session needs published questions — not reached |
| `/mock-tests`, `/mock-tests/attempts/:attemptId` | MockTests, MockTestAttempt | ProtectedRoute | ✅ | ✅ crawled (the list); an attempt needs a mock test — not reached |
| `/rewards` | Rewards (XP, badges, achievements, journey) | ProtectedRoute | ✅ D5 resolved | ✅ crawled; D5 resolved |
| `/referrals` | Referrals | ProtectedRoute | ✅ | ✅ crawled |
| `/daily-quiz` | DailyQuiz | ProtectedRoute | ✅ (Phase 2; E2E at desktop + 390px) | ✅ crawled + E2E |
| `/daily-challenge` | redirect → `/daily-quiz` | — | ✅ | ✅ redirects (by hand) |
| `/notifications` | Notifications | ProtectedRoute | ✅ | ✅ crawled |
| `/my-certificates` | Certificates/Certificates | ProtectedRoute | ✅ D6 resolved | ✅ crawled; the one certificates page (D6) |
| `/exam`, `/exam/:attemptId` | Exam/Exams, ExamAttempt | RequirePaidEntry | ✅ | ✅ crawled (`/exam`); an attempt needs an exam — not reached |
| `/admin` | Admin | RequirePermission `students:read` | ✅ | ✅ crawled (admin, 1280) |
| `/admin/users` | Admin/Users | `students:read` | ✅ | ✅ crawled; D11 resolved |
| `/admin/payments` | Admin/Payments | `students:read` | ✅ | ✅ crawled; Enter saves (D16) |
| `/admin/referrals` | Admin/Referrals | `students:read` | ✅ | ✅ crawled; Enter saves (D16) |
| `/admin/standings` | Admin/Standings | `students:read` | ✅ | ✅ crawled |
| `/admin/audit-log` | Admin/AuditLog | `audit:read` | ✅ | ✅ crawled |
| `/admin/system` | Admin/System | `content:reset` | ✅ | ✅ crawled |
| `/admin/exams` | Admin/Exams | `exam:write` | ✅ | ✅ crawled |
| `/admin/certificates` | Admin/Certificates | `certificates:write` | ✅ | ✅ crawled |
| `/admin/gallery` | Admin/Gallery | `gallery:write` | ✅ | ✅ crawled |
| `/admin/notifications` | Admin/Notifications | `notifications:write` | ✅ | ✅ crawled |
| `/admin/email-deliveries` | Admin/EmailDeliveries | `notifications:write` | ✅ | ✅ crawled |
| `/admin/analytics` | Admin/Analytics | `analytics:read:any` | ✅ | ✅ crawled |
| `/admin/performance` | Admin/QuestionPerformance | `analytics:read:any` | ✅ | ✅ crawled |
| `/admin/questions` (+ `/new`, `/import`, `/:id/edit`) | Admin/Questions, QuestionForm, QuestionImport | `questions:write` | ✅ | ✅ crawled — all four, `/:id/edit` on the seeded quiz question |
| `/admin/taxonomy` | Admin/Taxonomy | `taxonomy:write` | ✅ | ✅ crawled |
| `/admin/mock-tests` (+ `/new`, `/:id/edit`, `/:id/results`) | Admin/MockTests, MockTestForm, MockTestResults | `mocktests:write` | ✅ | ✅ crawled (the list and `/new`); `/:id/*` need a mock test — not reached |
| `/admin/daily-quiz` | Admin/DailyQuiz | `challenges:write` | ✅ (Phase 2) | ✅ crawled; Enter saves the settings (D16) |
| `/admin/daily-quiz/:groupId` | Admin/DailyQuizDetail | `challenges:write` | ✅ (Phase 2) | ✅ crawled (the seeded quiz) |
| `/admin/daily-challenges` | redirect → `/admin/daily-quiz` | — | ✅ | ✅ a redirect, linked from nowhere — unchanged since Phase 2 |
| `/admin/reward-settings` | Admin/RewardSettings | `rewards:write` | ✅ | ✅ crawled; Enter saves (D16) |
| `/ai-generator` | AiGenerator | `questions:write` | ✅ | ✅ crawled; D12 resolved |
| `/design-system` | DesignSystem | DEV only | ✅ (absent from prod build) | ✅ absent from production — not crawled |
| `*` | NotFound | public | ✅ D2 resolved | ✅ by hand — an unknown path renders the 404 page naming it; its links crawled |
| `/rewards/rules` | Legal/RewardsRules (Phase 3) | public | ✅ | ✅ crawled (guest, student) |
| `/privacy`, `/terms`, `/refunds`, `/contact` | Legal pages (Phase 3, `TODO(legal-review)`) | public | ✅ | ✅ crawled (guest, student) |
| `/activity` | Activity (Phase 4) | ProtectedRoute | ✅ | ✅ crawled + E2E |
| `/dev/ui` | DesignSystem (Phase 1 alias) | DEV only | ✅ | ✅ absent from production — not crawled |

**Missing routes the spec needs:** ~~`/daily-quiz`~~ and ~~the profile "Daily Quiz history"~~ (both done in
Phase 2), `/rewards/rules`, `/privacy`, `/terms`, `/refund-policy`, `/contact`, the 6-month journey page (if approved). Dashboard sidebar items in the mockup with no route today: **Previous Papers**,
**Concepts**, **Help & Support** → "Soon" pill per §3 unless built. *Phase 4: Help & Support is `/contact`;
Previous Papers and Concepts are `soon` items — labels with a "Soon" pill, never links.*

## Interaction inventory — public surfaces

| Component | Label | Element | Destination / action | Status | Final |
|---|---|---|---|---|---|
| Navbar | Home · About · How it works · FAQ | Link | `/`, `/#about`, `/#how-it-works`, `/#faq` — scrolls on the homepage, highlights the section in view | ✅ Phase 3 | ✅ crawled (guest, student, admin) |
| Navbar | Leaderboards · Gallery | Link | `/leaderboard`, `/gallery` | ✅ | ✅ crawled |
| Navbar | Logo | Link | `/` (scrolls to top on the homepage) | ✅ | ✅ crawled |
| Navbar | Sign in · Register (guest) | ButtonLink | `/#login` (opens dialog) · `/register` | ✅ | ✅ crawled; Sign in opens the dialog (E2E) |
| Navbar | Account menu (student): Dashboard · My Profile · Sign out | Menu | `/dashboard` · `/profile` · `logout()` | ✅ Phase 3 | ✅ targets crawled (student) |
| Navbar | Admin (if `students:read`) | ButtonLink | `/admin` | ✅ | ✅ crawled (admin) |
| Navbar | Theme toggle · Open/Close menu · backdrop | button / div | theme · mobile panel | ✅ | ✅ the theme switch is 44×44 on a touch screen (D13); the menu crawled at 390 |
| Footer | Leaderboard · Hall of Fame · Event gallery | Link | routes | ✅ | ✅ crawled |
| Footer | Check a result · Certificates · Verify a certificate | Link | `/result` `/my-certificates` `/verify` | ✅ D6 | ✅ crawled — Certificates is `/my-certificates` (D6) |
| Footer | Sign in · Register | Link | `/#login`, `/register` | ✅ | ✅ crawled |
| Footer | Privacy Policy · Terms of Use · Daily Quiz & Rewards Rules · Refund & Cancellation · Contact us | Link | `/privacy` `/terms` `/rewards/rules` `/refunds` `/contact` (drafts, `TODO(legal-review)`) | ✅ Phase 3 | ✅ crawled |
| Footer | +91-97828-70716 | `tel:` | `tel:+919782870716` | ✅ owner-confirmed 2026-10-04 (PLAN Q9) | ✅ crawler: every `tel:` is the helpline |
| Footer | support@amitolympiad.me | `mailto:` | same | ✅ owner-confirmed 2026-10-04 (PLAN Q9) | ✅ crawler: every `mailto:` is support |
| DeveloperCredit.tsx:38 | Sachin Kukkar | a, new tab, `noopener noreferrer` | sachinkukkar.tech | ✅ | ✅ crawler: `noopener noreferrer` |
| Landing › Hero | Register for free (guest) / Go to dashboard (student) · Explore more | ButtonLink | `/register` (`?ref=` carried) / `/dashboard` · `/#how-it-works` | ✅ Phase 3 | ✅ crawled |
| Landing › Can you crack this? | Class-group tabs · 2–6 options · Submit answer (disabled until chosen) · Try another (when the group has more than one) · Play today's Daily Quiz and win prizes · Try again (when the problems failed to load) | tabs / radio group / Button | switch group · instant feedback with the worked solution · the previous day's problem · the Daily Quiz flow · re-fetch | ✅ Phase 3; real past Daily Quiz problems since 2026-10-05 | ✅ E2E (`homepage.spec.ts`) |
| Landing › Rewards | Play today's quiz · verify · Read the Daily Quiz & Rewards Rules · winners row (scrollable) | Button / Link | the Daily Quiz flow · `/verify` · `/rewards/rules` | ✅ Phase 3 | ✅ crawled; Play → the quiz flow (E2E) |
| Landing › About | Practice · Mock tests · Daily Quiz · Performance insights | Link / Button | `/practice` `/mock-tests` the Daily Quiz flow `/analytics` (a guest signs in first, `?next=`) | ✅ Phase 3 (D4) | ✅ crawled (a guest → sign-in with `?next=`) |
| Landing › How it works | 4 steps | Link | `/register` `/practice` `/payment` `/result` | ✅ Phase 3 | ✅ crawled |
| Landing › Journey | View full journey | Button | dialog with the nine milestones | ✅ Phase 3 | ✅ Phase 3 browser check; page crawled clean |
| Landing › Top Scholars | View full leaderboard | ButtonLink | `/leaderboard` | ✅ Phase 3 | ✅ crawled |
| Landing › FAQ | 9 items | details/summary | expand | ✅ | ✅ page crawled clean (every summary named) |
| Landing › CTA | Register now · I already have an account (guest) / Go to your dashboard | ButtonLink / Button | `/register` · opens LoginDialog / `/dashboard` | ✅ Phase 3 | ✅ crawled; "I already have an account" opens the dialog (admin crawl) |
| HomeQuizFab | Daily Quiz (guest) | button | opens the Login Gate | ✅ Phase 3 (E2E) | ✅ E2E (`homepage.spec.ts`) |
| HomeQuizFab | Today's quiz is live / Done for today · See result / Next quiz in … / Add your class to play (student) | Link | `/daily-quiz` | ✅ Phase 3 | ✅ E2E (`homepage.spec.ts`) |
| LoginGate | Create free account · Sign in · How rewards work · close | ButtonLink / Button / Link | `/register?next=%2Fdaily-quiz` · LoginDialog → `/daily-quiz` · `/rewards/rules` | ✅ Phase 3 (E2E) | ✅ E2E (`homepage.spec.ts`) |
| Legal pages | Policies sidebar · My Profile · `mailto:` · `tel:` | Link / a | routes · support | ✅ Phase 3 | ✅ crawled |
| LoginDialog.tsx:124/132 | Cancel · Sign in | Button / submit | close · `POST /auth/login` → `?next=` (allow-listed) else `roleHome()` | ✅ | ✅ E2E (every sign-in) |
| LoginDialog.tsx:143 | Send me a new verification link | Link | `/verify-email` | ✅ | ✅ `/verify-email` by hand |
| LoginDialog.tsx:178 | Forgot your password? | Link | `/forgot-password` | ✅ | ✅ crawled (`/forgot-password`) |
| ForgotPassword / ResetPassword / VerifyEmail | all buttons + links (12) | various | real routes / real endpoints | ✅ | ✅ crawled / by hand — the reset form: checklist, inline errors, Enter, the server's refusal |
| RegisterForm.tsx:356-728 | Review and continue · error summary · Remove photo · Back · Create my account · I have verified · Resend · support mailto | various | real | ✅ | ✅ E2E (`homepage.spec.ts` registers); the shared checklist (D3) |
| Leaderboard.tsx:145-296 | scope, class, period, paging, retry | buttons / select | real | ✅ | ✅ crawled (`?scope=class&period=daily` too) |
| Leaderboard.tsx:303 | Sign in | Link | `/dashboard` → a guest gets the sign-in dialog with `?next=` | ✅ D2 resolved | ✅ crawled |
| HallOfFame.tsx:103/182 | Try again · See the full leaderboard | | | ✅ | ✅ crawled |
| Gallery.tsx:75-107 | item · paging · lightbox close | button / Modal | `ui/Modal` | ✅ D8 | ✅ D8 — `ui/Modal`: Escape, focus trap, focus returns |
| NotFound.tsx:32/37 | Go to the home page · My dashboard | ButtonLink | `/` · `/dashboard` (a guest gets the sign-in dialog with `?next=`) | ✅ D2 resolved | ✅ by hand; its links crawled |

## Interaction inventory — student surfaces

| Component | Label | Element | Destination / action | Status | Final |
|---|---|---|---|---|---|
| AppShell.tsx (student, Phase 4) | every sidebar item (18 links + 2 `soon` labels, see below) · brand lockup | Link / label | declared routes; `/dashboard` | ✅ Phase 4 | ✅ crawled (student, 1280 + 390); `soon` items are labels (E2E) |
| AppShell.tsx (student, Phase 4) | top bar: Home · Dashboard · Practice · Leaderboards · Gallery · Certificates (from 1024px) | Link | `/`, `/dashboard`, `/practice`, `/leaderboard`, `/gallery`, `/my-certificates` | ✅ Phase 4 | ✅ crawled |
| AppShell.tsx | Close menu · Open menu (below 1024px) · backdrop | button / div | drawer | ✅ (E2E `dashboard.spec.ts`) | ✅ E2E (`dashboard.spec.ts`, 390) |
| AppShell.tsx | Theme toggle · Sign out (drawer foot; admin sidebar foot) | button | | ✅ | ✅ page crawled; the theme switch 44×44 on touch (D13) |
| AppShell.tsx | Skip to content | a | `#main-content` | ✅ | ✅ page crawled (the skip link is named) |
| layout/NotificationBell.tsx (Phase 4) | Notifications (N unread) → menu: "Today’s Daily Quiz is live" · the newest five notices · View all notifications | Menu | `/daily-quiz`; marks a notice read, then its `link` or `/notifications`; `/notifications` | ✅ (E2E) | ✅ E2E (`dashboard.spec.ts`) |
| layout/AccountMenu.tsx (Phase 4) | Account menu for {name} → My Profile · Help & Support · Log out | Menu | `/profile`, `/contact`, `logout()` → `/` | ✅ (E2E) | ✅ E2E; the chip is 44×44 on touch (D13) |
| AppShell.tsx (Phase 4) | bottom bar below 1024px: Home · Quiz · Practice · Leaderboard · Profile | Link | `/dashboard`, `/daily-quiz`, `/practice`, `/leaderboard`, `/profile` | ✅ (E2E) | ✅ E2E (390) |
| Dashboard.tsx (Phase 4) | Try again (figures, chapters) · View full journey · View all (activity) · View details · View all (events) · View leaderboard · View all (achievements) · the Daily Quiz card | Link / Button | `/rewards#journey`, `/activity`, `/analytics`, `/exam`, `/leaderboard?scope=class&period=daily`, `/rewards#achievements` | ✅ (E2E) | ✅ crawled + E2E |
| Activity.tsx (Phase 4) | Show earlier activity · Try again | Button | `GET /me/activity` pages | ✅ (E2E) | ✅ crawled (`/activity`) |
| EntryFeeBanner.tsx:65 | Pay ₹… | Link | `/payment` | ✅ | ✅ crawled (`/payment`) |
| DailyQuizPanel.tsx (page + dashboard card) | Start the quiz · option tiles (radio group) · Submit answer → confirm dialog (Go back / Submit option X) · Try again · Complete my profile · Practise now · Go to my profile · My quiz history · Open the Daily Quiz · See every quiz you have played | Button / ButtonLink / Modal / radio | `/me/daily-quiz/*`, `/profile#prize-details`, `/profile#daily-quiz-history`, `/practice`, `/daily-quiz` | ✅ (Phase 2, E2E) | ✅ E2E (`daily-quiz.spec.ts`); no empty `onChange` (lint) |
| DailyQuizHistory.tsx | The question / View solution (`<details>`) · pagination | details / Pagination | — | ✅ | ✅ E2E (the history after the reveal) |
| PrizeDetails.tsx | City · guardian phone · guardian email · opt-out checkbox · Save prize details | form | `PATCH /me/profile` | ✅ | ✅ page crawled; a form with a spinner |
| Profile.tsx:305-665 | photo, edit, save, cancel, change password, sign out everywhere, prefs, admin link | | | ✅ D3 | ✅ D3 + D15 — the checklist, `PasswordInput`, a spinner on every save (by hand at 390 + 1280) |
| Rewards.tsx:69 | Try again | Button | | ✅ | ✅ crawled |
| Rewards.tsx:212-216 | Earn some XP · Today's quiz | `ButtonLink` | `/practice`, `/daily-quiz` | ✅ D5 | ✅ D5 — two `ButtonLink`s |

Student navigation (`navigation.ts`, Phase 4 — the mockup's order first): Dashboard · Daily Quiz · Practice ·
Mock Tests · Previous Papers (*Soon*, a label) · Concepts (*Soon*, a label) · My Progress · Leaderboards ·
Achievements · Certificates · My Profile · Help & Support; **The Olympiad**: Official Olympiad (padlock if unpaid) ·
Entry fee & receipts · Result; **More**: Notifications · Activity · Hall of Fame · Printable report · Refer & Earn.
Every link resolves; nothing built became unreachable.

## Interaction inventory — admin surfaces

Admin navigation (`navigation.ts:141-227`): 25 items across Students / Question bank / Assessments / Insights /
Communication / Settings / System, each filtered by its permission; all resolve to declared routes, and since Phase 5
the Dashboard item carries its permission too (D7). **The Phase 5 admin crawl followed all of them.**
Admin page internals were not itemised in Phase 0 — the admin area is not being redesigned, and Phase 5's crawler
covers its links. The Daily Quiz admin screens (Phase 2):

| Where | Controls | Kind | Target | Works | Phase |
|---|---|---|---|---|---|
| Admin/DailyQuiz.tsx | Schedule a quiz · tabs (Calendar / Import a file / From the bank / Prize desk / Settings, kept in `?tab=`) · gap-warning "Schedule it" · calendar day "Add" · quiz chips → quiz page · quiz-list day links · "Choose a winner" · pagination | Button / Tabs / Link | `/admin/daily-quiz*` | ✅ | ✅ crawled (admin) |
| Admin/DailyQuizSchedule.tsx | Day · class presets + from/to · question search · candidate radio list · pagination · Write a new question · Schedule / Cancel | Modal form | `POST /admin/daily-quiz`, `/admin/questions/new` | ✅ | ✅ Phase 2 browser check; page crawled clean |
| Admin/DailyQuizBulk.tsx | CSV / JSON template downloads · file · fallback chapter · difficulty · Check the file · per-row checkboxes · Save and schedule · Import another file · bank: range, start day, ids, Plan it, Schedule N | Button / form | `/admin/daily-quiz/import/*`, `/admin/daily-quiz/bulk` | ✅ (API tested; template download not clicked in the browser check) | ✅ Phase 2 (API-tested); page crawled clean |
| Admin/DailyQuizDetail.tsx | Breadcrumb · Change question (picker modal) · Remove quiz (confirm) · Compute / Recompute winners · The question in the bank | Button / Modal / Link | `/admin/daily-quiz/:groupId*`, `/admin/questions/:id/edit` | ✅ | ✅ crawled (the seeded quiz) |
| Admin/DailyQuizWinners.tsx (quiz page + prize desk) | Confirm · Announce (confirm dialog) · Contacted · Delivered · Disqualify (reason dialog) · guardian `tel:` link · quiz-day links | Button / Modal / Link | `/admin/daily-quiz/winners/:id/:action` | ✅ (API tested end to end) | ✅ API-tested end to end; page crawled clean |
| Admin/DailyQuiz.tsx → Settings | headline · prize wording · cash amount · winner rule · winners per quiz · instant results · Save settings | form | `PUT /admin/daily-quiz/settings` | ✅ | ✅ Enter saves (by hand, the write intercepted); a spinner |
| Admin/Questions.tsx | Schedule as Daily Quiz (hand-off; reason shown in the page when unavailable) | Button | `/admin/daily-quiz?questions=…` | ✅ | ✅ crawled |
