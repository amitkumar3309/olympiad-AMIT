/**
 * Runs the backend against a **local** MongoDB, ignoring whatever `MONGO_URI` is in
 * `.env`.
 *
 * Why this exists: `backend/.env` normally holds the production Atlas connection
 * string, because that is what a deployed-style run needs. That makes the obvious
 * command — `npm start` — read and write the **live** database, so any local
 * experiment creates real subjects, topics and questions in production. This entry
 * point removes that footgun without anyone having to remember to edit `.env` and
 * remember to put it back.
 *
 * It works because `dotenv` does not overwrite a variable that is already set, so
 * assigning here before importing the server wins over the file.
 *
 * Usage:
 *   npm run dev:local --prefix backend
 *
 * Requires a MongoDB listening on localhost:27017. Override the target with
 * LOCAL_MONGO_URI if yours runs elsewhere.
 */
process.env.MONGO_URI = process.env.LOCAL_MONGO_URI ?? 'mongodb://127.0.0.1:27017/amit-olympiad-local';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';

// A JWT secret is only mandatory in production, but setting a local one keeps the
// startup warning quiet and makes sessions survive a restart.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'local-development-only-secret';

/**
 * A known root-administrator credential for the local database.
 *
 * `.env` holds the production hash, whose plaintext nobody has locally, so without
 * this there would be no way to sign in to the admin panel against a fresh local
 * database. Overridden rather than defaulted because `.env` does set these.
 *
 * This is safe to have in the repository precisely because it only ever applies to
 * `npm run dev:local`, which also forces `MONGO_URI` to localhost — it cannot grant
 * access to any deployed environment. Deploys run `api/index.ts`, never this file.
 */
process.env.ADMIN_EMAIL = 'root@localhost';
// bcrypt hash of: LocalDevAdmin9
process.env.ADMIN_PASSWORD_HASH = '$2a$12$tZrnsB/i/wzGeIye8z9GzO0S2w/ez.hi7ezha/bZc5a7vo7mSq7ae';

console.log(`[dev-local] MONGO_URI overridden to ${process.env.MONGO_URI}`);
console.log('[dev-local] The production database in .env is NOT being used.');
console.log(`[dev-local] Root admin: ${process.env.ADMIN_EMAIL} / LocalDevAdmin9`);

// Imported after the overrides above, because config/env.ts reads process.env once
// at module load — a static import would be hoisted and read the file's values.
//
// `void import(...)` rather than top-level await: tsx compiles this project to
// CommonJS, where top-level await is unavailable. The `.js` extension is what the
// `node16` module resolution requires; tsx resolves it to the `.ts` source.
void import('../src/server.js');
