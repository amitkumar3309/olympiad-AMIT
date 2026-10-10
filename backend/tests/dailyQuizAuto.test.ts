import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { DailyChallenge, DailyQuizSettings, Question, Student, StudentActivity } from '../src/models';
import { CLASS_LEVELS } from '../src/lib/classLevels';
import { dayKeyOf, shiftDay } from '../src/lib/competitionDay';
import { freezeClock, now, resetClock } from '../src/lib/clock';
import { quizWindow } from '../src/lib/dailyQuiz';
import { quizDraftFor } from '../src/lib/mathTemplates';
import { ensureAutoQuiz, ensureAutoQuizzes } from '../src/services/dailyQuizAuto';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, registerVerifyLogin } from './helpers/auth';
import { createQuestionVia, createTaxonomy, type Taxonomy } from './helpers/questions';

/**
 * The automatic Daily Quiz (owner, 2026-10-10): every class with no quiz on a day gets one, from
 * the staff's "daily quiz" pool first and a generated question otherwise — never a published one,
 * and never in place of a quiz staff scheduled.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
beforeEach(() => freezeClock(new Date(quizWindow(dayKeyOf(new Date())).opensAt.getTime() + 12 * 60 * 60 * 1000)));
afterEach(async () => {
  resetClock();
  await clearTestDb();
  clearTestInbox();
});

const today = (): string => dayKeyOf(now());

async function seedAdmin(): Promise<{ adminCookies: Record<string, string>; taxonomy: Taxonomy }> {
  const { cookies: adminCookies } = await createAdminSession(app, {
    firstName: 'Author',
    lastName: 'Admin',
    mobile: '9000000001',
    email: 'author@example.com',
  });
  return { adminCookies, taxonomy: await createTaxonomy(app, adminCookies) };
}

const getQuiz = (cookies: Record<string, string>) => request(app).get(`${API}/me/daily-quiz`).set('Cookie', cookieHeader(cookies));
const settings = (patch: Record<string, unknown>) =>
  DailyQuizSettings.updateOne({ key: 'default' }, { $set: patch }, { upsert: true });

describe('the automatic Daily Quiz', () => {
  it('gives a class with nothing scheduled a generated quiz at its own level, unpublished and playable', async () => {
    await seedAdmin();
    const { cookies } = await registerVerifyLogin(app, { classLevel: 'Class 7' });

    const res = await getQuiz(cookies).expect(200);
    expect(res.body.quiz).not.toBeNull();
    expect(res.body.state).toBe('not-started');

    const quiz = await DailyChallenge.findOne({ day: today(), classLevel: 'Class 7' });
    expect(quiz?.source).toBe('automatic');
    expect(quiz?.createdByLabel).toBe('Automatic');
    const question = await Question.findById(quiz!.question);
    expect(question?.status).toBe('draft');
    expect(question?.classLevel).toBe('Class 7');
    expect(question?.provenance.source).toBe('quiz_generator');
    expect(question?.options.filter((o) => o.isCorrect)).toHaveLength(1);
    expect(question?.solution?.length ?? 0).toBeGreaterThan(10);

    // It plays like any quiz: Start, answer correctly, 200.
    await request(app).post(`${API}/me/daily-quiz/start`).set('Cookie', cookieHeader(cookies)).expect(201);
    const content = quiz!.content!;
    const right = content.options.find((option) => option.key === content.correctOptionKey)!;
    const submitted = await request(app)
      .post(`${API}/me/daily-quiz/submit`)
      .set('Cookie', cookieHeader(cookies))
      .send({ selectedOptionId: right.id })
      .expect(200);
    expect(submitted.body.result.isCorrect).toBe(true);
  });

  it('uses the oldest question in the class’s “daily quiz” pool before generating one', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const older = await createQuestionVia(app, adminCookies, taxonomy, { classLevel: 'Class 9', tags: ['Daily Quiz'] });
    await createQuestionVia(app, adminCookies, taxonomy, { classLevel: 'Class 9', tags: ['daily quiz'], questionText: 'A newer pooled question: what is $2 + 2$?' });
    // Not pooled: no tag, or another class, or published.
    await createQuestionVia(app, adminCookies, taxonomy, { classLevel: 'Class 9', questionText: 'An untagged draft: what is $3 + 3$?' });

    expect(await ensureAutoQuiz('Class 9', today())).toBe('pool');
    const quiz = await DailyChallenge.findOne({ day: today(), classLevel: 'Class 9' });
    expect(String(quiz?.question)).toBe(older.id);

    // Tomorrow's turn goes to the next one in the pool.
    expect(await ensureAutoQuiz('Class 9', shiftDay(today(), -1))).toBe('pool');
    const next = await DailyChallenge.findOne({ day: shiftDay(today(), -1), classLevel: 'Class 9' });
    const nextQuestion = await Question.findById(next!.question);
    expect(nextQuestion?.questionText).toContain('newer pooled');
  });

  it('ignores the pool when set to generated only', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await createQuestionVia(app, adminCookies, taxonomy, { classLevel: 'Class 9', tags: ['daily quiz'] });
    await settings({ autoSource: 'generated_only' });

    expect(await ensureAutoQuiz('Class 9', today())).toBe('generated');
  });

  it('never replaces a quiz staff scheduled, and does nothing when switched off', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const own = await createQuestionVia(app, adminCookies, taxonomy, { classLevel: 'Class 10' });
    await request(app)
      .post(`${API}/admin/daily-quiz`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ day: today(), classMin: 10, classMax: 10, questionId: own.id })
      .expect(201);
    expect(await ensureAutoQuiz('Class 10', today())).toBe('exists');
    expect(String((await DailyChallenge.findOne({ day: today(), classLevel: 'Class 10' }))?.question)).toBe(own.id);

    await settings({ autoSchedule: false });
    expect(await ensureAutoQuiz('Class 11', today())).toBe('off');
    const { cookies } = await registerVerifyLogin(app, { classLevel: 'Class 11' });
    expect((await getQuiz(cookies).expect(200)).body.quiz).toBeNull();
    expect(await DailyChallenge.countDocuments({ day: today(), classLevel: 'Class 11' })).toBe(0);
  });

  it('fills every class from 3 to 12 once, and a second run fills none', async () => {
    await seedAdmin();
    const first = await ensureAutoQuizzes(today());
    expect(Object.values(first).every((outcome) => outcome === 'generated')).toBe(true);
    expect(await DailyChallenge.countDocuments({ day: today() })).toBe(CLASS_LEVELS.length);

    const second = await ensureAutoQuizzes(today());
    expect(Object.values(second).every((outcome) => outcome === 'exists')).toBe(true);
    expect(await Question.countDocuments({ 'provenance.source': 'quiz_generator' })).toBe(CLASS_LEVELS.length);
  });

  it('settles two servers filling the same class at once: one quiz, no stray question left behind', async () => {
    await seedAdmin();
    await Promise.all([ensureAutoQuiz('Class 5', today()), ensureAutoQuiz('Class 5', today()), ensureAutoQuiz('Class 5', today())]);
    expect(await DailyChallenge.countDocuments({ day: today(), classLevel: 'Class 5' })).toBe(1);
    expect(await Question.countDocuments({ 'provenance.source': 'quiz_generator' })).toBe(1);
  });

  it('refuses a generated question whose text is already in the bank — a published copy would give the answer away', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const first = quizDraftFor('Class 8', today(), 0)!;
    await createQuestionVia(app, adminCookies, taxonomy, { classLevel: 'Class 8', questionText: first.questionText });

    expect(await ensureAutoQuiz('Class 8', today())).toBe('generated');
    const quiz = await DailyChallenge.findOne({ day: today(), classLevel: 'Class 8' });
    expect(quiz?.content?.questionText).not.toBe(first.questionText);
  });

  it('is filled by the homepage’s check, and by the scheduler’s job with its secret', async () => {
    await seedAdmin();
    const res = await request(app).get(`${API}/daily-quiz/today`).expect(200);
    expect(res.body.today.hasQuiz).toBe(true);
    expect(await DailyChallenge.countDocuments({ day: today() })).toBe(CLASS_LEVELS.length);

    await DailyChallenge.deleteMany({});
    await Question.deleteMany({});
    const previous = config.jobs.secret;
    (config.jobs as { secret: string | undefined }).secret = 'test-jobs-secret-for-the-auto-quiz';
    try {
      const job = await request(app)
        .post(`${API}/jobs/daily-quiz-schedule`)
        .set('Authorization', 'Bearer test-jobs-secret-for-the-auto-quiz')
        .expect(200);
      expect(job.body.classes['Class 3']).toBe('generated');
      expect(await DailyChallenge.countDocuments({ day: today() })).toBe(CLASS_LEVELS.length);
    } finally {
      (config.jobs as { secret: string | undefined }).secret = previous;
    }
  });

  it('leaves a past day alone: only today is filled when a student asks', async () => {
    await seedAdmin();
    const { cookies } = await registerVerifyLogin(app, { classLevel: 'Class 6' });
    await getQuiz(cookies).expect(200);
    expect(await DailyChallenge.countDocuments({ day: { $ne: today() } })).toBe(0);
  });

  it('shows the staff console that automation is on, with each class’s pool, and no “no quiz” warning', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await createQuestionVia(app, adminCookies, taxonomy, { classLevel: 'Class 12', tags: ['daily quiz'] });
    const res = await request(app).get(`${API}/admin/daily-quiz`).set('Cookie', cookieHeader(adminCookies)).expect(200);
    expect(res.body.calendar.warnings).toEqual([]);
    expect(res.body.calendar.auto.enabled).toBe(true);
    expect(res.body.calendar.auto.source).toBe('pool_then_generated');
    expect(res.body.calendar.auto.pool.find((row: { classLevel: string }) => row.classLevel === 'Class 12').count).toBe(1);

    const saved = await request(app)
      .put(`${API}/admin/daily-quiz/settings`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ prizeHeadline: 'Solve daily. Win every month.', prizeText: 'A medal', cashAmount: null, instantResult: true, autoSchedule: false })
      .expect(200);
    expect(saved.body.settings.autoSchedule).toBe(false);
    const after = await request(app).get(`${API}/admin/daily-quiz`).set('Cookie', cookieHeader(adminCookies)).expect(200);
    expect(after.body.calendar.auto.enabled).toBe(false);
    expect(after.body.calendar.warnings.length).toBeGreaterThan(0);
  });
});

describe('staff are not ranked', () => {
  it('keeps a promoted admin with XP off the public leaderboard', async () => {
    const { studentId } = await registerVerifyLogin(app, { firstName: 'Promoted', lastName: 'Staff' });
    const pupil = await registerVerifyLogin(app, { firstName: 'Real', lastName: 'Pupil', mobile: '9876500001', email: 'pupil@example.com' });

    const boardNames = async () =>
      ((await request(app).get(`${API}/leaderboard`).expect(200)).body.leaderboard as Array<{ displayName: string }>).map((row) => row.displayName);
    expect(await boardNames()).toEqual(expect.arrayContaining([expect.stringContaining('Promoted'), expect.stringContaining('Real')]));

    // Promoted by a super admin (the route is tested in rbac.test.ts); here only the effect matters.
    await Student.updateOne({ studentId }, { $set: { role: 'admin' } });
    const promoted = await Student.findOne({ studentId });
    expect(await StudentActivity.countDocuments({ student: promoted!._id })).toBeGreaterThan(0);

    const names = await boardNames();
    expect(names.some((name) => name.includes('Promoted'))).toBe(false);
    expect(names.some((name) => name.includes('Real'))).toBe(true);
    expect(pupil.studentId).toBeTruthy();
  });
});
