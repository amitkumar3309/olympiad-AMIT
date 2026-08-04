# TESTING.md

## Current State: No automated tests exist

- No test runner is configured in either `package.json` (no Jest, Vitest, Mocha, Playwright, Cypress, Supertest, etc.).
- No `*.test.*` or `*.spec.*` files exist anywhere in the repository.
- `frontend/package.json` has a `lint` script (`oxlint`) but no `test` script.
- `backend/package.json` has no `test` script at all.

## Testing Strategy (recommended, not yet implemented)

Given the MVP/₹0 constraint, prefer free/open-source tools with no added infra cost:

- **Backend unit/integration**: Vitest (or Jest) + Supertest against the Express `app` export, with `mongodb-memory-server` (free, in-process) to avoid needing a real database for tests.
- **Frontend unit**: Vitest + React Testing Library (pairs naturally with Vite).
- **End-to-end**: Playwright (free), run locally against `npm run dev` in both apps — not required for MVP, but worth adding once the exam/results flow becomes real.

Do not add any of these dependencies silently — record the choice in [`DECISIONS.md`](DECISIONS.md) when the first test is actually written, since this is a new architectural commitment, not just a code change.

## Commands

None exist yet. Once a framework is chosen:
- Backend: add `"test": "vitest"` (or similar) to `backend/package.json`.
- Frontend: add `"test": "vitest"` to `frontend/package.json`.

## Current Coverage

0%. No lines are covered by any automated test.

## Known Untested Areas (i.e., everything)

Highest-risk areas to test first, given they involve money/auth/data integrity:
1. Auth routes (`register`/`login`/`admin login`) — password hashing, duplicate-mobile rejection, JWT issuance/verification, role-based `requireAuth` gating.
2. The `GET /api/questions` query-building path — especially once the NoSQL-injection-shaped issue in [`SECURITY.md`](SECURITY.md) is fixed, a regression test should lock the fix in.
3. Any future exam-submission / results / payment logic — these involve real user-facing correctness and eventually money; should not ship without tests once implemented.

## Manual Verification (until a real suite exists)

- Use the Postman workspace scaffolding under `postman/`/`.postman/` (currently empty — no requests defined yet) to manually exercise new backend routes, or use `curl`/the browser.
- Any PR/commit that adds or changes a route should describe how it was manually verified, per the Definition of Done in [`CLAUDE.md`](CLAUDE.md).
