# MILESTONE_26_PROGRESS.md

> **Temporary working file.** It exists so this milestone can be picked up by a fresh
> session mid-flight. **When the milestone closes, fold the outcome into
> [`PROJECT_STATE.md`](PROJECT_STATE.md) / [`FEATURE_STATUS.md`](FEATURE_STATUS.md) and
> delete this file** — the repository's rule is that its memory is the doc set, and a
> fourteenth root document that outlives its purpose is how that set stops being read.

---

## How to resume in a new session

Read, in this order: [`CLAUDE.md`](CLAUDE.md) → [`PROJECT_STATE.md`](PROJECT_STATE.md)
→ this file. Then `git log --oneline -12` to see where the phases got to.

**Git is present but `git` is not on `PATH`.** Use `& "C:\Program Files\Git\cmd\git.exe"`.
Commit messages with quotes break PowerShell's native-argument passing — write the message
to a file and use `git commit -F <file>`.

**The dev server**: `preview_start { name: "amit-olympiad-frontend" }`. Vite may bind to
**5174** if 5173 is taken — read the actual port from the server log rather than trusting
the harness's reported port. **There is no backend running**, so every signed-in page shows
its error state; the public pages and `/design-system` are the only ones drivable here.

**Screenshots in this environment are unreliable** (the pane often fails to composite).
Measure with `javascript_tool` + `getComputedStyle` instead — it is more precise anyway, and
it is how every figure below was obtained.

---

## The design language, in one place

Measured off `https://tokko.framer.website/` with `getComputedStyle`. Full rationale is in
the Milestone 26 ADR in [`DECISIONS.md`](DECISIONS.md); the rules are in `CLAUDE.md`.

| | Value |
|---|---|
| Canvas / card | `--bg` `#fafafa` · `--surface` `#ffffff` |
| Ink | `--ink-900` `#1a1a1a` — **never pure black** |
| Muted text | `rgba(26,26,26,0.65)` — **alpha, not a grey step** (5.4:1 on white) |
| Card | `--radius-xl` 32px, **no visible border**, `--shadow-xl` |
| Buttons | **always a pill**, primary is near-black, 48px at `md` |
| Type | **Geist** 500 body / 600 headings; negative tracking at every size |
| Colour | categorical, **only** in `ui/IconTile`; action is ink |

**The three rules a change must not contradict:** separation is by *shadow* not border;
type is *tight*; colour is *categorical* and the action is *near-black*.

---

## Done (committed, one commit per phase)

| Phase | Commit | What |
|---|---|---|
| — | `1ab4635` | Revert of the abandoned dark/lime direction |
| 1 | `269a9cb` | Token layer + Button/Card/Input/Table/StatTile |
| 2 | `60a37f9` | `Section` `IconTile` `Avatar` `Menu` `Breadcrumb` + `AppShell` + public `Navbar` |
| 3 | `02eddc6` | Landing page |
| 4 | `6d36b01` | `/admin/system` (superadmin IA) + `/admin/analytics` restructure |
| 5 | `6900752` | 289 of 327 hardcoded font sizes → the ramp |
| 6 | `3a8ce90` | `/design-system` covers the five new primitives |
| — | `50ce02e` | Documentation |
| 7 | `8d17abc` | `humanizeError` in 97 places; `h1` on four public pages |
| 8 | `c229fa8` | The hand-rolled card surfaces (11 converted, 3 made nested insets) |
| 9 | `412d4c2` | **Eleven** duplicated action-button classes → one `ui/Button`; two tables → `ui/Menu` |
| 10 | `da64da0` | Every radius on the scale; two selector-list bugs |
| 11 | `3576c02` | The shadow type scale — 191 more sizes onto the ramp |
| 12 | *(this)* | Motion pass |

### Verified at the last commit

- `tsc -b`, `oxlint`, `vite build` — all pass.
- Backend **1,289 tests / 36 files, all passing**; `git diff` touches **no** `backend/` file.
- `/design-system` contrast sweep: **0 WCAG AA failures, 314 nodes, both themes**.
- All 14 public routes render; no page-level horizontal overflow at 320px.

---

## Remaining work

Ordered by value. Each item says how to verify it, because there is no frontend test suite.

### ~~A. Page surfaces on the old card treatment~~ — **done, phase 8**

### ~~B. The duplicated action-button classes~~ — **done, phase 9**

It was **eleven** classes across ten files, not five. All gone; `ui/Button` /
`ui/ButtonLink` are the only copies, and two table-row cases became `ui/Menu`.
`--royal-blue` is now referenced **zero** times outside `tokens.css`.

### ~~C. Hardcoded font sizes~~ — **done, phase 11**

It was **221**, not 38 — the phase-5 scan matched `font-size: Npx` only, so every `rem`
value and every decimal px was invisible to it. Forty-four distinct values, six of them
between 11 and 15px. 191 are now ramp tokens.

### ~~D. Hardcoded radii~~ — **done, phase 10**

48 mapped. Nothing in `src/` hardcodes a radius. `border-radius: 50%` is left alone: a
circle is a shape, not a step on the scale.

### ~~E. Motion pass~~ — **done, phase 12**

The system already had the right amount: `Modal`, `Menu`, `Toast`, `Tooltip`, `Spinner`,
`Skeleton` and `Progress` all animate; `Button`, `Card`, `Input`, `Table`, `Tabs` and
`Breadcrumb` all ease. **`Pagination` was the only gap** and is fixed.

Deliberately **not** added: `scroll-behavior: smooth`. Every `scrollIntoView` in this
product passes `behavior: 'auto'` on purpose — a documented Phase F decision that a
smooth scroll can simply fail to arrive. `base.css` already carries the reduced-motion
guard for it, which looks like an omission and is not.

---

## What is genuinely left

### F. Signed-in browser regression sweep — **blocked in this environment**

Needs a running backend and a real session. It is the one item that must be reported as
not-done rather than worked around. Everything drivable without a backend — the 14 public
routes, `/design-system`, both themes, 320px — has been swept.

### G. 16 page-level glyph sizes should become `<Icon size>`

`font-size: 32px` on an `<i>` is sizing a *glyph*, not text, so the type ramp correctly
does not govern it — but the right fix is the component's own `size` prop at the call
site, which is a JSX change per site. `Icon.module.css` (the icon scale itself) and
`Certificate.module.css` (a printed document) are correctly excluded from any sweep.

### H. ~160 `rgba()` literals remain in page CSS

Almost all are low-alpha status tints (`rgba(16,185,129,.12)` and friends) where a
`--success-soft` token already exists. Mechanical, but each needs a glance to confirm
which semantic tone it meant. Lower value than anything above — they already follow the
theme's *intent* even though they do not follow the theme.

### I. Two hand-rolled modals

`Admin/Exams` and `Admin/Certificates` still render their own dialog rather than
`ui/Modal`. Left deliberately: swapping them is a **focus-management** change to a
destructive confirmation, which deserves its own browser pass rather than riding along
with a restyle.

---

## Traps already paid for — do not rediscover these

- **Never edit a source file with a PowerShell `Get-Content -Raw` / `Set-Content` round
  trip.** PS 5.1 reads UTF-8 as ANSI, so every em dash becomes mojibake. It happened once.
  Use the `Edit` tool, or .NET `[System.IO.File]::ReadAllText($p, $utf8NoBom)`.
- **A sweep that removes the last use of an import breaks `tsc`** — `noUnusedLocals` is on.
  The `humanizeError` sweep needed a second pass to drop 35 now-unused `ApiError` imports.
- **`--text-subtle` is for non-text glyphs only.** Two call sites were painting words in it
  (2.9:1) and were caught by the contrast sweep, not by review.
- **Verify every Phosphor glyph name before using it.** An unknown name renders an
  *invisible* glyph, not a fallback. Check with `getComputedStyle(el,'::before').content`.
- **`Menu` measures with `documentElement.clientWidth`, not `innerWidth`** — they differ by
  the scrollbar, which was enough to put the panel off-screen.
