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
 * `process.env` once at load and `dotenv` never overwrites a variable that is already
 * set — which is also why `backend/.env`'s production URI cannot leak in here.
 */
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
