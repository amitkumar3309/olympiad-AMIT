# A.M.I.T. Olympiad — Diwali launch report

_Launch: **Sunday 8 November 2026**. Written 2026-10-06 at the end of Milestone 30, Phase 6 (brief §10–11)._

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

**The checks that guard it** — run before every commit:

- **Backend: 1,360 automated tests** (`npm test` in `backend/`), including the answer-key leak test (no
  student response carries the answer before midnight).
- **Browser: the end-to-end suite** (`npm run e2e` in `frontend/`, 44 tests, about seven minutes) —
  the quiz from start to the next day's reveal, registration → email → quiz, the dashboard,
  keyboard-only use, a crash and a weak connection, and a **crawler over every page** (guest and
  student on desktop and phone, the student also in the dark theme, the administrator on desktop) that
  fails on any console error, failed request, broken link, page without one heading, or **any serious
  accessibility violation (axe)**.
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
| `FRONTEND_URL` | **Must be the site's exact address** (e.g. `https://amitolympiad.me`, no trailing slash): every email link is built from it, and any other address is refused for every save |
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

## 5. Choosing, confirming and announcing winners

The rule is set in **Admin → Daily Quiz → Settings** (default: the fastest correct answer, measured by
the server from Start to Submit). Winners are **chosen by the rule and announced by a person**:

1. After midnight IST the quiz has closed. Open the quiz from the **calendar**.
2. Press **Compute winners**. Up to five candidates appear, fastest first, each with their solve time
   and whether they are **eligible** — a winner needs a verified email, name, class, school, **city**, a
   **parent or guardian's phone**, and (since Phase 6) **a parent or guardian's consent**. The fastest
   ineligible students are listed with what they lack.
3. For the winner: **Confirm** (this fixes the prize as the settings name it now), then **Announce** —
   the student is notified and appears on the public winners list (first name and last initial, or
   "A Class 9 student" if they chose to be hidden).
4. Call the parent or guardian on the number shown (staff only see it), then mark **Contacted**, and
   **Delivered** when the prize arrives. Every step is in the audit log.
5. If something is wrong (two accounts, a shared answer), **Disqualify** with a reason instead. The
   **"same connection" count** beside a candidate is a prompt to look, never proof.

The **Prize desk** tab lists every confirmed winner across days, with what is still to be done.

## 6. Switches you can change without a deploy

| Where | What |
|---|---|
| Admin → Daily Quiz → Settings | Prize headline and wording, **cash amount** (blank = "cash prize" with no figure), winner rule, winners per quiz, whether right/wrong shows at once |
| Admin → Payments | The **entry fee** (₹199 now) and the switch that turns it off (e.g. during a payment-provider outage) |
| Admin → XP awards | How much XP each event earns (history is never re-priced) |
| Admin → Referrals | Whether referrals earn anything, and how much (off by default) |
| `frontend/src/lib/siteConfig.ts` (a deploy) | The homepage's sections and their order |
| `frontend/src/lib/brand.ts` (a deploy) | The competition year (`2027`), the contact details, **the site's address** |

## 7. Known limitations — honestly

| Limitation | What it means | What would fix it |
|---|---|---|
| **Mobile homepage load** | Lighthouse, simulated slow 4G phone, four runs of the final build: **Performance 81–88, median 84** — the 85 target is met in two runs of four, so **not reliably** — and the main heading paints at **3.3–3.4 s** against a 2.5 s target. The runs differ in how long the page's main script holds the phone's processor. Desktop: **99**, 0.8 s ✅. Accessibility, best practices and SEO: **100** on every run | The page is drawn by the browser; pre-rendering the homepage's HTML is the next step — it moves both figures |
| **D10** — the root administrator on a brand-new database | The sign-in box cannot create the administrator account the first time; your live site is unaffected (it exists) | Your decision — see PROGRESS.md "Open questions" |
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
2. **Confirm the site's address.** It is set to `https://amitolympiad.me` in `frontend/src/lib/brand.ts`
   (used for search results and shared links). If the live site is `www.amitolympiad.me` or another
   address, tell me — it is a one-line change. Then check the backend's `FRONTEND_URL` in Vercel matches
   it **exactly**: Vercel → the backend project → Settings → Environment Variables → `FRONTEND_URL`.
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
9. **Decide D10** and **R5** (§7) — both can wait until after launch.

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
| Every row of `INTERACTION_AUDIT.md` passes and the link crawler is green | ✅ (D10 open for your decision) |
| Lighthouse, axe and security-header targets; no high/critical dependency vulnerabilities | Lighthouse mobile **not met**: score 81–88 (median 84) against 85, LCP 3.3–3.4 s against 2.5 s (§7); desktop 99; axe **0 serious/critical** on every page; CSP, HSTS, `frame-ancestors 'none'` and the rest set; **0 high/critical** in what ships (two moderate, unreachable — `SECURITY.md`) |
