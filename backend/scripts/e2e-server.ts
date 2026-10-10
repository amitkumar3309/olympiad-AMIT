/**
 * The backend the browser end-to-end suite runs against (Milestone 30, Phase 2).
 *
 *   npx tsx scripts/e2e-server.ts        # started for you by `npm run e2e` in frontend/
 *
 * An **in-memory** MongoDB (the same `mongodb-memory-server` the backend tests use), so
 * the suite can never touch a real database — not production, and not your local one
 * either. The database is named `amit-olympiad-e2e`, which is what the `/__e2e/*` hooks
 * check before they will reset or seed anything (see `src/routes/e2e.routes.ts`).
 *
 * Everything below is set **before** the app is imported, because `config/env.ts` reads
 * `process.env` once at load. And `backend/.env` is **not read at all**: `config/env.ts`
 * skips it when `E2E_TEST_HOOKS=true` (Milestone 30, Phase 5), so none of a developer's
 * real credentials — the production URI, a Gemini or Razorpay key — can reach this server.
 */
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const DB_NAME = 'amit-olympiad-e2e';

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create({ instance: { dbName: DB_NAME } });

  process.env.MONGO_URI = mongod.getUri(DB_NAME);
  process.env.NODE_ENV = 'development';
  process.env.E2E_TEST_HOOKS = 'true';
  process.env.PORT = process.env.E2E_BACKEND_PORT ?? '8092';
  process.env.FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5181';
  process.env.JWT_SECRET = 'e2e-only-secret-not-used-anywhere-else';
  // A dead SMTP port, as `dev:local` uses: nothing this suite does may email anybody.
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = '1025';
  process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
  // A root administrator for the suite's admin crawl (Milestone 30, Phase 5) — test values
  // from `frontend/e2e/fixtures.ts`, passed in by `playwright.config.ts`, on a throwaway database.
  process.env.ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@amit.test';
  process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(process.env.E2E_ADMIN_PASSWORD ?? 'E2e-Admin-Pass-9', 10);
  // A scheduler secret (Milestone 30 Phase 7b), so the Daily Quiz offers its reminder and the
  // crawler checks that button like every other. A test value; nothing here schedules anything.
  process.env.JOBS_SECRET = 'e2e-only-jobs-secret-not-used-anywhere-else-0123456789';
  // The read cache off: a browser test earns XP and looks at the board in the same breath,
  // and the cache's own rules are the backend tests' (tests/cache.test.ts).
  process.env.CACHE_ENABLED = 'false';

  console.log(`[e2e-server] in-memory MongoDB at ${process.env.MONGO_URI}`);
  console.log(`[e2e-server] API on :${process.env.PORT}, accepting ${process.env.FRONTEND_URL}`);

  const stop = () => {
    void mongod.stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  await import('../src/server.js');
}

main().catch((err: unknown) => {
  console.error('[e2e-server] failed to start:', err);
  process.exit(1);
});
