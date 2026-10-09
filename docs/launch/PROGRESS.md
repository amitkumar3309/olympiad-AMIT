# Diwali launch — progress

A fresh session should read `LAUNCH_SPEC.md`, then `PLAN.md`, then this file.

_Last updated 2026-10-09._

## Current state

**Phase 6 (launch readiness) complete and merged** (PR #6, squash-merged 2026-10-06). Its follow-up —
the two §10 targets Phase 6 left unmet — is **merged too** (PR #7, squash-merged 2026-10-08): the
homepage is drawn at build time (mobile Lighthouse **98** ×4, LCP 1.8–2.0 s) and every tap answers
within 200 ms on a slowed phone (a new INP test). The last two items of the brief's definition of done —
**the spell-check and the Phase 6 screenshots** — are done, with the two fixes they turned up, and are
**PR #8** (`feat/diwali-launch-phase-6-polish`, replayed onto `main` after PR #7's merge). Every phase of the brief is now built and
every Phase 6 target met.

**Phase 7a (the owner's requests of 2026-10-08, first half) is complete** on `feat/diwali-launch-phase-7`,
stacked on PR #8 and **not pushed**: the site's address is `www.amitolympiad.me`; D10 is fixed (the one
sign-in box can create the root administrator); a public archive of past Daily Quizzes; and **the Diwali
edition** — 8 to 15 November 2026, switching itself on and off — with its intro, the festive homepage, the
festive touches across the student area, and a real Diwali 2026 badge. Phase 7b (picture questions,
reminders) is next. **[`LAUNCH_REPORT.md`](LAUNCH_REPORT.md) is the owner's one page**: what was built, how
to run it, the Daily Quiz and winners how-to, known limitations, the action list before launch, the
phone checklist and the launch-day runbook. Open for the owner: R5, the consent questions, the
organiser's name on invoices and certificates, and two speed findings from Phase 7a (below).

**Since 2026-10-09 the Daily Quiz prize is monthly** (`feat/daily-quiz-monthly-winner`, stacked on the
immersive Diwali edition, PR #12): no daily winner — one a month in each class band, the most correct
answers that month, the lower total solve time breaking a tie, November counted from the 8th, chosen on
Admin → Daily Quiz → Monthly winners once the month is over (PLAN.md Q24).

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
| 6+ | Homepage drawn at build time: `src/prerender.tsx` + `vite.prerender.ts` → `index.html` for `/`, `app.html` for every other route (`vercel.json`, mirrored by `vite preview`); React renders over it (no hydration); the build fails on a broken draw | ✅ done |
| 6+ | `public/boot.js`: the theme before the first paint; on the drawn page the app after it. Focus kept through the takeover (`main.tsx`) | ✅ done |
| 6+ | INP: `e2e/responsiveness.spec.ts` (390px, CPU 4×, Event Timing); theme change applied after the next paint (~390 → 24 ms); `Landing` memoises its sections (sign-in dialog ~220 → 168–184 ms) | ✅ done |
| 6+ | Lighthouse, homepage, four mobile runs: **98, 98, 98, 98**; LCP 1.8–2.0 s; TBT 36–68 ms; CLS 0; desktop 100 | ✅ done |
| 6+ | Tests: E2E 54 (`prerender.spec.ts` 4, `responsiveness.spec.ts` 1; `waitForApp()` where a test acts on `/` at once) | ✅ done |
| 6+ | Spell-check (§10, "spell-check every string"): the 6,292 strings a reader can see — JSX text and prose literals in `frontend/src` and `backend/src`, read with the TypeScript compiler — and the owner's documents, through cspell's British English dictionary (the brief asks for Indian English, which largely follows British spelling): **0 misspellings, no doubled words**. The 32 words it did not know are names, code, LaTeX and Indian terms (lakh, crore, paise, NEFT, GSTIN, Hinglish) | ✅ done |
| 6+ | The public "how winners are chosen" sentence names the parent's consent, which winning has required since Phase 6 — the only place the rules page lists what a winner needs; a test now fails if the sentence leaves out any requirement (mutation-checked against the old sentence) | ✅ done |
| 6+ | Names: the student export's workbook author is `PRODUCT_NAME`. The organiser's name on invoices and certificates is left for the owner (below) | ✅ done |
| 6+ | Screenshots in `docs/launch/screenshots/phase-6/`, compared with both mockups (below) | ✅ done |
| 6+ | Tests: backend 1361 / 38 (one new) | ✅ done |
| 7a | The owner's answers of 2026-10-08 recorded (PLAN.md §5b, Q14–Q20) | ✅ done |
| 7a | `SITE_URL` is `https://www.amitolympiad.me` (Q14) — sitemap, robots, canonical links and share tags follow | ✅ done — owner action: redirect the bare domain, match `FRONTEND_URL` |
| 7a | D10: `/auth/login` hands the configured address with the configured password to the admin route before the account exists — after the password, never before; a wrong one is the unknown-account 401 (Q15) | ✅ done |
| 7a | Archive: `GET /daily-quiz/archive` (one class group, a page of days; never today's — `before` cannot reach it, and every problem still passes `revealOf()`) and `/daily-quiz/archive`, linked from the footer, "Can you crack this?" and the Daily Quiz page; in the sitemap (Q16) | ✅ done |
| 7a | The Diwali edition (Q17): `lib/season.ts` dates → a `<meta>` → `public/boot.js` sets `<html data-season>` before the first paint; every festive touch is CSS keyed on it; `?season=diwali` / `off` / `auto` previews | ✅ done |
| 7a | The intro: drawn at build time *beside* the app's root (the takeover cannot restart it), two seconds, once per browser, any key or tap ends it, a timer ends it regardless; never for reduced motion, a hidden tab, `#login` or `?next=` | ✅ done |
| 7a | The festive homepage: a night sky (lanterns, fireworks), the name in gold, "Launched this Diwali", a countdown to today's quiz closing by the server's clock (`GET /daily-quiz/today`, uncached), the Diwali Special band; the header solid with a string of lights and "Happy Diwali" | ✅ done |
| 7a | Festive touches in the student area: the lights and the greeting in the top bar; the loudest button and the Daily Quiz button glow gold. Admin unchanged | ✅ done |
| 7a | The `diwali_2026` achievement: any answer on a quiz day 8–15 Nov; listed only during the week or once earned (a seasonal `window`); counted exactly on the admin rewards overview (Q18) | ✅ done |
| 7a | Speed: every festive loop moves a whole element (GPU); the intro pauses the page's loops; solid bars instead of frosted ones during the edition. A compositor version of the Daily Quiz button's loops was tried and **reverted** — it doubled the tap time measured with motion on | ✅ done |
| 7a | Tests: backend 1369 / 38 (eight new); E2E 70 — `diwali.spec.ts` (dates, preview, intro, no shift, axe, no sideways scroll), `archive.spec.ts`, the INP test also during the edition | ✅ done |
| 7a | Screenshots in `docs/launch/screenshots/phase-7/` (below) | ✅ done |
| 7b | Picture questions (Q19), Daily Quiz reminders (Q20) | ⬜ next |
| 7+ | The hero's picture of the day (Q21): seven drawn pictures (a summit, a growing book, a bright idea, a rocket, steps to a trophy, a sunrise, a target hit), a different one each day by the India date — chosen by `public/boot.js` before the first paint, themed, a night version during Diwali | ✅ done |
| 7+ | The founder's quotes signed "— Amit" (Q22) | ✅ done |
| 7+ | The Diwali intro slowed (Q23): about seven seconds — embers rise; 3, 2, 1, a second each, each with a ring of light; a diya catches with a burst of sparks; the mathematics appears in its light; the name; the line. Any key or tap still ends it, and its timer (7.3 s) regardless | ✅ done |
| 7+ | The whole site at night during the edition (Q23): the dark theme's values under `data-season` in either theme; the page transparent over a night sky; gold card edges; bands half seen through; the theme switch hidden for the week (it would change nothing); the night's veil and a halo behind words that stand on the sky | ✅ done |
| 7+ | Fireworks behind every page (Q23): `components/Fireworks` at the app's root — rockets from random places, bursting at random heights as a peony, a streaking chrysanthemum, a tilted ring or a drooping gold willow, light adding to light; drawn on a canvas in a worker; a salute as the intro hands over. Still for reduced motion, on staff pages and in a paper being answered; they hold still while a tap is answered (below). The hero's three looping SVG fireworks are gone | ✅ done |
| 7+ | The intro for a signed-in student, once that week (Q23): `DiwaliIntroPlayer` in the student area, sharing the homepage's "seen" key; never over a timed paper | ✅ done |
| 7+ | Tests: E2E — the student intro once and never again; the night for a reader who chose light, no theme switch, and the everyday site on the 16th; the fireworks drawing for motion, still on an admin page | ✅ done |
| 7+ | Monthly winners (Q24): no daily winner — one a month in each class band (3–5, 6–8, 9–10, 11–12), the most correct answers that month, the lower total solve time breaking a tie, an answer counting in the band of the class it was answered in; worked out only once the month is over, then confirmed and announced by staff; November counts from the 8th | ✅ done |
| 7+ | Admin → Daily Quiz → **Monthly winners** (a month picker, four bands, work out → confirm → announce); the prize desk shows monthly rows; a quiz's page links to its month; the settings lose the winner rule and winners per quiz (kept in the database, read by nothing) | ✅ done |
| 7+ | Every page that named the prize: the Rewards section, About, the FAQ, the Login Gate, the Daily Quiz page and card, the profile's history (this month's prize score) and Prize details, the notification menu, the rules page (dated 9 October 2026 — LEGAL_REVIEW Q12). Before 8 November the quiz says when prizes start (`prizesFrom`) instead of promising one | ✅ done |
| 7+ | Tests: backend 1375 / 38 — the monthly ranking and ties, every class in one band, months, the whole flow, the 8 November start and a class change mid-month, the opt-out, the reset, the refusals before the month ends; E2E 80 — `monthly-winners.spec.ts` | ✅ done |

## Open questions for the owner

- ~~D10~~ — **answered 2026-10-08: yes; built in Phase 7a.** ~~The site's address~~ — **answered:
  `www.amitolympiad.me`; built in 7a.** Your part: in Vercel, set the bare `amitolympiad.me` to
  *redirect* to `www.amitolympiad.me`, and set the backend's `FRONTEND_URL` to exactly
  `https://www.amitolympiad.me` (LAUNCH_REPORT §8, step 2).

- **Taps with motion on (nothing to decide now; one check on a real phone).** The INP test measures
  with motion reduced, as every browser test here does, and passes. With motion **on** — what most
  visitors have — the slowest tap measures about 190–260 ms on the everyday homepage, and during the
  edition, with the fireworks running behind every page since 2026-10-09, typically 300–360 ms
  (224–632 across eight runs) — the same as Phase 7a's edition measured (320–430 ms). That figure needed
  the fireworks to **hold still while a tap is answered**: drawing straight through, it was 490–940 ms;
  the night sky with no fireworks at all measures 230–280 ms. Measured in headless Edge with the CPU
  slowed 4× — which draws with this laptop's integrated GPU (hardware compositing and raster, checked in
  `edge://gpu` on 2026-10-09), not without one as these notes first said, so it is no reason to expect a
  phone to do better. Only a phone can say (LAUNCH_REPORT §9, step 13). Tried and **not kept**: a
  compositor version of the Daily Quiz button's loops (it doubled the time) and a solid everyday header
  (no faster). The fireworks at 30 frames a second did not change the tap either, but are kept for the
  processor (next point).
- **What the edition costs while it plays (nothing to decide now; one check on a real phone).** Measured
  in headless Edge, all of its processes, motion on, on the homepage: an ordinary day uses 71–89% of one
  core at 390px (93–94% at 1280px) — the same as the live site today. During the edition, with the night
  sky and the fireworks, **165–225%** (220–245% at 1280px), against Phase 7a's edition at 103–128%
  (132–153%). Thirty frames a second instead of sixty took a tenth to a third off that. A phone that
  runs warm or drains during Diwali week would be the sign to tone it down — fewer fireworks, or the
  fireworks on the homepage only.
- **The first homepage visit during Diwali week.** With the intro playing — about seven seconds since
  2026-10-09 — mobile Lighthouse measures 87–91 (target ≥ 85) and LCP 3.0–3.1 s (target 2.5 s): the
  hero's heading beneath the intro is the largest paint. Every later visit, and every other page, is
  unaffected (97, LCP 2.1 s).
- **Monthly winners and several accounts (yours to choose; nothing changed by default).** The prize now
  goes to the most correct answers in a month. With right or wrong shown at once, one person with
  several accounts could find each day's answer by elimination and give their main account a perfect
  month — before, that bought only one quiz's race. The check is the staff review before a winner is
  announced, with the "same connection" count beside each candidate (LAUNCH_REPORT §5). To remove the
  possibility entirely, untick **Show right or wrong as soon as an answer is submitted** in Admin → Daily
  Quiz → Settings: students then learn right or wrong at midnight, with the solution.
- **Monthly winners and the rules page.** The rules page now describes the monthly prize and is dated
  9 October 2026; it is a legal draft, so `LEGAL_REVIEW.md` question 12 asks the reviewer to read it
  again — including whether a student who completes their profile after the month has ended may still
  win it (today they may: eligibility is read when the candidates are worked out).
- **R5 (PLAN.md) — `SameSite=Lax` session cookies.** Still `None`. Changing it safely needs a staging
  copy with its own backend; every preview deployment points at the production API.
- **Parental consent (Phase 6)** — built with the brief's wording; `LEGAL_REVIEW.md` question 8 asks
  whether a ticked box is enough for the DPDP Act's *verifiable* consent, how a parent withdraws it,
  and how long a parent's details are kept.
- **The organiser's name on invoices and certificates** — money and legal, so not guessed. A few
  strings there still use older spellings: the invoice's line item ("AMIT Maths Olympiad — entry fee
  (one-off registration for the official Olympiad)"), the issuer name an invoice uses when
  `INVOICE_ORG_NAME` is not set in Vercel ("A.M.I.T Maths Olympiad"), the certificate's signature line
  ("Founder, A.M.I.T Maths Olympiad") and the PDFs' hidden author and producer fields. They name the
  organiser rather than the product, so they wait on `LEGAL_REVIEW.md` question 1 (the organiser's legal
  name). Both documents are drawn afresh on every download, so a change also reaches ones already issued.
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

## Phase 7a — the Diwali edition: screenshots, and what differs from its mockup

Compared with the Diwali landing mockup the owner supplied in chat on 2026-10-08 (screenshots in
`docs/launch/screenshots/phase-7/`, taken 2026-10-09 from a production build with `?season=diwali`):

| Mockup | Built | Why |
|---|---|---|
| "LAUNCHING THIS DIWALI", a countdown to the launch, "Stay tuned!" | "LAUNCHED THIS DIWALI", a countdown to **today's Daily Quiz closing** (or, on a day without one, to the end of Diwali week) | The edition runs from the launch onward (owner, Q17): a launch countdown would be untrue |
| "Enter your email to get launch updates" + Notify me | Absent | The site is live, and an email list of children is data nothing keeps (Q17) |
| Early Access · Launch Updates · Special Diwali Surprises | Absent | Promises nothing backs |
| "Think Beyond the Textbook" under the name | The full form, as every day | It is shown once, under the wordmark (CLAUDE.md) |
| Classes 3 to 12 · Online · **Free to participate** · **Exciting prizes** | The everyday chips — Classes 3 to 12, any board, **free to prepare**, online | The Olympiad has an entry fee; prizes are the Daily Quiz's, named elsewhere |
| A painted night: the student, lanterns, fireworks, diyas, books | A drawn sky (SVG and CSS: lanterns, fireworks, diyas) behind the everyday hero art | No image to download on a slow phone; the mockup's art is one flattened picture |
| A five-card strip (Daily Challenges, XP & Streaks, 6-Month Journey…) | The everyday sections | They are on the page already, true as written (the journey has nine milestones, not six months) |
| "DIWALI SPECIAL — Be among the first to join… exclusive launch benefits, special badges and surprises" | "DIWALI SPECIAL — Earn the Diwali 2026 badge: answer any Daily Quiz from 8 to 15 November and it joins your achievements for good" | The one promise the code keeps (Q18) |
| A gold "Register Now" | The blue action button, glowing gold during the edition | One action colour (design system) |
| — | "The Diwali launch moment" intro, the lights and "Happy Diwali" in the header | Q17 |

## Phase 6 — screenshots, and what differs from the mockups

Compared side by side with both mockups (screenshots in `docs/launch/screenshots/phase-6/`, taken
2026-10-08 from a production build against the local database). Phase 6 changed no layout on either
page, so the Phase 3 and Phase 4 tables below still hold. What is new:

| Screenshot | Shows | Note |
|---|---|---|
| `homepage-1440`, `homepage-390`, `homepage-dark-390` | The homepage | The Phase 3 layout. "How winners are chosen" now names the parent's consent. Top Scholars is a table, not a podium: only two local students have XP, and a podium needs distinct ranks 1, 2 and 3. |
| `homepage-before-script-390` | The drawn homepage with the app's script held back — a slow phone's first screen | The same page the app draws, except that the header's theme switch and menu button have no icon yet: the icon font is added by the app once the page has loaded (report §7). |
| `dashboard-1440`, `dashboard-390`, `dashboard-dark-390` | The student dashboard | The Phase 4 layout. "No quiz today" is real — nothing was scheduled locally for 8 Oct. The phone shots use a viewport as tall as the page, so the bottom bar sits at the foot; in the Phase 4 and 5 shots a full-page capture drew it over the Daily Quiz card, where no reader ever sees it. |
| `register-consent-390`, `profile-consent-390` | Registration's parent-or-guardian section; My Profile → Prize details for an account made before it | New in Phase 6; neither mockup has a form. |
| `new-version-390` | What a reader sees when a deploy has replaced a page file | New in Phase 6; no mockup. |

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
  servers (5180 or the production build on 5190 → 8091) that signs in with the `seed-demo.ts` account
  through `POST /auth/login` and shoots full pages. The local backend's general rate limiter (300
  requests / 15 min) runs out after a few dozen captures — restart `launch-backend-local-db` to empty it.
  A full-page capture draws a fixed element (the phone's bottom bar) where the first screen ends: for
  those pages, set the viewport to the page's height and take an ordinary screenshot.

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
  (5181) and drives the installed Edge — 54 tests (40 run), about 8 minutes. Since Phase 5 the
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
