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

## What is left

- **An open finding for the page sweep:** `--accent-strong` (gold-400, **2.14:1 on white**)
  is used as a **text colour** in `pages/HallOfFame/HallOfFame.module.css:196` and
  `pages/Leaderboard/Leaderboard.module.css:277`, and as a border in `Referrals`. The
  border is fine. The two text uses need checking against their real backdrop before being
  called a defect — they may sit on a dark panel — but they are the first thing to look at
  on those two pages. This predates Milestone 27 (gold-400 was a light fill in Milestone 26
  too); it is recorded here because that is where it will be fixed.
- **Phase 3+ — the pages.** 14 public + 44 signed-in routes inherit whatever the tokens
  say; the ones that look wrong will be the ones with hardcoded *structure* rather than
  hardcoded values. The landing hero currently sits on a **white** surface where the
  reference puts it on cream — the first thing to re-point.
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
