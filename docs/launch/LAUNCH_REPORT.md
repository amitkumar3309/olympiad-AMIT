# A.M.I.T. Olympiad — Diwali launch report

_Launch: **Sunday 8 November 2026**. Written 2026-10-06 at the end of Milestone 30, Phase 6 (brief §10–11);
updated 2026-10-09 for Phase 7a (your requests of 8 October — §1, §6b) and for the monthly Daily Quiz
prize (your request of 9 October — §5)._

This is the one page to read before launch. It says what was built, how to run it, how to fill the
Daily Quiz and pay out its prizes, what is still yours to do, and how to launch and — if needed — roll
back. Everything technical is in the repository's own documents; this page points at them rather than
repeating them.

---

## 1. What was built

The launch brief (`docs/launch/LAUNCH_SPEC.md`) in seven phases — merged as pull requests #1 to #5
(Phases 0 and 1 together), with Phase 6 waiting for your review:

| Phase | What it gave the site |
|---|---|
| 0 — Discovery | The plan (`PLAN.md`), the baseline and the interaction audit (`INTERACTION_AUDIT.md`) |
| 1 — Design system | The mockups' look on every page: pale-blue page, white cards, one blue, Plus Jakarta Sans (self-hosted), nine new building blocks |
| 2 — Daily Quiz | One prize question a day per class group (3–5, 6–8, 9–12): Start → one attempt → right/wrong at once → answer and worked solution at midnight IST. Admin calendar, file import, winners (compute → confirm → announce → contacted → delivered), prize settings |
| 3 — Homepage | The new homepage, the floating Daily Quiz button and the Login Gate, the rules page, the four legal drafts, "Can you crack this?" from real past quiz problems |
| 4 — Dashboard | The student dashboard and shell from the mockup, the bell and account menus, `/activity` |
| 5 — Every button and link | Every control re-checked; a lint step that fails on a dead control; a link crawler over every page |
| 6 — Launch readiness | Search and sharing, accessibility, security headers, parental consent, crash page, performance, this report |
| 7a — Your requests of 8 Oct | The address `www.amitolympiad.me`; the first administrator can be created from the sign-in box (D10); **Past Daily Quizzes**, a public archive; **the Diwali edition** (§6b) with its intro and the Diwali 2026 badge |
| Your follow-ups of 9 Oct | The hero's picture of the day; the founder's quotes signed "— Amit"; the Diwali edition made immersive (the whole site at night, fireworks behind every page); **monthly winners** instead of daily ones (§5) |

**The checks that guard it** — run before every commit:

- **Backend: 1,399 automated tests** (`npm test` in `backend/`), including the answer-key leak test (no
  student response carries the answer before midnight).
- **Browser: the end-to-end suite** (`npm run e2e` in `frontend/`, 86 tests, about fifteen minutes) — the
  Diwali edition on its dates and off either side of them, the archive,
  the quiz from start to the next day's reveal, registration → email → quiz, the dashboard,
  keyboard-only use, a crash and a weak connection, the homepage readable before its script has run,
  **every tap answering within 200 ms on a slowed phone** (motion reduced — see §7), and a **crawler over every page** (guest
  and student on desktop and phone, the student also in the dark theme, the administrator on
  desktop) that fails on any console error, failed request, broken link, page without one heading, or
  **any serious accessibility violation (axe)**.
- **Lint** (`npm run lint` in both apps) — fails on a dead link or a button that does nothing.

## 2. Running it on your computer

From the repository root, in two terminals:

```bash
npm run dev:local --prefix backend
```

```bash
npm run dev --prefix frontend
```

`dev:local` forces a **local** database and switches email off, so nothing you do locally can touch
the live site or email a real person. Then open the address the second terminal prints.

To see exactly what will ship (the production build, with the production security headers), use
`npm run preview:prod --prefix frontend` instead of `dev`.

Tests: `npm test --prefix backend` and, from `frontend/`, `npm run e2e` (needs Microsoft Edge installed).

## 3. Environment variables

All are listed, with fake examples, in [`ENVIRONMENT_VARIABLES.md`](../../ENVIRONMENT_VARIABLES.md)
and `backend/.env.example`. **The frontend reads none.** In the backend's Vercel project the ones
that matter on launch day are:

| Variable | Why it matters |
|---|---|
| `MONGO_URI` | The live database |
| `JWT_SECRET` | Signs every sign-in; a long random value, never shared |
| `FRONTEND_URL` | **Must be the site's exact address** — `https://www.amitolympiad.me`, no trailing slash: every email link is built from it, and any other address is refused for every save |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` | The root administrator |
| `SMTP_*`, `EMAIL_FROM` | Sending the verification and password emails |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Taking the entry fee |
| `INVOICE_ORG_NAME`, `INVOICE_ORG_EMAIL`, `INVOICE_ORG_PHONE` (and `INVOICE_GSTIN` if registered) | What an invoice and the support line say |
| `GEMINI_API_KEY` | Optional — only the AI question drafting uses it |

## 4. Scheduling the Daily Quiz

A day with no quiz shows students **"No quiz today"** — nothing fills itself in (the old automatic fill
could pick a question whose answer was readable in Practice). **Load at least the first two weeks before
8 November.** The calendar warns three days ahead of any gap.

**From a file** (the quickest way to load many days):

1. Sign in as the administrator and open **Admin → Daily Quiz → Import a file**.
2. Download the **CSV template** there, or start from the example in this folder:
   [`daily-quiz-example.csv`](daily-quiz-example.csv) — three questions for **8 November**, one per class
   group, each answer checked by hand. One row is one quiz:

   | Column | What to write |
   |---|---|
   | Day | `2026-11-08` |
   | Classes | `3-5`, `6-8` or `9-12` (the three groups) |
   | Question, Option A–D | The question and up to four options; maths between `$…$` (e.g. `$x^2$`) |
   | Correct Answer | The letter: `A`, `B`, `C` or `D` |
   | Solution | **Required** — the worked solution students see after midnight |
   | Topic | Leave blank; the chapter is detected or you choose a fallback |
   | Difficulty | `Easy`, `Medium` or `Hard` |
3. Choose the file, press **Check the file**, and read every row it shows — it names every problem by
   its row number (a past day, two quizzes on one day for one group, a missing solution).
4. Tick the rows to keep and press **Save and schedule**. The questions are saved as drafts, kept out of
   Practice, and put on the calendar.

**One at a time:** Admin → Daily Quiz → **Schedule a quiz**, pick the day and class range, and choose a
question from the bank (it must be **unpublished** — a published question's solution is readable in
Practice).

A quiz can be **changed or removed until somebody presses Start** on it; after that it is the record of
what those students were asked.

**A question that is a picture** (since 9 October — a diagram, a scanned page, a photograph of a
question): Admin → Question Bank → **New question** → **Picture of the question** → choose the picture,
then **describe it in one line** — a screen reader says that line instead of the picture, so for a
student who cannot see it, that line is the question. Type the options and mark the right one as usual.
The worked solution can be written, or be a second picture (**Picture of the worked solution**). Many at
once: Admin → **Bulk Import** → **Pictures** → choose a chapter and up to 20 pictures → **Prepare the
pictures**, then describe and answer each card and approve. Pictures are made smaller before they are
uploaded, so a phone photograph is fine; crop each to its one question. Then schedule it like any other.

## 5. Choosing, confirming and announcing winners

Since 9 October there is **no daily winner** (your decision — PLAN.md Q24). Each month there is **one
winner in each class band** — Classes 3–5, 6–8, 9–10 and 11–12: the student who answered the most Daily
Quizzes correctly that month. A tie goes to the lower total solve time (measured by the server from
Start to Submit on each correct answer). An answer counts in the band of the class it was answered in.
**November counts from the launch on the 8th.** The rule is fixed, not a setting. Winners are **chosen
by the rule and announced by a person**:

1. From 12:00 AM India time on the 1st of the next month, open **Admin → Daily Quiz → Monthly winners**
   and pick the month (it opens on the last month that has ended). Before then the page says the month
   is not over and offers nothing to work out.
2. For each band, press **Work out candidates**. Up to five appear, most correct answers first, each
   with their total solve time and whether they are **eligible** — a winner needs a verified email, name,
   class, school, **city**, a **parent or guardian's phone** and **a parent or guardian's consent**. The
   highest-scoring ineligible students are listed with what they lack; eligibility is read at the moment
   you press the button.
3. For the winner: **Confirm** (this fixes the prize as the settings name it now — one winner per band),
   then **Announce** — the student is notified and appears on the public winners list (first name and
   last initial, or "A Class 9 student" if they chose to be hidden).
4. Call the parent or guardian on the number shown (staff only see it), then mark **Contacted**, and
   **Delivered** when the prize arrives. Every step is in the audit log.
5. If something is wrong (two accounts, shared answers), **Disqualify** with a reason instead and confirm
   the next candidate. The **"same connection" count** beside a candidate — how many other students
   answered from a connection they used that month — is a prompt to look, never proof. It matters more
   with a monthly prize: someone using several accounts to find each day's answer by elimination would
   have a perfect month. Unticking **Show right or wrong as soon as an answer is submitted** (Settings)
   removes that possibility entirely — students then learn right or wrong at midnight.

The **Prize desk** tab lists every confirmed winner across months, with what is still to be done.

## 6. Switches you can change without a deploy

| Where | What |
|---|---|
| Admin → Daily Quiz → Settings | Prize headline and wording and the **cash amount** (blank = "cash prize" with no figure) — what each month's four winners each receive — and whether right/wrong shows at once |
| Admin → Payments | The **entry fee** (₹199 now) and the switch that turns it off (e.g. during a payment-provider outage) |
| Admin → XP awards | How much XP each event earns (history is never re-priced) |
| Admin → Referrals | Whether referrals earn anything, and how much (off by default) |
| `frontend/src/lib/siteConfig.ts` (a deploy) | The homepage's sections and their order |
| `frontend/src/lib/brand.ts` (a deploy) | The competition year (`2027`), the contact details, **the site's address** |
| `frontend/src/lib/season.ts` and `backend/src/lib/seasons.ts` (a deploy) | **The Diwali edition's dates** — see §6b |

## 6b. The Diwali edition — 8 to 15 November 2026

**It switches itself on at 12:00 AM on Sunday 8 November and off at the end of Sunday 15 November,
India time. Nothing to deploy, nothing to remember**; on the 16th the site is exactly as it is today.

What a visitor sees during the week:

- **The intro** — about seven seconds, the first time each phone or computer opens the homepage that
  week (or, for a signed-in student who has not seen it, the first page of the student area): dark,
  embers rising; 3, 2, 1, a second each; a diya catches with a burst of sparks; its glow finds the
  mathematics around it; "A.M.I.T. OLYMPIAD 2027"; "THINK • SOLVE • GROW". Any tap or key skips it. It
  never plays for someone whose phone asks for less motion, over a timed paper, or when the address is
  for something else (`/#login`, a link back from sign-in).
- **The whole site at night** — every page, in either theme, on a night sky with **fireworks bursting at
  random places behind the content**, and cards edged in gold. The fireworks keep still for anybody whose
  phone asks for less motion, on the admin pages, and during a practice session, a mock test or the
  Olympiad. The light/dark switch is hidden for the week.
- **The homepage** — lanterns and diyas, the name in gold, "Launched this Diwali · A brighter mind for a
  brighter future", and a countdown to when **today's** Daily Quiz closes (on a day with no quiz, to the
  end of Diwali week). Below it, **Diwali Special: earn the Diwali 2026 badge** — answer any Daily Quiz
  that week and it stays in the student's achievements for good.
- **Everywhere a student goes** — a string of lights along the top bar, "Happy Diwali" beside the logo,
  and a warm gold glow on the main button and the Daily Quiz button.

**To see it before the 8th**, open `https://www.amitolympiad.me/?season=diwali` — it stays on for that
browser tab, and replays the intro. `?season=off` hides it again; `?season=auto` goes back to the dates.
To change the dates, change both files named in §6 and deploy.

## 7. Known limitations — honestly

| Limitation | What it means | What would fix it |
|---|---|---|
| **The homepage's first second on a slow phone** | The homepage arrives already drawn, so it can be read before its script has loaded; for that second or two its buttons (Sign in, the menu, the theme switch) do nothing and the menu and theme switch show no icon yet, while its links work | Expected for a page drawn ahead of its script — the price of the fast first paint (§11). Nothing to fix unless readers report it |
| **The first homepage visit during Diwali week** | The seven-second intro covers the page; the hero's heading beneath it is the largest paint, measured at 3.0–3.1 s on a slowed phone against 2.5 s; the score stays 87–91 | Expected for a full-screen intro; every later visit and every other page is unaffected (97) |
| **A tap with motion on** | The browser test (motion reduced) passes. With motion on — headless Edge on this laptop's GPU, the CPU slowed 4× — the slowest tap measures about 190–260 ms on an ordinary day (target 200) and typically 300–360 ms during Diwali week with the fireworks running (Phase 7a's edition: 320–430); the fireworks hold still while a tap is answered, without which it was 490–940 ms | Check it on a real phone (§9, step 13) |
| **Diwali week costs more battery** | With motion on, the homepage keeps the browser busier during the edition — 165–225% of one processor core at phone width, against 103–128% for Phase 7a's quieter edition and 71–89% on an ordinary day (headless Edge, all its processes). The fireworks already run at 30 frames a second, hold still for taps, stop in a hidden tab and never run for "less motion" | If a phone runs warm or drains that week: fewer fireworks, or fireworks on the homepage only (a small change) |
| **Session cookies are `SameSite=None`** | The brief asks for `Lax`; the site may already be same-site through the `/api` rewrite, but a wrong change logs everybody out | Test on a staging copy with its own backend first (PLAN.md R5) |
| **The icon font comes from unpkg.com** | If that service is down, icons disappear (never words — no icon carries meaning alone) | Self-host the two icon fonts |
| **Rate limits are per server instance** | Limits reset when Vercel starts a new instance; a school of 40 behind one connection shares one address | A shared store (Redis) — a cost decision |
| **No error monitoring** | A crash shows the student a clear "something went wrong" page, but nobody is alerted | Sentry (free tier) needs a DSN from you |
| **Browsers tested automatically** | Microsoft Edge (Chromium) only, at desktop and phone sizes | Chrome, Safari on iPhone, Firefox and Samsung Internet by hand — the checklist in §9 |
| **Legal pages are drafts** | Marked `TODO(legal-review)`; they invent no business term | Your lawyer — `LEGAL_REVIEW.md` |
| **Consent cannot be withdrawn on the site** | A parent who withdraws consent writes to support | A legal-review decision first |
| **Illustrations are placeholders** | Soft tinted shapes where the mockup has art | Drop the files in — `ASSETS_NEEDED.md`, no code change |

## 8. Your action list before launch

Do these in order; each says exactly where.

1. **Load at least two weeks of Daily Quiz questions** (§4) — 3 a day, about 45 questions.
2. **Point both addresses at one site — `www.amitolympiad.me`** (your answer of 8 October). The backend
   accepts sign-ins from exactly one address, so the bare domain must *redirect* rather than serve:
   1. Vercel → the **site** project (`amit-olympiad-web`) → **Settings → Domains**.
   2. Make sure `www.amitolympiad.me` is listed. If `amitolympiad.me` is listed too, open its **Edit**
      and choose **Redirect to `www.amitolympiad.me`** (308 Permanent). Save.
   3. Vercel → the **backend** project (`amit-olympiad`) → **Settings → Environment Variables** →
      `FRONTEND_URL` → set it to exactly `https://www.amitolympiad.me` (no slash at the end) → **Save**.
   4. **Deployments** → the latest → **⋯** → **Redeploy** (the backend only reads variables at start).
   5. Check: `https://amitolympiad.me` lands on `https://www.amitolympiad.me`, and signing in works there.
3. **Set the prize amount** if there is one: Admin → Daily Quiz → Settings → Cash amount.
4. **Legal review**: give `docs/launch/LEGAL_REVIEW.md` and the five pages (`/privacy`, `/terms`,
   `/refunds`, `/rewards/rules`, `/contact`) to your lawyer; the refund policy especially.
5. **Email delivery**: ask whoever manages `amitolympiad.me`'s DNS to set **SPF, DKIM and DMARC** for the
   sending address, or verification emails may land in spam. Send yourself a test registration after.
6. **Backups**: in MongoDB Atlas → your cluster → Backup, make sure snapshots are on (the free tier has
   none — consider the cheapest paid tier for launch month, or a daily `mongodump`).
7. **Illustrations** (optional): the files listed in `docs/launch/ASSETS_NEEDED.md`.
8. **The email sender's name** (optional): Vercel → the backend project → Settings → Environment
   Variables → `EMAIL_FROM`. The part before `<` is what an inbox shows; change it to
   `A.M.I.T. Olympiad` to match the emails' own wording, keeping the address exactly as it is.
9. **Decide R5** (§7) and **the organiser's name** on invoices and certificates (PROGRESS.md, "Open
   questions" — it follows from `LEGAL_REVIEW.md` question 1). Both can wait until after launch.
10. **Preview the Diwali edition** on your phone before the 8th (§6b): `https://www.amitolympiad.me/?season=diwali`.
11. **Watch the database size** once picture questions are in use: MongoDB Atlas → your cluster →
    **Metrics → Data Size** (the free tier holds 512 MB). A picture is about 100 KB; a picture question
    with a picture solution for all three class groups every day would be about 220 MB a year. When it
    passes about 400 MB, ask for the pictures to move to file storage (a contained change).

## 9. The phone checklist — 15 minutes, on your own phone

Do this on the **live** site after deploying, in Chrome **and** Safari (iPhone) if you can, with a test
account you create for it.

1. Open the site. The homepage loads, the header and the floating **Daily Quiz** button show.
2. Press **Daily Quiz** → the sign-in box appears → **Create free account**.
3. Fill the form, including a parent or guardian's phone and the agreement box; submit.
4. Open the verification email **on the phone**; tap the link; sign in.
5. You land on today's quiz. Press **Start**, choose an option, **Submit** → confirm → right/wrong shows.
6. Open **My Profile → Prize details**; add a city and save.
7. Open the **dashboard**: your figures, today's quiz card, the journey, the bell.
8. Open **Payment** — the fee shows (do not pay unless you mean to; a real payment is real money).
9. Sign out from the account menu.
10. Share the homepage link into WhatsApp: the preview card shows the A.M.I.T. Olympiad card.
11. Open `/?season=diwali`: the intro plays, then the night hero, the lights and "Happy Diwali"; reload —
    no intro the second time; open `/?season=off` to put it back.
12. Open **Past Daily Quizzes** from the footer: earlier quizzes, each answer behind **Show the answer**.
13. On the homepage, tap **I already have an account**: the sign-in box should open at once, with no
    pause you notice. If it lags, note the phone's model — it decides whether the homepage's moving
    pictures need to calm down (§7, "A tap with motion on").

If any step fails, note the step number and the phone and browser, and stop.

## 10. Launch-day runbook

**Deploy** — the site is two Vercel projects (`amit-olympiad-web` the site, `amit-olympiad` the API) that
both deploy when a pull request is merged into `main`.

1. Merge the last pull request into `main` (GitHub → the pull request → **Squash and merge**).
2. In Vercel, wait for **both** projects' new production deployments to show **Ready** (2–3 minutes).
   For the minute or two between them, only registration notices: if the API is ready first, a
   registration from the old form is refused (it has no consent box) and the student tries again a
   minute later; if the site is ready first, a registration goes through without its consent recorded,
   and that student is asked for it on My Profile. Nothing is lost either way.
3. Run the smoke test below.

**Smoke test** (5 minutes, from a computer):

1. `https://<your-site>/` loads; `https://<your-api>/health` answers `{"success":true…}`.
2. Sign in as a student → dashboard → Daily Quiz page shows today's quiz.
3. Sign in as the administrator → Admin → Daily Quiz: today and the next days have quizzes, no warnings.
4. Admin → Email delivery: the newest emails are **SENT**, not waiting.
5. `https://<your-site>/robots.txt` and `/sitemap.xml` show your domain.
6. Paste `https://<your-site>/leaderboard` straight into the address bar: the leaderboard opens, not the
   homepage. (The homepage is a page of its own now; every other address is served the app's shell.)
7. **On 8 November**, after 12:00 AM India time, open the homepage in a private window: the Diwali intro
   plays and the night hero shows. Nothing to deploy — the dates switch it (§6b). On the 16th, the same
   check shows the everyday homepage.

**Roll back** if something is badly wrong:

1. Vercel → the project that misbehaves → **Deployments**.
2. Find the previous deployment marked **Production** → the **⋯** menu → **Instant Rollback**
   (or **Promote to Production**). It takes seconds.
3. Roll back **both** projects if unsure. Every database change in this release only **adds** fields,
   so the older code reads the newer data safely.
4. Tell me what happened; a fix goes out as a normal pull request.

---

## 11. The brief's definition of done (§11)

| Item | State |
|---|---|
| Homepage and dashboard match the mockups' layout and style at every breakpoint, real data, no placeholder numbers | ✅ (deviations listed in PROGRESS.md; illustrations are placeholders until supplied) |
| The Daily Quiz end to end: button → login → attempt → right/wrong → profile history → next-day reveal; scheduling and bulk import; winners computed, reviewed and published | ✅ (E2E + backend tests) |
| The answer-key leak test passes | ✅ |
| The Rewards section, rules page and legal pages exist and are linked | ✅ (legal pages are drafts for review) |
| Every row of `INTERACTION_AUDIT.md` passes and the link crawler is green | ✅ (D10 fixed in Phase 7a) |
| Lighthouse, axe and security-header targets; no high/critical dependency vulnerabilities | ✅ Lighthouse, homepage, four runs: mobile **98** each (≥ 85), LCP **1.8–2.0 s** (≤ 2.5 s), CLS **0**, desktop **100**; INP — every tap within **200 ms** on a phone slowed 4× **with motion reduced** (slowest: 104 ms, and 144 ms during the Diwali edition, in the final run) — with motion on it measures 220–260 ms in a headless browser without a GPU, as before Phase 7a (§7); during Diwali week the first homepage visit plays the intro, and measures 86–92 with LCP 2.7–2.9 s (§7); axe **0 serious/critical** on every page; CSP, HSTS, `frame-ancestors 'none'` and the rest set; **0 high/critical** in what ships (two moderate, unreachable — `SECURITY.md`) |
