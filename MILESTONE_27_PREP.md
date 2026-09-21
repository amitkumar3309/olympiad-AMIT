# MILESTONE_27_PREP.md — re-pointing the token layer onto a Figma design

_Written 2026-09-21. **Prep only — no code has changed.** This file exists because the
session that planned it could not reach Figma (see "Why this file exists"), and the work
needs to survive a session boundary. Fold it into `PROJECT_STATE.md` and delete it when
the milestone closes, exactly as `MILESTONE_26_PROGRESS.md` will be._

## The decisions already taken

Asked and answered by the owner, 2026-09-21:

1. **Scope: redesign existing pages.** The Figma file replaces how pages that already
   exist look. It supersedes Milestone 26's visual language rather than sitting beside it.
2. **Authority: Figma wins.** Where the design disagrees with the current tokens, the
   design is right and `tokens.css` is re-pointed to match.

The trade-off was stated before the choice was made and the owner chose anyway, so it is
settled — but it must be written down rather than rediscovered mid-milestone:
**re-pointing the token layer re-opens the two sweeps Milestone 26 closed.** That
milestone's verified end state was *0 WCAG AA contrast failures across 314 text nodes in
both themes*, and *no horizontal overflow on 14 public + 44 signed-in routes at 320px and
1280px*. New colour values invalidate the first. New spacing, radius and type values can
invalidate the second. Both sweeps have to be re-run at the end of this milestone; budget
for that rather than discovering it.

## Why this is far more tractable than it sounds

Milestone 26 built the token layer for exactly this. A sweep at the time confirmed that
**no file outside `tokens.css` references a palette step**, which is what made that
milestone's recolour a one-file change. The same property holds now: re-pointing the
semantic layer reaches all ~50 pages **without editing them**.

That is the leverage. It is also the risk, and they are the same fact: the Figma file
almost certainly covers a handful of screens, but the tokens it implies will reach all 54
routes. **Every page not in the Figma file inherits whatever we set.** Decide a value by
looking at a landing-page hero and you have also decided it for a dense admin table.

## The three questions to settle before extracting anything

These change the method, not just the schedule. Answer them first.

1. **Does the Figma file use Figma Variables (or Styles), or raw hex on layers?**
   This is the single biggest determinant of how the milestone goes. With Variables,
   `get_variable_defs` returns the ramps directly and the mapping below is mechanical.
   Without them, values have to be read off screenshots and metadata one at a time —
   slow, and every value is a chance to introduce a contrast failure nobody measures.
2. **Does the design include a dark theme?** The token layer defines both, and 88 of the
   216 tokens are dark overrides. If Figma is light-only we derive dark ourselves, and the
   current dark theme's reasoning is worth keeping rather than reinventing: shadows
   flatten to `none` (there is nowhere darker for a shadow to fall on a near-black page),
   the card border becomes real, and the categorical hues lighten with their `-on` colours
   flipping to ink.
3. **Which screens does the file actually cover?** Needed to know which of the 54 routes
   are being designed and which are inheriting. List the inheriting ones explicitly — they
   are where regressions will surface.

## What Figma has to supply: 216 tokens

Counted from `tokens.css` on 2026-09-21: **300 declarations, 216 unique token names — 212
in `:root`, 88 in `.theme-dark`** (84 of those override a light value). Re-count rather
than quoting this later.

### Palette — 57 values (raw ramps; no component references these directly)

| Group | Count | Current | Notes |
|---|---|---|---|
| Ink neutral | 13 | `--ink-0` … `--ink-950` | Built on `#1a1a1a`, **never pure black**. Intermediate steps are the ink composited over white at fixed alphas, so a solid step and its alpha equivalent are interchangeable. Preserve that property or the text/border alphas stop landing correctly on tinted surfaces. |
| Categorical | 12 | 6 hues + 6 `-on` | Marks, never actions, never words. Confined to `ui/IconTile`. The `-on` values are **not all white** — white on the current orange is 3.08:1. |
| Gold | 8 | `--gold-50` … `--gold-700` | Achievement only, not a category. Needs a bright step for decoration *and* a dark step for words. |
| Status | 24 | green / amber / red / sky, 6 each | Must stay visually distinct from the categorical hues — a reader has to tell "this failed" from "this is chapter three". |

### Typography — 33 values

Families (4), size ramp (11), leading (6), weight (5), tracking (7).

Three properties here are load-bearing and easy to lose:

- **`--text-base` is 15px, not 16px.** It is what every input and table cell already uses,
  and this product is half dense administrative tables. A marketing-page Figma file will
  not have an equivalent — do not let it push the whole ramp up.
- **The four largest steps are fluid `clamp()`.** The floor is the phone size and is the
  value that matters most. A fixed px headline from Figma re-introduces the media queries
  this replaced.
- **Tracking is negative at every size** (−0.02em → −0.04em), and `--tracking-body` is
  applied **once, to `body`** in `base.css`. That single inherited declaration is how the
  last type change reached fifty pages with none of them edited. Keep that mechanism.

### Everything else — 126 values

Spacing (14 steps + 2 fluid gaps), radius (7), border (5 incl. `--card-border`),
shadow (5 light + 5 dark), motion (3 durations + 3 easings), layering (10), layout (8),
semantic surfaces/text/primary/status/focus/tooltip (~64), legacy aliases (4).

## Constraints that do NOT bend, even though Figma wins

"Figma wins" settles *values*. It does not repeal the structural rules, and nothing in the
owner's decision asked it to:

- **`get_code` is not the tool to use.** Figma's MCP emits React + Tailwind with hardcoded
  hex values. This project is CSS Modules with **no Tailwind**, and hardcoded values are
  banned in `src/`. Use `get_variable_defs`, `get_metadata` and `get_screenshot` — read the
  design as a *spec*, then write tokens.
- **Nothing in `src/` may hardcode a colour, radius, shadow, duration, z-index, breakpoint
  or font size.** If Figma needs a value the ramp lacks, add a token; do not inline it.
- **A component references the semantic layer only**, never a palette step. That is the
  property that makes this a one-file change.
- **`.theme-dark` must stay below `:root`.** Identical specificity (0,1,0) — source order
  is the only reason dark mode wins.
- **The three type-level guarantees stay**: a `Field` cannot be built without a label, an
  icon-only `Button` without an `aria-label`, an `EmptyState` without a description.
- **`--text-muted` is the contrast floor** and nothing lighter may carry words;
  `--text-subtle` is for non-text glyphs only.

## Measurement traps already paid for — do not re-pay them

Both produced fake findings in Milestone 26 and will do so again during the re-sweep:

- **A CSS transition cannot advance while the tab is not compositing**, so
  `getComputedStyle` keeps reporting the *old* colour. Reloading into a theme is **not**
  sufficient — `ThemeContext` adds `.theme-dark` in an effect after first paint, so even a
  fresh load has a transition pending. Inject
  `* { transition: none !important; animation: none !important }` before measuring.
- **A programmatic `.focus()` does not trigger `:focus-visible`** (it is a keyboard
  heuristic). Verify focus rings statically — check that every `outline: none` pairs with a
  replacement.

## How to start the next session

1. Open a new session in this repo (the Figma MCP server loads at session start).
2. Confirm the tools are live — the session should list a `figma` server as `connected`.
3. Paste the Figma file URL, and the frame/page links for the screens in scope.
4. Answer the three questions above.
5. First artifact is a **proposed `tokens.css` diff**, reviewed before anything else
   changes — because at that point one file decides how 54 routes look.

## Why this file exists

The Figma MCP server was added to `~/.claude.json` on 2026-09-21 and authenticated the same
day. MCP servers are loaded **when a session starts**, so the session that configured it
could never use it. That is not a fault to debug — it just means configuration and first
use are always two different sessions.
