# MILESTONE_27_PROGRESS.md — re-pointing the frontend onto the Brightpath reference

_Working notes for Milestone 27. Temporary: fold into [`PROJECT_STATE.md`](PROJECT_STATE.md)
and delete when the milestone closes, exactly as `MILESTONE_26_PROGRESS.md` will be.
[`MILESTONE_27_PREP.md`](MILESTONE_27_PREP.md) is the record of what was decided **before**
work started and stays until close; this file is what has actually happened._

## The reference

`https://brightpath-wbs.framer.website/` — "Brightpath", an education/tutoring Framer
template. Warm cream page, forest-green ink, orange CTA, pastel category cards, hard
offset shadows, Bricolage Grotesque over Instrument Sans.

**It is measured off the live site, not out of Figma.** The owner's Figma seat is a *View
seat on a Starter plan → 20 MCP reads per month*, which does not cover a 54-route
extraction. The Framer site is the same design, free to read, and gives real computed
values instead of values transcribed off a screenshot — the method Milestone 26 used
against Tokko. Figma is held in reserve for gaps the public site cannot show. See the
Milestone 27 ADR in [`DECISIONS.md`](DECISIONS.md).

## Answers to the three questions the prep file said to settle first

1. **Variables or raw hex?** Moot — see above. Values come from `getComputedStyle` on the
   live reference, which is strictly better than either.
2. **Does the design include a dark theme?** **No.** The reference carries zero
   `prefers-color-scheme: dark` rules. Owner chose *keep dark mode and derive it from the
   new palette*, so the dark theme is ours and is verified independently.
3. **Which screens does the file cover?** The reference is a marketing site: a landing
   page and a contact page. **Every one of this product's 54 routes is an inheriting
   route.** That is the whole risk of the milestone and the reason the token layer was
   done first, alone, and verified before anything else moved.

## Phase 1 — the token layer (done)

`frontend/src/styles/tokens.css` + `frontend/index.html`. Two files; **no page edited**.

- **Zero tokens dropped.** All 216 Milestone 26 names survive, 29 added → **245 unique,
  326 declarations**. Verified by diffing the token-name sets against
  `git show HEAD:frontend/src/styles/tokens.css`. This is what guarantees no page breaks
  on a missing variable, and it is worth re-running after any later token edit.
- Ink ramp rebuilt on `#14261d` (green, never grey, never black); **five of the thirteen
  steps are values read directly off the reference** — the page `#f4f0e5`, the sand band
  `#eae4d3`, secondary text `#45564b`, the action `#1b3428`, the ink itself. Verified
  monotonic in relative luminance.
- **`--bg` and `--surface` are different colours now** (cream page, white card). That one
  fact is the milestone's first idea.
- New: the `--edge-*` geometries, the orange ramp, `--brand-*`, `--green-mid`, six
  `--cat-*-edge`, `--primary-edge`, `--accent-solid`.
- Fonts swapped in `index.html`; **those two files are the only places a family is named.**

### Verified, not assumed

| Check | Result |
|---|---|
| Frontend `npm run build` (`tsc -b && vite build`) | passes; main bundle **247 kB / 76 kB gzipped**, unchanged |
| Frontend `npm run lint` (oxlint) | clean (3 pre-existing fast-refresh warnings in context files) |
| Contrast, `/` light theme | **0 failures** / 189 text nodes |
| Contrast, `/` dark theme | **0 failures** / 189 text nodes |
| Wordmark gradient endpoints (light) | 15.85:1 and 7.56:1 |
| Wordmark gradient endpoints (dark) | 13.59:1 and 11.59:1 |
| Token name set vs `HEAD` | 0 dropped, 29 added |

Backend untouched — this phase changes two frontend files and no API contract, model,
permission or route.

## Phase 2 — the design system (done)

`ui/Card`, `ui/Button` (+ `.tsx`), `ui/IconTile`, `styles/base.css`, `pages/DesignSystem`.

- **`Card` is flat.** `box-shadow: none`; separation is white-on-cream. `.plain` is now the
  only card variant with a drawn line, and `interactive:hover` is a fill shift plus a 2px
  rise rather than a deepening shadow. It deliberately does **not** grow an edge on hover —
  that would make a card look momentarily like a button.
- **`Button` carries the edge**, driven by three variables so one base rule serves every
  variant: `--btn-edge` (colour, from the variant), `--btn-lift` (how far it extends) and
  `--btn-press` (how far the control travels on `:active`). `--btn-press` is separate
  because a flat variant still needs 1px of feedback while a raised one must travel its
  full offset so the edge visibly **collapses**. `.sm` takes a 2px edge via `.sm.primary`
  etc. — two classes, so specificity beats the variant rule without depending on order.
- **A `brand` variant exists** — the orange CTA, ink label, once per page. Added to
  `ButtonVariant`; nothing else in the union moved, so the 37 `outline` call sites and the
  forty pages importing the old `components/Button` are untouched.
- **`IconTile` takes a diagonal offset** (`3px 3px 0`, scaled to 2px at `sm` and 4px at
  `lg`) in each pastel's companion. Diagonal on a marker, vertical on a button — the
  reference's own distinction, and worth keeping.
- **`base.css`: body weight 500 → 400** (the display face carries the hierarchy now) and
  `h3` tracking −0.06em → −0.04em, which is what the reference measures at 24px.
- **`/design-system` brought current** — 12 edits. It had been arguing for one font family,
  a near-black action, colour confined to one component and a card with a shadow, all of
  which are now false.

### Two real defects, both caught by sweeping `/design-system`

Neither was reachable from the landing page, which is the argument for that page existing:

1. **`--accent-on` was white on a light gold fill — 2.14:1.** Mine, and instructive: I
   added an `--accent-solid` (gold-600) for symmetry with the other four status ramps and
   then set `--accent-on` white to pair with it — but `--accent-on`'s only two consumers
   (`Badge`, `IconTile`) fill with `--accent-strong`, which is **gold-400**, a light fill.
   Milestone 26 had it as ink for exactly this reason. It is ink again (7.40:1), and
   **`--accent-solid` was removed rather than documented**: it had zero consumers, and its
   mere existence is what produced the wrong pairing.
2. **Dark `--warning-solid` failed at 4.44:1 and `--success-solid` "passed" at 4.51:1.** A
   0.01 margin is not a pass, it is luck. Green and amber are *light* hues, so a mid step
   cannot carry a label with any room — both now lighten to the `300` rung (7.93:1 and
   9.52:1). Danger and info deliberately stay saturated with white labels (5.27, 5.64): a
   pale pink badge reads less urgent than a red one, and they have the headroom to stay red.

### Verified

| Check | Result |
|---|---|
| `npm run build` | passes, main bundle still 247 kB / 76 kB gzipped |
| `npm run lint` | clean (same 3 pre-existing warnings) |
| Contrast, `/design-system` light | **0 failures / 408 text nodes**; tightest margin 1.04× |
| Contrast, `/design-system` dark | **0 failures / 408 text nodes**; tightest margin 1.17× |
| Computed treatment | card `box-shadow: none` r20; primary `rgb(73,126,100) 0 4px 0`; brand orange with **ink** label; tile `rgb(84,136,178) 3px 3px 0`; ghost/outline/subtle no edge |

## Phase 3 — the landing page (done)

`pages/Landing` (both files), plus two token additions. This is the **one route the
reference actually designs**, so it is the only page where fidelity is a question with an
answer; everything else inherits.

Two rules had silently inverted when the tokens were re-pointed, and neither errored:

- **The hero painted `--surface`.** Correct when the page was near-white and a card was
  white — the difference was invisible and a radial tint did the work. With cream pages and
  white cards it made the hero a **white rectangle on a cream page**, the exact inverse of
  the reference. It now paints nothing and inherits the page; the radial tint went with it,
  because on cream it read as a smudge rather than as light.
- **`.stripe` painted `--bg`.** In Milestone 26 that was `--ink-25` against a white
  `--surface` — a faint tint. Now `--bg` *is* the page, so the rule became
  `background: <the page>` and **the alternating band stopped existing** without anything
  breaking. That is the characteristic failure of a token re-point: nothing errors, a
  distinction just quietly disappears. It is `--bg-subtle` (sand) now.

Added: `.stripeBlue`, the reference's second band tint, on the Top-scholars section — its
people section, which the reference puts on pale blue. And the step markers became the
reference almost verbatim: **44×44 pastel squares with a `3px 3px 0` diagonal edge**, a
different pastel per step, replacing green circles. Four pastels telling four otherwise
identical things apart is the one place a categorical colour does its actual job here.

### The defect worth reading: a theme-invariant fill behind theme-dependent text

The pale blue band shipped broken and took **two** passes to fix, and the intermediate
state was worse than the first.

1. **First attempt** — `.stripeBlue { background: var(--cat-blue) }`. The pastels are
   theme-invariant by design; `--text` and `--text-muted` are not, and invert to warm
   off-white in dark. Result: **six failures at 1.09–1.22:1** — cream on pale blue.
   Milestone 26 never hit this because it confined the pastels to `IconTile`, which pins
   `color` to the fill's own `-on`.
2. **Second attempt** — an `.on-pastel` utility re-pointing the text tokens to an invariant
   ink set on the container. It fixed the band and **broke the cards inside it**: a `Card`
   paints `--surface`, near-black in dark, and its text was now pinned to ink — **ten
   failures at 1.00:1**, worse than before.
3. **The actual fix** — `--band-accent`, a token: `--cat-blue` in light,
   `--surface-raised` in dark. Same mechanism and same reason as `--card-border`.

The narrow lesson, now written into `tokens.css`: **pinning text on a container pins it for
the whole subtree, and a subtree containing a themed surface cannot be pinned.** An
invariant fill is only safe under *leaf* content — a glyph, a numeral, a label. `IconTile`
and the step markers qualify; a section band does not.

`.on-pastel` was **removed rather than kept for later**, on the same reasoning that removed
`--accent-solid` an hour earlier: an unused affordance whose only plausible use is the one
that just failed is a trap, not a head start. The invariant ink set (`--ink-text*`,
`--ink-border*`) stayed, because the light theme now points at it — so "ink on a light
surface" has one definition instead of two that can drift.

### Verified

| Check | Result |
|---|---|
| `npm run build` / `npm run lint` | pass / clean |
| Contrast, `/` light | **0 failures / 188 nodes**, tightest margin 1.07× |
| Contrast, `/` dark | **0 failures / 188 nodes**, tightest margin 1.27× |
| Overflow at 320px | **0px** (scrollWidth 320 = viewport) |
| Overflow at 1280px | **0px** |
| Contrast at 320px, dark | 0 failures / 182 nodes |

## Phase 4 — the correctness sweep (done)

Eighteen declarations across ten files, plus the rationale on two comments that had
started arguing from something that no longer exists.

### The one real defect class: `--bg` used as an inset

Ten files said `background: var(--bg)` to mean "a recessed area inside a card". That
worked while `--bg` was a near-white `--ink-25` against a white `--surface`. Now `--bg`
**is** the page, so every one of those sitting on the page rather than inside a card
collapsed to **1.00:1 against its own parent** — an invisible surface, with nothing to
error on.

All eighteen became `--fill-subtle`, and the rule is now written where the tokens are
declared: **a nested fill is an alpha fill.** `--fill-subtle` and `--fill-muted` darken
whatever they sit on, so a step against the parent is guaranteed by construction; a
surface token cannot promise that. `--bg` and `--bg-subtle` are for an element that *is*
a page or a full-bleed band. The rule survives the next re-point, which a hand-picked
pair of surface tokens would not.

The **seven** remaining `var(--bg)` backgrounds were each checked and are all genuinely
page-level: `html` / `body` / `#root`, `AppShell`’s `.shell` and `.sidebar`,
`ForcePasswordChange`’s `.wrap` and `Admin`’s `.loginWrap`. The sidebar is deliberately
the same colour as the shell, separated by one hairline — its comment justified that by
"the hierarchy the shadow-based cards want", which stopped being true in phase 2, so it
now explains the fill-based version of the same argument.

### A local backend, which is what made this verifiable

The earlier phases could only sweep guest and error states. This machine turns out to
have **MongoDB 8.3 listening on 127.0.0.1:27017**, so `npm run dev:local --prefix
backend` gives a real API, and `scripts/seed-demo.ts` already had a Class 9 student
provisioned (`demo.class9@amit.test` / `Demo@1234`, entry fee captured, 73 published
questions). Only today’s daily challenge needed writing.

**There is no `backend/.env` in this checkout**, which is worth knowing because
`CLAUDE.md` warns at length that it holds the production Atlas URI. It does not exist
here, so `MONGO_URI` falls back to its localhost default and there is no way for a seed
to reach production. `dev:local` targets `amit-olympiad-local` while that default is
`amit-olympiad` — a seed must be given `MONGO_URI` explicitly or it stocks a *different*
local database and reports success, which is the same shape as the bug `envGuard.ts`
was written for.

Admin sweeps used the `dev:local` root account (`root@localhost` / `LocalDevAdmin9`).
Note `/auth/admin/login` takes **`email`**, not the `identifier` the student route
takes.

### Verified — 23 routes, both themes

0 WCAG AA failures and 0px page overflow on every route below, in **both** themes, with
transitions disabled. Roughly **2,030 text nodes** in total.

| Group | Routes swept | Text nodes |
|---|---|---|
| Public | `/` 166, `/leaderboard` 42, `/hall-of-fame` 31, `/gallery` 31 | 270 |
| Student | `/dashboard` 94, `/rewards` 128, `/profile` 83, `/analytics` 71, `/daily-challenge` 66, `/mock-tests` 49, `/practice` 48, `/referrals` 48, `/payment` 41, `/notifications` 37, `/my-certificates` 32 | 697 |
| Admin | `/admin/daily-challenges` 462, `/admin/users` 111, `/ai-generator` 76, `/admin/payments` 72, `/admin/system` 71, `/admin/questions/import` 67, `/admin/referrals` 56, `/admin/mock-tests` 50 | 965 |

Also swept at **320px**: `/`, `/admin/daily-challenges` (427 nodes), `/admin/users`,
`/admin/questions/import` — 0 overflow, 0 failures. And `/` at 1280px.

**Coverage is 23 of 56 declared routes, and the gap is not nothing.** Unswept: most of
the remaining admin console, and every parameterised route (`/practice/:sessionId`,
`/exam/:attemptId`, `/mock-tests/attempts/:attemptId`, `/admin/questions/:id/edit`,
`/result`, `/certificate`) which needs data a seed does not create. The three question
runners are the most important of those and are **specifically flagged in `CLAUDE.md`**
as one design in three files.
## Phase 5 — no page surface has a shadow (done)

Phase 2 flattened `ui/Card`. It did not flatten the **twenty-four other page surfaces**
that were carrying `--shadow-*` directly, which is how `/dashboard` ended up with flat
cards beside lifted action cards — two separation systems on one screen.

An audit split every `--shadow-*` reference by its enclosing selector: **24 page
surfaces against 6 genuine overlays.** Eighteen base rules became `box-shadow: none`
and two hover rules that deepened a shadow became a fill shift (`--surface-hover`),
which is the same treatment `ui/Card`’s `.interactive` got.

**Four were deliberately kept, and the reason is the same in each case — they are not
part of the page:**

- `AppShell .skipLink` — appears *over* content when focused.
- `AppShell .bottomNav` — fixed over content on a phone.
- `Navbar .inner` — a sticky bar that content scrolls under.
- `Certificate .certificate` — a **document**, not a product surface. The shadow is what
  makes it read as a sheet of paper, which is the one place in this product where
  "floating" is the correct metaphor rather than a leftover.

Two `--shadow-xs` lifts on *active* states also went: `Navbar .linkActive` and
`ui/Tabs .pill .tabActive`. An active nav item or tab is marked by its **fill** in this
language; a 1px shadow on a pill was doing the job colour already does.

So `--shadow-*` now means exactly what its comment in `tokens.css` claims: the overlay
scale, for the modal, the drawer, the menu, the toast and the tooltip — the five things
a marketing-page reference never had to solve.

### The check that made this safe

Flattening a card is only correct if a **fill** still separates it, and a card nested on
another white card would have gone invisible. So the sweep gained a third probe: for
every element larger than 80×32 that sets its own background and has **no** shadow,
border or outline, composite it over its parent’s effective background and flag anything
under **1.02:1**.

It found one thing on its first run — `AppShell`’s sidebar at 1.00:1 — which is the
documented intentional case (page colour, separated by one hairline). The probe was
only checking `border-top`, so a `border-right` looked like no border at all. With all
four edges checked: **0 invisible surfaces on every route swept.**

### Verified

| Route | Nodes | Contrast (light/dark) | Overflow | Invisible surfaces |
|---|---|---|---|---|
| `/admin/questions` | 239 | 0 / 0 | 0px | 0 |
| `/rewards` | 128 | 0 / 0 | 0px | 0 |
| `/dashboard` | 94 | 0 / 0 | 0px | 0 |
| `/admin` | 72 | 0 / 0 | 0px | 0 |
| `/notifications` | 37 | 0 / 0 | 0px | 0 |
| `/gallery` | 30 | 0 / 0 | 0px | 0 |

Between them these cover `StatTile`, `Table`’s card, `Dashboard`’s `.actionCard`,
`Notifications`’ `.unreadItem`, both gallery tiles, `Admin`’s `.quickCard`, and
`Questions`’ `.filters` and `.card`. `RegisterForm .card` is covered by the landing
sweep, since the landing page is what renders it.

**Not verified in a browser:** `AuthLayout .card` (the four pages reached from an email,
which need a live token) and `ForcePasswordChange .card`. Both are a single centred card
on the page, which is the case least likely to lose its fill separation — but that is an
argument, not a measurement, and it is recorded as the latter.
## Phase 6 — the student pages take the reference’s patterns (in progress)

Owner’s scope decision: correctness everywhere, **patterns** on the student-facing
routes, correctness only on the admin console — the reference is a marketing site with
nothing to say about a dense table, and a coloured admin console would be worse rather
than better.

### Figures are set in the display face

`--font-heading` is a *different family* from `--font-body` now, so a rule naming it is
a real change where before Milestone 27 it would have been a no-op. `ui/StatTile`’s
`.value` and the dashboard’s `.xpValue` both take `--font-heading` with
`--tracking-display`, which is how the reference sets 900+, 92% and 4.9/5 — and most of
why those read as *figures* rather than as sentences. `tabular-nums` stays, and matters
more than before: a column of tiles whose digits are different widths jitters as the
numbers update.

Because it lands in `StatTile`, this reaches every page with a stat tile rather than
just the dashboard.

### Two more hand-rolled tiles became `ui/IconTile`

The dashboard had **two** bespoke tinted squares: `.actionIcon` (42px, `--primary-soft`)
on the three "Jump back in" rows, and `.levelIcon` (38px, `--success-soft`). Both are
`ui/IconTile` now, so both get the pastel fill and the hard diagonal edge for free —
which is what the reference puts beside a row of exactly this shape.

The three action rows take **different tones** (blue, green, magenta): three things a
reader has to tell apart is the one job a categorical colour actually has. The level
glyph takes **gold**, because a level is a distinction tier, and gold is the one colour
in this product reserved for something *earned* rather than for a bucket.

Deleting the two classes rather than restyling them is the point: a primitive that
already exists should not have a second implementation.

### Declined: the dark-green headline panel

The reference’s visual anchor is a **dark green stat panel** with cream text, and the
dashboard’s XP/level card is its structural equivalent. It was not built, and the reason
is worth recording rather than rediscovering:

1. **It is a subtree polarity flip, which is the shape that has already failed twice**
   this milestone (the pastel band, then the pinned band). `Progress` resolves `--text`,
   `--text-muted`, `--surface-active` **and `--primary`** — and `--primary` is the panel
   fill, so the bar would be the same colour as the card it sits on. Inverting it means
   re-pointing four tokens inside two components that have their own semantics.
2. **The reference’s panel is a marketing stat block** ("900+ learners since 2018").
   The dashboard’s card is a *functional control*: a real value out of a real maximum,
   which `CLAUDE.md` protects specifically. Turning it into a decorative anchor works
   against what it is for.
3. `Badge` tones are semantic and `Progress` must stay determinate. Re-pointing either
   for visual effect is how those rules erode.

If the owner wants the dark panel, the honest way to build it is a **new** component with
no `Progress` or `Badge` inside it, and its own matched fill/text token pair — not a
flipped `Card`.

### Verified

| Route | Width | Nodes | Contrast (light/dark) | Overflow | Invisible |
|---|---|---|---|---|---|
| `/dashboard` | 1265px | 113 | 0 / 0 | 0px | 0 |
| `/dashboard` | 320px | 91 | 0 / 0 | 0px | 0 |
| `/analytics` | 1265px | 128 | 0 / 0 | 0px | 0 |
| `/analytics` | 320px | — | 0 / 0 | 0px | — |

Computed: the action tiles are 56×56 pastels carrying `4px 4px 0` in their own
companion with ink glyphs; the XP figure is Bricolage Grotesque 32px/700 at −2.56px
(−0.08em), clamping to 24px at 320px where it fits its 74px parent exactly.

`/analytics` at 320px reports a `TABLE` 193px wider than the viewport while the **page**
overflows 0px. That is `TableScroll` working as documented — contained horizontal scroll,
page never draggable off its edge — and not a finding.
## Phase 7 — the podium medals, and where the patterns stop (done)

### The medal defect, which was the open finding from phase 2

Both `/hall-of-fame` and `/leaderboard` drew the first-place medal in
`--accent-strong` (`--gold-400`): **2.14:1 on white, 1.88:1 on the cream page** — below
even the 3:1 a non-text graphic needs. The gold medal was the *least* visible of the
three. Third place used `--gold-600` directly, which is fine in the light theme and
near-invisible in the dark one.

The cause is worth stating precisely, because it is the same shape as three earlier bugs
this milestone: **the palette is not re-pointed per theme — only the semantic layer is.**
So a component naming a palette step gets one fixed colour in both themes, and any such
choice is wrong in one of them. `--medal-gold`, `--medal-silver` and `--medal-bronze`
are declared in **both** themes and verified against the worst surface each can land on.

Measured after: gold **5.39:1** light / **10.01:1** dark; silver **4.82** / **7.63**.
Bronze is a literal, because there is no bronze ramp and this is its only use — a whole
ramp for one glyph would be worse than one documented literal in the file where literals
belong.

The medals are **not** the only carrier of rank — the position is written beside the
glyph — which is why the requirement is 3:1 visibility rather than the three being
tellable apart by hue. That is the same rule as "no icon may be the only carrier of
meaning", applied to a decoration.

### Where the reference’s patterns legitimately stop

Three candidates were examined and **declined**, and the reasons are more useful than
the changes would have been:

- **`/practice`’s chapter picker** is the closest thing here to the reference’s "Pick a
  program" pastel cards — but it is a `<select>` inside a `Field`. Turning it into a grid
  of twelve pastel cards changes the *interaction*, not the styling, and a select is the
  right control for choosing one of twelve chapters on a phone.
- **`/rewards`’ badge grid** encodes **tiers** (bronze / silver / gold). Pastel category
  fills would fight that meaning, and `CLAUDE.md` is explicit that gold is achievement
  rather than a bucket.
- **`/rewards`’ `.stageMarker`** encodes journey **state** (locked / current / done). Same
  argument: the colour is carrying a fact, so a categorical hue would overwrite it.

This is the honest end of the pattern work rather than a shortfall. The reference’s
vocabulary is a pastel marker beside a row, a display-face figure, a tinted band, a hard
offset edge and a pastel category card. The first four are applied and reach every page
through `IconTile`, `StatTile`, `Button` and the token layer. The fifth has **one**
honest home in this product — the landing page, where it is used — because everywhere
else that looks like a category grid is actually encoding a state.

### Verified

| Route | Width | Contrast (light/dark) | Overflow | Medals (light/dark) |
|---|---|---|---|---|
| `/hall-of-fame` | 320px | 0 / 0 | 0px | — |
| `/hall-of-fame` | 1265px | 0 / 0 | 0px | 5.39 / 10.01 gold, 4.82 / 7.63 silver |
| `/leaderboard` | 1265px | 0 / 0 | 0px | same trio |

`/hall-of-fame` is worth the explicit 320px row: Milestone 26 found it **28px over** from
a `minmax(330px, 1fr)` floor, so it is the page most likely to regress on width.
## The frontend-only claim, proved

`git diff` across the eight Milestone 27 commits touches **44 files, none of them under
`backend/`**. The backend suite was run anyway, because "I did not touch it" and "it still
works" are different statements:

**1,289 tests passed across 36 files** (671s), which is exactly the figure
[`PROJECT_STATE.md`](PROJECT_STATE.md) records at the close of Milestone 25 — so no test
was added, removed or broken.

One thing to keep straight when reading `git log`: the range `9b11450..HEAD` *does* contain
a backend change, `backend/src/routes/v1/auth.routes.ts`. It belongs to **`88d41fb`**
("One sign-in form: finish the adminLogin -> login merge"), which was already sitting
unpushed on `main` when this milestone started and is not part of it. Milestone 27 is
`56aa87e..HEAD`. That commit is also why `/auth/admin/login` now takes **`email`** rather
than the `identifier` the student route takes — worth knowing before writing a login call.

## Phase 9 — the fourth question runner (done)

`CLAUDE.md` says the runners are "one design, in three files". **There are four.** The
official exam runner is the one that sentence forgets, and it had never been migrated —
not in Milestone 23, which built the design system, nor 26, which re-pointed the
language. `Exam/ExamAttempt.module.css` was 27 lines of minified pre-Milestone-23 CSS.

Practice, MockTest and DailyChallenge are **byte-identical** on `.option`, so those three
genuinely are in step. The exam carried:

- **two hardcoded colours** — `rgba(56,189,248,.08)` on the chosen option and
  `rgba(34,197,94,.16)` on an answered palette square. The first draft of this entry
  also called the blue wrong *because* the language had no blue in it; Milestone 28
  made the action blue and retired that half of the argument. What survives is the half
  that mattered — a hardcoded literal follows neither the theme nor any re-point;
- the legacy `--royal-blue` and `--text-main` aliases, three uses each;
- a **36px** palette square and an option row with **no minimum height**, against a 44px
  touch floor and a 56px option;
- a 1px border where the design is 2px, and **no tint and no filled key circle** — so the
  chosen answer was signalled by border colour *alone*, on a single hairline;
- hand-rolled `.nav button` styling sitting beside a real `ui/Button`;
- ~30 hardcoded px values, two hardcoded line heights, a hardcoded `z-index` and
  `border-radius: 50%`.

It is rewritten onto the shared idiom, copied from `Practice.module.css` rather than
re-invented. **All 20 class names are unchanged**, so the only TSX edit was the two raw
`<button>`s in the nav becoming `ui/Button`.

That this was the worst screen in the codebase is the part worth sitting with: it is the
paper a child pays the entry fee to sit, and it looked like a different application from
the three runners they practise in.

### 12 more stranded literals in the other three runners

All pre-Milestone-26 palette values — old emerald `16,185,129`, red `239,68,68`, amber
`245,158,11`, slate `148,163,184` — so they followed neither the theme nor the recolour.
Each mapped onto the tint its own selector is named after: `.optCorrect` →
`--success-soft`, `.optWrong` → `--danger-soft`, `.verdict_skipped` → `--warning-soft`.

### The wider finding, and a correction to CLAUDE.md

`CLAUDE.md` claims **"`--royal-blue` is referenced zero times outside `tokens.css`"**.
It is referenced **18** times, across 13 files. `--text-main` is used **40** times and
`--gold` 10. Those all still resolve correctly — the aliases point at `--text`,
`--primary` and `--accent` — so this is a documentation error rather than a visual defect.

The real residue is **157 hardcoded colour literals** (137 `rgba()`, 20 hex) outside
`tokens.css`, concentrated in `Admin/Questions` (14), `Admin/MockTests` (13),
`Admin/QuestionImport` (11) and `Rewards` (10). These are old slate/blue/emerald values
that follow neither the theme nor the recolour, and **they are invisible to a contrast
sweep unless the exact page and state is visited** — which is why phases 1–8 did not
catch them. The claim that the recolour was "a one-file change" holds for anything using
a *token*; it was never true of these.

## SUPERSEDED IN PART BY MILESTONE 28 — read this before trusting a figure here

_Added 2026-09-21, at the point Milestone 27 stopped._

A second session is running **Milestone 28**, which **re-points `--primary` from the deep
green back to royal blue**. The owner has confirmed that is intended, so Milestone 27’s
green standard action is a superseded decision, not a defect to defend.

**What that invalidates, and what it does not.**

Every contrast figure in this file was measured against a green `--primary`. There are
**96 `--primary`-family usages outside `tokens.css`** (14 of them inside `ui/`), and
`--primary` is the fill sitting behind `--primary-on` labels on buttons, badges, progress
bars, the option row’s chosen state and the palette’s current marker. So:

- **Re-run the full sweep.** 0 failures across 25 routes in both themes was true of the
  green. It says nothing about the blue. The blue also has to clear the `--primary-edge`
  companion relationship, which was a *lighter* green in light and a *darker* one in dark.
- **The focus ring needs checking against the button.** Milestone 28’s own note says the
  ring is safe on a blue fill only because `base.css` draws it at `outline-offset: 2px`,
  so the ring never touches the fill. That is a real dependency between two files and
  worth re-verifying rather than trusting.
- **Everything structural stands.** The flat cards, the alpha-inset rule, the hard offset
  edge, the display-face figures, the four-runner fix, the medal trio and the
  theme-invariant-fill rule are all independent of which hue `--primary` is. So are the
  157 stranded literals — those follow neither palette.

**Why Milestone 27 stopped here rather than finishing.** The two sessions were editing the
same working tree: `tokens.css`, `Landing.tsx`, `CLAUDE.md`, `DECISIONS.md` and
`PROJECT_STATE.md` were all being rewritten concurrently. Milestone 27’s commits were
staged **file-by-file** rather than with `git add -A` so that none of the other session’s
in-progress work rode along — worth repeating if this ever happens again, because
`git add -A` in a shared tree commits whatever somebody else is halfway through.

## Reconciliation against Milestone 28 (the blue) — done, 2026-09-21

The other session stopped editing and its work **builds cleanly (0 tsc errors)**, but it
is **still uncommitted** — 20 files, including the full doc set. HEAD is unchanged. So
this is a verification pass against a working tree, not against a commit, and **no fix
was applied for anything the blue causes**: committing a fix whose cause is uncommitted
would leave HEAD incoherent for anyone who checked it out.

### Their figures were checked rather than trusted, and every one is right

They built a real `--royal-*` ramp (`--royal-500: #0052ff`, "THE BRAND — the original,
from the first commit") and annotated it with contrast ratios. Re-computed independently:

| Their claim | Measured |
|---|---|
| white on `--primary` 5.75 | **5.75** |
| `--primary-text` 7.44 / 6.53 / 5.86 on surface / cream / sand | **7.44 / 6.53 / 5.86** |
| dark ink label 6.53 | **6.53** |
| dark hover 8.62, active 5.89 | **8.62 / 5.89** |
| dark `--primary-text` 8.72 on surface | **8.72** |
| focus ring 5.05 on cream | **5.05** |

Their `outline-offset: 2px` dependency is real and intact — `base.css:220`. Without it
the ring and a `--primary` fill are the same colour and focus vanishes on the most
focused control in the product. Worth a regression test rather than a comment.

### All four runners re-verified against the blue, with live data

A practice session, a mock attempt and — for the first time — **a real official exam**
were created through the API so the runners could be opened with a question on screen and
an option actually chosen.

| Route | Nodes | Contrast (light/dark) | Overflow |
|---|---|---|---|
| `/practice/:sessionId` | 60 | 0 / 0 | 0px |
| `/mock-tests/attempts/:id` | 53 | 0 / 0 | 0px |
| `/exam/:attemptId` | 17 | 0 / 0 | 0px |
| `/exam/:attemptId` @ 320px | 17 | 0 / 0 | 0px |
| `/` (landing) | 106 | 0 / 0 | 0px |

The chosen state is **identical across all three**: `rgba(0,82,255,0.08)` tint, `#0052ff`
border at 2px, 56px minimum height, and a filled `#0052ff` key circle with a white
letter. Three signals, as the design requires.

The rewritten exam runner specifically: palette square **44px** tall (was 36px), option
**56px** with a **2px** border (was no minimum and 1px), clock on **Geist Mono** (was a
hardcoded `ui-monospace` stack), and three `ui/Button`s in the nav (was two raw
`<button>`s). At 320px the nav stacks to full-width and true/false goes single-column.

### A trap that caught me mid-pass, and is worth re-reading

The first measurement of the chosen option row reported the **unchosen** values —
white background, hairline border — while the key circle inside it correctly showed
filled blue. The tell is the inconsistency: `.optionKey` has **no transition**, the row
has `transition: border-color, background-color`. In a non-compositing tab a transition
never advances, so `getComputedStyle` returns the **start** value. Inject the
`transition: none` override *before* reading any transitioned property, not just before
a theme switch — which is a wider rule than the one already written down.

### Left in the local database on purpose

A published exam, `M27VERIFY` — "Milestone 27 verification paper (Class 9)", 4 questions,
45 minutes — plus an in-progress attempt for the demo student. Kept rather than cleaned
up so the exam runner can be opened and looked at: sign in as `demo.class9@amit.test` /
`Demo@1234` and it is on `/exam`. It exists only in `amit-olympiad-local`.

## What is left

- **An open finding for the page sweep:** `--accent-strong` (gold-400, **2.14:1 on white**)
  is used as a **text colour** in `pages/HallOfFame/HallOfFame.module.css:196` and
  `pages/Leaderboard/Leaderboard.module.css:277`, and as a border in `Referrals`. The
  border is fine. The two text uses need checking against their real backdrop before being
  called a defect — they may sit on a dark panel — but they are the first thing to look at
  on those two pages. This predates Milestone 27 (gold-400 was a light fill in Milestone 26
  too); it is recorded here because that is where it will be fixed.
- **The three question runners** (`/practice/:sessionId`, `/mock-tests/attempts/:id`,
  `/exam/:id`). `CLAUDE.md` calls them one design in three files, so they must be changed
  together, and none has been opened in a browser this milestone — they need a live
  session and attempt. They share the option row, the 44px palette button and the stacked
  mobile navigation; the option row’s chosen state uses `--primary-soft`, which phase 4
  deliberately left alone.
- **The rest of the admin console** (correctness only, per the scope decision): about a
  dozen routes not yet opened, including `/admin/taxonomy`, `/admin/exams`,
  `/admin/certificates`, `/admin/audit-log`, `/admin/analytics` and the mock-test editor.
- **`/result`, `/certificate`, `/verify/:code`** — all need data a seed does not create.
- **The parameterised routes still need a look**, especially the three question runners,
  which `CLAUDE.md` calls one design in three files — so a change to one is a change to
  three. Reaching them needs a practice session and a mock attempt created through the UI.
- **The two sweeps Milestone 26 closed have to be re-run at the end**, on every route
  rather than two of them: 0 WCAG AA failures in both themes, and no horizontal overflow at
  320px and 1280px.

## Traps already paid for — do not re-pay them

- **A CSS transition cannot advance while the tab is not compositing**, so
  `getComputedStyle` reports the *old* colour. Reloading into a theme is **not**
  sufficient — `ThemeContext` adds `.theme-dark` in an effect after first paint. Inject
  `* { transition: none !important; animation: none !important }` before measuring. Both
  sweeps above were run that way.
- **A `background-clip: text` gradient reads as `color: transparent`** and will always
  fail an automated check. Measure its **endpoints**. The landing wordmark is the only
  instance and is accounted for in the table above.
- **The Framer badge is not part of the template.** A shadow census returns three soft
  shadows (`rgba(5,8,12,0.1) 0 2px 4px` and friends) that belong to the "Made in Framer"
  widget. Excluding it is what revealed that the template has **no soft shadows at all** —
  the single most important finding of the extraction.
- **Verify the rounded hex, not the computed float.** `--amber-600` needed a second pass
  because the first candidate computed 4.5034:1 against white and rounded to 4.50.
- **Measure overflow against an *explicitly emulated* viewport.** A hidden Browser pane
  reports `documentElement.clientWidth` of **0**, so every element on the page appears to
  overflow and `scrollWidth - clientWidth` reads as the full content width. One sweep
  reported 168px of overflow on a page that has none. Call `resize_window` with a real
  width first; the page-level figure is the only one that matters, and an SVG `path`
  bounding box (KaTeX) will show as a 6,000px offender while the page overflows 0px.
- **The preview servers die, and the frontend outlives the backend.** Both exited twice
  during this milestone — once because the preview tool health-checked port 57957 while
  Vite had taken 5174. A dead backend looks like a working page full of empty states, so
  a sweep can quietly measure nothing and report zero failures. **Check `/ready` before
  trusting a run**, and wait for the page to actually paint: 4s after a cold start gave
  `nodes: 1` on pages that render 128 nodes once loaded.
- **`npm run dev` may not land on the port the preview tool reports.** 5173 was taken, the
  tool assigned 57957, Vite chose 5174, and the tab at 57957 rendered a blank page that
  looked exactly like a CSS parse error. Read the server log for the real port.
- **`/design-system` is too heavy to screenshot in the preview pane**, and it fails in a
  misleading way: 11,347px tall with 408 text nodes, it either times out ("the page did not
  finish rendering in time") or returns a blank-looking capture, because the pane's
  screenshot viewport and the page's own `innerWidth`/`innerHeight` disagree, so a
  `scrollTo` computed in JS lands somewhere else in the image. **Verify that page by
  computed style, not by picture** — which is the better check anyway. Screenshot the
  landing page when a visual is wanted.
