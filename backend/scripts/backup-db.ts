import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { config } from '../src/config';
import { envFileLoaded } from '../src/config/env';
import { connectDB, disconnectDB } from '../src/db/connection';
import { redactUri } from '../src/lib/envGuard';
import { writeBackup } from './lib/backup';

/**
 * Copies the whole database to one file on this computer (owner, 2026-10-13 — the free Atlas
 * tier takes no backups). Reads only; writes nothing to the database.
 *
 *   npm run backup:db                      # into backend/backups/
 *   npm run backup:db -- --out D:\Backups  # somewhere else
 *
 * The file holds every student's personal data. Keep it on your own computer or drive, never in
 * the repository (backend/backups/ is git-ignored), an email or a chat. Restore with
 * `npm run restore:db` (see scripts/restore-db.ts).
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex >= 0 && argv[outIndex + 1] ? path.resolve(argv[outIndex + 1]!) : path.resolve(__dirname, '..', 'backups');

  console.log(`Backing up : ${redactUri(config.mongoUri)}`);
  console.log(`Loaded .env: ${envFileLoaded ? 'yes' : 'NO'}`);
  // A backup of the empty local default would look like a backup and hold nothing.
  if (/localhost|127\.0\.0\.1/.test(config.mongoUri) && !argv.includes('--local')) {
    console.error('\nREFUSING: this is a LOCAL database, not your live one. Put your Atlas MONGO_URI in backend/.env');
    console.error('(run from the backend folder), or pass --local if a local backup is really what you want.');
    process.exit(1);
  }

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection.');

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `${db.databaseName}-${stamp}.backup.json.gz`);
  const header = await writeBackup(db, file);
  await disconnectDB();

  const total = header.collections.reduce((sum, c) => sum + c.count, 0);
  console.log(`\nSaved ${total} documents from ${header.collections.length} collections:`);
  for (const c of header.collections) console.log(`  ${String(c.count).padStart(7)}  ${c.name}`);
  console.log(`\nFile: ${file}`);
  const bytes = statSync(file).size;
  console.log(`Size: ${bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`}`);
  console.log('\nIt holds children\u2019s personal data: keep it safe, and never put it in the repository, an email or a chat.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Backup failed:', err);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
