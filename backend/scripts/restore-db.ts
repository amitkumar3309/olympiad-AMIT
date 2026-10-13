import path from 'node:path';
import mongoose from 'mongoose';
import { assertConfiguredForWrites } from '../src/lib/envGuard';
import { connectDB, disconnectDB } from '../src/db/connection';
import { readBackupHeader, restoreBackup } from './lib/backup';

/**
 * Puts a backup from `npm run backup:db` back into a database (owner, 2026-10-13).
 *
 *   npm run restore:db -- <file>                     # report only: what is in the file
 *   npm run restore:db -- <file> --write             # restore into an EMPTY database
 *   npm run restore:db -- <file> --write --replace   # drop what is there first
 *
 * The target is MONGO_URI in backend/.env. Restoring over the live database replaces what
 * students did since the backup was taken, so `--replace` is for a real disaster only; to test a
 * backup, restore it into a new, empty database instead (see TROUBLESHOOTING.md).
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  assertConfiguredForWrites({ script: 'restore-db.ts', allowLocal: argv.includes('--local') });
  const write = argv.includes('--write');
  const replace = argv.includes('--replace');
  const fileArg = argv.find((arg) => !arg.startsWith('--'));
  if (!fileArg) {
    console.error('Name the backup file: npm run restore:db -- <file>');
    process.exit(1);
  }
  const file = path.resolve(fileArg);

  const header = await readBackupHeader(file);
  console.log(`\nBackup of "${header.database}", taken ${header.createdAt}:`);
  for (const c of header.collections) console.log(`  ${String(c.count).padStart(7)}  ${c.name}`);

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection.');
  console.log(`\nTarget database: ${db.databaseName}`);

  if (!write) {
    let occupied = 0;
    for (const c of header.collections) occupied += await db.collection(c.name).estimatedDocumentCount();
    console.log(
      occupied > 0
        ? `\nThe target already holds ${occupied} documents in these collections. A restore needs --write --replace, which DROPS them first.`
        : '\nThe target is empty. Re-run with --write to restore.',
    );
    await disconnectDB();
    process.exit(0);
  }

  const restored = await restoreBackup(db, file, { replace });
  await disconnectDB();
  console.log('\nRestored:');
  for (const [name, count] of Object.entries(restored)) console.log(`  ${String(count).padStart(7)}  ${name}`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Restore failed:', err instanceof Error ? err.message : err);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
