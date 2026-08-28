import mongoose from 'mongoose';
import { assertConfiguredForWrites } from '../src/lib/envGuard';
import { connectDB, disconnectDB } from '../src/db/connection';

/**
 * Archives every active subject that is not the mathematics one (Milestone 21, Phase L).
 *
 * ## Why this exists
 *
 * AMIT is a mathematics olympiad, and since Phase J nobody chooses a subject: there is no dropdown,
 * no filter and no management page. `Subject` stays on the backend because `Topic` is scoped by it,
 * and the product resolves the one implicit subject with `findImplicitSubject()`.
 *
 * A database seeded before that — this project's own `scripts/seed-class12.ts` did it until Phase J
 * deleted the Physics half — still holds a second subject with published questions under it. Phase L
 * scoped every student-facing path to the implicit subject, so those questions are no longer served.
 * But they are still marked `published`, they still fill the Question Bank, and there is no longer
 * any screen on which an administrator could retire the subject they belong to.
 *
 * This script is that screen.
 *
 * ## What it does and does not do
 *
 * It sets `Subject.status = 'archived'`. That is all. **No question is deleted, edited, unpublished
 * or moved**, and nothing is renamed — the questions stay exactly where they are, readable and
 * filterable in the Question Bank, and every historical attempt that referenced them still resolves.
 * Archiving is the reversible half of the taxonomy lifecycle; it is what the taxonomy page already
 * did to a subject before Phase J removed the button, and `PATCH /api/v1/admin/subjects/:id` still
 * does it.
 *
 * Archiving is also what the aggregations already understand: `availabilityPipeline()` in both
 * `practiceService` and `challengeService` matches `subjectDoc.status: 'active'`, so an archived
 * subject drops out of every student surface on its own — and out of `findImplicitSubject()`, which
 * only ever looks at active subjects. That last part is the real prize: with one active subject the
 * implicit resolution stops depending on a *name* matching `/^(math|maths|mathematics)$/`.
 *
 * ## Report-only unless told otherwise
 *
 * Prints what it would archive and exits. `--write` performs it. Every script in this project that
 * touches the database follows that rule via `assertConfiguredForWrites()`, because every
 * environment variable has a plausible default and a misconfigured script is silently successful.
 *
 * ## It refuses rather than guesses
 *
 * If it cannot find a subject named for mathematics it **stops without archiving anything**, because
 * the alternative is archiving every subject in the database and leaving a product with no taxonomy
 * at all. Renaming the intended subject to `Mathematics` is a one-field edit; recovering from a
 * blanket archive is not.
 *
 * ## Usage
 *
 * ```
 * npm run retire:subjects --prefix backend             # report only
 * npm run retire:subjects --prefix backend -- --write  # archive them
 * npm run retire:subjects --prefix backend -- --write --local   # against a local database
 * ```
 */

const ARGS = new Set(process.argv.slice(2));
const WRITE = ARGS.has('--write');

/** The same test `findImplicitSubject()` and the Chapters page both apply. Keep the three in step. */
const MATHS = /^(math|maths|mathematics)$/iu;

interface SubjectRow {
  _id: mongoose.Types.ObjectId;
  name: string;
  status: string;
}

async function main(): Promise<void> {
  // Prints the target database and refuses a local write without --local, exactly as every other
  // script here does. `backend/.env` holds the production URI, so an unguarded run from a shell that
  // loaded it would archive subjects in live data.
  assertConfiguredForWrites({ script: 'retire-extra-subjects', allowLocal: ARGS.has('--local') });
  await connectDB();

  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connecting.');

  const active = await db.collection<SubjectRow>('subjects').find({ status: 'active' }).toArray();

  console.log(`\nActive subjects: ${active.length}`);
  for (const subject of active) {
    const topics = await db.collection('topics').countDocuments({ subject: subject._id });
    const questions = await db.collection('questions').countDocuments({ subject: subject._id });
    const published = await db.collection('questions').countDocuments({ subject: subject._id, status: 'published' });
    const keep = MATHS.test(subject.name.trim());
    console.log(
      `  ${keep ? 'KEEP   ' : 'ARCHIVE'}  ${subject.name.padEnd(24)}` +
        `${String(topics).padStart(4)} chapters  ${String(questions).padStart(5)} questions ` +
        `(${published} published)`,
    );
  }

  const maths = active.filter((subject) => MATHS.test(subject.name.trim()));
  const extra = active.filter((subject) => !MATHS.test(subject.name.trim()));

  if (extra.length === 0) {
    console.log('\nNothing to do: mathematics is the only active subject.\n');
    await disconnectDB();
    return;
  }

  /**
   * Refuse rather than archive everything. See the header — a blanket archive would leave the
   * product with no taxonomy, and renaming a subject is the far cheaper fix.
   */
  if (maths.length === 0) {
    console.log(
      '\n!! No active subject is named for mathematics, so there is nothing to keep.\n' +
        '   Nothing has been changed. Rename the subject these chapters belong under to\n' +
        '   "Mathematics" first — the product resolves its one implicit subject by that name.\n',
    );
    await disconnectDB();
    process.exitCode = 1;
    return;
  }

  if (maths.length > 1) {
    console.log(
      `\n!! ${maths.length} active subjects are named for mathematics, so "the" one is ambiguous.\n` +
        '   Nothing has been changed. Merge or rename them first.\n',
    );
    await disconnectDB();
    process.exitCode = 1;
    return;
  }

  if (!WRITE) {
    console.log(
      `\nReport only. ${extra.length} subject(s) would be archived; no question would be deleted,\n` +
        'edited or unpublished. Re-run with --write to perform it.\n',
    );
    await disconnectDB();
    return;
  }

  const result = await db
    .collection('subjects')
    .updateMany({ _id: { $in: extra.map((subject) => subject._id) } }, { $set: { status: 'archived' } });

  const stillActive = await db.collection('subjects').countDocuments({ status: 'active' });
  console.log(`\n  archived ${result.modifiedCount} subject(s); ${stillActive} still active`);
  console.log(
    stillActive === 1
      ? 'Done. One active subject remains, so the implicit subject is now unambiguous.\n'
      : `!! ${stillActive} subjects are still active. Re-run to see which.\n`,
  );

  await disconnectDB();
  if (stillActive !== 1) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
  void disconnectDB();
});
