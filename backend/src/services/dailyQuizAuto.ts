import { Types } from 'mongoose';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import { now } from '../lib/clock';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';
import { dayKeyOf, type DayKey } from '../lib/competitionDay';
import { classNumber } from '../lib/dailyQuiz';
import { slugify } from '../lib/slug';
import { quizDraftFor } from '../lib/mathTemplates';
import { DailyChallenge, Question, Topic, type AutoQuizSource } from '../models';
import { createQuestionSchema } from '../validation/questionSchemas';
import { createQuestion, toQuestionContent } from './questionService';
import { findImplicitSubject, requireImplicitSubject, type Actor } from './taxonomyService';
import { getQuizSettings, scheduleQuiz, type QuizSettings } from './dailyChallengeService';

/**
 * **The automatic Daily Quiz** (owner, 2026-10-10: "a question is posted automatically daily for
 * each class and admin/superadmin doesn't have to publish daily quiz manually").
 *
 * ## What it does
 *
 * For a day, every class (3 to 12) that has **no** quiz gets one, of its own level, through
 * `scheduleQuiz()` — the same path staff use, so every rule a scheduled quiz obeys (an unpublished
 * question, one correct option, a worked solution, one quiz per class per day, the snapshot) holds
 * here too. A quiz staff scheduled is never replaced: automation only fills an empty class.
 *
 * Where the question comes from is `DailyQuizSettings.autoSource`:
 *
 * - **`pool_then_generated`** (default) — the oldest unused **draft** question for that class tagged
 *   **"daily quiz"**, which is how staff put a question aside for the quiz (the editor's Tags field,
 *   or a Tags column in an import); when the pool has none, a generated one.
 * - **`generated_only`** — always generated.
 *
 * A generated question comes from the same templates as the practice bank
 * (`lib/mathTemplates`), so its answer is **computed** from its own numbers, never guessed. It is
 * written to the bank as a draft (provenance `quiz_generator`) and refused if its text is already in
 * the bank for that class, because a published copy would show the answer in Practice.
 *
 * ## Why the old automatic fill was removed, and why this is different
 *
 * Milestone 30 (PLAN.md Q4) removed an automatic fill that picked a **published** practice question,
 * whose solution any student could read beforehand. This one never uses a published question.
 *
 * ## When it runs
 *
 * No scheduler is needed (the free plan has none): the first request of the day that asks about a
 * class's quiz fills it (`resolveQuizFor()`), the homepage's "is there a quiz today" check fills every
 * class (`publicQuizToday()`), and so do the reminder job and `POST /jobs/daily-quiz-schedule` if an
 * outside scheduler calls them. Two servers filling the same class at once are settled by the unique
 * `{day, classLevel}` index; the loser removes the question it generated.
 */

const AUTOMATIC: Actor = { id: null, label: 'Automatic' };

/** The tags that put a draft question into the quiz pool (tags are stored lower-case). */
export const QUIZ_POOL_TAGS = ['daily quiz', 'daily-quiz', 'dailyquiz'] as const;

/** How many generated questions to try before giving up on a class for the day. */
const GENERATION_ATTEMPTS = 25;

function poolFilter(classLevel: ClassLevel, used: Types.ObjectId[], subject: Types.ObjectId | null): Record<string, unknown> {
  return {
    type: 'single_choice',
    status: { $in: ['draft', 'in_review'] },
    classLevel,
    tags: { $in: [...QUIZ_POOL_TAGS] },
    $or: [{ solution: { $nin: [null, ''] } }, { 'solutionImage.key': { $exists: true } }],
    _id: { $nin: used },
    ...(subject ? { subject } : {}),
  };
}

/** True when the error is the unique index refusing a second quiz for the class — somebody else filled it. */
function isTaken(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode === 409;
}

export type AutoFillOutcome = 'exists' | 'off' | 'pool' | 'generated' | 'failed';

/**
 * Fills one class's quiz for a day if it has none. Never throws: a failure is logged and reported
 * as `failed`, because the caller is a student's request, and a quiz that could not be made must
 * leave them with "no quiz today" rather than an error page.
 */
export async function ensureAutoQuiz(
  classLevel: ClassLevel,
  day: DayKey,
  at: Date = now(),
  known?: QuizSettings,
): Promise<AutoFillOutcome> {
  try {
    if (await DailyChallenge.exists({ day, classLevel })) return 'exists';
    const settings = known ?? (await getQuizSettings());
    if (!settings.autoSchedule) return 'off';

    if (settings.autoSource === 'pool_then_generated' && (await fillFromPool(classLevel, day, at))) return 'pool';
    if (await DailyChallenge.exists({ day, classLevel })) return 'exists';
    return (await fillGenerated(classLevel, day, at)) ? 'generated' : 'failed';
  } catch (err) {
    logger.error({ err, classLevel, day }, 'Could not fill the automatic Daily Quiz');
    return 'failed';
  }
}

/** Every class's quiz for a day. Classes are filled one after another (ten small writes at most). */
export async function ensureAutoQuizzes(day: DayKey, at: Date = now()): Promise<Record<ClassLevel, AutoFillOutcome>> {
  const [docs, settings] = await Promise.all([DailyChallenge.find({ day }).select('classLevel').lean(), getQuizSettings()]);
  const filled = new Set(docs.map((doc) => doc.classLevel));
  const outcomes = {} as Record<ClassLevel, AutoFillOutcome>;
  for (const classLevel of CLASS_LEVELS) {
    if (filled.has(classLevel)) outcomes[classLevel] = 'exists';
    else if (!settings.autoSchedule) outcomes[classLevel] = 'off';
    else outcomes[classLevel] = await ensureAutoQuiz(classLevel, day, at, settings);
  }
  return outcomes;
}

/** Today's, by the India date — what the jobs and the homepage ask for. */
export function ensureTodaysQuizzes(at: Date = now()): Promise<Record<ClassLevel, AutoFillOutcome>> {
  return ensureAutoQuizzes(dayKeyOf(at), at);
}

async function fillFromPool(classLevel: ClassLevel, day: DayKey, at: Date): Promise<boolean> {
  const n = classNumber(classLevel);
  const [used, subject] = await Promise.all([
    DailyChallenge.distinct('question') as Promise<Types.ObjectId[]>,
    findImplicitSubject(),
  ]);
  // Oldest first, so the pool is used in the order staff filled it.
  const candidates = await Question.find(poolFilter(classLevel, used, subject)).sort({ createdAt: 1, _id: 1 }).limit(5).select('_id');
  for (const candidate of candidates) {
    try {
      await scheduleQuiz({ day, classMin: n, classMax: n, questionId: String(candidate._id), source: 'automatic' }, AUTOMATIC, at);
      return true;
    } catch (err) {
      if (isTaken(err) && (await DailyChallenge.exists({ day, classLevel }))) return true;
      // This one cannot be a quiz (two correct options, say): try the next, and say so in the log.
      logger.warn({ err, classLevel, day, question: String(candidate._id) }, 'A pooled Daily Quiz question was refused');
    }
  }
  return false;
}

async function topicFor(subject: Types.ObjectId, name: string): Promise<Types.ObjectId> {
  const slug = slugify(name);
  const existing = await Topic.findOne({ subject, slug, parent: null }).select('_id');
  if (existing) return existing._id as Types.ObjectId;
  try {
    const created = await Topic.create({ subject, parent: null, depth: 0, name, slug, status: 'active' });
    return created._id as Types.ObjectId;
  } catch {
    // Created a moment ago by another request.
    const again = await Topic.findOne({ subject, slug, parent: null }).select('_id');
    if (again) return again._id as Types.ObjectId;
    throw new Error(`Could not find or create the chapter "${name}"`);
  }
}

async function fillGenerated(classLevel: ClassLevel, day: DayKey, at: Date): Promise<boolean> {
  const subject = await requireImplicitSubject();
  const n = classNumber(classLevel);

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const draft = quizDraftFor(classLevel, day, attempt);
    if (!draft) continue;
    // Already in the bank for this class — in Practice it would give the answer away.
    if (await Question.exists({ classLevel, questionText: draft.questionText })) continue;

    const topic = await topicFor(subject, draft.topic);
    const parsed = createQuestionSchema.safeParse({
      questionText: draft.questionText,
      type: 'single_choice',
      options: draft.options,
      solution: draft.solution,
      subject: String(subject),
      topic: String(topic),
      subtopic: null,
      classLevel,
      difficulty: draft.difficulty,
      marks: 4,
      negativeMarks: 1,
      tags: ['daily quiz', 'generated'],
    });
    if (!parsed.success) {
      logger.warn({ classLevel, day, attempt, issues: parsed.error.issues }, 'A generated Daily Quiz question failed validation');
      continue;
    }

    const question = await createQuestion(toQuestionContent(parsed.data), AUTOMATIC, {
      source: 'quiz_generator',
      generatorId: 'math-templates',
      generatorKind: 'deterministic',
      generatedAt: at,
    });
    try {
      await scheduleQuiz({ day, classMin: n, classMax: n, questionId: String(question._id), source: 'automatic' }, AUTOMATIC, at);
      return true;
    } catch (err) {
      // Not used: remove it, so the bank does not collect generated questions nobody was asked.
      await Question.deleteOne({ _id: question._id });
      if (isTaken(err)) return Boolean(await DailyChallenge.exists({ day, classLevel }));
      throw err;
    }
  }
  logger.error({ classLevel, day }, 'No generated Daily Quiz question could be used');
  return false;
}

/** For the staff console: whether automation is on, from where, and how many pooled questions each class has left. */
export async function autoQuizStatus(): Promise<{
  enabled: boolean;
  source: AutoQuizSource;
  pool: Array<{ classLevel: ClassLevel; count: number }>;
}> {
  const [settings, used, subject] = await Promise.all([
    getQuizSettings(),
    DailyChallenge.distinct('question') as Promise<Types.ObjectId[]>,
    findImplicitSubject(),
  ]);
  const pool = await Promise.all(
    CLASS_LEVELS.map(async (classLevel) => ({ classLevel, count: await Question.countDocuments(poolFilter(classLevel, used, subject)) })),
  );
  return { enabled: settings.autoSchedule, source: settings.autoSource, pool };
}
