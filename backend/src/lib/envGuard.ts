import { config } from '../config';
import { envFileLoaded } from '../config/env';

/**
 * A guard for scripts that **write** to the database.
 *
 * ## The failure this exists to prevent
 *
 * Every environment variable in this backend has a sensible default, which is
 * excellent for `npm test` and dangerous for a one-off script. `MONGO_URI` defaults
 * to `mongodb://localhost:27017/amit-olympiad`, so a script run without a loaded
 * `.env` connects to a *local* database, writes to it, and reports complete success.
 * The operator sees "Published: 208" and reasonably concludes the production bank is
 * stocked. It is not, and nothing said so.
 *
 * That happened: the seed was run from `backend/scripts/` rather than `backend/`,
 * `dotenv` found no `.env` in that directory, and 208 questions went into a local
 * database while the live site stayed empty. The `.env` lookup is now anchored to the
 * package root (see `config/env.ts`), which fixes the cause — this is the second
 * line of defence, for the cases that fix cannot cover: a genuinely missing `.env`, a
 * mistyped `MONGO_URI`, or an override that points somewhere unintended.
 *
 * ## What it does
 *
 * Prints the database it is about to write to, then **stops** if that looks
 * accidental rather than chosen. "Chosen" means either a non-local `MONGO_URI` from a
 * real `.env`, or an explicit `--local` acknowledgement on the command line.
 */

function isLocalUri(uri: string): boolean {
  return /(?:\/\/|@)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])[:/]/.test(uri);
}

/** The URI with any credentials removed, safe to print or paste into a chat. */
export function redactUri(uri: string): string {
  return uri.replace(/\/\/[^@/]*@/, '//***:***@');
}

export interface WriteGuardOptions {
  /** Name of the script, for the messages. */
  script: string;
  /**
   * Set when the operator passed `--local`, acknowledging that writing to a local
   * database is what they meant.
   */
  allowLocal: boolean;
}

/**
 * Reports the target database and exits non-zero if it looks unintended.
 *
 * Call this **before** any write, and before any expensive work, so the operator
 * finds out immediately rather than after a long run against the wrong place.
 */
export function assertConfiguredForWrites({ script, allowLocal }: WriteGuardOptions): void {
  const uri = config.mongoUri;
  const local = isLocalUri(uri);

  console.log(`Target database : ${redactUri(uri)}`);
  console.log(`Loaded .env     : ${envFileLoaded ? 'yes' : 'NO'}`);

  if (!local) {
    // A remote URI is a deliberate choice; nothing to warn about.
    return;
  }

  if (allowLocal) {
    console.log('Writing to a LOCAL database, acknowledged with --local.\n');
    return;
  }

  console.error(
    [
      '',
      '='.repeat(72),
      'REFUSING TO RUN — this would write to a LOCAL database.',
      '='.repeat(72),
      '',
      `  ${script} is about to connect to:`,
      `      ${redactUri(uri)}`,
      '',
      envFileLoaded
        ? '  A .env was loaded, but its MONGO_URI points at localhost. If that is'
        : '  No .env file was loaded, so MONGO_URI fell back to its localhost default.',
      envFileLoaded ? '  really what you want, re-run with --local.' : '',
      '',
      '  If you meant to write to production (MongoDB Atlas):',
      '    1. Run the command from the `backend` directory, not `backend/scripts`.',
      '    2. Check that backend/.env exists and contains your Atlas MONGO_URI.',
      '',
      '        cd backend',
      `        npx tsx scripts/${script}`,
      '',
      '  If you really did mean a local database, add --local:',
      '',
      `        npx tsx scripts/${script} --local --write`,
      '',
      '='.repeat(72),
    ]
      .filter((line) => line !== '')
      .join('\n'),
  );
  process.exit(2);
}
