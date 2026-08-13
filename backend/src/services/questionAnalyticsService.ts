import type { PipelineStage, Types } from 'mongoose';
import {
  DailyChallengeAttempt,
  Exam,
  ExamAttempt,
  MockTest,
  MockTestAttempt,
  PracticeSession,
  Question,
  type Difficulty,
  type QuestionType,
} from '../models';
import type { ClassLevel } from '../lib/classLevels';

/**
 * Administrative performance analytics: how the **questions** and the **papers** are
 * doing, as opposed to how one student is doing.
 *
 * Deliberately separate from `platformAnalyticsService.ts`, which already answers
 * accounts, engagement, content counts and platform totals and was not rebuilt. What
 * was missing is the assessment half — and it is the half staff actually need in order
 * to fix the question bank:
 *
 *  - **Question performance** finds the questions that are not working. A question
 *    nobody gets right is usually either mis-keyed or mis-tagged, and until now there
 *    was no way to find one except by a student complaining.
 *  - **Test performance** compares papers against each other, where `testResults()`
 *    only ever showed one test at a time.
 *
 * Every figure is counted from a submitted attempt. Same rules as everywhere else in
 * this codebase: raw counts summed, percentages derived last, `null` rather than a
 * plausible `0` where there is no sample.
 */

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Question performance
// ---------------------------------------------------------------------------

/**
 * The per-question aggregation, over one attempt collection.
 *
 * Grouped by `question` only — the question's own text, topic and difficulty are
 * joined **once at the end**, over the handful of rows a page actually shows, rather
 * than for every answer ever given. Joining inside the group stage would multiply the
 * lookup by the number of times each question has been served.
 */
function perQuestionPipeline(entryPath: string, match: Record<string, unknown>): PipelineStage[] {
  return [
    { $match: match },
    { $project: { entries: entryPath.startsWith('$') ? { $ifNull: [entryPath, []] } : `$${entryPath}` } },
    { $unwind: '$entries' },
    {
      $group: {
        _id: '$entries.question',
        served: { $sum: 1 },
        // `answeredAt` is the stored form of `isAnswered()` — see `analyticsService.ts`.
        answered: { $sum: { $cond: [{ $ne: ['$entries.answeredAt', null] }, 1, 0] } },
        // Explicit `true`, because `isCorrect` is also `false` for an unanswered entry.
        correct: { $sum: { $cond: [{ $eq: ['$entries.isCorrect', true] }, 1, 0] } },
        marksAwarded: { $sum: { $ifNull: ['$entries.awardedMarks', 0] } },
        marksAvailable: { $sum: '$entries.marks' },
      },
    },
  ];
}

interface RawQuestionRow {
  _id: Types.ObjectId;
  served: number;
  answered: number;
  correct: number;
  marksAwarded: number;
  marksAvailable: number;
}

export interface QuestionPerformanceRow {
  id: string;
  /** Trimmed for a table; the full text is on the question's own page. */
  preview: string;
  type: QuestionType;
  difficulty: Difficulty;
  classLevel: ClassLevel;
  status: string;
  topicName: string | null;
  subjectName: string | null;
  served: number;
  answered: number;
  correct: number;
  /** `correct / answered`. Null when served but never answered. */
  accuracyPercent: number | null;
  /** How often a served question was left blank — a mis-worded question's signature. */
  skipRatePercent: number | null;
  marksAwarded: number;
  marksAvailable: number;
}

export interface QuestionPerformanceQuery {
  page: number;
  limit: number;
  classLevel?: ClassLevel;
  difficulty?: Difficulty;
  subject?: string;
  /** `hardest` (lowest accuracy) / `easiest` / `most-served` / `most-skipped`. */
  sort?: 'hardest' | 'easiest' | 'most-served' | 'most-skipped';
  /** Ignore questions with fewer answers than this, so noise cannot top the table. */
  minAnswered?: number;
}

export interface QuestionPerformanceResult {
  rows: QuestionPerformanceRow[];
  total: number;
  /** Questions that have been served at least once, before the filters below. */
  questionsWithData: number;
  minAnswered: number;
  notes: string[];
}

/**
 * How every question that has actually been served is performing.
 *
 * The four attempt collections are aggregated separately and merged by summing raw
 * counts, so a question used in both practice and a mock test reports one combined
 * figure — and the merge is addition, which cannot produce the average-of-averages
 * error that combining percentages would.
 *
 * **Why `minAnswered` defaults above 1.** A question answered once, wrongly, sits at
 * 0% and would head any "hardest questions" list for ever. That is a real number and a
 * useless diagnosis. The floor is a parameter rather than a constant so staff can lower
 * it deliberately, and the value in force is returned with the result.
 */
export async function getQuestionPerformance(query: QuestionPerformanceQuery): Promise<QuestionPerformanceResult> {
  const minAnswered = query.minAnswered ?? 3;
  const notes: string[] = [];

  const [practice, mock, challenge, exam] = await Promise.all([
    PracticeSession.aggregate<RawQuestionRow>(perQuestionPipeline('questions', { status: 'submitted' })),
    MockTestAttempt.aggregate<RawQuestionRow>(perQuestionPipeline('questions', { status: 'submitted' })),
    DailyChallengeAttempt.aggregate<RawQuestionRow>(perQuestionPipeline('$answer', {})),
    ExamAttempt.aggregate<RawQuestionRow>(perQuestionPipeline('questions', { status: 'submitted' })),
  ]);

  const merged = new Map<string, RawQuestionRow>();
  for (const row of [...practice, ...mock, ...challenge, ...exam]) {
    const key = String(row._id);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }
    existing.served += row.served;
    existing.answered += row.answered;
    existing.correct += row.correct;
    existing.marksAwarded += row.marksAwarded;
    existing.marksAvailable += row.marksAvailable;
  }

  const questionsWithData = merged.size;
  if (questionsWithData === 0) {
    notes.push('no-question-has-been-answered-yet');
    return { rows: [], total: 0, questionsWithData: 0, minAnswered, notes };
  }

  const eligible = [...merged.values()].filter((row) => row.answered >= minAnswered);
  if (eligible.length === 0) {
    notes.push(`no-question-has-at-least-${minAnswered}-answers-yet`);
    return { rows: [], total: 0, questionsWithData, minAnswered, notes };
  }

  // Join the question documents for the eligible set only, then filter on their own
  // fields. Filtering before the join is not possible — the counts come from the
  // attempts, and the class and difficulty come from the questions.
  const docs = await Question.find({ _id: { $in: eligible.map((row) => row._id) } })
    .select('questionText type difficulty classLevel status topic subject')
    .populate<{
      topic: { _id: Types.ObjectId; name: string } | null;
      subject: { _id: Types.ObjectId; name: string } | null;
    }>([
      { path: 'topic', select: 'name' },
      { path: 'subject', select: 'name' },
    ])
    .lean();

  const docById = new Map(docs.map((doc) => [String(doc._id), doc]));

  let rows: QuestionPerformanceRow[] = eligible
    .map((row): QuestionPerformanceRow | null => {
      const doc = docById.get(String(row._id));
      // Answers pointing at a deleted question. Dropped rather than shown as
      // "Unknown", because staff cannot act on a question that no longer exists.
      if (!doc) return null;

      return {
        id: String(row._id),
        preview: doc.questionText.length > 120 ? `${doc.questionText.slice(0, 120)}…` : doc.questionText,
        type: doc.type,
        difficulty: doc.difficulty,
        classLevel: doc.classLevel,
        status: doc.status,
        topicName: doc.topic?.name ?? null,
        subjectName: doc.subject?.name ?? null,
        served: row.served,
        answered: row.answered,
        correct: row.correct,
        accuracyPercent: percent(row.correct, row.answered),
        skipRatePercent: percent(row.served - row.answered, row.served),
        marksAwarded: row.marksAwarded,
        marksAvailable: row.marksAvailable,
      };
    })
    .filter((row): row is QuestionPerformanceRow => row !== null);

  if (rows.length < eligible.length) notes.push('some-answered-questions-have-since-been-deleted');

  if (query.classLevel) rows = rows.filter((row) => row.classLevel === query.classLevel);
  if (query.difficulty) rows = rows.filter((row) => row.difficulty === query.difficulty);
  if (query.subject) {
    const subjectDocs = docs.filter((doc) => String(doc.subject?._id ?? '') === query.subject);
    const allowed = new Set(subjectDocs.map((doc) => String(doc._id)));
    rows = rows.filter((row) => allowed.has(row.id));
  }

  // A total order in every case, so the same data always produces the same page and
  // pagination cannot show a row twice or not at all.
  const sort = query.sort ?? 'hardest';
  rows.sort((a, b) => {
    const byId = a.id.localeCompare(b.id);
    switch (sort) {
      case 'easiest':
        return (b.accuracyPercent ?? -1) - (a.accuracyPercent ?? -1) || b.answered - a.answered || byId;
      case 'most-served':
        return b.served - a.served || byId;
      case 'most-skipped':
        return (b.skipRatePercent ?? -1) - (a.skipRatePercent ?? -1) || b.served - a.served || byId;
      case 'hardest':
      default:
        // Ascending accuracy, then the larger sample first: a 20% from 40 answers is a
        // firmer finding than a 20% from 3.
        return (a.accuracyPercent ?? 101) - (b.accuracyPercent ?? 101) || b.answered - a.answered || byId;
    }
  });

  const total = rows.length;
  const start = (query.page - 1) * query.limit;

  return { rows: rows.slice(start, start + query.limit), total, questionsWithData, minAnswered, notes };
}

// ---------------------------------------------------------------------------
// Test performance
// ---------------------------------------------------------------------------

export interface TestPerformanceRow {
  id: string;
  kind: 'mock_test' | 'official_exam';
  title: string;
  classLevel: ClassLevel;
  status: string;
  totalMarks: number;
  questionCount: number;
  attemptsStarted: number;
  attemptsSubmitted: number;
  /** Submitted / started. The honest measure of whether a paper gets finished. */
  completionPercent: number | null;
  distinctStudents: number;
  /** Mean of `score / maxMarks` over submitted attempts. Null when none. */
  averageScorePercent: number | null;
  /** The middle attempt, which a single outlier cannot drag. Null when none. */
  medianScorePercent: number | null;
  highestScorePercent: number | null;
  lowestScorePercent: number | null;
  averageAccuracyPercent: number | null;
  averageSecondsPerQuestion: number | null;
}

interface AttemptStatRow {
  _id: Types.ObjectId;
  started: number;
  submitted: number;
  students: Types.ObjectId[];
  percents: number[];
  accuracies: number[];
  timeSeconds: number[];
  questionCounts: number[];
}

/**
 * Per-paper cohort statistics, over one attempt collection.
 *
 * `$push` collects the individual percentages because a **median** cannot be computed
 * by accumulation the way a mean can, and a mean alone is misleading on a small cohort
 * — one student who opened a paper and submitted a blank moves it several points, and
 * that is exactly the case an invigilator wants to see rather than have smoothed away.
 * Bounded by one paper's cohort, which the product caps in the low hundreds.
 */
function testStatsPipeline(testField: string): PipelineStage[] {
  return [
    {
      $group: {
        _id: `$${testField}`,
        started: { $sum: 1 },
        submitted: { $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] } },
        students: { $addToSet: '$student' },
        percents: {
          $push: {
            $cond: [
              { $and: [{ $eq: ['$status', 'submitted'] }, { $gt: ['$maxMarks', 0] }] },
              { $multiply: [{ $divide: ['$score', '$maxMarks'] }, 100] },
              '$$REMOVE',
            ],
          },
        },
        accuracies: {
          $push: { $cond: [{ $eq: ['$status', 'submitted'] }, '$accuracy', '$$REMOVE'] },
        },
        timeSeconds: {
          $push: {
            $cond: [
              { $and: [{ $eq: ['$status', 'submitted'] }, { $gt: ['$timeTakenSeconds', 0] }] },
              '$timeTakenSeconds',
              '$$REMOVE',
            ],
          },
        },
        questionCounts: {
          $push: {
            $cond: [
              { $and: [{ $eq: ['$status', 'submitted'] }, { $gt: ['$totalQuestions', 0] }] },
              '$totalQuestions',
              '$$REMOVE',
            ],
          },
        },
      },
    },
  ];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return Math.round(value * 10) / 10;
}

/**
 * Every mock test and official exam with at least one attempt, newest paper first.
 *
 * Two collections, two aggregations, one merged list — because the product genuinely
 * has two kinds of paper and conflating them is the mistake the collection separation
 * exists to prevent. `kind` is carried on every row so a caller can never mistake a
 * rehearsal for the Olympiad.
 */
export async function getTestPerformance(): Promise<{ rows: TestPerformanceRow[]; notes: string[] }> {
  const notes: string[] = [];

  const [mockStats, examStats] = await Promise.all([
    MockTestAttempt.aggregate<AttemptStatRow>(testStatsPipeline('test')),
    ExamAttempt.aggregate<AttemptStatRow>(testStatsPipeline('exam')),
  ]);

  if (mockStats.length === 0 && examStats.length === 0) {
    notes.push('no-paper-has-been-attempted-yet');
    return { rows: [], notes };
  }

  const [mockTests, exams] = await Promise.all([
    MockTest.find({ _id: { $in: mockStats.map((row) => row._id) } })
      .select('title classLevel status totalMarks questions createdAt')
      .lean(),
    Exam.find({ _id: { $in: examStats.map((row) => row._id) } })
      .select('title classLevel status totalMarks questions createdAt')
      .lean(),
  ]);

  interface PaperDoc {
    _id: unknown;
    title: string;
    classLevel: ClassLevel;
    status: string;
    totalMarks: number;
    questions: unknown[];
    createdAt: Date;
  }

  function build(stat: AttemptStatRow, paper: PaperDoc | undefined, kind: TestPerformanceRow['kind']): TestPerformanceRow | null {
    if (!paper) return null;

    const secondsPerQuestion = stat.timeSeconds
      .map((seconds, index) => {
        const questions = stat.questionCounts[index];
        return questions && questions > 0 ? seconds / questions : null;
      })
      .filter((value): value is number => value !== null);

    return {
      id: String(stat._id),
      kind,
      title: paper.title,
      classLevel: paper.classLevel,
      status: paper.status,
      totalMarks: paper.totalMarks,
      questionCount: paper.questions.length,
      attemptsStarted: stat.started,
      attemptsSubmitted: stat.submitted,
      completionPercent: percent(stat.submitted, stat.started),
      distinctStudents: stat.students.length,
      averageScorePercent: mean(stat.percents),
      medianScorePercent: median(stat.percents),
      highestScorePercent: stat.percents.length > 0 ? Math.round(Math.max(...stat.percents) * 10) / 10 : null,
      lowestScorePercent: stat.percents.length > 0 ? Math.round(Math.min(...stat.percents) * 10) / 10 : null,
      averageAccuracyPercent: mean(stat.accuracies),
      averageSecondsPerQuestion: mean(secondsPerQuestion),
    };
  }

  const mockById = new Map(mockTests.map((doc) => [String(doc._id), doc as unknown as PaperDoc]));
  const examById = new Map(exams.map((doc) => [String(doc._id), doc as unknown as PaperDoc]));

  const rows = [
    ...mockStats.map((stat) => build(stat, mockById.get(String(stat._id)), 'mock_test')),
    ...examStats.map((stat) => build(stat, examById.get(String(stat._id)), 'official_exam')),
  ].filter((row): row is TestPerformanceRow => row !== null);

  if (rows.length < mockStats.length + examStats.length) notes.push('some-attempted-papers-have-since-been-deleted');

  // Official exams first — they are the competition — then by how many sat the paper.
  rows.sort(
    (a, b) =>
      Number(b.kind === 'official_exam') - Number(a.kind === 'official_exam') ||
      b.attemptsSubmitted - a.attemptsSubmitted ||
      a.id.localeCompare(b.id),
  );

  return { rows, notes };
}
