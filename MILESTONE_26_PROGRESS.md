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
the harness's reported port. Note both ports may be listening on **IPv6 only** (`::1`), so
`127.0.0.1` refuses the connection and `localhost` works.

**The backend**: `preview_start { name: "amit-olympiad-backend-local-db" }`. Use that entry,
**never** `amit-olympiad-backend` — that one runs `npm start`, which reads the production
Atlas URI out of `backend/.env`. Confirm with `GET /ready`, which names the database it is
connected to (`amit-olympiad-local` is the right answer). It needs a MongoDB on
`localhost:27017`.

Seeding, from inside `backend/`, with `MONGO_URI` pinned to the local database first (the
scripts load `.env`, and `dotenv` will not overwrite a variable that is already set):

```
$env:MONGO_URI = 'mongodb://127.0.0.1:27017/amit-olympiad-local'
npx tsx scripts/seed-class9.ts --local --write   # 73 published questions, 12 chapters
npx tsx scripts/seed-demo.ts   --local --write   # the student, verified, fee captured
```

`assertConfiguredForWrites()` prints the target database and refuses without `--local` —
trust it, it is the guard that makes this safe. Sign in as
`demo.class9@amit.test` / `Demo@1234`, or as `root@localhost` / `LocalDevAdmin9` at
`/auth/admin/login` — **that route takes `email`, not `identifier`.**

**CSRF is enforced now**: a request whose `Origin` is not the configured frontend is
refused with "This request did not come from the AMIT Olympiad website". Drive the app from
the origin the backend expects (5173), not from a second Vite instance.

**The general rate limiter is 300 requests / 15 minutes per IP** and a full sweep exceeds
it. A limited page renders an empty state, which passes a naive structural check — see
*Traps*.

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
| 12 | `2ab8146` | Motion pass |
| 13 | *(phase 13)* | Public route sweep + the `/hall-of-fame` `minmax` overflow |
| 14 | `f989f25` | **The signed-in sweep** — 5 overflow bugs, 4 heading skips, 1 invisible button |
| 15 | `bd3ff36` | Dark-mode contrast pass — the sort toggle with no base state |

### Verified at the last commit

- `tsc -b`, `oxlint`, `vite build` — all pass.
- Backend **1,289 tests / 36 files, all passing**; `git diff` touches **no** `backend/` file.
- `/design-system` contrast sweep: **0 WCAG AA failures, 314 nodes, both themes**.
- All 14 public routes render; no page-level horizontal overflow at 320px.
- **18 student routes + 26 admin routes**, signed in, at 1280px and 320px, both themes:
  one `h1` each, no heading skips, no overflow, no dangling ARIA, no raw 5xx, and
  **0 WCAG AA contrast failures**.

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

### ~~F. Signed-in browser regression sweep~~ — **done, phases 14–15**

No longer blocked. `npm run dev:local --prefix backend` against a local MongoDB, seeded
with `seed-class9.ts --local --write` (73 published questions, 12 chapters) and
`seed-demo.ts --local --write` (`demo.class9@amit.test` / `Demo@1234`, verified, fee
captured). Root admin is `root@localhost` / `LocalDevAdmin9` at `/auth/admin/login`,
which takes **`email`**, not `identifier`.

44 signed-in routes walked — 18 as the student, 26 as the superadmin — at 1280px and
320px, in both themes. Seven defects, all now fixed. Five were the same bug: a bare
`1fr` grid column. **`1fr` is `minmax(auto, 1fr)`**, and that `auto` floor will not
shrink below the column's min-content, so an obviously-safe single-column mobile
fallback resolves to whatever its widest child needs. Same family as the
`minmax(330px, 1fr)` phase 13 fixed. Two were colour: a control whose text and
background were the same token, and a button with no base state at all (see
*Traps* below).

**The method mattered more than the findings.** The first pass reported several admin
pages clean that were not: the rate limiter had tripped at 300 requests per 15 minutes,
those pages were rendering empty states, and an empty state has an `h1` and no overflow.
A structural check that cannot distinguish a rendered page from a refused one is not a
check. The audit now records an error-state match and a character count beside every
result. **Two of the five overflow bugs were only visible on the re-run.** Budget the
sweep against that limiter, or pace it.

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
- **`1fr` is `minmax(auto, 1fr)`, and `auto` is a min-content floor.** A single-column
  mobile fallback written `grid-template-columns: 1fr` cannot shrink below its widest
  child, so it overflows the page rather than fitting it. Five grids did this. Write
  `minmax(0, 1fr)` for a column that must fit its container, and `minmax(min(Npx, 100%), 1fr)`
  when you want a real floor. This is the same rule as the `minmax(330px, 1fr)` in `CLAUDE.md`.
- **A `<button>` with no background of its own falls back to the UA's `ButtonFace`**, an
  opaque light grey that ignores the theme — *not* to the page background. `.orderToggle`
  was left as a `:hover` rule when the classes it shared a selector with were deleted, and
  rendered at **1.09:1** in dark mode while looking perfectly fine in light. Deleting a
  class from a selector list can silently take another class's base state with it.
- **A control whose `color` and `background` come from a token pair is only safe if both
  are set in the same rule.** `/payment` declared `.invoiceDownload` twice; the later rule
  set `color: var(--primary-text)` and the earlier one's `background: var(--primary)`
  survived. Those two are the *same colour by design* — ratio **1.00 in both themes**.
  A later `color` does not undo an earlier `background`.
- **A structural sweep must prove the page actually rendered.** An empty state and an
  error state both have an `h1` and no overflow, so a rate-limited page reports clean.
  Record an error-state match and a character count alongside every result. The general
  limiter is **300 requests / 15 minutes per IP**, and a full sweep exceeds it.
