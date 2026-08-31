import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../../src/db/connection';
import { assertConfiguredForWrites } from '../../src/lib/envGuard';
import { Question, Subject, Topic } from '../../src/models';
import type { ClassLevel } from '../../src/lib/classLevels';
import { validateMathContent } from '../../src/lib/mathContent';
import { slugify } from '../../src/lib/slug';
import { createQuestionSchema } from '../../src/validation/questionSchemas';
import type { SeedQuestion, SeedSubject } from '../data/seedTypes';

/**
 * **The** question-bank seed runner, shared by every class-level seed script.
 *
 * It was the body of `seed-class12.ts` until Milestone 24, when a Class 9 bank was
 * added for the client demo. Copying five hundred lines to change one constant is how
 * two seeds end up disagreeing about what a valid question is — and the *seed* is the
 * one place in this product that writes questions without a human reviewing each one,
 * so the copy that drifted would be the one publishing weaker content to children.
 * A class level is a parameter; the rules are not.
 *
 * ## The properties this file exists to hold
 *
 * **Report-only by default**, like `migrate-questions.ts` and `backfill-activity.ts`. A
 * script that writes to the production database the moment it is invoked is one typo
 * away from an accident. `--write` is the acknowledgement.
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
 * readability; writing them in that order would make every answer option `a`, which is
 * worse than useless for practice. The shuffle is seeded from the question text, so it
 * is deterministic: the same question always gets the same option order, and a re-run
 * cannot silently reshuffle a question students have already answered.
 *
 * **Published immediately.** These are complete questions with worked solutions, so
 * they go straight to `published` rather than sitting in `draft` — the editorial
 * workflow exists for human authoring, and a seed that lands as invisible drafts would
 * not actually stock the Practice Zone. It is also what makes them eligible to be a
 * daily challenge, which only ever serves a published question.
 *
 * **A dry run writes nothing at all, including taxonomy.** Report-only used to create
 * the subject and topics anyway, which made "writes nothing" untrue: a dry run against
 * production left two subjects and twenty-six topics behind. Harmless in itself, but a
 * dry run that writes is a dry run nobody can trust.
 */

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

export interface QuestionSeedOptions {
  /** The script's own filename, for the guard's messages. */
  script: string;
  /** The class every question in this seed is filed under. */
  classLevel: ClassLevel;
  /** What is being seeded, one subject's worth of topics. */
  data: SeedSubject;
  /** Written to `createdByLabel` so the bank records where a question came from. */
  label: string;
  /** Usually `process.argv`. Read for `--write` and `--local`. */
  argv: readonly string[];
}

/** Finds or creates a subject by name; `null` in report-only mode if it is absent. */
async function ensureSubject(name: string, write: boolean): Promise<mongoose.Types.ObjectId | null> {
  const slug = slugify(name);
  const existing = await Subject.findOne({ slug });
  if (existing) return existing._id as mongoose.Types.ObjectId;
  if (!write) {
    console.log(`  (would create subject "${name}")`);
    return null;
  }

  const created = await Subject.create({ name, slug, status: 'active' });
  console.log(`  + subject "${name}"`);
  return created._id as mongoose.Types.ObjectId;
}

/** Finds or creates a top-level topic; `null` in report-only mode if absent. */
async function ensureTopic(
  subject: mongoose.Types.ObjectId,
  name: string,
  write: boolean,
): Promise<mongoose.Types.ObjectId | null> {
  const slug = slugify(name);
  const existing = await Topic.findOne({ subject, slug, parent: null });
  if (existing) return existing._id as mongoose.Types.ObjectId;
  if (!write) return null;

  const created = await Topic.create({ subject, parent: null, depth: 0, name, slug, status: 'active' });
  console.log(`  + topic "${name}"`);
  return created._id as mongoose.Types.ObjectId;
}

interface PublishContext {
  classLevel: ClassLevel;
  label: string;
  write: boolean;
  counts: Counts;
}

/**
 * Validates one seed question and writes it, unless an identical question text already
 * exists for this class.
 */
async function publishQuestion(
  seed: SeedQuestion,
  subject: mongoose.Types.ObjectId,
  topic: mongoose.Types.ObjectId,
  ctx: PublishContext,
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
      ctx.counts.failed += 1;
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
    classLevel: ctx.classLevel,
    difficulty: seed.difficulty,
    marks: seed.marks,
    negativeMarks: seed.negativeMarks,
    tags: seed.tags,
  };

  const parsed = createQuestionSchema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    console.error(`  ✗ ${detail}\n    in: ${seed.questionText.slice(0, 70)}…`);
    ctx.counts.failed += 1;
    return;
  }

  const already = await Question.findOne({
    questionText: seed.questionText,
    classLevel: ctx.classLevel,
  }).select('_id');
  if (already) {
    ctx.counts.skipped += 1;
    return;
  }

  if (!ctx.write) {
    ctx.counts.created += 1;
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
    createdByLabel: ctx.label,
    updatedByLabel: ctx.label,
    revision: 1,
  });
  ctx.counts.created += 1;
}

/**
 * Runs the validation half only, for report-only mode when the taxonomy does not exist
 * yet and there are no real ids to check against. Uses placeholder ids so the schema
 * still exercises every content rule — which is the part of a dry run worth having.
 */
async function validateOnly(seed: SeedQuestion, ctx: PublishContext): Promise<void> {
  const placeholder = new mongoose.Types.ObjectId();
  await publishQuestion(seed, placeholder, placeholder, ctx);
}

async function seedSubject(data: SeedSubject, ctx: PublishContext): Promise<void> {
  console.log(`\n${data.subject}`);
  const subjectId = await ensureSubject(data.subject, ctx.write);

  for (const topicSeed of data.topics) {
    const topicId = subjectId ? await ensureTopic(subjectId, topicSeed.topic, ctx.write) : null;

    if (!subjectId || !topicId) {
      // Report-only, and the taxonomy is not there yet. The questions are still fully
      // validated — the useful half of a dry run — they simply have no real ids to be
      // attached to, and nothing is written.
      for (const question of topicSeed.questions) {
        await validateOnly(question, ctx);
      }
      console.log(`  ${topicSeed.topic}: ${topicSeed.questions.length} question(s) validated`);
      continue;
    }

    for (const question of topicSeed.questions) {
      await publishQuestion(question, subjectId, topicId, ctx);
    }
    console.log(`  ${topicSeed.topic}: ${topicSeed.questions.length} question(s)`);
  }
}

/**
 * Seeds one class level's question bank and exits the process.
 *
 * Exits non-zero when any question was rejected by validation, so a CI step or a shell
 * `&&` chain notices — a seed that half worked is exactly the case an operator would
 * otherwise miss in the scrollback.
 */
export async function runQuestionSeed(options: QuestionSeedOptions): Promise<void> {
  try {
    await seed(options);
  } catch (err) {
    console.error('Seeding failed:', err);
    // Released explicitly: an open Mongoose connection keeps the event loop alive, so a
    // failed seed would hang the terminal rather than reporting and stopping.
    await disconnectDB().catch(() => undefined);
    process.exit(1);
  }
}

async function seed(options: QuestionSeedOptions): Promise<void> {
  const write = options.argv.includes('--write');

  console.log(`Seeding ${options.classLevel} questions.`);
  // Refuses to continue if this would silently write to a local database — the mistake
  // that put 208 questions somewhere nobody was looking. See lib/envGuard.ts.
  assertConfiguredForWrites({ script: options.script, allowLocal: options.argv.includes('--local') });
  console.log(
    write
      ? 'Mode: WRITE — questions will be published.\n'
      : 'Mode: report only. Re-run with --write to publish.\n',
  );

  await connectDB();

  const counts: Counts = { created: 0, skipped: 0, failed: 0 };
  await seedSubject(options.data, {
    classLevel: options.classLevel,
    label: options.label,
    write,
    counts,
  });

  const authored = options.data.topics.reduce((sum, topic) => sum + topic.questions.length, 0);

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Authored in this seed : ${authored}`);
  console.log(`${write ? 'Published' : 'Would publish'}      : ${counts.created}`);
  console.log(`Already present      : ${counts.skipped}`);
  console.log(`Rejected (invalid)   : ${counts.failed}`);

  const live = await Question.countDocuments({ classLevel: options.classLevel, status: 'published' });
  console.log(`Published for ${options.classLevel}: ${live}`);

  if (counts.failed > 0) {
    console.error('\nSome questions were rejected by validation — fix them before relying on this bank.');
  }

  await disconnectDB();
  process.exit(counts.failed > 0 ? 1 : 0);
}
