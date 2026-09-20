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

### Verified at the last commit

- `tsc -b`, `oxlint`, `vite build` — all pass.
- Backend **1,289 tests / 36 files, all passing**; `git diff` touches **no** `backend/` file.
- `/design-system` contrast sweep: **0 WCAG AA failures, 314 nodes, both themes**.
- All 14 public routes render; no page-level horizontal overflow at 320px.

---

## Remaining work

Ordered by value. Each item says how to verify it, because there is no frontend test suite.

### A. Page surfaces still on the *old* card treatment — **the main visual gap**

Page CSS modules define their own panels with `border: 1px solid var(--border)` +
`--radius-md` + no shadow. Under the new language those read as flat bordered boxes beside
real `Card`s, which are borderless and lifted. **This is the single biggest remaining reason
a non-migrated page looks different.**

Find them: search the page modules for a rule carrying both `border:` and `border-radius:`.
Fix: drop the border, use `--radius-xl` (or `--radius-lg` when nested), add `--shadow-xl`
(or `--shadow-md` when nested), and raise the padding — or, better, delete the local class
and use `ui/Card`.

### B. The five duplicated action-button classes

`.actionBtn` / `.linkButton` are near-identical copies in **Gallery, DailyChallenges,
MockTests, Notifications, Referrals** (Admin). Convert the call sites to `ui/Button`
(`variant="secondary" size="sm"`) or, where they are table-row actions, to `ui/Menu` —
`Admin/Exams.tsx` and `Admin/Certificates.tsx` were done this way in the abandoned
direction and are the pattern to copy.

### C. 38 hardcoded font sizes left

All display sizes (17, 20, 22, 26–48px). No 1:1 ramp step, so each needs a judgement about
that page's hierarchy. Do them *with* the page, not as a sweep.

### D. ~51 hardcoded `border-radius: Npx`

Map onto `--radius-*`. Mostly safe, but check anything that is a circle (`50%`) or a pill.

### E. Motion pass

Tokens exist (`--dur-*`, `--ease-*`) and `prefers-reduced-motion` is already honoured once
in `base.css`. What is missing is applying them: card hover, menu/modal entry, tab changes.
**Keep it subtle** — the brief says no decoration.

### F. Signed-in browser regression sweep — **blocked here**

Needs a running backend and a real session. Cannot be done in this environment. It is the
one item that must be reported as not-done rather than worked around.

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
