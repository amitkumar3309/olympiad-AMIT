import type { PipelineStage, Types } from 'mongoose';
import {
  DailyChallengeAttempt,
  ExamAttempt,
  MockTestAttempt,
  PracticeSession,
  Question,
  DIFFICULTIES,
  QUESTION_TYPES,
  type Difficulty,
  type QuestionType,
} from '../models';
import { dayKeyOf, type DayKey } from '../lib/competitionDay';

/**
 * THE student performance analytics. Every figure here is derived from a real stored
 * attempt; nothing is estimated, projected or filled in.
 *
 * ## Where the numbers come from
 *
 * Four collections hold answered questions, and all four are read: `PracticeSession`,
 * `MockTestAttempt`, `DailyChallengeAttempt` and `ExamAttempt`. Only **submitted**
 * attempts count — an abandoned paper is not a measurement of anything, and counting
 * its blanks as wrong answers would libel the student.
 *
 * ## Three rules this file is built around
 *
 * 1. **Raw counts are summed; percentages are computed last.** Every aggregation
 *    returns `served / answered / correct / marksAwarded / marksAvailable` and never a
 *    percentage. Rolling a topic total up from per-surface rows is then addition, and
 *    the average-of-averages bug — where 1/1 in practice and 1/9 on a mock test come
 *    out as 55% instead of the true 20% — cannot be written.
 *
 * 2. **`null` is not `0`.** An accuracy with no answered questions behind it is
 *    `null`, because "has answered nothing" and "gets everything wrong" are different
 *    facts about a child. The same rule `platformAnalyticsService.ts` follows.
 *
 * 3. **A weak area needs a sample.** One wrong answer in a topic is not a weakness, it
 *    is noise, and presenting it as a diagnosis would be a fabricated conclusion drawn
 *    from real data — which is the same sin as a fabricated number. `MIN_AREA_SAMPLE`
 *    gates both lists and is reported to the client so the UI can explain an empty one.
 *
 * ## Why the taxonomy join is live, when grading is snapshotted
 *
 * Grading reads the answer-key snapshot on the attempt, never the live `Question` —
 * that is absolute, because a re-priced or edited question must not change a mark
 * already awarded. Analytics deliberately does the opposite and `$lookup`s the
 * **current** `topic`, `subject` and `difficulty`.
 *
 * The distinction is not sloppiness. A mark is a historical fact about one paper. "How
 * am I doing in Trigonometry?" is a question about the taxonomy as it stands now: if a
 * question is recategorised from Algebra to Trigonometry, the student's history should
 * follow it, or their topic breakdown would describe a filing system nobody uses any
 * more. Snapshotting the taxonomy onto every answer would also freeze a typo in a
 * subject name into thousands of rows.
 *
 * The honest cost is recorded in `DECISIONS.md`: recategorising questions moves
 * historical breakdowns, and a **deleted** question drops out of them entirely (the
 * `$lookup` is followed by a non-preserving `$unwind`, so a served question whose
 * document is gone cannot be attributed to a topic that no longer knows about it).
 * `totalServed` on the overall summary is counted separately, from the attempts
 * themselves, so the two can be compared rather than silently disagreeing.
 */

/** Which kind of sitting an answer came from. */
export const ANALYTICS_SURFACES = ['practice', 'mock_test', 'daily_challenge', 'official_exam'] as const;
export type AnalyticsSurface = (typeof ANALYTICS_SURFACES)[number];

/**
 * How many answered questions a topic, subject or difficulty needs before it may be
 * called a strength or a weakness. See rule 3 above.
 */
export const MIN_AREA_SAMPLE = 5;

/**
 * The accuracy either side of which an area may be *called* a strength or a weakness.
 *
 * Placing in a sort is not a diagnosis. These two lists used to be the same ranked
 * array — top five, and the same array reversed — which meant that whenever five or
 * fewer areas cleared `MIN_AREA_SAMPLE`, **every** area appeared in both. A student
 * answering everything correctly was told that Mathematics was at once a strong area
 * and a weak area, at 100%. That is the honest-looking kind of wrong: real counts,
 * real percentages, a conclusion drawn from neither — rule 3's sin one level up, and
 * the same fabricated-diagnosis problem the sample floor exists to prevent.
 *
 * So an area has to earn its label from its own accuracy. Between the two bands it is
 * neither, which is the truthful answer for a middling area, and the lists are
 * disjoint by construction rather than by a de-duplication pass.
 *
 * These are deliberately *not* confidence intervals. Milestone 15 considered and
 * rejected them here (see `DECISIONS.md`): this surface reports what a student's own
 * answers say, and a plain threshold on a figure shown beside the label is something
 * a fourteen-year-old can check. The Wilson bounds in `lib/statisticalRecommender.ts`
 * exist because a *recommendation* asserts more than a description does.
 */
export const STRONG_AREA_MIN_ACCURACY = 70;
export const WEAK_AREA_MAX_ACCURACY = 50;

// ---------------------------------------------------------------------------
// The shared shape
// ---------------------------------------------------------------------------

/** Raw counts only. No percentage is ever stored in a bucket — see rule 1. */
interface Counts {
  served: number;
  answered: number;
  correct: number;
  marksAwarded: number;
  marksAvailable: number;
}

function emptyCounts(): Counts {
  return { served: 0, answered: 0, correct: 0, marksAwarded: 0, marksAvailable: 0 };
}

function addInto(target: Counts, source: Counts): void {
  target.served += source.served;
  target.answered += source.answered;
  target.correct += source.correct;
  target.marksAwarded += source.marksAwarded;
  target.marksAvailable += source.marksAvailable;
}

/** One decimal place, or `null` when the denominator is genuinely zero. */
function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** What a caller sees: the counts, plus the percentages derived from them. */
export interface PerformanceRow extends Counts {
  /** `correct / answered`. Null when nothing was answered. */
  accuracyPercent: number | null;
  /** `marksAwarded / marksAvailable`. Null when no marks were on offer. */
  scorePercent: number | null;
}

function toRow(counts: Counts): PerformanceRow {
  return {
    ...counts,
    accuracyPercent: percent(counts.correct, counts.answered),
    // Deliberately over marks *available*, not marks answered: leaving a question
    // blank really did cost the student the marks it carried, and a score percentage
    // that ignored blanks would flatter a half-finished paper.
    scorePercent: percent(counts.marksAwarded, counts.marksAvailable),
  };
}

// ---------------------------------------------------------------------------
// The faceted aggregation
// ---------------------------------------------------------------------------

/**
 * One row of the faceted aggregation: counts for one (topic, subject, difficulty,
 * type) combination.
 *
 * Grouping on the composite key rather than running one aggregation per facet is what
 * keeps this to **one pipeline per collection**. The cardinality is bounded by the
 * distinct combinations the student actually met — a few dozen at most, because a
 * question has exactly one of each — and every facet the API exposes is then a sum
 * over those rows rather than another database round trip.
 */
interface FacetRow {
  _id: {
    topic: Types.ObjectId | null;
    topicName: string | null;
    subject: Types.ObjectId | null;
    subjectName: string | null;
    difficulty: Difficulty | null;
    type: QuestionType | null;
  };
  served: number;
  answered: number;
  correct: number;
  marksAwarded: number;
  marksAvailable: number;
}

/**
 * Builds the facet pipeline for one attempt collection.
 *
 * `entryPath` differs because a daily challenge holds **one** answer rather than an
 * array — it has no session and no paper, so an array would have been a lie about the
 * shape of the thing. `$unwind` over a single-element array normalises the two.
 */
function facetPipeline(match: Record<string, unknown>, entryPath: string): PipelineStage[] {
  return [
    { $match: match },
    // Normalise "one answer" and "many answers" into one stream of entries.
    { $project: { entries: entryPath.startsWith('$') ? { $ifNull: [entryPath, []] } : `$${entryPath}` } },
    { $unwind: '$entries' },
    { $replaceWith: { entry: '$entries' } },
    {
      $lookup: {
        from: Question.collection.name,
        localField: 'entry.question',
        foreignField: '_id',
        as: 'question',
        // Only the three fields the facets need. Without this the join drags the whole
        // question — text, options, solution, the answer key — through the pipeline for
        // every answer the student has ever given.
        pipeline: [{ $project: { topic: 1, subject: 1, difficulty: 1 } }],
      },
    },
    // Non-preserving on purpose: a question whose document has been deleted cannot be
    // attributed to a topic, and inventing an "Unknown" bucket would be a fabricated
    // category. The overall summary counts served questions separately so the
    // difference is visible rather than hidden.
    { $unwind: '$question' },
    {
      $lookup: {
        from: 'topics',
        localField: 'question.topic',
        foreignField: '_id',
        as: 'topicDoc',
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    {
      $lookup: {
        from: 'subjects',
        localField: 'question.subject',
        foreignField: '_id',
        as: 'subjectDoc',
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    {
      $group: {
        _id: {
          topic: '$question.topic',
          topicName: { $first: '$topicDoc.name' },
          subject: '$question.subject',
          subjectName: { $first: '$subjectDoc.name' },
          difficulty: '$question.difficulty',
          type: '$entry.type',
        },
        served: { $sum: 1 },
        /**
         * `answeredAt` is the **stored materialisation of `isAnswered()`**, not a
         * second implementation of it. Every write path sets it as
         * `isAnswered(entry) ? now : null` — including when an answer is *cleared* —
         * so it records whether a response currently stands. Re-deriving the per-type
         * rule in aggregation expressions here would be exactly the second grader
         * `services/grading.ts` exists to prevent. A regression test asserts this count
         * agrees with the attempt's own `unansweredCount`, which the grader wrote, so
         * the two cannot drift unnoticed.
         */
        answered: { $sum: { $cond: [{ $ne: ['$entry.answeredAt', null] }, 1, 0] } },
        /**
         * Counted as an explicit `true`, never as "not false".
         *
         * `isCorrect` is three-valued on a stored entry: `true`, `false`, or **`null`
         * for unanswered** — `gradeEntries()` writes `outcome.answered ?
         * outcome.isCorrect : null`. (Note that `gradeEntry()` *returns* `false` for an
         * unanswered entry; it is `gradeEntries()`, the one that persists, that
         * narrows it to `null`.) `{ $ne: [..., false] }` would therefore count every
         * blank as correct, and `$not` on a null behaves the same way. Matching `true`
         * is correct under all three values.
         */
        correct: { $sum: { $cond: [{ $eq: ['$entry.isCorrect', true] }, 1, 0] } },
        marksAwarded: { $sum: { $ifNull: ['$entry.awardedMarks', 0] } },
        marksAvailable: { $sum: '$entry.marks' },
      },
    },
  ];
}

function countsOf(row: FacetRow): Counts {
  return {
    served: row.served,
    answered: row.answered,
    correct: row.correct,
    marksAwarded: row.marksAwarded,
    marksAvailable: row.marksAvailable,
  };
}

// ---------------------------------------------------------------------------
// Attempt-level facts
// ---------------------------------------------------------------------------

/**
 * One submitted sitting, as the trends see it.
 *
 * These come from cheap projected `find()`s rather than aggregations, because each
 * attempt document already stores its own totals — written once by `gradeEntries()` at
 * submission. Recomputing them from the embedded answers would be slower *and* would
 * risk disagreeing with the score the student was shown.
 */
export interface AttemptPoint {
  surface: AnalyticsSurface;
  at: Date;
  label: string;
  score: number;
  maxMarks: number;
  scorePercent: number | null;
  answered: number;
  correct: number;
  served: number;
  accuracyPercent: number | null;
  /**
   * Seconds the whole sitting took, or `null` where the collection does not record it.
   *
   * A daily challenge has no clock — it is one question answered whenever the student
   * opens it — so it contributes to accuracy and progress but is **absent** from the
   * pace trend rather than being given an invented duration.
   */
  timeTakenSeconds: number | null;
}

interface AttemptDocShape {
  submittedAt?: Date | null;
  startedAt?: Date;
  score: number;
  maxMarks: number;
  correctCount: number;
  totalQuestions: number;
  unansweredCount: number;
  timeTakenSeconds: number;
}

function attemptPoint(surface: AnalyticsSurface, label: string, doc: AttemptDocShape): AttemptPoint {
  const answered = doc.totalQuestions - doc.unansweredCount;
  return {
    surface,
    at: doc.submittedAt ?? doc.startedAt ?? new Date(),
    label,
    score: doc.score,
    maxMarks: doc.maxMarks,
    scorePercent: percent(doc.score, doc.maxMarks),
    answered,
    correct: doc.correctCount,
    served: doc.totalQuestions,
    accuracyPercent: percent(doc.correctCount, answered),
    timeTakenSeconds: doc.timeTakenSeconds,
  };
}

// ---------------------------------------------------------------------------
// The public shape
// ---------------------------------------------------------------------------

export interface NamedPerformanceRow extends PerformanceRow {
  id: string;
  name: string;
  /** Only set on a topic row, so the UI can disambiguate two same-named topics. */
  subjectName?: string | null;
}

export interface AreaRow {
  scope: 'topic' | 'subject' | 'difficulty';
  id: string;
  name: string;
  accuracyPercent: number;
  answered: number;
}

export interface DayAccuracy {
  day: DayKey;
  answered: number;
  correct: number;
  accuracyPercent: number | null;
}

export interface PacePoint {
  at: Date;
  surface: AnalyticsSurface;
  label: string;
  questions: number;
  secondsPerQuestion: number;
}

export interface StudentAnalytics {
  generatedAt: Date;
  /** True when nothing has been submitted anywhere. The UI shows one honest message. */
  hasData: boolean;
  overall: PerformanceRow & {
    attempts: number;
    /**
     * Served questions counted from the attempts themselves, independent of the
     * taxonomy join. If this exceeds `overall.served`, questions have been deleted
     * since they were answered — visible rather than silently absorbed.
     */
    servedIncludingDeletedQuestions: number;
    averageSecondsPerQuestion: number | null;
  };
  bySurface: Array<PerformanceRow & { surface: AnalyticsSurface; attempts: number }>;
  byTopic: NamedPerformanceRow[];
  bySubject: NamedPerformanceRow[];
  byDifficulty: Array<PerformanceRow & { difficulty: Difficulty }>;
  byType: Array<PerformanceRow & { type: QuestionType }>;
  strongAreas: AreaRow[];
  weakAreas: AreaRow[];
  accuracyByDay: DayAccuracy[];
  progressTrend: AttemptPoint[];
  paceTrend: PacePoint[];
  minimumAreaSample: number;
  /** The accuracy bands, so the UI can say why a list is empty rather than guess. */
  strongAreaMinAccuracy: number;
  weakAreaMaxAccuracy: number;
  /** Machine-readable reasons a section is empty. Never a fabricated stand-in. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Everything the analytics page shows, for one student.
 *
 * Eight database operations, all narrowed by an index on `student`: four faceted
 * aggregations (one per surface) and four projected reads for the attempt-level
 * trends. They run in parallel, and every facet the response exposes is a sum over
 * rows already in memory rather than another query.
 */
export async function getStudentAnalytics(student: Types.ObjectId): Promise<StudentAnalytics> {
  const [
    practiceFacets,
    mockFacets,
    challengeFacets,
    examFacets,
    practiceAttempts,
    mockAttempts,
    challengeAttempts,
    examAttempts,
  ] = await Promise.all([
    PracticeSession.aggregate<FacetRow>(facetPipeline({ student, status: 'submitted' }, 'questions')),
    MockTestAttempt.aggregate<FacetRow>(facetPipeline({ student, status: 'submitted' }, 'questions')),
    // Single answer rather than an array — see `facetPipeline`.
    DailyChallengeAttempt.aggregate<FacetRow>(facetPipeline({ student }, '$answer')),
    ExamAttempt.aggregate<FacetRow>(facetPipeline({ student, status: 'submitted' }, 'questions')),

    PracticeSession.find({ student, status: 'submitted' })
      .select('submittedAt startedAt score maxMarks correctCount totalQuestions unansweredCount timeTakenSeconds')
      .sort({ submittedAt: 1 })
      .lean(),
    MockTestAttempt.find({ student, status: 'submitted' })
      .select('submittedAt startedAt score maxMarks correctCount totalQuestions unansweredCount timeTakenSeconds test')
      .sort({ submittedAt: 1 })
      .lean(),
    DailyChallengeAttempt.find({ student })
      .select('submittedAt day answer.isCorrect answer.marks answer.awardedMarks answer.answeredAt')
      .sort({ submittedAt: 1 })
      .lean(),
    ExamAttempt.find({ student, status: 'submitted' })
      .select('submittedAt startedAt score maxMarks correctCount totalQuestions unansweredCount timeTakenSeconds exam')
      .sort({ submittedAt: 1 })
      .lean(),
  ]);

  const notes: string[] = [];

  // --- Facets, rolled up by summing raw counts (never averaging percentages) ---
  const bySurfaceCounts = new Map<AnalyticsSurface, Counts>();
  const topicCounts = new Map<string, { name: string; subjectName: string | null; counts: Counts }>();
  const subjectCounts = new Map<string, { name: string; counts: Counts }>();
  const difficultyCounts = new Map<Difficulty, Counts>();
  const typeCounts = new Map<QuestionType, Counts>();
  const overall = emptyCounts();

  const facetsBySurface: Array<[AnalyticsSurface, FacetRow[]]> = [
    ['practice', practiceFacets],
    ['mock_test', mockFacets],
    ['daily_challenge', challengeFacets],
    ['official_exam', examFacets],
  ];

  for (const [surface, rows] of facetsBySurface) {
    const surfaceTotal = emptyCounts();

    for (const row of rows) {
      const counts = countsOf(row);
      addInto(overall, counts);
      addInto(surfaceTotal, counts);

      if (row._id.topic) {
        const key = String(row._id.topic);
        const existing = topicCounts.get(key) ?? {
          // A topic whose document was deleted still has answers pointing at it. Its
          // id is the honest label rather than an invented name.
          name: row._id.topicName ?? 'Unknown topic',
          subjectName: row._id.subjectName ?? null,
          counts: emptyCounts(),
        };
        addInto(existing.counts, counts);
        topicCounts.set(key, existing);
      }

      if (row._id.subject) {
        const key = String(row._id.subject);
        const existing = subjectCounts.get(key) ?? { name: row._id.subjectName ?? 'Unknown subject', counts: emptyCounts() };
        addInto(existing.counts, counts);
        subjectCounts.set(key, existing);
      }

      if (row._id.difficulty) {
        const existing = difficultyCounts.get(row._id.difficulty) ?? emptyCounts();
        addInto(existing, counts);
        difficultyCounts.set(row._id.difficulty, existing);
      }

      if (row._id.type) {
        const existing = typeCounts.get(row._id.type) ?? emptyCounts();
        addInto(existing, counts);
        typeCounts.set(row._id.type, existing);
      }
    }

    bySurfaceCounts.set(surface, surfaceTotal);
  }

  // --- Attempt-level trends ---
  const points: AttemptPoint[] = [
    ...practiceAttempts.map((doc) => attemptPoint('practice', 'Practice session', doc as AttemptDocShape)),
    ...mockAttempts.map((doc) => attemptPoint('mock_test', 'Mock test', doc as AttemptDocShape)),
    ...examAttempts.map((doc) => attemptPoint('official_exam', 'Official exam', doc as AttemptDocShape)),
    // A daily challenge is one question with no clock, so its point is assembled by
    // hand rather than through `attemptPoint()` — and carries a null duration.
    ...challengeAttempts.map((doc): AttemptPoint => {
      const answer = doc.answer as { isCorrect?: boolean | null; marks?: number; awardedMarks?: number | null } | undefined;
      const correct = answer?.isCorrect === true ? 1 : 0;
      return {
        surface: 'daily_challenge',
        at: doc.submittedAt,
        label: 'Daily challenge',
        score: answer?.awardedMarks ?? 0,
        maxMarks: answer?.marks ?? 0,
        scorePercent: percent(answer?.awardedMarks ?? 0, answer?.marks ?? 0),
        answered: 1,
        correct,
        served: 1,
        accuracyPercent: percent(correct, 1),
        timeTakenSeconds: null,
      };
    }),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const attemptCountsBySurface = new Map<AnalyticsSurface, number>();
  for (const point of points) {
    attemptCountsBySurface.set(point.surface, (attemptCountsBySurface.get(point.surface) ?? 0) + 1);
  }

  // --- Accuracy per IST competition day, from the attempts that day contained ---
  const dayBuckets = new Map<DayKey, { answered: number; correct: number }>();
  for (const point of points) {
    const key = dayKeyOf(point.at);
    const bucket = dayBuckets.get(key) ?? { answered: 0, correct: 0 };
    bucket.answered += point.answered;
    bucket.correct += point.correct;
    dayBuckets.set(key, bucket);
  }
  const accuracyByDay: DayAccuracy[] = [...dayBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, bucket]) => ({
      day,
      answered: bucket.answered,
      correct: bucket.correct,
      accuracyPercent: percent(bucket.correct, bucket.answered),
    }));

  // --- Pace, from the sittings that actually have a clock ---
  const paceTrend: PacePoint[] = points
    .filter((point) => point.timeTakenSeconds !== null && point.timeTakenSeconds > 0 && point.served > 0)
    .map((point) => ({
      at: point.at,
      surface: point.surface,
      label: point.label,
      questions: point.served,
      // Per-*attempt* pace, because no collection stores a per-question duration:
      // `answeredAt` is a timestamp, not an elapsed time, and a student may answer in
      // any order. Dividing the sitting's real duration by its real question count is
      // the strongest honest statement available, and it is labelled as such.
      secondsPerQuestion: Math.round((point.timeTakenSeconds! / point.served) * 10) / 10,
    }));

  const timedQuestions = paceTrend.reduce((sum, point) => sum + point.questions, 0);
  const timedSeconds = paceTrend.reduce((sum, point) => sum + point.questions * point.secondsPerQuestion, 0);

  if (challengeAttempts.length > 0 && paceTrend.length === 0) {
    notes.push('pace-unavailable-daily-challenge-has-no-clock');
  }

  const servedFromAttempts = points.reduce((sum, point) => sum + point.served, 0);
  if (servedFromAttempts > overall.served) {
    notes.push('some-answered-questions-have-since-been-deleted');
  }

  // --- Strong and weak areas ---
  /**
   * Chapters and difficulties, but **not subjects** (Milestone 21 Phase J).
   *
   * With a single implicit subject, a subject-scope area is arithmetically the overall figure with
   * a name on it — so the page told a child their weak area was "Mathematics", which is the whole
   * product and not something anyone can act on. It is the same reason the "By subject" table was
   * removed from the page: one subject makes it a restatement dressed as a finding.
   *
   * `subjectCounts` is still assembled and still returned as `bySubject`, because the shape is part
   * of the response and a second subject would make it meaningful again. What is dropped is only
   * its promotion into *advice*.
   */
  const areaCandidates: AreaRow[] = [
    ...[...topicCounts.entries()].map(([id, entry]) => ({ scope: 'topic' as const, id, name: entry.name, counts: entry.counts })),
    ...[...difficultyCounts.entries()].map(([id, counts]) => ({ scope: 'difficulty' as const, id, name: id, counts })),
  ]
    .filter((candidate) => candidate.counts.answered >= MIN_AREA_SAMPLE)
    .map((candidate) => ({
      scope: candidate.scope,
      id: candidate.id,
      name: candidate.name,
      // Non-null by construction: the filter above guarantees `answered >= 5`.
      accuracyPercent: percent(candidate.counts.correct, candidate.counts.answered)!,
      answered: candidate.counts.answered,
    }));

  // A total order, so the same data always produces the same list: accuracy, then the
  // larger sample (a verdict from 40 answers outranks the same figure from 5), then id.
  const ranked = [...areaCandidates].sort(
    (a, b) => b.accuracyPercent - a.accuracyPercent || b.answered - a.answered || a.id.localeCompare(b.id),
  );

  const strongAreas = ranked.filter((area) => area.accuracyPercent >= STRONG_AREA_MIN_ACCURACY).slice(0, 5);
  const weakAreas = [...ranked]
    .reverse()
    .filter((area) => area.accuracyPercent <= WEAK_AREA_MAX_ACCURACY)
    .slice(0, 5);

  if (areaCandidates.length === 0) {
    notes.push(
      overall.answered === 0
        ? 'areas-need-answered-questions'
        : `areas-need-at-least-${MIN_AREA_SAMPLE}-answers-in-one-area`,
    );
  } else {
    // A list can now be empty because nothing earned the label, which is a different
    // fact from having too small a sample, and the UI must be able to tell them apart.
    if (strongAreas.length === 0) notes.push(`no-area-reached-${STRONG_AREA_MIN_ACCURACY}-percent`);
    if (weakAreas.length === 0) notes.push(`no-area-fell-below-${WEAK_AREA_MAX_ACCURACY}-percent`);
  }

  const hasData = points.length > 0;
  if (!hasData) notes.push('nothing-submitted-yet');

  return {
    generatedAt: new Date(),
    hasData,
    overall: {
      ...toRow(overall),
      attempts: points.length,
      servedIncludingDeletedQuestions: servedFromAttempts,
      averageSecondsPerQuestion: timedQuestions > 0 ? Math.round((timedSeconds / timedQuestions) * 10) / 10 : null,
    },
    bySurface: ANALYTICS_SURFACES.map((surface) => ({
      surface,
      ...toRow(bySurfaceCounts.get(surface) ?? emptyCounts()),
      attempts: attemptCountsBySurface.get(surface) ?? 0,
    })),
    byTopic: [...topicCounts.entries()]
      .map(([id, entry]) => ({ id, name: entry.name, subjectName: entry.subjectName, ...toRow(entry.counts) }))
      .sort((a, b) => b.answered - a.answered || a.name.localeCompare(b.name)),
    bySubject: [...subjectCounts.entries()]
      .map(([id, entry]) => ({ id, name: entry.name, ...toRow(entry.counts) }))
      .sort((a, b) => b.answered - a.answered || a.name.localeCompare(b.name)),
    // Fixed order rather than data order, so the bars do not reshuffle between loads.
    byDifficulty: DIFFICULTIES.map((difficulty) => ({
      difficulty,
      ...toRow(difficultyCounts.get(difficulty) ?? emptyCounts()),
    })),
    byType: QUESTION_TYPES.map((type) => ({ type, ...toRow(typeCounts.get(type) ?? emptyCounts()) })),
    strongAreas,
    weakAreas,
    accuracyByDay,
    progressTrend: points,
    paceTrend,
    minimumAreaSample: MIN_AREA_SAMPLE,
    strongAreaMinAccuracy: STRONG_AREA_MIN_ACCURACY,
    weakAreaMaxAccuracy: WEAK_AREA_MAX_ACCURACY,
    notes,
  };
}
