import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/db/connection';
import { assertConfiguredForWrites } from '../src/lib/envGuard';
import { Question, Subject, Topic } from '../src/models';
import { validateMathContent } from '../src/lib/mathContent';
import { slugify } from '../src/lib/slug';
import { createQuestionSchema } from '../src/validation/questionSchemas';
import { CLASS12_MATHS } from './data/class12Maths';
import { CLASS12_PHYSICS } from './data/class12Physics';
import type { SeedQuestion, SeedSubject } from './data/seedTypes';

/**
 * Publishes the Class 12 Mathematics and Physics question banks.
 *
 *   npx tsx scripts/seed-class12.ts            # report only, writes nothing
 *   npx tsx scripts/seed-class12.ts --write    # actually publish
 *
 * Run it from inside `backend/`, not the repo root.
 *
 * ## Design notes
 *
 * **Report-only by default**, like `migrate-questions.ts` and
 * `backfill-activity.ts`. A script that writes to the production database the moment
 * it is invoked is one typo away from an accident.
 *
 * **Idempotent.** A question is identified by its `questionText` within its class, so
 * re-running skips whatever already exists rather than creating duplicates. That
 * matters because the natural reaction to a half-finished run is to run it again.
 *
 * **Validated with the API's own rules.** Every question passes through
 * `createQuestionSchema` — the exact zod schema `POST /admin/questions` uses — plus
 * `validateMathContent` on each field. So a malformed `$` or a single-choice question
 * with two correct options fails here, loudly, instead of reaching the database. This
 * is deliberately stricter than a direct `insertMany` would be.
 *
 * **Options are shuffled.** The authoring helpers put the correct answer first for
 * readability; writing them in that order would make every answer option `a`, which
 * is worse than useless for practice. The shuffle is seeded from the question text, so
 * it is deterministic: the same question always gets the same option order, and a
 * re-run cannot silently reshuffle a question students have already answered.
 *
 * **Published immediately.** These are complete questions with worked solutions, so
 * they go straight to `published` rather than sitting in `draft` — the editorial
 * workflow exists for human authoring, and a seed that lands as invisible drafts would
 * not actually stock the Practice Zone.
 */

const CLASS_LEVEL = 'Class 12 - Science' as const;
const WRITE = process.argv.includes('--write');

/** Small deterministic PRNG, seeded from a string. Good enough to shuffle options. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  const next = () => {
    // xorshift32 — deterministic and well spread, which is all that is needed here.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };

  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

interface Counts {
  created: number;
  skipped: number;
  failed: number;
}

/** Finds or creates a subject by name, returning its id. */
async function ensureSubject(name: string): Promise<mongoose.Types.ObjectId> {
  const slug = slugify(name);
  const existing = await Subject.findOne({ slug });
  if (existing) return existing._id as mongoose.Types.ObjectId;

  const created = await Subject.create({ name, slug, status: 'active' });
  console.log(`  + subject "${name}"`);
  return created._id as mongoose.Types.ObjectId;
}

/** Finds or creates a top-level topic under a subject. */
async function ensureTopic(subject: mongoose.Types.ObjectId, name: string): Promise<mongoose.Types.ObjectId> {
  const slug = slugify(name);
  const existing = await Topic.findOne({ subject, slug, parent: null });
  if (existing) return existing._id as mongoose.Types.ObjectId;

  const created = await Topic.create({ subject, parent: null, depth: 0, name, slug, status: 'active' });
  console.log(`  + topic "${name}"`);
  return created._id as mongoose.Types.ObjectId;
}

/**
 * Validates one seed question and writes it, unless an identical question text
 * already exists for this class.
 */
async function publishQuestion(
  seed: SeedQuestion,
  subject: mongoose.Types.ObjectId,
  topic: mongoose.Types.ObjectId,
  counts: Counts,
): Promise<void> {
  // Checked before the schema so the message names the offending field directly.
  for (const [label, value] of [
    ['Question text', seed.questionText],
    ['Solution', seed.solution],
    ...seed.options.map((option, i) => [`Option ${i + 1}`, option.text] as const),
  ] as Array<readonly [string, string]>) {
    const problem = validateMathContent(value, label);
    if (problem) {
      console.error(`  ✗ ${problem}\n    in: ${seed.questionText.slice(0, 70)}…`);
      counts.failed += 1;
      return;
    }
  }

  const payload = {
    questionText: seed.questionText,
    type: seed.type,
    // Shuffled so the correct option is not always the first one.
    options: seededShuffle(seed.options, seed.questionText).map((option) => ({
      text: option.text,
      isCorrect: option.isCorrect,
    })),
    booleanAnswer: seed.booleanAnswer,
    numericAnswer: seed.numericAnswer,
    tolerance: seed.tolerance,
    solution: seed.solution,
    subject: String(subject),
    topic: String(topic),
    subtopic: null,
    classLevel: CLASS_LEVEL,
    difficulty: seed.difficulty,
    marks: seed.marks,
    negativeMarks: seed.negativeMarks,
    tags: seed.tags,
  };

  const parsed = createQuestionSchema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    console.error(`  ✗ ${detail}\n    in: ${seed.questionText.slice(0, 70)}…`);
    counts.failed += 1;
    return;
  }

  const already = await Question.findOne({ questionText: seed.questionText, classLevel: CLASS_LEVEL }).select('_id');
  if (already) {
    counts.skipped += 1;
    return;
  }

  if (!WRITE) {
    counts.created += 1;
    return;
  }

  // Option keys are assigned here the same way the service does: a, b, c, ...
  const options = parsed.data.options.map((option, index) => ({
    key: String.fromCharCode(97 + index),
    text: option.text,
    isCorrect: option.isCorrect,
  }));

  await Question.create({
    ...parsed.data,
    options,
    subject,
    topic,
    subtopic: null,
    status: 'published',
    publishedAt: new Date(),
    createdByLabel: 'seed-class12',
    updatedByLabel: 'seed-class12',
    revision: 1,
  });
  counts.created += 1;
}

async function seedSubject(data: SeedSubject, counts: Counts): Promise<void> {
  console.log(`\n${data.subject}`);
  const subjectId = await ensureSubject(data.subject);

  for (const topicSeed of data.topics) {
    const topicId = await ensureTopic(subjectId, topicSeed.topic);
    for (const question of topicSeed.questions) {
      await publishQuestion(question, subjectId, topicId, counts);
    }
    console.log(`  ${topicSeed.topic}: ${topicSeed.questions.length} question(s)`);
  }
}

async function main(): Promise<void> {
  console.log('Seeding Class 12 questions.');
  // Refuses to continue if this would silently write to a local database — the
  // mistake that put 208 questions somewhere nobody was looking. See lib/envGuard.ts.
  assertConfiguredForWrites({ script: 'seed-class12.ts', allowLocal: process.argv.includes('--local') });
  console.log(WRITE ? 'Mode: WRITE — questions will be published.\n' : 'Mode: report only. Re-run with --write to publish.\n');

  await connectDB();

  const counts: Counts = { created: 0, skipped: 0, failed: 0 };
  await seedSubject(CLASS12_MATHS, counts);
  await seedSubject(CLASS12_PHYSICS, counts);

  const authored =
    CLASS12_MATHS.topics.reduce((sum, t) => sum + t.questions.length, 0) +
    CLASS12_PHYSICS.topics.reduce((sum, t) => sum + t.questions.length, 0);

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Authored in this seed : ${authored}`);
  console.log(`${WRITE ? 'Published' : 'Would publish'}      : ${counts.created}`);
  console.log(`Already present      : ${counts.skipped}`);
  console.log(`Rejected (invalid)   : ${counts.failed}`);

  const live = await Question.countDocuments({ classLevel: CLASS_LEVEL, status: 'published' });
  console.log(`Published for ${CLASS_LEVEL}: ${live}`);

  if (counts.failed > 0) {
    console.error('\nSome questions were rejected by validation — fix them before relying on this bank.');
  }

  await disconnectDB();
  // A non-zero exit on rejection so a CI step or a shell `&&` chain notices.
  process.exit(counts.failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Seeding failed:', err);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
