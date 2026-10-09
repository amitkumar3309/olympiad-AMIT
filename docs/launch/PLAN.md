# Diwali launch — Phase 0 plan

_Written 2026-10-04 against `a8bfad0`. Read-only discovery: no product code changed in Phase 0. Launch is Sun 8 Nov 2026,
**35 days away**; feature-complete target Sun 25 Oct (**21 days**)._

Companion files: [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) (the brief), [`INTERACTION_AUDIT.md`](INTERACTION_AUDIT.md),
[`PROGRESS.md`](PROGRESS.md). Mockups are in `docs/design/`.

---

## 1. Stack (as it actually is)

| Area | Finding |
|---|---|
| Frontend | React 19 + TypeScript, Vite 8, **SPA** (client-rendered, no SSR), react-router-dom 7, CSS Modules over a token layer (`src/styles/tokens.css`) and a 25-primitive design system in `src/components/ui`. No UI framework, no Tailwind. |
| Icons | Phosphor webfont from unpkg via `ui/Icon`; `lucide-react` is already installed and used on the landing page only (Milestone 28 ADR). |
| Fonts | Bricolage Grotesque (headings), Instrument Sans (body), Geist Mono (figures), Cinzel (wordmark/certificate) — all from Google Fonts CDN, not self-hosted. |
| Maths | KaTeX via `components/MathText.tsx`; author content validated by `backend/src/lib/mathContent.ts`. No `dangerouslySetInnerHTML` outside KaTeX output. |
| Charts | chart.js / react-chartjs-2 via `ChartCard` |
| Animation | none installed — CSS only |
| Backend | Node + Express 5 + TypeScript (`tsx`), zod, pino, helmet, express-rate-limit. 26 route modules, 37 services. |
| Database | MongoDB Atlas via Mongoose — 29 models. |
| Auth | Own implementation: short-lived access JWT + rotating opaque refresh token, both `httpOnly` cookies; bcrypt; RBAC with 23 permissions in `lib/permissions.ts`; CSRF via Origin/Referer check (`middleware/csrf.ts`). |
| Email | nodemailer over SMTP through a Mongo-backed outbox (`services/emailOutbox.ts`). |
| Payments | Razorpay (entry fee ₹199, gates the official Olympiad only). |
| File storage | Mongo buffers (photos, gallery); no object storage. |
| Hosting | Vercel, **two projects**, backend is **serverless** (`api/index.ts`). Frontend rewrites `/api/*` to the backend, so the browser talks to its own origin. |
| Cron / queues | None. Time-dependent state is derived from timestamps (good fit for the spec's "derive state, not cron"). Email outbox is swept on later requests. |
| Analytics | None. |
| Error monitoring | None (pino logs only). |
| Tests | Backend: vitest + supertest + mongodb-memory-server, **1289 tests / 36 files**. Frontend: **none**. No e2e tooling. |
| CI | **None** (no `.github/`). |

## 2. Baseline (run 2026-10-04 in this worktree, after `npm ci`)

| Command | Result |
|---|---|
| `npm test` (backend) | ✅ **1289 / 1289 passed, 36 files**, 275 s |
| `npm run typecheck` (backend) | ✅ clean |
| `npm run lint` (backend, eslint) | ✅ clean |
| `npm run compile` (backend) | ✅ clean |
| `npm run lint` (frontend, oxlint) | ✅ 0 errors, 3 pre-existing `only-export-components` warnings (ThemeContext ×2, AuthContext) |
| `npm run build` (frontend) | ✅ main chunk 236 kB / 73.6 kB gzip; KaTeX chunk 259 kB / 77.8 kB; chart chunk 181 kB / 63.4 kB |
| `npm audit --omit=dev` (frontend) | ✅ 0 vulnerabilities |
| `npm audit --omit=dev` (backend) | ❌ **high**: `nodemailer` (direct, non-breaking fix available); `@vercel/node` and its tree (build-time tooling; audit's suggested "fix" is a *downgrade* to 4.0.0 — needs judgement); `@xmldom/xmldom`, `brace-expansion`; **moderate**: `exceljs`/`uuid`, `ip-address`, `qs` |
| App started in a browser | **Not done in Phase 0.** Needs a local MongoDB for `dev:local`; Milestone 29's 87-assertion end-to-end harness passed 9 days ago. First browser pass happens at the start of Phase 1. |

Pre-existing defects found (not fixed yet — Phase 0 is read-only): see `INTERACTION_AUDIT.md` D1–D8. **D1 is the
important one**: a fill-in-the-blank daily challenge can never be answered (no input on the page, and the route drops
`textResponse`). Plus the stale `frontend/public/sitemap.xml` (lists `localhost:8080`, `/admin.html`).

## 3. What already exists (the spec's "extend, don't duplicate")

| Spec concept | Existing implementation | Verdict |
|---|---|---|
| Daily Quiz | **Daily challenge** (Milestone 8, extended in 24): `DailyChallenge` pinned per `{day, classLevel}`, `DailyChallengeAttempt` unique per `{student, day}`, IST day via `lib/competitionDay.ts`, server-owned rollover clock, admin scheduling with a 14-day strip, per-day attempt/correct stats, paginated history, 43 tests | **Upgrade it.** Rename to "Daily Quiz" in the UI only; keep model/endpoint names to avoid churn. |
| XP | Derived sum over `StudentActivity`; one engine `grantReward()`; amounts admin-tunable | Reuse |
| Streaks | Visit streak (`progressService`) and challenge streak (`challengeStreakOf`) — consecutive IST days with an attempt | Reuse (already matches spec definition) |
| Leaderboard | `leaderboardService` — overall/class × all-time/monthly/weekly/daily; masked names (`displayNameFor`) | Reuse for Top Scholars + "Today's top 5 (Class N)" |
| Achievements / badges | 10 achievements, 5 tiered badge families (`lib/achievements.ts`, `lib/badges.ts`) | Reuse; mockup badge names (Speed Solver, Algebra Master, Top 50) **don't exist** |
| Journey | `lib/journey.ts`: 9 *milestone* stages (enrolled → olympiad ready) | Exists, but **not** the mockup's 6 themed months — see Q7 |
| Notifications | In-app + email outbox, bell with unread count, 6 system events | Reuse; add quiz events |
| Admin panel | Full `/admin` with RBAC, audit log | Extend |
| Public stats | `GET /public/stats`: registered, registered today, schools (distinct `schoolName`), active today | Reuse; add "questions solved" |
| Rewards page | `/rewards` = the student's **XP & badges** page | Name collision — the spec's prize "Rewards section" is new and separate |
| Events (Boss Battle, Month-End Booster) | **Nothing** | Not built — see Q6 |
| Prizes / winners | Nothing (only referral payouts) | New |
| Legal pages | None | New |
| Parent consent, city, guardian contact, public-listing opt-out | None (has `fatherName`, `motherName`, free-text `address`) | New fields, additive |

### Daily challenge vs the spec, requirement by requirement

| Spec rule | Today | Change |
|---|---|---|
| One quiz per IST day per **class group** (3–5, 6–8, 9–12) | Per **class** (10 classes) | Q3 |
| Unique attempt per student per quiz | Unique `{student, day}` ✅ | keep |
| **Start** step, server `startedAt`, solve time | Attempt created at submit; no start | **New** |
| Show ✅/❌ only; reveal answer + solution at next 00:00 IST | Reveals answer **and** solution immediately (deliberate ADR, 2026-08-12) | **Supersede ADR** (R6 is the owner's explicit requirement) |
| +20 XP for **correct** | 15 XP for **answering** (ADR: paying for correctness rewards looking it up) | Q2 |
| Opaque random option IDs + per-student shuffle | Keys `a,b,c,d` in stored order for everyone | **New** — shuffle at serve time, opaque ids mapped server-side |
| No answer key before `revealAt` anywhere | Leaks after submit: result view, history, and the **public** Hall of Fame "challenge champions" board counts today's correct answers | Fix all three |
| IP hash + UA per attempt | Not stored | **New** (hashed with a server secret, never raw) |
| History | Paginated ✅ | Add reveal gating + solve time |
| Admin bulk import, 14-day calendar w/ gap warning, median solve time, winners | Schedule one day at a time; 14-day strip; attempts + % correct | Extend |
| Rate limits on start/submit | `challengeLimiter` 30/h on answer only, per IP | Add start; key per student, not IP (school Wi-Fi) |
| Automatic fill when nothing is scheduled | Picks a published **practice-bank** question by hash | Q4 — integrity problem once prizes exist |

## 4. Mockup gap analysis

### Homepage (`mockup-landing.jpeg`)

| Section | Built today? | Data available? | Plan |
|---|---|---|---|
| Navbar with section links + Sign in/Register | Partly (4 route links, no About/How it works/FAQ anchors) | n/a | Restyle; add anchors; avatar menu when signed in |
| Hero: eyebrow, "A.M.I.T. Olympiad 2027", full form, 4 chips, 2 CTAs, illustration | Partly (wordmark + full form + facts + CTAs) | Year in `lib/brand.ts` ✅ | Rebuild to mockup; illustration via `<Illustration>` placeholder |
| Live stats ×4 | 4 figures exist, but "Questions solved" isn't one of them | registered ✅ schools ✅ (free text — inflated by spelling variants) active today ✅ questions solved ❌ | Add questions-solved aggregate + 10-min cache |
| "Can you crack this?" sample question, 4 tabs | No | Needs ≥20 verified sample questions | New — Q8 |
| Rewards section | No | Winners: new | New (§7.4) |
| How it works, 4 steps | Yes ("From registering to being ranked") | n/a | Restyle; link each card |
| 6-Month Mathematical Journey | No | No programme calendar | Q7 |
| Sunday Math Boss Battle | No | **Not built anywhere** | Hidden behind flag — Q6 |
| Month-End Booster +100 XP | No | **Not built anywhere** | Hidden behind flag — Q6 |
| Top Scholars podium + table 4–8 | Top 3 exists | ✅ leaderboard | Rebuild podium + table; initials avatars |
| Final CTA | Yes | n/a | Restyle |
| Footer + Legal column | Footer yes, Legal no | n/a | Add Legal column + 5 pages |
| Floating Daily Quiz button | No | quiz status endpoint: new | New (§7.2) |
| Login Gate with `next=` | No (`ProtectedRoute` bounces guests to `/`) | n/a | New; also fixes D2 |

### Dashboard (`mockup-dashboard.jpeg`)

| Widget | Built today? | Data? | Plan |
|---|---|---|---|
| Top nav + bell + profile chip | AppShell has sidebar + bell; no top nav or chip | ✅ | Restyle shell (student only) |
| Sidebar: Dashboard, Daily Quiz, Practice Tests, **Previous Papers**, **Concepts**, My Progress, Leaderboards, Achievements, Certificates, My Profile, **Help & Support** | 16 items, different grouping | 3 bold items have no feature | "Soon" pill for the 3; map the rest |
| Welcome banner + quote | Title only | quote list = config | Restyle |
| 5 stat cards (XP +week, rank, streak, questions solved +week, accuracy last 30) | XP, level, streak, rank | XP ✅ rank ✅ streak ✅; weekly deltas, questions solved, last-30 accuracy need small aggregations | Extend `/me/dashboard` |
| Today's Daily Quiz card | Yes (`DailyChallengeCard`) | ✅ | Rebuild around new quiz component |
| 6-month journey | No | — | Q7 |
| Recent activity (3) | Yes | ✅ | Restyle |
| Subject progress (per topic bars) | On `/analytics`, not dashboard | ✅ `analyticsService` byTopic | Reuse; the mockup's 5 subject colours become per-chapter `--cat-*` |
| Today's maths thought | No | config list | New (config) |
| Upcoming events | No | Exams ✅, Boss Battle/Booster ❌ | Show real exam windows only unless Q6 |
| Today's top 5 (Class N) | Overall leaderboard card | ✅ class × daily scope exists | Switch to class/daily + own row |
| Achievements | Yes | ✅ | Restyle |
| Right-rail motivational card | No | static copy | New |

## 5. Conflicts between the spec and this repository's recorded decisions

The spec says "if the existing design conflicts with this spec, ask". These are the ones that matter. Each has my
recommendation.

**Decision log.** The owner replied **"continue"** on 2026-10-04 without overriding any row, so every recommendation
below is the working decision (the spec's own rule: defaults stand unless overridden). Four rows needed a *fact* only
the owner has; **all four were answered on 2026-10-04**, after Phase 2:

| Row | Owner's answer (2026-10-04) | Where it lands |
|---|---|---|
| Q3 | **Three class groups a day** (3–5, 6–8, 9–12), one winner each — about 90 prizes a month. Still not a code decision: the model takes any range, so this is how quizzes are *scheduled*, and the rules page says it. **The prize half is superseded by Q24 (2026-10-09): one winner a month in each class band, not one a quiz.** | Rules page (Phase 3); scheduling |
| Q7 | **Map our 9 milestones** — the existing XP journey (`lib/journey.ts`, Enrolled → Olympiad ready) drawn in the mockup's track style. No invented months or topics. | Homepage (Phase 3), dashboard (Phase 4) |
| Q8 | **I draft, the owner reviews.** Claude drafts Logic, Reasoning and Brainstorming (≥5 each) with answers checked in code; they stay hidden until the owner approves them. **Reversed 2026-10-05:** no demo question on the landing page — "it should be a real daily problem". The section now shows past Daily Quiz problems whose answers are public (never today's), and the sample set is deleted. | Homepage "Can you crack this?" (Phase 3) |
| Q9 | Phone **`+91-97828-70716`** — "write in this format only" — and email **`support@amitolympiad.me`**. Same digits the code already had; the email domain changed. | `lib/brand.ts` `SUPPORT`, `INVOICE_ORG_*` defaults — applied on the Phase 2 branch |

| # | Conflict | Recommendation |
|---|---|---|
| **Q1** | **Visual language.** The mockups use a pale blue page (`#F4F8FE`), soft shadows under cards, `#1D63F6`. The repo's current rules (owner, 2026-09-21) are: a **white page everywhere**, **no shadow on any card**, hairline borders, primary `#0052FF`. | Follow the mockups on the **two redesigned pages** by re-pointing the semantic tokens (one change in `tokens.css`, every page inherits it), i.e. supersede the Milestone 28 "white everywhere / no card shadows" rules. ~~Keep the existing fonts (Bricolage + Instrument Sans are close enough to the mockup's geometric sans; Plus Jakarta would be a 5th family).~~ **Corrected in Phase 1:** Plus Jakarta replaces *both* Bricolage and Instrument Sans, so it is one family fewer, not one more; and side by side against the mockup, Bricolage failed the brief's own "clean geometric sans" test. Plus Jakarta Sans is now the UI and heading face (see the Milestone 30 Phase 1 ADR). Caveat only for the two handwritten accents. |
| **Q2** | **XP.** Today: 15 XP for *answering* (ADR: paying for correctness rewards looking it up). Spec: 20 XP for a *correct* answer. | Spec default: **20 XP for correct, 0 for wrong**. The original reason doesn't survive R7 ("ChatGPT is their choice"). Streak still counts any submitted attempt. |
| **Q3** | **Class groups.** Today one quiz per class (10/day). Spec: 3 groups (3–5, 6–8, 9–12) = **3 winners and 3 prizes per day ≈ 90 prizes/month**, or one quiz for all = 30/month. | Use 3 groups, but **you must confirm the prize budget** (3/day). The model gains `classMin/classMax`; existing per-class rows stay readable. **Answered 2026-10-04: three groups a day.** |
| **Q4** | **Automatic fill.** Today an unscheduled day auto-picks a published practice question. Those questions' solutions are visible in Practice, so a prize quiz drawn from them can be looked up inside our own product. | **Turn auto-fill off for the Daily Quiz.** Only admin-scheduled quizzes; quiz questions are kept out of the practice pool until their reveal date. If a day has no quiz, students see "No quiz today" and the admin calendar warns 3 days ahead. |
| **Q5** | **Dark mode.** Repo: dark mode is complete and follows the OS on first visit. Spec: default light, ship the toggle only if every redesigned page passes dark QA. | Keep dark mode and the OS default; I'll QA both redesigned pages in dark. If they don't pass by code freeze, hide the toggle and force light. |
| **Q6** | **Sunday Math Boss Battle and Month-End Booster** don't exist in the backend (no events at all). The spec says ask before advertising Boss Battle. | **Don't build them for Diwali** (each is a real feature: a timed event, its own XP rule, notifications). Hide both sections and the "Upcoming events" entries behind flags; show real Olympiad exam windows instead. Say yes if you want them, and I'll re-plan. |
| **Q7** | **6-Month Journey** (Number Forest → Olympiad Kingdom) has no programme calendar or topic list. The existing journey is 9 achievement milestones. | Need your content: what topics and dates belong to each month? Without it, hide the section on both pages (or map the existing 9 milestones onto the visual track — your call). **Answered 2026-10-04: map the 9 milestones.** |
| **Q8** | **"Can you crack this?"** needs ≥5 verified questions for each of Mathematics, Logic, Reasoning, Brainstorming. | I write the maths ones and verify each with a script. For Logic, Reasoning and Brainstorming I need your questions, or I draft them for your review. Until then those tabs are hidden. **Answered 2026-10-04: I draft, the owner reviews. Superseded 2026-10-05: real past Daily Quiz problems, no sample set.** |
| **Q9** | **Contact details** differ from the mockup: code has `+91 9782870716` and `support@amitolympiad.com`; mockup shows `+91 97628 70716` and `support@amitolympiad.me`. | Keep the code's values (they are also on invoices). Confirm which is right. **Answered 2026-10-04: `+91-97828-70716` (exactly that format) and `support@amitolympiad.me`.** |
| **Q10** | **Wordmark punctuation.** Code: `A.M.I.T`; mockup: `A.M.I.T.` (trailing stop). | Follow the mockup (`A.M.I.T.`) everywhere — one constant. Confirm. |
| **Q11** | **Icons.** Spec: one line-icon set, Lucide preferred. Repo: Phosphor everywhere except the landing page (Lucide since M28). | Lucide on the homepage + dashboard (already installed); Phosphor stays on the other ~50 routes. Converting everything is out of scope for Diwali. |
| **Q12** | **Prize copy and amount.** | "Surprise gift + cash prize", amount hidden until you set one in admin settings. |
| **Q13** | **Prize eligibility needs** verified email + name, class, school, **city**, **parent/guardian phone**. City and guardian phone don't exist today. | Add optional `city`, `guardianPhone`, `guardianEmail`, `guardianConsentAt`, `hideFromPublicLists` to `Student`. Required at registration from now on (consent checkbox + guardian phone); existing students get a "complete your profile to be eligible for prizes" prompt. Registration stays otherwise identical. |

## 5b. The owner's requests of 2026-10-08 (Phase 7)

After the brief was finished (PRs #1–#8), the owner asked for more, and answered the questions it
raised the same day. Phase 7 builds them in two halves: **7a** the address, D10, the archive and the
Diwali edition; **7b** picture questions and Daily Quiz reminders.

| Row | Owner's answer (2026-10-08) | Where it lands |
|---|---|---|
| Q14 | The live site is **`www.amitolympiad.me`**. | `SITE_URL` (`lib/brand.ts`). The bare domain should redirect to it, and the backend's `FRONTEND_URL` must match it exactly (owner action) — 7a |
| Q15 | **D10: yes**, as proposed — the one sign-in box may create the root administrator on a brand-new database. | `/auth/login` hands over before the account exists — 7a |
| Q16 | **A public archive of past Daily Quizzes** (the brief's optional extra). | `/daily-quiz/archive` — 7a |
| Q17 | **The Diwali edition, 8–15 November 2026 only, then back to normal**: the Diwali landing mockup (supplied in chat) and "the Diwali launch moment" intro (dark, 3-2-1, a diya lights, equations glow, the name, the line). Asked and answered: the hero says **"Launched this Diwali · A brighter mind for a brighter future"** with a countdown to today's quiz closing — not the mockup's launch countdown, "Notify me" email box or "Early access", untrue from 8 November; the intro ends on **"Think • Solve • Grow"** (the logo's line, not "Conquer"); other pages get **festive touches** (lights, a greeting, a gold glow), not a full recolour; **fixed in code**. | `lib/season.ts`, `public/boot.js` — 7a |
| Q18 | **A real Diwali 2026 badge**, so the Diwali Special strip's promise is true: answer any Daily Quiz from 8 to 15 November. | The `diwali_2026` achievement — 7a |
| Q19 | **Picture questions instead of OCR, "as of now"**: the uploaded image *is* the question, the admin types the options and marks the right one, the worked solution is a second picture, plus a one-line description for screen readers. | 7b — **built 2026-10-09** (`feat/picture-questions`; §5c) |
| Q20 | **Daily Quiz reminder emails: opt-in, at 7:00 AM IST.** | 7b |
| Q21 | (2026-10-09) **The hero's empty square gets a picture — "positive and motivational", "updated regularly".** | Seven drawn pictures, a different one each day (`PictureOfTheDay`) — owner's follow-up |
| Q22 | (2026-10-09) **The quotes are the founder's: sign them "— Amit", not "— A.M.I.T."** | `FOUNDER` (`lib/brand.ts`): the hero's quote, the student motto and the dashboard's thought — owner's follow-up |
| Q23 | (2026-10-09) **The Diwali intro "very fast … keep it a bit slow, engaging and immersive"; the fireworks "more realistic and dynamic", bursting "at different random places"; "full immersive for home page and logged in users as well".** Asked and answered: **the whole site at night** for the week — the homepage and every signed-in page, in either theme, with fireworks bursting at random places behind the content (superseding Q17's "festive touches, not a full recolour") — and the intro **once that week** for a signed-in student too. | The intro about seven seconds, a second per number (`DiwaliIntro`, `INTRO_MS` 7300); the dark values under `data-season` (`tokens.css` §10); `components/Fireworks` — a canvas drawn in a worker (`lib/fireworks/`); `DiwaliIntroPlayer` in the student area — owner's follow-up |
| Q24 | (2026-10-09) **"There will not be a daily winner, we'll be having a monthly winner who has highest score."** Asked and answered: the score is **correct answers in the month, the lower total solve time breaking a tie**; **one winner per class band** (3–5, 6–8, 9–10, 11–12); **staff check early the next month**; **November counts from the 8th** (superseding Q3's "one winner each"). | `rankMonthlyCandidates()` and `PRIZE_BANDS` (`lib/dailyQuiz.ts`); a month's prize is a `DailyQuizWinner` row with `period: 'month'`; Admin → Daily Quiz → **Monthly winners**; the winner rule and winners per quiz retired from the settings; every page that names the prize — owner's follow-up |

## 5c. Phase 7b — the plan (2026-10-09)

**Two fixes found while mapping the code come first**, because 7b builds on both:

- **Request logs hold session tokens.** `pino-http`'s default serializers log every request and
  response header — `cookie` (the access and refresh tokens) and `set-cookie` — so the production
  logs contain raw tokens (CLAUDE.md: never log a raw token). The reminders' trigger secret would join
  them. Fix: `redact` those headers in `lib/logger.ts`.
- **The gallery cannot take the images it promises.** `POST /admin/gallery` accepts 1 MB images but
  was given no body allowance, so anything over ~73 KB is refused by the 100 KB default parser — and
  the error handler turns that refusal into a 500. Fix: an allowance, and a 413 that says what the
  limit is, for every route.

### Picture questions (Q19)

- **A picture is an attachment, not a question type.** `Question` gains `image` (`{key, alt, width,
  height}`) and `solutionImage` (`{key, alt, width, height}`), both optional. The type stays
  `single_choice` (or any type): `'single_choice'` is written in 34 places, and the Daily Quiz needs
  it. The question text becomes optional when there is a picture (it can still carry a line such as
  "Look at the figure"); the worked solution may be text, a picture, or both — publishing and the
  Daily Quiz need one of them. The alt text is **required** for the question picture (1–300
  characters: what a screen reader says instead of the picture); for the solution picture it is
  optional and defaults to "The worked solution, as a picture".
- **Images live in MongoDB, in their own collection** (`QuestionImage`: the bytes `select: false`,
  type, size, width, height, a random 32-character `key`), like the registration photo and the
  gallery — no new service, ₹0. They are **immutable**: a changed picture is a new image, so a Daily
  Quiz that snapshotted one keeps showing exactly what it showed. **Budget**: the browser shrinks every
  picture before upload (longest side 1600 px, WebP or JPEG, typically 50–150 KB) and the server
  refuses one over 1 MB. At ~100 KB a picture, a picture question with a picture solution for all
  three class groups every day would take ~220 MB a year of Atlas M0's 512 MB. Real use will be a
  fraction of that, but the owner is told to watch the database size (LAUNCH_REPORT), and the storage
  sits behind one service, so moving pictures to object storage later is a contained change.
- **Served by an unguessable key, never by its database id** (two ids minted in one request differ by
  a counter, so the solution's id would be guessable from the question's): `GET
  /question-images/:key`, cacheable for a year because it never changes. The key reaches a browser
  only inside a view that may show the picture — so the **solution picture's key appears only where
  the solution may** (a submitted practice session, a mock test's permitted review, the Daily Quiz's
  `revealOf()`), and today's quiz picture only after Start. The answer-leak tests extend to both.
- **Metadata is stripped on the server** (EXIF — a phone photo carries its GPS position), because a
  revealed quiz picture becomes public in the archive; the browser's re-encoding also drops it.
  Dimensions are read from the file, not trusted from the browser, so every `<img>` reserves its
  space (no layout shift).
- **Authoring**: the question editor gets "Picture question" — upload, describe, then the options and
  the correct one as usual — and a solution picture. **The import page's Image tab stops using OCR**
  (owner: "i don't want ocr as of now"): it takes up to 20 pictures, makes each a draft candidate,
  and the review screen asks for each one's description, options, correct option and solution — the
  same review-then-approve path as every importer, provenance `picture_import` read from the
  `ImportBatch`. The Gemini OCR route stays in the backend, unused by the interface, until the owner
  wants it back.
- **Everywhere a question is shown**, the picture is shown: practice, mock tests, the official exam,
  the Daily Quiz (panel, history, archive, "Can you crack this?") and the admin pages. A picture can
  be opened full size (a scanned question at phone width can be small).
- **Known cost**: on the Daily Quiz the solve time starts at Start, and the picture downloads after it;
  on a slow connection that is a second or two of the student's time. Pictures are kept small for
  this reason.

### Daily Quiz reminders (Q20)

- **Opt-in per student**: `notificationPrefs.dailyQuizReminders`, **off** unless the student turns it
  on — in My Profile, and with one tap on the Daily Quiz page. A new optional email category,
  `reminders`. Sent only to a verified address, an active account, a class that has a quiz that day,
  and a student who has not already started it.
- **At 7:00 AM IST, triggered from outside**: the owner chose a free external pinger over paid Vercel
  Cron (PROJECT_STATE.md, "Daily-challenge automation"), and Vercel's free cron is only hour-accurate. So `POST
  /jobs/daily-quiz-reminders` and `POST /jobs/outbox`, each requiring `Authorization: Bearer
  <JOBS_SECRET>` (a new environment variable, compared in constant time, refused with a 503 naming
  the variable when unset). The owner points cron-job.org at them: the reminders once a day at 07:00
  Asia/Kolkata, the outbox every minute — which also closes known bug #41 (mail waiting on an idle
  site).
- **Reminders never crowd out a verification email.** The outbox gains a **priority**: security and
  transactional first, reminders last. A **daily cap** (default 100, staff-editable in Daily Quiz
  settings, with an on/off switch) keeps reminders inside the email provider's free quota (Brevo's is
  300 a day, shared with every sign-up). Each reminder carries a dedupe key per student per day, so a
  second trigger sends nothing twice. Sent reminder rows expire after 14 days (a partial TTL — the
  rest of the outbox keeps its no-TTL rule), so a year of reminders does not fill the free database.
- **The email names nothing a student could use before Start**: the class range, the topic and the
  closing time (what the quiz card already shows) — never the question. It loads nothing (CLAUDE.md)
  and ends with how to turn reminders off.
- **The settings page shows the last run** (day, time, how many were queued and skipped), so the
  owner can see the pinger is working.
- **Legal text is not changed**: the Privacy Policy draft does not mention reminder emails yet —
  added as a question to `LEGAL_REVIEW.md`.

### Commits, in order

1. `fix(security)`: redact credentials from request logs. 2. `fix(gallery)`: the upload allowance and a
real 413. 3. `feat(questions)`: picture storage and serving. 4. `feat(questions)`: picture questions in
the bank, practice, mock tests and the exam. 5. `feat(daily-quiz)`: picture questions in the Daily
Quiz. 6. `feat(import)`: picture import instead of OCR. 7. `feat`: picture questions in the interface.
8. `feat(daily-quiz)`: opt-in reminders and the job endpoints. 9. `feat`: reminders in the interface.
10. `docs`.

## 6. Schema changes (all additive, all reversible)

| Collection | Change | Migration |
|---|---|---|
| `DailyChallenge` | + `classMin`, `classMax` (default = existing `classLevel`), `opensAt`, `closesAt`, `revealAt` (derived from `day`, stored), `status` (`draft/scheduled/published/archived`, default `published` for existing rows), `prizeEligible` (bool), `createdBy` | Read-path default for old rows; no rewrite needed. New overlap check is service-side + a new index on `{day, classMin}`; the old `{day, classLevel}` unique index stays until all rows are group-based (drop is a later, separate decision). |
| `DailyChallengeAttempt` | + `startedAt`, `solveTimeMs`, `optionOrder` (the per-student permutation served), `ipHash`, `userAgent` | Optional fields; old rows have no start → no solve time → not winner-eligible (all are in the past anyway). |
| **`DailyQuizWinner`** (new) | quiz, student, rank, ruleUsed, prizeText, status (`provisional/confirmed/published/disqualified`), reason, publishedAt, contactedAt, deliveredAt, decidedBy | New collection; unique `{quiz, rank}` and `{quiz, student}` |
| **`DailyQuizSettings`** (new, single pinned doc like `RewardSettings`) | prize headline/text, optional cash amount, winner rule (`FASTEST_CORRECT`/`FIRST_CORRECT`/`MANUAL`), winners per quiz, flags (instant feedback, FAB visibility, show stats, events) | New collection |
| `Question` | + `reservedUntil` (date) — kept out of practice/mock/daily auto-fill until its quiz is revealed | Optional; every availability pipeline gains one `$match` |
| `Student` | + `city`, `guardianPhone`, `guardianEmail`, `guardianConsentAt`, `hideFromPublicLists` | Optional; nothing back-filled |

`classLevel` stays an enum; groups are numeric ranges over the class number, so no enum migration.

## 7. Dependencies

| Package | Purpose | Size | Maintenance / licence | Verdict |
|---|---|---|---|---|
| `@playwright/test` (frontend dev) | E2E the spec requires (§6.8, §7.3, §9 crawler, axe) | dev-only, 0 kB shipped | Microsoft, Apache-2.0, very active | **Add** (needs an ADR — CLAUDE.md requires one for a frontend test framework) |
| `@axe-core/playwright` (dev) | a11y checks in E2E | dev-only | Deque, MPL-2.0 | **Add** |
| `canvas-confetti` | ≤1.5 s confetti on a correct answer | ~4 kB gzip | MIT, stable | Optional — a CSS-only burst is ~40 lines; I'll write the CSS one and skip the dependency |
| Caveat font | Two handwritten accents | one Latin woff2, 73 kB (loaded only on a page that uses it; not preloaded) | OFL | ✅ **Done in Phase 1**, self-hosted |
| Self-hosted fonts (Plus Jakarta Sans, Geist Mono, Cinzel, Caveat) | §5.2, §10 perf | Plus Jakarta Latin 27 kB (preloaded) + Latin-Ext 21 kB (only where ₹ appears) | OFL; files from `@fontsource-variable/*` 5.3.0 via `npm pack` — **no npm dependency added** | ✅ **Done in Phase 1** (moved forward from Phase 6) |
| Sentry | Error monitoring | ~25 kB gzip | — | Only if you provide a DSN (free tier) |
| Animation library | — | — | — | **None** — CSS + `IntersectionObserver` |

`nodemailer` will be bumped to a patched version (non-breaking per `npm audit`). `@vercel/node` needs a closer
look — audit wants a downgrade, which I won't do blindly.

## 8. Phased task list

| Phase | Scope | Exit check |
|---|---|---|
| **0** | This document, `INTERACTION_AUDIT.md`, `PROGRESS.md` | your approval + answers to Q1–Q13 |
| **1 — Design system** (≈3 days) | Re-point tokens per Q1; Caveat; new primitives the spec lists that don't exist (OptionTile, Countdown, Podium, JourneyTrack, ActivityList, Sheet, DailyQuizFab, Illustration); `/design-system` extended (it is the spec's `/dev/ui`); `ASSETS_NEEDED.md` | `/design-system` in both themes at 360/390/768/1280/1440; contrast sweep clean |
| **2 — Daily Quiz core** (≈6 days) | Time module with an injected clock; schema changes; start/submit/reveal; shuffle + opaque ids; leak fixes (result view, history, Hall of Fame); XP per Q2; fix D1; admin calendar + bulk import (CSV/JSON dry-run) + stats + winners (compute/confirm/disqualify/publish, audit-logged); Playwright set-up + ADR | unit + integration + E2E (§6.8) incl. **answer-key leak test** |
| **3 — Homepage** (≈5 days) | All §7.1 sections per answers; FAB; Login Gate with `next=` allow-list through verification email; Rewards section; rules page; legal page drafts | E2E: FAB → gate → sign in → quiz; register → verify → quiz |
| **4 — Dashboard** (≈4 days) | Shell restyle, widgets, `/me/dashboard` extensions, profile Daily Quiz history | screenshots vs mockup, 390 + 1440 |
| **5 — Every button** (≈2 days) | Re-verify the audit; D2–D8; lint rule for `href="#"`; Playwright link crawler | crawler green |
| **6 — Launch readiness** (≈4 days) | SEO (sitemap, robots, OG image, per-page titles, noindex), self-hosted fonts, Lighthouse, axe, CSP, SameSite (see risk R5), registerLimiter, legal checkbox, branded 500, error boundary, `LAUNCH_REPORT.md` | §11 checklist |

Total ≈ 24 working days against 21 to feature freeze; Q6/Q7 answered "hide" is what makes it fit.

Branch: `feat/diwali-launch` (this worktree is on `claude/launch-spec-review-95ec29`; I'll create the branch from it
at the first commit). One logical change per commit; lint + typecheck + tests + build before each.

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Real money + instant ✅/❌** → multi-account elimination | verified email to play, IP-hash flag, admin approval before publishing; flags prompt review and never auto-disqualify |
| R2 | Answer key leaking through a path nobody thought of (Hall of Fame already does) | one reveal function; a test that stringifies every quiz-related response before and after `revealAt` |
| R3 | **No questions loaded** on launch day | admin calendar 3-day gap warning; owner action: load ≥2 weeks before 8 Nov |
| R4 | Scale: `/leaderboard` and `/me/dashboard` cap at ~30 req/s (Milestone 29), and the redesign puts the leaderboard on the homepage and adds dashboard widgets | short-TTL cache on the public aggregates (stats, top scholars) in Phase 3; keep dashboard additions to cheap indexed queries |
| R5 | Spec wants `SameSite=Lax`; prod is `none` because it was assumed cross-site. The frontend actually proxies `/api` through its own origin, so `Lax` may work — but a wrong change logs everyone out | verify on a Vercel preview before changing; CSRF Origin check stays either way |
| R6 | `registerLimiter` was 10/hour per IP — a school registering a class behind one NAT was blocked | ✅ **Fixed on `main` on 2026-10-04** (`ddb7927`: 50/hour; `a997b91`: `paymentLimiter` 300/hour), merged into this branch. `challengeLimiter` is still 30/hour **per IP** — the quiz's start/submit limiters will be keyed per student in Phase 2 |
| R7 | Rate limiter `MemoryStore` resets on a serverless cold start | known; acceptable for launch (Redis is a cost decision) |
| R8 | Legal pages and DPDP parental-consent requirements | drafts marked `TODO(legal-review)`; owner action before launch |
| R9 | Illustrations: the mockups' art isn't in the repo | `<Illustration>` placeholders + `ASSETS_NEEDED.md`; owner supplies art. **Deviation from §5.6:** the art lives in `frontend/src/assets/illustrations/`, discovered at build time, not `public/illustrations/` — probing `public/` for an absent file is a 404, which the browser logs as a console error on every page (the §9 crawler would fail). Dropping a file in still needs no code change. |
| R10 | No CI | run the full gate locally before every commit; optionally add a free GitHub Actions workflow (say if you want it) |
