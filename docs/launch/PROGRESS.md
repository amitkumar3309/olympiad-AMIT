# Diwali launch — progress

A fresh session should read `LAUNCH_SPEC.md`, then `PLAN.md`, then this file.

_Last updated 2026-10-04._

## Current state

**Phase 2 (the Daily Quiz core) complete — waiting for the owner's "continue" before Phase 3.**
Branch `feat/diwali-launch` (not pushed since PR #1, which carried Phase 1). Phase 3 is the homepage,
the floating button's wiring, the Login Gate, the Rewards section and the rules page.

## Tasks

| Phase | Task | Status |
|---|---|---|
| 0 | Discovery, baseline, route inventory, interaction audit, gap analysis, `PLAN.md` | ✅ done |
| 1 | Design system: tokens onto the mockups, fonts self-hosted, nine primitives, `DailyQuizFab`, `/dev/ui`, QA, docs | ✅ done |
| 2 | Injectable clock (`lib/clock.ts`), IST window helpers, pure quiz rules (`lib/dailyQuiz.ts`) | ✅ done |
| 2 | Model upgrade: `DailyChallenge` groups + snapshot, attempt fields, `DailyQuizStart`, `DailyQuizWinner`, `DailyQuizSettings`, `Student` prize fields | ✅ done |
| 2 | Start / submit / today / history / public info / public winners; per-student rate limit; no-store | ✅ done |
| 2 | One reveal gate; no automatic fill; publish and delete guards on quiz questions | ✅ done |
| 2 | XP: 20 for correct only, settled after the reveal when instant results are off | ✅ done |
| 2 | Admin: calendar + gap warnings, schedule, change/remove until started, stats, candidates, settings | ✅ done |
| 2 | Bulk: CSV/JSON/Excel quiz import through the question importer (CSV + JSON are importer formats); bulk-from-bank | ✅ done |
| 2 | Winners: compute / confirm / disqualify / publish / contacted / delivered, notification, prize desk, audit | ✅ done |
| 2 | Analytics + Hall of Fame revealed-only; content reset keeps prize decisions; profile prize fields | ✅ done |
| 2 | Student UI: `DailyQuizPanel` (page + dashboard card), profile history + prize details, routes and nav | ✅ done |
| 2 | Admin UI: `/admin/daily-quiz` (calendar, import, bank, prize desk, settings) + quiz page with winners | ✅ done |
| 2 | Tests: rules (unit), API incl. the answer-key leak test across midnight, import — backend 1324 / 38 files | ✅ done |
| 2 | Playwright ADR, `e2e-server.ts` (in-memory DB) + `/__e2e` hooks, E2E at desktop and 390px — 4/4 | ✅ done |
| 2 | `seed-dev-quizzes.ts` (local only, answers checked in code); `seed-demo.ts` no longer schedules | ✅ done |
| 2 | Browser check of the student flow and the admin console on the local dev servers | ✅ done |
| 2 | Docs: ADRs, CLAUDE.md, API, schema, security, env, testing, feature status, state, changelog, troubleshooting | ✅ done |
| 3 | Homepage, FAB wiring, Login Gate, Rewards, rules page, legal drafts | ⬜ next |
| 4 | Student dashboard | ⬜ |
| 5 | Every button and link (D1–D9), crawler | ⬜ |
| 6 | Launch readiness + `LAUNCH_REPORT.md` | ⬜ |

## Open questions for the owner

PLAN.md §5 decision log: Q3 (prize budget — three class groups a day with one winner each is about 90
prizes a month; the model supports any range per day), Q7 (journey content), Q8 (Logic / Reasoning /
Brainstorming sample questions), Q9 (which phone and email are correct). **New owner action:** load at
least the first two weeks of quiz questions before launch (Admin → Daily Quiz → Import a file — the
CSV template is there).

## Notes for the next session

- **Local run:** `.claude/launch.json` has `launch-backend-local-db` (port 8091, `dev:local`, local
  MongoDB `amit-olympiad-local`) and `launch-frontend` (port 5180, proxying to 8091). The backend is
  not a watcher — **restart it after a backend change**. The main checkout may be running its own
  backend on 8081 against the same local database — leave it alone.
- `npx tsx scripts/seed-dev-quizzes.ts --local --write` (from `backend/`) seeds three days of verified
  quizzes locally. The local demo student was switched to Class 7 during the Phase 2 browser check
  (Class 9 had a pre-quiz challenge holding today's slot).
- Seeded local accounts come from the project's own scripts (`scripts/seed-demo.ts`,
  `scripts/dev-local.ts`, `frontend/e2e/fixtures.ts`); do not paste their credentials into chat.
- **E2E:** `npm run e2e` in `frontend/` starts its own backend (in-memory DB, port 8092) and Vite
  (5181) and drives the installed Edge. Phase 3 should add the homepage → FAB → login gate flow there.
- Commit `856fede` accidentally carries the deletion of the old Daily Challenge frontend files (they
  were staged by `git rm`); `d53e367` is the replacement. History was not rewritten (CLAUDE.md:
  new commits, not amends).
- Measuring a computed colour: inject `* { transition: none !important; animation: none !important }`
  first, or you read a value mid-transition.
