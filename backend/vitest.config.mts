import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // dist/ holds compiled CommonJS output. Without this exclude, a prior
    // `npm run build` leaves .js copies that vitest tries to run and fails on.
    exclude: ['**/node_modules/**', '**/dist/**'],
    /**
     * Test files run one at a time.
     *
     * Five suites now start their own real `mongod` via `mongodb-memory-server`.
     * Run in parallel they contend for CPU and ports, and the failure that produces
     * is not a clean error — it surfaces as unrelated assertion failures in whichever
     * file lost the race (observed once: duplicate-key 409s in the auth suites, from
     * a database that had not been cleared). A suite that fails for reasons unrelated
     * to the code under test is worse than a slow one, and the whole run is only a
     * few seconds slower this way.
     */
    fileParallelism: false,
  },
});
