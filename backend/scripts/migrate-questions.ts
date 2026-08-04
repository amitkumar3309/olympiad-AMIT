/**
 * Reports — and optionally removes — `Question` documents written before Milestone 4.
 *
 * ## Why this exists
 *
 * Milestone 4 changed the question schema in ways that are not backward compatible:
 *
 *  - `subject` went from a free-text `String` to an `ObjectId` reference,
 *  - `topic` became a required `ObjectId` reference (it was not stored at all),
 *  - `options` went from `[String]` to `[{ key, text, isCorrect }]`,
 *  - `correctAnswer: String` was replaced by the per-option `isCorrect` flag.
 *
 * The first of those is the problem. A missing field reads back as `undefined` and
 * can be tolerated (that is how the Milestone 4 `Student` fields work), but a
 * `String` where the schema now declares an `ObjectId` makes Mongoose throw a
 * **cast error on read**. A legacy document is therefore not merely incomplete, it is
 * unreadable through the model — so the "required on create only" trick used for
 * students cannot rescue it.
 *
 * Every document that could exist here was produced by the old template generator
 * ("...What is the advanced solution for X? [Sample 1]"), which was never real
 * content, and nothing references questions yet — `ExamAttempt` and `Result` are
 * still unwired. So there is no data of value to preserve, and no attempt data to
 * orphan. Deleting them is the honest fix; inventing a subject and topic to migrate
 * them onto would just launder placeholder text into the real bank.
 *
 * ## Usage
 *
 * Report only (safe, the default — makes no change):
 *
 *   npx tsx scripts/migrate-questions.ts
 *
 * Delete the legacy documents:
 *
 *   npx tsx scripts/migrate-questions.ts --delete
 */
import mongoose from 'mongoose';
import { config } from '../src/config';

const DELETE = process.argv.includes('--delete');

async function main(): Promise<void> {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connecting.');

  const questions = db.collection('questions');

  // Identified by shape, not by date: a legacy document is one whose `subject` is a
  // string, or which has the removed `correctAnswer` field, or which lacks the now
  // required `topic`. Reading through the raw driver rather than the Mongoose model
  // deliberately — the model is what cannot cast these.
  const legacyFilter = {
    $or: [{ subject: { $type: 'string' } }, { correctAnswer: { $exists: true } }, { topic: { $exists: false } }],
  };

  const total = await questions.countDocuments({});
  const legacy = await questions.countDocuments(legacyFilter);

  console.log(`questions collection: ${total} document(s) total, ${legacy} legacy (pre-Milestone-4).`);

  if (legacy === 0) {
    console.log('Nothing to do — every document already matches the current schema.');
    await mongoose.disconnect();
    return;
  }

  const samples = await questions.find(legacyFilter).limit(3).toArray();
  console.log('\nSample legacy documents:');
  for (const doc of samples) {
    console.log(`  _id=${String(doc._id)}  subject=${JSON.stringify(doc.subject)}  text=${String(doc.questionText).slice(0, 70)}...`);
  }

  if (!DELETE) {
    console.log(
      `\nNo change made. These ${legacy} document(s) cannot be read through the current model and will cause cast errors.`,
    );
    console.log('Re-run with --delete to remove them:\n  npx tsx scripts/migrate-questions.ts --delete');
    await mongoose.disconnect();
    return;
  }

  const result = await questions.deleteMany(legacyFilter);
  console.log(`\nDeleted ${result.deletedCount} legacy question document(s).`);
  console.log('The question bank is now empty of pre-Milestone-4 content. Author real questions at /admin/questions.');

  await mongoose.disconnect();
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
  void mongoose.disconnect();
});
