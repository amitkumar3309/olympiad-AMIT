# Diwali launch — progress

A fresh session should read `LAUNCH_SPEC.md`, then `PLAN.md`, then this file.

_Last updated 2026-10-04._

## Current state

**Phase 3 (the homepage and the way into the Daily Quiz) complete on branch
`feat/diwali-launch-phase-3`**, which is based on `feat/diwali-launch-phase-2` (PR #2, not yet merged
when Phase 3 began). **Waiting for the owner's "continue" before Phase 4 (the student dashboard).**

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
| 3 | Owner's answers applied: contact details (Phase 2 branch, PR #2), Q3/Q7/Q8/Q9 recorded in PLAN.md | ✅ done |
| 3 | Public-list opt-out on every board (`publicListingFor()`), leaderboard rows carry `city` | ✅ done |
| 3 | `GET /public/stats` + `questionsSolved` + 10-minute cache; `GET /public/journey` | ✅ done |
| 3 | `GET /me/daily-quiz/status` for the floating button | ✅ done |
| 3 | `next` allow-list through registration, resend and the verification link (backend + frontend); guarded pages → sign-in with `?next=` (D2) | ✅ done |
| 3 | 25 sample questions + `npm run verify:samples` (mutation-checked); `SAMPLE_QUESTIONS.md` review sheet | ✅ done |
| 3 | Primitive extensions (Menu trigger, Tabs element icons, JourneyTrack `upcoming`, FAB `style`) | ✅ done |
| 3 | Header (section links + you-are-here, avatar menu, frosted on scroll) and footer (Legal column) | ✅ done |
| 3 | Homepage rebuilt from `lib/siteConfig.ts`: hero, stats, crack-this, Rewards, About (D4), How it works, journey (9 milestones), Top Scholars, FAQ, CTA | ✅ done |
| 3 | Floating button wired (status, countdowns, collapse, footer lift) + Login Gate | ✅ done |
| 3 | `/rewards/rules` + Privacy, Terms, Refund, Contact drafts (`TODO(legal-review)`); `LEGAL_REVIEW.md` | ✅ done |
| 3 | `A.M.I.T.` with its stop (Q10) | ✅ done |
| 3 | Tests: backend 1336 / 38; E2E 12/12 (adds button → gate → quiz, register → verify → quiz, guarded page, no sideways scroll) | ✅ done |
| 3 | Browser check at 1280 and 390 (light), screenshots in `docs/launch/screenshots/phase-3/` | ✅ done |
| 3 | Docs: ADR, CLAUDE.md, API, security, testing, feature status, state, changelog, audit | ✅ done |
| 4 | Student dashboard | ⬜ next |
| 5 | Every button and link (D1–D9), crawler | ⬜ |
| 6 | Launch readiness + `LAUNCH_REPORT.md` | ⬜ |

## Open questions for the owner

All four Phase 0 questions were answered on 2026-10-04 (PLAN.md §5): **Q3** three class groups a day;
**Q7** map the nine existing milestones; **Q8** Claude drafts Logic / Reasoning / Brainstorming, the
owner reviews; **Q9** `+91-97828-70716` and `support@amitolympiad.me`. New, from Phase 3:

- **Legal review** — `docs/launch/LEGAL_REVIEW.md`: the organiser's legal name and address, governing
  law, a grievance contact, **the refund policy** (not guessed — money), data retention, prize delivery
  and tax handling.
- **Sample questions** — `docs/launch/SAMPLE_QUESTIONS.md`: approve or change the 18 drafted Logic,
  Reasoning and Brainstorming questions; only Mathematics is on the homepage until then.
- **Owner actions**: load at least the first two weeks of quiz questions before launch (Admin → Daily
  Quiz → Import a file); if `INVOICE_ORG_EMAIL` / `INVOICE_ORG_PHONE` are set in the backend's Vercel
  project, update them (a set variable beats the new default); supply the illustrations
  (`ASSETS_NEEDED.md` — placeholders until then).

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
  (5181) and drives the installed Edge — 12 tests. `homepage.spec.ts` turns reduced motion on so the
  floating button holds still enough to click.
- **The local database** behind `launch-backend-local-db` carries Milestone 29's load-test accounts
  (~1,000 "Scale S." students at the same XP), so the homepage there shows real but odd figures and
  no podium (the top three are tied) — that is the tie rule working, not a bug.
- Commit `943a336` (the calendar fix) accidentally carries the deletion of the old Daily Challenge
  frontend files — they were staged by `git rm` — and `4fd2b34` is their replacement; its message
  calls the first one `856fede`, its hash before the branch was replayed onto `main` for PR #2.
  History was not rewritten (CLAUDE.md: new commits, not amends). The old local branch
  `feat/diwali-launch` holds the same tree and is no longer used.
- Measuring a computed colour: inject `* { transition: none !important; animation: none !important }`
  first, or you read a value mid-transition.
