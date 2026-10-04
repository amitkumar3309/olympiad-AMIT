# A.M.I.T. Olympiad — Diwali Launch Spec

> **For Claude Code.** This file is your complete brief. Read all of it before doing anything, and re-read the relevant section before each phase. It is long on purpose: each requirement exists to prevent a specific launch-day failure.
>
> - This spec: `docs/launch/LAUNCH_SPEC.md`
> - Homepage mockup: `docs/design/mockup-landing.jpeg`
> - Dashboard mockup: `docs/design/mockup-dashboard.jpeg`

---

## 0. How you must work

You are the senior full-stack engineer and product designer responsible for this launch. The owner is non-technical and will judge the result by using the site on his phone. Public launch: **Diwali, Sunday 8 November 2026**. Suggested milestones: feature-complete by Sun 25 Oct; code freeze and QA from Sun 1 Nov.

Work in the phases below. At the end of every phase: stop, post a short summary (what changed, how you verified it, open questions), update `docs/launch/PROGRESS.md`, and wait for me to say "continue". Never start the next phase on your own.

### Golden rules

1. **Discover before changing.** Never assume the framework, routes, data model or auth. Read the code and run it. Follow any existing `CLAUDE.md`.
2. **Extend, don't duplicate.** If the codebase already has something this spec describes (a "daily challenge", XP, streaks, leaderboards, an admin panel…), upgrade that feature. Never build a parallel second version. If the existing design conflicts with this spec, ask.
3. **Don't break what works.** Registration, login, email verification, payments/entry fee, results and certificates must behave exactly as before unless this spec says otherwise. For those flows the redesign is visual only.
4. **Real data only.** Every number, name, rank, date and photo in the mockups is a placeholder. Never hardcode them. If a widget's data doesn't exist: wire it up if it's cheap and in scope; otherwise hide the widget behind a feature flag and list it in the report. Never display invented figures (e.g. "12,458 students registered").
5. **The server decides everything that affects rewards** — time, correctness, attempts, winners. The browser only displays.
6. **No dead ends.** Every clickable element leads somewhere real, or is visibly disabled with an explanation.
7. **Small, verified steps.** Work on branch `feat/diwali-launch`. One logical change per commit (Conventional Commits). Before each commit run lint, typecheck, tests and a production build — all must pass. Never push to `main` or deploy unless I ask.
8. **Data safety.** Additive, reversible migrations only. Never drop or rename columns that hold data. Never run anything against production. Never print, log or commit secrets. Every new env var goes into `.env.example` with a comment.
9. **Dependencies.** Prefer what's installed. Don't switch framework, styling system, ORM or auth provider. Justify every new dependency in `PLAN.md` (purpose, gzipped size, maintenance, licence).
10. **Ask, don't guess** on anything involving money, auth, deleting data or legal text. For the product decisions in §3, use the stated default and say so in the plan.
11. **Prove it.** Don't say something works unless you ran it. Report evidence: commands, test output, screenshots.
12. **Stay resumable.** Keep `docs/launch/PROGRESS.md` (every task with its status) current so a fresh session can pick up where you left off. Add durable project conventions to `CLAUDE.md` as one-liners.

---

## 1. Context

**Product.** A.M.I.T. Olympiad ("Advance Mathematics and Intelligence Test") is a national-level maths olympiad platform for Indian students of Classes 3–12 from any school board. Registration and preparation (practice, mock tests, daily challenge) are free; sitting the Olympiad has an entry fee.

**Users.** Students aged roughly 8–17 — expect most of them on mid-range Android phones over mobile data — plus parents, teachers, and one admin (the owner).

**Locale.** All business logic runs in **Asia/Kolkata (IST)**, regardless of the server's time zone. Numbers use Indian digit grouping via `Intl.NumberFormat('en-IN')` (1,08,320). Dates read like "Sun, 8 Nov 2026 • 10:00 AM". Indian English spelling.

**The job has four parts:**

- **A. Redesign** the public homepage and the student dashboard to match the mockups, with purposeful animation and live, data-driven UI.
- **B. Daily Quiz** (new, or an upgrade of an existing daily challenge): a floating button on the homepage → login → one question per day → right/wrong saved in the student's profile → correct answer and solution unlock the next day. Includes admin tools and winner selection.
- **C. Rewards section** (new): each day's Daily Quiz winner gets a surprise gift and cash.
- **D. Launch hardening:** every button and link re-checked; every production-readiness requirement done.

**Mockups.** Open and study both images before planning, and re-open the relevant one while building each section. They are AI-generated visual direction: match their layout, hierarchy, visual style, colours, spacing rhythm and component shapes closely — but not their data and not their errors (Appendix B). Where a mockup and this spec disagree, this spec wins.

---

## 2. The owner's requirements (authoritative)

Translated from the owner's Hinglish message (original in Appendix A).

| # | Requirement |
|---|---|
| R1 | Re-check every single button and link; fix whatever is broken; complete everything else needed for a production launch. |
| R2 | Add the Rewards section. |
| R3 | Clearly state that the Daily Quiz winner gets a surprise gift and money. |
| R4 | Put a Daily Quiz button on the homepage itself — eye-catching and floating, and it should light up / shine when the cursor is over it. |
| R5 | Clicking it must first ask the student to log in, so that the question and whether they got it right or wrong show up in the student's own profile. |
| R6 | If the student wants the correct answer, they get it only the next day. |
| R7 | Don't try to stop students from looking things up (e.g. in ChatGPT) — that's their choice. No proctoring. |
| R8 | Launch on Diwali (Sun 8 Nov 2026). |

---

## 3. Product decisions and defaults

Use these unless I override them in my reply to your Phase 0 plan. Keep every tunable in one typed config module (owner-editable settings where marked ✎) — no magic numbers in components.

| Decision | Default | Why it matters |
|---|---|---|
| Feature name | "Daily Quiz" everywhere (dashboard card title "Today's Daily Quiz"; the mockup's "Today's Challenge" is the same thing) | One name kids can learn |
| Quiz window | 00:00:00–23:59:59 IST | |
| Answer + solution reveal | Next day, 00:00 IST | R6 |
| Show right/wrong immediately after submit | Yes (owner's request), behind a flag that can defer it to reveal time | Instant feedback + cash prizes makes multi-account elimination possible (§6.7) |
| Class targeting | 3 groups: Classes 3–5, 6–8, 9–12; admin can instead publish one quiz for all classes | Each group = one question **and one prize per day** — owner must confirm the cost |
| Winner rule | Fastest correct answer (server-measured solve time); tie → earlier submission; 1 winner per quiz; admin must approve before anything is public | |
| Prize copy ✎ | "Surprise gift + cash prize"; amount hidden unless set in settings | Never hardcode money |
| XP for a correct answer ✎ | 20 | Matches mockup activity feed |
| Streak | Consecutive IST days with a submitted Daily Quiz attempt | |
| FAB visibility | Homepage only (configurable for other public pages) | R4 says homepage |
| Per-student option shuffle | On | §6.7 |
| Dark-mode toggle | Hidden unless every redesigned page passes dark-mode QA | Half-done dark mode looks broken |
| Public display of students | First name + last initial, class, city or school; initials avatars; students can opt out in profile settings | They're minors |
| Missing destinations | Nav/sidebar items → "Soon" pill (non-interactive); footer links → hidden until the page exists | No dead ends |
| Brand expansion | Keep "Advance Mathematics and Intelligence Test" exactly as in the mockup; ask before changing to "Advanced" | Brand name |
| Mockup statistics | Real values only; hide any stat that isn't tracked | |

---

## 4. Phase 0 — Discovery and audit (read-only: no code changes)

1. **Stack and architecture:** framework and version, language, rendering model (SSR/SSG/SPA), routing, styling, component library, data fetching/state, ORM and database, auth provider and session model, email provider, file storage, hosting/deploy target (serverless or long-running?), cron/queues, analytics, error monitoring, test setup, CI.
2. **Baseline:** install; run lint, typecheck, tests and a production build; start the app. Record the results. Don't fix unrelated pre-existing failures yet — list them.
3. **Route inventory:** every page/route (public, auth, student, admin) with status: works / broken / placeholder / missing.
4. **Existing-feature check:** does a daily challenge/quiz, XP, streak, leaderboard, achievements, events, notifications or admin panel already exist? How does each work?
5. **Mockup gap analysis:** a table of every mockup section → implemented? → data available? → plan (reuse / restyle / rebuild / new / hide behind flag).
6. **Interaction audit (R1):** list every clickable element — nav items, CTAs, cards, icon buttons, dropdowns, tabs, form submits, footer links — on every page, as logged-out user, student and admin: page, label, expected action, current behaviour, status. Save as `docs/launch/INTERACTION_AUDIT.md`.
7. **Data inventory:** users (class, school, city, parent/guardian contact?), email verification, XP, streaks, leaderboards, question banks, events, certificates, results, payments. Note what this spec needs that is missing.
8. **Write `docs/launch/PLAN.md`:** stack summary; baseline results; gap table; schema changes with a migration plan; new dependencies with justification; the §3 decisions with the defaults you'll use; phased task list with checkpoints; risks.

**STOP after Phase 0 and wait for my approval.**

---

## 5. Phase 1 — Design system

One source of truth for design tokens (CSS custom properties + the project's theme config). Redesigned screens use tokens only — no raw hex values in components.

### 5.1 Colour

Sampled from the mockups (JPEG, so approximate). Refine by eye against the images; keep text contrast at WCAG AA.

| Token | Value | Used for |
|---|---|---|
| `--brand-600` | `#1D63F6` | Primary buttons, "2027", active states, links |
| `--brand-700` | ≈ `#154FD0` | Primary hover / pressed |
| `--brand-400` | `#5794FE` | Sidebar active gradient (`#4F8FFB → #5794FE`), accents |
| `--brand-50` | `#EEF5FE` | "You" row highlight, soft fills |
| `--bg` | `#F4F8FE` | Page background |
| `--surface` | `#FFFFFF` | Cards |
| `--border` | ≈ `#E6ECF5` | Card borders, dividers |
| `--track` | `#E8EEF5` | Progress-bar tracks |
| `--ink-900` | `#0B1533` | Headings |
| `--ink-700` | `#3F4556` | Body text |
| `--ink-500` | ≈ `#6B7489` | Muted labels (check contrast on `--bg`) |
| `--success` | `#12B981` | Correct states, LIVE dot, positive icons |
| `--success-ink` | `#0F7A4F` | Green text on white (AA) |
| `--danger` | `#E5484D` | Incorrect states, icons |
| `--danger-ink` on `--danger-50` | `#B42E33` on `#FCE1E6` | Countdown chips ("2d 14h") |
| `--gold` | `#F8B11E` | XP, trophies |
| `--orange` | `#F97A4A` | Streak |
| `--purple` | `#8B5CF6` | Achievements |
| Tints | mint `#EAFBE1`, cream `#FEFAEE`, aqua `#F4FDFC` | Maths Thought, Boss Battle, Month-End Booster cards |
| Podium | gold `#E8AC53`, silver `#C7D7EC`, bronze `#E7B089` | Top Scholars |

Subject colours stay consistent everywhere a subject appears: Algebra `#1C63F6`, Geometry `#FB8057`, Trigonometry `#0EBC85`, Coordinate Geometry `#9865F4`, Statistics & Probability `#FC7BB3`.

### 5.2 Typography

Keep the project's existing font if it's a clean geometric sans close to the mockups; otherwise use **Plus Jakarta Sans** for UI and headings, and **Caveat** only for the handwritten accents ("Think · Solve · Grow", "Same Questions, Bigger Thinking"). Self-host fonts (no render-blocking third-party CSS), `font-display: swap`, preload the main weight, Latin subset. Confirm the ₹ (U+20B9) glyph renders. Use `font-variant-numeric: tabular-nums` for timers, scores and tables.

Scale (desktop → mobile): hero 56→36px, page title 32→26, section title 28→22, card title 18→16, body 16→15, small 13, micro 12. Weights 800/700 headings, 600 labels, 400/500 body.

### 5.3 Shape, depth, spacing, layout

Card radius 16px; large banners 20–24px; pills fully rounded. Cards get a 1px `--border` plus a soft layered shadow (e.g. `0 1px 2px rgb(16 24 40 / .04), 0 8px 24px rgb(16 24 40 / .06)`). 4px spacing grid. Content max-width ≈1440px (dashboard) and ≈1200px (homepage). Breakpoints to test: 360, 390, 414, 768, 1024, 1280, 1440, 1920.

### 5.4 Components

Reusable and typed, each with loading/empty/error states where relevant: Button (primary / secondary / ghost / link; sizes; loading; disabled) · IconButton · Badge/Pill (LIVE, difficulty, countdown, "Soon") · Card · StatCard (icon, count-up value, label, delta) · SectionHeader (eyebrow, title, subtitle, "View all") · Tabs · **OptionTile** (A–D choice: idle / hover / selected / correct / incorrect / disabled; renders maths) · **Countdown** (server-synced) · ProgressBar · Avatar (photo or initials) · Podium + LeaderboardTable · JourneyTrack (done / current / locked) · ActivityList · Skeleton · EmptyState · Toast · Modal and bottom Sheet (focus trap, Esc, scroll lock) · Tooltip · **DailyQuizFab**.

Add a dev-only `/dev/ui` page (excluded from production) that renders every component in every state; use it for visual QA.

### 5.5 Maths rendering

Questions, options and solutions contain maths. Store them as Markdown + LaTeX and render with **KaTeX** (or the renderer the project already uses), server-side where possible. Sanitise all admin-authored content; no unsanitised `dangerouslySetInnerHTML`.

### 5.6 Icons, illustrations, photos

- One line-icon set matching the mockups (Lucide if available).
- The mockups contain illustrations (hero student with books, book stack, trophy, gift box, the six journey-stage scenes, mountain climber, plant, light bulb, maths doodles). Build an `<Illustration name="…">` component that loads from `/public/illustrations/` and falls back to a tasteful SVG/gradient placeholder, so final art can be dropped in without code changes. Write `docs/launch/ASSETS_NEEDED.md` listing each file: name, where it's used, display size, format (SVG, or WebP/AVIF at 1x and 2x with transparent background). Never hotlink or use unlicensed images. Never reproduce the garbled AI text visible on the mockup illustrations.
- Photos: a student sees their own uploaded photo. Other students (leaderboards, podium, winners) get initials avatars — they're minors.

### 5.7 Motion (purposeful, not decorative)

Motion should either explain a change or pull attention to the one thing that matters most — the Daily Quiz. Don't put the same fade-up on every section.

- **One orchestrated hero moment** on homepage load: headline, chips and CTAs settle in (≤700ms total, staggered); doodles drift slowly.
- **Data motion:** stats count up once when first visible (en-IN formatting); progress bars fill; journey connectors draw left→right and the current stage pulses softly; podium bars rise; countdown digits tick without jitter.
- **Feedback motion:** buttons press (scale 0.98); only clickable cards lift on hover; option tiles animate selection; a light confetti burst (≤1.5s) on a correct Daily Quiz answer; a calm, no-shake incorrect state.
- **Signature motion:** the Daily Quiz FAB (§7.2) is the most animated thing on the page.
- Timing: 120–180ms micro, 220–320ms UI, 450–700ms entrances; ease-out for entrances. Animate `transform` and `opacity` (box-shadow/filter only on small elements such as the FAB).
- `prefers-reduced-motion: reduce` → no looping/ambient motion, no confetti, no count-up (show final values), instant state changes.
- Content must be visible without JavaScript: never ship server-rendered content stuck at `opacity: 0`; gate reveal animations behind a JS-ready class.
- Use the animation library already installed; otherwise CSS + IntersectionObserver. Don't add more than ~40 KB gzip for animation. Hold 60fps on a mid-range Android (test with 4× CPU throttling).

### 5.8 Dark mode

The homepage mockup shows a theme toggle. Make the tokens dark-ready, but only ship the toggle if every redesigned page passes a visual check in dark mode (§3). Default theme: light.

### 5.9 Copy

Plain, encouraging, age-appropriate; sentence case except the mockup's eyebrow labels. A button says exactly what happens, and the name stays the same through the flow ("Submit answer" → toast "Answer submitted"). Error messages say what happened and what to do next. Fix all mockup typos (Appendix B).

---

## 6. Phase 2 — Daily Quiz core (R5, R6, R7)

Build the riskiest new feature first so it gets the most testing time. If a daily challenge already exists (Phase 0), this section describes its upgraded behaviour.

### 6.1 Rules (defaults from §3)

- One quiz per IST day per class group, open 00:00:00–23:59:59 IST. A quiz targets a class range; each student sees the quiz for their profile class, or an empty state if there isn't one.
- **Exactly one attempt per student per quiz:** database unique constraint on `(quizId, userId)` plus an idempotent submit (double clicks, retries, several tabs).
- The student presses **Start** to see the question; the server records `startedAt` and an elapsed timer is shown, so solve time is fair. Solve time = server `submittedAt − startedAt`. An attempt started but not submitted by closing time counts as "Not submitted" (no XP, no streak).
- After submitting, the student immediately sees **Correct ✅ or Incorrect ❌** (flag, §3) — but **not** which option is correct.
- The correct option and a full worked solution unlock at `revealAt` (next day 00:00 IST). Until then "View answer" is locked and shows a countdown ("Unlocks tomorrow at 12:00 AM").
- +20 XP for a correct answer; a submitted attempt counts toward the daily streak. Reuse existing XP/streak systems; otherwise add minimal, isolated ones.
- No proctoring (R7): no tab-switch detection, copy blocking or full-screen lock.

### 6.2 Data model (follow the codebase's naming conventions)

- **DailyQuiz:** id, quizDate (IST calendar date), classMin, classMax, topic, difficulty, questionMd, options `[{ id (random, opaque), textMd }]`, correctOptionId (server-only), solutionMd, opensAt, closesAt, revealAt, status (draft | scheduled | published | archived), createdBy, timestamps. Reject overlapping class ranges on the same date.
- **DailyQuizAttempt:** id, quizId, userId, startedAt, submittedAt, selectedOptionId, isCorrect, solveTimeMs, ipHash, userAgent, timestamps. Unique `(quizId, userId)`; indexes for per-quiz and per-user queries.
- **DailyQuizWinner:** id, quizId, userId, rank, ruleUsed, prizeText, status (provisional | confirmed | published | disqualified), reason, publishedAt, contactedAt, deliveredAt.
- **Settings:** prize headline/text, optional cash amount, winner rule, winners per quiz, feature flags.
- **Time:** all "today/now" logic goes through one tested module (e.g. `now()`, `istDayBounds(date)`, `quizStatus(quiz, now)`). Never call `Date.now()` directly in quiz logic — inject the clock so tests can time-travel. Derive state from timestamps rather than relying on cron jobs.

### 6.3 Server API (illustrative names; follow project patterns)

- **Get today's quiz:** metadata (topic, difficulty, class range, opensAt, closesAt, revealAt, `serverNow`) plus this student's attempt state. Question text and options only after Start. **Never** include `correctOptionId` or the solution before `revealAt` — not in JSON, server-rendered HTML, hydration/RSC payloads, client bundles or source maps.
- **Start:** creates the attempt with `startedAt` (idempotent).
- **Submit `{ selectedOptionId }`:** checks auth, quiz open by server time, attempt started and not yet submitted, option belongs to this quiz; stores the result; returns `{ isCorrect }` (when the flag is on) and never the correct option. Rate-limited.
- **History:** the student's attempts — question, their answer, result, solve time, XP; correct answer and solution only once revealed. Paginated.
- **Admin:** CRUD, bulk import, stats, compute winners, confirm / disqualify / publish. Authorised server-side.
- Personalised responses send `Cache-Control: private, no-store`. Validate every input with a schema. Client countdowns use the offset from `serverNow`; the client clock is never trusted.

### 6.4 Student UI

- Route `/daily-quiz` (or the existing equivalent), protected server-side. The dashboard card reuses the same component.
- States: loading skeleton → **not started** (topic, difficulty, class, "1 attempt only", closes-in countdown, rewards line, Start) → **in progress** (question, options A–D, elapsed timer, "Submit answer" with a confirm dialog: "You get one attempt. Submit option B?") → **submitted** (animated result card; confetti if correct; "Answer and solution unlock in HH:MM:SS") → **revealed** (correct option highlighted, their choice, worked solution) → **missed / not submitted** → **no quiz today**.
- Resilience: a failed submit retries safely; if the session expires mid-attempt, logging back in returns to the attempt with the selection kept (store the unsent selection locally until it's submitted).
- **My Profile → "Daily Quiz history"** (R5): newest first — date, topic, the question (expandable), their answer, ✅/❌, solve time, XP, and "Unlocks tomorrow" or "View solution". Summary: attempted, correct, accuracy, current and best streak, wins. Winners get a 🏆 on the row and a banner on the dashboard.
- If the profile lacks what prize eligibility needs (§6.6), show a gentle "Complete your profile to be eligible for prizes" prompt on the quiz card.

### 6.5 Admin (extend the existing admin; if none exists, create a minimal `/admin` protected by a server-side role check)

- **Schedule questions:** form with live Markdown/LaTeX preview — date, class range, topic, difficulty, 2–6 options with exactly one correct, solution. Duplicate a quiz. **Bulk import** (CSV/JSON) with a dry-run preview and per-row errors; the owner will load weeks of questions at once.
- **Calendar** of the next 14 days with a warning banner whenever a class group has no quiz scheduled in the next 3 days.
- **Per-quiz stats:** attempts, % correct, median solve time.
- **Winners:** after a quiz closes, "Compute winners" applies the configured rule and produces a provisional list (name, class, school, city, email verified?, parent/guardian contact, solve time, submitted at, shared-IP flag) → admin confirms, or disqualifies with a reason → **Publish** (appears in the Rewards section and notifies the winner on their dashboard). Track contacted / delivered. Audit-log every admin action (who, what, when).

### 6.6 Winner selection (default, configurable)

Among correct attempts, the shortest server-measured solve time wins; ties go to the earlier `submittedAt`. One winner per quiz. Eligible: verified email; complete profile (name, class, school, city, parent/guardian phone); not disqualified. Nothing is public until the admin confirms. Also support `FIRST_CORRECT` and `MANUAL` via config. The "How winners are chosen" text shown on the site must be generated from the same config the code uses, so they can never disagree.

### 6.7 Integrity (real money is involved)

- The answer key never reaches the browser before `revealAt` (automated test in §6.8).
- Opaque random option IDs, and option order shuffled per student (deterministic from userId + quizId). Solutions refer to the answer's value, not its letter.
- Instant right/wrong lets someone with several accounts find the answer by elimination. Mitigations: verified email required to play; generous per-IP registration limits; IP hash stored per attempt; shared-IP correct answers flagged in the winner review; admin approval before publishing. **Flags are prompts for human review, not automatic disqualification** — siblings and whole schools legitimately share one connection.
- Rate limits on start, submit, login, registration and password reset — tuned so a school registering 100 students over one Wi-Fi isn't blocked.

### 6.8 Tests (all must pass before this phase is done)

- **Unit:** IST day bounds (23:59:59 vs 00:00:00 IST, and the 18:30 UTC boundary), quiz status from timestamps, winner rule with ties and eligibility, deterministic shuffle.
- **API/integration:** unauthenticated → 401; a second submit never creates a second attempt; submit after close is rejected; class targeting; non-admins blocked from admin routes; **the answer key is absent from every response before reveal and present after**.
- **E2E (Playwright, desktop and 390px mobile):** start quiz → submit → result → profile history shows the attempt with the answer locked → move the clock to the next day → solution visible. (The homepage entry flow is tested in Phase 3.)
- Seed a few dev-only quizzes whose answers are verified by a script. Never invent production questions — the owner supplies them.

---

## 7. Phase 3 — Homepage (match `mockup-landing.jpeg`), floating button, rewards

### 7.1 Sections, in order (keep the order in a config array)

1. **Navbar** — logo + "A.M.I.T. OLYMPIAD / THINK • SOLVE • GROW"; Home, About, How it Works, Leaderboards, Gallery, FAQ (smooth-scroll with active-section highlight where the target is a homepage section; real routes otherwise); theme toggle (§5.8); "Sign in" (secondary), "Register" (primary). Sticky; gains blur + shadow on scroll. Mobile: hamburger → accessible drawer. Logged in: an avatar menu (Dashboard, My Profile, Log out) replaces Sign in/Register, with no flash of the wrong state.
2. **Hero** — eyebrow "NATIONAL-LEVEL MATHEMATICS OLYMPIAD"; H1 "A.M.I.T. Olympiad {EDITION_YEAR}" (config; year in brand blue); subtitle "Advance Mathematics and Intelligence Test"; chips: Classes 3 to 12 · Any school board · Free to prepare · Online mode; CTAs "Register for free" (logged in: "Go to dashboard") and "Explore more" (scrolls to How it Works); illustration, drifting doodles, handwritten accent, quote card. Whatever the LCP element is (H1 or hero image), it loads with priority, at the right size, with no layout shift.
3. **Live stats** — Students registered, Schools represented, Questions solved, Active today: real aggregates from a cached endpoint (revalidate ≈10 min); count-up on view; each stat hideable in config; hide stats that aren't tracked. "Active today" = distinct users active since 00:00 IST (add a throttled `lastActiveAt` update if missing, or hide it).
4. **"Can you crack this?"** — public sample question, no login. Tabs Mathematics / Logic / Reasoning / Brainstorming, each with ≥5 verified sample questions (DB or a typed data file). The 30-second timer starts when the card is ≥50% in view and pauses while the browser tab is hidden. "Submit answer" stays disabled until an option is chosen. Feedback is instant here (it's practice): correct/incorrect + one-line explanation + "Try another"; time-out reveals the answer. Then the CTA "Play today's Daily Quiz and win prizes" → the same auth-gated flow as the FAB. Options are a keyboard-operable radio group. **Don't reuse the mockup's question as-is: none of its options is correct (Appendix B).**
5. **Rewards** — new section, §7.4. Placed here so the motivation follows the sample question.
6. **How it works** — "From registering to being ranked", 4 steps (the mockup copy is good). Each card links to the matching real page (register, practice, Olympiad entry/fee details, results/certificates). The paper-plane dashed path draws on scroll.
7. **6-Month Mathematical Journey** — Number Forest → Logic Valley → Algebra Castle → Geometry Temple → Speed Arena → Olympiad Kingdom. On the homepage it's a programme overview (highlight the current programme month if a programme calendar exists in config). Horizontal scroll-snap on mobile. "View full journey" → a real page or modal with each stage's topics and rewards.
8. **Sunday Math Boss Battle** — live countdown to the next Sunday 10:00 IST (server-synced); "Every Sunday at 10:00 AM · Missed it? Reopens at 12:00 PM" (from config). "Get notified" opens a popover: Add to Google Calendar, Download .ics (weekly recurring) and, only if email reminders exist, "Email me a reminder". If the Boss Battle doesn't exist in the backend, ask me before advertising it.
9. **Month-End Booster** — "+100 XP" (config), "Last day of every month at 8:00 PM"; "Learn more" opens a modal with the rules.
10. **Top Scholars** — podium (ranks 1–3) + table (4–8) from the real leaderboard (reuse existing logic), displayed per §3; podium rises on reveal; "View full leaderboard" → the leaderboard page. Empty state when there are too few students.
11. **Final CTA** — "Ready to sit the paper?"; "Register now" and "I already have an account".
12. **Footer** — Explore (Leaderboard, Hall of Fame, Event Gallery); Results (Check a result, Certificates, Verify a certificate); Account (Sign in, Register); Help (`tel:` and `mailto:` links); **new** Legal column (Privacy Policy, Terms of Use, Daily Quiz & Rewards Rules, Refund & Cancellation Policy, Contact Us). Dynamic © year. Take contact details from existing config; if they differ from the mockup's (+91 97628 70716, support@amitolympiad.me), flag it — don't guess.

### 7.2 Floating Daily Quiz button (R4)

- **Placement and look:** fixed bottom-right (desktop 24–32px from the edges; mobile 16px plus `env(safe-area-inset-bottom)`); above content, below modals and toasts. Pill: lightning or gift icon + "Daily Quiz" + a small line "Win a gift + cash 🎁"; brand gradient, white text; a pulsing green dot while today's quiz is live. Fades/slides in ≈800ms after first paint and never delays LCP.
- **Idle:** gentle float (±4px, ≈3s loop) with a soft pulsing ring. On touch devices, a light shine sweeps across it every ≈6s.
- **Hover and keyboard focus (the "shine" the owner asked for):** the brand-coloured glow intensifies, a diagonal light streak sweeps across the pill (gradient pseudo-element, ≈700ms), slight scale(1.04). `:focus-visible` gets the same effect.
- **Reduced motion:** no float or sweep; a static glow on hover/focus.
- **Mobile:** collapses to a round icon button while the user scrolls down; expands when they scroll up or stop. Never covers form fields, the cookie notice or footer links (it lifts when they'd overlap).
- **Accessibility:** a real `<button>`/`<a>`; accessible name "Play today's Daily Quiz — winners get a surprise gift and cash"; at least 44×44px; visible focus ring; AA contrast.
- **Where:** per §3. Never on auth pages, admin, or the quiz page itself.
- **States** (from a lightweight status endpoint):
  - Logged out → "Daily Quiz · Win a gift + cash" → opens the Login Gate (§7.3).
  - Logged in, quiz live, not attempted → "Today's quiz is live" → quiz page.
  - Logged in, already attempted → "Done for today ✓ · See result" with "Answer unlocks in 5h 12m" → result.
  - No quiz scheduled → "Next quiz in 2h 10m" (or hidden, via config).

### 7.3 Login Gate (R5)

- A modal (bottom sheet on mobile): title "Log in to play today's Daily Quiz"; text "Your answer and result are saved to your profile. Each day's winner gets a surprise gift and cash!"; buttons "Sign in" (primary) and "Create free account"; a small "How rewards work" link.
- Both buttons carry `next=/daily-quiz` (or the app's equivalent). After sign-in → straight to the quiz. After registration → email verification (if required) → back to the quiz; keep the destination through the whole flow (e.g. embed `next` in the verification link).
- Validate `next` against an allow-list of internal paths (no open redirects). The quiz route itself is protected server-side; the modal is only UX.
- **E2E (Playwright, desktop + mobile):** logged-out homepage → FAB → Login Gate → sign in → quiz; and register → verify → quiz.

### 7.4 Rewards section (R2, R3)

- **Where:** homepage (§7.1 #5), a compact strip in the dashboard's Daily Quiz card, and the Login Gate.
- **Content** (starting copy; owner-editable in settings): title "Solve daily. Win daily."; subtitle "Answer the Daily Quiz — each day's winner gets a surprise gift and a cash prize! 🎁".
- **Cards:** **Daily Quiz Champion** — surprise gift + cash prize, "Winner announced the next day", CTA "Play today's quiz" (auth-gated flow); this card alone gets a subtle sparkle/shine · **Sunday Math Boss Battle** — big XP and leaderboard glory · **Month-End Booster** — +100 XP · **Badges & certificates** — 7-Day Streak, Speed Solver, Algebra Master, Top 50….
- **Recent winners:** the last 7 published winners (displayed per §3) with dates, as a carousel that pauses on hover/focus and is static under reduced motion. Before the first winner: "The first winner will be announced the day after launch — will it be you?"
- A short "How winners are chosen" summary (generated from config) + link to the rules page.
- Never hardcode a cash amount: show "cash prize" unless the owner sets an amount in settings.

### 7.5 Daily Quiz & Rewards Rules page

Route such as `/rewards/rules`. Plain-English, complete text covering: eligibility (registered students of Classes 3–12 in India, with parent/guardian consent); free to enter; one account per student; one attempt per quiz; how winners are chosen (from config); when they're announced; prizes delivered to the parent/guardian after verification; the organiser may verify and disqualify (multiple accounts, false details); prizes are non-transferable; applicable taxes; the organiser may change or cancel the contest with notice; contact details. Add a `TODO(legal-review)` comment in code and list the page under owner actions — it must be reviewed before launch.

---

## 8. Phase 4 — Student dashboard (match `mockup-dashboard.jpeg`)

**Shell.** Top nav (Home, Dashboard, Practice, Leaderboards, Gallery, Certificates) + notification bell + profile chip (name, class, student ID) with a dropdown (My Profile, Help & Support, Log out). Left sidebar: Dashboard, Daily Quiz, Practice Tests, Previous Papers, Concepts, My Progress, Leaderboards, Achievements, Certificates, My Profile, Help & Support; active state as in the mockup; motivational card at the bottom ("Discipline today, a top rank tomorrow."). Responsive: ≥1280px three columns as in the mockup; 1024–1279px icon-only sidebar with the right column moved below; <1024px drawer navigation + bottom tab bar (Home, Quiz, Practice, Leaderboard, Profile).

**Widgets** — each with a real data source, loading skeleton, empty state and error state:

1. **Welcome banner** — avatar, "Welcome back, {firstName}! 👋", quote of the day (config list, chosen deterministically by IST date), illustration.
2. **Stat cards** — Total XP (+this week), Global rank (of all students), Day streak, Questions solved (+this week), Accuracy (last 30 attempts). Count-up, green/red deltas; rank computed efficiently or cached.
3. **Today's Daily Quiz** — the §6 component with the LIVE badge and the rewards strip.
4. **Your 6-month journey** — personal progress (done ✓ / current / locked 🔒) from existing logic or config; "View full journey".
5. **Recent activity** — last 3 events with XP; "View all".
6. **Subject progress** — per-topic progress from real attempts; "View details" → My Progress.
7. **Today's maths thought** — config list, rotates daily.
8. **Upcoming events** — next Boss Battle, Month-End Booster (last day of the month, 20:00 IST), events from the DB; relative countdown chips ("2d 14h"); "View all".
9. **Today's top 5 (Class N)** — class leaderboard with the student's row highlighted; if they're outside the top 5, show their row below a "…" divider.
10. **Achievements** — earned badges, locked ones greyed out; "View all".
11. **Notifications** — unread count + dropdown (quiz is live, answer unlocked, you won, event reminders). If there's no notification system, derive these items from existing data without new infrastructure; if that isn't feasible, hide the bell via a flag.

Destinations that don't exist yet follow §3: build a minimal real page if the approved plan says so, otherwise a "Soon" pill. Never a dead link or a 404.

---

## 9. Phase 5 — Every button and link (R1)

Using `INTERACTION_AUDIT.md`, re-verify every clickable element after the redesign — desktop and mobile; logged out, student and admin.

- Every element has: the correct destination/action; hover, `:focus-visible`, active, disabled and loading states; correct semantics (links navigate, buttons act); an accessible name; a touch target of at least 44×44px. External links use `rel="noopener noreferrer"`; `tel:`/`mailto:` values are correct.
- No `href="#"`, `javascript:void(0)` or no-op handlers in shipped code — add a lint rule or test that fails on them.
- Forms: client and server validation, clear inline errors, spinner + disabled button while submitting, no double submission, success feedback, Enter submits.
- **Automated crawler (Playwright):** starting from the homepage and the dashboard (as anonymous user and as student), visit every internal link and assert 200 or an expected redirect, no console errors, no failed requests, no unhandled promise rejections.
- Update every row of `INTERACTION_AUDIT.md` with its final status.

---

## 10. Phase 6 — Launch readiness (R1: "whatever else is needed")

- **SEO and sharing:** unique title + description per page; canonical URLs; Open Graph/Twitter cards with a 1200×630 share image; favicon set, apple-touch-icon, web manifest; `sitemap.xml`; `robots.txt` disallowing admin, dashboard and API routes; Organization structured data; one H1 per page; `noindex` on authenticated pages.
- **Performance** (homepage on mobile, Slow 4G, 4× CPU slowdown): Lighthouse Performance ≥ 85 mobile and ≥ 95 desktop; LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms. AVIF/WebP images with explicit dimensions, lazy-loaded below the fold, responsive `srcset`; preloaded self-hosted fonts; dashboard and admin code-split; no layout shift from the FAB, banners or countdowns.
- **Accessibility:** WCAG 2.1 AA — contrast; everything keyboard-operable (tabs, modals, option tiles, menus); visible focus; focus trap in modals; `aria-live="polite"` for quiz results (timers must not announce every second); alt text; form labels; skip-to-content link; reduced motion. Automated axe checks in Playwright with zero serious or critical violations.
- **Security:** HTTPS only; headers (CSP tuned to what the site actually loads, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, `frame-ancestors 'none'`); session cookies HttpOnly + Secure + SameSite=Lax; CSRF protection on cookie-authenticated mutations; schema validation on every input; sanitised rich text; authorisation on every API route (students read only their own data; admin routes role-checked on the server); rate limits; no secrets or answer keys in client bundles; no public source maps unless verified safe; dependency audit with no high/critical issues; safe redirects; no stack traces in production error responses.
- **Privacy and legal** (the users are minors; India's Digital Personal Data Protection Act, 2023 requires verifiable parental consent for under-18s — what follows is a minimum, not a legal guarantee): Privacy Policy, Terms of Use, Daily Quiz & Rewards Rules (§7.5), Refund & Cancellation Policy (the Olympiad has an entry fee, and Indian payment gateways usually require these pages), Contact Us. Registration gets a required checkbox ("I am the parent/guardian, or I have my parent/guardian's permission, and I agree to the Terms and Privacy Policy") and a parent/guardian phone or email field; existing users are asked to complete it before they can win prizes. Cookie notice only if non-essential cookies are used. Mark every legal page `TODO(legal-review)` and list it under owner actions.
- **Reliability and ops:** branded 404 and 500 pages; a global error boundary; loading UI on every route; graceful behaviour when the API is slow; error monitoring (the existing tool, or Sentry if a DSN is provided); a health-check endpoint; DB indexes for every new query; no `console.log` noise in production; time zone explicit in code.
- **Email:** verification and password-reset emails branded, with correct production links. Owner action: SPF/DKIM/DMARC for the sending domain.
- **Analytics** (only if already present, or I approve): FAB click, Login Gate shown, sign-in from the gate, quiz start, quiz submit, registration complete.
- **Content:** spell-check every string; consistent names (A.M.I.T. Olympiad, Daily Quiz); real contact details; dynamic © year; edition year from config.
- **Browsers/devices:** latest Chrome, Safari on iOS, Firefox, Edge and Samsung Internet.

---

## 11. Verification and Definition of Done

**Every phase:** lint, typecheck, unit/integration tests and production build all green; Playwright E2E for the flows touched; screenshots of the homepage and dashboard at 390px and 1440px saved in `docs/launch/screenshots/`, compared side by side with the mockups (list deviations and why).

**Launch is done when:**

- [ ] Homepage and dashboard match the mockups' layout and style at every breakpoint, with real data and no placeholder numbers.
- [ ] The Daily Quiz works end to end: FAB → login → attempt → right/wrong → profile history → next-day reveal; admin scheduling and bulk import; winner computation, review and publishing.
- [ ] The answer-key leak test passes.
- [ ] The Rewards section, rules page and legal pages exist and are linked.
- [ ] Every row of `INTERACTION_AUDIT.md` passes and the link crawler is green.
- [ ] Lighthouse, axe and security-header targets are met; no high/critical dependency vulnerabilities.

**Final deliverable — `docs/launch/LAUNCH_REPORT.md`:** what was built; how to run it; env vars; how to schedule questions (with an example bulk-import file); how to compute, confirm and publish winners; config switches; known limitations; **owner action list** (illustrations from `ASSETS_NEEDED.md`, legal review, contact details, prize amounts, email DNS, backups, at least the first two weeks of questions loaded before launch); a plain-language checklist the owner can run on his phone; and a launch-day runbook (deploy, smoke test, rollback).

**Optional — only after everything above passes, and only if I say yes:** a dismissible Diwali launch banner that auto-expires on a configured date; a public archive of past Daily Quizzes; email or web-push reminders.

---

## Appendix A — Owner's original message (context only; §2 is authoritative)

> website ko pura time de de isko launch kr dete h ab
> fer
> har ek button recheck kr le or sath m jo b necessary requirment h wo kr le
> taki m isko deewali par launch kr lu
> or wo reward wala section b daal du
> m
> means daaal de tu
> or sath me wo b likh dena k daily quiz k winner ko surprise gift or money milegi and daily quiz ka button b add kr de homepage pr hi or usko mst sa bna dena floting and jb b cursor uspr aaye to wo light sa chmka de kuch and usprclick krne par phle login ka option hi aaye taki bchhe kiprofile m hi question and shi ya worng show kre or bchha agr us question ka answer janna chahe to next day hi usko mile. baki wo chat gpt krna chahe wo uski marji

## Appendix B — Mockup errors you must not copy

1. **The sample question has no correct option.** If x + 1/x = 3, then x² + x⁻² = 7 and x³ + x⁻³ = 18, so x⁵ + x⁻⁵ = 7 × 18 − 3 = 123 and the expression equals **123/7** — none of 11/3, 12/3, 13/3, 14/3. Use corrected options (e.g. 115/7, 119/7, 123/7, 127/7) or a different question. Verify every seeded question's answer with a script before shipping.
2. "MINTUES" → "MINUTES" in the Boss Battle countdown.
3. Mockup dates are invalid (e.g. "Sun, 12 Oct 2027" is a Tuesday). All dates are computed.
4. The text on illustrations (book spines etc.) is garbled AI output — never reproduce it.
5. All names, photos, XP, ranks and counts are placeholders and contradict each other across the two mockups. Use real data.
