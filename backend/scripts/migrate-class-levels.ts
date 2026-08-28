import mongoose from 'mongoose';
import { assertConfiguredForWrites } from '../src/lib/envGuard';
import { connectDB, disconnectDB } from '../src/db/connection';
import { RETIRED_CLASS_LEVELS } from '../src/lib/classLevels';

/**
 * Collapses the three Class 12 streams into a single `Class 12` (Milestone 21, Phase J).
 *
 * `Class 12 - Science`, `Class 12 - Commerce` and `Class 12 - Humanities` were three separate class
 * values because the competition paper differed by stream. The owner collapsed them on 2026-08-23,
 * which means **a Commerce student and a Science student now sit the same papers** — one practice
 * pool, one mock test list, one daily challenge per day.
 *
 * ## Report-only unless told otherwise
 *
 * Prints exactly what it would change and exits. `--write` performs it. That is the rule every
 * script in this project follows (`assertConfiguredForWrites()`), and it exists because every
 * environment variable has a plausible default: a misconfigured script is silently successful, and
 * this one rewrites the field that decides which children see which questions.
 *
 * ## The collision this script exists to catch
 *
 * `DailyChallenge` has a **unique index on `{day, classLevel}`**. If 2026-09-01 had a challenge for
 * Class 12 - Science *and* one for Class 12 - Commerce, both become `{2026-09-01, Class 12}` and the
 * second write fails. A migration that hit that mid-run would leave the database half-converted.
 *
 * So collisions are detected **first**, reported day by day, and the run refuses to proceed without
 * `--resolve-challenges`, which keeps the earliest-created challenge for each day and deletes the
 * rest. Deleting a scheduled challenge is a real loss of an administrator's decision, so it is not
 * something to do implicitly.
 *
 * ## What is deliberately NOT migrated
 *
 * **`Certificate.classLevel`** and **`GenerationLog.classLevel`** are historical records, not live
 * configuration. A certificate is a snapshot of what was printed and handed to a child; rewriting it
 * would make the record disagree with the paper. A generation log records what was *asked for* on a
 * date. Both are plain `String` fields rather than enums, so a retired value still reads back
 * correctly for ever. They are counted and reported so nobody thinks they were missed.
 *
 * ## Usage
 *
 * ```
 * npm run migrate:classes --prefix backend                          # report only
 * npm run migrate:classes --prefix backend -- --write               # convert
 * npm run migrate:classes --prefix backend -- --write --resolve-challenges
 * npm run migrate:classes --prefix backend -- --write --local       # against a local database
 * ```
 */

const RETIRED = Object.keys(RETIRED_CLASS_LEVELS);

/** Every collection whose `classLevel` decides what a user sees, and must be converted. */
const LIVE_TARGETS: ReadonlyArray<{ collection: string; field: string; why: string }> = [
  { collection: 'students', field: 'classLevel', why: 'which questions and papers the student is served' },
  { collection: 'questions', field: 'classLevel', why: 'which class a question belongs to' },
  { collection: 'mocktests', field: 'classLevel', why: 'which class may sit the test' },
  { collection: 'dailychallenges', field: 'classLevel', why: 'which class gets the day’s challenge' },
  { collection: 'practicesessions', field: 'filters.classLevel', why: 'the class a past paper was drawn for' },
  { collection: 'exams', field: 'classLevel', why: 'which class sits the official exam' },
  { collection: 'notifications', field: 'classLevel', why: 'which class an announcement reaches' },
];

/** Historical records, reported but never rewritten. */
const HISTORICAL_TARGETS: ReadonlyArray<{ collection: string; field: string; why: string }> = [
  { collection: 'certificates', field: 'classLevel', why: 'a snapshot of what was printed and awarded' },
  { collection: 'generationlogs', field: 'classLevel', why: 'a record of what was asked for on a date' },
];

interface ChallengeCollision {
  day: string;
  keep: { id: string; classLevel: string; createdAt: Date };
  drop: Array<{ id: string; classLevel: string; createdAt: Date }>;
}

async function findChallengeCollisions(db: mongoose.mongo.Db): Promise<ChallengeCollision[]> {
  const rows = await db
    .collection('dailychallenges')
    .find({ classLevel: { $in: RETIRED } })
    .project({ day: 1, classLevel: 1, createdAt: 1 })
    .sort({ day: 1, createdAt: 1 })
    .toArray();

  const byDay = new Map<string, Array<{ id: string; classLevel: string; createdAt: Date }>>();
  for (const row of rows) {
    const day = String(row.day);
    const entry = {
      id: String(row._id),
      classLevel: String(row.classLevel),
      createdAt: (row.createdAt as Date) ?? new Date(0),
    };
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }

  const collisions: ChallengeCollision[] = [];
  for (const [day, entries] of byDay) {
    if (entries.length < 2) continue;

    /**
     * A day that *already* has a plain `Class 12` challenge collides too, and it wins — it is
     * already in the shape the migration is converting towards, so keeping a stream row over it
     * would undo a decision somebody made after the change.
     */
    const existing = await db.collection('dailychallenges').findOne({ day, classLevel: 'Class 12' });

    if (existing) {
      collisions.push({
        day,
        keep: {
          id: String(existing._id),
          classLevel: 'Class 12',
          createdAt: (existing.createdAt as Date) ?? new Date(0),
        },
        drop: entries,
      });
      continue;
    }

    // Earliest-created wins: it is the decision that was made first, and there is no better rule.
    const [keep, ...drop] = entries;
    collisions.push({ day, keep: keep!, drop });
  }

  return collisions;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const resolveChallenges = args.has('--resolve-challenges');

  /**
   * The guard prints the target database and refuses a local write without `--local`.
   *
   * Called **first**, before anything is read, so a misconfigured run cannot even look at the wrong
   * database — this is the script whose whole job is rewriting the field that decides which children
   * see which questions.
   */
  assertConfiguredForWrites({ script: 'migrate-class-levels', allowLocal: args.has('--local') });

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection.');

  console.log(`\nDatabase: ${db.databaseName}`);
  console.log(`Mode:     ${write ? 'WRITE' : 'report only (pass --write to convert)'}`);
  console.log(`Retiring: ${RETIRED.join(', ')}  ->  Class 12\n`);

  // ---- What is out there ---------------------------------------------------

  let liveTotal = 0;
  console.log('Live data (will be converted):');
  for (const target of LIVE_TARGETS) {
    const count = await db.collection(target.collection).countDocuments({ [target.field]: { $in: RETIRED } });
    liveTotal += count;
    console.log(`  ${String(count).padStart(6)}  ${target.collection}.${target.field}  — ${target.why}`);
  }

  console.log('\nHistorical data (deliberately NOT converted):');
  for (const target of HISTORICAL_TARGETS) {
    const count = await db.collection(target.collection).countDocuments({ [target.field]: { $in: RETIRED } });
    console.log(`  ${String(count).padStart(6)}  ${target.collection}.${target.field}  — ${target.why}`);
  }

  // ---- The unique-index collision -----------------------------------------

  const collisions = await findChallengeCollisions(db);

  if (collisions.length > 0) {
    console.log(
      `\n!! ${collisions.length} day(s) would break the unique index on dailychallenges {day, classLevel}:`,
    );
    for (const collision of collisions) {
      console.log(`  ${collision.day}`);
      console.log(`    keep  ${collision.keep.classLevel}  (created ${collision.keep.createdAt.toISOString()})`);
      for (const dropped of collision.drop) {
        console.log(`    DROP  ${dropped.classLevel}  (created ${dropped.createdAt.toISOString()})`);
      }
    }
    console.log(
      '\n  Each DROP is a scheduled challenge an administrator chose. Re-run with --resolve-challenges\n' +
        '  to delete them, or reschedule those days by hand first.',
    );
  } else {
    console.log('\nNo daily-challenge collisions: every affected day has at most one Class 12 challenge.');
  }

  if (liveTotal === 0) {
    console.log('\nNothing to convert. This database has no Class 12 stream values.\n');
    await disconnectDB();
    return;
  }

  if (!write) {
    console.log(`\n${liveTotal} document(s) would be updated. Re-run with --write to do it.\n`);
    await disconnectDB();
    return;
  }

  if (collisions.length > 0 && !resolveChallenges) {
    console.log('\nRefusing to write while collisions are unresolved. Nothing has been changed.\n');
    await disconnectDB();
    process.exitCode = 1;
    return;
  }

  // ---- Convert -------------------------------------------------------------

  console.log('\nConverting…');

  /**
   * The collisions are resolved **before** the rewrite, not after.
   *
   * The other order fails: rewriting first is what triggers the duplicate-key error, and it would
   * do so partway through a collection with no record of how far it got.
   */
  if (collisions.length > 0) {
    const ids = collisions.flatMap((collision) => collision.drop.map((dropped) => new mongoose.Types.ObjectId(dropped.id)));
    const result = await db.collection('dailychallenges').deleteMany({ _id: { $in: ids } });
    console.log(`  dropped ${result.deletedCount} colliding daily challenge(s)`);
  }

  for (const target of LIVE_TARGETS) {
    const result = await db
      .collection(target.collection)
      .updateMany({ [target.field]: { $in: RETIRED } }, { $set: { [target.field]: 'Class 12' } });
    console.log(`  ${String(result.modifiedCount).padStart(6)}  ${target.collection}.${target.field}`);
  }

  // ---- Prove it -----------------------------------------------------------

  let remaining = 0;
  for (const target of LIVE_TARGETS) {
    remaining += await db.collection(target.collection).countDocuments({ [target.field]: { $in: RETIRED } });
  }

  console.log(
    remaining === 0
      ? '\nDone. No live document still holds a retired class value.\n'
      : `\n!! ${remaining} live document(s) still hold a retired value. Re-run to see which.\n`,
  );

  await disconnectDB();
  if (remaining > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('\nMigration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
  void disconnectDB();
});
