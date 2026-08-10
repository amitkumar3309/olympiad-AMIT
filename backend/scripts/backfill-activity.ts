/**
 * Gives accounts that predate Milestone 5 the activity rows they have already earned.
 *
 * ## Why this exists
 *
 * Milestone 5 made XP, levels, streaks and achievements derive entirely from the
 * `StudentActivity` log. The log is written going forward — registering, verifying an
 * email, signing in — but an account created before this milestone has no rows at
 * all, so its dashboard would honestly report 0 XP and an empty feed for things it
 * demonstrably did do.
 *
 * This is a backfill of **facts already stored**, not invented history:
 *
 *  - `account_created` is written with the account's real `registeredAt` date,
 *  - `email_verified` only for accounts whose `isEmailVerified` is genuinely true,
 *    dated from `registeredAt` because the exact verification time was never stored.
 *
 * Nothing else is backfilled. In particular no `daily_visit` rows are invented, so no
 * student is handed a streak they did not keep — a backfilled account starts with a
 * real XP total and a streak of zero until the next time they actually show up.
 *
 * ## Idempotent
 *
 * Safe to run more than once. Both backfilled types are once-per-account, enforced by
 * the partial unique index on the collection, so a second run inserts nothing and
 * reports zero written.
 *
 * ## Usage
 *
 * Report only (safe, the default — makes no change):
 *
 *   npx tsx scripts/backfill-activity.ts
 *
 * Write the missing rows:
 *
 *   npx tsx scripts/backfill-activity.ts --write
 *
 * Against a local database instead of whatever `MONGO_URI` points at:
 *
 *   MONGO_URI=mongodb://127.0.0.1:27017/amit_local npx tsx scripts/backfill-activity.ts --write
 */
import mongoose from 'mongoose';
import { config } from '../src/config';
import { Student, StudentActivity } from '../src/models';
import { recordActivity } from '../src/services/activityService';

const WRITE = process.argv.includes('--write');

async function main(): Promise<void> {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  // The unique index is what makes this idempotent, so make sure it exists before
  // relying on it (a database that has never run the app will not have it yet).
  await StudentActivity.createIndexes();

  const accounts = await Student.find({}).select('_id studentId email isEmailVerified registeredAt');
  const existing = await StudentActivity.countDocuments({});

  console.log(`${accounts.length} account(s) found; the activity log currently holds ${existing} row(s).`);

  const missing: Array<{ studentId: string; needs: string[] }> = [];
  for (const account of accounts) {
    const [hasCreated, hasVerified] = await Promise.all([
      StudentActivity.exists({ student: account._id, type: 'account_created' }),
      StudentActivity.exists({ student: account._id, type: 'email_verified' }),
    ]);

    const needs: string[] = [];
    if (!hasCreated) needs.push('account_created');
    if (account.isEmailVerified && !hasVerified) needs.push('email_verified');
    if (needs.length > 0) missing.push({ studentId: account.studentId, needs });
  }

  if (missing.length === 0) {
    console.log('Nothing to do — every account already has its enrolment activity.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\n${missing.length} account(s) are missing rows:`);
  for (const entry of missing.slice(0, 10)) {
    console.log(`  ${entry.studentId}: ${entry.needs.join(', ')}`);
  }
  if (missing.length > 10) console.log(`  ... and ${missing.length - 10} more.`);

  if (!WRITE) {
    console.log('\nNo change made. Re-run with --write to insert them:\n  npx tsx scripts/backfill-activity.ts --write');
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const account of accounts) {
    // `registeredAt` is the real date on the document; the activity is filed under
    // the competition day that contains it, exactly as a live write would be.
    const at = account.registeredAt ?? new Date();
    const created = await recordActivity({ student: account._id as mongoose.Types.ObjectId, type: 'account_created', at });
    if (created.recorded) written += 1;

    if (account.isEmailVerified) {
      const verified = await recordActivity({ student: account._id as mongoose.Types.ObjectId, type: 'email_verified', at });
      if (verified.recorded) written += 1;
    }
  }

  console.log(`\nWrote ${written} activity row(s). Streaks are deliberately not backfilled — they start on the next real visit.`);
  await mongoose.disconnect();
}

main().catch((err: unknown) => {
  console.error('Backfill failed:', err);
  process.exitCode = 1;
  void mongoose.disconnect();
});
