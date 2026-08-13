import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app';
import { MockTestAttempt, PracticeSession, Question } from '../src/models';
import { getStudentAnalytics, MIN_AREA_SAMPLE } from '../src/services/analyticsService';
import { getQuestionPerformance, getTestPerformance } from '../src/services/questionAnalyticsService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, validStudent, otherStudent, cookieHeader, registerVerifyLogin, createAdminSession, clearTestInbox } from './helpers/auth';
import { createPublishedQuestion, createTaxonomy, type Taxonomy } from './helpers/questions';
import { seedChallengeAttempt, seedMockAttempt, seedPracticeSession } from './helpers/analytics';

/**
 * Milestone 15 — performance analytics.
 *
 * Its organising idea is that **an analytics test that only asserts a number is present
 * would pass just as happily against a fabricated one**. So every case here seeds
 * attempts whose outcomes are declared up front — `['correct', 'wrong', 'blank']` — and
 * then asserts the exact figure that must follow. The seeding goes through the real
 * `snapshotOf()` and the real `gradeEntries()`, so the stored documents are what a
 * genuine sitting produces rather than a hand-written approximation that could agree
 * with the analytics while both disagreed with the product.
 *
 * Three properties get the most attention, because each is a way of being wrong that
 * looks right:
 *
 *  1. **Weighted, not averaged.** Combining 1/1 and 1/9 must give 20%, not 55%.
 *  2. **`null` is not `0`.** No answers means "not measured", not "scored nothing".
 *  3. **Blanks are not wrong answers.** `isCorrect` is `null` for an unanswered entry,
 *     so a careless `$ne: false` would count every blank as correct.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

const ALIAS = '/api';

/**
 * Two topics under one subject, plus a second subject — the smallest taxonomy that can
 * distinguish a topic breakdown from a subject breakdown.
 */
async function twoTopicTaxonomy(cookies: Record<string, string>) {
  const maths = await createTaxonomy(app, cookies, { subject: 'Mathematics', topic: 'Algebra', subtopic: 'Quadratics' });
  const physics = await createTaxonomy(app, cookies, { subject: 'Physics', topic: 'Optics', subtopic: 'Lenses' });
  return { maths, physics };
}

async function publish(cookies: Record<string, string>, taxonomy: Taxonomy, overrides: Record<string, unknown> = {}) {
  const { id } = await createPublishedQuestion(app, cookies, taxonomy, overrides);
  return id;
}

// ===========================================================================
// The empty case — honestly empty, never zeroed
// ===========================================================================

describe('a student who has answered nothing', () => {
  it('reports null accuracy rather than 0%', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const account = await mongoose.model('Student').findOne({ studentId });

    const analytics = await getStudentAnalytics(account!._id as never);

    expect(analytics.hasData).toBe(false);
    // The distinction the whole file rests on: "has not been measured" and "got
    // everything wrong" are different facts about a child.
    expect(analytics.overall.accuracyPercent).toBeNull();
    expect(analytics.overall.scorePercent).toBeNull();
    expect(analytics.overall.averageSecondsPerQuestion).toBeNull();
    expect(analytics.overall.answered).toBe(0);
    expect(analytics.overall.attempts).toBe(0);
    expect(analytics.notes).toContain('nothing-submitted-yet');
  });

  it('returns every facet present but empty, so the page has a shape to render', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const account = await mongoose.model('Student').findOne({ studentId });

    const analytics = await getStudentAnalytics(account!._id as never);

    expect(analytics.byTopic).toEqual([]);
    expect(analytics.bySubject).toEqual([]);
    expect(analytics.strongAreas).toEqual([]);
    expect(analytics.weakAreas).toEqual([]);
    expect(analytics.accuracyByDay).toEqual([]);
    // Difficulty and type are fixed axes, so they are always present with null
    // percentages — a bar chart that loses its axes when empty reads as broken.
    expect(analytics.byDifficulty.map((row) => row.difficulty)).toEqual(['Easy', 'Medium', 'Hard']);
    expect(analytics.byDifficulty.every((row) => row.accuracyPercent === null)).toBe(true);
    expect(analytics.bySurface).toHaveLength(4);
    expect(analytics.notes).toContain('areas-need-answered-questions');
  });
});

// ===========================================================================
// Accuracy, from known outcomes
// ===========================================================================

describe('accuracy is counted from the stored answers', () => {
  it('counts correct, wrong and blank exactly, and never treats a blank as correct', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);

    const ids = await Promise.all([
      publish(admin.cookies, maths),
      publish(admin.cookies, maths),
      publish(admin.cookies, maths),
      publish(admin.cookies, maths),
    ]);

    // 2 correct, 1 wrong, 1 blank → 3 answered, accuracy 2/3 = 66.7%
    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: ids,
      outcomes: ['correct', 'correct', 'wrong', 'blank'],
      marksEach: 4,
    });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    expect(analytics.overall.served).toBe(4);
    expect(analytics.overall.answered).toBe(3);
    expect(analytics.overall.correct).toBe(2);
    expect(analytics.overall.accuracyPercent).toBe(66.7);

    // Marks: +4 +4 +0 (no negative marking) +0 = 8 of 16 available.
    expect(analytics.overall.marksAwarded).toBe(8);
    expect(analytics.overall.marksAvailable).toBe(16);
    // Over marks *available*, not answered: the blank really did cost its marks.
    expect(analytics.overall.scorePercent).toBe(50);
  });

  it('agrees with the grader about how many questions were answered', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths), publish(admin.cookies, maths)]);

    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: ids,
      outcomes: ['correct', 'blank', 'wrong'],
    });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);
    const session = await PracticeSession.findOne({ student: account!._id });

    // The regression that matters: the aggregation reads `answeredAt`, while the
    // attempt's own `unansweredCount` was written by `gradeEntries()` from
    // `isAnswered()`. If those two ever diverge, every accuracy figure silently
    // shifts — so the agreement is pinned rather than assumed.
    expect(analytics.overall.answered).toBe(session!.totalQuestions - session!.unansweredCount);
    expect(analytics.overall.correct).toBe(session!.correctCount);
  });

  it('weights a combined accuracy rather than averaging two percentages', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);

    const one = await publish(admin.cookies, maths);
    const many = await Promise.all(Array.from({ length: 9 }, () => publish(admin.cookies, maths)));

    // Practice: 1 of 1 correct (100%). Mock: 1 of 9 correct (11.1%).
    await seedPracticeSession({ studentId: student.studentId, questionIds: [one], outcomes: ['correct'] });
    await seedMockAttempt({
      studentId: student.studentId,
      questionIds: many,
      outcomes: ['correct', 'wrong', 'wrong', 'wrong', 'wrong', 'wrong', 'wrong', 'wrong', 'wrong'],
    });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    // 2 correct of 10 answered = 20%. The average of the two percentages would be
    // 55.6%, which is the bug this test exists to forbid: it would tell a struggling
    // student they are better than half right.
    expect(analytics.overall.answered).toBe(10);
    expect(analytics.overall.accuracyPercent).toBe(20);

    const topic = analytics.byTopic.find((row) => row.name === 'Algebra');
    expect(topic!.accuracyPercent).toBe(20);
  });
});

// ===========================================================================
// The breakdowns
// ===========================================================================

describe('topic, subject, difficulty and type breakdowns', () => {
  it('splits by topic and rolls those topics up into their subject', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths, physics } = await twoTopicTaxonomy(admin.cookies);

    // A second topic under Mathematics, so a subject can be more than one topic.
    const geometry = await request(app)
      .post(`${API}/admin/topics`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ subject: maths.subjectId, name: 'Geometry' })
      .expect(201);
    const geometryTaxonomy: Taxonomy = { ...maths, topicId: geometry.body.topic.id, subtopicId: '' };

    const algebra = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);
    // Geometry has no subtopic, so the field is explicitly null rather than an empty
    // string — the schema validates a subtopic id when one is present.
    const geo = await Promise.all([
      publish(admin.cookies, geometryTaxonomy, { subtopic: null }),
      publish(admin.cookies, geometryTaxonomy, { subtopic: null }),
    ]);
    const optics = await publish(admin.cookies, physics);

    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: [...algebra, ...geo, optics],
      // Algebra 2/2, Geometry 0/2, Optics 1/1
      outcomes: ['correct', 'correct', 'wrong', 'wrong', 'correct'],
    });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    const byTopic = new Map(analytics.byTopic.map((row) => [row.name, row]));
    expect(byTopic.get('Algebra')!.accuracyPercent).toBe(100);
    expect(byTopic.get('Geometry')!.accuracyPercent).toBe(0);
    expect(byTopic.get('Optics')!.accuracyPercent).toBe(100);
    // The topic row names its subject, so two same-named topics stay distinguishable.
    expect(byTopic.get('Algebra')!.subjectName).toBe('Mathematics');

    const bySubject = new Map(analytics.bySubject.map((row) => [row.name, row]));
    // Mathematics is Algebra + Geometry = 2 of 4 = 50%. Summed from counts, so the
    // roll-up cannot be an average of 100% and 0%.
    expect(bySubject.get('Mathematics')!.answered).toBe(4);
    expect(bySubject.get('Mathematics')!.accuracyPercent).toBe(50);
    expect(bySubject.get('Physics')!.accuracyPercent).toBe(100);
  });

  it('splits by difficulty on a fixed axis', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);

    const easy = await Promise.all([
      publish(admin.cookies, maths, { difficulty: 'Easy' }),
      publish(admin.cookies, maths, { difficulty: 'Easy' }),
    ]);
    const hard = await Promise.all([
      publish(admin.cookies, maths, { difficulty: 'Hard' }),
      publish(admin.cookies, maths, { difficulty: 'Hard' }),
    ]);

    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: [...easy, ...hard],
      outcomes: ['correct', 'correct', 'wrong', 'wrong'],
    });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    const byDifficulty = new Map(analytics.byDifficulty.map((row) => [row.difficulty, row]));
    expect(byDifficulty.get('Easy')!.accuracyPercent).toBe(100);
    expect(byDifficulty.get('Hard')!.accuracyPercent).toBe(0);
    // Untouched difficulty reports null, not 0 — nothing was measured there.
    expect(byDifficulty.get('Medium')!.accuracyPercent).toBeNull();
    expect(byDifficulty.get('Medium')!.answered).toBe(0);
  });

  it('splits by question type', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);

    const choice = await publish(admin.cookies, maths);
    const numeric = await publish(admin.cookies, maths, {
      type: 'numeric',
      options: undefined,
      numericAnswer: 42,
      tolerance: 0,
    });

    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: [choice, numeric],
      outcomes: ['wrong', 'correct'],
    });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    const byType = new Map(analytics.byType.map((row) => [row.type, row]));
    expect(byType.get('single_choice')!.accuracyPercent).toBe(0);
    expect(byType.get('numeric')!.accuracyPercent).toBe(100);
    expect(byType.get('true_false')!.accuracyPercent).toBeNull();
  });

  it('separates the four surfaces and counts attempts on each', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);

    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths), publish(admin.cookies, maths)]);

    await seedPracticeSession({ studentId: student.studentId, questionIds: [ids[0]!], outcomes: ['correct'] });
    await seedMockAttempt({ studentId: student.studentId, questionIds: [ids[1]!], outcomes: ['wrong'] });
    await seedChallengeAttempt({ studentId: student.studentId, questionId: ids[2]!, outcome: 'correct' });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    const bySurface = new Map(analytics.bySurface.map((row) => [row.surface, row]));
    expect(bySurface.get('practice')).toMatchObject({ attempts: 1, answered: 1, correct: 1, accuracyPercent: 100 });
    expect(bySurface.get('mock_test')).toMatchObject({ attempts: 1, answered: 1, correct: 0, accuracyPercent: 0 });
    expect(bySurface.get('daily_challenge')).toMatchObject({ attempts: 1, answered: 1, correct: 1 });
    // The official exam is present and honestly empty.
    expect(bySurface.get('official_exam')).toMatchObject({ attempts: 0, answered: 0, accuracyPercent: null });

    expect(analytics.overall.attempts).toBe(3);
    expect(analytics.overall.accuracyPercent).toBe(66.7);
  });

  it('ignores an unsubmitted attempt entirely', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);

    await seedPracticeSession({ studentId: student.studentId, questionIds: [ids[0]!], outcomes: ['correct'] });
    // An abandoned session, left open. Its blanks are not wrong answers, and counting
    // them would libel the student.
    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    await PracticeSession.create({
      student: account!._id,
      status: 'in_progress',
      filters: { classLevel: 'Class 9', subject: null, topic: null, difficulty: null },
      questions: [],
      totalQuestions: 1,
      maxMarks: 4,
      startedAt: new Date(),
    });

    const analytics = await getStudentAnalytics(account!._id as never);
    expect(analytics.overall.attempts).toBe(1);
    expect(analytics.overall.answered).toBe(1);
    expect(analytics.overall.accuracyPercent).toBe(100);
  });

  it('keeps one student’s figures out of another’s', async () => {
    const admin = await createAdminSession(app);
    const mine = await registerVerifyLogin(app, otherStudent);
    const theirs = await registerVerifyLogin(app, { ...validStudent, email: 'third@example.com', mobile: '9000000091' });
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);

    await seedPracticeSession({ studentId: mine.studentId, questionIds: ids, outcomes: ['correct', 'correct'] });

    const theirAccount = await mongoose.model('Student').findOne({ studentId: theirs.studentId });
    const analytics = await getStudentAnalytics(theirAccount!._id as never);

    expect(analytics.hasData).toBe(false);
    expect(analytics.overall.answered).toBe(0);
  });
});

// ===========================================================================
// Weak and strong areas
// ===========================================================================

describe('weak and strong areas', () => {
  it('needs a minimum sample before calling anything a weakness', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);

    // One wrong answer. A real 0%, and a useless diagnosis.
    const one = await publish(admin.cookies, maths);
    await seedPracticeSession({ studentId: student.studentId, questionIds: [one], outcomes: ['wrong'] });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    expect(analytics.weakAreas).toEqual([]);
    expect(analytics.strongAreas).toEqual([]);
    expect(analytics.minimumAreaSample).toBe(MIN_AREA_SAMPLE);
    // The reason is machine-readable, so the page explains itself instead of showing
    // an unexplained blank panel.
    expect(analytics.notes).toContain(`areas-need-at-least-${MIN_AREA_SAMPLE}-answers-in-one-area`);
  });

  it('ranks a genuinely weak topic below a genuinely strong one', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths, physics } = await twoTopicTaxonomy(admin.cookies);

    const algebra = await Promise.all(Array.from({ length: 6 }, () => publish(admin.cookies, maths)));
    const optics = await Promise.all(Array.from({ length: 6 }, () => publish(admin.cookies, physics)));

    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: algebra,
      outcomes: ['correct', 'correct', 'correct', 'correct', 'correct', 'wrong'],
    });
    await seedMockAttempt({
      studentId: student.studentId,
      questionIds: optics,
      outcomes: ['wrong', 'wrong', 'wrong', 'wrong', 'wrong', 'correct'],
    });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    const strongTopics = analytics.strongAreas.filter((area) => area.scope === 'topic');
    const weakTopics = analytics.weakAreas.filter((area) => area.scope === 'topic');

    expect(strongTopics[0]).toMatchObject({ name: 'Algebra', accuracyPercent: 83.3, answered: 6 });
    expect(weakTopics[0]).toMatchObject({ name: 'Optics', accuracyPercent: 16.7, answered: 6 });
  });

  it('reports subject and difficulty areas alongside topics', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);

    const hard = await Promise.all(Array.from({ length: 6 }, () => publish(admin.cookies, maths, { difficulty: 'Hard' })));
    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: hard,
      outcomes: ['wrong', 'wrong', 'wrong', 'wrong', 'wrong', 'wrong'],
    });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    const scopes = new Set(analytics.weakAreas.map((area) => area.scope));
    expect(scopes.has('topic')).toBe(true);
    expect(scopes.has('subject')).toBe(true);
    expect(scopes.has('difficulty')).toBe(true);
    expect(analytics.weakAreas.find((area) => area.scope === 'difficulty')).toMatchObject({
      name: 'Hard',
      accuracyPercent: 0,
    });
  });
});

// ===========================================================================
// Trends
// ===========================================================================

describe('trends', () => {
  it('orders the progress trend by submission and reports each score', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);

    const earlier = new Date('2026-08-01T06:00:00Z');
    const later = new Date('2026-08-05T06:00:00Z');

    // Seeded out of order on purpose, to prove the sort is real.
    await seedMockAttempt({ studentId: student.studentId, questionIds: ids, outcomes: ['correct', 'correct'], submittedAt: later });
    await seedPracticeSession({ studentId: student.studentId, questionIds: ids, outcomes: ['wrong', 'wrong'], submittedAt: earlier });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    expect(analytics.progressTrend).toHaveLength(2);
    expect(analytics.progressTrend[0]).toMatchObject({ surface: 'practice', scorePercent: 0, accuracyPercent: 0 });
    expect(analytics.progressTrend[1]).toMatchObject({ surface: 'mock_test', scorePercent: 100, accuracyPercent: 100 });
  });

  it('buckets accuracy by IST competition day', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);

    // 18:35 UTC is already the next day in IST (+05:30) — the boundary case
    // `lib/competitionDay.ts` exists for. These two must land on different days.
    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: [ids[0]!],
      outcomes: ['correct'],
      submittedAt: new Date('2026-08-01T12:00:00Z'),
    });
    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: [ids[1]!],
      outcomes: ['wrong'],
      submittedAt: new Date('2026-08-01T18:35:00Z'),
    });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    expect(analytics.accuracyByDay).toHaveLength(2);
    expect(analytics.accuracyByDay[0]).toMatchObject({ day: '2026-08-01', correct: 1, accuracyPercent: 100 });
    expect(analytics.accuracyByDay[1]).toMatchObject({ day: '2026-08-02', correct: 0, accuracyPercent: 0 });
  });

  it('derives pace per attempt and leaves the daily challenge out of it', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths), publish(admin.cookies, maths)]);

    // 4 questions in 600s → 150s each. Only the sittings with a clock qualify.
    await seedPracticeSession({
      studentId: student.studentId,
      questionIds: [ids[0]!, ids[1]!],
      outcomes: ['correct', 'correct'],
      timeTakenSeconds: 300,
    });
    await seedChallengeAttempt({ studentId: student.studentId, questionId: ids[2]!, outcome: 'correct' });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    expect(analytics.paceTrend).toHaveLength(1);
    expect(analytics.paceTrend[0]).toMatchObject({ surface: 'practice', questions: 2, secondsPerQuestion: 150 });
    // A daily challenge has no clock, so it is absent rather than given an invented
    // duration — and the average is over the timed questions only.
    expect(analytics.overall.averageSecondsPerQuestion).toBe(150);
    expect(analytics.paceTrend.some((point) => point.surface === 'daily_challenge')).toBe(false);
  });

  it('says so when the only data has no clock, instead of reporting a pace of zero', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const id = await publish(admin.cookies, maths);

    await seedChallengeAttempt({ studentId: student.studentId, questionId: id, outcome: 'correct' });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    expect(analytics.paceTrend).toEqual([]);
    expect(analytics.overall.averageSecondsPerQuestion).toBeNull();
    expect(analytics.notes).toContain('pace-unavailable-daily-challenge-has-no-clock');
  });
});

// ===========================================================================
// A deleted question
// ===========================================================================

describe('when a question is deleted after being answered', () => {
  it('drops it from the taxonomy breakdown and says so, rather than inventing a bucket', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);

    await seedPracticeSession({ studentId: student.studentId, questionIds: ids, outcomes: ['correct', 'correct'] });
    await Question.deleteOne({ _id: ids[0] });

    const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
    const analytics = await getStudentAnalytics(account!._id as never);

    // The topic breakdown loses the orphaned answer, because it can no longer be
    // attributed. The attempt-derived count still knows about it, so the gap is
    // visible rather than silently absorbed.
    expect(analytics.overall.served).toBe(1);
    expect(analytics.overall.servedIncludingDeletedQuestions).toBe(2);
    expect(analytics.notes).toContain('some-answered-questions-have-since-been-deleted');
  });
});

// ===========================================================================
// The student route
// ===========================================================================

describe('GET /analytics/:studentId', () => {
  it('serves a student their own derived analytics', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);
    await seedPracticeSession({ studentId: student.studentId, questionIds: ids, outcomes: ['correct', 'wrong'] });

    const res = await request(app)
      .get(`${API}/analytics/${student.studentId}`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    expect(res.body.analytics.overall.accuracyPercent).toBe(50);
    expect(res.body.analytics.hasData).toBe(true);
    // `xpByDay` stays alongside: it measures participation where the rest measures
    // ability, and both belong on the page.
    expect(Array.isArray(res.body.xpByDay)).toBe(true);
    // The old response shape is gone with the model that backed it.
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).not.toHaveProperty('reason');
  });

  it('refuses another student, and lets an admin through', async () => {
    const admin = await createAdminSession(app);
    const mine = await registerVerifyLogin(app, otherStudent);
    const theirs = await registerVerifyLogin(app, { ...validStudent, email: 'nosy@example.com', mobile: '9000000092' });

    await request(app)
      .get(`${API}/analytics/${mine.studentId}`)
      .set('Cookie', cookieHeader(theirs.cookies))
      .expect(403);

    await request(app)
      .get(`${API}/analytics/${mine.studentId}`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    // The gate must hold on the unversioned alias too.
    await request(app)
      .get(`${ALIAS}/analytics/${mine.studentId}`)
      .set('Cookie', cookieHeader(theirs.cookies))
      .expect(403);
  });

  it('404s an unknown student rather than returning an empty report', async () => {
    const { cookies } = await createAdminSession(app);
    await request(app).get(`${API}/analytics/AMIT_9999`).set('Cookie', cookieHeader(cookies)).expect(404);
  });
});

// ===========================================================================
// Admin: question performance
// ===========================================================================

describe('question performance', () => {
  it('reports nothing when nothing has been answered', async () => {
    const result = await getQuestionPerformance({ page: 1, limit: 20 });
    expect(result.rows).toEqual([]);
    expect(result.questionsWithData).toBe(0);
    expect(result.notes).toContain('no-question-has-been-answered-yet');
  });

  it('merges the same question across surfaces by summing, and orders hardest first', async () => {
    const admin = await createAdminSession(app);
    const a = await registerVerifyLogin(app, otherStudent);
    const b = await registerVerifyLogin(app, { ...validStudent, email: 'b@example.com', mobile: '9000000093' });
    const c = await registerVerifyLogin(app, { ...validStudent, email: 'c@example.com', mobile: '9000000094' });
    const { maths } = await twoTopicTaxonomy(admin.cookies);

    const easyQ = await publish(admin.cookies, maths);
    const hardQ = await publish(admin.cookies, maths);

    // easyQ: 3 of 3 correct. hardQ: 0 of 3. Split across practice and a mock test, so
    // the merge is exercised rather than a single-collection path.
    for (const student of [a, b]) {
      await seedPracticeSession({ studentId: student.studentId, questionIds: [easyQ, hardQ], outcomes: ['correct', 'wrong'] });
    }
    await seedMockAttempt({ studentId: c.studentId, questionIds: [easyQ, hardQ], outcomes: ['correct', 'wrong'] });

    const result = await getQuestionPerformance({ page: 1, limit: 20, minAnswered: 3 });

    expect(result.questionsWithData).toBe(2);
    expect(result.rows).toHaveLength(2);
    // Hardest first, which is the list somebody would act on.
    expect(result.rows[0]!.id).toBe(hardQ);
    expect(result.rows[0]).toMatchObject({ served: 3, answered: 3, correct: 0, accuracyPercent: 0 });
    expect(result.rows[1]).toMatchObject({ id: easyQ, served: 3, answered: 3, correct: 3, accuracyPercent: 100 });
    // The taxonomy is joined for display.
    expect(result.rows[0]!.topicName).toBe('Algebra');
    expect(result.rows[0]!.subjectName).toBe('Mathematics');
  });

  it('keeps a single wrong answer from topping the hardest list', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const noisy = await publish(admin.cookies, maths);

    await seedPracticeSession({ studentId: student.studentId, questionIds: [noisy], outcomes: ['wrong'] });

    const filtered = await getQuestionPerformance({ page: 1, limit: 20, minAnswered: 3 });
    expect(filtered.rows).toEqual([]);
    expect(filtered.questionsWithData).toBe(1);
    expect(filtered.notes).toContain('no-question-has-at-least-3-answers-yet');

    // Lowering the floor deliberately does show it — the threshold is a parameter,
    // not a hidden constant.
    const unfiltered = await getQuestionPerformance({ page: 1, limit: 20, minAnswered: 1 });
    expect(unfiltered.rows).toHaveLength(1);
    expect(unfiltered.minAnswered).toBe(1);
  });

  it('counts a skipped question as skipped, not as wrong', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const skipped = await publish(admin.cookies, maths);

    // Served four times, answered once. A mis-worded question's signature.
    await seedPracticeSession({ studentId: student.studentId, questionIds: [skipped], outcomes: ['blank'] });
    await seedPracticeSession({ studentId: student.studentId, questionIds: [skipped], outcomes: ['blank'] });
    await seedPracticeSession({ studentId: student.studentId, questionIds: [skipped], outcomes: ['blank'] });
    await seedPracticeSession({ studentId: student.studentId, questionIds: [skipped], outcomes: ['correct'] });

    const result = await getQuestionPerformance({ page: 1, limit: 20, minAnswered: 1 });
    const row = result.rows[0]!;

    expect(row.served).toBe(4);
    expect(row.answered).toBe(1);
    // Accuracy is over answers, so a mostly-skipped question does not read as 25%.
    expect(row.accuracyPercent).toBe(100);
    expect(row.skipRatePercent).toBe(75);
  });

  it('filters by class and difficulty', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);

    const nine = await publish(admin.cookies, maths, { classLevel: 'Class 9', difficulty: 'Easy' });
    const ten = await publish(admin.cookies, maths, { classLevel: 'Class 10', difficulty: 'Hard' });
    await seedPracticeSession({ studentId: student.studentId, questionIds: [nine, ten], outcomes: ['correct', 'wrong'] });

    const byClass = await getQuestionPerformance({ page: 1, limit: 20, minAnswered: 1, classLevel: 'Class 10' });
    expect(byClass.rows.map((row) => row.id)).toEqual([ten]);

    const byDifficulty = await getQuestionPerformance({ page: 1, limit: 20, minAnswered: 1, difficulty: 'Easy' });
    expect(byDifficulty.rows.map((row) => row.id)).toEqual([nine]);
  });

  it('is closed to guests and plain students on both prefixes', async () => {
    const student = await registerVerifyLogin(app);
    for (const base of [API, ALIAS]) {
      await request(app).get(`${base}/admin/analytics/questions`).expect(401);
      await request(app)
        .get(`${base}/admin/analytics/questions`)
        .set('Cookie', cookieHeader(student.cookies))
        .expect(403);
      await request(app).get(`${base}/admin/analytics/tests`).expect(401);
      await request(app).get(`${base}/admin/analytics/tests`).set('Cookie', cookieHeader(student.cookies)).expect(403);
    }
  });

  it('serves the route with pagination', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);
    await seedPracticeSession({ studentId: student.studentId, questionIds: ids, outcomes: ['correct', 'wrong'] });

    const res = await request(app)
      .get(`${API}/admin/analytics/questions?minAnswered=1&limit=1`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    expect(res.body.questions).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ total: 2, totalPages: 2 });
    expect(res.body.minAnswered).toBe(1);
  });
});

// ===========================================================================
// Admin: test performance
// ===========================================================================

describe('test performance', () => {
  it('reports nothing when no paper has been attempted', async () => {
    const { rows, notes } = await getTestPerformance();
    expect(rows).toEqual([]);
    expect(notes).toContain('no-paper-has-been-attempted-yet');
  });

  it('reports a mean, a median and a completion rate from real attempts', async () => {
    const admin = await createAdminSession(app);
    const a = await registerVerifyLogin(app, otherStudent);
    const b = await registerVerifyLogin(app, { ...validStudent, email: 'b2@example.com', mobile: '9000000095' });
    const c = await registerVerifyLogin(app, { ...validStudent, email: 'c2@example.com', mobile: '9000000096' });
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);

    // Three attempts at the *same* paper: 100%, 50%, 0%.
    const { testId } = await seedMockAttempt({
      studentId: a.studentId,
      questionIds: ids,
      outcomes: ['correct', 'correct'],
      title: 'Shared paper',
    });
    for (const [student, outcomes] of [
      [b, ['correct', 'wrong']],
      [c, ['wrong', 'wrong']],
    ] as const) {
      const account = await mongoose.model('Student').findOne({ studentId: student.studentId });
      const seeded = await seedMockAttempt({ studentId: student.studentId, questionIds: ids, outcomes: [...outcomes] });
      // Point them at the first test so all three sit one paper.
      await MockTestAttempt.updateMany({ student: account!._id }, { $set: { test: testId } });
      await mongoose.model('MockTest').deleteOne({ _id: seeded.testId });
    }

    const { rows } = await getTestPerformance();
    const paper = rows.find((row) => row.id === String(testId))!;

    expect(paper.kind).toBe('mock_test');
    expect(paper.attemptsSubmitted).toBe(3);
    expect(paper.distinctStudents).toBe(3);
    expect(paper.completionPercent).toBe(100);
    // Mean of 100, 50, 0 is 50; the median is also 50 here, and both are reported so
    // a skewed cohort is visible rather than smoothed away.
    expect(paper.averageScorePercent).toBe(50);
    expect(paper.medianScorePercent).toBe(50);
    expect(paper.highestScorePercent).toBe(100);
    expect(paper.lowestScorePercent).toBe(0);
  });

  it('serves the route to an administrator', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { maths } = await twoTopicTaxonomy(admin.cookies);
    const ids = await Promise.all([publish(admin.cookies, maths), publish(admin.cookies, maths)]);
    await seedMockAttempt({ studentId: student.studentId, questionIds: ids, outcomes: ['correct', 'wrong'] });

    const res = await request(app)
      .get(`${API}/admin/analytics/tests`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    expect(res.body.tests).toHaveLength(1);
    expect(res.body.tests[0]).toMatchObject({ kind: 'mock_test', attemptsSubmitted: 1, averageScorePercent: 50 });
  });
});
