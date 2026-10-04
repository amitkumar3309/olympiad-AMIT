import { defineConfig } from '@playwright/test'
import { BACKEND_PORT, FRONTEND_PORT } from './e2e/fixtures.ts'

/**
 * The browser end-to-end suite (Milestone 30, Phase 2 — see the Playwright ADR in DECISIONS.md).
 *
 *   npm run e2e
 *
 * Starts its own backend on an in-memory MongoDB (`backend/scripts/e2e-server.ts`) and its own
 * Vite server pointed at it, so it never touches a real database and never collides with a dev
 * server already running. Uses the installed Microsoft Edge, so no browser download is needed.
 *
 * One worker: the tests share one database and one server clock, and run in order.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    channel: 'msedge',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: 'npx tsx scripts/e2e-server.ts',
      cwd: '../backend',
      url: `http://localhost:${BACKEND_PORT}/health`,
      env: { E2E_BACKEND_PORT: String(BACKEND_PORT), E2E_FRONTEND_URL: `http://localhost:${FRONTEND_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${BACKEND_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
