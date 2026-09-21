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
## What is left

- **An open finding for the page sweep:** `--accent-strong` (gold-400, **2.14:1 on white**)
  is used as a **text colour** in `pages/HallOfFame/HallOfFame.module.css:196` and
  `pages/Leaderboard/Leaderboard.module.css:277`, and as a border in `Referrals`. The
  border is fine. The two text uses need checking against their real backdrop before being
  called a defect — they may sit on a dark panel — but they are the first thing to look at
  on those two pages. This predates Milestone 27 (gold-400 was a light fill in Milestone 26
  too); it is recorded here because that is where it will be fixed.
- **Finish phase 6.** The dashboard is done. Still to look at with the reference in hand:
  `/practice` (its chapter picker is the closest thing this product has to the
  reference’s "Pick a program" pastel cards), `/rewards` (badges and the journey),
  `/leaderboard` and `/hall-of-fame` (its people sections), and `/referrals`.
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
