import type { Types } from 'mongoose';
import {
  DailyChallenge,
  DailyChallengeAttempt,
  MockTest,
  MockTestAttempt,
  PracticeSession,
  Question,
  Student,
} from '../../src/models';
import type { ClassLevel } from '../../src/lib/classLevels';
import type { AttemptAnswerEntry } from '../../src/models/attemptAnswer';
import { snapshotOf } from '../../src/services/attemptSnapshot';
import { gradeEntries } from '../../src/services/grading';
import { dayKeyOf } from '../../src/lib/competitionDay';

/**
 * Fixtures that seed attempts with **exactly known** outcomes, so an analytics test can
 * assert a specific number rather than merely that a number is present.
 *
 * Two deliberate choices:
 *
 * 1. **The real snapshot and the real grader do the work.** `snapshotOf()` builds each
 *    entry and `gradeEntries()` computes the attempt totals, so the stored documents are
 *    byte-for-byte what a genuine sitting produces. A hand-written approximation would
 *    let the analytics agree with the fixture while both disagreed with the product.
 *
 * 2. **Outcomes are declared, not computed.** A caller says `['correct', 'wrong',
 *    'blank']` and the helper fills the response from the snapshotted key. The test then
 *    knows the answer before the aggregation runs, which is the only way to catch an
 *    aggregation that is self-consistently wrong.
 */

/** What the student did with one served question. */
export type Outcome = 'correct' | 'wrong' | 'blank';

/**
 * Fills in a response that will grade to the requested outcome.
 *
 * `wrong` is produced by picking an option that is **not** in the snapshotted correct
 * set (or by negating a boolean / offsetting a number past its tolerance), so it is
 * genuinely wrong rather than merely different.
 */
function respond(entry: AttemptAnswerEntry, outcome: Outcome, allOptionKeys: string[]): void {
  if (outcome === 'blank') return;

  switch (entry.type) {
    case 'single_choice':
    case 'multiple_choice': {
      if (outcome === 'correct') {
        entry.selectedOptionKeys = [...entry.correctOptionKeys];
      } else {
        const wrong = allOptionKeys.find((key) => !entry.correctOptionKeys.includes(key));
        if (!wrong) throw new Error('Question has no incorrect option to choose for a "wrong" outcome');
        entry.selectedOptionKeys = [wrong];
      }
      break;
    }
    case 'true_false': {
      const truth = entry.booleanAnswer ?? false;
      entry.booleanResponse = outcome === 'correct' ? truth : !truth;
      break;
    }
    case 'numeric': {
      const truth = entry.numericAnswer ?? 0;
      entry.numericResponse = outcome === 'correct' ? truth : truth + (entry.tolerance ?? 0) + 1;
      break;
    }
  }

  // The stored materialisation of `isAnswered()`, exactly as the services write it.
  entry.answeredAt = new Date();
}

async function buildEntries(questionIds: string[], outcomes: Outcome[], marksEach: number): Promise<AttemptAnswerEntry[]> {
  if (questionIds.length !== outcomes.length) {
    throw new Error(`Gave ${questionIds.length} questions but ${outcomes.length} outcomes`);
  }

  const docs = await Question.find({ _id: { $in: questionIds } });
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

  return questionIds.map((id, index) => {
    const question = byId.get(id);
    if (!question) throw new Error(`No question ${id}`);

    const entry = snapshotOf(question, {
      question: question._id as Types.ObjectId,
      order: index + 1,
      marks: marksEach,
      negativeMarks: 0,
    });
    respond(entry, outcomes[index]!, question.options.map((option) => option.key));
    return entry;
  });
}

/**
 * Applies the real grader and returns the attempt-level totals.
 *
 * `gradeEntries()` **mutates** the entries as it goes — it writes `isCorrect` (three
 * valued: `true`, `false`, or `null` for unanswered) and `awardedMarks` onto each one.
 * So this single call both grades the individual answers and produces the totals, which
 * is exactly what a real submission does. Grading each entry separately would work but
 * would be a second code path the product does not have.
 */
function totalsFor(entries: AttemptAnswerEntry[]) {
  const totals = gradeEntries(entries);
  return {
    totalQuestions: entries.length,
    maxMarks: entries.reduce((sum, entry) => sum + entry.marks, 0),
    score: totals.score,
    correctCount: totals.correctCount,
    incorrectCount: totals.incorrectCount,
    unansweredCount: totals.unansweredCount,
    accuracy: totals.accuracy,
  };
}

export interface SeedAttemptOptions {
  studentId: string;
  questionIds: string[];
  outcomes: Outcome[];
  marksEach?: number;
  timeTakenSeconds?: number;
  submittedAt?: Date;
  classLevel?: ClassLevel;
}

async function accountFor(studentId: string) {
  const account = await Student.findOne({ studentId });
  if (!account) throw new Error(`No account ${studentId}`);
  return account;
}

/** A submitted practice session with the declared outcomes. */
export async function seedPracticeSession(options: SeedAttemptOptions): Promise<void> {
  const account = await accountFor(options.studentId);
  const entries = await buildEntries(options.questionIds, options.outcomes, options.marksEach ?? 4);
  const submittedAt = options.submittedAt ?? new Date();
  // Grades the entries in place *and* yields the totals — see `totalsFor`.
  const totals = totalsFor(entries);

  await PracticeSession.create({
    student: account._id,
    status: 'submitted',
    filters: { classLevel: options.classLevel ?? 'Class 9', subject: null, topic: null, difficulty: null },
    questions: entries,
    ...totals,
    startedAt: new Date(submittedAt.getTime() - (options.timeTakenSeconds ?? 300) * 1000),
    submittedAt,
    timeTakenSeconds: options.timeTakenSeconds ?? 300,
  });
}

/** A published mock test plus one submitted attempt at it with the declared outcomes. */
export async function seedMockAttempt(
  options: SeedAttemptOptions & { title?: string },
): Promise<{ testId: Types.ObjectId }> {
  const account = await accountFor(options.studentId);
  const marks = options.marksEach ?? 4;
  const entries = await buildEntries(options.questionIds, options.outcomes, marks);
  const submittedAt = options.submittedAt ?? new Date();
  const totals = totalsFor(entries);

  const test = await MockTest.create({
    title: options.title ?? 'Analytics rehearsal',
    instructions: 'Seeded for analytics tests.',
    classLevel: options.classLevel ?? 'Class 9',
    questions: options.questionIds.map((id, index) => ({
      question: id as unknown as Types.ObjectId,
      order: index + 1,
      marks,
      negativeMarks: 0,
    })),
    durationMinutes: 30,
    maxAttempts: 1,
    status: 'published',
    totalMarks: marks * options.questionIds.length,
  });

  await MockTestAttempt.create({
    test: test._id,
    student: account._id,
    attemptNumber: 1,
    status: 'submitted',
    questions: entries,
    ...totals,
    durationMinutes: 30,
    startedAt: new Date(submittedAt.getTime() - (options.timeTakenSeconds ?? 600) * 1000),
    expiresAt: new Date(submittedAt.getTime() + 60_000),
    submittedAt,
    timeTakenSeconds: options.timeTakenSeconds ?? 600,
    submissionReason: 'manual',
  });

  return { testId: test._id as Types.ObjectId };
}

/** A daily challenge and one attempt at it. Single answer, and no clock at all. */
export async function seedChallengeAttempt(options: {
  studentId: string;
  questionId: string;
  outcome: Outcome;
  marks?: number;
  submittedAt?: Date;
  classLevel?: ClassLevel;
}): Promise<void> {
  const account = await accountFor(options.studentId);
  const marks = options.marks ?? 3;
  const entries = await buildEntries([options.questionId], [options.outcome], marks);
  totalsFor(entries);
  const entry = entries[0]!;

  const submittedAt = options.submittedAt ?? new Date();
  const day = dayKeyOf(submittedAt);

  const challenge = await DailyChallenge.create({
    day,
    classLevel: options.classLevel ?? 'Class 9',
    question: options.questionId,
    source: 'automatic',
    marks,
  });

  await DailyChallengeAttempt.create({
    student: account._id,
    challenge: challenge._id,
    day,
    // Correctness lives on the embedded answer, not on the attempt — there is only
    // ever one question, so a second copy on the parent could only ever disagree.
    answer: entry,
    xpAwarded: 0,
    submittedAt,
  });
}
