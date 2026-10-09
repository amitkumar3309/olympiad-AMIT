import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app';
import { config } from '../src/config';
import {
  MIN_AREA_SAMPLE,
  STRONG_AREA_MIN_ACCURACY,
  WEAK_AREA_MAX_ACCURACY,
} from '../src/services/analyticsService';
import {
  getRecommendations,
  registerRecommendationEngine,
  resetRecommendationEngines,
  resolveRecommendationEngine,
} from '../src/services/recommendationService';
import { STATISTICAL_ENGINE_ID, statisticalEngine, wilsonInterval } from '../src/lib/statisticalRecommender';
import type { Recommendation, RecommendationEngine } from '../src/lib/recommendationTypes';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, validStudent, otherStudent, cookieHeader, registerVerifyLogin, createAdminSession, clearTestInbox } from './helpers/auth';
import { createPublishedQuestion, createTaxonomy, type Taxonomy } from './helpers/questions';
import { seedMockAttempt, seedPracticeSession, type Outcome } from './helpers/analytics';

/**
 * Milestone 16 — intelligent performance recommendations.
 *
 * The organising idea, inherited from the Milestone 15 suite: **a test that only asserts
 * a recommendation was produced would pass just as happily against a fabricated one.**
 * So every case seeds attempts with declared outcomes and asserts the exact finding that
 * must follow — including, repeatedly, that a finding is **not** produced.
 *
 * The three properties under the most scrutiny are the three ways this feature could be
 * plausible and wrong:
 *
 *  1. **A small sample is not a finding.** 2 of 5 (40%) must not be called a weakness
 *     while 30 of 80 (37.5%) must be, even though the first looks worse. This is the
 *     entire reason the engine reasons over a confidence interval rather than a
 *     percentage, and it is asserted directly.
 *  2. **Advice the product cannot honour is not advice.** Nothing may recommend
 *     practising a topic with no published questions for that student's class.
 *  3. **Provenance cannot be self-declared.** An engine describes its output; the
 *     service describes the engine. A registered engine cannot claim to be a model, and
 *     cannot claim the student has data.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const ORIGINAL_ENGINE_ID = config.recommendations.engineId;

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
  resetRecommendationEngines();
  config.recommendations.engineId = ORIGINAL_ENGINE_ID;
});

const ALIAS = '/api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function accountOf(studentId: string) {
  const account = await mongoose.model('Student').findOne({ studentId });
  return account!._id as never;
}

/** Recommendations for a freshly registered Class 9 student. */
async function recommendationsFor(studentId: string, classLevel: string | null = 'Class 9') {
  return getRecommendations(await accountOf(studentId), classLevel as never);
}

/** N published questions in one topic, so a sample can be built up over sittings. */
async function publishMany(
  cookies: Record<string, string>,
  taxonomy: Taxonomy,
  count: number,
  overrides: Record<string, unknown> = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const { id } = await createPublishedQuestion(app, cookies, taxonomy, overrides);
    ids.push(id);
  }
  return ids;
}

/**
 * Seeds `answered` answers in one topic, `correct` of them right, spread over sittings
 * of at most ten questions — which is what a real practice session looks like, and
 * which also exercises the roll-up across sittings rather than within one document.
 */
async function seedTopicRecord(
  studentId: string,
  questionIds: string[],
  answered: number,
  correct: number,
  options: { perSitting?: number } = {},
): Promise<void> {
  const perSitting = options.perSitting ?? 10;
  const outcomes: Outcome[] = Array.from({ length: answered }, (_, index) => (index < correct ? 'correct' : 'wrong'));

  for (let start = 0; start < outcomes.length; start += perSitting) {
    const slice = outcomes.slice(start, start + perSitting);
    await seedPracticeSession({
      studentId,
      // Questions repeat across sittings, exactly as they do when a student practises
      // the same topic more than once.
      questionIds: slice.map((_, index) => questionIds[(start + index) % questionIds.length]!),
      outcomes: slice,
    });
  }
}

function byId(list: Recommendation[], id: string): Recommendation | undefined {
  return list.find((entry) => entry.id === id);
}

// ===========================================================================
// The statistics themselves
// ===========================================================================

describe('the Wilson interval the findings are asserted on', () => {
  it('is absent, not zero, when there were no trials', () => {
    // The same rule the analytics service is built on: an interval around nothing is
    // not an interval around zero.
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it('does not treat five wrong answers as certainty', () => {
    const interval = wilsonInterval(0, 5)!;

    expect(interval.lowerPercent).toBe(0);
    // 43.4%, not 0%. A student who got five wrong could still be a 40% student having
    // a bad session, and the engine is required to know that.
    expect(interval.upperPercent).toBe(43.4);
  });

  it('narrows as the sample grows', () => {
    const small = wilsonInterval(0, 5)!;
    const large = wilsonInterval(0, 40)!;

    expect(large.upperPercent).toBeLessThan(small.upperPercent);
    expect(large.upperPercent).toBeCloseTo(8.8, 1);
  });

  it('stays inside 0–100 at the extremes', () => {
    const perfect = wilsonInterval(5, 5)!;

    expect(perfect.upperPercent).toBeLessThanOrEqual(100);
    expect(perfect.lowerPercent).toBeGreaterThanOrEqual(0);
    // And a perfect five is still not a *confident* 100%.
    expect(perfect.lowerPercent).toBeLessThan(80);
  });
});

// ===========================================================================
// Weak-topic detection
// ===========================================================================

describe('weak topics', () => {
  it('names a topic the student is confidently below par in, quoting the real counts', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Trigonometry' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    await seedTopicRecord(studentId, ids, 20, 4);

    const result = await recommendationsFor(studentId);
    const weakness = result.weakTopics[0]!;

    expect(result.weakTopics).toHaveLength(1);
    expect(weakness.title).toBe('Trigonometry');
    expect(weakness.basis.answered).toBe(20);
    expect(weakness.basis.correct).toBe(4);
    expect(weakness.basis.accuracyPercent).toBe(20);
    // The sentence has to quote the evidence, not merely be accompanied by it.
    expect(weakness.detail).toContain('4 of 20');
    expect(weakness.confidence).toBe('high');
  });

  it('rejects a bad small sample and accepts a worse large one', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);

    const noisy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Vectors' });
    const real = await createTaxonomy(app, adminCookies, { subject: 'Physics', topic: 'Optics' });
    const noisyIds = await publishMany(adminCookies, noisy, 5);
    const realIds = await publishMany(adminCookies, real, 10);

    // 2 of 5 is 40% — the worse-looking figure.
    await seedTopicRecord(studentId, noisyIds, 5, 2);
    // 30 of 80 is 37.5% — the better-looking figure, and the real finding.
    await seedTopicRecord(studentId, realIds, 80, 30);

    const result = await recommendationsFor(studentId);
    const names = result.weakTopics.map((entry) => entry.title);

    // This single assertion is the whole argument for the interval. Ranking on the
    // percentage would have put Vectors first and Optics second; ranking on the
    // evidence excludes Vectors altogether.
    expect(names).toContain('Optics');
    expect(names).not.toContain('Vectors');
  });

  it('will not call a topic weak below the shared sample floor', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Series' });
    const ids = await publishMany(adminCookies, taxonomy, 4);

    // One short of the floor, and every one of them wrong.
    await seedTopicRecord(studentId, ids, MIN_AREA_SAMPLE - 1, 0);

    const result = await recommendationsFor(studentId);

    expect(result.weakTopics).toHaveLength(0);
    // And the page is told why, rather than being left with an unexplained blank.
    expect(result.notes).toContain(`topics-need-at-least-${MIN_AREA_SAMPLE}-answers`);
  });

  /**
   * A practice test is a random mix of the class's questions (owner, 2026-10-09), so "Practise
   * Trigonometry" would be a promise the practice page cannot keep. The weakness is named; nothing
   * links to the chapter — even though this class's bank could have served one.
   */
  it('names a weakness without linking to a single chapter, which practice cannot serve', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Trigonometry' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    await seedTopicRecord(studentId, ids, 20, 2);

    const result = await recommendationsFor(studentId);

    expect(result.weakTopics[0]!.title).toBe('Trigonometry');
    expect(result.weakTopics[0]!.action).toBeNull();
    // The figure stays: how much of the class's bank that chapter is.
    expect(result.weakTopics[0]!.basis.figures.availableQuestions).toBe(10);
    expect(result.practice.some((entry) => entry.title.includes('Trigonometry'))).toBe(false);
    const hrefs = [...result.weakTopics, ...result.practice].map((entry) => entry.action?.href ?? '');
    expect(hrefs.some((href) => href.includes('topic='))).toBe(false);
  });
});

// ===========================================================================
// Strong-topic detection
// ===========================================================================

describe('strong topics', () => {
  it('does not call a perfect five a strength', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Ratios' });
    const ids = await publishMany(adminCookies, taxonomy, 5);

    await seedTopicRecord(studentId, ids, 5, 5);

    const result = await recommendationsFor(studentId);

    // 100% of five is real, and it is not yet evidence of a strength — the mirror of
    // the weak-topic case, and the reason a student cannot manufacture a strength by
    // doing one short session well.
    expect(result.strongTopics).toHaveLength(0);
    expect(result.notes).toContain('no-topic-is-confidently-above-par');
  });

  it('names a topic held up at 19 of 20, which an 80% floor on the lower bound would have missed', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Calculus' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    await seedTopicRecord(studentId, ids, 20, 19);

    const result = await recommendationsFor(studentId);

    // 95% over 20 answers has a lower bound of 76.4%. This case was found by running
    // the page: with the floor at 80 the student was told nothing was strong enough
    // to name, which reads as the feature being broken rather than as caution.
    expect(result.strongTopics[0]!.title).toBe('Calculus');
    expect(result.strongTopics[0]!.basis.lowerBoundPercent).toBeCloseTo(76.4, 1);
  });

  it('names a topic held up over a real sample', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    await seedTopicRecord(studentId, ids, 20, 20);

    const result = await recommendationsFor(studentId);
    const strength = result.strongTopics[0]!;

    expect(strength.title).toBe('Algebra');
    expect(strength.basis.accuracyPercent).toBe(100);
    expect(strength.basis.lowerBoundPercent).toBeCloseTo(83.9, 1);
    expect(strength.detail).toContain('20 of 20');
  });
});

// ===========================================================================
// Difficulty
// ===========================================================================

describe('difficulty recommendations', () => {
  /**
   * Nothing lets a student choose a difficulty since practice became a mixed test (2026-10-09), so
   * "Try Medium questions" or "Stay with Easy for now" could not be acted on. Both records below
   * produced exactly that advice before: one mastered Easy with Medium on offer, one struggling.
   */
  it('gives none, because no surface lets a student choose a difficulty', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const mastered = await registerVerifyLogin(app);
    const struggling = await registerVerifyLogin(app, otherStudent);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const easy = await publishMany(adminCookies, taxonomy, 10, { difficulty: 'Easy' });
    await publishMany(adminCookies, taxonomy, 5, { difficulty: 'Medium' });
    await publishMany(adminCookies, taxonomy, 5, { difficulty: 'Hard' });

    await seedTopicRecord(mastered.studentId, easy, 20, 20);
    await seedTopicRecord(struggling.studentId, easy, 20, 4);

    expect((await recommendationsFor(mastered.studentId)).difficulty).toEqual([]);
    expect((await recommendationsFor(struggling.studentId)).difficulty).toEqual([]);
  });
});

// ===========================================================================
// Practice recommendations
// ===========================================================================

describe('practice recommendations', () => {
  /**
   * A practice test is a random mix of the class's questions (owner, 2026-10-09). The old advice —
   * "Practise Trigonometry", "You have not tried Mensuration" — linked to one chapter, which the
   * practice page can no longer serve.
   */
  it('never sends a student to one chapter, weak or untried', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const weak = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Trigonometry' });
    const untried = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Mensuration' });
    const ids = await publishMany(adminCookies, weak, 10);
    await publishMany(adminCookies, untried, 7);

    await seedTopicRecord(studentId, ids, 20, 3);

    const result = await recommendationsFor(studentId);

    expect(result.weakTopics.map((entry) => entry.title)).toEqual(['Trigonometry']);
    expect(result.practice.some((entry) => /Trigonometry|Mensuration/.test(entry.title + entry.detail))).toBe(false);
    expect(result.practice.every((entry) => !entry.action || !entry.action.href.includes('?'))).toBe(true);
  });

  it('gives a student with no record a first practice test rather than a verdict', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const algebra = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const circles = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Circles' });
    await publishMany(adminCookies, algebra, 4);
    await publishMany(adminCookies, circles, 2);
    // Another class's question is not part of this student's test, so it is not counted.
    await publishMany(adminCookies, algebra, 1, { classLevel: 'Class 6' });

    const result = await recommendationsFor(studentId);

    expect(result.hasData).toBe(false);
    expect(result.notes).toContain('nothing-submitted-yet');
    // Nothing is claimed about the student; the only thing said is what exists.
    expect(result.weakTopics).toHaveLength(0);
    expect(result.strongTopics).toHaveLength(0);
    expect(result.insights).toHaveLength(0);
    const first = result.practice[0]!;
    expect(first.title).toBe('Take your first practice test');
    expect(first.detail).toContain('6 published questions for Class 9');
    expect(first.action).toEqual({ label: 'Start a practice test', href: '/practice' });
    // The same count the practice page shows, from the same function the draw uses.
    expect(first.basis.figures.availableQuestions).toBe(6);
    expect(first.confidence).toBe('high');
  });

  it('stops offering a first test once the student has a record', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    await seedTopicRecord(studentId, ids, 10, 7);

    const result = await recommendationsFor(studentId);
    expect(byId(result.practice, 'practice:first_test')).toBeUndefined();
  });

  it('says so when the class has no published questions at all', async () => {
    const { studentId } = await registerVerifyLogin(app);

    const result = await recommendationsFor(studentId);

    expect(result.practice).toHaveLength(0);
    expect(result.notes).toContain('no-published-questions-for-your-class');
  });

  it('suggests a timed paper only once one is published and none has been sat', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    await seedTopicRecord(studentId, ids, 10, 7);
    const before = await recommendationsFor(studentId);
    expect(byId(before.practice, 'practice:mock_test')).toBeUndefined();

    // A published mock test the student has now sat: the suggestion must not persist
    // once it has been taken up.
    await seedMockAttempt({ studentId, questionIds: ids.slice(0, 3), outcomes: ['correct', 'wrong', 'blank'] });
    const after = await recommendationsFor(studentId);
    expect(byId(after.practice, 'practice:mock_test')).toBeUndefined();
  });
});

// ===========================================================================
// Insights
// ===========================================================================

describe('performance insights', () => {
  it('measures a trend by summing raw counts, never by averaging percentages', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

    // Two early sittings: 10 answered, 2 correct → 20%.
    await seedPracticeSession({ studentId, questionIds: ids.slice(0, 5), outcomes: ['correct', 'wrong', 'wrong', 'wrong', 'wrong'], submittedAt: at(50) });
    await seedPracticeSession({ studentId, questionIds: ids.slice(0, 5), outcomes: ['correct', 'wrong', 'wrong', 'wrong', 'wrong'], submittedAt: at(40) });
    // Two later sittings: 10 answered, 8 correct → 80%.
    await seedPracticeSession({ studentId, questionIds: ids.slice(0, 5), outcomes: ['correct', 'correct', 'correct', 'correct', 'wrong'], submittedAt: at(20) });
    await seedPracticeSession({ studentId, questionIds: ids.slice(0, 5), outcomes: ['correct', 'correct', 'correct', 'correct', 'wrong'], submittedAt: at(10) });

    const result = await recommendationsFor(studentId);
    const trend = byId(result.insights, 'insight:trend')!;

    expect(trend.title).toBe('You are getting better');
    expect(trend.basis.figures.earlierAnswered).toBe(10);
    expect(trend.basis.figures.earlierCorrect).toBe(2);
    expect(trend.basis.figures.laterAnswered).toBe(10);
    expect(trend.basis.figures.laterCorrect).toBe(8);
    // 20% → 80%, from summed counts. The figure is quoted in the sentence, so a
    // wrong derivation would be visible to the reader as well as to this assertion.
    expect(trend.basis.figures.deltaPercentagePoints).toBe(60);
    expect(trend.detail).toContain('(20%)');
    expect(trend.detail).toContain('(80%)');
  });

  it('claims no direction of travel from too few sittings', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    await seedPracticeSession({ studentId, questionIds: ids.slice(0, 5), outcomes: ['wrong', 'wrong', 'wrong', 'wrong', 'wrong'] });
    await seedPracticeSession({ studentId, questionIds: ids.slice(0, 5), outcomes: ['correct', 'correct', 'correct', 'correct', 'correct'] });

    const result = await recommendationsFor(studentId);

    expect(byId(result.insights, 'insight:trend')).toBeUndefined();
  });

  it('names a blank rate with the counts behind it', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    // 12 served, 6 answered — a 50% blank rate.
    await seedPracticeSession({
      studentId,
      questionIds: ids.slice(0, 6),
      outcomes: ['correct', 'correct', 'wrong', 'blank', 'blank', 'blank'],
    });
    await seedPracticeSession({
      studentId,
      questionIds: ids.slice(0, 6),
      outcomes: ['correct', 'correct', 'wrong', 'blank', 'blank', 'blank'],
    });

    const result = await recommendationsFor(studentId);
    const blanks = byId(result.insights, 'insight:blank_rate')!;

    expect(blanks.basis.figures.served).toBe(12);
    expect(blanks.basis.figures.blank).toBe(6);
    expect(blanks.basis.figures.blankRatePercent).toBe(50);
    // Blanks are not wrong answers: the accuracy quoted alongside is over answered
    // questions only, which is the analytics service's rule and must not be re-derived.
    expect(blanks.basis.answered).toBe(6);
    expect(blanks.basis.correct).toBe(4);
  });

  it('notes when a whole record comes from one kind of sitting', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const ids = await publishMany(adminCookies, taxonomy, 10);

    await seedTopicRecord(studentId, ids, 30, 20);

    const result = await recommendationsFor(studentId);
    const single = byId(result.insights, 'insight:single_surface')!;

    expect(single.detail).toContain('practice sessions');
    expect(single.basis.figures.attempts).toBe(3);
  });
});

// ===========================================================================
// The seam — the part a model would be plugged into
// ===========================================================================

describe('the engine seam', () => {
  it('defaults to the statistical engine, which does not call itself AI', () => {
    const engine = resolveRecommendationEngine();

    expect(engine.descriptor.id).toBe(STATISTICAL_ENGINE_ID);
    // The honesty field. Only a real model may set 'model'.
    expect(engine.descriptor.kind).toBe('statistical');
    expect(engine.descriptor.basis).toContain('No AI is involved');
  });

  it('uses a registered engine when configuration names it', async () => {
    const stub: RecommendationEngine = {
      descriptor: { id: 'stub-v1', label: 'Stub', kind: 'model', basis: 'A stub for the test.' },
      recommend: () => ({
        weakTopics: [],
        strongTopics: [],
        difficulty: [],
        practice: [],
        insights: [],
        notes: ['from-the-stub'],
      }),
    };
    registerRecommendationEngine(stub);
    config.recommendations.engineId = 'stub-v1';

    const { studentId } = await registerVerifyLogin(app);
    const result = await recommendationsFor(studentId);

    expect(result.engine.id).toBe('stub-v1');
    expect(result.notes).toContain('from-the-stub');
  });

  it('stamps provenance itself, so an engine cannot overstate its own output', async () => {
    // The draft type has no engine field and no hasData field at all, so this is
    // structural rather than defensive — the test pins that it stays that way.
    const liar: RecommendationEngine = {
      descriptor: { id: 'liar-v1', label: 'Liar', kind: 'statistical', basis: 'Stub.' },
      recommend: () =>
        ({
          weakTopics: [],
          strongTopics: [],
          difficulty: [],
          practice: [],
          insights: [],
          notes: [],
          // Deliberately smuggled onto the draft.
          hasData: true,
          engine: { id: 'something-else', label: 'Fake', kind: 'model', basis: 'Powered by AI!' },
          generatedAt: new Date('2000-01-01'),
        }) as never,
    };
    registerRecommendationEngine(liar);
    config.recommendations.engineId = 'liar-v1';

    const { studentId } = await registerVerifyLogin(app);
    const result = await recommendationsFor(studentId);

    expect(result.engine.id).toBe('liar-v1');
    expect(result.engine.kind).toBe('statistical');
    expect(result.engine.basis).toBe('Stub.');
    // The student has submitted nothing, whatever the engine claimed.
    expect(result.hasData).toBe(false);
    expect(result.generatedAt.getFullYear()).toBeGreaterThan(2000);
  });

  it('falls back rather than failing when an engine throws', async () => {
    const broken: RecommendationEngine = {
      descriptor: { id: 'broken-v1', label: 'Broken', kind: 'model', basis: 'Throws.' },
      recommend: () => {
        throw new Error('model unavailable');
      },
    };
    registerRecommendationEngine(broken);
    config.recommendations.engineId = 'broken-v1';

    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const ids = await publishMany(adminCookies, taxonomy, 10);
    await seedTopicRecord(studentId, ids, 20, 2);

    const result = await recommendationsFor(studentId);

    // A quota, a timeout or a malformed response must cost the panel nothing.
    expect(result.engine.id).toBe(STATISTICAL_ENGINE_ID);
    expect(result.weakTopics[0]!.title).toBe('Algebra');
  });

  it('falls back when configuration names an engine that does not exist', () => {
    expect(resolveRecommendationEngine('does-not-exist').descriptor.id).toBe(STATISTICAL_ENGINE_ID);
  });

  it('is a pure function of the facts — the same record twice gives the same advice', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const { studentId } = await registerVerifyLogin(app);
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const ids = await publishMany(adminCookies, taxonomy, 10);
    await seedTopicRecord(studentId, ids, 20, 6);

    const first = await recommendationsFor(studentId);
    const second = await recommendationsFor(studentId);

    // A recommendation that reshuffles between reloads while claiming to be a
    // measurement is not a measurement.
    expect(second.weakTopics.map((entry) => entry.id)).toEqual(first.weakTopics.map((entry) => entry.id));
    expect(second.practice.map((entry) => entry.id)).toEqual(first.practice.map((entry) => entry.id));
    expect(second.insights.map((entry) => entry.id)).toEqual(first.insights.map((entry) => entry.id));
  });

  it('reads nothing from a database — the engine is pure over its facts', async () => {
    // Called with hand-built facts and no connection involvement at all: if this ever
    // needs a database, the wall between the service and the engine has been breached.
    const draft = await statisticalEngine.recommend({
      classLevel: 'Class 9',
      analytics: {
        generatedAt: new Date(),
        hasData: false,
        overall: {
          served: 0,
          answered: 0,
          correct: 0,
          marksAwarded: 0,
          marksAvailable: 0,
          accuracyPercent: null,
          scorePercent: null,
          attempts: 0,
          servedIncludingDeletedQuestions: 0,
          averageSecondsPerQuestion: null,
        },
        bySurface: [],
        byTopic: [],
        bySubject: [],
        byDifficulty: [],
        byType: [],
        strongAreas: [],
        weakAreas: [],
        accuracyByDay: [],
        progressTrend: [],
        paceTrend: [],
        minimumAreaSample: MIN_AREA_SAMPLE,
        // The accuracy bands a strength or a weakness has to clear. Read from the constants rather
        // than written as 70/50, so this fixture cannot drift from the thresholds it stands in for.
        strongAreaMinAccuracy: STRONG_AREA_MIN_ACCURACY,
        weakAreaMaxAccuracy: WEAK_AREA_MAX_ACCURACY,
        notes: [],
      },
      availability: [],
      practiceQuestions: 0,
      publishedMockTests: 0,
      now: new Date(),
    });

    expect(draft.notes).toContain('no-published-questions-for-your-class');
    expect(draft.weakTopics).toHaveLength(0);
  });
});

// ===========================================================================
// The endpoint
// ===========================================================================

describe('GET /analytics/:studentId/recommendations', () => {
  it('refuses a guest on both URL prefixes', async () => {
    const { studentId } = await registerVerifyLogin(app);

    for (const prefix of [API, ALIAS]) {
      const res = await request(app).get(`${prefix}/analytics/${studentId}/recommendations`);
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(200);
    }
  });

  it('serves a student their own recommendations', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);

    const res = await request(app)
      .get(`${API}/analytics/${studentId}/recommendations`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.recommendations.engine.id).toBe(STATISTICAL_ENGINE_ID);
    expect(res.body.recommendations.hasData).toBe(false);
    expect(res.body.recommendations.minimumSample).toBe(MIN_AREA_SAMPLE);
  });

  it('refuses one student the recommendations of another', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const { cookies: intruderCookies } = await registerVerifyLogin(app, otherStudent);

    for (const prefix of [API, ALIAS]) {
      const res = await request(app)
        .get(`${prefix}/analytics/${studentId}/recommendations`)
        .set('Cookie', cookieHeader(intruderCookies));

      expect(res.status).toBe(403);
      expect(res.status).not.toBe(200);
    }
  });

  it('lets staff holding analytics:read:any read a student', async () => {
    const { studentId } = await registerVerifyLogin(app, validStudent);
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });

    await request(app)
      .get(`${API}/analytics/${studentId}/recommendations`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);
  });

  it('404s an unknown student rather than inventing an empty record', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });

    const res = await request(app)
      .get(`${API}/analytics/AMIT_9999/recommendations`)
      .set('Cookie', cookieHeader(adminCookies));

    expect(res.status).toBe(404);
  });
});
