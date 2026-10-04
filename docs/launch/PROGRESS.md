# Diwali launch — progress

A fresh session should read `LAUNCH_SPEC.md`, then `PLAN.md`, then this file.

_Last updated 2026-10-04._

## Current state

**Phase 1 (design system) complete — waiting for the owner's "continue" before Phase 2.**
Branch `feat/diwali-launch`. Phase 2 (the Daily Quiz core) is the first phase that changes the backend.

## Tasks

| Phase | Task | Status |
|---|---|---|
| 0 | Discovery, baseline, route inventory, interaction audit, gap analysis, `PLAN.md` | ✅ done |
| 1 | Re-point `tokens.css` onto the mockups (palette, semantic, dark counterparts) — every value contrast-solved | ✅ done |
| 1 | Plus Jakarta Sans + Caveat; self-host all four families; preload; immutable cache | ✅ done |
| 1 | Role type scale (`--type-*`), motion tokens, card shadow/radius tokens, series/podium/tint tokens | ✅ done |
| 1 | Update primitives: Button (flat, `link`, element icons), Card, IconTile, Section, StatTile (`value-first`, delta), Badge (`live`), Avatar (`tint`) | ✅ done |
| 1 | New primitives: CountUp, Reveal, OptionTile/OptionGroup, Countdown (+ clockOffset), Podium, LeaderboardTable, JourneyTrack, ActivityList, Confetti, motion hooks | ✅ done |
| 1 | `lib/format.ts` — en-IN numbers, IST dates in the brief's format | ✅ done |
| 1 | `components/Illustration` + registry + `ASSETS_NEEDED.md` | ✅ done |
| 1 | `components/DailyQuizFab` — four states, float, ring, hover shine, reduced motion (data wiring: Phase 3) | ✅ done |
| 1 | `/dev/ui` (alias of `/design-system`) with every primitive in every state | ✅ done |
| 1 | Browser QA: both themes, 360–1920px, contrast sweep, keyboard on the option group | ✅ done — see CHANGELOG |
| 1 | Docs: ADR, CLAUDE.md, PROJECT_STATE, FEATURE_STATUS, CHANGELOG, screenshots | ✅ done |
| 2 | Daily Quiz core (backend + student UI + admin + tests + Playwright ADR) | ⬜ next |
| 3 | Homepage, FAB wiring, Login Gate, Rewards, rules page, legal drafts | ⬜ |
| 4 | Student dashboard | ⬜ |
| 5 | Every button and link (D1–D9), crawler | ⬜ |
| 6 | Launch readiness + `LAUNCH_REPORT.md` | ⬜ |

## Open questions for the owner

PLAN.md §5 decision log: Q3 (prize budget — operational, not code), Q7 (journey content), Q8 (Logic /
Reasoning / Brainstorming sample questions), Q9 (which phone and email are correct). And one
Phase 1 change to note: **the font differs from the Phase 0 recommendation** (Plus Jakarta Sans, not
Bricolage) — the reason is in PLAN.md Q1 and the ADR; it is two lines to revert.

## Notes for the next session

- **Local run:** `.claude/launch.json` has `launch-backend-local-db` (port 8091, `dev:local`, local
  MongoDB `amit-olympiad-local`) and `launch-frontend` (port 5180, proxying to 8091). The main
  checkout may be running its own backend on 8081 against the same local database — leave it alone.
- Seeded local accounts come from the project's own scripts (`scripts/seed-demo.ts`,
  `scripts/dev-local.ts`); do not paste their credentials into chat.
- The existing daily challenge **is** the Daily Quiz — upgrade it, don't build a second one.
- Option tiles render maths through `MathText`; quiz options should be written with `\dfrac` (or
  displayed larger) — an inline `\frac` is small next to the letter.
- Measuring a computed colour: inject `* { transition: none !important; animation: none !important }`
  first, or you read a value mid-transition (it happened in Phase 1 on the option tiles).
