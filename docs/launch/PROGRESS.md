# Diwali launch — progress

A fresh session should read `LAUNCH_SPEC.md`, then `PLAN.md`, then this file.

_Last updated 2026-10-06._

## Current state

**Phase 6 (launch readiness) complete** on branch `feat/diwali-launch-phase-6` — started from `main`
after PR #5 (Phase 5) was squash-merged; **not pushed** — waiting for the owner. Every phase of the brief
is now built. **[`LAUNCH_REPORT.md`](LAUNCH_REPORT.md) is the owner's one page**: what was built, how
to run it, the Daily Quiz and winners how-to, known limitations, the action list before launch, the
phone checklist and the launch-day runbook. Open for the owner: D10, R5, the site's address, the
consent questions (below).

## Tasks

| Phase | Task | Status |
|---|---|---|
| 0 | Discovery, baseline, route inventory, interaction audit, gap analysis, `PLAN.md` | ✅ done |
| 1 | Design system: tokens onto the mockups, fonts self-hosted, nine primitives, `DailyQuizFab`, `/dev/ui`, QA, docs | ✅ done |
| 2 | Injectable clock (`lib/clock.ts`), IST window helpers, pure quiz rules (`lib/dailyQuiz.ts`) | ✅ done |
| 2 | Model upgrade: `DailyChallenge` groups + snapshot, attempt fields, `DailyQuizStart`, `DailyQuizWinner`, `DailyQuizSettings`, `Student` prize fields | ✅ done |
| 2 | Start / submit / today / history / public info / public winners; per-student rate limit; no-store | ✅ done |
| 2 | One reveal gate; no automatic fill; publish and delete guards on quiz questions | ✅ done |
| 2 | XP: 20 for correct only, settled after the reveal when instant results are off | ✅ done |
| 2 | Admin: calendar + gap warnings, schedule, change/remove until started, stats, candidates, settings | ✅ done |
| 2 | Bulk: CSV/JSON/Excel quiz import through the question importer (CSV + JSON are importer formats); bulk-from-bank | ✅ done |
| 2 | Winners: compute / confirm / disqualify / publish / contacted / delivered, notification, prize desk, audit | ✅ done |
| 2 | Analytics + Hall of Fame revealed-only; content reset keeps prize decisions; profile prize fields | ✅ done |
| 2 | Student UI: `DailyQuizPanel` (page + dashboard card), profile history + prize details, routes and nav | ✅ done |
| 2 | Admin UI: `/admin/daily-quiz` (calendar, import, bank, prize desk, settings) + quiz page with winners | ✅ done |
| 2 | Tests: rules (unit), API incl. the answer-key leak test across midnight, import — backend 1324 / 38 files | ✅ done |
| 2 | Playwright ADR, `e2e-server.ts` (in-memory DB) + `/__e2e` hooks, E2E at desktop and 390px — 4/4 | ✅ done |
| 2 | `seed-dev-quizzes.ts` (local only, answers checked in code); `seed-demo.ts` no longer schedules | ✅ done |
| 2 | Browser check of the student flow and the admin console on the local dev servers | ✅ done |
| 2 | Docs: ADRs, CLAUDE.md, API, schema, security, env, testing, feature status, state, changelog, troubleshooting | ✅ done |
| 3 | Owner's answers applied: contact details (Phase 2 branch, PR #2), Q3/Q7/Q8/Q9 recorded in PLAN.md | ✅ done |
| 3 | Public-list opt-out on every board (`publicListingFor()`), leaderboard rows carry `city` | ✅ done |
| 3 | `GET /public/stats` + `questionsSolved` + 10-minute cache; `GET /public/journey` | ✅ done |
| 3 | `GET /me/daily-quiz/status` for the floating button | ✅ done |
| 3 | `next` allow-list through registration, resend and the verification link (backend + frontend); guarded pages → sign-in with `?next=` (D2) | ✅ done |
| 3 | 25 sample questions + `npm run verify:samples` (mutation-checked); `SAMPLE_QUESTIONS.md` review sheet | ✅ done — replaced 2026-10-05 (below) |
| 3 | Primitive extensions (Menu trigger, Tabs element icons, JourneyTrack `upcoming`, FAB `style`) | ✅ done |
| 3 | Header (section links + you-are-here, avatar menu, frosted on scroll) and footer (Legal column) | ✅ done |
| 3 | Homepage rebuilt from `lib/siteConfig.ts`: hero, stats, crack-this, Rewards, About (D4), How it works, journey (9 milestones), Top Scholars, FAQ, CTA | ✅ done |
| 3 | Floating button wired (status, countdowns, collapse, footer lift) + Login Gate | ✅ done |
| 3 | `/rewards/rules` + Privacy, Terms, Refund, Contact drafts (`TODO(legal-review)`); `LEGAL_REVIEW.md` | ✅ done |
| 3 | `A.M.I.T.` with its stop (Q10) | ✅ done |
| 3 | Tests: backend 1336 / 38; E2E 12/12 (adds button → gate → quiz, register → verify → quiz, guarded page, no sideways scroll) | ✅ done |
| 3 | Browser check at 1280 and 390 (light), screenshots in `docs/launch/screenshots/phase-3/` | ✅ done |
| 3 | Docs: ADR, CLAUDE.md, API, security, testing, feature status, state, changelog, audit | ✅ done |
| 4 | Owner, 2026-10-05: "Can you crack this?" is a real daily problem — `GET /daily-quiz/past` (revealed days only, through `revealOf()`), class-group tabs, honest empty state; demo set, `verify:samples` and `SAMPLE_QUESTIONS.md` deleted; leak test extended; E2E 14/14 | ✅ done |
| 4 | `GET /me/dashboard`: `stats` (XP + questions solved this week, accuracy over 30 attempts), `journey`, `classToday`, `upcoming`, `hasPhoto`, `serverNow`; `recentTests` and the overall top five removed; `hasPhoto` on every auth response | ✅ done |
| 4 | Student shell: top bar of links, bell menu (+ "today's quiz is live"), profile chip, page `h1` in the content, the mockup's sidebar with two "Soon" labels, motivational card, icon rail 1024–1279px, five-item bottom bar + burger below 1024px; admin unchanged | ✅ done |
| 4 | Dashboard: banner, five figures (count-up), Daily Quiz card, journey, activity, chapter progress, maths thought, upcoming events, today's class top 5, achievements — each with loading, empty and error states | ✅ done |
| 4 | `/activity`; the leaderboard opens on `?scope=class&period=daily`; the rewards page scrolls to `#journey` / `#achievements`; "A.M.I.T. Admin" (Q10) | ✅ done |
| 4 | Shared fixes: `ui/Menu` closes only on a scroll that moves its trigger; `ScrollToTop`; `/__e2e/reset` empties the rate limiters; `ProtectedRoute` loads the student shell lazily (main bundle 261 kB / 82 kB gzipped) | ✅ done |
| 4 | Tests: backend 1346 / 38 (seven new); E2E 20 (`dashboard.spec.ts`) | ✅ done |
| 4 | Browser check at 1440, 1280, 1024 and 390 in both themes; contrast sweep 0 failures (~125 text nodes); screenshots in `docs/launch/screenshots/phase-4/` | ✅ done |
| 4 | Docs: ADR, CLAUDE.md, API, testing, feature status, state, changelog, audit, troubleshooting | ✅ done |
| 5 | `GET /auth/session` — a guest's page load makes no failing request (D9); `AuthContext` probes it, refreshes only with a refresh cookie, falls back to `/auth/me` on 404 | ✅ done |
| 5 | `components/PasswordRules` on all four password forms + `passwordProblem()` before sending (D3); the profile's fields `ui/PasswordInput`; Edge's second eye hidden | ✅ done |
| 5 | D5 `ButtonLink`s; D6 `/certificate` → `/my-certificates`, page deleted; D7 admin Dashboard permission; D8 lightbox `ui/Modal`; notifications read on click, not hover | ✅ done |
| 5 | Lint: oxlint `jsx-a11y` (curated) + `scripts/check-handlers.mjs` in `npm run lint`, mutation-checked; three justified inline exceptions | ✅ done |
| 5 | Forms: `loading` on every asynchronous submit; the four admin settings screens are real forms (Enter saves) | ✅ done |
| 5 | `e2e/crawler.spec.ts` — guest 19 pages, student 27 (1280 + 390), admin 51 (1280); `POST /__e2e/rate-limits/reset`; a throwaway e2e administrator | ✅ done |
| 5 | Fixed what the crawls found: `hasPhoto` on the directory (D11), the model list 503 (D12), three controls under 44px wide (D13); and Edge's second eye (D14), the profile's plain password inputs (D15) | ✅ done |
| 5 | The e2e backend no longer reads `backend/.env` | ✅ done |
| 5 | Tests: backend 1352 / 38 (six new); E2E 26 — 24 passed, 2 skipped by design, 4.2 minutes, against a production build (`vite preview`) since the dev server's per-module requests starved the browser during the crawl | ✅ done |
| 5 | Browser checks in Edge: unlinked routes, the reset form, the profile's password form (390 + 1280), Enter on the settings forms (writes intercepted); screenshots in `docs/launch/screenshots/phase-5/` | ✅ done |
| 5 | Docs: ADR, CLAUDE.md, API, security, env, testing, troubleshooting, feature status, state, changelog, audit | ✅ done |
| 6 | Search and sharing: `lib/pageMeta.ts` (every route's title, description, indexed or not) + `components/PageMeta` (title, description, `robots`, canonical on each navigation); `vite.seo.ts` builds `robots.txt`, `sitemap.xml` (12 public pages) and `manifest.json` and injects share tags + organisation JSON-LD; `SITE_URL` inferred — **to confirm** | ✅ done |
| 6 | Brand images generated by `scripts/make-brand-images.ts`: favicon set (a 9 KB ICO replaced a 1 MB PNG), touch + manifest + maskable icons, the 1200×630 share card, a 6 KB WebP header mark | ✅ done |
| 6 | Reliability: `AppErrorBoundary` (crash page; "a new version is ready" for a replaced page file), 90 s request timeout with its own message, the session check retries a transient failure (D17) | ✅ done |
| 6 | Security: full CSP + HSTS in `frontend/vercel.json`, served by `vite preview` so the E2E suite runs under it (mutation-checked); `npm audit fix` both apps; nodemailer 10; `@vercel/node` → dev — **0 high/critical** in what ships | ✅ done |
| 6 | Accessibility: axe on every crawled page (light + dark crawl) and every overlay — 0 serious/critical; `e2e/keyboard.spec.ts`; `ui/SkipLink` on public pages and `#main-content` everywhere (D18); chart canvases (D19), Rewards fading (D20), importer's fake tablist (D21) | ✅ done |
| 6 | Parental consent: registration requires the brief's box + a guardian phone or email, `guardianConsentAt` at the server's time; My Profile for older accounts; prize eligibility requires it; the Privacy draft's "What we collect" kept true | ✅ done — wording for legal review |
| 6 | Performance: icon CSS after `load`, "Can you crack this?" loads near view, WebP mark with dimensions — Lighthouse mobile 69 → 81–88 over four runs of the final build (median 84), desktop 99, a11y / best practices / SEO 100 | ✅ done — but mobile is **not reliably** ≥ 85, and LCP 3.3–3.4 s misses 2.5 s (recorded, §7 of the report) |
| 6 | Names: `backend/src/lib/brand.ts` (`PRODUCT_NAME`) in emails, notifications, achievements; "Daily Quiz" wherever "daily challenge" showed | ✅ done |
| 6 | `docs/launch/LAUNCH_REPORT.md` (the owner's launch report), `daily-quiz-example.csv` | ✅ done |
| 6 | Tests: backend 1360 / 38 (eight new, consent); E2E 44 — 35 passed, 9 one-width-only, 7.1 minutes | ✅ done |
| 6 | Docs: ADR, CLAUDE.md, API, schema, security, env, testing, troubleshooting, feature status, state, changelog, audit, legal review, assets | ✅ done |

## Open questions for the owner

- **D10 (Phase 5) — how should the root administrator be created on a brand-new database?** The one
  sign-in dialog hands an administrator over to `/auth/admin/login` only once the account exists, and
  the account is created by its first sign-in there — which has had no form since Milestone 28. Your
  production administrator already exists, so nothing is broken today; a new environment (a staging
  copy, a restored backup without it) could not create one from the website. Proposed: the sign-in
  route also hands over when the address is the configured `ADMIN_EMAIL` and the password matches
  `ADMIN_PASSWORD_HASH`, before the account exists. It is an authentication change, so it waits for
  your yes.

- **The site's address (Phase 6).** Search results, the sitemap and shared links use `SITE_URL` in
  `frontend/src/lib/brand.ts`, set to `https://amitolympiad.me` — inferred from the support address's
  domain, which points at Vercel. If the live site is `www.amitolympiad.me` or another address, it is a
  one-line change; and the backend's `FRONTEND_URL` must match it exactly.
- **R5 (PLAN.md) — `SameSite=Lax` session cookies.** Still `None`. Changing it safely needs a staging
  copy with its own backend; every preview deployment points at the production API.
- **Parental consent (Phase 6)** — built with the brief's wording; `LEGAL_REVIEW.md` question 8 asks
  whether a ticked box is enough for the DPDP Act's *verifiable* consent, how a parent withdraws it,
  and how long a parent's details are kept.
- **Other browsers.** The suite drives Edge (Chromium) only; running it in Firefox and WebKit needs
  Playwright's own browsers downloaded (about 200 MB) — say if you want that. The report's phone
  checklist covers Safari by hand.

All four Phase 0 questions were answered on 2026-10-04 (PLAN.md §5): **Q3** three class groups a day;
**Q7** map the nine existing milestones; **Q8** Claude drafts Logic / Reasoning / Brainstorming, the
owner reviews; **Q9** `+91-97828-70716` and `support@amitolympiad.me`. New, from Phase 3:

- **Legal review** — `docs/launch/LEGAL_REVIEW.md`: the organiser's legal name and address, governing
  law, a grievance contact, **the refund policy** (not guessed — money), data retention, prize delivery
  and tax handling.
- ~~Sample questions~~ — moot since 2026-10-05: the homepage shows real past Daily Quiz problems, and
  the drafted set was deleted.
- **Owner actions**: load at least the first two weeks of quiz questions before launch (Admin → Daily
  Quiz → Import a file) — each also becomes the homepage's "Can you crack this?" the day after it runs; if `INVOICE_ORG_EMAIL` / `INVOICE_ORG_PHONE` are set in the backend's Vercel
  project, update them (a set variable beats the new default); supply the illustrations
  (`ASSETS_NEEDED.md` — placeholders until then).

## Phase 4 — deviations from the dashboard mockup, and why

Compared side by side with `docs/design/mockup-dashboard.jpeg` (screenshots in
`docs/launch/screenshots/phase-4/`: the dashboard at 1440, 1280, 1024 and 390 in light, 1440 and 390
in dark, the bell and account menus, the phone drawer, Practice and `/activity` in the new shell, and
the admin dashboard to show it unchanged):

| Mockup | Built | Why |
|---|---|---|
| "Today's Challenge" with the question and a running timer on the dashboard | The Daily Quiz card: the facts, the prize and **Start**; the question appears only after Start | The solve time is measured from Start (§6), so the question cannot be on screen before it — and the card is the `/daily-quiz` component, so the two cannot disagree. |
| "Your 6-Month Journey" (Number Forest → Olympiad Kingdom) | "Your journey" — the nine real milestones, done / current / locked | Q7. |
| "Subject Progress" (Algebra, Geometry, Trigonometry…) | "Chapter progress" — accuracy per chapter, with the counts | A one-subject olympiad: nothing may print a subject name (CLAUDE.md). |
| Upcoming: Sunday Math Boss Battle, Month-End Booster | Real Olympiad windows only, with countdown chips; an honest empty state until one is scheduled | Q6 — neither event exists. |
| Sidebar of 11 ("Today's Challenge", "Practice Tests"…) | The mockup's order, Previous Papers and Concepts as **"Soon" labels**, then "The Olympiad" and "More" | Nothing built may become unreachable; a "Soon" item is never a link (plan §4). |
| The current sidebar item filled solid blue | A tint and a heavier weight | A position is not an action (CLAUDE.md design system). |
| The motivational card always in view | At the foot of the sidebar's own scroll — in view on a screen about 1,100px tall | The sidebar holds every built destination (20), not the mockup's 11. |
| Stat cards with the icon beside the figure | Beside it from ~170px of card; above it when narrower (five across beside the rail at 1440) | The figures keep their size and line up. |
| Green and red deltas | Green for a gain this week, otherwise a neutral line | None of these figures can fall — there is nothing red to say. |
| Achievements four across | Two by two in the 340px rail, four across below 1280px | The names fit. |
| "WELCOME BACK, Aarav Sharma!" | "Welcome back, {first name}!" | Brief §8 #1. |
| Photo, books, plant, climber and castle art | Placeholders | `ASSETS_NEEDED.md`; a file dropped in needs no code. |

## Phase 3 — deviations from the landing mockup, and why

Compared side by side with `docs/design/mockup-landing.jpeg` (screenshots in
`docs/launch/screenshots/phase-3/`):

| Mockup | Built | Why |
|---|---|---|
| Sunday Math Boss Battle and Month-End Booster cards | Absent | The events do not exist (PLAN.md Q6); a reward card is a promise. |
| "Your 6-Month Mathematical Journey" (Number Forest → Olympiad Kingdom) | "Your journey to the Olympiad" — the nine real milestones | Owner's choice (Q7): no programme calendar sits behind the themed months. |
| Four question tabs (Mathematics / Logic / Reasoning / Brainstorming) | Class-group tabs (3–5 / 6–8 / 9–12) over real past Daily Quiz problems, in a row above the problem | Owner, 2026-10-05: a real daily problem, not a demo set. Never today's — it is the prize question, timed from Start. A tab row of one is not drawn. The mockup's left column of tabs squeezed four answer tiles at 1024px. |
| Options always four in a row | Four in a row for short answers, one per row for wordy ones | Sentences in quarter-width tiles broke mid-word on a phone. |
| Stat sub-lines "across India", "solving now…" | Labels only | Schools are free text (not countable as "across India"); "active today" is since IST midnight, not now. |
| A podium of three | A podium only when ranks 1-2-3 are distinct, else the table | Equal XP shares a rank; level students on steps 1-2-3 would be a false ranking. |
| Illustrations (student, trophy, gift, journey scenes, climber) | Placeholders | Art not supplied yet — `ASSETS_NEEDED.md`; dropping files in needs no code. |
| The mockup's sample question | A real past Daily Quiz problem | The mockup's version had no correct option (brief Appendix B); since 2026-10-05 the question comes from the quiz itself. |
| — | "About the Olympiad" and FAQ sections | Targets of the navbar's About and FAQ links (not visible in the mockup's crop). |

## Notes for the next session

- **Phase 4 history note:** commit `84076ca` ("keep the How it works paper plane inside its
  section") also carries the deletion of the demo sample-question files — they had been staged with
  `git rm` before it — and `df6cc0d` is the commit whose message describes them. The tree at the tip is
  right; the PR is squash-merged. History was not rewritten (CLAUDE.md: new commits, not amends).
- **Screenshots** for a signed-in page: a Playwright script (installed Edge) against the local
  servers (5180 → 8091) that signs in with the `seed-demo.ts` account through `POST /auth/login` and
  shoots full pages. The local backend's general rate limiter (300 requests / 15 min) runs out after
  a few dozen captures — restart `launch-backend-local-db` to empty it.

- **Local run:** `.claude/launch.json` has `launch-backend-local-db` (port 8091, `dev:local`, local
  MongoDB `amit-olympiad-local`) and `launch-frontend` (port 5180, proxying to 8091). The backend is
  not a watcher — **restart it after a backend change**. The main checkout may be running its own
  backend on 8081 against the same local database — leave it alone.
- `npx tsx scripts/seed-dev-quizzes.ts --local --write` (from `backend/`) seeds three days of verified
  quizzes locally. The local demo student was switched to Class 7 during the Phase 2 browser check
  (Class 9 had a pre-quiz challenge holding today's slot).
- Seeded local accounts come from the project's own scripts (`scripts/seed-demo.ts`,
  `scripts/dev-local.ts`, `frontend/e2e/fixtures.ts`); do not paste their credentials into chat.
- **E2E:** `npm run e2e` in `frontend/` starts its own backend (in-memory DB, port 8092) and Vite
  (5181) and drives the installed Edge — 44 tests (35 run), about 7 minutes. Since Phase 5 the
  frontend it serves is a **production build** (`vite build` + `vite preview`), not the dev server, and
  since Phase 6 `vite preview` sends `vercel.json`'s headers, so the suite runs under the real CSP.
- **Measuring speed:** `launch-frontend-prod` in `.claude/launch.json` serves the production build on
  5190 (proxying to the local backend on 8091). Lighthouse: TROUBLESHOOTING.md "Lighthouse cannot start
  the browser on Windows" — start headless Edge on a fixed port yourself, then `npx lighthouse@12`.
  Run mobile three times; one run moves by several points.
  `test-results/<test>/visited.txt` lists the pages each crawl reached, `timings.txt` how long each
  took and how many requests it made. A crawl failure is
  a page to fix, never an error to teach it to ignore. `homepage.spec.ts` turns reduced motion on so the
  floating button holds still enough to click.
- **The local database** behind `launch-backend-local-db` carries Milestone 29's load-test accounts
  (~1,000 "Scale S." students at the same XP), so the homepage there shows real but odd figures and
  no podium (the top three are tied) — that is the tie rule working, not a bug.
- Commit `943a336` (the calendar fix) accidentally carries the deletion of the old Daily Challenge
  frontend files — they were staged by `git rm` — and `4fd2b34` is their replacement; its message
  calls the first one `856fede`, its hash before the branch was replayed onto `main` for PR #2.
  History was not rewritten (CLAUDE.md: new commits, not amends). The old local branch
  `feat/diwali-launch` holds the same tree and is no longer used.
- Measuring a computed colour: inject `* { transition: none !important; animation: none !important }`
  first, or you read a value mid-transition.
