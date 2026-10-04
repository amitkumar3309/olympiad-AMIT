import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import {
  AuditLog,
  DailyChallenge,
  DailyChallengeAttempt,
  DailyQuizStart,
  DailyQuizWinner,
  Notification,
  Student,
  StudentActivity,
} from '../src/models';
import { XP_AWARDS } from '../src/lib/xp';
import { dayKeyOf, shiftDay } from '../src/lib/competitionDay';
import { freezeClock, now, resetClock } from '../src/lib/clock';
import { quizWindow } from '../src/lib/dailyQuiz';
import { performReset } from '../src/services/contentResetService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, otherStudent, registerVerifyLogin } from './helpers/auth';
import { createQuestionVia, createTaxonomy, type Taxonomy } from './helpers/questions';

/**
 * Milestone 30, Phase 2 — the Daily Quiz, through the API (brief §6.8, "API/integration").
 *
 * The daily challenge became a prize quiz, and the properties that matter are the ones
 * money rides on, each asserted on its effect rather than on a mechanism:
 *
 *  1. **One attempt per student per quiz** — a second submission never creates a second
 *     attempt, whatever it carries.
 *  2. **The server owns time** — the clock (`lib/clock.ts`) is moved here, never mocked
 *     per call, and an answer after midnight is refused.
 *  3. **The answer key never reaches the browser before the reveal** — every student
 *     response is stringified on both sides of midnight.
 *  4. **Winners are chosen by the rule and announced by a person.**
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
// Noon IST on the real day, so no test can straddle a midnight it did not ask for.
beforeEach(() => clockTo(dayKeyOf(new Date()), 12));
afterEach(async () => {
  resetClock();
  await clearTestDb();
  clearTestInbox();
});

const SOLUTION = 'Factorise as $(x-2)(x-3)=0$, so $x \\in \\{2, 3\\}$ and the larger root is $3$.';

/** Stops the server clock at `hours` (plus `extraMs`) after the opening of `day`, IST midnight. */
function clockTo(day: string, hours: number, extraMs = 0): void {
  freezeClock(new Date(quizWindow(day).opensAt.getTime() + hours * 60 * 60 * 1000 + extraMs));
}

const today = (): string => dayKeyOf(now());

async function seedAdmin(): Promise<{ adminCookies: Record<string, string>; taxonomy: Taxonomy }> {
  const { cookies: adminCookies } = await createAdminSession(app, {
    firstName: 'Author',
    lastName: 'Admin',
    mobile: '9000000001',
    email: 'author@example.com',
  });
  const taxonomy = await createTaxonomy(app, adminCookies);
  return { adminCookies, taxonomy };
}

/** A draft single-choice question (the bank's default fixture), ready to be a quiz. */
async function draftQuestion(
  adminCookies: Record<string, string>,
  taxonomy: Taxonomy,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const question = await createQuestionVia(app, adminCookies, taxonomy, overrides);
  expect(question.status).toBe('draft');
  return question.id;
}

function schedule(adminCookies: Record<string, string>, body: Record<string, unknown>): request.Test {
  return request(app).post(`${API}/admin/daily-quiz`).set('Cookie', cookieHeader(adminCookies)).send(body);
}

/** Today's quiz for Classes 9–12, from a fresh draft question. Returns the group id. */
async function seedTodaysQuiz(): Promise<{ adminCookies: Record<string, string>; taxonomy: Taxonomy; groupId: string; questionId: string }> {
  const { adminCookies, taxonomy } = await seedAdmin();
  const questionId = await draftQuestion(adminCookies, taxonomy);
  const res = await schedule(adminCookies, { day: today(), classMin: 9, classMax: 12, questionId }).expect(201);
  return { adminCookies, taxonomy, groupId: res.body.groupId as string, questionId };
}

/** The correct option's opaque id and a wrong one's, read from the quiz's own snapshot. */
async function optionIds(): Promise<{ correct: string; wrong: string }> {
  const quiz = await DailyChallenge.findOne({ day: today(), classLevel: 'Class 9' });
  const content = quiz!.content!;
  const correct = content.options.find((option) => option.key === content.correctOptionKey)!;
  const wrong = content.options.find((option) => option.key !== content.correctOptionKey)!;
  return { correct: correct.id, wrong: wrong.id };
}

const getQuiz = (cookies: Record<string, string>) => request(app).get(`${API}/me/daily-quiz`).set('Cookie', cookieHeader(cookies));
const start = (cookies: Record<string, string>) => request(app).post(`${API}/me/daily-quiz/start`).set('Cookie', cookieHeader(cookies));
const submit = (cookies: Record<string, string>, selectedOptionId: string) =>
  request(app).post(`${API}/me/daily-quiz/submit`).set('Cookie', cookieHeader(cookies)).send({ selectedOptionId });
const history = (cookies: Record<string, string>) =>
  request(app).get(`${API}/me/daily-quiz/history`).set('Cookie', cookieHeader(cookies));

// ===========================================================================
// Authentication
// ===========================================================================

describe('authentication', () => {
  it('answers 401 to every personal route without a session', async () => {
    expect((await request(app).get(`${API}/me/daily-quiz`)).status).toBe(401);
    expect((await request(app).post(`${API}/me/daily-quiz/start`)).status).toBe(401);
    expect((await request(app).post(`${API}/me/daily-quiz/submit`).send({ selectedOptionId: 'o0123456789' })).status).toBe(401);
    expect((await request(app).get(`${API}/me/daily-quiz/history`)).status).toBe(401);
    expect((await request(app).get(`${API}/me/daily-quiz/status`)).status).toBe(401);
  });

  it('has no end-to-end hooks unless they are switched on — they reset databases', async () => {
    expect((await request(app).post('/__e2e/reset')).status).toBe(404);
    expect((await request(app).post('/__e2e/clock').send({ advanceDays: 1 })).status).toBe(404);
    expect((await request(app).post('/__e2e/seed').send({})).status).toBe(404);
    expect((await request(app).get('/__e2e/last-link?to=someone@example.com')).status).toBe(404);
  });

  it('serves the public prize information without one, generated from the settings', async () => {
    const res = await request(app).get(`${API}/daily-quiz/info`).expect(200);
    expect(res.body.info.cashAmount).toBeNull();
    expect(res.body.info.xpForCorrect).toBe(XP_AWARDS.daily_challenge_completed);
    expect(res.body.info.howWinnersAreChosen).toMatch(/fastest solve time/i);
  });
});

// ===========================================================================
// The floating button's status (Phase 3)
// ===========================================================================

describe('GET /me/daily-quiz/status', () => {
  const status = (cookies: Record<string, string>) =>
    request(app).get(`${API}/me/daily-quiz/status`).set('Cookie', cookieHeader(cookies));

  it('walks live → in progress → done, and never carries the question', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);

    const live = await status(cookies).expect(200);
    expect(live.body).toMatchObject({ state: 'live', closesAt: quizWindow(today()).closesAt.toISOString() });
    expect(live.headers['cache-control']).toContain('no-store');

    await start(cookies).expect(201);
    expect((await status(cookies).expect(200)).body.state).toBe('in-progress');

    const { wrong } = await optionIds();
    await submit(cookies, wrong).expect(200);
    const done = await status(cookies).expect(200);
    expect(done.body).toMatchObject({ state: 'done', revealAt: quizWindow(today()).revealAt.toISOString() });

    // Nothing about the question, the options or the result — that is the quiz page's.
    const body = JSON.stringify(done.body);
    expect(body).not.toContain('options');
    expect(body).not.toContain('isCorrect');
    expect(Object.keys(done.body).sort()).toEqual(['closesAt', 'nextQuizAt', 'revealAt', 'serverNow', 'state', 'success']);
  });

  it('says when the next quiz opens when there is none today', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const questionId = await draftQuestion(adminCookies, taxonomy);
    const tomorrow = shiftDay(today(), -1);
    await schedule(adminCookies, { day: tomorrow, classMin: 9, classMax: 12, questionId }).expect(201);
    const { cookies } = await registerVerifyLogin(app);

    const res = await status(cookies).expect(200);
    expect(res.body).toMatchObject({ state: 'none', nextQuizAt: quizWindow(tomorrow).opensAt.toISOString() });
  });

  it('answers none with no next date on an empty calendar', async () => {
    const { cookies } = await registerVerifyLogin(app);
    expect((await status(cookies).expect(200)).body).toMatchObject({ state: 'none', nextQuizAt: null });
  });
});

// ===========================================================================
// Today's quiz
// ===========================================================================

describe('today’s quiz', () => {
  it('says so honestly when nothing is scheduled, and never fills the day by itself', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const tomorrowQuestion = await draftQuestion(adminCookies, taxonomy);
    await schedule(adminCookies, { day: shiftDay(today(), -1), classMin: 9, classMax: 12, questionId: tomorrowQuestion }).expect(201);
    const { cookies } = await registerVerifyLogin(app);

    const res = await getQuiz(cookies).expect(200);
    expect(res.body.quiz).toBeNull();
    expect(res.body.reason).toBe('none-scheduled');
    expect(res.body.nextQuizAt).toBe(quizWindow(shiftDay(today(), -1)).opensAt.toISOString());
    expect(await DailyChallenge.countDocuments({ day: today() })).toBe(0);
  });

  it('shows the topic, difficulty and class range before Start — and no question', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);

    const res = await getQuiz(cookies).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.state).toBe('not-started');
    expect(res.body.quiz.classRange.label).toBe('Classes 9–12');
    expect(res.body.quiz.topic).toBe('Algebra');
    expect(res.body.quiz.difficulty).toBe('Medium');
    expect(res.body.question).toBeNull();
    expect(res.body.serverNow).toBeTruthy();
  });

  it('targets a class range: a quiz for Classes 3–5 is not a Class 9 student’s quiz', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const questionId = await draftQuestion(adminCookies, taxonomy, { classLevel: 'Class 4' });
    await schedule(adminCookies, { day: today(), classMin: 3, classMax: 5, questionId }).expect(201);

    const nine = await registerVerifyLogin(app);
    expect((await getQuiz(nine.cookies)).body.reason).toBe('none-scheduled');
    expect((await start(nine.cookies)).status).toBe(409);

    const four = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 4' });
    const res = await getQuiz(four.cookies).expect(200);
    expect(res.body.quiz.classRange.label).toBe('Classes 3–5');
  });

  it('is free: a student who has not paid the entry fee can play', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    expect((await start(cookies)).status).toBe(201);
  });
});

// ===========================================================================
// Start and submit
// ===========================================================================

describe('start and submit', () => {
  it('shows the question on Start, with opaque ids, and keeps the clock if Start is pressed again', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);

    const first = await start(cookies).expect(201);
    expect(first.body.state).toBe('in-progress');
    expect(first.body.question.options).toHaveLength(4);
    for (const option of first.body.question.options) {
      expect(option.id).toMatch(/^o[0-9a-f]{10}$/);
      expect(Object.keys(option).sort()).toEqual(['id', 'letter', 'text']);
    }

    const again = await start(cookies).expect(200);
    expect(again.body.alreadyStarted).toBe(true);
    expect(again.body.startedAt).toBe(first.body.startedAt);
    expect(again.body.question.options).toEqual(first.body.question.options);
    expect(await DailyQuizStart.countDocuments({})).toBe(1);
  });

  it('refuses an answer before Start', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const { correct } = await optionIds();

    const res = await submit(cookies, correct);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Press Start/);
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(0);
  });

  it('refuses an option that is not in the quiz', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    await start(cookies).expect(201);

    expect((await submit(cookies, 'o0000000000')).status).toBe(400);
    expect((await submit(cookies, 'b')).status).toBe(400);
  });

  it('measures the solve time on the server, from Start to submission', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const { wrong } = await optionIds();

    clockTo(today(), 5);
    await start(cookies).expect(201);
    clockTo(today(), 5, 42_000);
    const res = await submit(cookies, wrong).expect(200);

    expect(res.body.result.solveTimeMs).toBe(42_000);
  });

  it('never creates a second attempt, however many times or ways it is submitted', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const { correct, wrong } = await optionIds();
    await start(cookies).expect(201);

    const first = await submit(cookies, wrong).expect(200);
    expect(first.body.alreadySubmitted).toBe(false);
    expect(first.body.result.isCorrect).toBe(false);

    // A retry, then a "better" answer, then three at once.
    const retry = await submit(cookies, wrong).expect(200);
    expect(retry.body.alreadySubmitted).toBe(true);
    const better = await submit(cookies, correct).expect(200);
    expect(better.body.alreadySubmitted).toBe(true);
    expect(better.body.result.isCorrect).toBe(false);
    await Promise.all([submit(cookies, correct), submit(cookies, correct), submit(cookies, correct)]);

    expect(await DailyChallengeAttempt.countDocuments({})).toBe(1);
  });

  it('refuses an answer after midnight, and records the day as not submitted', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const day = today();
    const { correct } = await optionIds();

    clockTo(day, 23, 59 * 60 * 1000);
    await start(cookies).expect(201);
    // 00:00:00 IST the next day.
    clockTo(day, 24);
    const late = await submit(cookies, correct);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/closed at midnight/);
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(0);

    const record = await history(cookies).expect(200);
    expect(record.body.attempts[0]).toMatchObject({ day, status: 'not-submitted', xpAwarded: 0 });
  });
});

// ===========================================================================
// The answer key
// ===========================================================================

describe('the answer key', () => {
  const FORBIDDEN_BEFORE_REVEAL = ['"correctOptionId"', '"correctOptionKey"', '"correctOptionText"', '"solution"', '"isCorrect":true', '"key"'];

  function expectNoKey(label: string, body: unknown): void {
    const text = JSON.stringify(body);
    for (const forbidden of FORBIDDEN_BEFORE_REVEAL) {
      expect(text, `${label} leaked ${forbidden}`).not.toContain(forbidden);
    }
    expect(text, `${label} leaked the solution`).not.toContain('Factorise as');
  }

  it('is absent from every response before the reveal, and present after it', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const { correct, wrong } = await optionIds();
    const day = today();
    clockTo(day, 10);

    expectNoKey('GET before Start', (await getQuiz(cookies)).body);
    expectNoKey('Start', (await start(cookies)).body);
    expectNoKey('GET in progress', (await getQuiz(cookies)).body);
    expectNoKey('submit', (await submit(cookies, wrong)).body);
    expectNoKey('GET submitted', (await getQuiz(cookies)).body);
    expectNoKey('history', (await history(cookies)).body);
    expectNoKey('public info', (await request(app).get(`${API}/daily-quiz/info`)).body);
    expectNoKey('public winners', (await request(app).get(`${API}/daily-quiz/winners`)).body);

    // One second before midnight it is still locked; at midnight it opens.
    clockTo(day, 24, -1000);
    expectNoKey('history at 23:59:59', (await history(cookies)).body);

    clockTo(day, 24);
    const after = await history(cookies).expect(200);
    const row = after.body.attempts[0];
    expect(row.revealed).toBe(true);
    expect(row.reveal.correctOptionId).toBe(correct);
    expect(row.reveal.solution).toBe(SOLUTION);
    expect(row.selectedOptionId).toBe(wrong);
    expect(row.isCorrect).toBe(false);
  });

  it('keeps the bank’s copy out of practice until the reveal', async () => {
    const { adminCookies, questionId } = await seedTodaysQuiz();
    const publish = () =>
      request(app)
        .patch(`${API}/admin/questions/${questionId}/status`)
        .set('Cookie', cookieHeader(adminCookies))
        .send({ status: 'published' });

    const early = await publish();
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/Daily Quiz/);

    clockTo(today(), 24);
    expect((await publish()).status).toBe(200);
  });

  it('refuses to delete a question a quiz was set from', async () => {
    const { adminCookies, questionId } = await seedTodaysQuiz();
    const res = await request(app).delete(`${API}/admin/questions/${questionId}`).set('Cookie', cookieHeader(adminCookies));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Daily Quiz/);
  });
});

// ===========================================================================
// XP and the streak
// ===========================================================================

describe('XP', () => {
  it(`pays ${XP_AWARDS.daily_challenge_completed} XP for a correct answer, once`, async () => {
    expect(XP_AWARDS.daily_challenge_completed).toBe(20);
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const { correct } = await optionIds();
    await start(cookies).expect(201);

    const res = await submit(cookies, correct).expect(200);
    expect(res.body.xpAwarded).toBe(20);
    expect(res.body.result.isCorrect).toBe(true);
    await submit(cookies, correct).expect(200);

    const rows = await StudentActivity.find({ type: 'daily_challenge_completed' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.xpAwarded).toBe(20);
  });

  it('pays nothing for a wrong answer, but still counts the day toward the streak', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const { wrong } = await optionIds();
    await start(cookies).expect(201);

    const res = await submit(cookies, wrong).expect(200);
    expect(res.body.xpAwarded).toBe(0);
    expect(await StudentActivity.countDocuments({ type: 'daily_challenge_completed' })).toBe(0);
    expect(res.body.streak.current).toBe(1);
  });

  it('with instant results off, says nothing until the reveal and pays then', async () => {
    const { adminCookies } = await seedTodaysQuiz();
    const settings = await request(app).get(`${API}/admin/daily-quiz/settings`).set('Cookie', cookieHeader(adminCookies)).expect(200);
    const { updatedAt: _updatedAt, updatedByLabel: _updatedByLabel, ...editable } = settings.body.settings;
    await request(app)
      .put(`${API}/admin/daily-quiz/settings`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ ...editable, instantResult: false })
      .expect(200);

    const { cookies } = await registerVerifyLogin(app);
    const { correct } = await optionIds();
    const day = today();
    clockTo(day, 8);
    await start(cookies).expect(201);
    const res = await submit(cookies, correct).expect(200);
    expect(res.body.result.isCorrect).toBeNull();
    expect(res.body.result.xpPending).toBe(true);
    expect(res.body.xpAwarded).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain('"isCorrect":true');
    expect(await StudentActivity.countDocuments({ type: 'daily_challenge_completed' })).toBe(0);

    clockTo(day, 25);
    await getQuiz(cookies).expect(200);
    const paid = await StudentActivity.findOne({ type: 'daily_challenge_completed' });
    expect(paid?.xpAwarded).toBe(20);
    // Filed under the day it was earned, not the day it was paid.
    expect(paid?.occurredOn).toBe(day);

    const record = await history(cookies).expect(200);
    expect(record.body.attempts[0]).toMatchObject({ isCorrect: true, xpAwarded: 20, xpPending: false });
  });
});

// ===========================================================================
// Achievements — reached only through the reward engine's facts
// ===========================================================================

describe('achievements', () => {
  const dashboard = (cookies: Record<string, string>) =>
    request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies)).expect(200);

  it('earns the first-quiz achievement from a real submission', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const earned = async () =>
      (await dashboard(cookies)).body.dashboard.achievements.earned.some((a: { code: string }) => a.code === 'challenge_first');

    expect(await earned()).toBe(false);
    const { correct } = await optionIds();
    await start(cookies).expect(201);
    await submit(cookies, correct).expect(200);
    expect(await earned()).toBe(true);
  });

  it('shows the five-day streak as genuine progress, counted from submitted days', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const { correct } = await optionIds();
    await start(cookies).expect(201);
    await submit(cookies, correct).expect(200);

    // Two earlier consecutive days, planted — a start alone would not count.
    const attempt = await DailyChallengeAttempt.findOne({});
    for (const back of [1, 2]) {
      await DailyChallengeAttempt.create({
        challenge: attempt!.challenge,
        student: attempt!.student,
        day: shiftDay(today(), back),
        answer: attempt!.answer,
        xpAwarded: 0,
        submittedAt: new Date(),
      });
    }

    const res = await dashboard(cookies);
    const all = [...res.body.dashboard.achievements.earned, ...res.body.dashboard.achievements.next];
    const streak = all.find((a: { code: string }) => a.code === 'challenge_streak_5');
    expect(streak).toMatchObject({ progress: 3, target: 5, earned: false });
  });
});

// ===========================================================================
// History
// ===========================================================================

describe('history', () => {
  it('lists the student’s own days with a summary, newest first, locked until the reveal', async () => {
    await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const other = await registerVerifyLogin(app, otherStudent);
    const { correct } = await optionIds();
    await start(cookies).expect(201);
    await submit(cookies, correct).expect(200);

    const mine = await history(cookies).expect(200);
    expect(mine.headers['cache-control']).toBe('private, no-store');
    expect(mine.body.attempts).toHaveLength(1);
    expect(mine.body.attempts[0]).toMatchObject({ status: 'submitted', isCorrect: true, revealed: false, reveal: null, won: false });
    expect(mine.body.summary).toMatchObject({ attempted: 1, correct: 1, accuracy: 100, currentStreak: 1, wins: 0 });

    const theirs = await history(other.cookies).expect(200);
    expect(theirs.body.attempts).toHaveLength(0);
    expect(theirs.body.summary).toMatchObject({ attempted: 0, correct: 0, accuracy: null });
  });
});

// ===========================================================================
// Scheduling (staff)
// ===========================================================================

describe('scheduling', () => {
  it('refuses two quizzes for one class on one day, and allows the next day', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const a = await draftQuestion(adminCookies, taxonomy);
    const b = await draftQuestion(adminCookies, taxonomy, { questionText: 'What is $7 \\times 8$?', options: [
      { text: '54', isCorrect: false },
      { text: '56', isCorrect: true },
      { text: '58', isCorrect: false },
      { text: '64', isCorrect: false },
    ], solution: '$7 \\times 8 = 56$.', classLevel: 'Class 12' });

    await schedule(adminCookies, { day: today(), classMin: 9, classMax: 12, questionId: a }).expect(201);
    const overlap = await schedule(adminCookies, { day: today(), classMin: 12, classMax: 12, questionId: b });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error).toMatch(/Class 12 already has a Daily Quiz/);

    await schedule(adminCookies, { day: shiftDay(today(), -1), classMin: 12, classMax: 12, questionId: b }).expect(201);
  });

  it('refuses the past, a published question, a class outside the range and a question used on another day', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const draft = await draftQuestion(adminCookies, taxonomy);

    expect((await schedule(adminCookies, { day: shiftDay(today(), 1), classMin: 9, classMax: 12, questionId: draft })).status).toBe(400);
    expect((await schedule(adminCookies, { day: today(), classMin: 3, classMax: 5, questionId: draft })).body.error).toMatch(/outside/);

    const published = await draftQuestion(adminCookies, taxonomy, { questionText: 'What is $2 + 2$?' });
    await request(app)
      .patch(`${API}/admin/questions/${published}/status`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ status: 'published' })
      .expect(200);
    const refusedPublished = await schedule(adminCookies, { day: today(), classMin: 9, classMax: 12, questionId: published });
    expect(refusedPublished.status).toBe(409);
    expect(refusedPublished.body.error).toMatch(/published for practice/);

    await schedule(adminCookies, { day: today(), classMin: 9, classMax: 12, questionId: draft }).expect(201);
    const reused = await schedule(adminCookies, { day: shiftDay(today(), -2), classMin: 9, classMax: 12, questionId: draft });
    expect(reused.status).toBe(409);
    expect(reused.body.error).toMatch(/one day only/);
  });

  it('offers only questions that can be a quiz for the range, and none already used', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const usable = await draftQuestion(adminCookies, taxonomy);
    const wrongClass = await draftQuestion(adminCookies, taxonomy, { questionText: 'What is $4 + 4$?', classLevel: 'Class 4' });
    const published = await draftQuestion(adminCookies, taxonomy, { questionText: 'What is $5 + 5$?' });
    await request(app)
      .patch(`${API}/admin/questions/${published}/status`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ status: 'published' })
      .expect(200);

    const candidates = async () =>
      (
        await request(app)
          .get(`${API}/admin/daily-quiz/candidates?classMin=9&classMax=12`)
          .set('Cookie', cookieHeader(adminCookies))
          .expect(200)
      ).body.candidates.map((candidate: { id: string }) => candidate.id)

    expect(await candidates()).toEqual([usable]);
    expect(await candidates()).not.toContain(wrongClass);

    await schedule(adminCookies, { day: today(), classMin: 9, classMax: 12, questionId: usable }).expect(201);
    expect(await candidates()).toEqual([]);
  });

  it('can change or remove a quiz until somebody starts it, and not after', async () => {
    const { adminCookies, taxonomy, groupId } = await seedTodaysQuiz();
    const replacement = await draftQuestion(adminCookies, taxonomy, { questionText: 'What is $3^3$?', options: [
      { text: '9', isCorrect: false },
      { text: '27', isCorrect: true },
      { text: '81', isCorrect: false },
    ], solution: '$3^3 = 27$.' });

    await request(app)
      .put(`${API}/admin/daily-quiz/${groupId}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ questionId: replacement })
      .expect(200);

    const { cookies } = await registerVerifyLogin(app);
    await start(cookies).expect(201);

    const change = await request(app)
      .put(`${API}/admin/daily-quiz/${groupId}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ questionId: replacement });
    expect(change.status).toBe(409);
    const remove = await request(app).delete(`${API}/admin/daily-quiz/${groupId}`).set('Cookie', cookieHeader(adminCookies));
    expect(remove.status).toBe(409);
  });

  it('plans a bulk schedule without writing, then writes it on confirmation', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const ids = [
      await draftQuestion(adminCookies, taxonomy),
      await draftQuestion(adminCookies, taxonomy, { questionText: 'What is $6 \\times 7$?', options: [
        { text: '42', isCorrect: true },
        { text: '48', isCorrect: false },
      ], solution: '$6 \\times 7 = 42$.' }),
    ];
    const body = { classMin: 9, classMax: 12, startDay: shiftDay(today(), -1), questionIds: ids };

    const plan = await request(app).post(`${API}/admin/daily-quiz/bulk`).set('Cookie', cookieHeader(adminCookies)).send(body).expect(200);
    expect(plan.body.dryRun).toBe(true);
    expect(plan.body.rows.map((row: { day: string }) => row.day)).toEqual([shiftDay(today(), -1), shiftDay(today(), -2)]);
    expect(await DailyChallenge.countDocuments({})).toBe(0);

    const done = await request(app)
      .post(`${API}/admin/daily-quiz/bulk`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ ...body, dryRun: false })
      .expect(200);
    expect(done.body.scheduledCount).toBe(2);
    // One document per class in the range, per day.
    expect(await DailyChallenge.countDocuments({})).toBe(8);
  });

  it('shows the next fortnight and warns about a group with no quiz in the next three days', async () => {
    const { adminCookies } = await seedTodaysQuiz();
    const res = await request(app).get(`${API}/admin/daily-quiz`).set('Cookie', cookieHeader(adminCookies)).expect(200);
    expect(res.body.calendar.days).toHaveLength(14);
    expect(res.body.calendar.warnings.length).toBeGreaterThan(0);
    expect(res.body.quizzes[0].classRange.label).toBe('Classes 9–12');
  });

  it('shows a daily challenge from before the quiz as holding its day, and says so when scheduling over it', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const questionId = await draftQuestion(adminCookies, taxonomy);
    // A pre-Milestone-30 document: a class and a day, no snapshot.
    await DailyChallenge.create({ day: today(), classLevel: 'Class 9', question: questionId, source: 'automatic', marks: 4 });

    const list = await request(app).get(`${API}/admin/daily-quiz`).set('Cookie', cookieHeader(adminCookies)).expect(200);
    const day = list.body.calendar.days[0];
    expect(day.quizzes).toEqual([expect.objectContaining({ legacy: true, label: 'Class 9 · old challenge' })]);
    // Not counted as covering Class 9, so the gap warning still names it.
    expect(day.coveredClasses).toEqual([]);
    expect(list.body.calendar.warnings.find((w: { group: string }) => w.group === '9-12').missingClasses).toContain(9);

    const refused = await schedule(adminCookies, { day: today(), classMin: 9, classMax: 12, questionId });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/from before the Daily Quiz/);
  });

  it('records scheduling in the audit trail', async () => {
    await seedTodaysQuiz();
    expect(await AuditLog.countDocuments({ action: 'dailyquiz.scheduled' })).toBe(1);
  });

  it('refuses a student on every staff route, on both API prefixes', async () => {
    const { groupId } = await seedTodaysQuiz();
    const { cookies } = await registerVerifyLogin(app);
    const cookie = cookieHeader(cookies);

    for (const prefix of ['/api/v1', '/api']) {
      const responses = await Promise.all([
        request(app).get(`${prefix}/admin/daily-quiz`).set('Cookie', cookie),
        request(app).get(`${prefix}/admin/daily-quiz/settings`).set('Cookie', cookie),
        request(app).get(`${prefix}/admin/daily-quiz/winners`).set('Cookie', cookie),
        request(app).get(`${prefix}/admin/daily-quiz/candidates?classMin=9&classMax=12`).set('Cookie', cookie),
        request(app).get(`${prefix}/admin/daily-quiz/${groupId}`).set('Cookie', cookie),
        request(app).post(`${prefix}/admin/daily-quiz`).set('Cookie', cookie).send({}),
        request(app).post(`${prefix}/admin/daily-quiz/bulk`).set('Cookie', cookie).send({}),
        request(app).post(`${prefix}/admin/daily-quiz/${groupId}/winners/compute`).set('Cookie', cookie),
        request(app).delete(`${prefix}/admin/daily-quiz/${groupId}`).set('Cookie', cookie),
        request(app).post(`${prefix}/admin/daily-quiz/import/csv`).set('Cookie', cookie).send({}),
      ]);
      for (const res of responses) expect(res.status).toBe(403);
    }
  });
});

// ===========================================================================
// Winners
// ===========================================================================

describe('winners', () => {
  async function eligible(studentId: string): Promise<void> {
    await Student.updateOne({ studentId }, { $set: { city: 'Jaipur', guardianPhone: '9876500000' } });
  }

  it('ranks by the rule, waits for a person, and announces only what was published', async () => {
    const { adminCookies, groupId } = await seedTodaysQuiz();
    const admin = cookieHeader(adminCookies);
    const day = today();
    const { correct } = await optionIds();

    const fast = await registerVerifyLogin(app, { firstName: 'Asha', lastName: 'Verma', mobile: '9100000001', email: 'asha@example.com' });
    const slow = await registerVerifyLogin(app, { firstName: 'Ravi', lastName: 'Singh', mobile: '9100000002', email: 'ravi@example.com' });
    const fastest = await registerVerifyLogin(app, { firstName: 'Neel', lastName: 'Rao', mobile: '9100000003', email: 'neel@example.com' });
    await eligible(fast.studentId);
    await eligible(slow.studentId);
    // `fastest` has no city or guardian phone: quickest of all, and not eligible.

    clockTo(day, 6);
    await start(fast.cookies).expect(201);
    await start(slow.cookies).expect(201);
    await start(fastest.cookies).expect(201);
    clockTo(day, 6, 5_000);
    await submit(fastest.cookies, correct).expect(200);
    clockTo(day, 6, 12_000);
    await submit(fast.cookies, correct).expect(200);
    clockTo(day, 6, 70_000);
    await submit(slow.cookies, correct).expect(200);

    const compute = () => request(app).post(`${API}/admin/daily-quiz/${groupId}/winners/compute`).set('Cookie', admin);
    const early = await compute();
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/after midnight/);

    clockTo(day, 25);
    const computed = await compute().expect(200);
    expect(computed.body.correctCount).toBe(3);
    expect(computed.body.winners.map((row: { student: { name: string } }) => row.student.name)).toEqual([
      'Asha Kumar Verma',
      'Ravi Kumar Singh',
    ]);
    expect(computed.body.winners.every((row: { status: string }) => row.status === 'provisional')).toBe(true);
    expect(computed.body.winners[0].solveTimeMs).toBe(12_000);
    expect(computed.body.ineligible[0]).toMatchObject({ name: 'Neel Kumar Rao', missing: ['city', 'guardian-phone'] });

    // Nothing is public yet.
    expect((await request(app).get(`${API}/daily-quiz/winners`)).body.winners).toEqual([]);

    const action = (winnerId: string, name: string, body: Record<string, unknown> = {}) =>
      request(app).post(`${API}/admin/daily-quiz/winners/${winnerId}/${name}`).set('Cookie', admin).send(body);
    const [first, second] = computed.body.winners as Array<{ id: string }>;

    const confirmed = await action(first!.id, 'confirm').expect(200);
    expect(confirmed.body.winner.status).toBe('confirmed');
    expect(confirmed.body.winner.prizeText).toBeTruthy();
    expect(confirmed.body.winner.cashAmount).toBeNull();
    expect((await action(second!.id, 'confirm')).status).toBe(409);

    expect((await action(second!.id, 'disqualify')).status).toBe(400);
    await action(second!.id, 'disqualify', { reason: 'Shares an account with a sibling.' }).expect(200);

    // Contacting before publishing makes no sense, and is refused.
    expect((await action(first!.id, 'contacted')).status).toBe(409);
    await action(first!.id, 'publish').expect(200);

    const publicList = await request(app).get(`${API}/daily-quiz/winners`).expect(200);
    expect(publicList.body.winners).toEqual([
      { day, displayName: 'Asha V.', classLevel: 'Class 9', place: 'Jaipur', prizeText: confirmed.body.winner.prizeText },
    ]);
    expect(JSON.stringify(publicList.body)).not.toContain('9876500000');

    const notice = await Notification.findOne({ dedupeKey: `dailyquiz-winner:${first!.id}` });
    expect(notice?.title).toMatch(/You won the Daily Quiz/);

    const desk = () => request(app).get(`${API}/admin/daily-quiz/winners?view=outstanding`).set('Cookie', admin);
    expect((await desk().expect(200)).body.outstanding).toBe(1);
    await action(first!.id, 'contacted').expect(200);
    await action(first!.id, 'delivered').expect(200);
    expect((await desk()).body.outstanding).toBe(0);

    const record = await history(fast.cookies).expect(200);
    expect(record.body.attempts[0].won).toBe(true);
    expect(record.body.summary.wins).toBe(1);

    expect(await AuditLog.countDocuments({ action: 'dailyquiz.winner.published' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'dailyquiz.winner.disqualified' })).toBe(1);
  });

  it('shows a student who opted out of public lists as their class only', async () => {
    const { adminCookies, groupId } = await seedTodaysQuiz();
    const admin = cookieHeader(adminCookies);
    const { correct } = await optionIds();
    const winner = await registerVerifyLogin(app);
    await Student.updateOne(
      { studentId: winner.studentId },
      { $set: { city: 'Pune', guardianPhone: '9876500000', hideFromPublicLists: true } },
    );
    await start(winner.cookies).expect(201);
    await submit(winner.cookies, correct).expect(200);

    clockTo(today(), 25);
    const computed = await request(app).post(`${API}/admin/daily-quiz/${groupId}/winners/compute`).set('Cookie', admin).expect(200);
    const id = computed.body.winners[0].id as string;
    await request(app).post(`${API}/admin/daily-quiz/winners/${id}/confirm`).set('Cookie', admin).expect(200);
    await request(app).post(`${API}/admin/daily-quiz/winners/${id}/publish`).set('Cookie', admin).expect(200);

    const publicList = await request(app).get(`${API}/daily-quiz/winners`).expect(200);
    expect(publicList.body.winners[0]).toMatchObject({ displayName: 'A Class 9 student', place: null });
    expect(JSON.stringify(publicList.body)).not.toContain('Pune');
  });

  it('keeps every prize decision through a reset of the Daily Quiz', async () => {
    const { adminCookies, groupId } = await seedTodaysQuiz();
    const admin = cookieHeader(adminCookies);
    const { correct } = await optionIds();
    const winner = await registerVerifyLogin(app);
    await eligible(winner.studentId);
    await start(winner.cookies).expect(201);
    await submit(winner.cookies, correct).expect(200);
    clockTo(today(), 25);
    const computed = await request(app).post(`${API}/admin/daily-quiz/${groupId}/winners/compute`).set('Cookie', admin).expect(200);
    await request(app).post(`${API}/admin/daily-quiz/winners/${computed.body.winners[0].id}/confirm`).set('Cookie', admin).expect(200);

    await performReset('daily-challenges', 'test');

    expect(await DailyChallenge.countDocuments({})).toBe(0);
    expect(await DailyQuizStart.countDocuments({})).toBe(0);
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(0);
    const kept = await DailyQuizWinner.find({});
    expect(kept.map((row) => row.status)).toEqual(['confirmed']);

    const desk = await request(app).get(`${API}/admin/daily-quiz/winners?view=outstanding`).set('Cookie', admin).expect(200);
    expect(desk.body.winners[0]).toMatchObject({ status: 'confirmed', quizExists: false });
  });
});
