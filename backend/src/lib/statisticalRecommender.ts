import type { Difficulty } from '../models';
import { MIN_AREA_SAMPLE, type NamedPerformanceRow, type StudentAnalytics } from '../services/analyticsService';
import type { SubjectAvailability, TopicAvailability } from '../services/practiceService';
import {
  confidenceFor,
  nextDifficultyUp,
  DIFFICULTY_LADDER,
  type Recommendation,
  type RecommendationBasis,
  type RecommendationDraft,
  type RecommendationEngine,
  type RecommendationFacts,
} from './recommendationTypes';

/**
 * THE default recommendation engine: arithmetic over the student's real answers.
 *
 * It is **statistical, and it is not AI** — the descriptor says so and the page prints
 * it. That wording is load-bearing. Milestone 15 deleted a function called
 * `generateAIInsights()` which was rule-based string assembly that had never been near a
 * model, and the whole point of doing this properly is that the numbers underneath are
 * now real enough that a false label on them would be more damaging, not less.
 *
 * ## Why an interval and not just a percentage
 *
 * The obvious implementation ranks topics by accuracy and calls the bottom ones weak.
 * On this product's data that is actively misleading: a practice session is ten
 * questions, so a topic's whole sample is often five or six answers, and 2/5 (40%) from
 * one bad session would outrank 30/80 (37.5%) sustained over a month. The first is
 * noise; the second is the finding.
 *
 * So every claim is made against the **95% Wilson score interval** around the accuracy
 * rather than the point estimate, and always from the conservative end:
 *
 *   - a **weakness** is asserted on the interval's **upper** bound — "even taking the
 *     optimistic reading of this sample, it is still below par";
 *   - a **strength** is asserted on its **lower** bound — "even pessimistically, this is
 *     strong".
 *
 * Both therefore need either a decisive result or a decent sample, which is exactly the
 * behaviour wanted. Wilson rather than the textbook normal interval because the normal
 * one is badly wrong at small n and at proportions near 0 or 1, which is precisely where
 * this data lives (a 5-answer topic at 0%).
 *
 * The sample floor from `analyticsService` is reused rather than redefined, so the weak
 * areas listed on the analytics page and the weak topics recommended beside them cannot
 * be gated by two different numbers.
 *
 * ## Everything here is a pure function of `RecommendationFacts`
 *
 * No database, no clock of its own (`facts.now` is passed in), no randomness. The same
 * facts always produce the same list in the same order — which is what makes the tests
 * able to assert an exact sentence, and what stops a "recommendation" that reshuffles
 * on every reload while claiming to be a measurement.
 */

// ---------------------------------------------------------------------------
// Thresholds — every one of them stated once, here
// ---------------------------------------------------------------------------

/** Below this, confidently, is a weakness. */
export const WEAK_ACCURACY_CEILING = 60;
/**
 * At or above this, confidently, is a strength.
 *
 * Lower than the weakness ceiling's mirror image would suggest, because it is applied
 * to the interval's *lower* bound and that is a much harder test than it looks: at 20
 * answers, 95% correct has a lower bound of only 76.4%. An 80 floor here meant a
 * student who had got 19 of 20 right was told no topic was strong enough to name —
 * found by running the page, not by a test.
 */
export const STRONG_ACCURACY_FLOOR = 75;
/** Accuracy at a difficulty above which the next level up is worth attempting. */
export const STEP_UP_FLOOR = 75;
/** Accuracy at a difficulty below which the student should stay and consolidate. */
export const CONSOLIDATE_CEILING = 50;
/** Sittings needed before a direction of travel may be claimed. */
export const TREND_MIN_SITTINGS = 4;
/** Answers each half of the trend window needs before the halves may be compared. */
export const TREND_MIN_ANSWERS_PER_HALF = 5;
/** Percentage points of movement below which the trend is reported as steady. */
export const TREND_MIN_DELTA = 5;
/** Served questions needed before a blank rate means anything. */
export const BLANK_RATE_MIN_SERVED = 10;
/** Blank rate above which leaving questions unanswered is worth naming. */
export const BLANK_RATE_CEILING = 20;
/** Most recommendations of any one kind. Beyond this a list stops being advice. */
export const MAX_PER_KIND = 5;

const WILSON_Z = 1.96;

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface Interval {
  lowerPercent: number;
  upperPercent: number;
}

/**
 * The 95% Wilson score interval for `correct` successes out of `answered` trials,
 * as percentages rounded to one decimal place.
 *
 * Null when there were no trials: an interval around nothing is not zero, it is absent —
 * the same `null`-is-not-`0` rule the analytics service is built on.
 */
export function wilsonInterval(correct: number, answered: number, z = WILSON_Z): Interval | null {
  if (answered <= 0) return null;

  const p = correct / answered;
  const z2 = z * z;
  const denominator = 1 + z2 / answered;
  const centre = p + z2 / (2 * answered);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * answered)) / answered);

  const lower = (centre - spread) / denominator;
  const upper = (centre + spread) / denominator;

  return {
    // Clamped because floating-point arithmetic can put the bound a hair outside [0,1]
    // at the extremes, and a "-0.1% accuracy" on a page is a bug the reader can see.
    lowerPercent: round1(Math.max(0, lower) * 100),
    upperPercent: round1(Math.min(1, upper) * 100),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampPriority(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Confidence scales the priority, so a shakier finding sorts below a firm one. */
const CONFIDENCE_WEIGHT = { low: 0.6, medium: 0.8, high: 1 } as const;

// ---------------------------------------------------------------------------
// Basis helpers
// ---------------------------------------------------------------------------

function basisFor(
  scope: RecommendationBasis['scope'],
  scopeId: string | null,
  scopeName: string | null,
  answered: number,
  correct: number,
  figures: Record<string, number> = {},
): RecommendationBasis {
  const interval = wilsonInterval(correct, answered);
  return {
    scope,
    scopeId,
    scopeName,
    answered,
    correct,
    accuracyPercent: answered > 0 ? round1((correct / answered) * 100) : null,
    lowerBoundPercent: interval?.lowerPercent ?? null,
    upperBoundPercent: interval?.upperPercent ?? null,
    figures,
  };
}

/** `4 of 18` reads better than `22.2%` when the sample is what is in question. */
function fraction(correct: number, answered: number): string {
  return `${correct} of ${answered}`;
}

// ---------------------------------------------------------------------------
// Bank helpers
// ---------------------------------------------------------------------------

interface BankTopic extends TopicAvailability {
  subjectId: string;
  subjectName: string;
}

function flattenBank(availability: SubjectAvailability[]): BankTopic[] {
  return availability.flatMap((subject) =>
    subject.topics.map((topic) => ({ ...topic, subjectId: subject.subjectId, subjectName: subject.subjectName })),
  );
}

/** Which difficulties the class's published bank actually offers. */
function bankDifficulties(availability: SubjectAvailability[]): Set<Difficulty> {
  const levels = new Set<Difficulty>();
  for (const subject of availability) for (const level of subject.difficulties) levels.add(level);
  return levels;
}

/**
 * A practice deep link, built only from ids the bank really contains.
 *
 * The page validates these against its own loaded options before selecting anything, so
 * a stale link degrades to the ordinary picker rather than to an error.
 */
function practiceHref(subjectId: string, topicId: string, difficulty?: Difficulty): string {
  const params = new URLSearchParams({ subject: subjectId, topic: topicId });
  if (difficulty) params.set('difficulty', difficulty);
  return `/practice?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// 1. Weak topics
// ---------------------------------------------------------------------------

/**
 * Topics the student is **confidently** below par in.
 *
 * Ranked by the interval's upper bound ascending — the topic we are most sure is a
 * problem comes first, rather than the one with the unluckiest five answers.
 */
function weakTopics(analytics: StudentAnalytics, bank: BankTopic[]): Recommendation[] {
  const byBankId = new Map(bank.map((topic) => [topic.topicId, topic]));

  return analytics.byTopic
    .filter((row) => row.answered >= MIN_AREA_SAMPLE)
    .map((row) => ({ row, interval: wilsonInterval(row.correct, row.answered)! }))
    // The upper bound, not the point estimate: "even read optimistically, still weak".
    .filter(({ interval }) => interval.upperPercent < WEAK_ACCURACY_CEILING)
    .sort(
      (a, b) =>
        a.interval.upperPercent - b.interval.upperPercent ||
        b.row.answered - a.row.answered ||
        a.row.id.localeCompare(b.row.id),
    )
    .slice(0, MAX_PER_KIND)
    .map(({ row, interval }) => {
      const confidence = confidenceFor(row.answered);
      const available = byBankId.get(row.id);
      return {
        id: `weak_topic:${row.id}`,
        kind: 'weak_topic' as const,
        title: row.name,
        detail:
          `You have answered ${fraction(row.correct, row.answered)} correctly in ${row.name}` +
          `${row.subjectName ? ` (${row.subjectName})` : ''} — ${row.accuracyPercent}%. ` +
          `Allowing for the size of that sample, your accuracy here is very likely below ` +
          `${interval.upperPercent}%.`,
        priority: clampPriority((100 - interval.upperPercent) * CONFIDENCE_WEIGHT[confidence]),
        confidence,
        basis: basisFor('topic', row.id, row.name, row.answered, row.correct, {
          availableQuestions: available?.questionCount ?? 0,
        }),
        // Only offered when the bank can honour it. A link to a topic with no published
        // questions for this class lands the student on an empty picker.
        action: available
          ? { label: `Practise ${row.name}`, href: practiceHref(available.subjectId, available.topicId) }
          : null,
      };
    });
}

// ---------------------------------------------------------------------------
// 2. Strong topics
// ---------------------------------------------------------------------------

/** The mirror image: asserted on the lower bound, ranked by it descending. */
function strongTopics(analytics: StudentAnalytics): Recommendation[] {
  return analytics.byTopic
    .filter((row) => row.answered >= MIN_AREA_SAMPLE)
    .map((row) => ({ row, interval: wilsonInterval(row.correct, row.answered)! }))
    .filter(({ interval }) => interval.lowerPercent >= STRONG_ACCURACY_FLOOR)
    .sort(
      (a, b) =>
        b.interval.lowerPercent - a.interval.lowerPercent ||
        b.row.answered - a.row.answered ||
        a.row.id.localeCompare(b.row.id),
    )
    .slice(0, MAX_PER_KIND)
    .map(({ row, interval }) => {
      const confidence = confidenceFor(row.answered);
      return {
        id: `strong_topic:${row.id}`,
        kind: 'strong_topic' as const,
        title: row.name,
        detail:
          `${row.accuracyPercent}% in ${row.name} — ${fraction(row.correct, row.answered)}. ` +
          `Even on a cautious reading of that sample you are above ${interval.lowerPercent}% here.`,
        priority: clampPriority(interval.lowerPercent * CONFIDENCE_WEIGHT[confidence]),
        confidence,
        basis: basisFor('topic', row.id, row.name, row.answered, row.correct),
        action: null,
      };
    });
}

// ---------------------------------------------------------------------------
// 3. Difficulty
// ---------------------------------------------------------------------------

/**
 * What level to work at next.
 *
 * At most one recommendation per level, and one ordering rule that stops the section
 * contradicting itself: **if any level is flagged for consolidation, no step-up to a
 * level above it is offered.** Telling a student to shore up Easy and attempt Hard in
 * the same breath is not two pieces of advice, it is one incoherent one.
 */
function difficultyRecommendations(analytics: StudentAnalytics, availability: SubjectAvailability[]): Recommendation[] {
  const offered = bankDifficulties(availability);
  const measured = new Map(analytics.byDifficulty.map((row) => [row.difficulty, row]));
  const byLevel = new Map<Difficulty, Recommendation>();

  // Pass 1: consolidation. Runs first because it constrains what pass 2 may say.
  let lowestConsolidating: number | null = null;

  for (const level of DIFFICULTY_LADDER) {
    const row = measured.get(level);
    if (!row || row.answered < MIN_AREA_SAMPLE) continue;

    const interval = wilsonInterval(row.correct, row.answered)!;
    if (interval.upperPercent >= CONSOLIDATE_CEILING) continue;

    const confidence = confidenceFor(row.answered);
    const rank = DIFFICULTY_LADDER.indexOf(level);
    lowestConsolidating = lowestConsolidating === null ? rank : Math.min(lowestConsolidating, rank);

    byLevel.set(level, {
      id: `difficulty:consolidate:${level}`,
      kind: 'difficulty',
      title: `Stay with ${level} for now`,
      detail:
        `${row.accuracyPercent}% on ${level} questions (${fraction(row.correct, row.answered)}). ` +
        `More ${level} work will pay off more than moving up will.`,
      priority: clampPriority((100 - interval.upperPercent) * CONFIDENCE_WEIGHT[confidence]),
      confidence,
      basis: basisFor('difficulty', level, level, row.answered, row.correct),
      action: null,
    });
  }

  // Pass 2: stepping up, from a level the student has genuinely mastered.
  for (const level of DIFFICULTY_LADDER) {
    const row = measured.get(level);
    if (!row || row.answered < MIN_AREA_SAMPLE) continue;

    const interval = wilsonInterval(row.correct, row.answered)!;
    if (interval.lowerPercent < STEP_UP_FLOOR) continue;

    const target = nextDifficultyUp(level);
    if (!target || !offered.has(target) || byLevel.has(target)) continue;

    // The coherence rule.
    if (lowestConsolidating !== null && DIFFICULTY_LADDER.indexOf(target) > lowestConsolidating) continue;

    const confidence = confidenceFor(row.answered);
    const targetRow = measured.get(target);
    byLevel.set(target, {
      id: `difficulty:step_up:${target}`,
      kind: 'difficulty',
      title: `Try ${target} questions`,
      detail:
        `You are at ${row.accuracyPercent}% on ${level} (${fraction(row.correct, row.answered)})` +
        `${targetRow && targetRow.answered > 0 ? `, and have answered ${targetRow.answered} ${target} question${targetRow.answered === 1 ? '' : 's'} so far` : ''}. ` +
        `${target} questions are where the marks are now.`,
      priority: clampPriority(interval.lowerPercent * CONFIDENCE_WEIGHT[confidence]),
      confidence,
      basis: basisFor('difficulty', level, level, row.answered, row.correct, {
        answeredAtTargetLevel: targetRow?.answered ?? 0,
      }),
      action: null,
    });
  }

  // Pass 3: a level the bank offers and the student has never met. Only when nothing
  // above already speaks for that level, and only when there is a record to compare it
  // against — "you have not tried Hard yet" is not a finding about a student who has
  // not tried anything yet.
  if (analytics.overall.answered >= MIN_AREA_SAMPLE) {
    for (const level of DIFFICULTY_LADDER) {
      if (byLevel.has(level) || !offered.has(level)) continue;
      const row = measured.get(level);
      if (row && row.answered > 0) continue;
      if (lowestConsolidating !== null && DIFFICULTY_LADDER.indexOf(level) > lowestConsolidating) continue;

      byLevel.set(level, {
        id: `difficulty:untried:${level}`,
        kind: 'difficulty',
        title: `You have not tried a ${level} question yet`,
        detail: `None of the ${analytics.overall.answered} questions you have answered were ${level}. Your class has ${level} questions published.`,
        priority: 40,
        confidence: 'high',
        basis: basisFor('difficulty', level, level, 0, 0),
        action: null,
      });
      break; // One untried level at a time — the lowest. A list of them is not advice.
    }
  }

  return DIFFICULTY_LADDER.map((level) => byLevel.get(level)).filter(
    (entry): entry is Recommendation => entry !== undefined,
  );
}

// ---------------------------------------------------------------------------
// 4. Practice
// ---------------------------------------------------------------------------

/**
 * What to actually do next, and every item is something the bank can serve.
 *
 * Three sources in priority order: shore up a measured weakness, cover a topic never
 * attempted, and — for a student with no record at all — a plain starting point, which
 * is an availability statement rather than a claim about them.
 */
function practiceRecommendations(facts: RecommendationFacts, bank: BankTopic[], weak: Recommendation[]): Recommendation[] {
  const { analytics } = facts;
  const out: Recommendation[] = [];
  // A staff account has no class. The bank is then empty, so the sentences below that
  // quote it are unreachable — the fallback exists so a type change can never print
  // the word "null" at a student.
  const className = facts.classLevel ?? 'your class';

  // (a) The weaknesses the bank can do something about.
  for (const weakness of weak) {
    if (!weakness.action) continue;
    const topicId = weakness.basis.scopeId!;
    const topic = bank.find((entry) => entry.topicId === topicId);
    if (!topic) continue;

    out.push({
      id: `practice:weak:${topicId}`,
      kind: 'practice',
      title: `Practise ${topic.topicName}`,
      detail:
        `${topic.questionCount} published question${topic.questionCount === 1 ? '' : 's'} in ` +
        `${topic.topicName} for ${className}, and it is your weakest measured topic at ` +
        `${weakness.basis.accuracyPercent}%.`,
      priority: clampPriority(weakness.priority),
      confidence: weakness.confidence,
      basis: basisFor('topic', topicId, topic.topicName, weakness.basis.answered, weakness.basis.correct, {
        availableQuestions: topic.questionCount,
      }),
      action: { label: 'Start a session', href: practiceHref(topic.subjectId, topic.topicId) },
    });
  }

  // (b) Coverage: published topics this student has never been served a question from.
  // A pure fact about the record, with no performance claim attached to it.
  const attempted = new Set(analytics.byTopic.map((row) => row.id));
  const untouched = bank
    .filter((topic) => !attempted.has(topic.topicId))
    .sort((a, b) => b.questionCount - a.questionCount || a.topicName.localeCompare(b.topicName));

  for (const topic of untouched) {
    if (out.length >= MAX_PER_KIND) break;
    out.push({
      id: `practice:untouched:${topic.topicId}`,
      kind: 'practice',
      title: analytics.hasData ? `You have not tried ${topic.topicName}` : `Start with ${topic.topicName}`,
      detail:
        `${topic.questionCount} published question${topic.questionCount === 1 ? '' : 's'} in ` +
        `${topic.topicName} (${topic.subjectName}) for ${className}, and you have not answered any of them.`,
      // Below any measured weakness: a gap in coverage is worth less than a
      // demonstrated difficulty, and a bigger bank is worth slightly more.
      priority: clampPriority(20 + Math.min(15, topic.questionCount)),
      // A statement about the bank and about which questions were served, both of which
      // are counted exactly. Nothing here is inferred from a sample.
      confidence: 'high',
      basis: basisFor('bank', topic.topicId, topic.topicName, 0, 0, { availableQuestions: topic.questionCount }),
      action: { label: 'Start a session', href: practiceHref(topic.subjectId, topic.topicId) },
    });
  }

  // (c) A timed paper, once there is a practice record but no mock test behind it.
  const mockRow = analytics.bySurface.find((row) => row.surface === 'mock_test');
  if (analytics.hasData && facts.publishedMockTests > 0 && (mockRow?.attempts ?? 0) === 0 && out.length < MAX_PER_KIND) {
    out.push({
      id: 'practice:mock_test',
      kind: 'practice',
      title: 'Sit a timed mock test',
      detail:
        `${facts.publishedMockTests} mock test${facts.publishedMockTests === 1 ? ' is' : 's are'} published for ` +
        `${className}, and you have not sat one. Practice is untimed, so nothing in your record measures you under a clock yet.`,
      priority: 45,
      confidence: 'high',
      basis: basisFor('surface', 'mock_test', 'Mock tests', 0, 0, { publishedMockTests: facts.publishedMockTests }),
      action: { label: 'See mock tests', href: '/mock-tests' },
    });
  }

  return out.slice(0, MAX_PER_KIND);
}

// ---------------------------------------------------------------------------
// 5. Insights
// ---------------------------------------------------------------------------

/**
 * Observations about the record as a whole — each one a statement of counted fact with
 * the counts attached, never a characterisation of the student.
 */
function insights(analytics: StudentAnalytics): Recommendation[] {
  const out: Recommendation[] = [];

  // --- Direction of travel ---
  const trend = trendInsight(analytics);
  if (trend) out.push(trend);

  // --- Questions left blank ---
  const { served, answered } = analytics.overall;
  const blanks = served - answered;
  if (served >= BLANK_RATE_MIN_SERVED && blanks > 0) {
    const blankRate = round1((blanks / served) * 100);
    if (blankRate > BLANK_RATE_CEILING) {
      out.push({
        id: 'insight:blank_rate',
        kind: 'insight',
        title: 'You are leaving questions blank',
        detail:
          `${blanks} of the ${served} questions you have been served went unanswered (${blankRate}%). ` +
          `Blanks score nothing, where a considered guess on a question with no negative marking cannot lose you anything.`,
        priority: clampPriority(blankRate),
        confidence: 'high',
        basis: basisFor('overall', null, null, answered, analytics.overall.correct, {
          served,
          blank: blanks,
          blankRatePercent: blankRate,
        }),
        action: null,
      });
    }
  }

  // --- Pace, stated as two facts rather than as a verdict ---
  const pace = analytics.overall.averageSecondsPerQuestion;
  if (pace !== null && analytics.overall.accuracyPercent !== null && analytics.paceTrend.length > 0) {
    out.push({
      id: 'insight:pace',
      kind: 'insight',
      title: `About ${pace}s per question`,
      detail:
        `Across your timed sittings you average ${pace} seconds a question, at ${analytics.overall.accuracyPercent}% accuracy. ` +
        `This is measured per sitting rather than per question — nothing records how long any single question took.`,
      priority: 20,
      confidence: confidenceFor(analytics.overall.answered),
      basis: basisFor('overall', null, null, analytics.overall.answered, analytics.overall.correct, {
        averageSecondsPerQuestion: pace,
        timedSittings: analytics.paceTrend.length,
      }),
      action: null,
    });
  }

  // --- Where the answers came from ---
  const surfacesUsed = analytics.bySurface.filter((row) => row.attempts > 0);
  if (analytics.overall.attempts >= 3 && surfacesUsed.length === 1) {
    const only = surfacesUsed[0]!;
    out.push({
      id: 'insight:single_surface',
      kind: 'insight',
      title: 'Everything you have answered came from one place',
      detail:
        `All ${only.attempts} of your submitted sittings are ${SURFACE_WORDS[only.surface]}. ` +
        `Working in more than one format is what makes an accuracy figure mean something general.`,
      priority: 25,
      confidence: 'high',
      basis: basisFor('surface', only.surface, SURFACE_WORDS[only.surface], only.answered, only.correct, {
        attempts: only.attempts,
      }),
      action: null,
    });
  }

  return out.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, MAX_PER_KIND);
}

const SURFACE_WORDS = {
  practice: 'practice sessions',
  mock_test: 'mock tests',
  daily_challenge: 'daily challenges',
  official_exam: 'official exam sittings',
} as const;

/**
 * Improving, declining or steady — from the **raw counts** of the two halves of the
 * record, never from an average of per-sitting percentages.
 *
 * That distinction is the same one the analytics service is built on. A student whose
 * first half is 1/1 and second half is 1/9 has gone from 100% to 11%, but averaging the
 * per-sitting percentages of a longer record smears exactly this out. Summing correct
 * and answered separately is the only way the comparison means what it says.
 */
function trendInsight(analytics: StudentAnalytics): Recommendation | null {
  const points = analytics.progressTrend;
  if (points.length < TREND_MIN_SITTINGS) return null;

  const middle = Math.floor(points.length / 2);
  const first = points.slice(0, middle);
  const second = points.slice(middle);

  const sum = (rows: typeof points) =>
    rows.reduce((acc, row) => ({ answered: acc.answered + row.answered, correct: acc.correct + row.correct }), {
      answered: 0,
      correct: 0,
    });

  const before = sum(first);
  const after = sum(second);
  if (before.answered < TREND_MIN_ANSWERS_PER_HALF || after.answered < TREND_MIN_ANSWERS_PER_HALF) return null;

  const beforePercent = round1((before.correct / before.answered) * 100);
  const afterPercent = round1((after.correct / after.answered) * 100);
  const delta = round1(afterPercent - beforePercent);

  const improving = delta >= TREND_MIN_DELTA;
  const declining = delta <= -TREND_MIN_DELTA;

  return {
    id: 'insight:trend',
    kind: 'insight',
    title: improving ? 'You are getting better' : declining ? 'Your accuracy has slipped' : 'Your accuracy is steady',
    detail:
      `Over your first ${first.length} sittings you answered ${fraction(before.correct, before.answered)} correctly (${beforePercent}%); ` +
      `over the ${second.length} since, ${fraction(after.correct, after.answered)} (${afterPercent}%). ` +
      (improving || declining
        ? `That is a change of ${delta > 0 ? '+' : ''}${delta} percentage points.`
        : `That is within ${TREND_MIN_DELTA} points, so there is no real movement either way yet.`),
    priority: improving || declining ? clampPriority(50 + Math.abs(delta)) : 30,
    confidence: confidenceFor(Math.min(before.answered, after.answered)),
    basis: basisFor('trend', null, null, before.answered + after.answered, before.correct + after.correct, {
      earlierAnswered: before.answered,
      earlierCorrect: before.correct,
      laterAnswered: after.answered,
      laterCorrect: after.correct,
      deltaPercentagePoints: delta,
    }),
    action: null,
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export const STATISTICAL_ENGINE_ID = 'statistical-v1';

export const statisticalEngine: RecommendationEngine = {
  descriptor: {
    id: STATISTICAL_ENGINE_ID,
    label: 'Statistical rules',
    // Not 'model'. Nothing here is a model, and saying otherwise would be the fiction
    // this product has already deleted once.
    kind: 'statistical',
    basis:
      'Worked out by counting your answered questions and comparing them with 95% confidence intervals. ' +
      'No AI is involved.',
  },

  recommend(facts: RecommendationFacts): RecommendationDraft {
    const bank = flattenBank(facts.availability);
    const notes: string[] = [];

    const weak = weakTopics(facts.analytics, bank);
    const strong = strongTopics(facts.analytics);
    const difficulty = difficultyRecommendations(facts.analytics, facts.availability);
    const practice = practiceRecommendations(facts, bank, weak);
    const insight = insights(facts.analytics);

    // Every empty section says why it is empty, in machine-readable form. A blank panel
    // with no explanation reads as a broken page.
    const measurableAreas = facts.analytics.byTopic.filter((row: NamedPerformanceRow) => row.answered >= MIN_AREA_SAMPLE);

    if (bank.length === 0) notes.push('no-published-questions-for-your-class');
    if (!facts.analytics.hasData) notes.push('nothing-submitted-yet');
    else if (measurableAreas.length === 0) notes.push(`topics-need-at-least-${MIN_AREA_SAMPLE}-answers`);

    if (weak.length === 0 && measurableAreas.length > 0) notes.push('no-topic-is-confidently-below-par');
    if (strong.length === 0 && measurableAreas.length > 0) notes.push('no-topic-is-confidently-above-par');
    if (insight.length === 0 && facts.analytics.hasData) notes.push(`trend-needs-${TREND_MIN_SITTINGS}-sittings`);

    return { weakTopics: weak, strongTopics: strong, difficulty, practice, insights: insight, notes };
  },
};
