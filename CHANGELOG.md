# CHANGELOG.md

Chronological development history. For current state, see [`PROJECT_STATE.md`](PROJECT_STATE.md) instead — do not let this file's older entries get treated as current fact.

## 2026-08-31 — Milestone 24: a real Class 9 daily challenge, and a clock on it

Three things the owner asked for before a client demonstration: a genuine daily challenge
for Class 9, a Class 9 student to view it as, and a **timer** saying that the question
changes automatically the next day — or sooner, if an administrator changes it.

### The countdown is served, not computed

`GET /me/daily-challenge` now carries `rollover`: `nextChangeAt` (an absolute ISO instant),
`secondsRemaining` (a duration) and `timezone` (`IST (UTC+05:30)`). It is sent in **every**
state of the endpoint, including the two empty ones — "nothing is published for your class
yet" is a state a reader wants a horizon on too.

**A browser must not decide when the competition day turns.** The boundary is IST midnight
(`lib/competitionDay.ts`, now exporting `dayStartsAt`, `nextDayStartsAt` and
`secondsUntilNextDay`), so a device in another timezone would count down to the wrong
moment and one with a wrong clock to an arbitrary one — the same rule that makes a mock
test's clock the server's. `components/ChallengeCountdown.tsx` only *displays* the two
figures, and when it reaches zero it **re-asks the server** rather than assuming a new
question is in place.

Both figures are sent because they fail differently: a duration is immune to a device clock
that is hours out, and an absolute instant is immune to a timer throttled in a background
tab. Each tick therefore measures wall-clock time against the deadline instead of counting
its own firings, which is why a page left open all afternoon still reads correctly.
`secondsUntilNextDay()` rounds **up**, so it never reports `0` while the day is still
today — a `floor` would report zero for the whole final second and a client refetching at
zero would spin against a day that had not turned.

The challenge view also gained `source` (`scheduled` / `automatic`). The page says both that
the question changes at midnight *and* that staff may change it sooner, and those two
sentences are only honest together: a student told "this changes at midnight" who finds a
different question at four in the afternoon has been told something untrue.

**Follow-up the same day, at the owner’s instruction:** the student-facing copy was cut back to the
timer alone — "The next question appears when this timer runs out". The administrator sentence and the
`scheduled` / `automatic` clause are gone from `/daily-challenge`, and `ChallengeCountdown` no longer
takes a `source` prop. `challenge.source` stays on the payload and in the tests; nothing a student sees
reads it. The tradeoff was stated and accepted: if staff re-point a day the question can change before
the timer ends, and the page corrects itself on the next load.

### An administrator can now change a day, not only set one

`PUT /admin/daily-challenges/:id` has existed since Milestone 8 and had **no interface**.
The only way to correct a day was to clear it and add it again — and for *today* that left a
gap in which the automatic fill could pin something else. `/admin/daily-challenges` now
offers **Change question** on any day nobody has answered, reusing the same picker, and
states the two refusals in the page instead of leaving them to a failed request: a day with
attempts is "now a record, so it cannot be changed", and a past day "is kept as the record
of what was set".

### A real Class 9 bank, and a demo account

- `scripts/data/class9Maths.ts` — **73 questions across the twelve CBSE chapters**, every
  answer a result that can be checked by hand and every question carrying a worked solution.
  Where π appears the question states which value to use, because `22/7` and `3.14` disagree
  at two decimal places and a numeric answer is marked against a stored number.
- `scripts/seed-class9.ts`, over a new **shared runner** `scripts/lib/seedQuestions.ts` that
  `seed-class12.ts` now also uses. Copying five hundred lines to change one constant is how
  two seeds end up disagreeing about what a valid question is, and a seed is the one place
  in this product that writes questions without a human reading each one.
- `scripts/seed-demo.ts` — one verified Class 9 student, the entry fee recorded as a
  **captured payment with `statusSource: 'manual'`** and no invented Razorpay id or
  signature, and today's challenge scheduled deliberately (`--days=7` pins a demo week).
  **A week of challenges is a spread, not the top of the bank** — the rule
  `suggestPaper()` already follows: the planner round-robins chapters, least-used first,
  counting days that were already pinned, and prefers a question type the previous day did
  not use. Its first seven-day run put three coordinate-geometry questions on consecutive
  days, two of them near-identical; the current plan covers seven chapters in seven days and
  alternates numeric with multiple choice. Deterministic, so Thursday's question can be
  answered before Thursday.
  It **refuses to run with no published Class 9 question** rather than provisioning an
  account whose challenge page is empty, and it fabricates **no history**: no streak, no
  practice sessions, no XP beyond the one award a real registration also grants. The
  mandatory registration photograph is a generated flat-colour PNG — a demo must not carry a
  real child's face, and a stock photograph implies a person who did not consent.

**A dry run that wrote was caught during verification.** `seed-demo.ts` ended by reporting
what today resolves to *through the service*, and `resolveChallengeFor()` pins an automatic
challenge when none exists — so report-only mode wrote a `DailyChallenge`. It now reads the
stored row in that mode. Same trap the taxonomy half of the seed runner already documents.

### Verified in a browser, against a real database

Signed in as the seeded student: the countdown renders and ticks (33m 00s → 32m 57s), the
note reads "A new question is set automatically at midnight, IST (UTC+05:30) — Tue 12:00 AM
in your local time. Your administrator can also set a different question before then —
today's was chosen by them", the question is answered and marked **4/4 with +15 XP** and its
worked solution, and the dashboard card carries the compact form. As the root super
administrator: the three row states are exactly as designed, and **Change question** on a
future day round-tripped a `PUT` to 200 with the row updating to the new question. No
non-2xx call and no console error in the flow. The verification answer was then removed, so
the demo account starts unanswered.

`competitionDay`'s new arithmetic and the endpoint's new field are pinned by **five new
tests** in `tests/dailyChallenge.test.ts`, including that `nextChangeAt` agrees with the day
being served and that IST midnight is 18:30 UTC the previous evening.

## 2026-08-29 — A developer credit, in the two places a credit belongs

`components/DeveloperCredit.tsx`, rendering "Designed and developed by **Sachin Kukkar**"
in the public footer's legal strip and "Built by **Sachin Kukkar**" at the foot of the
signed-in navigation panel — so it is visible to a visitor, a student and an administrator
without being visible *over* anything. The name links to
[sachinkukkar.tech](https://sachinkukkar.tech).

**Not an overlay and not a floating badge.** The design direction for this product is
"minimal, not visually noisy", and a watermark sitting on top of a child's exam paper is
the opposite of that. A footer line is where a reader looks for authorship, and it is the
placement that survives somebody redesigning the page around it.

The link carries `rel="noopener noreferrer"`: `noopener` because a `target="_blank"` link
otherwise hands the opened page a live `window.opener` back into this one, and `noreferrer`
so the destination is not told which page of a children's competition platform the reader
came from. "Opens in a new tab" is in the accessible name rather than in the arrow glyph
alone, per the rule that no icon may be the only carrier of meaning.

The name and URL live in `lib/brand.ts` beside the other on-screen facts that have no
source of truth in the database. Verified at 375px (stacked, 8.4:1) and 1280px (side by
side), signed out, as a student and as an administrator, in the drawer and in the permanent
sidebar: no page overflow, no dangling ARIA, no heading change.

## 2026-08-29 — The competition year returns to the hero

Owner-supplied, after Milestone 23 Phase F removed it and flagged it rather than deciding.

`AMIT_COMPETITION_YEAR` lives in `frontend/src/lib/brand.ts` beside the expansion of the
name, for the same reason: it is a fact about the brand that appears on screen and that
**nothing in the backend knows**. A sitting's dates come from the `Exam` window an
administrator announces, and the certificate this product prints carries no year at all —
its serial uses the year it was *issued* in. So the constant is the single place to change
when the sitting moves, and the single place to look when somebody asks where the year came
from.

Verified at 375px (two lines, 343px wide, no overflow) and 1280px (one line at 48px), with
the expansion still directly beneath it and no heading, contrast or emoji regression.

## 2026-08-29 — Milestone 23, Phase H: the final regression

Every flow driven end to end in a browser against a real backend and a real database, not
inspected. **No backend file was touched in this phase or in any of the seven before it**
(1253 tests across 35 files, unchanged), and the set of endpoints the frontend calls is
byte-identical to where the milestone started: 100 references before, 100 after.

### What was actually exercised

A **new student registered through the form** — fourteen fields, a photograph, three steps
— and got `AMIT_1702`. Then, as that student: signed in, updated the profile (`PATCH
/me/profile`), started a **practice session**, answered, submitted, and got a server-marked
review showing `-1 / 4` on a wrong answer and +25 XP; answered the **daily challenge**,
which took the streak 0 → 1 and awarded +15 XP; sat a **mock test** under a server-owned
countdown and submitted through the confirmation dialog; read their **referral code**, and
confirmed the public validate endpoint resolves it with the referrer's name masked to
"Regression H.".

As the root super administrator: **created a question** through the editor (`POST` → 201)
and **published it** through the bulk action; **uploaded the generated Excel template back
through the importer** (5 examined, 5 usable, 1 unreadable, nothing written) and ran the
**dry-run validate**, which answered "all 5 would save"; downloaded a real **invoice PDF**
(`%PDF-1.7`, `AMIT-INV-2026-0A89426065CE`) and a real **student export** (`.xlsx`); and read
the payments, referrals, generator and audit consoles.

**139 API calls across 35 routes, zero non-2xx, zero JavaScript errors**, and every declared
route renders — including `/*`, which now has a page.

### Two defects the regression found, both in the answer runners

**A failed answer save left the counter claiming it had succeeded.** Tripping the rate
limiter mid-paper produced a mock test whose header read "3 answered", whose submission
dialog said "All 3 questions are answered", and which came back **0/12 with every question
marked NOT ANSWERED**. The optimistic update is right — the UI must not lag a click behind —
but leaving it in place after a failure makes the counter, the palette and the dialog all
state something the server does not hold, on the one screen where a student is deciding
whether they are finished. Both runners now **roll the answer back** and say plainly
"That answer was not saved — try again". Verified by forcing a 503 on the save: the counter
holds at 0, the choice clears, the message appears, and the next successful save counts.

**Two heading skips that only exist when a page has data.** Phase G measured
`/analytics` and `/daily-challenge` empty, so the recommendations block and the explanation
panel were never rendered. Answering a challenge and submitting a session made them appear —
a heading audit on an empty page is half an audit.

### Obsolete CSS removed

**31 rules across ten page stylesheets** that nothing references any more: `tileLabel` /
`tileValue` replaced by `StatTile`, `tableWrap` by `TableScroll`, `editBtn` by `Button`,
`errorBox` by `Alert`, and the Taxonomy sheet's whole subject block, which went with the
subject picker several milestones ago. A CSS Module class is scoped to its own file, so an
unreferenced one is dead by construction. Files whose component uses a computed
`styles[...]` lookup were excluded from the sweep, which is why no `components/ui` primitive
appears in it. **No unused export remains in `components/ui`.**

The first removal pass broke the build: a brace scanner treated `@media (...) {` as a rule
and swallowed a media query's closing brace. The nesting-aware pass is what ran.

## 2026-08-29 — Milestone 23, Phase G: the responsive and accessibility audit

Every important page measured in a browser at 375, 768, 1280 and 1440px, in both themes,
signed out, as a student and as the root super administrator. **Frontend only; no backend
file was touched** (1253 tests across 35 files, unchanged), and the set of endpoints the
frontend calls is byte-identical: 100 references before, 100 after.

This phase is where the redesign was checked rather than written, and it found things the
five phases that built it did not.

### The colour system had two rules nobody had written down

**A fill colour is not a text colour.** `--success`, `--warning`, `--danger`, `--info` and
`--primary` are what a shape is filled or bordered with; each has a `-text` sibling dark
enough to carry words. **109 declarations** used the fill as text, and the audit measured
what that costs: "Paid" at 2.22:1, "Pending" at 1.91:1, "Published" at 2.13:1, "WELL
ESTABLISHED" at 2.42:1 — against a 4.5:1 requirement.

**`--royal-blue` is not a text colour either.** The legacy alias is deliberately re-pointed
*lighter* in dark mode so it stays visible as a border, which makes it too light for words
there — the question bank's row actions measured 4.21:1. **38 declarations** rewritten to
`--primary-text`.

**Every solid fill now has an explicit on-colour.** `--primary-on` was the only one; the
rest were `#fff` written by hand, and white on `--success-solid` is 3.77:1 and on
`--warning-solid` 3.19:1 — green and amber are light fills and take dark text.
`--success-on`, `--warning-on`, `--danger-on`, `--info-on` and `--accent-on` are now
declared in both themes, and the only `color: #fff` left in `src/` is the Gallery
lightbox, which is white on a photograph.

**`--text-muted` moved one step darker.** At `--slate-500` it was 4.76:1 on white — AA with
no headroom — and 4.28:1 on a soft tint, where it failed. A secondary colour that only
passes on pure white is a trap; it is `--slate-600` now and clears AA on every surface and
tint in the file.

### Twenty-eight headings were at the wrong level

Eleven admin pages and six student ones opened with an `h3` directly under the shell's
`h1`. `EmptyState` gained a `titleAs` for the case where the state *is* the page — and the
404 page, written in Phase E, had **no `h1` at all**.

### Touch targets, on a coarse pointer only

Phase A limited the 44px floor to form controls, because a blanket rule would have inflated
compact row actions on pages that had not been redesigned. They have been now, and the
audit measured what the caution left: an 18px tick box in a table row, a 26px "remove
option", four 29px row actions. `button`, `[role="button"]` and `summary` now take the 44px
floor **under `pointer: coarse` only**, so a mouse-driven admin table keeps its compact
rows; tick boxes grow to 24px, which is WCAG 2.5.8's minimum, and no longer squash to a
non-square 15.5px in a flex row. Ten font sizes below the scale's 11px floor were raised,
including the mobile bottom bar's 10px labels.

### Information that only existed on hover

A `title` attribute never appears on a touch screen. Two disabled bulk actions in the
question bank explained themselves only that way — on a phone they were simply dead — and
the five payment states in the student directory were defined only in a tooltip. The
reasons are now in the page, and the states have a real legend.

### Half the JavaScript was being downloaded for nothing

Thirty-four routes were already lazy; **fifteen were not**, so every visitor downloaded the
admin console, the profile page and the practice zone before the landing page painted. They
are lazy now — `Landing` stays eager on purpose, being the entry route. The main bundle
went from **543 kB (167 kB gzipped) to 244 kB (75 kB)**.

### Two measurement traps worth recording

A **CSS transition cannot advance while the tab is not compositing**, so after toggling the
theme `getComputedStyle` keeps reporting the *old* colour: six "contrast failures" on the
design-system page were the outline button mid-transition. Reload into the theme rather than
switching into it. And a **programmatic `.focus()` does not trigger `:focus-visible`**,
which is keyboard-driven — the focus ring was verified statically instead, by checking that
every `outline: none` in `src/` is paired with a replacement (all five are).

### Verified

Twenty-one admin routes, thirteen student routes and six public ones, at four widths in two
themes. Final state: **no page overflow, no element escaping its container, no dangling ARIA
reference, no duplicate id, no unnamed control, no heading-level skip, no emoji, and no text
under 4.5:1** anywhere measured.

## 2026-08-29 — Milestone 23, Phase F: the landing page

The public page, rebuilt on the design system. **Frontend only; no backend file was
touched** (1253 tests across 35 files, unchanged), and no API call was added, removed or
changed — it still reads exactly `/public/stats`, `/leaderboard?limit=3` and
`/referrals/validate`.

### Three claims did not survive being checked

A marketing page is where invented facts go to live, and the brief's rule was explicit:
*use only verified project information*. Every line was checked against the code, and three
that were already on the page were wrong.

- **"No — there is no negative marking."** There is. `Question.negativeMarks` exists, the
  grader applies it (`services/grading.ts`), and the AI generator defaults it to 1. Replaced
  with what the product can actually back: *every question shows its marks and any penalty
  before you answer it* — true, because `studentQuestionView` includes both fields.
- **"Results are published on your dashboard within 48 hours of your exam."** Nothing in the
  product promises or enforces that. Releasing results is a deliberate administrative act,
  which is also what mints the certificates. The answer now says so.
- **"AMIT MATHS OLYMPIAD 2027."** The year appears nowhere else in the product: the
  certificate this system actually prints is titled `A.M.I.T MATHS OLYMPIAD` with no year,
  and the only year anywhere is the *current* one, in a certificate serial. A sitting's dates
  come from the `Exam` window an administrator announces. The headline is now the name alone.
  **If there is a real year, it is a one-line change — this is flagged for the owner rather
  than decided.**

### Six sections it did not have

The page went hero → figures → top three → registration form → three FAQs. It never said
what the platform *does*. It now carries: what you get (practice, mock tests, the daily
challenge, performance insights), how it works as four steps, the ten class levels rendered
from `CLASS_LEVELS` so it cannot advertise a class registration would refuse, three
assurances that are properties of the system rather than adjectives, seven FAQs, and a
closing call to action.

### What it deliberately does not say

**No entry-fee amount.** `GET /payments/status` is behind `requireAuth`, so there is no
public figure to read; the page says a fee exists and that preparation is free, and names no
number. Inventing one, or adding a public route so a marketing page could display one, would
both be worse than the omission.

**No referral earnings.** `ReferralSettings.rewardEnabled` defaults to false, so an earnings
promise on the most public page in the product would be a claim about money that is switched
off.

### The last emojis in the product are gone

`🥇🥈🥉` on the top three, `🌟` in the hero kicker, `🏆` on the heading and `👑` on the XP
badge. The medal is now an icon *beside* the rank number rather than in place of it, which is
the same rule the leaderboard and Hall of Fame follow: `#4` and a medal have to be comparable
at a glance. **`src/` and `index.html` now contain zero emoji characters.**

### Verified

In a browser at 375, 768 and 1280px, in both themes: no page overflow, no element escaping
its container, no dangling ARIA reference, no unlabelled control, no emoji, and a heading
order that runs h1 → h2 → h3 with no level skipped. All **45 Phosphor glyphs on the page
resolve to real characters** — checked through the computed `::before` content, because a
weight or name the CDN does not carry renders an invisible glyph rather than falling back.
Contrast measured on every new element with the translucent fills composited: the lowest
text is 4.55:1 and the lowest icon 5.24:1. `/register?ref=` still scrolls to the form and
still reports an invalid code honestly; sign-in still opens from the hero, the closing call
to action and the `#login` hash.

## 2026-08-29 — Milestone 23, Phase E: the admin experience

Twenty-four admin pages plus the AI generator. **Frontend only; no backend file was
touched** (1253 tests across 35 files, unchanged), and no API call was added, removed or
changed.

### Every admin table can be read on a phone

Fifteen tables across the admin area were bare `<table>` elements in a page-width `<div>`.
On a 375px screen the widest of them — the platform analytics table — pushed the **whole
page** 445px wider than the viewport, so the header, the sidebar and every other page
element could be dragged off screen sideways. They are now `TableScroll` + `Table`: the
overflow is contained in the table's own scroller, which is keyboard-reachable and
announced, and **no column was dropped to make anything fit**. The student directory, whose
rows are records rather than comparisons, additionally becomes **one card per student below
768px** carrying all thirteen fields.

### The generator was outside the admin area

`/ai-generator` is in the admin navigation but rendered its own page frame with a
`← Back to Admin` text link, so reaching it from the drawer dropped you out of the shell —
no navigation, no way back except that one link. It is now inside `AdminShell` like every
other admin route, and its configuration grid is one column on a phone rather than a fixed
two.

### The two multi-step flows say where you are

Bulk import and AI drafting are both state machines an examiner has to hold in their head,
and **a screen of parsed rows looks exactly like a screen of saved ones**. Both now carry a
step indicator — Upload → Review → Saved, Configure → Review → Saved — derived from what
actually exists rather than tracked separately, so it cannot disagree with the screen. The
middle step is deliberately named *Review*, because nothing has been written at that point.

Registration's hand-built version became the shared `ui/Steps` primitive on the way, so
three flows now say the same thing the same way.

### An unmatched address is no longer a blank page

There was no catch-all route, and React Router renders **nothing** when nothing matches — a
mistyped address, a stale bookmark or an old link produced a blank white page
indistinguishable from a crash. This is not hypothetical: every referral link the backend
generated pointed at `/register`, and every one of them was blank until that route was
added in Milestone 22 Phase F. `/*` now renders a `NotFound` page that names the path that
did not resolve.

### Emojis and hand-written glyphs

No emoji was left in the admin area after Phase D, but **fifty-four hand-written
`<i className="ph-...">` icons** were still spread across 25 files, admin and student
alike — each one a place where a weight that renders an *invisible glyph*, or a missing
`aria-hidden`, could be introduced without review noticing. All of them now go through
`ui/Icon`, which is the rule Phase A wrote down and could not yet enforce. The remaining bare glyphs became
icons: the two pagers' `← Previous` / `Next →`, the mock-test reorder arrows, the question
editor's `✕`. The audit log's `old → new` is deliberately **kept**: it is data describing a
changed field, not a control.

### Also

`/admin` gained a permission-filtered quick-actions grid; the student directory gained
pagination, a skeleton table and per-row action menus that work in both layouts; twenty-two
raw `error-text` divs became `Alert`s; tick boxes are 18px rather than the browser's 13px
default (every one sits inside its own `<label>`, so the label was already the real target).

### Verified

In a browser against a real backend, signed in as the root super admin, at 375px and
1280px, across twenty-one admin routes including the dashboard, the student directory, the
question bank, bulk import, the question editor, chapters, mock tests, daily challenges,
analytics, question performance, standings, the exam, certificates, the gallery,
notifications, email delivery, the audit log, payments, referrals, reward settings and the
AI generator. Every one: **no page overflow, no element escaping its container, no dangling
ARIA reference, no unlabelled control**, and no emoji. The drawer was re-checked
end-to-end (opens, labelled, focus moves in, scroll locked, current page marked, Escape
closes, focus returns to the burger), the directory's filters were driven against real data
down to their empty state, and both themes were measured: every text token is above 4.5:1
on its surface. One contrast finding was fixed — a completed step's white tick on
`--success-solid` measured 3.77:1 and is now a soft fill at 5.2:1 (light) and 8.4:1 (dark).

## 2026-08-29 — Milestone 23, Phase D: the student experience

Nine surfaces: the dashboard, practice (picker and runner), mock tests (listing and
runner), the daily challenge, analytics, recommendations, Refer & Earn, the profile and
the invoice section. **Frontend only; no backend file was touched** (1253 tests across 35
files, unchanged), and no API call was added, removed or changed.

### The dashboard was reordered

It opened with four figures and ended, seven cards later, with the actions — so on a phone
the thing a student came to do was below three screens of scrolling. It now opens with
**Jump back in** (practice, mock tests, today's challenge), then progress, then the record.
The counts on those cards come from the payload the page already had; no request was added.

### Every runner is the same runner

Practice, the mock test and the daily challenge each had their own answer options, their
own palette and their own navigation. They now share a shape: **56px minimum option rows**
the full width of the card, a chosen state carried by a border *and* a tint *and* a filled
key circle, 44px palette buttons, and stacked navigation on a phone where three controls
on one row had left "Previous" as an ellipsis.

Two things specific to a timed paper: the mock test's **countdown bar is sticky**, so it
cannot scroll out of reach on a long question, and **submission is a dialog** rather than a
panel inside the palette — which on a phone appeared below the fold, at the bottom of the
page a student had just scrolled away from.

### Real progress, never invented

The level meter, the questions-answered bars and the score bars are all `Progress` with a
real `value` out of a real `max`. `null` still renders an em dash: the daily challenge's XP
tile shows one when no reward is configured, and the dashboard's rank tile shows one when
the student is not ranked — never a zero that would read as a result.

### Charts

`ChartCard` was carrying three hex literals and did not follow the theme. It now resolves
its colours from the tokens at render time and re-reads them on a theme change, takes a
semantic `tone` rather than a colour, caps its axis ticks so labels stay legible at 375px,
is shorter on a phone, and carries `role="img"` with a summary — a canvas is an image to a
screen reader.

### Emojis

Gone from every student surface: the dashboard's seven headings and its `👋`, the
`🕘` on three history panels, the `🗺️ 🎖️ 🏅` on Rewards, and the `🥇 🥈 🥉` medals on the
leaderboard and the Hall of Fame — which are now a medal *icon beside the rank number*
rather than in place of it, because "#4" and "#3" have to be comparable and an emoji medal
was read out mid-name by a screen reader. The `← Previous` / `Next →` glyphs in both
runners are icons. What is left is in the landing page (Phase F) and the admin pages
(Phase E).

### Obsolete CSS removed

The page stylesheets carried their own badges, tables, stat tiles, empty states and error
cards — the duplication the design system exists to end. Removed from Referrals (16
classes), Practice (18 blocks), and replaced in place across the mock-test, daily-challenge
and dashboard sheets, all now on the token layer.

### Verified

In a browser against a real backend, signed in as a student, at 390px and 1280px: the
dashboard, practice picker, **a live practice session**, mock tests, the daily challenge,
analytics, Refer & Earn, the profile, rewards, the leaderboard and the payment/invoice
page. Every one: **no page overflow, no element escaping its container, no dangling ARIA
reference, no emoji, no unlabelled field**, and no console error. Three controls under
16px were found and raised (a referral link input, and two file pickers).



Sign-in, registration, password recovery, email verification, the forced password change
and the administrator's sign-in. **Frontend only; no backend file was touched** (1253
tests across 35 files, unchanged).

### The forms came out of the landing page

`Landing.tsx` was 749 lines holding a marketing page, a thirteen-field registration wizard
and a hand-rolled sign-in overlay, with their state interleaved. It is now **256 lines**,
and the two forms are `pages/Auth/RegisterForm.tsx` and `pages/Auth/LoginDialog.tsx`. The
page keeps what is genuinely its own: the `?ref=` check, the `/register` scroll, the
`#login` hash.

### Every field reports its own error

Registration validated into **one string** — the first problem found, at the top of a form
two screens long on a phone. A student with three mistakes was sent round three times.

Now one pass finds everything, each message renders **on its own field**, and a summary at
the top lists the problems as buttons that move focus to the field they name. Verified: an
empty submit produces 12 per-field messages, 12 `aria-invalid` controls, a summary of 12
entries, focus on the first, and **zero dangling `aria-describedby` references**. The same
shape is now on the reset-password and forced-password-change forms.

### Four defects found by driving the browser

1. **A raw zod aggregate reached the screen.** Signing in with empty fields printed
   `identifier: Enter your mobile number or email; password: Password…`. Empty fields are
   now caught client-side, and a 400 is replaced rather than printed.
2. **A wrong password said "Your session has ended."** `humanizeError` rewrites 401 for
   pages whose data was refused; on the form you sign in *with*, the 401 is the answer.
   New `humanizeSignInError()` passes 401 and 423 through — keeping the backend's
   deliberately non-enumerating wording — and defers everything else.
3. **The sign-in link died after one use.** With `#login` in the URL, closing the dialog
   left the hash in place, so the next press of Sign in was not a change and nothing
   opened. Closing now clears the hash.
4. **A dangling `aria-controls`** on the public burger, naming a panel that only exists
   while open — the same defect `Tabs` had in Phase A, found on the auth pages by the
   accessibility sweep.

### The rest

- **The administrator's sign-in had two `<label>`s with no `htmlFor` and two `<input>`s
  with no `id`** — neither field was labelled for a screen reader, and tapping a label
  focused nothing. Found in Phase A, fixed here.
- **`PasswordInput`** joined the design system: a show/hide toggle with `aria-pressed`,
  which on a phone is the difference between retyping a password and reading it. Used on
  all six password fields.
- **`autoComplete` everywhere** — `username`, `current-password`, `new-password`,
  `given-name`, `family-name`, `bday`, `tel-national`, `email`, `street-address` — which
  is what makes a password manager and mobile autofill work at all. The mobile field uses
  `inputMode="numeric"` rather than `type="number"`.
- **Emojis gone** from every auth surface: the ⚠️/✅ status glyphs, the 📧 on the
  registration success step, and the 🔑/➔ on the hero's buttons.
- **`AuthLayout`** replaces three copies of the same centred card, including a
  `text-align: center` that also centred the form labels.
- `AuthForms.module.css` deleted.

### Verified

At 375px and 1280px, in a browser against a real backend: registration validation and
focus movement, the password reveal toggle, the sign-in dialog (focus into the first
field, trap, Escape, scroll lock, bottom sheet on a phone, centred at 1280), a **failed
and then successful student sign-in** landing on `/dashboard`, a failed and then
successful administrator sign-in, forgot-password, reset-password with and without a
token, and verify-email without one. No page overflow at either width; no unlabelled
field; no control under 16px; no dangling ARIA references; no emoji left in any auth page.

## 2026-08-29 — Milestone 23, Phase B: the global layout

The app shell, both navigations, the public header and the footer. **Frontend only; no
backend file was touched** (1253 tests across 35 files, unchanged), and no page's content
was redesigned — that is Phases C to F.

### One shell instead of two copies

`StudentShell` and `pages/Admin/AdminShell` were near-identical implementations of a
sidebar, a drawer, a topbar and an active-item comparison. They are now thin wrappers over
`components/layout/AppShell`, with the navigation as **data** in
`components/layout/navigation.ts` — one model behind the desktop sidebar, the drawer, the
mobile bottom bar and the admin permission filter.

The flat lists became groups: **Prepare / My progress / The Olympiad / Account** for
students, **Students / Question bank / Assessments / Insights / Communication / Settings**
for staff.

**`/exam` joined the student navigation.** The official Olympiad has existed since
Milestone 13 and was reachable only from the dashboard — the thing the product is named
after was missing from its own menu, which is also why the `paid` padlock the nav model
had always described had never once rendered. It does now, on that item, for a student who
has not paid.

### Three layouts, not one that shrinks

| Width | Student | Admin |
|---|---|---|
| `< 768px` | Bottom bar: Home · Practice · Tests · Challenge · **More** | Burger |
| `768–1023px` | Burger in the topbar | Burger in the topbar |
| `≥ 1024px` | Permanent sidebar | Permanent sidebar |

The permanent sidebar moved from 768px to 1024px: the admin area is wide tables, and a
264px sidebar on a 768px screen leaves 500px for them. A timed paper passes `focus`, which
drops the bottom bar — it sits exactly where the answer buttons are — while keeping the
burger at every width, because a student must always be able to leave.

### Four defects found in the browser, three of them in code written this phase

1. **The admin had no way to open the menu on a phone.** The burger was hidden below
   768px, where the bottom bar replaces it — and the bottom bar is student-only.
2. **Focus did not move into the drawer.** It was hidden with `visibility`, and `focus()`
   on an element the browser still considers invisible is a silent no-op; it depended on a
   style recalculation that had not necessarily happened.
3. **`inert`, the fix for that, left the desktop sidebar inert.** Removing it on a desktop
   needs a JavaScript media query, and a media-query change is delivered with the
   rendering steps, which a tab that is not compositing never runs. The whole navigation
   became unreachable by keyboard and absent from the accessibility tree.
   **The final design depends on no event at all**: the sidebar is `display: none` below
   1024px, and the drawer is a separate element *mounted only while open*.
4. **A group label measured 4.46:1** in dark mode — just under AA. Moved from
   `--text-subtle` to `--text-muted` (6.83:1), here and in the footer.

### The public header and footer

Eight links in one row became four destinations, a theme toggle and one call to action.
The result and certificate lookups moved to the footer — utilities belong there — and so
did the **Admin** link, which a marketing page had been advertising to every visitor.

**A Sign in button was added**, closing a real gap: the login form is a panel on the
landing page, so a visitor on the leaderboard had no way to ask for it. It links to
`/#login`, which the landing page now opens on that hash.

The mobile panel is mounted only while open, so there is no hidden second copy of the
navigation in the accessibility tree. The footer became four labelled columns with the
helpline and support address as real `tel:` and `mailto:` links.

### Also

A shared, counted `ui/scrollLock.ts` — the modal and the drawer can now both hold the page
still without either releasing the other's lock. A **skip link** as the first focusable
element on every signed-in page, and a `<main id="main-content">` landmark for it to reach.
`components/StudentShell.module.css` and fourteen shell classes in `Admin.module.css` were
deleted; `AdminShell.module.css` holds only the identity block.

### Verified

Against a real backend on the local database, signed in as a student and as the root
administrator, at 375 / 390 / 414 / 768 / 1265 / 1425px in both themes:

- **No page overflow and no element escaping its container** on nine student destinations
  and four admin ones, at every width tested.
- The drawer: mounts, moves focus to its close button, traps Tab, closes on Escape, on the
  backdrop, on choosing an item and on a route change, returns focus to the control that
  opened it, and releases the scroll lock. Zero links reachable while closed.
- Exactly **one** `Main navigation` landmark at any width — the hidden copy problem the
  mount-only drawer exists to avoid.
- Longest-prefix matching: `/admin/questions/import` marks **Bulk Import**, not Question
  Bank, and exactly one item is `aria-current="page"`.
- The padlock renders on Official Olympiad for an unpaid student; `focus` mode drops the
  bottom bar on a real practice session.

One pre-existing defect found and **left for Phase E**: `/admin/analytics` renders a bare
445px `<table>` with no scroll container, so it overflows a 375px screen. It is the page's
own markup, not the shell's, and `TableScroll` from Phase A is what it needs.

## 2026-08-29 — Milestone 23, Phase A: the design system

The first phase of the UI/UX modernisation. **Frontend only, and no page was redesigned yet** — this
phase builds the layer the next six phases are made of, and modernises what every existing page
inherits from it.

### What was there before

12,450 lines of CSS Modules across 29 pages, over a shared layer of thirteen colours, four radii, two
shadows and a `.card` class. Everything else had been re-described per page:

| Duplicated pattern | Independent declarations found |
|---|---|
| Status badge (`.status`, `.pill`, `.tag`, `.chip`, `.levelBadge`, …) | 52 `.status` alone |
| Table (`.table` + `.tableScroll`) | 66 tables, 13 scrollers, across 21 pages |
| Inline notice (`.notice`) | 16 |
| Modal (`.modal`, `.dialog`) | 8 — **none trapped focus or restored it on close** |
| Stat tile (`.total`, `.totalValue`, `.tile`) | 3 private versions |

### The token layer

`styles/theme.css` (207 lines) became four files, with `theme.css` surviving as the three `@import`s
so `main.tsx` is untouched:

- **`tokens.css`** — palette → semantic → legacy aliases. Colour, type scale (three steps fluid via
  `clamp()`), spacing, radius, shadow, motion, a single z-index ladder, layout, `--tap-target`.
- **`base.css`** — element defaults, one global focus ring, `prefers-reduced-motion` honoured once.
- **`utilities.css`** — six layout utilities plus the pre-existing global classes, kept and modernised.

**Every legacy token name still resolves**, which is what let 29 un-migrated pages pick up the new
surfaces, radii and focus treatment without being edited. `--royal-blue` (144 references) now points
at the new primary; in dark mode it takes a compromise value clearing 3.5:1 as both a fill and text,
where it had been **2.9:1 as text** before.

### Twenty primitives, in `components/ui`

`Icon` · `Button` + `ButtonLink` · `Card` (+ `CardHeader`/`Body`/`Footer`) · `Badge` · `Alert` ·
`Field` · `Input`/`Textarea`/`Select`/`Checkbox`/`SearchInput` · `Modal` · `ToastProvider` +
`useToast` · `Tabs` + `TabPanel` · `Pagination` · `Skeleton` (+ 4 presets) · `Table`/`TableScroll` +
`DataCardList`/`DataCard`/`DataRow` · `EmptyState` · `ErrorState` · `Spinner` · `Progress` ·
`Tooltip` · `StatTile`, plus `lib/errors.ts`.

Rules that are enforced by the types rather than by review: a `Field` cannot exist without a label; an
icon-only `Button` cannot exist without an `aria-label`; a `Badge` always carries words, so a payment
state can never be a bare coloured dot; a determinate `Progress` requires a real `value`, and anything
whose length is unknown must say `indeterminate`; `EmptyState` requires a *description*, because
"why is this empty" is the question that decides whether a reader thinks the product is broken.

### Four defects found by verifying rather than reading

1. **The modal never moved focus.** It focused inside `requestAnimationFrame`, which does not fire at
   all while a tab is not compositing — so in a background or hidden tab, focus stayed on the page
   behind the dialog. Now synchronous, which is correct *and* testable.
2. **`aria-controls` pointed at nothing.** `Tabs` emitted it for every tab while `TabPanel` renders
   only the active one, and a filter used as tabs has no panels at all. Fixed twice over: a new
   `mode="filter"` renders a labelled group with `aria-pressed` (because "All / Draft / Published"
   above a list is not a tab), and in tabs mode the attribute is emitted only for the selected tab,
   whose panel is in the document. The page now has **zero dangling ARIA IDREFs**.
3. **`TableScroll` kept a stale measurement** on resize: a `ResizeObserver` is delivered with the
   browser's rendering steps, which a non-rendering tab does not run, so a table laid out wide and
   then narrowed lost keyboard access to its own overflow. It now also listens to `window.resize`.
4. **A gold badge measured 3.69:1** — below AA for its 12px bold label. `--accent-text` moved a step
   darker. Gold is the colour this happens to, because it is light at every step that still looks gold.

Plus two touch-target sizes raised, and the 16px-on-touch input rule (mobile Safari zooms a focused
field under 16px and does not zoom back) applied to the **legacy** `.form-control` as well as the new
`Input` — those are the fields being used on phones today.

### Verified

Both themes, at 320 / 375 / 390 / 768 / 1280 px: **no page overflow and no element escaping its
container** at any width, on the reference page and on `/`, `/admin` and `/leaderboard` against a real
backend. Contrast measured programmatically for twelve token pairs per theme; all now pass AA for
their size. Modal focus trap, Escape, focus restore and scroll-lock release; toast live-region roles
(`status`/polite, `alert`/assertive for errors); tabs arrow-key navigation and roving tabindex; the
scroll region taking its focus stop only while it overflows; the bottom-sheet layout at 390px.

Screenshots were not available — the browser pane could not composite — so everything above was
measured from the DOM and computed styles instead, which is how the four defects were found.

**1253 tests across 35 files (unchanged — no backend file was touched), typecheck, lint and the
production build all pass.** No new dependency. The dev-only `/design-system` page is absent from the
production bundle, verified in `dist/`.

## 2026-08-28 — Milestone 22, Phase H: the regression pass

All thirteen areas the brief named, driven in a real browser against a real backend, plus the full
suite. **No regression was found.**

| Area | How it was checked |
|---|---|
| Registration | A fresh registration with **no** referral code, plus two through referral links |
| Login | Student and root-admin sign-in throughout the pass |
| Student dashboard | Real figures; the entry-fee prompt reads **₹199.00** |
| Admin dashboard | 12 accounts, recent registrations, both charts |
| Payment | Status, `/payment`, invoices; "temporarily unavailable" reported honestly with no local Razorpay keys |
| Question Bank | 104 questions over 11 pages, filters, status actions |
| Practice | 13 chapters / 104 questions; a session **started, answered, submitted and graded** (score −1 with negative marking), plus resume |
| Mock Tests | Authored → published → visible to the right class with marks, duration and attempts |
| Daily Challenge | Auto-generated a real question with +15 XP after the reset removed the old one |
| AI generation | Page renders with the live chapter list; generation itself correctly unavailable with no key |
| Bulk import | All three formats render; the Excel template builds (11,650 bytes, correct content type) |
| Analytics | Renders, with the honest empty state before any submission |
| Recommendations | Renders, labelled `STATISTICAL RULES` — still not claiming to be AI |

Also swept: leaderboard, Hall of Fame, gallery, certificate verification, audit log, chapters, the
student directory, invoices, and both referral surfaces. **No console error on any page.**

### The answer-key rule, checked in both directions

An in-progress practice session serves `key`/`text` options and **no** `correctAnswer`, `explanation`,
`outcome`, `solution`, `isCorrect`, `booleanAnswer`, `numericAnswer` or `tolerance`. The same session
once submitted **does** carry `correctAnswer`, `explanation` and `outcome`. That is exactly the
documented behaviour, and it is worth re-verifying by hand because it is the rule this codebase has
broken twice.

### Four false alarms, all mine

Every "finding" in this pass turned out to be a wrong assumption in the probe rather than a defect:
`/practice/availability` (the route is `/practice/options`), `/rewards/me` (it is `/me/rewards`),
saving an answer with `POST` (it is `PUT`), and looking for a `solution` field in a review view that
calls it `correctAnswer`. A fifth — "the Question Bank renders no rows" — was a `table tbody tr`
selector on a page that lays questions out as cards. Recorded because the lesson generalises: when a
hand-written probe disagrees with a well-tested backend, check the probe first.

### One real consequence, and it was self-inflicted

The **local dev database** had its question bank and chapters emptied during this session's
verification of the content reset — the audit trail shows the three resets. That is what made
Practice, the Daily Challenge and Analytics look empty at the start of this pass. Re-seeded with
`npx tsx scripts/seed-class12.ts --local --write` (104 questions, 13 chapters), after which every
one of them worked. **Production was never touched**: the dev server runs `dev:local`, which forces
`MONGO_URI` at localhost, and the write guard refused the seed until `--local` was given explicitly.

**1253 tests across 35 files**, typecheck, lint, compile and the frontend build all green.

## 2026-08-28 — Milestone 22, Phase G: the admin referral console

`/admin/referrals`. Two jobs on one page, deliberately: **what is owed**, and **what a referral is
worth**. Splitting them would let somebody change the reward without seeing what the current one has
already accrued — the same argument that keeps the fee beside the collected total on the payments
console.

### What it shows

Four counted figures across the top — accrued, approved, paid, and the number of referrals — all
**programme-wide sums from the collection, not the current page**, because "what do we owe?" must not
change as somebody pages. Then the reward settings, then the referrals themselves with both parties,
the code, the dates, whether the referred student has paid (**derived from the payment record at read
time**, so a stale referral row cannot make it say the wrong thing), the reward state and the payout
reference or rejection reason.

Names are **unmasked** here, unlike the student's own list — this is the console that decides whether
to pay somebody, and it already requires `students:read`.

### What it cannot do

It can move a reward along a fixed path and set the amount for *future* conversions. It **cannot
create a reward, choose what an individual referral is worth, or pay somebody who was not
introduced**: the amount is snapshotted server-side at conversion and no request from this page
carries one. Each row offers only the transitions the API will accept — Approve appears on `accrued`,
Mark paid only on `approved`, and a paid or rejected row reads "Closed". Offering "Mark paid" on an
unapproved row would invite a 409, and worse, would suggest paying is one click when the two-step
approval exists on purpose.

Marking paid and rejecting both open a dialog demanding a note, because both end up on a permanent
record: the payout reference is how a payment is traced afterwards, and the rejection reason is what
somebody reads when they ask why.

### Honest when nothing is configured

With no reward set the page says so in plain words — that nothing is being accrued and that
introductions are still being recorded — rather than leaving an administrator to infer it from a
zero. Setting an amount says explicitly that it applies to conversions from now on and that rewards
already earned keep the amount they were earned at.

Verified in a browser against the local database, through the whole lifecycle: a referral accrued at
₹50, approved, then paid with a reference, watching the three totals move each time. Then the reward
was raised to **₹75 and the already-paid referral stayed at ₹50** — the snapshot rule demonstrated
live rather than only in a test. Plus the empty-note guard on both dialogs, the status filter, and
375px where the totals stack and the table scrolls in its own container.

No backend change — 1253 tests across 35 files, unchanged.

## 2026-08-28 — Milestone 22, Phase F: the student Refer & Earn page

`/referrals`, in the student sidebar. The code, the link, WhatsApp and native share, real
counts, and the list of people invited — every figure from `GET /me/referrals`, none of it
invented.

### The honest half

With no reward configured the page says **"No referral reward is running at the moment"** and shows
**no earnings tiles at all** — three tiles reading ₹0.00 look like a broken page rather than an
honest one. The referral *counts* are shown either way, because those are real. The wording also
does not promise that a future reward will cover past referrals, because it will not: the amount is
snapshotted when a referral converts.

When a reward *is* configured the page shows what it is worth, the terms sentence the administrator
wrote, and three reward tiles — earned, approved, paid.

**The people listed are masked** — "Nisha V." — by the same `displayNameFor()` the public
leaderboard uses. A referral list is a list of children and the student reading it is not staff.

### The register page understands `?ref=`

It validates the code against the server before the form is filled and **shows the outcome either
way**: a good code gets "Invited by Aarav S.", and a bad one gets an amber line saying it is not
valid and will not be applied. That second case matters more than the first — the backend refuses
the *whole registration* on a code that does not resolve, so passing an unchecked one through would
lose a real registration over somebody else's typo. The code is sent only once confirmed.

### Two defects the browser pass caught

- **The referral link pointed at a route that did not exist.** `referralLinkFor()` builds
  `<app>/register?ref=<code>`, and the app had no `/register` route and no catch-all — so every
  referral link rendered a blank page. Added, rendering the landing page and scrolling to the form.
  Nothing in 1253 backend tests could have found this: the link is generated on one side of the
  wire and consumed on the other.
- **A smooth scroll that silently did nothing.** The scroll-to-form used `behavior: 'smooth'`, which
  does not run in every environment — and its failure mode is that nothing happens at all. Now
  instant, which also means somebody who asked for reduced motion is not given an animation.

Verified end to end in a browser: a real registration through a real referral link, the referrer's
page showing it as "Signed up", then a captured payment flipping it to "Reward earned ₹50.00" with
the tiles appearing. Plus the invalid-code banner, and 375px where the tiles reflow to two columns
and the table scrolls in its own container.

No backend change, so the suite is unchanged at 1253.

## 2026-08-28 — Milestone 22, Phase E: Refer & Earn, the backend

Every student now has a referral code, every introduction is recorded, and every conversion is
observed from a real captured payment.

### No reward rule was invented

Nothing in this project has ever specified a referral reward — not an amount, not an eligibility
condition, not a payout method. So the reward is **switched off and worth ₹0** until an administrator
sets it, and the API reports that plainly rather than showing zero as though it were an offer. The
**tracking** is complete either way, which is the part that was genuinely asked for.

### What the backend now does

- **A code per student**: `AMIT` + six characters from a 31-symbol unambiguous alphabet, generated
  lazily on first read so accounts predating the feature need no migration. Deliberately not
  `studentId` — ten thousand identifiers is a walk, and a code gets posted in WhatsApp groups.
- **Attribution at registration**, validated server-side. A code that does not resolve **refuses the
  registration** and rolls the account back; a code from a suspended account stops resolving.
- **`GET /referrals/validate`** so the register page can check a link before the form is filled —
  public, rate limited, and publishing only a **masked** name.
- **Conversion inside `capturePayment()`**, the one place money becomes real. Not
  `hasEntryEntitlement()`, which is true when the paywall is off — that would pay out on every
  registration.
- **A reward lifecycle**: `pending_conversion → no_reward | accrued → approved → paid`, or
  `rejected`. Each transition is a **conditional write**, so two administrators pressing "mark paid"
  at once produce one payout and one 409.
- **`GET /me/referrals`** with real counts and totals, the students listed **masked**.
- **An admin console** on `students:read`, and the three acts that move money on a new
  `referrals:write` (permissions 22 → 23).
- **The student directory and its Excel export gained three referral columns** — promised in Phase B
  and deliberately held back until the data existed.

### The abuse rules are an index, not checks

A unique index on `Referral.referred` enforces one referrer per registration, no duplicate
attribution and no changing it afterwards — all at once, and without a read-then-write that could
race. Self-referral is refused explicitly. No request may supply an amount: it is snapshotted at
conversion, so re-pricing the reward cannot rewrite what somebody already earned.

### One defect the tests caught, and it surfaced nowhere near its cause

Eleven tests failed with a **500 on the root administrator's login** — nothing to do with referrals.
`Student.referralCode` had been declared `unique + sparse` with **`default: null`**, and `sparse`
skips *absent* fields, not null ones: every document carried an explicit null, the index treated them
as equal, and the second document ever created failed on a duplicate key. In a fresh database the
second document is the bootstrap super admin. The default is gone; there is a `TROUBLESHOOTING.md`
entry.

**39 new tests.** Two new models (`Referral`, `ReferralSettings` — 29 in total), one new permission,
two new audit actions, one new service, one new route module. No new dependency.

Phases F and G — the student page and the admin console UI — are next.

## 2026-08-28 — Milestone 22, Phase D: A.M.I.T has a full form on the landing page

**A.M.I.T is the Advance Mathematics and Intelligence Test.** Owner-supplied on 2026-08-28, because
it was recorded **nowhere** in this repository — not in any of the thirteen root documents, not in
the frontend, not in `index.html`, not in the certificate it prints on a child's award. The brand
appeared only as four letters, and the founder being named "Amit Kumar" made it genuinely ambiguous
whether it was an acronym at all. It was asked for rather than guessed.

### It appears once, under the wordmark

Set as a formal descriptor rather than as copy: uppercase, wide tracking, a gold hairline running
out to each side. It reads as part of the logotype instead of as a sentence, so it does not compete
with the tagline below it. `frontend/src/lib/brand.ts` holds the string, so the visible name and the
page metadata cannot drift apart.

### The first attempt was rejected, and what it got wrong

The first version of this phase also added an **About section** — the four letters broken out into
separate boxes, plus two paragraphs explaining the competition — and repeated the full form in the
footer. The owner's response was that the boxes were unnecessary, that `and` hanging off the `I`
looked wrong, that no explanation was wanted, and that the name belongs at the top.

All of it was removed: the section, the boxes, the paragraphs and the footer line. The footer is back
to the four-letter name it carried before. **One visible occurrence on the page**, counted in the
browser.

### SEO

`index.html` gained the expansion in its `<title>`, a `<meta name="description">` (there was none at
all before) and Open Graph title/description for when the site is shared into a chat. That file is
static and cannot import the constant, so the name is spelled literally there — **the one deliberate
duplication**, documented in both places.

Verified in a browser at 1280px and 375px, where the line shortens its rules and tightens its
tracking rather than wrapping.

## 2026-08-28 — A reset button for each content area

Owner request. The Question Bank, Mock Tests, Daily Challenges and Chapters each gained a **Danger
zone** at the foot of the page with a reset that empties the area — with a bright, blocking warning
and a typed confirmation, so it cannot happen by accident.

### What stands between a click and an empty collection

- **`content:reset` is super admin only**, beside `users:delete` on the line that table already
  draws. A compromised *admin* session cannot empty the question bank. The panel is not even
  rendered without the permission.
- **Nothing happens on the first press.** The dialog fetches real counts first, so it says
  "208 questions" rather than "this cannot be undone".
- **The exact phrase must be typed** — `RESET QUESTIONS`, and a different one per area, so muscle
  memory from one dialog cannot confirm another. Wrong case, near misses and a bare `POST` are all
  refused.
- **It refuses rather than cascades.** Deleting chapters beneath questions would leave every
  question pointing at nothing, so a blocked reset shows **no confirmation field and no button** —
  only what to reset first. Re-checked at the moment of the write, not just in the dialog.
- **The official exam has no reset**, and appears as a blocker with no resolution: its results and
  certificates are a permanent record.

### What survives, and why the dialog says so

Resetting mock tests or daily challenges deletes their attempts — an attempt whose paper is gone is
a row the student's page cannot render. But **XP is never taken back**: it is a record of something
that really happened, and removing it would re-rank the leaderboard against children who did nothing
wrong. Practice sessions survive a full question-bank wipe too, because each one snapshots its own
questions and answer key — the Milestone 6 snapshot rule paying off in a place it was not designed
for.

The dialog lists all of this. A warning that only threatens gets clicked through.

### Two defects fixed before they shipped

Both in the wording, which for this feature *is* the safety mechanism: "1 daily challenge **are**
set from these questions" in the blocker text, and "1 scheduled daily **challenges**" in the delete
list — the client had been joining a count to a plural label. The phrase is now built server-side
where the count lives, and a test asserts the singular form.

One new permission (21 → 22), one new audit action (`content.reset`, carrying per-collection counts
because afterwards there is nothing left to count), one new service, one new route module, one shared
frontend component. **No new model.** 22 tests.

Verified in a browser against the local database: the blocked path on Chapters, the confirmation
gating (disabled by default, still disabled on a near miss, enabled only on the exact phrase), a
real reset of the daily challenges, the dependency chain unblocking afterwards, the audit entry, and
the leaderboard still ranking its students on XP that was not touched.

## 2026-08-28 — The entry fee is Rs.199

Owner decision. Rs.100 to Rs.199, up from the Rs.100 set on 2026-08-16 (itself down from the Rs.499
the feature shipped with).

**No code decision was involved, which is the point of where the price lives.** `PaymentSettings` is an
administrator-editable document changed at `/admin/payments`, with an audit entry naming who changed it
and from what. `DEFAULT_ENTRY_FEE_PAISE` was updated to `19_900` to match — that constant applies
**only where no settings document has been saved** (a fresh environment, a new local database, the test
suite), and leaving it stale would mean a newly provisioned deployment silently charging last year's
fee with nothing to warn about it.

**Nobody who has already paid is affected.** `Payment.amount` is a snapshot of what was actually
charged, so a student who paid Rs.100 keeps their entitlement and their invoice still reads Rs.100 —
asserted by a test that re-prices the fee *after* a capture.

Two tests were updated to the new default, and the fee was corrected in eight documentation files. The
two Milestone 19 ADRs were left intact with a note added: they are the record of what was decided then,
and everything they say about *where* the price lives is unchanged.

## 2026-08-28 — Milestone 22, Phase C: the student invoice

A student who paid had no receipt. Nothing in the product could produce one, and nothing in it had ever
needed an invoice number.

### An invoice is a rendering of a payment, not a record of one

There is **no `Invoice` collection**. `services/invoiceService.ts` renders a captured `Payment` on
demand, and the number is derived — `AMIT-INV-2026-9B736EA2AF39`, the capture year plus the last twelve
hex characters of the payment's own `ObjectId`. Every property the feature needed falls out of that:
downloading is a pure read so nothing can be created twice; the number is a function of the transaction
so it never changes; uniqueness rests on the `ObjectId` rather than on a counter two readers could
allocate twice; and the amount is `Payment.amount`, so raising the fee to Rs.199 the same day left every
earlier invoice reading Rs.100.

### What a student sees

`/payment` gained a **Your receipts** section — one row per captured payment, with a full **preview**
before downloading and a PDF link. The preview is built from the same `InvoiceData` the PDF is, so what
is on screen cannot differ from what is in the file.

The PDF is A4, rendered server-side with `pdf-lib` (already the certificate's library, so no new
dependency): issuer block, billed-to block, invoice and payment dates, a one-line item table, the
total, **the total in words** in Indian grouping — the conventional check against a tampered figure —
a payment-details panel, and a footer quoting the invoice number for support.

### Only a captured payment has one

`created`, `attempted` and `failed` are attempts rather than transactions, and `refunded` would read as
true of the present. All four answer **409 naming the state**, because "no invoice exists" sends a
student to support to be told their payment never completed. The payments console shows a PDF link on
captured rows only, and a dash on the rest.

### Nothing about tax is invented

Six new **optional** environment variables describe the issuer. With no `INVOICE_GSTIN` the document is
titled `INVOICE` and says nothing about tax at all — no rate, no "inclusive of all taxes", no
placeholder address. Each would be a legal claim about the owner's business. With a GSTIN set it
becomes a `TAX INVOICE`.

### One trap that would have reached production

`pdf-lib` **throws** on a character its standard font cannot encode, and registration deliberately
accepts a name in any Indian script. Without a sanitiser, every student named in Devanagari would have
met a 500 instead of their receipt. There is a test with a real Devanagari name.

Also: `GET /admin/payments/:paymentId/invoice` for staff reissue, gated on `students:read`; ownership
in the query so a changed id is a 404 rather than somebody else's receipt.

**26 new tests** (1192 across 33 files), typecheck, lint, compile and the frontend build. Verified in a
browser end to end — the receipts list, the preview modal, the student download, the staff download,
and the generated PDF's own text extracted and checked line by line.

## 2026-08-28 — Milestone 22, Phase B: the admin student directory, and an Excel export

The admin account list showed who had registered and knew nothing about whether any of them had
paid. The payments console showed the money and could not be filtered by class. Neither could
produce a file, so answering "send me the Class 8 registrations" meant reading a screen into a
spreadsheet by hand.

### One assembly behind both surfaces

`services/studentDirectoryService.ts` is now the single place the directory is built, and
`GET /admin/students` and the new `GET /admin/students/export` run the **same pipeline** — so the
file cannot disagree with the table the administrator pressed the button on. A test sends one set
of filters to both and compares the student ids.

### Payment state, derived on read

Each student now carries `paymentState`, rolled up in the aggregation from their own `Payment`
rows: `paid`, `pending`, `failed`, `refunded`, `not_started`. **Nothing is stored** — the same
rule that put no `hasPaid` flag on `Student`. `paid` outranks everything else on the row, so a
student who failed twice and then paid is paid, and the payment shown is the capture rather than
the latest write. There is deliberately no `cancelled`: the platform has no such payment status,
and a state no code path can produce has no business on an administrator's screen.

**Nobody is filtered out for not having paid.** The payment filter is absent by default and must
stay absent: `not_started` is a first-class state, and a directory that quietly showed only paying
students would look like a working one until somebody asked how many people had registered.

### What was added to the screen

Class, payment-status and inclusive registration-date filters; eight sort orders; school name in
the search; a payment cell that shows the amount, capture date and method for a paid student and
the provider's own failure reason for a failed one; phone and registration date as columns; and a
line above the table stating exactly how many students the download will contain, with a second
button for the whole roll when a filter is on. The nav item is now **All Students**.

### The export

`.xlsx` via `exceljs` (already a dependency — no new one), two sheets: 24 columns of registration
and payment data with the header frozen and auto-filtered, and an `About this export` sheet saying
what the file contains, when, by whom, and what each payment state means — because the file leaves
the platform and gets opened months later by somebody who was not in the room. Dates are real
dates and money is a real number in rupees, so the columns sort and sum.

**Nothing sensitive can be in it**, structurally rather than carefully: the renderer has no
database access and can only write what the shared view holds. Two tests search the whole listing
body and every workbook cell for a hash, a token version and a payment signature.

### Two things that would have been defects

- **`GET /admin/students/export` is declared before `/admin/students/:studentId`.** Declared the
  other way round, Express reads `export` as a student id and answers 400 — the same trap that
  swallowed `practice-availability` and the reason `questionsImport` is mounted first. Regression
  test added.
- **An aggregation bypasses `select: false`.** The schema-level exclusion of `passwordHash`
  protects `find()` and nothing else, so every stage that reaches a response ends in an explicit
  `$project` allow-list.

Also: `adminAccountView()` moved into the service and is now typed against a field interface
rather than `StudentDocument`, so the aggregation's plain objects render through the *same* view
— and the admin page merges account updates into a row rather than replacing it, because the
status and role endpoints answer with the account half only and would otherwise blank the payment
column of whichever student had just been acted on. `paymentView()` was widened the same way, so
money is formatted in exactly one place for both the student's receipt and the console.

Two indexes added to `Student`: `{ registeredAt: -1 }` and `{ classLevel: 1, registeredAt: -1 }`.

Verified in a browser against a local database seeded with all five payment states, plus **1166
backend tests across 32 files** (28 new), typecheck, lint, compile and the frontend build.

## 2026-08-28 — A file may name chapters that do not exist yet, and say so usefully

Reported by the owner: a real **NCERT Class 9** paper was rejected row for row —

```
Row 2: There is no chapter called "Number Systems". Create it under Chapters first…
Row 3: There is no chapter called "Polynomials". Create it under Chapters first…
… ten of these
```

Nothing was wrong with the parsing, the file or the refusal. The bank was seeded with **Class 12**
chapters only, so none of a Class 9 syllabus resolved — and the advice ("create it under Chapters
first") meant retyping ten names by hand, spelled exactly, into a one-field form, with the
rejected rows unreachable from the review screen where the chapter dropdown lives. Correct
behaviour, dead end.

### The refusal stays; the names became actionable

An importer still **never creates taxonomy** — one bad spreadsheet must not be able to reshape the
syllabus, and a typo must not quietly become a real chapter that starts collecting questions. What
changed is that the chapter names come back **structurally** as well as inside the prose, so the
review screen can group them:

- `ImportPreview.unknownChapters` — the distinct names, deduplicated case-insensitively and
  spelled as the file spelled them, because that is the string an examiner has to recognise as
  right or wrong. The rows stay refused.
- The preview page shows them in their own box **above** the rejection lists, with the spelling
  warning, and one button: *Create N chapters and re-read the file*.
- `POST /api/v1/admin/chapters/bulk` creates them under the implicit subject at the top level.
  Then the same upload is re-run — a **fresh preview**, not a patch of the old one, so those rows
  go back through the same resolution, screening and duplicate checks as everything else.

### Why this is not a hole in the rule

The control was never "typing ten names is tedious enough to deter a mistake". It is that **the
examiner reads an explicit list of what will be created before anything is created**. That is
preserved exactly: the upload wrote nothing, the names are listed verbatim, and reading
"Polynomails" in a list of ten is what catches it — retyping it is not. The copy says so, and
points at fixing the spreadsheet rather than the taxonomy.

### Partial success is the normal outcome

Per-name results and **200**, never a 400 — the same shape and reasoning as
`changeQuestionStatusBulk()`. A loop over `createTopic()`, not an `insertMany`, so its rules are
not skipped and one bad name fails alone instead of taking the other nine with it. A name that
already exists is reported as `existing` rather than failed: two examiners importing overlapping
papers is ordinary, and the caller’s intent ("make sure these exist") is met either way. Subtopics
are deliberately **not** creatable this way — a subtopic needs a parent chosen per item.

`BULK_CHAPTER_MAX` is 60, a real syllabus’s worth, and a ceiling in code rather than only in
configuration: a list nobody can read is not a review.

### Caught by the code review it should have been

The preview route lists its response fields one by one, with a comment saying a field added to the
outcome must not be published to the client without a thought. Adding `unknownChapters` to the
service and forgetting the route made three new tests fail on `undefined` — which is the friction
working as designed.

### Tests

Nine, the important one being the **whole loop**: a file naming unknown chapters is refused with
zero usable questions, the names are created in one call, and the identical file then yields two
questions with nothing rejected. Plus deduplication across case, that a resolvable chapter is not
listed, that new chapters are top-level and under the implicit subject, that an existing name is
`existing` and not `failed`, that calling twice does not duplicate, the empty and over-ceiling
400s, and authorization on **both** URL prefixes.

Verified in a browser with a ten-row NCERT Class 9 workbook: nine distinct chapters listed → one
click → **10 examined, 10 usable, 0 invalid, 0 duplicates** → *"Saved 10 questions as drafts"*,
each in its own correct chapter with `source: excel_import`, both `Polynomials` rows sharing one
chapter.

**1138 tests across 31 files.**

---

## 2026-08-28 — Milestone 21, Phase L: the regression pass, and what it found

Phase L was meant to be "run everything and confirm it is green". The backend suite was already
green and stayed green; what the pass actually found was **seven defects in the frontend**, which
has no test suite at all. Every one was introduced or exposed by Phase J, and none was visible
from the backend.

The common cause is worth stating once: Phase J removed the **subject picker** from every screen,
but `Topic` is still scoped by subject and a database may still hold a legacy second subject. Six
screens went from "the student picked Mathematics, so they see mathematics" to "no filter at all".

### A mathematics olympiad was serving Physics

The most serious of them. `getPracticeAvailability()`, `startPracticeSession()`,
`pickAutomaticQuestion()` (the daily challenge) and `getAvailableChallenges()` (the dashboard tile)
all filtered by class and status and **not by subject**. Since Phase J the practice page sends no
`subjectId` at all, so:

- the practice picker listed "Semiconductor Electronics" among the calculus;
- **mixed practice drew from every subject in the database**, and because a practice session
  snapshots its answer key at serve time, a Physics question dealt to a child became a real mark
  on a real report;
- the daily challenge could pin one for a whole class — worse, because a challenge is *pinned*
  and would stand as that day’s record for everyone;
- the dashboard advertised "Physics · 104 questions".

On this project’s own seeded database that was **104 published Physics questions** in the pool.

All four are now scoped to the implicit subject, in the service rather than in the browser: the
guarantee wanted is that the product *serves* mathematics, not that one screen happens to hide the
rest. `null` (genuinely ambiguous) still leaves the query unscoped, matching `suggestPaper()` —
refusing to serve any practice at all because legacy data is ambiguous would break a working
feature over a condition a student can neither see nor fix.

### Five screens listed every subject’s chapters

`Chapters`, the question editor, the Question Bank filter, the mock-test paper builder and the AI
generator all fetched `/topics?parent=root` **unscoped**, so they listed all 26 chapters of both
subjects in one undifferentiated list — on screens that have deliberately stopped mentioning
subjects, so nothing explained why "Alternating Current" was there. Filing a question under one
would have placed it outside the pool every student practises from.

A sixth, the bulk importer, scoped correctly but by `subjects[0]` — ignoring the maths-named
preference the server applies, so it could have scoped to Physics while the server filed under
Mathematics.

All six now go through **one** resolver, `frontend/src/api/implicitSubject.ts`, which mirrors
`findImplicitSubject()` exactly **including its null**: none → null, one → that one, otherwise the
maths-named one and null if there is not one. It deliberately does *not* fall back to the first
subject, because that would show an examiner chapters the server would refuse to write to.

### The two pickers that decide what a child is served

The mock-test paper builder and the daily-challenge scheduler list questions from
`/admin/questions`, which is **not** subject-scoped — correctly, because the Question Bank is where
an administrator finds and manages legacy data, and hiding it from the only people who can fix it
would be worse. But those two screens are not managing the bank; they are choosing what to serve.
Both now pass `subject=<implicit>`. The Question Bank itself is untouched.

### "Your weak area is Mathematics"

Analytics promoted a **subject-scope** area into strengths and weaknesses. With one subject that is
the overall accuracy wearing a name, so the page told a child their weak area was the entire
product. Dropped from `areaCandidates` — the same reasoning that removed the "By subject" table in
Phase J. `bySubject` is still assembled and still returned; what is dropped is only its promotion
into *advice*.

Alongside it, the recommendation copy read "8 published questions in Integrals **(Mathematics)**"
on every line, and the generator’s own description claimed questions were written "from the
**subject**, chapters, class and difficulty you chose" — a control that is no longer on the screen.
The prompt still *tells* the model the subject, and the injection fence still names it among the
things an examiner’s preference cannot override; what changed is only who chose it.

### Seven more places printed the subject to a user

The practice runner, the mock-test runner, the daily-challenge page and card, the dashboard tile,
and the two admin question pickers all rendered `subject.name` — mostly as a `Mathematics ›`
breadcrumb prefix. All now show the chapter, which is the fact that actually varies. The dashboard
tile shows the **class** instead, for the same reason.

### `scripts/retire-extra-subjects.ts`

Phase J removed subject management from the interface, which left no way to retire a legacy
subject — so this is that screen. `npm run retire:subjects`, report-only until `--write`, guarded
by `assertConfiguredForWrites()` like every other script here.

It sets `Subject.status = 'archived'` and **nothing else**: no question is deleted, edited,
unpublished or moved. Archiving is what the aggregations already understand — they match
`subjectDoc.status: 'active'` — and it is what makes `findImplicitSubject()` stop depending on a
*name* matching `/^(math|maths|mathematics)$/`. If no subject is named for mathematics it **stops
without archiving anything**, because the alternative is archiving every subject and leaving the
product with no taxonomy; renaming one field is the cheaper fix.

Verified against the local database: 2 active → 1 archived, all 208 questions still present and
still published.

### Tests

Four regression tests, each pinning a path the browser found and the suite did not:

- practice options do not offer another subject’s chapters;
- **mixed practice draws from the implicit subject only** — seven published questions for the
  class, of which only the two mathematics ones may be dealt;
- the daily challenge never picks another subject’s question (eleven Physics against one maths,
  so an unscoped pick would land on Physics by weight rather than by luck of the seed);
- the dashboard tile does not advertise another subject’s questions.

`createTaxonomy()` now **reuses** an existing subject instead of insisting on a 201. A test wanting
two chapters of the same subject has to call it twice, and since Phase J that is the ordinary case
— reaching for a second subject name to get a distinct chapter now means testing something a
student can never reach. One recommendations fixture was doing exactly that and had to be moved
onto a second mathematics chapter.

**1129 tests across 31 files.**

---

## 2026-08-28 — Milestone 21, Phase J: Classes 3–12, and Subject leaves the interface

### Classes 3 to 12

`CLASS_LEVELS` was Class 5–11 plus **three** Class 12 entries (`- Science`, `- Commerce`,
`- Humanities`). It is now a flat ten: **Class 3 … Class 12**.

The consequence is deliberate and stated where people will read it: **a Commerce student and a
Science student now sit the same papers** — one practice pool, one mock test list, one daily
challenge per day. If a stream ever matters again it must *not* come back as three class values;
that shape put a curriculum distinction inside the field that decides which children see which
questions, so every filter, index and unique constraint had to carry it. An optional `stream`
field on `Student` is the shape to reach for.

### The migration, and the collision it exists to catch

`scripts/migrate-class-levels.ts` (`npm run migrate:classes`). **Report-only by default**, `--write`
to convert, `assertConfiguredForWrites()` first so a misconfigured run cannot even read the wrong
database.

`DailyChallenge` has a **unique index on `{day, classLevel}`**. If one day had a Science *and* a
Commerce challenge, both become `{day, Class 12}` and the second write fails — leaving the
database half-converted. So collisions are detected **first**, reported day by day, and the run
**refuses to proceed** without `--resolve-challenges`. Deleting a scheduled challenge is a real
loss of an administrator's decision, so it is never implicit.

`Certificate` and `GenerationLog` are **deliberately not migrated**. A certificate is a snapshot
of what was printed and handed to a child; rewriting it would make the record disagree with the
paper. Both are plain `String` fields, so a retired value reads back for ever. They are counted
and reported so nobody thinks they were missed.

Verified against the local database: 211 documents reported, then converted, then re-counted at
zero.

### Subject leaves the interface

**Every user-facing Subject control is gone.** The model, the `/subjects` routes and
`Question.subject` all stay — `Topic` is scoped by subject and removing the field would break the
taxonomy — but nobody chooses one any more:

- **Chapters** (was *Subjects & Topics*) manages chapters and subtopics of the one implicit
  subject. No subject creation, no subject archiving.
- **Practice** (student), **Question Bank**, **question editor**, **mock-test picker**, **daily
  challenge picker** and the **AI generator** all lost their subject dropdown.
- **Analytics** lost its "By subject" table — with one subject it repeated the overall figures
  under a heading that made them look like a different measurement. "By topic" is now "By
  chapter". The printed **Report** lost its Subject column.

### The API change that made it clean

`subject` is now **optional** on `createQuestionSchema`, `generateQuestionsSchema` and the
approve/validate schemas, and `resolveTaxonomy()` derives it from the chapter. The cross-check is
**kept** for callers that still send one (AI approval, import): a mismatched pair stays an error
rather than being resolved silently one way or the other.

Deriving beats asking, for the reason the import path already worked this way: a chapter records
its subject, so accepting both admits a pair that can disagree.

### Physics is gone

`scripts/data/class12Physics.ts` deleted and unwired from the seed. AMIT is a mathematics
olympiad; seeding a second subject is what put Physics chapters into a "whole syllabus"
mathematics paper. The architecture still supports more than one subject internally — nothing
forbids adding one later — but nothing seeds one.

### Tests

The registration class tests are now driven from `CLASS_LEVELS` rather than a hand-copied list.
The old version asserted the *old* ten classes, so it had to be rewritten rather than merely
re-run; reading the constant means it cannot go stale again. Added: Class 3 and 4 accepted,
Class 12 accepted with no stream, the three retired stream values **refused**, and the invalid
set from the brief — `2`, `13`, `0`, negative, plus bare numbers and empty.

`normaliseClassLevel()` deliberately **refuses** a retired stream rather than mapping it: a
spreadsheet still saying "Class 12 - Science" was written against the old syllabus, and silently
accepting it would file its questions without the examiner learning the streams were merged. The
migration converts *stored* data; a fresh upload is a chance to notice.

**1125 tests across 31 files.**

---

## 2026-08-23 — Optional auto-detected chapters, and building a paper in one action

Four owner requests, one of which was already true.

### 1. No Subject in bulk upload — already the case

The import page has never had a subject picker. It resolves the chapter list internally and the
subject is derived from the chapter, so there was nothing to remove.

### 2. Chapter is now optional, and detected from the question

`lib/chapterDetection.ts` — a **pure, deterministic** detector. Precedence, in order: the file's
own `Topic` column, then what the question text says, then the examiner's fallback. Leaving the
chapter blank on the upload form is now a real choice.

**No model is called**, for the reason the Phase D ADR gives for `.docx`: the signal is already in
the text, so a model would add cost, latency, a third party and a credential dependency in a core
authoring path — and a chapter guess is exactly what a model gets confidently wrong.

**It suggests; it never decides.** Every detection carries a note naming the words it matched on,
and the reviewer can change it. When two chapters fit equally well it returns `ambiguous` and
**names them** rather than tossing a coin — that is the case where a guess is most likely to be
wrong and least likely to be questioned, because both answers look reasonable to a reviewer
skimming. When nothing matches and there is no fallback, the row is **reported with its number**.
A question in the wrong chapter is served to students practising something else, and it corrupts
the topic analytics the recommendation engine reads.

The same detector serves the **manual editor**: type a question, press *"Suggest a chapter from the
question"*, and accept or ignore it. One pure function, so the editor and the importer cannot
disagree about what a question looks like.

### 3 and 4. Chapter-wise and whole-syllabus papers

`GET /admin/questions/paper-suggestion` and a **Fill from / How many / Add to the paper** control
in the mock-test author. With a chapter it samples that chapter; without, it **spreads across
every chapter that has published questions for the class**, round-robin.

The spread is why this is an endpoint rather than the existing listing with a `limit`: forty
questions off the top of the bank are the forty most *recent*, which in a bank filled chapter by
chapter means one or two chapters and none of the rest. That is not a syllabus paper.

It adds to the paper rather than replacing it and skips duplicates, so an author can fill from two
chapters in turn; fewer than asked for is reported, not hidden.

### A real bug the browser check caught

A "whole syllabus" Class 12 paper came back containing **Physics** chapters — Ray Optics,
Electromagnetic Induction, Electrostatic Potential — because the spread was scoped by *class*
alone and this database still holds a legacy Physics subject.

Fixed by scoping to the implicit subject via a new shared `findImplicitSubject()` /
`requireImplicitSubject()` in `taxonomyService.ts`. The pair is deliberate: a **filter** degrades
to unscoped when the subject is genuinely ambiguous (breaking a working feature over legacy data
the examiner cannot see would be worse), while a **write** insists, because filing questions under
a guessed subject makes them invisible to every filter a user can construct. The endpoint is now
correct regardless of whether Physics is ever deleted.

### A stemmer bug, caught by its own test

`stem("derivatives")` returned `derivativ` while `stem("derivative")` stayed whole, so the two
never compared equal and detection was leaning entirely on the loose 5-character prefix fallback.
`-es` is only a two-letter plural after a sibilant (`boxes` → `box`), so it is now applied only
there.

### Added

- `lib/chapterDetection.ts`; `GET /admin/questions/detect-chapter`;
  `GET /admin/questions/paper-suggestion`; `suggestPaper()`; `findImplicitSubject()` /
  `requireImplicitSubject()`; `ImportBatch.subject`.
- `tests/chapterDetection.test.ts` — 24 tests. Suite total **1097 → 1121 across 31 files**.

### Verified in a browser

Detection against the real syllabus: *"inverse of the matrix"* → Matrices, *"probability of a sum
of seven"* → Probability, *"derivative of $x^3$"* → Applications of Derivatives, *"dot product of
two vectors"* → Vector Algebra (on two words), and the apples-and-profit question → **nothing**,
correctly. A `.docx` uploaded with **no chapter at all** filed two questions automatically and
reported the third by its question number. A 14-question whole-syllabus paper spread across 13
mathematics chapters with **no Physics**.

### One thing worth knowing about `ImportBatch`

Approval used to derive the subject from `defaultTopic`, which broke the moment the chapter became
optional — an import that left the chapter to detection had nothing to derive from and would have
been unapprovable for a reason the examiner could not act on. The subject is now recorded on the
batch, with a fallback to the old derivation for rows written before the field existed.

---

## 2026-08-23 — Milestone 21, Phases H and I: mock tests and daily challenges from a selection

From the Question Bank, a selection can now be taken straight into the Mock Test author or the
Daily Challenge scheduler. **No backend change was needed** — `createMockTestSchema.questions`
and `scheduleChallengeSchema.questionId` already accept explicit ids — so this is entirely an
affordance over the APIs that existed.

### The rules live next to the URL, not in the button

`pages/Admin/questionHandoff.ts` decides whether a selection *can* go somewhere and returns
either a URL or **the reason it cannot**. Both destinations refuse things the Question Bank could
otherwise offer:

- a mock test's paper must be all **one class** (`classLevel` is the only thing that says who a
  question is for, so a mixed paper would reach the wrong children);
- a daily challenge is **one published question** (a student may only ever be served a published
  one).

So the buttons explain themselves — *"A mock test is for one class, and this selection spans
Class 7, Class 8. Filter by class first."* — rather than navigating somewhere that then rejects
the selection. The reason is rendered as text as well as a `title`, because a greyed-out button
with only a tooltip is invisible to a keyboard user and undiscoverable on touch.

### A query string rather than router state

`navigate(path, { state })` is tidier and wrong here: it does not survive a page refresh, and both
destinations are forms an administrator will reload while filling in. A query string survives and
is linkable. Question ids are not secrets, and 100 of them is about 2.4 KB.

The mock-test hand-off **fetches each question** rather than trusting the ids, because the paper
shows the text and marks and because a stale link could name something since archived — and
anything it cannot use is **reported by name** rather than dropped, so an author never silently
gets a short paper. It runs only when *creating*: a hand-off into an existing test would rewrite
a paper somebody may already have sat.

The daily-challenge hand-off deliberately does **not** prefill the day. A date is a decision, and
guessing "tomorrow" is the kind of helpfulness that ends with a challenge on a day nobody meant.

### A real race condition, found by verifying in the browser

The Daily Challenge picker showed **"No published questions for Class 7"** while the API was
returning two of them.

`loadQuestions()` re-runs whenever the class, subject or search changes, and nothing stopped an
*earlier* request from resolving *later* and overwriting the list with results for a filter the
user had already moved off. The hand-off exposed it because it sets the class immediately after
mount, so the default-class request and the real one were always in flight together — but the bug
was pre-existing and reachable by anyone changing the class filter quickly.

Fixed in **both** pickers (Daily Challenge and Mock Test, which had the same shape and the same
latent race) with a `cancelled` guard: only the newest request may write to state.

### Added

- `pages/Admin/questionHandoff.ts` — `mockTestHandoff()`, `dailyChallengeHandoff()`,
  `sharedClassLevel()`.
- **Create mock test** and **Schedule daily challenge** in the Question Bank bulk bar.
- Prefill in `MockTestForm` (`?questions=&classLevel=`) and `DailyChallenges`
  (`?questionId=&classLevel=`), each announcing what came over.

### Verified in a browser

One published Class 7 question → both actions offered. Two → mock test offered, daily challenge
refused ("select exactly one"). Adding a Class 8 one → mock test refused, naming both classes.
Then the real click-through: **"2 questions brought over… The paper — 2 questions, 8 marks"** with
the class carried across, and a daily challenge scheduled to **"Scheduled for Class 7 on Sat, Aug
29"** and appearing in the list. Seed rows deleted afterwards.

**No new tests.** These phases add no backend behaviour, and the frontend has no test suite —
which is why the browser pass was the verification, and why it found the race.

---

## 2026-08-23 — Milestone 21, Phase G: making imported questions practisable

From the Question Bank, an administrator can now select questions and **publish them in one
action**, then confirm what a class can actually practise.

### Why this is not a "Practice Set"

Practice is student-initiated: a student picks a class, chapter and difficulty and the server
samples what is **published**. There is no curated set and never has been, so there is nothing
for an administrator to assign *to*. Building one would mean a **second path that serves
questions to students** — every such path has to re-implement the answer-key snapshot rules —
and the brief says in terms not to create a second Practice system.

So publishing *is* the assignment, which was already true (a Phase C test asserts an imported,
published question appears in a student's practice availability). What was missing was the
affordance and the confirmation. Owner decision, recorded as an ADR.

### Added

- **`PATCH /admin/questions/bulk-status`** — moves up to 100 questions through the editorial
  workflow in one request. It **loops over `changeQuestionStatus()`** rather than issuing an
  `updateMany`, which is the safety property: a bulk write would skip `assertPublishable()` and
  put questions with no solution in front of children in batches. A partial success is normal and
  answers 200 with per-question results; nothing is rolled back.
- **`GET /admin/questions/practice-availability?classLevel=…`** — what a student of that class
  would now find, from the **same** `getPracticeAvailability()` the student picker uses. Counts
  and names only, no question text, no answer key.
- Question Bank selection: per-row checkboxes, a select-all with a proper indeterminate state, a
  bulk bar reading *"Publish N → available to practise"*, a refusal report naming each question
  and its reason, and a class picker showing the resulting practice availability.
- 11 tests in `tests/questionBank.test.ts`. Suite total **1086 → 1097**.

### A route-ordering bug, caught before it shipped

`GET /admin/questions/practice-availability` was first added at the bottom of the file, where
`/admin/questions/:id` — declared 180 lines earlier — matched `practice-availability` as an id
and answered 400. Both new routes moved above it, and there is now a test asserting the status is
not 400. Same trap `CLAUDE.md` already records for mounting `questionsImport` ahead of
`questionsAdmin`; it is apparently easy to walk into twice.

### Verified in a browser

Two seeded questions, one publishable and one with no solution, selected together and published:
the page reported *"1 of 2 updated. 1 refused: … Add a solution before publishing"*, kept the
refused one selected, and the preview then read *"1 question available to practise for Class 7 —
Applications of Derivatives — 1 (Easy)"* while Class 6 correctly read empty. Seed rows deleted
afterwards.

---

## 2026-08-23 — Milestone 21, Phase F: the import review screen

**Bulk import is now usable by an administrator.** Phases C–E built three parsers that were
only reachable with `curl`; this is the page. `/admin/questions/import`, with a **Bulk Import**
entry in the admin sidebar.

### One page, three formats, one review screen

A tab per format — Excel, Word, Photographs — over **one** review screen. Every parser
normalises into the same candidate, so a spreadsheet row, a Word paragraph and a photographed
question are edited, checked and approved by identical code. Three review screens would be
three places for the approve payload to drift out of step with the backend.

Each format tab prints its parser's own `basis` **verbatim** and says plainly when a language
model reads the file. An unconfigured image parser reports itself unavailable and names
`GEMINI_API_KEY`, while the other two carry on.

### Nothing is hidden

The counts strip — examined, usable, invalid, duplicates, unreadable — is visible without
clicking anything, because the spec's rule is "do not silently skip invalid rows" and the honest
reading is that an examiner should see how many questions their file *did not* produce. Beneath
it: a per-file table (so one bad photograph is visibly one failure, not ten), an expandable
breakdown of every failure, rejection and duplicate **with its row number**, the batch warnings,
and a **CSV of the problem list** built in the browser from data already on the page.

### Editing, and the dry run

Each card can be edited in place — text, options, correct answer, solution — and its
**placement** changed: class, chapter, difficulty and type, per question, because a spreadsheet
legitimately files row 3 and row 40 under different chapters and the reviewer has to be able to
correct a row the file got wrong.

**Check before saving** calls a new dry-run endpoint that runs the same `screenEach()` approval
runs. Its whole value is that its answer *is* the answer approval will give — a check that
passed where the save would fail would be worse than no check. It writes nothing at all, not
even a batch counter, so it is not rate limited and an examiner may press it freely rather than
pressing Approve to find out.

### Added

- **`POST /admin/questions/import/validate`** and `validateImport()` — the dry run. No
  `batchId`, because nothing is attributed to a batch.
- **`frontend/src/pages/Admin/QuestionImport.tsx`** + its CSS module, the `/admin/questions/import`
  route (registered **before** `/admin/questions/:id/edit`, or `:id` eats the word "import" —
  the same ordering trap the backend router has), and the sidebar entry.
- Import DTOs in `frontend/src/api/types.ts`.
- 7 tests for the dry run in `tests/questionImport.test.ts`. Suite total **1080 → 1086**.

### Verified in a browser, not just by tests

Driven end to end against the local dev database: a five-row workbook with three good rows, one
with no answer and one claiming `Class 13`. The page reported **5 examined, 3 usable, 1 invalid,
1 unreadable**, named both problems with their row numbers, the dry run said "all 3 would save",
and approval put three `draft` rows in the bank stamped `excel_import` / `deterministic` /
`modelName: null` under the chosen chapter. The verification rows were then deleted from the
local database.

**That browser pass found a bug the test suite could not**: the page printed *"Saved undefined
questions"*, because it assumed a `created` count the approve endpoint does not return. Fixing
it surfaced a second, more useful gap — `published` and `publishFailures` were being ignored, so
"Approve & publish" would have claimed to publish questions that in fact stayed as drafts
because they had no solution. Both are fixed, and the response shape is now written out in the
page rather than guessed at.

### Not done in this phase

Phases G–I (assigning imported questions to Practice, Mock Tests and Daily Challenges), J (the
Class 3–12 range and removing the user-facing Subject concept) and K (dropping Subject from the
AI generator) remain. **Phase G still needs an owner decision** — Practice has no
admin-curated set to assign to.

---

## 2026-08-23 — Milestone 21, Phase E: importing questions from photographs

All three formats now read a file. An administrator can upload photographs of a question paper
and get the questions onto the review screen.

### Why a model here, when DOCX deliberately refuses one

Phase D declined AI for Word documents because a `.docx` *is text we already have*. A photograph
is the opposite case: there is no text at all, and OCR is the only way in. This is not a reversal
of that decision — it is the case that decision was drawn around.

So the image path is the **only** importer that is non-deterministic, spends provider quota, and
reports `extraction: 'model'`. All three are stated rather than smoothed over.

### The model transcribes; our own code decides what the answer means

This is the design decision the phase rests on. The response schema asks for **what is printed on
the page** — the question, the option texts, and the answer *as written* (`"B"`, `"TRUE"`, `"60"`)
as a plain string. It does **not** ask the model for `isCorrect` flags, `booleanAnswer` or
`numericAnswer`; those are conclusions.

The conclusions are drawn by `lib/importAnswerText.ts` — the same readers a spreadsheet cell and
an `Answer: B` line in Word go through. So this phase needed **no new answer reading at all**,
which is exactly what that module was extracted to make possible. It also narrows the model to
the one thing it is good at (reading pixels) and keeps the thing that must not be wrong (what
counts as correct) in code.

### The refusal that matters most

**A question with no printed answer never acquires one.** The prompt forbids the model from
working an answer out, and a transcription that comes back with an empty answer is refused with
an actionable message. A calculated answer would be indistinguishable from a printed one, and
real children would be marked against it.

### Honest about what OCR cannot promise

Every image import carries a **standing warning**, without exception: mathematical notation is
where transcription is least reliable, and its failures are quiet — a dropped exponent, a minus
read as a hyphen, a fraction flattened. The result reads plausibly and is wrong, which is the
exact failure the review step exists to catch, and a reviewer who has not been told will skim.
Per-question notes carry the model's own uncertainty; a question needing a diagram is flagged,
because `Question` has no image field in any format.

### Added

- **`services/imageImportParser.ts`** — the parser, the transcription schema, the prompt,
  `OCR_STANDING_WARNING`, `mimeTypeFor()` and `IMAGE_GUIDANCE`.
- **`requestGeminiJson()`** in `services/geminiQuestionGenerator.ts` — extracted from
  `generate()`, and **the only place a language model is called**. What lives there is not the
  prompt or the schema (properly per-caller) but the things that must not be got wrong twice: the
  client via `clientFactory` (so the test seam still intercepts every call), the credential check,
  `attemptGenerate()` and its single shared deadline, `describeFailure()` and `redact()`, and the
  blocked-prompt and `MAX_TOKENS` cases. The generator's 52 tests pass unchanged, which is the
  evidence the extraction was behaviour-neutral.
- **`tests/imageImport.test.ts`** — 39 tests, none touching the network. Suite total **1039 →
  1078 across 30 files**.

### Not done in this phase

There is still **no frontend** — Phase F — so all three importers are exercisable only through the
API, and the feature is not usable by a non-technical administrator. The class range is still
`Class 5`–`Class 11` plus the three Class-12 streams; 3–12 is Phase J.

---

## 2026-08-19 — Milestone 21, Phase D: the DOCX importer

An administrator can now upload a `.docx` of questions. Word joins Excel; the image route still
answers 503.

### A Word file has no schema, so the design is about being unsure honestly

A spreadsheet at least tells you which column is the answer. A `.docx` is prose with conventions,
and every examiner's conventions differ — so this parser is unavoidably a heuristic, and the real
decision is what it does when it cannot be certain. **It never guesses quietly:**

- anything it had to interpret becomes a **note** on that candidate, so a human compares it
  against the original (a DOCX-extracted question almost always carries at least one);
- anything it could not use becomes a **failure naming where it was** ("Question 7");
- if it cannot find questions at all it says **what it looked for**, rather than returning one
  enormous candidate containing the whole file.

### What it understands

Question numbering as `Q1.`, `1.`, `1)`, `Q.1`, `Question 1:` or `Ques 1 -`. Options as `(a)`,
`a)`, `A.` or `(1)`. Answers as `Answer:`, `Ans -`, `Correct option:` or `Key:`. Solutions as
`Solution:`, `Explanation:` or `Working:`. Optional per-question metadata lines — `Class: 8`,
`Topic: Algebra`, `Difficulty: Hard`, `Marks: 6`, `Type: multiple_choice`, `Tags: …`. A title above
the first question is dropped, and a stem or option that Word wrapped across paragraphs is
rejoined.

A line matching the metadata *shape* but not a known key — `Ravi says: the answer is four.` —
stays in the question text. Swallowing it would silently truncate the stem.

### The two failures that would otherwise look like success

**Word's automatic numbering does not survive text extraction.** If an examiner numbered the
questions with the toolbar, the digits live in `numbering.xml` and the extracted text has none —
so a marker-only parser sees one giant question. There is a fallback that splits on `Answer:`
lines instead, and it **says so**, because that is the case most likely to have put a boundary in
the wrong place; the warning names the cause and the one-step fix.

**Word equation objects are dropped silently by `mammoth`.** A question built with Word's equation
editor imports looking complete with the formula simply *missing* from the middle of a sentence.
`containsWordEquations()` detects the markup and the file reports it, naming the fix (retype as
`$…$`). Said once per upload, not once per document.

### No AI, and that is a decision

The spec permits AI-assisted extraction for complex documents behind a provider abstraction. It is
not used: a `.docx` is *text we already have*, the structure is genuinely recoverable by reading
it, and a model would add cost, latency and a third party to every import — and make a core
format depend on a credential the product is required to work without. The image path is
different, because there OCR is the only way in.

### Added

- **`services/docxImportParser.ts`** — the parser, `splitIntoBlocks()`, `readBlock()`, and
  `DOCX_CONVENTIONS` (exported as data so the upload page and the parser cannot drift).
- **`lib/importAnswerText.ts`** — the answer readers, moved out of the Excel parser. Same argument
  as one grader and one screener: **"the answer is B" must mean the same thing** whether it was
  written in a spreadsheet cell or on an `Answer: B` line. Pure functions of a string.
- **`lib/ooxml.ts`** — `looksLikeWorkbook()`, `looksLikeWordDocument()`, `containsWordEquations()`.
- **`ParseOutcome.notes`** — a file-level advisory channel, surfaced in `batchWarnings`. The
  equation warning is one fact about a file, not fifty facts about fifty questions.
- **`tests/docxImport.test.ts`** (38 tests) and **`tests/helpers/docx.ts`**, which builds real
  `.docx` files in memory with `jszip` — already present as `mammoth`'s own dependency, so nothing
  new was installed. Suite total **1001 → 1039 across 29 files**.

### Three defects found by the tests, all fixed

1. **`Q.1` and `Q1` were not recognised** as question markers, because the terminator after the
   digit was required. It is now optional when the `Q` prefix is present, which is already
   unambiguous. Well-numbered papers were falling through to the answer-splitting fallback.
2. **A document containing a single question kept `Q1.` glued to its text.** Marker mode required
   *two* markers, so one question fell to the fallback — which does not strip the marker. One is
   now enough.
3. **A file of ordinary prose came back as one enormous "question".** The fallback now requires at
   least one `Answer:` line somewhere, since it is answer-terminated and has nothing to work with
   otherwise. Prose is reported as "no questions could be found", with the conventions.

### Not done in this phase

Images (Phase E) still answer 503. There is still **no frontend** — Phase F — so both importers are
exercisable only through the API. Class range is still `Class 5`–`Class 11` plus the three
Class-12 streams; 3–12 is Phase J.

---

## 2026-08-18 — Milestone 21, Phase C: the Excel importer

An administrator can now upload an `.xlsx` file of questions and get them onto the review
screen. The pipeline was Phase B; this is the first format that actually reads a file, so the
Excel upload route stops answering 503.

### The division of labour, which is what makes the errors useful

The parser is a **shape adapter**, in the same sense `toCandidate()` is in the Gemini generator.
It turns a row into a candidate and does not decide whether that candidate is any good:

- a row that **cannot become a candidate** is a failure naming its row number — no question
  text, no correct answer, a `Marks` column containing "four";
- a row that becomes a **bad candidate** goes to the one shared screener, which rejects it in the
  same words a hand-authoring examiner would read — two correct options on a single-choice
  question, unbalanced LaTeX, negative marks above the marks;
- a row we had to **interpret** carries a note, which never blocks anything.

### Tolerant of the file, strict about the data

Column **order does not matter**, headings are matched loosely (`Negative Marks`,
`negative_marks` and `Penalty` are one column; `Chapter` is `Topic`; `Ans` is `Correct
Answer`), extra columns are ignored, the header row may sit below a title row, and **every sheet
is read** so a sheet per class works. That is not politeness — an examiner exports from whatever
they already have, and a parser demanding byte-exact headers is one nobody can use.

The **data** is not treated tolerantly. A `Class` of `13`, a chapter that does not exist, or a
`Marks` cell containing a word is reported with its row number rather than quietly defaulted,
because a question filed under the wrong cohort is served to the wrong children.

### One `Correct Answer` column, read per type

Rather than a column per question type. A choice row takes the option letter (`A`), letters
(`A, C` / `A and C` / `A;C`) or the exact option text; `true_false` takes `TRUE`/`FALSE` (and `T`,
`Yes`, `1`); `numeric` takes a plain number; `fill_blank` takes every accepted spelling separated
by a **vertical bar**. A bar rather than a comma because `1,000` and `2, 3 and 5` are single
answers containing commas, and a comma-separated list would silently split real answers into
wrong ones.

A blank `Type` column is **inferred** from the row and always carries a note, since an inference
is exactly what a reviewer should check. Options are decisive; after that a true/false word beats
a number, because `1` and `0` are boolean spellings and a bare `1` in an answer column is far
more often "true" than the number one.

### Added

- **`services/excelImportParser.ts`** — the parser, plus the pure helpers the tests exercise
  directly (`cellText`, `readCorrectOptions`, `readBoolean`, `readAcceptedAnswers`,
  `readQuestionType`, `inferType`, `findHeaderRow`, `looksLikeWorkbook`).
- **`GET /admin/questions/import/excel/template`** — the downloadable template, **generated per
  request** so its `Class`, `Type` and `Difficulty` dropdowns come from `CLASS_LEVELS`,
  `QUESTION_TYPES` and `DIFFICULTIES`. A checked-in file would go stale the moment the class
  range changes, which it is about to in Phase J. Two sheets: the table, and an Instructions
  sheet explaining every column.
- **`tests/excelImport.test.ts`** — 57 tests, building **real `.xlsx` files** with `exceljs` and
  pushing them through the real route. Suite total **944 → 1001 across 28 files**.

### The authoritative format check now exists

`.xlsx` and `.docx` are both ZIPs beginning `50 4B 03 04`, so the magic-byte test in
`uploadSchemas.ts` cannot tell them apart. `looksLikeWorkbook()` searches the bytes for the
`xl/workbook.xml` entry name — which a ZIP stores uncompressed — so it answers without inflating
anything, and a decompression bomb that is not a workbook is refused before `exceljs` touches
it. A `.docx` posted here is told what it is and pointed at the Word import.

### Two defects found by the tests, both fixed

1. **The template's own Instructions sheet was imported as twelve questions.** Its glossary's
   first column reads `Question`, and a header detector needing one match read that row as a
   header. `findHeaderRow()` now requires a question column **plus** an option column or one of
   `Correct Answer` / `Solution` / `Type` / `Class` / `Marks` / `Difficulty`. Any workbook with a
   "what each column means" sheet had the same shape, so this was not just our template.
2. **The example rows named chapters that only exist in this project.** `Algebra` and `Geometry`
   are in our seed data and nobody else's, so an examiner's very first import would have opened
   with five rejected rows. The examples now leave `Topic` blank, which means "use the chapter I
   chose when uploading".

### Not done in this phase

DOCX (Phase D) and image (Phase E) still answer 503. There is still **no frontend at all** —
Phase F — so this is exercisable only through the API. The class range is still `Class 5`–`Class
11` plus the three Class-12 streams; 3–12 is Phase J.

---

## 2026-08-18 — Milestone 21, Phase B: shared bulk-import infrastructure

The pipeline every question importer plugs into. **No format parser yet** — Excel, DOCX and image
arrive in Phases C, D and E — so no real file can be imported at the end of this phase. What exists is
the part that decides whether what a parser read may become a question, which is the part worth getting
right first.

### The shape, and why it is the generator's shape

Two phases with nothing stored between them: **uploading writes no questions, and only approval
writes.** That is `services/questionGeneratorService.ts` exactly, and for the same reason — candidates
live in the reviewer's browser so the bank cannot fill with machine-read text nobody looked at.
Approval re-validates from scratch, because what it receives is whatever the review screen sent after
the examiner corrected it.

### One screener, generalised rather than copied

`screenCandidates()` grew a sibling: `screenEach()`, which takes a target **per candidate** instead of
one for the batch. A spreadsheet legitimately files row 3 and row 40 under different chapters, so
imports needed per-row placement — but writing a second screener for that is exactly what the
one-screener rule forbids, since two would eventually disagree about what may become a question and the
more permissive one would decide. `screenCandidates()` now delegates to it and is unchanged in
behaviour. Batch-internal duplicate detection still spans the whole upload, so the same question pasted
into two chapters of one file is still caught.

### Added

- **`lib/importTypes.ts`** — THE importer seam. `ImportedCandidate` composes `GeneratedCandidate`
  **verbatim** for its content half, so there is exactly one canonical candidate representation and no
  `ExcelQuestion` / `DocxQuestion` / `ImageQuestion`. A parser reports the taxonomy it read as
  **names** (`ImportedTaxonomyHint`) and never sees an id.
- **`ImportBatch`** (the 27th model) — what was uploaded, what came of it, and what the reviewer then
  did. Per-file outcomes, so one unreadable photograph reads as one named failure rather than as a
  failed batch. Stores **no uploaded bytes and no question text**. It is what approval reads provenance
  back from, using the id we issued.
- **`validation/uploadSchemas.ts`** — magic-byte validation extended to OOXML (both `.xlsx` and `.docx`
  must begin `50 4B 03 04`), per-file and per-request size ceilings, a file-count cap, and filename
  validation. Uploads travel as base64 inside the JSON body like the registration photo, so **nothing
  touches the filesystem** — temp-file cleanup, safe filenames and path traversal are absent risks
  rather than mitigated ones.
- **`services/questionImportService.ts`** — the parser registry, `previewImport()` (parse → place →
  screen → report, writing no questions), `approveImport()` (the only writer) and
  `recordImportRejections()`.
- **`routes/v1/questionsImport.routes.ts`** — five endpoints under `/admin/questions/import`, every one
  gated on `questions:write`.
- **`importLimiter`**, plus `IMPORT_MAX_QUESTIONS` and `IMPORT_RATE_LIMIT_PER_HOUR`.
- Three new `QUESTION_SOURCES` values (`excel_import`, `docx_import`, `image_import`) and the
  `questions.imported` audit action.
- **`tests/questionImport.test.ts`** — 62 tests. Suite total **882 → 944 across 27 files**.

### Two dependencies, both free

`exceljs` (MIT) for `.xlsx` and `mammoth` (BSD) for `.docx`, installed ready for Phases C and D. Images
need neither — the already-installed `@google/genai` accepts inline image bytes. `npm audit` reports one
transitive advisory against `exceljs` (`uuid` < 11.1.1: a missing buffer bounds check in v3/v5/v6 when
`buf` is supplied) and it is **not reachable**, because exceljs calls only `uuid.v4()` and never passes
`buf`. Verified by reading `node_modules/exceljs/lib`, not assumed. The other ten advisories in that
report predate this phase and all come from `@vercel/node`.

### Three defects the tests found, all fixed

1. **Every rejected upload answered 500 instead of 400.** In zod 4 a check on an *array* still runs
   when a child failed, and the failed child arrives as `undefined`; reading `.data` off it threw a
   `TypeError`. So a bad signature, a wrong extension and an oversized file all reported "internal
   server error" instead of saying what was wrong. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
2. **The review screen was shown a mangled chapter name.** The lookup index is lowercased so a
   spreadsheet's `ALGEBRA` finds `Algebra`, and the display name was being read back out of those keys
   — so the reviewer saw `algebra`. Display names are kept separately now.
3. **"is not a Excel workbook."** The article was written at the call site rather than carried with the
   label.

### Not done in this phase, deliberately

No parser, so no real file imports yet. No review UI (Phase F). No frontend change at all. The class
range is **still `Class 5`–`Class 11` plus the three Class-12 streams** — extending it to 3–12 is Phase
J, which is why the new suite exercises the classes that exist today rather than asserting a range that
does not.

---

## 2026-08-18 — Milestone 20: the official Gemini SDK, structured output, and review tooling

Not a new feature so much as the AI question generator finally being built the way it should
have been. The owner asked for the official Google SDK, real structured output, subtopic
support, retries, rate limiting, a review workflow with per-question approval, and provenance
on what gets saved. All of it landed; one thing on the list was deliberately declined and one
defect was found and fixed by verifying against the live API rather than by reading the code.

### The SDK, and the ADR it supersedes

`@google/genai` replaces the hand-rolled `fetch` call. Milestone 17 had explicitly rejected an
SDK — recorded in `DECISIONS.md` — on two grounds: a version to chase, and automatic retries
that are unwanted against a metered free tier. The owner's instruction overrides the first, and
the second is **answered rather than accepted**: retrying is this codebase's own logic, not the
SDK's, it happens only for 429/5xx/timeout, and `GEMINI_MAX_RETRIES` (default 1, max 3) bounds
it. An expired key, a blocked prompt and a retired model name are **not** retried, because
repeating them spends quota to receive the same refusal.

The package declares `"type": "module"` and ships one declaration file for both builds, so a
CommonJS import of it is rejected by TypeScript (TS1479) even though `dist/node/index.cjs`
loads perfectly. It is therefore `require`d behind a `typeof import(...)` cast — fully typed,
one lint suppression, and a comment explaining why. Verified by loading the **compiled** output,
not just the source.

### Structured output, per question type

The model is now handed a `responseSchema` describing the exact object shape it must return,
built per question type rather than as one union: a numeric question's schema has no `options`
property at all, so options cannot come back to be rejected. `minItems`/`maxItems` pin the batch
size and the option count. `marks` and `negativeMarks` are **absent from the schema** — the
paper is priced by the examiner, and the model has no opinion worth reading.

### What else the examiner can now do

- **Subtopics.** A generation request may name a subtopic of the primary chapter; it reaches the
  prompt and the questions are filed under it. Checked against the chapter *before* a request is
  spent, not after twenty unfileable questions come back.
- **Check before saving** — `POST /admin/generate-questions/validate`, a dry run that answers
  "would this batch save?" through the **same** screening function approval uses, and writes
  nothing. It exists because an edit can break a rule (most often unticking the correct option
  and forgetting to tick another) and the only way to find out was to press Approve.
- **Per-question selection.** Tick what to keep; approve the selection as drafts or published.
- **Advisory quality warnings** (`lib/questionQuality.ts`, pure, no database): a question
  referring to a figure it cannot have, a solution that never reaches the stored answer, a
  numeric tolerance loose enough to mark a wrong answer right, rounding left unstated, two
  options that are the same value written two ways, a correct option conspicuously longer than
  the distractors, and — across the batch — the correct answer sitting in one position
  throughout. These **never reject**: they annotate, and the reviewer decides. `createQuestionSchema`
  holds the rules that always are defects, and it is still the only gate.
- **Rejection is recorded.** `POST /admin/generate-questions/reject` increments a counter on the
  generation log. Nothing was stored, so there is nothing to delete — but "the examiner kept two
  of twenty" is the only honest measure of whether a prompt configuration works, and it was
  invisible everywhere else in the system.
- **Provenance on the saved question.** A new `Question.provenance` block records the generator,
  the **exact model**, the generation-log row, whether the reviewer edited it, and who approved
  it. It is read back from **our own log** rather than taken from the request body, so a client
  cannot name a model it did not use or file machine-written questions as hand-written ones. The
  question bank prints a badge from it and can filter on `source`, because a stored field nothing
  reads is the shape of thing Milestone 15 deleted.

### Cost control

`generationLimiter` — 60 requests/hour per IP, configurable — in front of the one route in the
product where every call spends third-party quota. It had been sitting behind the general
`/api` limiter alone, which allows 300 requests in fifteen minutes: enough for one examiner
leaning on the button to exhaust a day's free tier before lunch. `GENERATION_MAX_QUESTIONS` and
`GENERATION_MAX_INSTRUCTION_CHARS` cap a single request, enforced in the zod schema so the
browser cannot exceed them, under a hard ceiling in code that keeps a batch reviewable by one
human.

### Prompt injection

The examiner's instruction was already fenced and last; it is now introduced as a *preference*
that explicitly cannot change the class, chapters, subtopic, type, count, language, marks, the
formatting rules or the output shape — and the fence delimiter is **stripped out of the
examiner's own text**, so it cannot close the quotation early and continue as though it were the
system talking. A test asserts the requirements appear before the instruction and that the fence
survives.

### The defect that only a live call could find

The first version created the abort signal **once** and reused it across retry attempts. A first
attempt that consumed the whole minute left the retry aborting instantly — turning a real 503
into a misleading "timed out", which is exactly what happened against the live API on the first
verification run. A fresh full-length signal per attempt would have been no better on a
serverless platform: two sixty-second attempts plus back-off outlive the invocation. It is now
**one budget shared across all attempts**; each gets what is left, and the loop stops when too
little remains to be worth trying.

Verified against the real API: the model list, a retired model name (Google's own remedy
message, with ours appended), a genuine 503 and the retry, and one real two-question generation
whose output matched the schema exactly. That last one also produced an answer key that was
**mathematically wrong** — a good demonstration of why `questionQuality.ts` is careful to claim
nothing about mathematical correctness, and why the human review step is mandatory.

### Deliberately not done

**Short answer** as a question type, again. It cannot be auto-graded without either a human
marking queue or sending a child's writing to a model, and both were rejected in Milestone 18.
`fill_blank` covers the auto-gradable part of that space. Also **no `/regenerate` endpoint**:
asking for a replacement is `POST /admin/generate-questions` with `count: 1` and the on-screen
texts in `exclude`, and a second endpoint would be a second copy of the generation path — the
copy that quietly misses a validation step.

### New environment variables

`GEMINI_MAX_RETRIES`, `GENERATION_MAX_QUESTIONS`, `GENERATION_MAX_INSTRUCTION_CHARS`,
`GENERATION_RATE_LIMIT_PER_HOUR` — all optional with working defaults. `npm run verify:gemini
--prefix backend` is a new read-only script that asks Google which models the configured key can
call and says plainly whether `GEMINI_MODEL` is one of them; it spends no generation quota.

### Verification

`npm test --prefix backend` — **882 passing across 26 files**, up from 830/25 (30 new tests in
`tests/questionGenerator.test.ts`, which now covers the SDK seam, retry classification, key
redaction, structured-output schema shape, prompt-injection fencing, cost limits, subtopics,
provenance, the dry run, warnings and rejection). Typecheck, lint and compile pass on the
backend; `tsc -b` and `npm run build` pass on the frontend. **This also clears the warning left
by the 2026-08-17 security audit**, whose changes had never been run: they run, and they pass.

---

## 2026-08-17 - Complete security audit: five findings, five fixes

The whole application reviewed against the standard list -- authentication, authorization
bypass, IDOR, privilege escalation, JWT and refresh handling, password storage, CORS,
CSRF, XSS, NoSQL injection, input validation, rate limiting, brute force, mass assignment,
information and error leakage, file upload, payment and webhook handling, secret exposure,
and administrative endpoint protection. Five findings were confirmed and fixed. The full
write-up is in [`SECURITY.md`](SECURITY.md); this is what changed in the code.

### CSRF is closed, by verifying the request's origin

`backend/src/middleware/csrf.ts`, mounted once in `app.ts` so it covers `/api/v1` and the
`/api` alias together. Every `POST`/`PUT`/`PATCH`/`DELETE` must carry an `Origin` (or,
failing that, a `Referer`) whose host is in the same allow-list CORS uses, or the request's
own host. Reads are untouched.

The gap was real and had been mis-scoped in the documentation. Two incidental defences --
JSON-only body parsing and a preflighted CORS allow-list -- covered every route that needs
a **body**, and covered nothing that does not. A hidden auto-submitting form reached
`POST /auth/logout`, `/auth/logout-all`, `/auth/refresh`, `/payments/orders`,
`/payments/reconcile` and the two notification read routes with a victim's cookies
attached. SECURITY.md called that "session nuisance", which was true in Milestone 5 and
stopped being true in Milestone 19: it now includes creating a payment order against a
child's account.

A double-submit token was considered and deliberately not stacked on top -- it buys nothing
over an origin check for browser-issued requests, which is the only category CSRF has, and
it would have meant a header change at 610 test call sites and for every future API client.
A request with no `Origin` and no `Referer` is allowed, because a browser always sends one
on an unsafe method and a request that is not from a browser cannot be a forgery. That is
also what keeps Razorpay's server-to-server webhook working, which is verified by HMAC
instead.

### `localhost:5173` is no longer a permitted production origin

It was in the CORS allow-list unconditionally, so the deployed API accepted credentialed
cross-origin requests from any page a visitor happened to be serving on that port of their
own machine -- and it would have counted as an "allowed" origin for the check above. It is
admitted only outside production now. With `FRONTEND_URL` unset the list is empty, which
fails closed; the deployed site is unaffected either way, because the frontend proxies
`/api/*` through a Vercel rewrite and the browser never issues a cross-origin request.

### The public lookups no longer publish a child's full name

`GET /results/:studentId` and `GET /certificates/:studentId` are unauthenticated by design
and keyed on `AMIT_0000`-`AMIT_9999`. They were returning the **full legal name** beside a
score and a national rank, so once results are released they were a walk of the entire roll
-- exactly what the leaderboard was given `displayNameFor()` and an anonymous depth cap to
prevent. Both now publish through that same function, and both are rate limited. A parent
still gets a first name, a last initial, the ID they typed and the marks.

The holder's own certificate is untouched: `GET /me/certificates` and the PDF still carry
the full name and the verification code. The `/certificate` page was pointed at that
authenticated endpoint, which it should always have used -- it had been calling the public
one with its own student ID, and printing the database row id where the certificate serial
belongs.

### The frontend deployment sends security headers

`frontend/vercel.json` sent none at all, so the signed-in SPA could be framed by any site --
the classic pairing with `sameSite: 'none'` cookies. It now sends `X-Frame-Options: DENY`,
CSP `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy` and a narrow
`Permissions-Policy`. Deliberately **only** `frame-ancestors` in the CSP: a `default-src`
policy would have to enumerate Google Fonts, unpkg and Razorpay's checkout, and a CSP
written without a browser to check it against is a broken page rather than a safer one.
`payment=()` is deliberately absent for the same reason -- Razorpay's checkout can use the
Payment Request API.

### Rate limits where a request has a cost or issues a credential

`paymentLimiter` on `POST /payments/orders` and `/payments/reconcile`, the only routes here
where one request spends a third-party API call. `adminActionLimiter` on the staff password
reset, session revocation and account deletion -- the reset **mints a working credential**
for another account, and it had nothing but the general limiter in front of it, which
SECURITY.md had listed as an open gap since Milestone 5. `publicLookupLimiter` on the two
public lookups above. Administrative *reads* are deliberately not limited.

### What was checked and found sound

Recorded so it is not re-derived: the answer-key rules, grading and the timing model, the
reward and ranking engines, the permission table and its fresh database re-check,
`refuseIfProtected()`, the root-superadmin bootstrap, refresh rotation and family
revocation, password storage, every Mongo filter, every magic-byte-validated upload, the
payment signature/ownership/idempotency rules, and the KaTeX text/math split. **No IDOR was
found** -- every owner-scoped route puts the account in the query rather than checking it
afterwards, and every route in `routes/v1/` carries a gate.

### What this pass did not verify

`npm audit` was not run, and nothing was driven through a browser. Both are recorded at the
top of "Remaining Gaps" in [`SECURITY.md`](SECURITY.md) rather than left implied.

## 2026-08-17 - The entry fee buys the Olympiad, not the platform

A same-week reversal of scope, made by the owner, plus the honest failure message that
should have been there from the start.

### Preparation is free again

The fee gated practice, mock tests, the daily challenge and the exam for one day. It now
gates **the official Olympiad and nothing else**. A student practises, rehearses,
answers the daily challenge and reads their own analytics for nothing, and pays Rs.100
only when they decide to compete.

The product is a competition with preparation attached, not a subscription. Gating
preparation also inverted the funnel -- it asked for money before the student had any
evidence the material was worth paying for, which is backwards for a first cohort with
no reputation yet. And it turned every payment problem into a total outage for that
person: with preparation paid, a student whose payment failed could do nothing at all.
Now a failed or postponed payment costs the competition entry and nothing else.

`requireEntry` moved off three routes and stays on `POST /exams/:id/attempt`. Nothing
else about the gate changed -- the derived entitlement, the 402, the ordering ahead of
the resource lookup and the admin console are all as they were.

### Paying later is the normal path, so it is offered where people look

A new entry-fee card on `/profile`, beside the dashboard banner and the `/payment` page.
Both render **nothing** once the fee is paid or when it is switched off: a settled matter
does not need a card, and a "you're all set" panel on a page somebody opens to change
their password is noise.

### "Not available right now. Please try again later." was untrue

That is what the entry fee page said when Razorpay was unconfigured, and waiting fixes
nothing -- it means the credentials are absent from the backend environment. It now says
online payment is not set up yet, states plainly that the student has not been charged
and that everything they need to prepare still works, and -- **for staff only** -- names
`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. The person most likely to meet this while
testing is the person who can fix it, and telling them to wait sends them looking in the
wrong place.

### Tests

836 across 25 files. The gate suite now asserts the free surfaces are **not** gated as
well as that the exam is, in both directions -- a paywall that silently widens would
start charging for things the owner said were free, and nothing else in the codebase
would notice.

## 2026-08-16 - Milestone 19: Payments, and the entry fee that gates the platform

The last planned development milestone. Registration used to show a static QR image and an "I've Paid - Create My Account" button. It recorded no payment, verified nothing, and created the account either way: every student who registered was told something untrue, and the site had no idea whether anyone had paid. That step is gone, and there is a real gateway behind it.

### What the fee buys, and what it costs

**Rs.100, once.** It unlocks practice, mock tests, the daily challenge and a seat at the official Olympiad. Registering, verifying an email, signing in, the dashboard, the leaderboard, rewards and a student's own analytics stay free - a student has to be able to see what they are buying.

The fee is **administrator-editable** at `/admin/payments`, not an environment variable. A price is business configuration, not a credential: in `.env` it would be a redeploy to change, unchangeable by the person who decides it, and would leave no record of who changed it. `RewardSettings` already established the pattern.

**Changing the price never re-prices a captured payment.** `Payment.amount` is a snapshot, the same rule `StudentActivity.xpAwarded` follows.

This knowingly breaks the Rs.0 cost target, which no previous decision had done. Razorpay charges per transaction. It is the owner's call and it is what the fee funds.

### The browser is never believed about money

It cannot say a payment succeeded, how much was paid, or what was bought. `POST /payments/orders` takes **no request body at all** - the amount comes from the settings document and the student from the session token, because a client-supplied amount is how a Rs.100 fee gets paid as Rs.1. Both paths that mark a payment captured verify an HMAC signature computed from a secret only the server holds, compared in constant time.

A valid signature proves a payment is *genuine*, not that it is *yours*, so ownership is checked separately. Without that, a student could verify somebody else's order and hand **them** the entitlement while appearing to have paid.

### The entitlement is derived, never stored

"Has a captured `Payment` with purpose `olympiad_entry`". There is deliberately no `hasPaid` flag on `Student`, for the reason XP, analytics and the leaderboard are all derived - a stored boolean is a second source of truth about money, and when it drifts either somebody who paid is refused or somebody who did not is admitted.

### One gate, mounted rather than called

`middleware/requireEntry.ts` sits on the four gated routes. Routes never call the entitlement check themselves, for the same reason there is one grader and one reward engine: a surface that has to remember to ask will eventually forget, and a forgotten paywall is indistinguishable from a working one until somebody notices the revenue.

It answers **402, not 403**. Those mean different things to the page receiving them - 403 is "you may not, ever" and renders a dead end; 402 is "not yet, and here is the button".

**It runs before the resource is looked up.** The exam's check originally sat inside `startExamAttempt()`, *after* the route's 404 - so an unpaid caller could tell a real exam id from an invented one by the status code. Found by writing the test, fixed by mounting the middleware, and pinned by a regression test. The service check stays as defence in depth.

### Reconciliation in place of a webhook

The owner chose not to configure a webhook secret. That leaves the browser's return journey as the only confirmation, and a browser can be closed, refreshed, or killed by a dropped mobile connection in the second between the money moving and the verify call landing - every one of which leaves Razorpay holding a captured payment this database knows nothing about. The student has paid and received nothing, which is the worst failure this feature has.

So `POST /payments/reconcile` asks Razorpay directly and captures on the same idempotent path, on page load and whenever the modal closes without success. It is strictly *more* trustworthy than a webhook: the answer comes from an authenticated call we initiated rather than an unauthenticated request claiming to be Razorpay. The trade is that it settles when something asks. The webhook route remains fully implemented and works the moment a secret is set.

Only `captured` counts. `authorized` means the money is held but not taken.

### Idempotency

Capture is a conditional update matching only a not-yet-captured row, and it reports whether it won - because the return journey and the webhook routinely arrive in the same second and on serverless land in different invocations, where a read-then-write would let both believe they were first. A duplicate webhook (which Razorpay sends by design) changes nothing, a late `payment.failed` cannot revoke a capture, and a webhook for an order this server never created is acknowledged and dropped rather than creating a payment belonging to nobody.

### The gate is on by default - a same-day reversal, recorded

`entryFeeEnabled` shipped as `false` earlier the same day, after the gate broke nine existing exam tests: switching a paywall on by deploy would have refused entry to every student who could enter yesterday. That argument was right while the fee bought only the exam and nobody had paid. It stopped applying when the owner made the fee the entry condition for the whole platform - a paywall that defaults to off is not a paywall, and every deployment would have had to remember to switch it on.

The switch is kept and matters more now: it is the only answer to a provider outage during an exam window, and to running a cohort free. It stays explicit rather than inferred from the credentials being absent, because "we chose to run this free" and "the keys are missing" must never look the same.

### The console, and the UI

`/admin/payments`: counted totals per status, the collected total, the 100 most recent transactions with Razorpay's own failure text, and the fee with its on/off switch. Reading needs `students:read`; changing the fee needs `students:status:write`, because seeing a price and setting it are different acts. **No new permission was added.**

For students: a dashboard banner naming the real price (fetched, not hardcoded, since an administrator can change it), padlocks on the locked sidebar items, and a panel on each locked page explaining what is behind it rather than a redirect - bouncing somebody out of the page they asked for reads as a bug and hides the thing that makes paying feel worth it.

The entitlement rides on every auth response beside `permissions`, so the UI reads it rather than deriving it. It is presentation only: the server refuses regardless.

### Tests

31 payment tests, 830 total across 25 files. None touch the network. Signatures are **genuine** - computed with the same HMAC the product uses, from a test secret - because a suite that only ever sent a hardcoded fake signature would pass against an implementation that accepted everything, which is precisely the bug that matters.

Most of the file is about refusing things: a forged signature, a signature computed with the wrong secret, somebody else's order, a duplicate webhook, an unknown order, an amount the client tried to choose, and a late failure trying to revoke a capture. The paywall tests assert the refusal on all four surfaces, on both URL prefixes, with the fee on, with it off, and with no settings document at all.

`registerVerifyLogin()` now grants an entry fee by default, because a student exercising practice in production has paid and a test student who cannot practise asserts behaviour no real student reaches. `createAdminSession()` is deliberately unpaid: staff are not entrants, and an administrator with an entry-fee payment against their name would appear in the console's collected total.

### Not done

**No real checkout has been driven through a browser.** No Razorpay credentials exist in this sandbox, so the whole path has only ever run against a fake transport. `ENVIRONMENT_VARIABLES.md` has the numbered steps for getting test keys and the one case worth testing by hand - paying, then closing the tab before the page returns.

**CSRF still does not exist.** `SECURITY.md` said a token should land before payments; it did not. The practical exposure stays narrow - the API parses JSON only and CORS uses a strict allow-list - but it is now an accepted gap rather than a plan.

## 2026-08-15 - Milestone 18: Generated questions need a human before they exist

Milestone 17 asked Gemini for questions and **saved them straight away** as drafts. Defensible - a draft is not student-visible - and the wrong default: the bank filled with machine output nobody had read, and the reviewer's job quietly became "delete the bad ones" instead of "keep the good ones".

### Nothing is saved until it is approved

Generation now returns candidates and writes **no question at all**. They live in the reviewer's browser; a separate, explicit approval call is the only thing that writes. Tests assert the question collection is still empty after generating, which is the property that would otherwise regress silently back into "saved as a draft".

Approval **re-validates from scratch**. That is not belt-and-braces: the review screen is a client, it can send anything, and the examiner has been editing. A test posts a candidate broken by the "edit" and asserts it is refused.

The blank-template generator is **deleted**, fallback included. A placeholder is only useful as something to type into, and keeping it as a fallback meant a spent quota silently produced filler where an examiner expected questions. An unconfigured key now says so (503, naming the variable); a failed provider reports its own words (502, "Quota exceeded...").

### The full configuration the spec asked for

Class, subject, **multiple chapters**, difficulty, question type, **Bloom's level**, **language** (English / Hindi / Hinglish), marks, negative marks, **option count**, and free-text instructions - all reaching the prompt, all asserted by a test. The review screen offers edit, **regenerate one**, **regenerate all**, delete, then *Approve as drafts* or *Approve & publish*.

### Fill in the blanks, and why short answer is absent

A fifth question type, `fill_blank`, marked against author-listed accepted answers with normalisation that forgives capitalisation, spacing and a trailing full stop - and nothing else. No fuzzy matching: a grader that guesses can silently mark a wrong answer right.

**Short answer was deliberately not added.** It cannot be auto-graded, and the only two ways to make it work were a human marking queue (a large feature that changes what a submitted attempt means everywhere) or sending a child's written answer to a model (reversing the privacy line drawn in Milestones 16 and 17). See the ADR.

Adding one type touched the model, validation, the grader, the shared attempt subdocument, **three** snapshot builders, four answer-application paths and every review view. The compiler found them all only because the new key field is non-optional - an optional one would have been missed in two of three builders and produced wrong marks. That near-miss is now a recorded follow-up.

### Duplicate detection, and a log

Candidates are refused when they are 80% or more word-overlap with something already in the chapter or with another candidate in the batch - Jaccard over significant words rather than edit distance, because the failure mode is *rewording with new numbers*, which edit distance scores as far apart. A test pins that a renumbered train-speed question is caught and an unrelated one is not.

A new `GenerationLog` records what was asked, what came back, how many were rejected and why, how long it took, and the provider's error on failure. Counts and parameters only - never question text.

### Verified by 21 new tests (796 total, 24 files)

Nothing touches the network. One pre-existing RBAC test caught a real contract change and now documents it: the audit entry moved to **approval**, because proposing changes nothing and an audit trail full of work that was thrown away is worse than no entry.

## 2026-08-15 — Milestone 17: AI question drafting

The admin "generate questions" button has existed since before Milestone 4. It filled a template string, and the page said so, because calling it AI would have been a lie. It can now be backed by Google Gemini.

### Why this is a different decision from Milestone 16's

Milestone 16 declined an LLM for performance recommendations, and that still stands. Three of its four reasons simply do not apply here:

- Recommendations are questions about **counts**; arithmetic answers them exactly and a model could only paraphrase it while being able to get it wrong. **Drafting a question is writing** — there is nothing to compute, and the alternative is a human typing it from scratch.
- **No student data is sent.** The payload is a subject name, a topic name, a class level, a difficulty and whatever instruction the examiner typed. A test asserts the request body contains no student fields.
- **The MVP still runs with no paid service, identically.** With no key the button behaves exactly as before. AI is an enhancement to a complete feature, not the feature.

The fourth reason — this product already deleted a fake AI feature — governs completely, which is why the naming discipline got *tighter*: `kind` is `'template'` or `'model'`, the page prints which one ran, and the audit trail records it per batch.

### The model's output is not trusted

A language model writing exam questions is safe only because of what happens afterwards, and every link is asserted by a test:

- **The taxonomy comes from the request.** `GeneratedCandidate` has no subject, topic, class or difficulty field, so a model cannot file a question anywhere it was not asked to — structurally, not by a check.
- **Every candidate passes `createQuestionSchema`** — the identical schema a hand-authored question passes, including `validateMathContent()`. There is deliberately no model-specific validator: two would eventually disagree, and the model-facing one would be the weaker.
- **A failure is rejected and reported, never repaired.** A `\href` smuggled into LaTeX, a single-choice question with two correct options, a numeric question carrying options — all discarded with the rule they broke shown on the page. Silently fixing an answer key that looks right is worse than a missing question, because a reviewer skims what looks finished.
- **Everything is a draft.** `createQuestion()` has no other mode, so nothing generated reaches a student without a person publishing it.

### Failure is normal, and handled as such

A spent free-tier quota, a timeout, prose where JSON was asked for, or a reply with 40 questions when 2 were requested — each falls back to blank templates and reports the provider's own words, because "it failed" cannot be acted on while "quota exceeded" can. An examiner who asked for five drafts always gets five.

### Smaller things

`GET /admin/question-generator` lets the page say whether AI is configured *before* the button is pressed. `withOptionKeys` and `toQuestionContent` moved into `questionService.ts`, because the generator became a second producer of question content and two implementations of "the server owns option keys" would be one too many. The key is sent as an `x-goog-api-key` header rather than `?key=`, since a URL is the thing most likely to reach a log line. No SDK — `fetch` against the REST endpoint, so **no new dependency**.

### Verified by 20 new tests (795 total, 24 files)

Nothing touches the network: a test-only transport hook (which throws outside the test environment) is what makes the failure paths testable at all. One pre-existing RBAC test caught a real mistake — an audit metadata key renamed from `count`, which would have split every query over an append-only trail into "before" and "after". The key kept its name.

## 2026-08-15 — Milestone 16: Intelligent performance recommendations

Milestone 15 made a student's performance measurable. It did not tell them what to do about it: the analytics page ended with a weak-areas list and no next step, and the only thing resembling advice in the product's history had been deleted for being invented.

This milestone turns the measurements into five kinds of recommendation — weak topics, strong topics, difficulty guidance, practice suggestions and performance insights — behind an interface a model can be plugged into later.

### Findings are asserted on a confidence interval, not on a percentage

The obvious implementation ranks topics by accuracy and calls the bottom ones weak. On this product's data that is actively misleading. A practice session is ten questions, so a topic's whole sample is often five or six answers, and **2 of 5 (40%) would outrank 30 of 80 (37.5%)** — the first is one bad session, the second is the finding.

So every claim is made against the **95% Wilson score interval** around the accuracy, always from the conservative end: a **weakness** on the interval's **upper** bound ("even read optimistically, still below par"), a **strength** on its **lower** bound. Wilson rather than the textbook normal interval, because the normal one is badly wrong at small `n` and at proportions near 0 or 1 — which is exactly where this data lives.

Two consequences are asserted by tests, and both look like under-reporting until you see why: **a perfect five is not a strength**, and **five wrong answers are not a weakness**. That is what stops one lucky or unlucky session becoming a diagnosis. The flat `MIN_AREA_SAMPLE` floor from Milestone 15 is reused underneath, unchanged and shared, so the weak areas listed on the analytics page and the weak topics recommended beside them cannot be gated by two different numbers.

### Every recommendation cites its evidence, structurally

`basis` is a **required** field carrying the counts, the accuracy and the interval bounds. A recommendation that cannot say what it was derived from cannot be constructed at all — which is the type-level form of the rule that deleted `generateAIInsights()`. The page shows it: every card expands to `Answered 20 · Correct 4 · Likely range 8.1% – 40.9%`. A recommendation the reader cannot check is indistinguishable from one that was made up, and this product shipped invented ones once.

### Advice the product cannot honour is not advice

Every practice recommendation is joined against the **published question bank for the student's own class**, so nothing can suggest a topic with no questions behind it — a student who followed that link would land on an empty picker, which reads as the site being broken rather than as advice being approximate. A weakness in a topic published only for another class is still *reported*, with no link. Deep links (`/practice?subject=&topic=`) are validated by the Practice page against its own loaded options, so a bookmarked link to an archived topic degrades to the ordinary picker.

The difficulty section cannot contradict itself either: if any level is flagged for consolidation, no step-up to a level above it is offered. "Shore up Easy" and "try Hard" in the same breath is not two pieces of advice, it is one incoherent one.

### The engine is a seam, and the default one is not AI

`lib/recommendationTypes.ts` is the whole contract: implement `RecommendationEngine`, register it, set `RECOMMENDATION_ENGINE`. Nothing about the route, the response shape or the page changes. An engine receives a facts object and **cannot query a database** — the same wall the gamification catalogues sit behind, and what makes "cites real counts" enforceable.

An engine also **does not describe itself**. `recommend()` returns content only; the service stamps `engine`, `generatedAt` and `hasData` from the registry entry it actually invoked. A test smuggles all three onto a draft and asserts they are ignored. An engine that throws is caught and the statistical engine answers instead, so a failing model costs one panel rather than the page.

**No AI provider is integrated, and nothing is labelled AI.** Google Gemini was evaluated and deliberately not wired up: the five requested capabilities are questions about counts rather than about language; the data is children's performance records, which is a privacy decision for the owner rather than a technical one; and the MVP must run with no paid service. The default engine declares `kind: 'statistical'` and the page prints "No AI is involved" verbatim. See the three Milestone 16 ADRs.

### Verified by 36 new tests (775 total, 23 files)

Weighted, as the Milestone 15 suite was, toward asserting that a finding is **not** produced: the 2-of-5 versus 30-of-80 case directly, a perfect five that is not a strength, a four-answer topic below the floor, a weakness with no link because the bank cannot serve it, a step-up to a level the bank does not publish, and a trend that refuses to speak from too few sittings. One new env var (`RECOMMENDATION_ENGINE`, defaulted), no new model, no new permission, no new dependency.

## 2026-08-13 — Milestone 15: Performance analytics

The data had been accumulating for nine milestones. Nothing read it.

Four collections hold graded answers — `PracticeSession`, `MockTestAttempt`, `DailyChallengeAttempt` and `ExamAttempt` — each with per-question outcomes, marks and timestamps. The analytics page meanwhile read `StudentAnalytics`, a collection **nothing had ever written**, and told every student their accuracy was "not measured yet".

### `StudentAnalytics` is deleted, not filled in

It was the obvious move and the wrong one. Three reasons it went instead:

- **The wrong shape.** It predated Milestone 4: `studentId` was a plain `String`, and `topicMetrics[].topicName` was **free text** with no reference to the `Topic` collection. A topic rename would have orphaned a student's history, and two subjects with a same-named topic were indistinguishable.
- **A stored breakdown drifts.** That is the argument that already keeps XP, levels, streaks and the leaderboard derived. Analytics over attempts is the same case, and worse: it would have needed invalidating on every submission from four different services.
- **Its `aiInsights` field was a live bug** (known bug #2). `generateAIInsights()` mutated it on every read and never saved, harmless only because the branch was unreachable. Both are gone. Strengths and weaknesses are now derived facts, and nothing in the product claims to be AI.

### Student analytics, all eight things

Accuracy, topic performance, subject performance, difficulty performance, time trends, progress trends, weak areas and strong areas — every one counted from submitted attempts. Only **submitted** ones: an abandoned paper measures nothing, and counting its blanks as wrong answers would libel the student.

Three rules the service is built around, each with a test:

- **Raw counts are summed; percentages are computed last.** Every aggregation returns `served / answered / correct / marksAwarded / marksAvailable` and never a percentage, so rolling a topic up from per-surface rows is addition. Combining `1/1` in practice with `1/9` on a mock gives **20%** — the average of the two percentages would be 55.6%, which would tell a struggling student they are better than half right.
- **`null` is not `0`.** An accuracy with nothing behind it is null. "Has answered nothing" and "gets everything wrong" are different facts about a child, and the frontend renders the two differently.
- **A weak area needs a sample.** One wrong answer in a topic is noise, and presenting it as a diagnosis is a fabricated conclusion drawn from real data — the same sin as a fabricated number. Five answers minimum, reported to the client so an empty list can explain itself.

### What the data could not answer, and was not made up

**There is no per-question time.** No collection stores one — `answeredAt` is a timestamp, not a duration, and a student may answer in any order. So the pace trend is per *attempt*: the sitting's real duration divided by its real question count, labelled as such. The **daily challenge has no clock at all**, so it contributes to accuracy and progress and is **absent** from pace rather than being given an invented duration; the page says so.

### Admin: the questions that are not working

**Question performance** is the view staff did not have. A question nobody gets right is usually mis-keyed or mis-tagged rather than genuinely hard, and until now the only way to find one was for a student to complain. Hardest-first by default, with a **skip rate** beside the accuracy — a mostly-skipped question is a differently-broken question from a mostly-wrong one.

A `minAnswered` floor keeps a single wrong answer from topping the list for ever. It is a parameter rather than a constant, and the value in force comes back with the result.

**Test performance** compares papers, where `testResults()` only ever showed one at a time. Each row carries a **median** alongside the mean, because on a cohort of a few dozen one blank submission moves the mean several points — exactly the case an invigilator wants to see rather than have smoothed away. `kind` marks every row, so a rehearsal can never read as the Olympiad.

The Milestone 12 platform metrics — accounts, engagement, content counts, XP — were **already real and were not rebuilt**.

### Efficient by construction

**One faceted aggregation per collection, not one per facet.** Grouping on the composite `{topic, subject, difficulty, type}` key means all four breakdowns are sums over rows already in memory. Eight operations per page load, all indexed by `student`, all parallel. The `$lookup` projects three fields — without that inner pipeline it drags every question's text, options and **answer key** through the pipeline for every answer ever given.

### Three indexes, one of them overdue

- **`ExamAttempt {student, status, submittedAt}`** — this collection had **no index on `student` at all**. The unique `{exam, student}` index cannot serve a query naming a student without an exam, so every "everything this student has sat" read was a full collection scan. The dashboard's exam panel took the same path.
- **`MockTestAttempt`** and **`PracticeSession`**, same key: the existing indexes narrow correctly but sort by *start* time, which for a session left open overnight is a genuinely different order from submission.

### Also

- `answeredAt` turns out to be the **stored materialisation of `isAnswered()`** — every write path sets it as `isAnswered(entry) ? now : null`, including on a cleared answer. The aggregations read it rather than re-deriving the per-type rule, which would have been a second grader by another name. A test pins that its count agrees with the attempt's own `unansweredCount`.
- `isCorrect` is **three-valued** on a stored entry: `true`, `false`, or `null` for unanswered. `$ne: false` would have counted every blank as correct.
- **Grading reads the snapshot; analytics joins the live taxonomy.** A mark is a historical fact about one paper. "How am I doing in Trigonometry?" is a question about the taxonomy as it stands now. The cost — recategorising moves history, deleting drops it — is in the ADR, and a deleted question is surfaced rather than hidden.
- **23 models** (one removed), no new permissions, no new environment variables. **32 new tests** (739 total, 22 files), all seeded with declared outcomes so each asserts an exact figure rather than merely that a number exists.

## 2026-08-13 — Milestone 14: The notification system

An audit first, because Milestone 12 had already built half of this. In-app notifications, unread/read state, notification history and staff-written announcements were **real, tested and left alone** — one document with an audience rule, an inbox that evaluates that rule at read time, read receipts in their own collection with a unique index. Rebuilding any of it would have produced a second set of routes to keep in step.

What Milestone 12 openly left out was everything to do with *delivery* and *automation*, and that is this milestone.

### The thing that was actually broken

`sendEmail()` was **awaited inline** in registration and in forgot-password, and it **swallowed delivery failures**. Two consequences, both real and both invisible:

- A registering student's request sat waiting on a third-party SMTP handshake.
- When that handshake failed, the verification link was **destroyed**. No record, no retry, one log line. Since login requires verification, a lost link is an account that can never be used — and nobody could find out, because there was nothing to look at.

There was also a subtler version of the first problem: `forgot-password` returns a deliberately identical message for a known and an unknown address, so that it cannot be used to enumerate accounts. But it only did that in *wording*. Awaiting a real SMTP round trip for an address that exists, and skipping it for one that does not, made the endpoint a **timing oracle** for exactly the fact the identical message was there to hide.

### `EmailOutbox`: persist first, deliver after

Every outbound message is now written to a collection **before** anything tries to send it. The request does one indexed insert and returns. Delivery happens outside the request and is retried from the row, because the row is still there to retry from.

`deliverEmail()` replaces `sendEmail()` and **throws** when delivery fails. That single change is what makes the queue possible: a worker that cannot detect failure is not a worker. Only the outbox service may call it.

**There is no `sending` status.** A row is claimed by pushing `nextAttemptAt` into the future and incrementing `attempts` in one conditional write — a visibility timeout, not a state change. A `sending` state would become a lie the moment a serverless container is frozen mid-send: the row would sit there for ever with nothing to move it. With a timeout, a crashed attempt simply becomes due again. The honest cost is **at-least-once** delivery, and that is the right trade: a duplicate "your results are out" is an annoyance, a missing one is a student who never found out.

**Delivery is driven two ways, because the free tier has no scheduler.** An opportunistic kick when a message is queued (started, never awaited), plus a lazy sweep on later requests — the same pattern the codebase already uses for expired mock-test and exam attempts. Neither is a deadline, so `drainOutbox()` is *also* exposed to staff as an explicit "Send queued now" rather than hidden. A queue that only drains when somebody visits the site is not a promise an organiser can make to a parent.

### System notifications

Before this, the platform never told a student anything on its own — every notification was typed by a human. Six real events now produce one:

| Event | Who | Emailed? |
|---|---|---|
| Official exam published | the class | no |
| **Official exam results released** | each candidate | **yes** |
| Mock test published | the class | no |
| Account status changed | that student | yes (security) |
| Account role changed | that student | yes (security) |
| Password changed | that student | yes (security) |

The two broadcasts are deliberately **not** emailed: mailing a whole class every time staff publish practice material is exactly the free-tier deliverability problem Milestone 12 declined to create, and the inbox and the bell already carry it.

`Notification` gained a third audience, `student`, which **staff cannot address** — it is absent from the composer's schema rather than rejected by the handler. A per-student notice carries a score, a rank and a certificate tier, so a filter that leaked one row across the class boundary would be a disclosure bug rather than a display bug. There is a test for it, using two students in the *same* class so that the audience clause is what is under test.

**Results and certificates produce one notification, not two.** A certificate can only be issued by releasing results, so a separate "your certificate is ready" would always arrive in the same second — twice the free-tier email budget for a worse experience, and it invites "did I get two results?". The notice is also built by **reading back the `Result` rows that were actually written**, not from a list the caller passed in, so what a student is told matches what the portal will show them when they follow the link.

Every system notice an administrator can trigger twice carries a **partial-unique `dedupeKey`** — the same idiom as `StudentActivity`'s once-per-day index. Releasing results is idempotent by design; without this, a nervous administrator clicking twice tells the whole cohort their results are out twice.

### Preferences, and what deliberately cannot be switched off

Two switchable email streams: **announcements** and **results**. Two that are not: **transactional** (verification and reset links — the mechanism of using the account) and **security** (password and status changes).

That asymmetry is the design, not an omission. "You may switch off the warning that your password was changed" is a setting that only ever helps an attacker. Rather than quietly offering two toggles and leaving the reader to wonder, the API returns the non-optional categories **with their reasons** and the page prints them.

**Preferences control email only, never the in-app inbox.** Everything is always written. Suppressing rows at write time would make "unread" and "never delivered" indistinguishable, and a notice board a student can empty is not a record. Declining an email never costs you the message.

There is deliberately no `certificates` preference: nothing sends that stream on its own, and a switch that does nothing is worse than a shorter list.

### Emailing a broadcast is opt-in, capped, and honest about it

Staff may tick "also send this by email" per announcement. Unchecked by default, and reset after every send, so the Milestone 12 reasoning is not quietly undone. Recipients who opted out are **counted and reported** — "60 queued, 12 skipped" — because staff who see "0 queued" with no explanation will reasonably conclude it is broken and send it again.

### Making failure visible

A new `/admin/email-deliveries` console: every message with its status, attempt count and **the provider's own error text**, plus counted statistics and "send now" / "requeue failed" actions. `oldestPendingAt` is included because a pending count alone cannot answer "is the queue stuck?" — three queued messages is healthy if they arrived a second ago and a problem if the oldest has waited since Tuesday. The subject is listed; the body never is.

### Also

- **Free-tier email needs no new dependency and no new environment variable.** The transport was already provider-agnostic SMTP, so Brevo, Resend, SendGrid, a Gmail app password or Mailtrap all work through the existing `SMTP_*` vars. `ENVIRONMENT_VARIABLES.md` now names the free tiers and their limits.
- The mark-as-read route was **hand-writing** its own audience comparison. It was correct for the two audiences that existed and would have silently refused every per-student notification this milestone added. It now composes `inboxFilter()` through `isVisibleTo()`, so the inbox, the unread count and the read check cannot disagree about what a student may see.
- A `system` notification **cannot be edited** (409). Editing the text of a record of something that happened would turn it into a claim about something that did not, and would then disagree with the email already delivered from it. Deleting one is still allowed — housekeeping is not falsification.
- The admin announcement list **defaults to the staff stream**. Releasing one national exam's results writes a system row per candidate, so listing both by default would bury the handful of announcements the page exists to manage. `?source=all` gives the combined view.
- **One new model** (`EmailOutbox`), taking the total to **24**. **No new permissions** — the console reuses `notifications:write`.
- **46 new tests** (707 total, 21 files), most of them making delivery fail on purpose: a request that succeeds anyway, a message retried rather than lost, a *recovered* provider that actually delivers, a terminal give-up that stays visible, two concurrent drains that cannot double-send, and a dead provider that does not turn `forgot-password` into an enumeration oracle.

## 2026-08-13 — Milestone 13: The official exam, and the certificate system

Certificates were the ask. The official exam was the precondition — and it did not exist.

Milestone 12 had recorded exactly why: `ExamAttempt` and `Result` were read by the product and **written by nothing**, so a certificate system built on them could never issue anything. Building certificates first would have shipped an inert surface, which is the trap that milestone explicitly avoided. So this milestone builds the sitting, then the certificates on top of it.

### The official Olympiad is its own thing

A new `Exam` collection, not a `MockTest` with `maxAttempts: 1`. That distinction is load-bearing rather than tidy: as a flag, every mock test would be one settings change away from minting certificates, and the rule that a mock is not the exam would live only in a comment.

Three things differ from a mock test by design:

- **The window is mandatory.** `MockTest.availableFrom`/`availableTo` are nullable, meaning "as soon as published" and "open indefinitely". For an official sitting both are required: the organisers announce the timeline in advance, so an exam with no window is not an exam. `deadlineFor()` takes the sooner of the duration and the close, so starting five minutes before the window shuts gives five minutes.
- **One attempt, ever** — enforced by a **unique index** on `{exam, student}`, not by counting. On a serverless platform a read and its write can land in different invocations, so "count the attempts, then insert" has a race a unique index does not.
- **Submitting reveals no score.** A score exists the moment a paper is graded, but a *result* is an announcement. Ranks cannot be computed until the window has closed and everybody who is going to sit has sat, and the organisers decide when to release them.

`ExamAttempt` and `Result` were both **rewritten**. The old shapes predated Milestone 4: `studentId` was a plain string, `answers` was `{ questionId, selectedOption }`, and there was **no answer-key snapshot at all** — a shape the current grader cannot mark, and that cannot survive a question being edited after a paper was served. Neither had ever been written, so there was nothing to migrate. `snapshotOf()` moved to `services/attemptSnapshot.ts` so mock tests and the exam share one snapshot: two copies is how one of them ends up missing a key field, and a missing key field is a wrong mark on a student's report.

### Releasing results

One administrative act computes ranks and mints certificates together, because a result without a certificate — or a certificate without a published result — is a state nothing in the product knows how to describe.

It **sweeps expired attempts first**, so a paper somebody abandoned is graded and ranked rather than silently excluded, which would otherwise flatter everybody else's position. **Equal scores share a rank** (1, 2, 2, 4), the same rule the leaderboard uses: two students who scored identically did not finish one ahead of the other. And it is **idempotent** — re-running recomputes ranks and updates the same rows, while the unique index on `{student, exam}` means nobody gets a second certificate.

Publishing while the window is still open is refused. Ranks are a cohort fact, and publishing early would rank a student against whoever happened to finish first.

### Certificates come from the exam and nowhere else

**There is no issuance endpoint.** Not for a student, not for an administrator. That is what answers the brief's "do not allow the frontend to manufacture certificate eligibility" — the frontend cannot, because it is never asked, and neither can a human. A test walks the plausible paths (`POST /admin/certificates`, `/me/certificates`, `/certificates`) and confirms none of them exists, and another confirms that earning on mock tests, practice and the daily challenge yields nothing.

Tiers are **participation / merit / distinction** from **per-exam** thresholds, because papers differ in difficulty and 60% on one is not 60% on another. Everyone who submitted gets Participation: sitting a national olympiad is itself the qualification, and excluding low scorers would empty most students' libraries.

**Everything printable is snapshotted at issuance**, and the PDF is rendered from that snapshot alone. This is the detail that makes a certificate trustworthy: rendered from live joins, correcting a spelling in a student's name would silently reissue every certificate they hold with different text, and re-tuning a threshold would change what a two-year-old certificate claims the holder achieved. Worse, verification would confirm a document that no longer matches the one in somebody's hand.

### Two identifiers, and why

`certificateId` is a readable serial (`AMIT-CERT-2026-000123`), printed prominently and **guessable by design** — it is a reference, not a secret.

`verificationCode` is 16 symbols of `crypto` randomness (~80 bits), and it is what public verification keys on. Keeping them apart is what stops verification becoming an **enumeration oracle**: anybody noticing that certificates are numbered sequentially could otherwise walk the serials and harvest the name, school and rank of every entrant. The code's alphabet omits `0`/`O` and `1`/`I`/`L`, because it gets read off paper and typed by hand, and a misread code makes a genuine certificate look forged.

### The PDF

`pdf-lib` — one free MIT package, pure JavaScript, no native binary and no headless browser, so it runs inside a Vercel serverless function on the free tier. The ₹0 constraint ruled out both a rendering service and Puppeteer's ~300 MB Chromium.

The **gold founder signature** is Times italic in `#D4AF37` rather than an embedded script font, avoiding another licensed binary in the repository. The **AMIT OLYMPIAD seal is drawn from primitives** — concentric rings, a ring of impression marks, and centred text — so there is no image asset to lose, nothing to go stale, and it stays crisp at any scale where a small embedded PNG would not.

### Verification, and revocation that tells the truth

`GET /verify/:code` is **public and unauthenticated**: the whole point is that a school, a parent or an employer can check a document without an account. Codes are accepted with or without dashes and in any case.

A **revoked** certificate reports as *revoked, with its details* — never as "not found". A printed copy exists in the world whatever the database says, and telling its holder it never existed reads as a system fault rather than as a decision somebody made. So revocation keeps the row, requires a reason, and blocks further downloads.

### Also

- Two new permissions, `exam:write` and `certificates:write`, taking the table to **21** (3 student / 19 admin / 21 super admin). **23 models.**
- The dashboard's exam panel and the public result portal are **real** at last. Both had been written as live queries against empty collections rather than hardcoded empties, specifically so they would start working the moment exam submission existed. They did, and were updated to the new shapes in the same change.
- `/exam` used to redirect to the Practice Zone, because the old page was a practice paper with no marking. It is now the official exam.
- **50 new tests** (661 total, 20 files), weighted toward the ways this goes quietly wrong: an answer accepted after the deadline, a second attempt, a score visible before release, a mock test earning a certificate, a forged code leaking details, a revoked certificate still downloadable, and authorization on **both** URL prefixes.

## 2026-08-13 — Milestone 12: Complete Admin Platform

An audit first, because the brief asked for fourteen areas and **eight already existed**. Rebuilding them would have produced duplicate routes and a second set of pages to keep in step. So the audit is the first deliverable, and it is recorded in `FEATURE_STATUS.md`: the dashboard, student management, question bank, daily challenge, mock tests, audit log, taxonomy and reward settings were already real and were left alone.

### What was actually missing

| Area | Before | Now |
|---|---|---|
| Gallery | did not exist anywhere | public page + admin CRUD, images in MongoDB |
| Notifications | did not exist anywhere | staff composer + student inbox with read state |
| Analytics | per-student only | platform-wide, every figure counted |
| Leaderboards | public only, names masked | admin board with real names and status |
| Badges/achievements | student-facing only | holder counts per achievement |
| Results, certificates | empty by design | **still empty, deliberately** — see below |

Two new permissions, `gallery:write` and `notifications:write`, taking the table to **19** (3 student / 17 admin / 19 super admin). Three new models: `GalleryItem`, `Notification`, `NotificationRead`.

### Results and certificates are still unbuilt, on purpose

`Result` and `ExamAttempt` are read by the product and written by **nothing** — they belong to the official sitting, which has never been built. An administrative console over them would be permanently empty at best, and at worst would recreate the failure this repository has already paid for once: the Milestone 5 follow-up pass existed to delete a result portal that hashed a typed student ID into a score, and a certificate page that printed "For outstanding participation and achievement" for anybody signed in, dated today.

Issuing certificates against real mock-test performance was offered and was the strongest alternative. The owner chose to wait for the official exam, so that a certificate means what its wording claims. The analytics page says all of this in plain words rather than showing an empty panel, and draws its assessment figures from mock tests, practice sessions and daily challenges — which are real.

### Every figure is counted, and where it cannot be, it says so

`platformAnalyticsService.ts` is the one place platform figures are assembled, and it has no estimates, no projections and no "engagement score". Two details carry the rule:

- **`null`, not `0`, for an average that does not exist yet.** `mockAveragePercent` is `null` until a paper has been sat, because 0% would read as "everybody scored nothing".
- **`holders: null` where a count would be a lie.** The rewards overview counts achievement holders exactly for "did X", "earned N XP", "reached level N" and "active on N days" — but a *consecutive-day streak* cannot be answered by an aggregation, because "answered five challenges" and "answered on five consecutive days" are different facts. Those report `null` and the page shows "not counted" rather than a plausible wrong number.

### Two bugs found by running the page, not by a test

Both are now pinned by regression tests, and both were invisible to a suite that only asserted a number was present:

- **`shiftDay(key, n)` returns the key `n` days *before* `key`** — a negative value moves forward. The 7- and 30-day active windows had been computed with the sign inverted, producing a future cut-off that matched nothing, so both read **zero** however busy the platform was.
- **`distinct('student')` over the activity log reported 12 active students against 11 registered.** The log outlives the accounts it points at, so a deleted account's rows still counted as somebody. Active counts now join to `students` and filter to entrants like every other figure on the page — which is what makes the numbers a consistent set rather than several unrelated counts.

### Notifications: one document, an audience rule, no fan-out

A notification is **one document** carrying a rule (`all`, or a single class); each student's inbox is that rule evaluated at read time. Publishing to the whole roll writes one document rather than thousands, and a student who registers tomorrow sees the announcement written today — which a publish-time fan-out would silently get wrong.

Read state is therefore its own collection with a unique index on `{student, notification}`, which is what makes "mark as read" idempotent against a double-tapped button or two open tabs. "Unread" is an **anti-join**, and `listInbox()` and `unreadCount()` share one `inboxFilter()` so the number on the bell cannot disagree with the list. Deleting an announcement deletes its receipts too — a receipt pointing at nothing would skew that anti-join for everybody who had read it.

A notification a student may not see returns **404, not 403**: the route must not confirm that an id it will not show nevertheless exists.

### Gallery: the only thing published to the open internet

Which is why it holds its own permission rather than riding on `questions:write` — a mistake there is visible to anybody. Uploads reuse a **shared** `imageDataUrl()` validator, extracted from `authSchemas.ts` so registration and the gallery have exactly one magic-byte check between them. That mattered more than the deduplication: a second copy is how one of them ends up trusting a declared MIME type, which is the hole the check exists to close.

Images live in MongoDB at up to **1 MB** each, `select: false` so a listing never drags bytes into memory, and archiving stops the **bytes** being served rather than merely hiding the row. The storage ceiling is written down rather than discovered: this is the second tenant of a 512 MB free tier after registration photos, and a hundred photos is a fifth of it.

### Also

- **43 new tests** (611 total, 19 files). Every new route's authorization is asserted for a guest *and* a student, on **both** the `/api/v1` and `/api` prefixes — a gate that holds on one and not the other is not a gate.
- Pagination and literal, regex-escaped filtering on every new listing.
- The frontend `AuditAction` union was missing the three Milestone 11 actions, so the audit page rendered raw codes for them. Fixed, along with the two new ones.

## 2026-08-13 — Milestone 11: Account administration, and a real super-admin account

Two things at once: a set of powers the competition desk actually needs, and the reversal of a decision that had been quietly costing the product everything an account normally gets.

### The super administrator is now an account

Until now the root administrator was a pure environment identity with **no database document**. That kept the bootstrap simple and paid for it five times over. With no document there was no refresh token, so the session could not rotate, could not be revoked, and simply died after eight hours with nothing to renew it — which is what the owner reported as "my superadmin privileges are not working". There was no `tokenVersion`, so a leaked root token was good until expiry and could only be withdrawn by editing an environment variable and redeploying. Its audit entries carried no `actor` id, so "everything the super admin ever did" was a string match on an email. It could not appear in `/admin/users`, so the most privileged identity in the product was the only one nobody could see. And it had no password of its own, so rotating the credential meant a redeploy.

Every one of those was the same missing row. It now has one.

`ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` remain the bootstrap **seed, not the ongoing source of truth**: the first sign-in provisions a `Student` document with `role: 'superadmin'`, and from then on authentication runs against that document — through `authenticateAccount()`, the same single password check the ordinary login uses, so lockout, status and verification apply to it like anybody else. It gets the ordinary 15-minute access token and a rotating refresh token. `ADMIN_TOKEN_TTL`, the `root: true` claim, and the role-check exemption in `resolveCurrentRole()` are all gone: **every** caller's role is now re-read from the database on a privileged request.

Provisioning is where the danger was, and it is closed in two places. `resolveRootSuperadmin()` adopts an existing document **only** if it already holds `superadmin` — it never upgrades a student who happens to hold the address — and registration refuses `ADMIN_EMAIL` outright. Without both halves, anyone who learned the configured address could register it before the first administrative sign-in and then authenticate with their own password to be handed the role.

Two consequences worth stating because they are not obvious. The super admin **earns no XP**: `grantReward()` refuses it, because XP is derived from `StudentActivity` and every leaderboard aggregates that same log, so one daily-visit row would place a staff account on a *public* board above the children who competed. And `getAdminStats()` excludes it from student counts — it never registered for anything, and "accounts registered" is a headline figure.

### Staff are not entrants, in two concrete ways

**The bootstrap account holds a staff identifier**, `ADMIN_xxxx`, not `AMIT_xxxx`. The competitor numbering is only four digits — ten thousand of them — and it is the number a child writes on an exam paper, quotes from their registration email and types into the public result portal. Spending one on a member of staff would be wrong twice: it consumes a scarce entrant number, and it makes the account read as a competitor everywhere an ID is shown or searched. Path params accept both namespaces on purpose, so addressing the super admin reaches the guard and gets the true answer ("not managed through the API") rather than a format complaint about a perfectly well-formed id.

**It cannot sign in at the student login.** `POST /auth/login` refuses `role: 'superadmin'` with a 403 pointing at the administrator portal. It has no class, no school and no photo, so a student session would drop it into a dashboard built for a competitor — and the public login form is the most-attacked surface in the product, which is not where the most privileged account should be reachable. A *promoted* admin is unaffected: it genuinely is a student who was given extra capability, and `/auth/login` is its normal way in.

The refusal is applied **after** the password is verified, and that ordering is load-bearing. Refusing earlier would answer differently for the administrator's address than for any other — an account-enumeration oracle aimed straight at the most privileged account. Someone who does not already know the password gets the same generic failure as for any other wrong guess, and no session is established either way.

### What each role can now do

| | admin | super admin |
|---|---|---|
| Read and search every account | yes | yes |
| Activate / suspend / **block** / deactivate | students only | anyone |
| Reset a password (temporary, one-time) | students only | anyone |
| Force sign-out on every device | students only | anyone |
| Grant or revoke `admin` | — | **yes** |
| Delete an account | — | **yes** (unverified only) |

`SUPERADMIN_PERMISSIONS` is now defined as `[...ADMIN_PERMISSIONS, ...SUPERADMIN_ONLY_PERMISSIONS]`, so "an admin can never do more than a super admin" is structural rather than a convention two lists have to keep agreeing on. **17 permissions**: 3 for a student, 15 for an admin, all 17 for a super admin.

The line is drawn at **reversibility**. Everything an admin may do can be undone; the two withheld capabilities cannot. A role assignment can mint another administrator, and a deletion is final.

A permission gate answers "may you do this action", not "may you do it to *this* account", so `refuseIfProtected()` answers the second question in one place: nobody may manage the super admin, and an ordinary admin may only act on plain student accounts. Without the second rule, an admin holding `users:password:reset` could issue themselves a working credential for a peer.

### `blocked`, as its own status

`ACCOUNT_STATUSES` is now `active` / `suspended` / `blocked` / `deactivated`. All three non-active values bar sign-in — every gate in the codebase is written `!== 'active'`, so adding one barred it everywhere at once — and they stay distinct because the audit trail has to be able to say *which*, a year later, when somebody asks. A suspension is a temporary hold, a block is a ban, a deactivation is a closed account rather than one in trouble. The picker in the admin UI spells the difference out where the choice is made, rather than in documentation nobody has open.

### Password reset by temporary password

Staff click **Reset password** and are shown a 16-character generated password **once**. It is never stored in readable form and is deliberately absent from the audit entry — the trail records that a reset happened and who did it, which is the part that matters afterwards, and a test asserts the password itself does not appear. The alphabet omits `0`/`O` and `1`/`l`/`I`, because a password misread over the phone gets replaced by a shared one.

Every session for the account is revoked first: a reset exists because control is in doubt. `mustChangePassword` then holds the whole application on a forced-change screen — placed outside the router deliberately, since as a route it would be one URL among many that anything typed into the address bar could step around. The flag clears in exactly one place, the change-password route, so it cannot be dismissed by anything except actually changing the password.

An emailed reset link was the alternative and was considered seriously. The owner chose the temporary password because the entrants are schoolchildren who often cannot reach the address they registered with, which is exactly when they need help most. The trade is recorded in `SECURITY.md`: the forced-change screen is a *user-interface* gate, not a security boundary.

### Also

- **Force sign-out** (`POST /admin/users/:studentId/revoke-sessions`) — ends every session and nothing else. Separate from suspension precisely so it does not mark the account as being in any trouble.
- **Deletion refuses a verified account** (409, pointing at deactivation). Login is gated on verification, so an unverified account cannot have sat a paper, earned XP or appeared on a board: what this destroys is an abandoned registration, not a competitor's history. It also asks the caller to retype the account's own `AMIT_xxxx` — not authorization, which already happened, but a guard against acting on the wrong row.
- Three new audit actions: `user.password.reset`, `user.sessions.revoked`, `user.deleted`. The last denormalises the account's identifiers into the entry, because afterwards there is no document left to join against.
- **27 new tests** (`accountManagement.test.ts`), taking the suite to **566**. Eight existing tests changed to assert the new behaviour — the super admin now has a dashboard, a profile, a standing of zero, and can change its own password, all of which used to be 404s.

## 2026-08-13 — Fix: a promoted admin could not sign in at the admin portal

Reported from production: a super admin promoted a student to `admin` — the badge and status were right in `/admin/users` — but that person was then told **"Invalid admin credentials"** at `/admin`, with a password that still worked on the home page.

Nothing was wrong with the account, the promotion, or the permission table. The two administrative identities authenticate against **different endpoints**, and the portal only posted to one of them:

- the **root** super admin exists only in the environment, has no database record, and signs in at `POST /auth/admin/login`;
- a **promoted** admin is an ordinary `Student` carrying `role: 'admin'`, and signs in at the normal `POST /auth/login`.

`/auth/admin/login` compares the submitted address against `ADMIN_EMAIL` and nothing else, so it refuses every promoted admin — correctly, but with a message that reads as a broken account rather than as the wrong door. The only signpost was a line of hint text under the form, and hint text is not a mechanism.

`adminLogin()` in `AuthContext` now tries the root endpoint and, **on a 401 specifically**, falls back to the ordinary login with the typed value as `identifier` — which accepts an email or a mobile number, so a promoted admin can use whichever they use elsewhere. One form serves both identities.

**The backend did not change.** There is still exactly one authentication path per identity: the root endpoint still accepts nothing but the environment credentials, and the fallback reuses `/auth/login` exactly as it is, inheriting lockout, verification, rotation and the account's failed-login counter. Folding student authentication into the admin endpoint would have meant a second copy of all of that, and two authentication paths eventually disagree.

The fallback cannot become a bypass. `/auth/login` answers a wrong password the same way for an administrator as for anybody else, and returns the same generic failure for an unknown account as for a wrong one — so trying the root address first leaks nothing about whether it exists. An account that turns out to hold no administrative permission simply lands on the portal's existing "this area is for administrators" state.

Also fixed alongside it: `/auth/admin/login` was missing from `NO_REFRESH_PATHS` in `api/client.ts`. A 401 there means "wrong credentials", not "your token aged out", so the refresh-and-replay cycle could never help — it just fired a pointless `/auth/refresh` and spent a second login attempt against the rate limiter. That stray refresh was visible in the reported console log.

Four tests in `rbac.test.ts` pin the contract the fallback reads, the most important being that the refusal is a **401** — were it to become a 403, every promoted admin would be silently stranded again. Verified live against a local database: `POST /auth/admin/login → 401` followed immediately by `POST /auth/login → 200`, landing on the admin dashboard with `students:read`, `questions:write` and `challenges:write`, and still correctly without `users:role:write`.

## 2026-08-13 — Milestone 10: Leaderboards and Hall of Fame

The leaderboard has been real since Milestone 5 — one board, overall, all-time, top ten. This milestone turned a figure on the dashboard into a **feature**: boards that can be scoped to a class and to a period, paginated, with a stated tie-breaking rule, plus a Hall of Fame built from genuine achievement rather than a second copy of the XP ranking.

### One ranking service

`services/leaderboardService.ts` is now the only place a rank is decided. The ranking code moved out of `progressService.ts`, which had grown it as a corner of "the dashboard's figures".

Every standing in the product — the landing page's champions, the dashboard's rank tile, the `/leaderboard` page's class and period boards, and the Hall of Fame's XP board — comes from the same pipeline with the same ordering. Two ranking implementations would eventually disagree, and a rank that disagrees with itself on two pages is worse than no rank.

Still **nothing is stored**. This extends the Milestone 5 decision rather than revisiting it: there is no `Leaderboard` collection and no materialised standing. A board is an aggregation over `StudentActivity` — the same log XP, levels and streaks come from — so a leaderboard cannot drift from the totals it claims to rank, because it *is* those totals. Scopes and periods are filters on that one pipeline, not stored variants.

### Scopes and periods

- **Overall** and **per class** (the ten offered classes). A class board ranks *within* the class: the Class 9 leader is #1 there even if they are #6 overall.
- **All time**, **last 30 days**, **last 7 days** and **today**. A period board ranks on XP earned *inside* the window, so a student with 5,000 lifetime XP and a quiet week does not sit above someone who earned 300 this morning.
- Periods are **competition days** (`lib/competitionDay.ts`), not rolling 24-hour windows, so everybody's week begins and ends at the same instant regardless of where their browser thinks it is — and a window becomes a `$gte` on the day key an activity row already carries.

### Deterministic tie-breaking, stated rather than assumed

Two students on the same XP hold the **same rank** — standard competition ranking, so a board reads 1, 2, 2, 4. Sharing is the honest answer: they earned the same amount, and inventing a winner between them would be a fabricated distinction.

Listing them still needs an order, and it is now a **total** one:

1. XP, descending.
2. **Who reached the total first**, ascending. Of two students on 300 XP, the one who got there yesterday is listed above the one who got there this morning — the only tie-break with a defensible meaning. Sorting by name would advantage the alphabet.
3. The account id, ascending — unique, so the same query always returns the same sequence.

The third key is not decoration: without a final unique key, pagination can show a row on two pages or on none.

### Pagination, and the ranks that survive it

Rank is *position in the full ordering*, not position in the page, and equal XP shares a rank. Both survive paging without loading the whole board:

- The **first** row's rank is one plus the number of students strictly ahead on XP. It is the only row whose rank cannot be derived from the page, precisely because a tie may straddle the boundary — the row above it might hold the same XP and share its rank, which counting-ahead gets right where `skip + 1` does not.
- Every **later** row either has less XP than the row above (rank = absolute position) or the same (rank inherited).

Three aggregations per page and no `$setWindowFields`, which would tie the correctness of a student's rank to the MongoDB server version underneath it. A test asserts a tie split across a page boundary keeps its shared rank, and that three pages read separately equal the whole board read at once.

### The value ranked is the server's

No request may state an XP total, a score or a rank. The entire input surface is a scope, a class, a period and a page — those fields are not filtered out by the handler, they are **absent from the zod schema**, and `validate()` replaces the query with the parse result. A test sends `?xp=999999&rank=1&displayName=Hacker` and asserts the row still reports what the activity log holds, and that the endpoint has no write surface at all.

### The public depth cap

Before pagination, "cannot be walked to enumerate the roll" was guaranteed by the 50-row cap on a single request. Pagination removes that guarantee by itself — fifty rows at a time, repeatedly, is the whole list — so the property is restored explicitly: a **signed-out** visitor may reach the top 100, and a **signed-in** student may page the whole board, which is a list they are already part of and need in order to find themselves. The entrants are minors and the page is indexable; that asymmetry is the point.

This needed `attachUserIfPresent`, a middleware that attaches claims when a session is present and never rejects. It grants nothing and is not a gate — it exists so one public endpoint can differ in *content* for a signed-in caller rather than being duplicated as a second, authenticated ranking surface.

### Hall of Fame — genuine achievement, not a second XP board

`services/hallOfFameService.ts`, five boards measuring five different things. XP measures participation more than ability (known bugs #16, #23, #29), so a hall of fame that only re-ranked XP would be the leaderboard with a nicer heading. Three of the five are about how *well* somebody did:

- **XP champions** — the leaderboard's own first page, reused rather than re-derived so the two cannot disagree.
- **Best papers** — the highest-scoring mock test anybody has sat, as a **percentage** of the paper. Percentage rather than raw score because 40/40 on a quiz and 40/80 on a final are not the same feat. Only papers scoring above zero appear: negative marking makes 0% reachable, and "0% of the paper" is not an achievement.
- **Streak legends** — the longest run of consecutive days, `longest` and never `current`, so a broken streak cannot withdraw something a student really did. Computed by the same `summariseStreak()` the dashboard uses, so the honoured number and the student's own page cannot disagree. A single day is not a streak; two is the minimum.
- **Challenge champions** — most daily challenges answered **correctly**. Correct only, deliberately: the XP for a challenge is paid for answering rather than for being right, which is the correct rule for a daily habit but makes "answered" another participation count.
- **Practice devotees** — practice sessions **submitted**, not started, so the board cannot be filled by opening papers and walking away.

**A board with nothing behind it is returned empty with a reason** that says what would fill it — never a seeded champion or a placeholder row. There is deliberately **no official-exam board**: that competition has not been run, so it would be permanently empty at best and fabricated at worst.

### What is new in the codebase

- Services: `leaderboardService.ts` (the ranking module), `hallOfFameService.ts`. **No new models** — both are aggregations over collections that already exist.
- Routes: `leaderboard.routes.ts` — `GET /leaderboard` (moved from `misc.routes.ts`, gaining scope, period, pagination and the caller's own standing) and `GET /hall-of-fame`.
- Middleware: `attachUserIfPresent` in `middleware/auth.ts`.
- Validation: `validation/leaderboardSchemas.ts` (the leaderboard query moved out of `profileSchemas.ts`).
- Index: `StudentActivity {occurredOn: -1}`, which the period boards narrow on before grouping.
- Frontend: `/leaderboard` and `/hall-of-fame`, both **public** and code-split, in the public navbar and the student sidebar, linked from the landing page and the dashboard's leaderboard card.
- **49 new tests** (535 total, 17 files), concentrated on ranking correctness: tie sharing and rank skipping, tie order determinism across repeated requests, page-boundary ties, three pages equalling the whole board, period window edges, suspended accounts not consuming a place, and query-string injection changing nothing.

### Response compatibility

`GET /leaderboard` still returns the same `leaderboard` array, so the landing page and the dashboard needed no change to keep working — the scope, window, pagination and `me` standing are additions alongside it.

### Verified end to end in a real browser

Against the local database, with eleven ranked students created through the real registration and reward paths:

- **Guest view** — ranks 1, 2, 3, then **two students sharing #4**, then six sharing **#6** with rank 5 correctly skipped. "11 ranked."
- **Class board** — the three Class 9 students, ranked **1, 1, 1** within their class rather than 6, 6, 6 as they stand overall.
- **Period board** — "Today" reported its window explicitly: *counting XP earned from 2026-08-13 to 2026-08-13*.
- **Signed in** — signing in earned that student the day's visit (+10 XP), which moved them into a **three-way tie at rank 4**, live. Their standing card read "#4 · Your position of 11 ranked · 60 XP" and matched the row marked **YOU** in the list; the next distinct XP resumed at **#7**.
- **Depth cap** — anonymous page 2 of 50 → **200**; page 3 → **403** "Sign in to see past the top 100". The same request signed in → 200.
- **Injection** — `?xp=999999&rank=1` returned the true totals unchanged.
- **Hall of Fame** — all five boards populated from data earlier milestones' real usage had left behind: *Best papers* showed **50% · 4/8** on "Physics Sprint — 1 minute" (the Milestone 7 verification attempt), *Challenge champions* **1 correct** (Milestone 8), *Streak legends* 3 days and 2 days, *Practice devotees* 2 sessions. Totals read 11 ranked, 930 XP awarded, 1 mock test graded, 1 challenge answered, 2 practice sessions.

No console errors beyond the ordinary guest session-restore 401s (`/auth/me` then one `/auth/refresh`), which predate this milestone.

**Not deployed.** No new environment variables and no new deploy step.

---

## 2026-08-13 — Milestone 9: Gamification Engine

XP, levels, streaks and achievements were already real and derived (Milestones 5–8). This milestone did the four things that were genuinely missing: **one place where a reward is decided**, **badges as a distinct concept**, **the journey map**, and **an administrator-tunable award table** — plus a page where a student can see all of it at once.

### Centralised reward logic

`services/rewardService.ts` is now the only way anything in this backend earns XP.

- **`grantReward()` is the single entry point.** All twelve call sites across five routes now go through it. `recordActivity()` remains the only writer of an activity row but is the layer *beneath* the engine, called by it and by the backfill script alone.
- **Eligibility rules moved out of the routes.** "Practice pays only if something was answered" was an `if` written inline in `practice.routes.ts` and again in `mockTests.routes.ts`. It is now one rule in the engine, and callers supply *facts* (`context: { answeredCount }`) rather than decisions. Pricing was already centralised; entitlement was not, and the brief's "do not calculate XP independently across random controllers" reads on both.
- **Idempotency deliberately stayed one layer down**, in the partial unique index on `StudentActivity`. A check inside `grantReward` would be a read-then-write across two serverless invocations — exactly the race the index exists to lose safely. The engine reports what the database decided rather than predicting it.

The refactor was behaviour-preserving: all 455 existing tests passed unchanged immediately after rewiring, which is the useful evidence.

### Badges — now a different thing from achievements

`FEATURE_STATUS.md` recorded badges as "delivered as Achievements", which was honest but meant one idea listed under two names.

- An **achievement** is a one-off goal: earned once, then it stops changing. Ten of them.
- A **badge** is a family held at a **tier** — bronze, silver, gold — that keeps levelling as the student does more of the same thing. Five families: Scholar (XP), Regular (streak), Practitioner (practice sessions), Test Taker (mock tests), Daily Solver (challenges).

A student with ten practice sessions has one achievement and a silver Practitioner badge. Those say different things, and the second keeps saying something new at fifty.

### Journey map

Nine ordered stages from *Enrolled* to *Olympiad ready*, with exactly one marked **next** — the first incomplete one. It answers the question neither of the other two catalogues does: *what should I do now?*

Stages measure **cumulative** facts (`longestStreak`, not `currentStreak`) so the map cannot walk backwards. Measuring the current streak would un-complete "three days running" the day a student missed one, which is not what a journey does and would read as the site taking something away.

### Administrator configuration

`/admin/reward-settings`, under a new `rewards:write` permission: what each event is worth, bounded to 0–500.

**It cannot re-price anybody's history, and that is a property of the data model rather than a promise.** `StudentActivity.xpAwarded` has been a snapshot since Milestone 5 — a student's total is the sum of what their events were worth *at the time* — so a change here decides what the next event pays and nothing else. That is what makes the setting safe to offer at all, it has its own test, and the page states it in a panel rather than a footnote.

Only **amounts** are configurable. Which events exist, how often each may be earned, what makes one eligible and where the level thresholds fall stay in code, because a rule should be reviewed in a diff and an amount is something to tune on a Tuesday.

### The student's view

`/rewards`: XP and level with progress to the next, the real counts underneath (active days, practice sessions, mock tests, challenges), the journey map, the badge grid and the full achievement list. Nothing on the page computes anything — every figure arrives already decided, from one facts object, so the dashboard and this page cannot disagree.

### One facts object, three pure catalogues

`lib/rewardFacts.ts` holds `RewardFacts`; `lib/achievements.ts`, `lib/badges.ts` and `lib/journey.ts` are pure functions of it. None reads a database. **If a fact is not on that interface, no badge can be awarded for it** — which is the friction that stopped an "exam accuracy" achievement being written before anything recorded an exam. `buildRewardFacts()` in the engine is the only place those figures are queried.

### What is new in the codebase

- Model: `RewardSettings` (a singleton, pinned by a unique index on a constant key) — **18 models**.
- Libraries: `rewardFacts.ts`, `badges.ts`, `journey.ts`. `ProgressFacts` is now an alias of `RewardFacts`.
- Service: `rewardService.ts` — granting, pricing, facts, the three summaries, and the config.
- Routes: `rewards.routes.ts` — `GET /me/rewards`, `GET`/`PUT /admin/reward-settings`.
- Permission: `rewards:write` (**14 permissions**). Audit action: `reward.settings.updated`.
- Frontend: `/rewards` and `/admin/reward-settings`, both code-split, plus a nav item in each shell.
- **31 new tests** (486 total, 16 files), concentrated on the edge cases: duplicate grants sequential and concurrent, ineligible events leaving no row, tier boundaries, journey ordering, and the no-re-pricing property.

### Verified end to end in a real browser

A student's `/rewards` page showed **Level 2 · 135 XP** with 35 of 150 XP through the level; real counts (2-day streak, 2 active days, 0 practice sessions, 1 mock test, 1 daily challenge); the journey at **3 of 9** with *Email verified* correctly flagged **next** (that account registered with verification off, so the stage is genuinely incomplete); badges **3 of 5 held** — Scholar, Test Taker and Daily Solver at bronze, Regular showing 2/3 to bronze; and achievements 3 of 10 with real progress on the locked ones.

Then the property that matters most, live: an administrator changed `daily_visit` from 10 to 40 XP. The student's total **stayed at 135** and their existing rows stayed at 10 apiece. After clearing that day's visit and signing in again, the **new** grant paid **40** while yesterday's row remained **10** — future re-priced, history untouched.

**Not deployed.** No new environment variables and no new deploy step.

---

## 2026-08-12 — Milestone 8: Daily Challenge

One question a day, per class, answered once, marked by the server and rewarded once. The daily challenge existed before this as a *read-only* card that said "answering here, with marking and XP, arrives with scored exams" — this is that, built.

### Student

`/daily-challenge` (new page) and the dashboard card.

- **View today's** — a real published question for the student's own class, the same one for everybody in it all day, answer-stripped.
- **Answer it** — all four question types, one submission a day.
- **Get the result immediately** — right or wrong, the correct answer, and the author's worked explanation. There is deliberately no disclosure policy here, unlike a mock test: the point of one question a day is to learn from it while you still remember thinking about it.
- **Earn 15 XP**, once per competition day, for answering — not for being right.
- **Keep a streak**, with the current and longest runs derived from the days actually answered, plus a history of past challenges.

### Admin / system

`/admin/daily-challenges` (new page, new `challenges:write` permission).

- **Schedule a day** for a class from the published bank, up to two weeks ahead, with the day strip supplied by the server.
- **Re-point or clear** a scheduled day — until somebody answers it, after which it is a record rather than a plan.
- **See how each day landed** — how many answered and what share were right, with `—` rather than 0% for a day nobody tried.
- **Scheduling is optional and the page says so.** A day nobody scheduled is filled automatically and marked as such, so a missed day is not an outage.

### The four properties this milestone is about

**1. A day's challenge is pinned, not recomputed.** This fixed a real defect rather than adding a feature: the old picker was `hash(day) % countOfPublishedQuestions`, so **publishing any question changed which question "today" was, mid-day, for every student in the class** — and a past day's challenge could not be recovered at all, because the bank it was derived from had moved. A challenge is now a document, written once (by staff in advance, or automatically on first request) and referred to thereafter. A test publishes ten more questions after a day has been served and asserts the day's question does not budge.

**2. One reward per competition day, guarded twice.** A unique index on `DailyChallengeAttempt {student, day}` makes a second attempt impossible; `recordActivity()` independently caps the XP at once per day through its own partial unique index. Different collections, different keys, written at different moments — a bug in either is not a paid exploit. Tested with sequential *and* concurrent submissions, counting both the attempts and the activity rows.

**3. The day is an IST calendar day, and only the server decides it.** No route accepts a day from a client: a student cannot claim yesterday by naming it, and a browser in another timezone cannot disagree about which challenge is today's. Tested as arithmetic at the boundary (18:35 UTC is already the next IST day) and through the API, by turning the day over and showing that a second answer is then legitimately allowed and continues the streak.

**4. XP and achievements are reached only through their own services.** The challenge service never writes an activity row and never says what an event is worth; the achievement catalogue never reads the database. The whole interface is two counts on `ProgressFacts`, supplied by `getChallengeFacts()`. Two new achievements — **Challenger** (answer one) and **Five days sharp** (answer on five consecutive days) — are the first in the catalogue that require actually answering a question, and they satisfy its "nothing unearnable is advertised" rule only because attempts are now recorded.

### Two defects found by the tests, before anyone else could find them

- **The shared grader returned `-0`** for a wrong answer whenever negative marking was off. It serialises to `0` over JSON, so no client ever saw it, but it was stored as `-0` and `Object.is(-0, 0)` is false — quietly breaking any exact comparison. Fixed in `services/grading.ts`, which practice and mock tests share.
- **A repeat submission reported the first one's XP.** The ledger was never at risk — the second submission awarded nothing — but the response's top-level `xpAwarded` echoed the *attempt's* stored figure, so the page could show "+15 XP" every time the button was pressed. That is the half of a double claim a student would actually notice. It now reports what this request awarded: 0.

### What is new in the codebase

- Models: `DailyChallenge`, `DailyChallengeAttempt` — **17 models**, neither with a TTL. The attempt embeds the shared `attemptAnswer` subdocument, so the one grader marks it too.
- Service: `dailyChallengeService.ts` (pinning, scheduling rules, grading, streaks, staff figures).
- Routes: `dailyChallenge.routes.ts` (3 student endpoints, including the existing `/me/daily-challenge`, which moved here from `me.routes.ts`) and `dailyChallengesAdmin.routes.ts` (4 scheduling endpoints).
- Validation: `dailyChallengeSchemas.ts`. No student-facing schema mentions a day or an outcome — the absence is the enforcement.
- Permission: `challenges:write` (**13 permissions**), held by `admin` and `superadmin`.
- Activity type: `daily_challenge_completed` (15 XP, once per day). Achievements: `challenge_first`, `challenge_streak_5`.
- Audit actions: `dailychallenge.scheduled` / `.updated` / `.deleted`.
- Dead code removed: `getDailyChallengeQuestion()` in `challengeService.ts`, the recompute-on-read picker this replaced.
- **37 new tests** (455 total, 15 files).

### Verified end to end in a real browser

Against a local MongoDB and the seeded Class 12 bank: a student opened `/daily-challenge`, was pinned a real Probability question ("two fair coins… give your answer as a decimal"), answered `0.25`, and was marked **correct, 3/3, +15 XP** with the tolerance (± 0.001) and the worked explanation shown. The dashboard then read **125 XP** — 110 plus exactly one award — with "Answered the daily challenge · Correct · +15" in the feed, the **Challenger** achievement earned, and the card switched to "See your answer · Answered — correct, 3/3". On the admin side the day appeared as **Automatic · 1 answered · 100% correct** with no Clear button (it has attempts), and scheduling tomorrow for the same class produced a **Scheduled · 0 answered · —** row that could still be cleared. Every daily-challenge request returned 2xx; no console errors.

**Not deployed.** No new environment variables and no new deploy step.

---

## 2026-08-12 — Milestone 7: Complete Mock Test System

Timed, staff-authored papers, sat under a clock the server owns. This is the first assessment in the product: practice is self-chosen and untimed, and the official Olympiad is still unbuilt, so a mock test is the first thing here that measures a student against a paper somebody else set.

### Admin: authoring

`/admin/mock-tests` (new, gated on a new `mocktests:write` permission).

- **Create a test** with a title, description, pre-start instructions (LaTeX allowed, rendered through `MathText` like a question), class, duration, attempt limit and an optional availability window.
- **Select questions** from the published bank, filtered to the test's own class and searchable by subject and text. The paper is ordered, reorderable, and each question is **priced for this test** — marks and negative marks default to the bank's values and can be overridden, because the same question is legitimately worth 2 marks on a quiz and 6 on a final.
- **Publish / unpublish / archive.** Publishing is where the strict rules apply: at least one question, every question already published, and a closing time present if either disclosure setting is relative to one. Unpublishing withdraws the test from students and refuses new attempts but deliberately does **not** interrupt an attempt already under way.
- **Two disclosure settings, independently.** When a student may see their **score** (`immediate` / `after_close` / `hidden`) and when they may see the **correct answers** (`immediate` / `after_close` / `never`). Releasing the key while the window is open lets the first student to finish hand the answers to everyone who has not, so a scheduled assessment usually wants the score at once and the answers later.
- **Results per test** — cohort statistics, a ranked table naming each student, and per-question outcomes so an author can see which question the cohort fell over. Every figure is a real aggregate; a statistic with nothing behind it prints as "—" rather than 0, because an average of zero and no average at all are different facts.
- **Audited.** Four new actions (`mocktest.created`, `mocktest.updated`, `mocktest.status.changed`, `mocktest.deleted`), so pulling a live paper has a name against it.

### Student: sitting the test

`/mock-tests` and `/mock-tests/attempts/:attemptId` (new).

- **View available tests** for their own class, with duration, marks, attempts used and the window. A test that has not opened yet is listed with its opening time — and **no questions**: the paper only ever arrives inside an attempt, which cannot be created outside the window.
- **Start, with a real clock.** The countdown comes from the server's `secondsRemaining` and re-syncs on every answer save.
- **Free navigation** with a question palette showing which are answered, and **per-answer autosave**, so a closed browser or a flat battery costs at most the answer being typed.
- **Submit**, or have it submitted automatically when the time runs out.
- **Results and review according to the test's settings** — the full marked paper with explanations, or the score alone, or an honest "your answers are in, results are released after the test closes". A withheld score is absent from the payload, not merely hidden by the page.
- **50 XP**, once per competition day, for a mock test with real work in it.

### The four properties this milestone is really about

**1. The backend enforces timing; the frontend timer is decoration.** `MockTestAttempt.expiresAt` is computed and stored when the attempt is created — `startedAt + duration`, clamped to the test's closing time — and never recomputed, so an author changing the duration mid-paper cannot move a finishing line somebody is already running at. An answer arriving after the deadline is refused with 409 and **not stored**. A submission arriving late is still graded, *as at the deadline*, and recorded as having run out of time rather than as handed in. Nothing in any mock-test request body carries a time; a test posts `expiresAt`, `secondsRemaining`, `durationMinutes`, `timeTakenSeconds` and `startedAt` alongside a legitimate answer and asserts the stored deadline does not move. An attempt cannot even be started with under 60 seconds of window left, because the alternative is handing a late arrival a 20-second paper that also consumes their only try.

**2. Exactly one submission.** Grading closes the attempt with a write conditional on it still being open, so of two concurrent submissions exactly one transitions it; the other gets the stored result and `alreadySubmitted: true`. Tested both sequentially and with genuinely concurrent requests, asserting one lot of XP and an unmoved `submittedAt`. A unique index on `{test, student, attemptNumber}` does the same job for two requests racing to *start* — the loser resumes the winner's attempt rather than creating a second one. Resuming is also what makes a reload safe, and what stops "start again" from buying a fresh clock.

**3. The answer key does not leak — now under a policy.** The in-progress view composes the same answer-stripped `studentQuestionView` the question endpoints use, and `attemptReviewView()` is the only function that reveals a correct answer: it refuses unless the attempt is submitted **and** the test's review policy currently permits it. Tests stringify whole response bodies and require the forbidden names and the literal correct values to be absent — including *after* submission when the policy is `never`, which no earlier surface in this codebase had to do.

**4. Attempts and results are persisted, and marked against the paper as served.** Each served question carries a snapshot of the answer key and the marks taken at serve time, so editing or re-pricing a question afterwards cannot change a mark already awarded — proved by a test that moves the correct option to a different letter after the student has answered and still scores them correct, while telling them the question has since been edited.

### Shared rather than copied

The two things that would have been dangerous to duplicate were extracted instead:

- **`models/attemptAnswer.ts`** — one definition of a served question with its answer-key snapshot, response and outcome, used by `PracticeSession` and `MockTestAttempt`. `PracticeQuestionEntry` is now an alias of it.
- **`services/grading.ts`** — one implementation of the marking rules, used by both. `practiceService.ts` re-exports `gradeEntry` / `isAnswered`, so its callers and its 42 tests were untouched. Two graders would eventually have disagreed, and a grader that disagrees with the answer key is a wrong score.

### What is new in the codebase

- Models: `MockTest`, `MockTestAttempt`, `attemptAnswer` (shared) — **15 models**, none with a TTL.
- Services: `mockTestService.ts`, `grading.ts` (extracted).
- Routes: `mockTests.routes.ts` (7 student endpoints), `mockTestsAdmin.routes.ts` (7 admin endpoints).
- Validation: `mockTestSchemas.ts`, including two cross-field rules — a closing time must follow the opening time, and a disclosure setting of `after_close` requires a closing time to exist rather than silently meaning "never".
- Permission: `mocktests:write` (**12 permissions**), held by `admin` and `superadmin`. Students sit tests under the existing `exam:take`.
- Activity type: `mock_test_completed` (50 XP, once per day).
- Rate limiter: `mockTestLimiter` on starting and submitting. Saving an answer is deliberately *not* limited — a student saves an answer every few seconds under a clock that does not stop.
- Frontend: `pages/MockTests/` (list + attempt runner/review), `pages/Admin/MockTests|MockTestForm|MockTestResults`, four admin routes and two student routes, and a nav item in each shell.
- **54 new tests** (418 total, 14 files).

### One bug found by self-review, and the test that now catches it

Three surfaces sweep expired attempts as a side effect of being read — the test list, the attempt history and the single-test briefing. All three rendered the document they *passed in* to the sweep rather than the one it returned, and because grading is a conditional `findOneAndUpdate`, the copy in hand still read `in_progress` afterwards. The effect was small but exactly the sort of thing that erodes trust: a paper whose time had run out showed as unfinished in the very response that finished it, and corrected itself only on a reload. Fixed by rendering the returned document, and covered by a test that asserts all three surfaces report `submitted` in the same response — verified to fail against the previous code (`expected 'in_progress' to be 'submitted'`) rather than merely to pass against the new.

### Verified end to end in a real browser

Against a local MongoDB and the seeded Class 12 bank: the root admin created a **1-minute, 2-question, 8-mark Physics paper** from real published questions and published it; a newly registered Class 12 student saw it, started it, answered one question, and the paper was **submitted automatically when the countdown reached zero** — scoring 4/8, 1 correct, 1 unanswered, 100% accuracy of answered, 59s recorded, +50 XP, with the correct answers and explanations revealed only after submission. The attempt limit then reported "1/1 — you have used your attempt" with Start disabled, and the admin results page showed the ranked row (Meera Rao, AMIT_9313, 4/8, 100%, 1/0/1, 59s) with per-question outcomes of 100% on the answered question and "—" on the skipped one. No console errors from any mock-test request.

### Also fixed here

**`npm run dev:local` no longer emails real people.** `backend/.env` holds working SMTP credentials, and `dotenv` will not overwrite a variable that is already set, so registering a made-up address against the *local* database sent a real message through the owner's real provider — to whoever owns the address that was typed. The script now points SMTP at a dead local port and turns email verification off, both overridable, so a local registration is one step and nothing leaves the machine. This was a documented footgun in the very script whose purpose is to remove footguns; it is also what made the browser verification above possible.

**Not deployed.** No new environment variables, and no new deploy step.

---

## 2026-08-11 — Class 12 question bank: 208 published questions

Stocks the Practice Zone, which was otherwise only as useful as what had been published.

**208 questions for `Class 12 - Science`** — 104 Mathematics and 104 Physics, eight per chapter across the thirteen CBSE chapters of each. Every one has a worked solution (the bank refuses to publish anything unexplainable), a real answer, and an honest difficulty label so the Practice Zone's difficulty filter means something: 88 Easy, 93 Medium, 27 Hard.

Delivered as a committed, re-runnable script rather than a one-off insert:

```
cd backend && npx tsx scripts/seed-class12.ts            # report only
cd backend && npx tsx scripts/seed-class12.ts --write    # publish
```

- **Report-only by default**, like the other two scripts here. A script that writes the moment it is invoked is one typo away from an accident.
- **Idempotent** — a question is keyed on its text within its class, so a re-run skips what exists rather than duplicating it. Verified: the second run reported 208 already present and created nothing.
- **Validated with the API's own rules.** Every question passes `createQuestionSchema` — the exact zod schema `POST /admin/questions` uses — plus `validateMathContent` on each field. This caught two real defects before anything was written: one question whose options differed only by letter case (`D` vs `d`), which the duplicate-option check rejects because it compares case-insensitively; and a stray `.replace()` left in an option string.
- **Options are shuffled** deterministically from the question text. Authoring puts the correct answer first for readability, and writing them in that order would make every answer option `a` — worthless for practice. Verified spread across the 80 single-choice questions: a=19, b=13, c=24, d=24.

Question types: 80 single-choice, 75 numeric, 52 true/false, 1 multiple-choice. True/false questions are worth 2 marks with **no** negative marking — with a 50% chance of a lucky guess, penalising them punishes the student who thought about it more than the one who flipped a coin.

**Verified end to end** against a local MongoDB: a Class 12 – Science student sees Mathematics (104) and Physics (104) with all 26 topics and their real per-topic counts, and an eight-question Current Electricity session graded correctly with no answer key in the payload before submission.

**Not published to production.** Atlas is unreachable from the development sandbox (outbound DNS blocked), so the owner must run the script themselves — which is why it is a committed script and not a manual insert.

---

## 2026-08-11 — Milestone 6: Practice Zone

Students can now practise for real: choose a subject, a topic and optionally a difficulty, answer published questions, navigate freely, submit, and get a marked review with explanations and a performance summary. Everything is persisted and every figure is computed server-side.

### Answer integrity

The rule the design is built around: **a correct answer leaves the server only after the session containing it has been submitted.** Three separate things enforce it.

- `sessionInProgressView()` composes `studentQuestionView` — the same answer-stripped projection the question endpoints use — and adds only the student's own saved responses. No code path in it can read the answer key.
- `sessionReviewView()`, the only function that reveals an answer, **throws** unless the session is `submitted`, so a caller cannot obtain a partially-revealed shape by forgetting to check first.
- Grading is server-side. The browser is never given anything to mark with, which is a real improvement on what this replaced: the old practice page marked answers in the client and therefore shipped the whole paper's answer key in its JavaScript bundle.

Verified in a real browser: the start payload contains no `isCorrect`, `solution`, `booleanAnswer`, `numericAnswer`, `tolerance` or `correctAnswer`. Tests assert the same by stringifying whole response bodies rather than checking one field, so adding a field to a projection without thinking will fail them.

### What is persisted

New `PracticeSession` collection: the session, every question served, the student's answer to each, its correctness, per-question marks awarded, the total score, the time taken and the completion status.

Each served question carries a **snapshot of the answer key taken when it was served**, plus the question's `revision`. An author may edit or archive a question while a session is open; grading against the live document would then mark a student against a question they were never shown. The review tells the student when a question has been edited since they answered it rather than silently showing different text.

### Grading rules, all deliberate

- **Unanswered scores zero and is never penalised.** A blank is not a wrong answer, and penalising it would push students to guess.
- `multiple_choice` requires the **exact** set — no partial credit, because with negative marking present part-marks would need a second policy for how much to deduct, and the bank has no field for it.
- `numeric` compares within the question's own `tolerance`, defaulting to exact.
- A wrong answer costs `negativeMarks`, so a score **can be negative**. The arithmetic is reported honestly rather than clamped.
- Accuracy is over *answered* questions, with the unanswered count shown beside it so the figure is not flattering by omission.

### XP

Submitting a session with real work in it earns `practice_completed` (25 XP), **once per competition day** rather than once per session. Paying per session would be farmable by submitting empty papers in a loop; paying per correct answer would need a separate daily cap to achieve the same thing. Extra sessions the same day are still recorded in full — only the XP is capped. A paper with nothing answered earns nothing.

### Separate from the official exam

`PracticeSession` is a new collection, not a reuse of `ExamAttempt`. Practice is unlimited and self-selected and must never influence a ranking; the official exam is one marked, ranked sitting that produces a published result and a certificate. Sharing a collection would mean every query about official performance had to remember to exclude practice, and the first one that forgot would award a national rank for a practice run.

### Frontend

- `/practice` — the setup page. Subject, topic and difficulty pickers driven entirely by real per-topic counts, with only the difficulties that actually exist offered, so a combination with nothing behind it can never be chosen. Real practice history, and a prompt to resume an unfinished session.
- `/practice/:sessionId` — the runner and the review, one route. The server decides which: in progress comes back answer-stripped, submitted comes back marked. `isReviewed()` narrows between them, so review-only fields are *unreachable* rather than merely unrendered while a session is open.
- Answers save individually as they are given, so closing the browser mid-session loses nothing. Free navigation via a palette showing which questions are answered. Code-split, because it renders question content through KaTeX.
- The old `/exam` practice paper is superseded and removed; the route redirects to `/practice` so no bookmark dead-ends, and the path stays free for the official exam.

### Testing

**42 new tests (364 total).** The marking rules are tested as pure functions *and* through the API: all four question types, negative marking on answered-wrong only, exact-set multiple choice, numeric tolerance including a null tolerance and a zero response, and `false` counting as a real true/false answer rather than an absent one. Plus the integrity properties — no leak on start, resume or save; review refused before submission; another student's session indistinguishable from one that does not exist; no double submission; XP once per day.

One real bug was caught by these tests and fixed: `$match` inside an `aggregate()` pipeline does **not** cast a hex string to an `ObjectId` the way `find()` does, so filtering practice by topic silently matched nothing and then failed the model's `min: 1` validator as a 500.

---

## 2026-08-11 — The student sidebar now persists across every page it links to

Reported: pressing any item in the left-hand `A.M.I.T Hub` menu made the menu itself disappear.

**Cause.** The sidebar was built inside `Dashboard.tsx` and existed *only* there. Every link in it pointed at a page that rendered the public top-navbar layout instead — Profile, Practice Paper, Analytics, Report, Certificate — so navigating anywhere from the menu replaced the whole chrome and left no way back except the browser's back button.

**Fix.** Extracted `components/StudentShell.tsx`, mirroring the existing `AdminShell`, and wrapped every destination in it:

- The sidebar, topbar, theme toggle and sign-out are defined once and persist across `/dashboard`, `/profile`, `/exam`, `/analytics`, `/report`, `/result` and `/certificate`.
- The current page is highlighted, with `aria-current="page"` — what makes a persistent sidebar useful rather than merely present.
- The brand at the top is now a link home.
- On mobile the drawer still closes when an item is chosen, and now also closes when the backdrop outside it is tapped, which previously required hunting for the burger again.
- `/result` was added to the menu; it was reachable only from the public navbar before, which a signed-in student no longer sees.
- "Live Exam" is relabelled **Practice Paper**, matching what that page now actually is.

**Guests.** `/certificate` and `/result` are public routes, so `StudentShell` falls back to the ordinary `Navbar` + `Footer` for anyone not signed in as a student, rather than showing a sidebar full of links that would bounce them to a sign-in screen. Verified both ways.

The duplicated shell rules were removed from `Dashboard.module.css`, which now holds only that page's own content styles.

---

## 2026-08-11 — No placeholder data anywhere, and a real light/dark theme

Two owner requests: eliminate **all** remaining fake data, strictly; and make the app one consistent theme, light by default, with a user toggle.

### Every remaining piece of fabricated data is gone

A page-by-page audit found five more, plus one regression from the previous change.

- **The result portal was inventing results.** `Result.tsx` hashed whatever string was typed into its search box and derived a score, a national rank and a percentile from it — client-side, with no server call. Any visitor could enter any ID, including one that did not exist, and be shown an authoritative "72/100 · National Rank #146 · 91.4th percentile" for a competition that has not been held. This was the worst fabrication in the product and it was publicly reachable. Replaced by a real `GET /results/:studentId`.
- **The certificate page issued awards nobody earned.** It printed "For outstanding participation and achievement" for anyone signed in — or "Future Champion / AMIT_XXXX" for a guest — stamped with today's date and the student's own ID as the certificate number. A student could print it the minute they registered. Now driven by `GET /certificates/:studentId`, which requires a **published result**.
- **`GET /certificates/:studentId` itself was a static two-item mock** returned for any id. Now a real query.
- **The exam was five hardcoded questions that shipped their own answer key.** Each carried a `correct` field, so the answers for the whole paper were readable in the JavaScript bundle — a smaller version of the hole Milestone 4 closed on the questions API. It now loads **real published questions** for the student's class through the answer-stripped `/questions`, and therefore cannot mark anything and does not pretend to: no score screen, because a score would have to be invented.
- **The admin dashboard's "Weekly Accuracy Trend"** was `[72, 78, 75, 82, 88, 90, 92]` against Mon–Sun. It was labelled as sample data, but a labelled invention is still an invention, and an accuracy trend cannot exist while no answer has ever been scored. Replaced with two real series from a new `GET /admin/stats`: registrations per day and active students per day.
- **Regression fixed**: removing the fabricated analytics in the previous change left `Report.tsx` reading fields off a now-null object, so the page spun forever. It now handles the real response, reports the progress that is genuinely recorded, and states which sections need exam results.

Every one of these is a **live query against the real collection** rather than a hardcoded empty, so each starts working by itself when exam submission lands. New `services/resultService.ts` holds the lookups.

The result portal is public, and deliberately answers **identically** for "no such account" and "no published result", so it cannot be used to enumerate which student IDs exist. Only `isPublished` results are ever visible, so marks cannot be read before release.

### Light and dark theme, light by default

The app was previously half-and-half: public pages light, while the dashboard, admin area and exam each hardcoded `theme-dark` on their own shell. Signing in changed the colour scheme underneath you, and the admin sign-in form was dark while the navbar above it was light.

- New `ThemeContext` applies the theme **once, to `document.documentElement`**, so every page inherits it and no page can disagree with another or forget to opt in.
- **Light is the default**, by the owner's decision — deliberately not `prefers-color-scheme`, so the baseline is predictable.
- The choice persists in `localStorage` and survives reloads. Storage access is wrapped, since it throws outright with site data blocked.
- New `ThemeToggle` in all three shells: the public navbar, the dashboard sidebar and the admin sidebar.
- The three hardcoded `theme-dark` shells are removed.
- The themed background is now painted on `html`, `body` **and** `#root`. Relying on body's background propagating to the canvas is the fragile part — it only holds while `html` has no background of its own — and painting the app root means pages without a full-height wrapper cannot end up with dark cards on a light canvas.
- Verified that every hardcoded `#fff` in the previously dark-only stylesheets sits on a saturated background (blue, green, purple, or a dark overlay), so all of them remain correct in light mode.

**One verification caveat.** The theme is confirmed correct on page load in both modes, on every page. Live *switching* could not be visually confirmed in the preview browser: that engine does not invalidate `var()` substitutions when a custom property changes at runtime — a freshly created element picks the new value up correctly while existing ones keep the old one, and even an inline custom-property write on the root fails to update them. No shipping browser behaves that way (every dark-mode implementation on the web depends on it), and real Chrome was not reachable to compare, so the standards-correct implementation was kept rather than working around a preview-pane artifact. Worth a single click to confirm in a real browser.

### Testing

11 new tests (**322** total): the result portal's empty state, its non-enumeration property, a real published result read back, an unpublished result staying invisible, contact details never appearing beside a result, certificates before and after publication, and the admin stats series including that the old fabricated accuracy figures cannot appear.

---

## 2026-08-10 — Milestone 5 follow-up: three gaps closed

A gap audit against the Milestone 5 brief found three things the first pass missed. All are now done.

**The analytics endpoint was fabricating a student's performance.** `GET /analytics/:studentId` fell back to a hardcoded object whenever no `StudentAnalytics` document existed — which is *every* student, since nothing writes one. It claimed **88% accuracy over 450 questions**, a rising five-point learning curve, four topic breakdowns, and "You are currently in the top 5% of all national Olympiad participants" — presented as the student's own measured performance, on a page linked straight from the dashboard. This was the same class of defect Milestone 5 existed to remove, missed because the page sits outside the dashboard route.
- The fallback is deleted. `data` is now the real document or **null** with `reason: 'no-exam-data'`.
- Added a genuinely real series in its place: `xpByDay`, actual XP earned per competition day over the last 30 days, aggregated from the activity log. Days with no activity are **omitted** rather than zero-filled, because a flat line at zero would imply a measured zero.
- The Analytics page now separates what is measured (XP earned, active days, best day, and a real per-day chart) from what is not (accuracy, speed, topic strengths), with an explicit empty state for the latter that says why and what will fill it.
- The endpoint also now 404s for a non-existent student ID instead of returning data for nobody.

**`GET /me/daily-challenge` had no caller**, so "upcoming/available challenges" was only half delivered — the dashboard showed practice *availability* but nothing served the actual challenge. Added a dashboard card rendering today's real question through `MathText`, with subject › topic › subtopic, difficulty and marks. Code-split into its own chunk so KaTeX (~260 KB) stays out of the main bundle, as with the admin question pages. It is deliberately **read-only**: answering needs somewhere to submit and something to score against, and checking answers client-side would mean shipping the answer key — the exact hole Milestone 4 closed. The card says so plainly.

**`GET /me/activity` had no caller**, so the feed was capped at the newest 8 with no way to see more. Added a "Show earlier activity" control that pages the real endpoint, appends rather than merges (so a reload cannot duplicate rows), and finishes with "That's your whole history — N events."

**Testing** — 5 new tests (**311** total), including one that asserts none of the six deleted fabricated strings can appear in an analytics response, and one that checks `xpByDay` sums to exactly the XP the dashboard reports.

**Also corrected** — the guidance for neutralising email locally. `SMTP_HOST=` (empty) does not work: the zod schema correctly rejects an empty string. Use `REQUIRE_EMAIL_VERIFICATION=false` instead.

---

## 2026-08-10 — Milestone 5: Student Profile and Dashboard

Students can now see and change their own account, and the dashboard shows real progress instead of decoration. The governing constraint was **no fake statistics**: every figure on every page this milestone touched is derived from a database read, and where a student has no data the panel says so and explains why.

**Self-service profile** — closes the gap recorded since Milestone 4 as "no one can edit their own details after registering", which until now needed a direct database edit.
- New `/profile` page: view and edit the nine descriptive registration fields, with `fullName` re-derived server-side.
- **Photo replacement** (`PUT /me/photo`), fixing known bug #9 ("a photo cannot be replaced or removed"). Same 2 MB / magic-byte validation as registration; upserts, so a legacy account without a photo also works. No delete — the photo is a required part of an entrant's record.
- **Change password** from account settings, requiring the current password so a borrowed session cannot lock the owner out. Revokes every other session and re-issues one for the current device, so the student is not signed out of the page they are standing on.
- `email` and `mobile` are deliberately **not** editable — they are the login identifiers and `email` anchors password reset, so changing one needs a confirm-at-the-new-address flow. They are absent from the zod schema rather than filtered in the handler, so extra keys in a request cannot reach the update.

**Progress, derived not stored** — new `StudentActivity` collection, the single source of truth for XP, levels, streaks and achievements. There is no counter document: XP is a `$sum` over real events, the level is a pure function of it, the streak is computed from the distinct days present. A counter that drifts from the events behind it is exactly how "no fake statistics" gets broken.
- XP comes only from events that really happen: account created (50), email verified (50), daily visit (10, once per competition day). Profile, photo and password changes appear on the feed but are worth **0** — they are repeatable at will, and paying for them would make XP a measure of pressing Save. No exam XP, because no exam attempt is recorded anywhere yet.
- A day is an **IST** calendar day, not a UTC one (`lib/competitionDay.ts`). UTC would file a 00:30 IST visit under the previous day and break a streak the student had in fact kept.
- "Once per day" and "once per account" are enforced by a **partial unique index**, not by a check, so two concurrent requests cannot both earn the same visit.
- Achievements are evaluated from real facts on every read, with real progress toward the locked ones. No exam or accuracy achievement is listed: a permanently unearnable row with a bar that can never move is a fake statistic wearing a lock icon.

**Dashboard rewritten** — the three hardcoded stat tiles ("1,280 challenges solved today", "8.91s fastest solve", "450+ participating schools") and the three-name invented leaderboard are gone. Now: XP and level with progress to the next, streak (current and best), leaderboard rank, achievements earned, a real activity feed, available practice derived from the published question bank for the student's own class, and recent test performance.
- **Recent test performance** is a live query against `ExamAttempt`, which nothing writes to yet — so it is honestly empty and the panel says scored exams are not running yet. Written as a real query rather than a hardcoded `[]` so it starts working the moment exam submission lands.

**Two mock endpoints became real.** `GET /leaderboard` now aggregates actual XP, and `GET /daily-challenge` returns a deterministic published question for the caller's class (now authenticated, where the mock was open, because it returns question content). New `GET /public/stats` gives the landing page real counts. The landing page's invented "Today's Champions" and four headline figures are replaced by both — the project owner's explicit choice.
- The public leaderboard publishes a **first name and last initial** ("Ishaan V."), not a full name: the entrants are children in classes 5–12 and the page is public and indexable. `limit` is capped at 50 so it returns a leaderboard rather than an enumerable roll; suspended accounts are excluded before the limit; a student with no XP is genuinely unranked rather than listed last.

**Audit trail** — three actions added (`student.profile.updated`, `student.photo.updated`, `student.password.changed`), because a change to an account belongs in the trail whoever made it, including its own owner. Metadata names the changed **field names, never their values**: the trail is readable by any admin, and a student's home address should not be copied into it.

**Refactors** — session cookie handling moved out of `auth.routes.ts` into `lib/session.ts`, since the password change also has to issue a session; the answer-stripped `studentQuestionView` moved into `services/questionView.ts`, so the daily challenge reuses it instead of a second hand-written stripper (still deliberately separate from the author view). New `accountUpdateLimiter` (20/hour) on the password and photo routes.

**Fixed along the way** — `optionalName` accepted `''` and `undefined` but not `null`, so "remove my middle name" was a 400 on a JSON PATCH. It now accepts all three.

**Migration** — `backend/scripts/backfill-activity.ts` gives pre-Milestone-5 accounts the enrolment rows they have already earned, dated from their real `registeredAt`. Idempotent, and deliberately does **not** invent `daily_visit` rows, so nobody is handed a streak they did not keep. Report-only by default; `--write` applies.

**Testing** — 82 new tests across `tests/profile.test.ts` (27) and `tests/dashboard.test.ts` (55), taking the suite from 224 to **306**. They pin the exact XP a new account holds (an explainable 110, not "some number"), cover the IST day boundary and leap years, the streak rules including a run kept alive by yesterday's visit, the level thresholds and their edges, the leaderboard's ranking, masking and exclusions, that a student cannot change their own role or status, that the audit entry omits the address value, and that the specific invented figures this milestone deleted no longer appear in any response.

## 2026-08-05 — Milestone 4: Complete Question Bank System

The question bank became a real, authored system: a subject/topic/subtopic taxonomy, four question types with per-type answer shapes, marks and negative marks, an editorial workflow, tags, search/filter/sort/pagination, and an admin UI with a live maths preview. **No exam, results, certificate or leaderboard behaviour changed** — those surfaces are still mock; this milestone builds what they will eventually read from.

**Security fix — the answer key was public.** `GET /api/v1/questions` had **no authentication middleware at all** and returned raw documents including `correctAnswer`, so anyone on the internet could fetch the answer key for the whole bank. It is now gated on `questions:read`, and the student response is an explicit allow-list that omits `isCorrect`, `solution`, `booleanAnswer`, `numericAnswer` and `tolerance` by construction. The author view is a separate function behind `questions:write`, deliberately not one function with an `includeAnswers` flag. See [`SECURITY.md`](SECURITY.md).

**Taxonomy**
- New `Subject` collection: name (unique case-insensitively), derived slug, description, status, display order.
- New `Topic` collection holding **both topics and subtopics**, distinguished by a nullable `parent` and a derived `depth` capped at 1. Uniqueness is scoped to the parent, so "Fractions" may exist under two subjects and as a subtopic of each.
- Archiving is refused while published questions still reference the entry, and says how many.

**Questions** — `Question` was rewritten:
- Four types: `single_choice`, `multiple_choice`, `true_false`, `numeric` (with optional tolerance). Each uses exactly one answer representation and the validator **rejects the fields belonging to the other types**.
- Options are now subdocuments with a server-assigned stable `key` and an `isCorrect` flag, replacing `correctAnswer`-as-literal-text — which meant fixing a typo in an option silently invalidated every recorded answer.
- `marks` (0.25–100) and `negativeMarks` (a magnitude to deduct, 0 disables it, cannot exceed `marks`).
- Status workflow `draft → in_review → published`, plus `archived`. Everything is created as a draft; publishing additionally requires a solution and a resolvable answer key.
- Tags (lowercased, de-duplicated), `revision` bumped on every edit, and created/updated actor labels.

**Mathematics** — content is plain text with LaTeX islands (`$…$`, `$$…$$`), rendered by KaTeX. Prose is rendered as React text nodes and only KaTeX's own output is inserted as HTML, so author text never reaches an HTML sink. The backend independently rejects link, file-inclusion and macro-definition commands, unbalanced delimiters, markup and control characters. KaTeX is lazy-loaded so the main bundle stays at ~476 KB.

**APIs** (all under `/api/v1`)
- New: `GET /subjects`, `GET /topics`, `POST /admin/subjects`, `PATCH /admin/subjects/:id`, `POST /admin/topics`, `PATCH /admin/topics/:id`.
- New: `GET /admin/questions`, `GET /admin/questions/:id`, `POST /admin/questions`, `PUT /admin/questions/:id`, `PATCH /admin/questions/:id/status`, `DELETE /admin/questions/:id`.
- Changed: `GET /questions` and `GET /questions/:id` are authenticated, published-only and answer-stripped; a draft asked for by id returns **404, not 403**.
- Changed: `POST /admin/generate-questions` now requires real subject and topic ids and writes **drafts only**, so template placeholder text can never reach a student.
- Listing supports `page`/`limit`, an **allow-listed** `sort` (so a caller cannot make the database sort by an unindexed field), `order`, literal regex-escaped `search` across text/tags/solutions, and filters on status, subject, topic, subtopic, class, difficulty, type and tag. `_id` is a sort tiebreaker so pagination is stable.

**Permissions** — two added: `questions:delete` (separate because it is the one question-bank action that destroys data) and `taxonomy:write`. Six new audit actions.

**Admin frontend** — three new pages: `/admin/questions` (list with search/filter/sort/pagination and loading/error/empty states), `/admin/questions/new` and `/:id/edit` (form with a live side-by-side maths preview), `/admin/taxonomy` (nested subject → topic → subtopic tree). The "AI Question Generator" page now says plainly that it is a template filler, not AI.

**Breaking change** — the `Question` rewrite cannot read pre-Milestone-4 documents (`subject` went from `String` to `ObjectId`, which is a **cast error on read**, not a missing field). Every such document came from the old template generator and nothing references questions yet, so `backend/scripts/migrate-questions.ts` reports them and removes them with `--delete`. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

**Testing** — 77 new tests (`tests/questionBank.test.ts`), taking the suite from 147 to **224**. They cover the whole CRUD flow end to end, per-type answer rules, the maths grammar including macro-expansion and markup attacks, the editorial workflow and its illegal transitions, search/filter/sort/pagination, and the answer-key protection from a real student session. Test files now run **sequentially** (`fileParallelism: false`): five suites start their own `mongod`, and in parallel they contended badly enough to fail with unrelated duplicate-key errors. `clearTestDb()` now throws instead of silently no-oping when there is no connection, which is what made that diagnosable.

## 2026-08-05 — Full registration details are collected and persisted

Registration previously asked for four things (full name, mobile, email, password). It now collects the complete entrant record the owner specified, and every field is written to MongoDB as part of the same request. **No exam, results, certificate or leaderboard behaviour changed.**

**New registration fields** — all required except the middle name:
- First / middle / last name as three separate inputs. `fullName` is now **derived** from them by the schema, so every existing reader of `fullName` (admin list, its search, the session envelope, the certificate) is unchanged.
- Father's name, mother's name, date of birth, class, current school name, full address.
- A mandatory photo, up to 2 MB, as JPEG / PNG / WebP.

**Class** is a fixed list of ten values: `Class 5` … `Class 11`, then `Class 12 - Science`, `Class 12 - Commerce` and `Class 12 - Humanities`. Held in `backend/src/lib/classLevels.ts` and mirrored by name only in `frontend/src/api/types.ts`.

**Database changes**
- `Student` gained `firstName`, `middleName`, `lastName`, `fatherName`, `motherName`, `dateOfBirth`, `classLevel`, `schoolName` and `address`. They are required **on creation only** (`required: () => this.isNew`), so an administrative `save()` on an account that predates this change — suspending it, changing its role — does not fail validation on data the admin never touched.
- New **`StudentPhoto`** collection: one document per account (`student` is unique), holding `contentType`, `size` and the image `data` as a `Buffer`. Deliberately *not* a field on `Student`, so no student query drags a 2 MB binary along with it.

**API changes**
- Changed: `POST /auth/register` now requires the fields above plus `photo` (a base64 data URL). The registration and session payloads return the new details.
- New: `GET /students/:studentId/photo` — serves the raw image. A student may read their own; `students:read` is required for anyone else's, checked **fresh** against the database.
- `GET /admin/students` and `GET /admin/students/:studentId` include the new fields, `null` on pre-existing accounts.
- Only the registration route accepts a large body (2.8 MB); every other endpoint keeps body-parser's 100 KB default.

**Validation**
- The photo's declared MIME type is checked against the file's actual **magic bytes**, so `data:image/png;base64,<anything>` is refused rather than stored and later served back as an image.
- Names accept any script (`\p{L}` plus `\p{M}`, so Devanagari vowel signs work — `अमित` was rejected by a letters-only rule).
- Date of birth must be a real past date implying an age of 5–40.

**Frontend**
- The registration form is regrouped into *Student details* / *Photo* / *Contact & sign-in*, every required field carries a red `*`, and the grid goes to two columns where there is room.
- The chosen photo is previewed with its filename and size; oversized or wrong-type files are refused before submission with a specific message, as is each missing required field by name.
- The admin user table gained photo, class and school columns. Accounts with no photo fall back to an initial.

**Testing** — 40 new tests (`tests/registration.details.test.ts`), taking the suite from 106 to **147** (one more from tightening the older validation suite, whose `fullName` cases no longer described a real field). They read back from the database rather than trusting the response, and cover every required field, each of the ten classes, the photo's size/type/magic-byte rules, the authorization on photo reads (own / another student's / admin / anonymous / the `/api` alias), and that a pre-Milestone-4 account can still be administered.

## 2026-08-05 — Navbar: expose the Admin link to guests

The navbar's **Admin** link previously rendered only for someone already holding `students:read`, so a logged-out visitor had no way to reach the admin sign-in form except by typing `/admin` by hand. It now also renders for guests. It stays hidden for a signed-in plain student, who would only reach the `Unauthorized` screen by following it. No authorization behaviour changed — the link is navigation only, and every admin route is still gated server-side.

## 2026-08-05 — Milestone 3: RBAC and User Management Foundation

Authorization moved from scattered role checks to a single permission table, admin accounts became real and manageable, and administrative actions are now audited. **No exam, results, certificate or leaderboard behaviour changed.**

**Roles**
- Three roles: `student`, `admin`, `superadmin`. The env-configured account (`ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH`) now holds **`superadmin`** and is the bootstrap root, still with no database document.
- A super admin grants or revokes `admin` on any existing verified account. Promoted admins are ordinary accounts with `role: 'admin'`, so they inherit login-by-mobile-or-email, lockout, refresh-token rotation, email verification and password reset — and keep their student capabilities.
- `superadmin` is **not assignable through any API**: there is deliberately no path to a second root administrator.

**Authorization**
- New `backend/src/lib/permissions.ts` — nine named permissions and the only role → permission mapping in the codebase. Comparing `req.user.role` to a literal is now forbidden outside that file.
- `middleware/auth.ts` rewritten: `requirePermission(...)` is the gate routes should use, with `requireAuth(...)` kept for the rare identity-only gate. Adds `callerCan` / `callerCanFresh` for decisions that depend on the data being addressed.
- **Privileged requests re-read `role`, `status` and `tokenVersion` from MongoDB** rather than trusting the access token, so a demotion or suspension takes effect immediately instead of surviving up to 15 minutes. Student-level requests stay stateless.
- `verifyAccessToken()` now rejects any token whose `role` is not a recognised role.
- Role changes and suspensions revoke every refresh token and bump `tokenVersion`.
- `GET /analytics/:studentId` lost its inline `role !== 'admin'` check in favour of `analytics:read:self` plus a database-fresh `analytics:read:any`.

**Database changes**
- `Student` gained `role` (`student`|`admin`, indexed, default `student`), `roleUpdatedAt` and `roleUpdatedBy`.
- New `AuditLog` collection: action, actor (role + id + denormalised label), target, outcome, metadata, ip, user agent. Indexed newest-first plus by action and by actor. **No TTL** — unlike the token collections, this must not expire.

**API changes** (all under `/api/v1`)
- New: `GET /admin/students`, `GET /admin/students/:studentId`, `PATCH /admin/students/:studentId/status`, `PATCH /admin/users/:studentId/role`, `GET /admin/audit-logs`.
- Changed: `POST /auth/login`, `POST /auth/refresh` and `GET /auth/me` now return `role` and the caller's effective `permissions` array.
- Changed: `POST /auth/admin/login` returns `role: 'superadmin'` and issues a token marked `root`.
- Changed: `POST /auth/logout-all` is now `requireAuth()` rather than `requireAuth('student')`, which would have locked promoted admins out of their own session management.
- Changed: `POST /admin/generate-questions` is gated on `questions:write` and writes an audit entry.

**Security**
- `users:role:write` belongs to `superadmin` alone, so a compromised admin session cannot mint more admins.
- An ordinary admin cannot change the status of an account that holds a role; nobody can change their own role or status; an unverified or inactive account cannot be promoted.
- The admin listing's free-text search is regex-escaped, so `.*` matches literally instead of matching every account. `:studentId` params are constrained to `AMIT_` plus four digits.
- Refused privileged requests are recorded as `authz.denied` with the missing permission — a run of them is the signature of an escalation attempt.

**Frontend**
- `AuthContext` now carries `role` and `permissions` from the server and exposes `can(permission)`. `status` distinguishes only *which kind of account* is signed in, never what it may do.
- `AdminRoute` replaced by `RequirePermission`, which shows a real **unauthorized state** to a signed-in user instead of silently redirecting.
- New `Unauthorized` component; permission-filtered navigation in `Navbar` and in a new shared `AdminShell`.
- New pages: `/admin/users` (real paginated listing, search, status and role filters, suspend/reactivate, grant/revoke admin for a super admin) and `/admin/audit-log` (filter by action and outcome).
- `Admin.tsx`'s four hardcoded student rows and invented "15,000+ students" tiles are **gone**, replaced by real counts. The weekly-accuracy chart remains sample data and is now labelled as such.
- `api/client.ts` gained `patch`.

**Testing**
- New `backend/tests/rbac.test.ts` — **62 tests**, taking the suite from 44 to **106**. Covers: every admin route refused to a student (403) and to a guest (401), including through the unversioned `/api` alias; forged, role-tampered, unknown-role and role-less tokens; `role` submitted at registration being ignored; a demoted admin's still-valid token; suspended and deleted accounts; an admin trying to promote anyone or suspend a peer; cross-account analytics reads; and every audit entry, including refusals.
- `tests/setup.ts` provisions root-admin credentials in-process so the real admin-login path is exercised without committing a password hash.

**Verified**
- `npm test` (105 passed), `npm run typecheck`, `npm run lint`, `npm run compile` in `backend/`; `tsc -b && vite build` and `oxlint` in `frontend/`.
- Driven end-to-end in a browser against a real MongoDB: root admin sign-in, promotion, suspension, the audit trail, the promoted admin's reduced UI, and a student's unauthorized states. Escalation attempts were then made **directly against the API**, bypassing the UI entirely, plus cookie/`localStorage`/header tampering — all refused with 403 and no data leaked.

---

## 2026-08-04 — Milestone 2: Complete Authentication System

Authentication is now real end-to-end: registration, email verification, login, token refresh, logout, password reset, revocation, account status and lockout. **No mock authentication and no fake logged-in users remain anywhere.**

**Database changes**
- `Student` extended: added `email` (required, unique, lowercased), `isEmailVerified`, `status` (`active`/`suspended`/`deactivated`), `tokenVersion`, `failedLoginAttempts`, `lockedUntil`, `lastLoginAt`. `studentId` is now **unique**, and `passwordHash` is `select: false` so it cannot leak through a route that forgets to exclude it.
- New `RefreshToken` collection: SHA-256 hash only, per-login `familyId`, rotation bookkeeping (`revokedAt`, `replacedByHash`), TTL index.
- New `VerificationToken` collection: SHA-256 hash only, `type` (`email_verify` | `password_reset`), single-use `usedAt`, TTL index.
- **Breaking for existing data**: `email` is required and unique, so `Student` documents created before this milestone will fail validation on their next save. No migration script — see `TROUBLESHOOTING.md`.

**API changes** (all under `/api/v1`)
- New: `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/refresh`, `POST /auth/logout-all`, `POST /auth/forgot-password`, `POST /auth/reset-password`.
- Changed: `POST /auth/register` now requires `email`, enforces a stronger password policy, returns `201`, and **no longer issues a session** — the student must verify first.
- Changed: `POST /auth/login` now takes `identifier` (mobile **or** email) instead of `mobile`, and can return `403` with `code: 'EMAIL_NOT_VERIFIED'` or `423` when locked out.
- Changed: `POST /auth/logout` revokes the presented refresh token server-side rather than only clearing a cookie.
- Changed: the auth cookie `token` is replaced by `access_token` (15 min) plus `refresh_token` (30 days). **Any session issued before this deploy is invalidated.**

**Security changes**
- Access/refresh token split with rotation and theft detection: replaying a rotated refresh token revokes the entire token family.
- Both refresh and email tokens are stored as SHA-256 hashes only; raw values never reach the database.
- Email tokens are single-use, consumed atomically via `findOneAndUpdate` on `usedAt: null` so concurrent redemptions cannot both succeed.
- bcrypt cost raised from 10 to 12.
- Password reset revokes every session and bumps `tokenVersion`.
- Account lockout after 5 failed logins for 15 minutes.
- Per-endpoint rate limits replacing the single shared auth limiter (tightest on the email-sending routes, which consume a third-party quota).
- No account enumeration on login, `forgot-password`, or `resend-verification` — asserted by a test comparing known/unknown responses.
- `studentId` collision bug fixed (unique index plus retry-on-duplicate).

**Email**
- New `lib/email.ts` using `nodemailer` over plain SMTP, so any free-tier provider works via env vars alone. Falls back to writing emails (with working links) to the structured log when SMTP is unset, and captures them in memory under test.
- **Owner action still required**: SMTP is not configured, so production would only log emails. See `ENVIRONMENT_VARIABLES.md`.

**Frontend**
- `api/client.ts` transparently refreshes an expired access token once and replays the request, de-duplicating concurrent refreshes through one shared promise (necessary, or the backend's reuse detection would correctly kill the session).
- `AuthContext` gained verify / resend / forgot / reset / logout-everywhere, and now restores sessions across a browser reload by falling back to one refresh attempt.
- New pages: `/verify-email`, `/forgot-password`, `/reset-password`.
- Registration form gained an email field and a stronger password rule; the post-registration step now says "check your email".
- **Removed the fake OTP step** that accepted the hardcoded string `123456`.

**Breaking changes**
- All existing sessions are invalidated (cookie names changed).
- `POST /auth/login` request shape changed (`mobile` → `identifier`).
- `POST /auth/register` requires `email` and no longer logs the user in.
- Pre-existing `Student` documents need an `email` before they can be saved or logged into.

**Verification**
- Backend: `typecheck`, `lint`, `test` (**44/44**, up from 12) and `build` all pass; tests still pass after a build.
- Frontend: `lint` passes (one pre-existing warning) and `build` succeeds.
- **32 auth integration tests run against a real MongoDB** (`mongodb-memory-server`), covering both required journeys plus invalid and expired tokens, rotation reuse, revocation, account status and lockout.
- Additionally verified by hand against a real database and a real browser: registered, was correctly blocked from logging in unverified, verified via the real emailed link, logged in with the mobile number, hit a protected route, refreshed (confirming rotation), replayed the old token (confirming family revocation), then reset the password through the UI and confirmed the old password and pre-reset sessions were dead.
- Atlas connectivity itself remains unverified from this sandbox (network-restricted); a local MongoDB was used instead.

---

## 2026-08-04 — Milestone 1: Backend & Database Foundation

Foundation work only — **no new product features, no new business endpoints**. All pre-existing route behaviour and response shapes were preserved.

**Structure**
- Split the single ~450-line `backend/src/server.ts` into a modular app: `config/`, `db/`, `lib/`, `middleware/`, `models/`, `routes/v1/`, `validation/`.
- `src/app.ts` now assembles the Express app (imported by both the local server and the Vercel entry); `src/server.ts` is reduced to process bootstrap plus graceful shutdown.
- `backend/api/index.ts` now imports from `src/app.ts` instead of `src/server.ts`.
- The 5 Mongoose models moved to one file each under `src/models/`, each with an exported TypeScript document interface. **No schema changes.**

**New capabilities**
- Environment validation via zod (`config/env.ts`) with a typed app config (`config/index.ts`); no other module reads `process.env`.
- MongoDB connection module with cached, de-duplicated connects and an explicit `serverSelectionTimeoutMS` (8s; 300ms under test) instead of Mongoose's 30s default.
- Structured logging (pino) and request logging (pino-http).
- Global error handler + 404 handler emitting the standard `{success:false, error}` envelope, hiding internals in production.
- Request validation architecture (`middleware/validate.ts`) with zod schemas per route.
- `GET /health` (liveness, no DB) and `GET /ready` (503 when Mongo is disconnected), both mounted before the rate limiter so probes are never throttled.
- Graceful shutdown on SIGTERM/SIGINT with a 10s forced-exit fallback.
- Backend test suite: vitest + supertest, 12 tests, no database required.
- ESLint + typescript-eslint for the backend; `build`, `typecheck`, `lint`, `test`, `test:watch` scripts.
- `backend/.env.example` with placeholder values.

**API changes**
- All routes are now served at **`/api/v1/*`** (canonical). The unversioned **`/api/*`** is retained as a compatibility alias mounting the same router, so existing clients keep working. A test asserts both return the same status.
- The frontend was migrated to the versioned API through a single `API_BASE = '/api/v1'` constant in `frontend/src/api/client.ts`; callers now pass version-agnostic paths (`/auth/login`). No deploy config changed, because both the Vite dev proxy and the Vercel `/api/(.*)` rewrite pass the remaining path through unchanged.

**Security changes**
- `JWT_SECRET` is now **mandatory in production** — startup throws instead of falling back to a hardcoded default (previously it only warned).
- CORS no longer falls back to reflecting any origin; it always uses an explicit allow-list and warns if `FRONTEND_URL` is unset in production.
- Added `helmet` and disabled `x-powered-by`.
- Added rate limiting: a general limiter on `/api` and a stricter limiter on the three auth routes.
- `GET /questions` query params are now schema-validated before any Mongoose filter is built.
- Corrected a factual error in `SECURITY.md`: the documented `qs` bracket-notation NoSQL-injection vector does not apply, because Express 5 defaults to the `'simple'` query parser. Verified empirically against Express 5.2.1.
- Per owner instruction, security behaviour is **implemented but deliberately not automatically tested** at this milestone (see `TESTING.md`).

**Bug fixes found by actually running the app**
- Restored `.env` loading. The refactor had dropped `dotenv.config()`, so locally the backend silently ignored `backend/.env` — falling back to `localhost:27017` and port 8080 instead of the configured Atlas URI and port 8081.
- Fixed the request-validation middleware crashing on success. `req.query` is a getter-only accessor in Express 5, so assigning the parsed value threw `Cannot set property query of #<IncomingMessage>`, returning 500 for otherwise-valid requests. Now uses `Object.defineProperty`.
- Added `middleware/ensureDb.ts`. The refactor had left the serverless path with **no database connection at all** (`api/index.ts` imports `app.ts`, which never called `connectDB()`), so production would have failed on every data route. DB-backed routes now connect lazily per request and return a clean 503 when the database is unreachable.
- Local boot no longer exits when MongoDB is unreachable; the server starts and `/ready` reports the true state, so a transient database problem doesn't require a manual restart.
- Fixed `npm run build` and `npm test` being mutually exclusive: `tsc` was compiling `tests/` into `dist/`, after which vitest tried to run the emitted CommonJS copies and crashed.

**Database changes**
- None. No schema, field, index, or collection changed.

**Breaking changes**
- None for API consumers (the unversioned alias preserves compatibility). One **deployment-ordering requirement**: deploy the backend before the frontend, since the frontend now calls `/api/v1/*`.

**Verification**
- Backend: `typecheck`, `lint`, `test` (12/12), and `build` all pass; `build` followed by `test` also passes.
- Frontend: `lint` passes (one pre-existing fast-refresh warning) and `build` succeeds.
- Both servers were run together: `/health` returned 200, `/ready` correctly returned 503 with the database unreachable, validation returned 400, unknown routes 404, protected routes 401, the versioned and aliased paths matched, and the SPA loaded in a browser with no console errors, reaching the backend through the Vite proxy.
- **Live MongoDB Atlas connectivity remains unverified** — blocked by sandbox network restrictions, not by credentials. See `TROUBLESHOOTING.md`.

---

## 2026-08-04 — Phase 0 repository audit (no code changes)

- Performed a full read-through of the existing repository: `frontend/` (React 19 + Vite SPA, 9 pages) and `backend/` (single-file Express + Mongoose API).
- Created the full project documentation set: `CLAUDE.md`, `PROJECT_STATE.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`, `FEATURE_STATUS.md`, `SECURITY.md`, `ENVIRONMENT_VARIABLES.md`, `DEPLOYMENT_GUIDE.md`, `TESTING.md`, `CHANGELOG.md`, `DECISIONS.md`, `TROUBLESHOOTING.md`.
- No source code was modified. No database changes. No API changes. No security changes (issues found are documented in `SECURITY.md`, not yet fixed).
- Key findings recorded: real auth (register/login/admin login) is genuinely wired to MongoDB; most "feature" pages (exam, results, certificates, leaderboard, daily challenge, admin student list, analytics for real students) are either hardcoded mock UI or backend endpoints the frontend never calls. Full detail in `FEATURE_STATUS.md`.

---

## Prior history (reconstructed from `git log`, pre-dates this documentation set)

- **`9dbdf27`** — Rebuilt the frontend in React (from an earlier non-React form), added real bcrypt+JWT authentication, and split the project into two independently deployed services (frontend/backend). This is the current architecture baseline.
- **`e19adb6`** — Pinned TypeScript to `5.9.3` in the backend to fix a Vercel build failure caused by a newer/incompatible TypeScript version.
- **`6df3e60`** — Merged a branch restructuring the project for a working Vercel deployment.
- **`1938876`** — Restructured the project layout to get Vercel deployment working.
- **`9bba7cf`** — Fixed Vercel configuration (earlier attempt).
- **`c32c717`** — Fixed Vercel deployment (earlier attempt).
- **`0fdd1b5`** — "all code" — initial/bulk commit of the original (pre-React-rebuild) codebase.

Note: commits prior to `9dbdf27` describe a different, earlier architecture (pre-dating the React rebuild and service split) that no longer reflects the current codebase — treat only `9dbdf27` onward as describing the current system.
