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

## What is left

- **Phase 2 — the design system.** `ui/Card` must go flat (no shadow, separation by fill);
  `ui/Button` and `ui/IconTile` need the hard offset edge and the press-collapse; the
  overlay components keep `--shadow-*`. 25 primitives, plus `/design-system` kept current.
- **Phase 3+ — the pages.** 14 public + 44 signed-in routes inherit whatever the tokens
  say; the ones that look wrong are the ones with hardcoded structure rather than
  hardcoded values.
- **The two sweeps Milestone 26 closed have to be re-run at the end**, on every route
  rather than just the landing page: 0 WCAG AA failures in both themes, and no horizontal
  overflow at 320px and 1280px.

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
