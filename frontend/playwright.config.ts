import { defineConfig } from '@playwright/test'
import { BACKEND_PORT, E2E_ADMIN, FRONTEND_PORT } from './e2e/fixtures.ts'

/** Where the suite's production build goes — ignored with `node_modules`, and never `dist/`. */
const E2E_DIST = 'node_modules/.e2e-dist'

/**
 * The browser end-to-end suite (Milestone 30, Phase 2 — see the Playwright ADR in DECISIONS.md).
 *
 *   npm run e2e
 *
 * Starts its own backend on an in-memory MongoDB (`backend/scripts/e2e-server.ts`) and serves a
 * **production build** of the frontend pointed at it (`vite build` + `vite preview`, whose proxy is
 * the dev server's), so it never touches a real database and never collides with a dev server
 * already running. Uses the installed Microsoft Edge, so no browser download is needed.
 *
 * A build rather than the dev server since Milestone 30 Phase 5: the dev server serves every module
 * separately — about 170 requests a page — and the link crawler's 50-page admin run under that load
 * twice met a browser that ran out of request slots (`net::ERR_INSUFFICIENT_RESOURCES`) or a page
 * whose `load` never came. A bundle is what ships, without React's development-only double effects,
 * and the build goes to `node_modules/.e2e-dist` so it never replaces `dist/`.
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
      env: {
        E2E_BACKEND_PORT: String(BACKEND_PORT),
        E2E_FRONTEND_URL: `http://localhost:${FRONTEND_PORT}`,
        E2E_ADMIN_EMAIL: E2E_ADMIN.email,
        E2E_ADMIN_PASSWORD: E2E_ADMIN.password,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite build --outDir ${E2E_DIST} --emptyOutDir && npx vite preview --outDir ${E2E_DIST} --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${BACKEND_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
