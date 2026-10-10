import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import {
  AuditLog,
  DailyChallenge,
  DailyChallengeAttempt,
  DailyQuizSettings,
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
import {
  API,
  TINY_JPEG_BASE64,
  TINY_PNG_BASE64,
  clearTestInbox,
  cookieHeader,
  createAdminSession,
  otherStudent,
  registerVerifyLogin,
} from './helpers/auth';
import { createQuestionVia, createTaxonomy, validQuestion, type Taxonomy } from './helpers/questions';

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
 *  4. **Winners are chosen by the rule and announced by a person** — one a month in each
 *     class band since 2026-10-09 (PLAN.md Q24).
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
// Noon IST on the real day, so no test can straddle a midnight it did not ask for.
beforeEach(() => clockTo(dayKeyOf(new Date()), 12));
// This file is about quizzes staff schedule, so the automatic quiz (2026-10-10, on by default)
// is switched off here; `dailyQuizAuto.test.ts` covers it.
beforeEach(async () => {
  await DailyQuizSettings.updateOne({ key: 'default' }, { $set: { autoSchedule: false } }, { upsert: true });
});
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
    expect((await request(app).post('/__e2e/rate-limits/reset')).status).toBe(404);
    expect((await request(app).post('/__e2e/clock').send({ advanceDays: 1 })).status).toBe(404);
    expect((await request(app).post('/__e2e/seed').send({})).status).toBe(404);
    expect((await request(app).get('/__e2e/last-link?to=someone@example.com')).status).toBe(404);
  });

  it('serves the public prize information without one, generated from the settings', async () => {
    const res = await request(app).get(`${API}/daily-quiz/info`).expect(200);
    expect(res.body.info.cashAmount).toBeNull();
    expect(res.body.info.xpForCorrect).toBe(XP_AWARDS.daily_challenge_completed);
    expect(res.body.info.howWinnersAreChosen).toMatch(/the most Daily Quizzes correctly/);
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
  it('with the automatic quiz off, says so honestly when nothing is scheduled, and never fills the day', async () => {
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
    expectNoKey('public today', (await request(app).get(`${API}/daily-quiz/today`)).body);
    expectNoKey('public past problems', (await request(app).get(`${API}/daily-quiz/past`)).body);
    expectNoKey('public archive', (await request(app).get(`${API}/daily-quiz/archive?group=9-12`)).body);
    // Paging "back" from a day after today must not reach today's quiz either.
    expectNoKey('public archive from the future', (await request(app).get(`${API}/daily-quiz/archive?group=9-12&before=2099-12-31`)).body);

    // One second before midnight it is still locked; at midnight it opens.
    clockTo(day, 24, -1000);
    expectNoKey('history at 23:59:59', (await history(cookies)).body);
    expectNoKey('public archive at 23:59:59', (await request(app).get(`${API}/daily-quiz/archive?group=9-12`)).body);

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
// The homepage's past problems (public)
// ===========================================================================

describe('GET /daily-quiz/past', () => {
  interface PastProblem {
    day: string;
    classRange: { min: number; max: number; label: string };
    questionText: string;
    options: Array<{ letter: string; text: string }>;
    answer: { letter: string; text: string };
    solution: string;
  }
  interface PastGroup {
    id: string;
    label: string;
    problems: PastProblem[];
  }

  const past = (query = '') => request(app).get(`${API}/daily-quiz/past${query}`);
  const group = (body: { groups: PastGroup[] }, id: string): PastGroup => body.groups.find((g) => g.id === id)!;
  const days = (body: { groups: PastGroup[] }, id: string): string[] => group(body, id).problems.map((p) => p.day);

  it('never serves today’s quiz — not one second before midnight — and serves it with its answer after', async () => {
    await seedTodaysQuiz();
    const day = today();

    const before = await past().expect(200);
    expect(before.body.groups.map((g: PastGroup) => [g.id, g.label])).toEqual([
      ['3-5', 'Classes 3–5'],
      ['6-8', 'Classes 6–8'],
      ['9-12', 'Classes 9–12'],
    ]);
    expect(before.body.groups.every((g: PastGroup) => g.problems.length === 0)).toBe(true);
    const text = JSON.stringify(before.body);
    expect(text).not.toContain('x^2 - 5x + 6');
    expect(text).not.toContain('Factorise as');

    clockTo(day, 24, -1000);
    expect(JSON.stringify((await past().expect(200)).body)).not.toContain('x^2 - 5x + 6');

    clockTo(day, 24);
    const after = await past().expect(200);
    const [problem] = group(after.body, '9-12').problems;
    expect(problem).toMatchObject({
      day,
      classRange: { min: 9, max: 12, label: 'Classes 9–12' },
      topic: 'Algebra',
      difficulty: 'Medium',
      solution: SOLUTION,
      answer: { text: '$x = 3$' },
    });
    // The letter names the right option in the order the page will draw them.
    expect(problem!.options.find((option) => option.letter === problem!.answer.letter)?.text).toBe('$x = 3$');
    expect(problem!.options.map((option) => option.letter)).toEqual(['A', 'B', 'C', 'D']);
    // Display letters only: no opaque id, no bank key, no per-option correctness.
    expect(JSON.stringify(problem)).not.toMatch(/"id"|"key"|"isCorrect"|"correctOption/);
    // A quiz for Classes 9–12 is nobody else's problem.
    expect(group(after.body, '3-5').problems).toEqual([]);
    expect(group(after.body, '6-8').problems).toEqual([]);
  });

  it('is public and cacheable, and keeps the same option order on every request', async () => {
    await seedTodaysQuiz();
    clockTo(today(), 24);

    const first = await past().expect(200);
    expect(first.headers['cache-control']).toContain('public');
    expect(first.headers['set-cookie']).toBeUndefined();
    const second = await past().expect(200);
    expect(group(second.body, '9-12').problems).toEqual(group(first.body, '9-12').problems);
  });

  it('lists one entry per quiz, newest first, under every class group it covers — never a future day', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const d0 = today();
    const d1 = shiftDay(d0, -1);
    const d2 = shiftDay(d0, -2);
    const d3 = shiftDay(d0, -3);
    const d4 = shiftDay(d0, -4);
    const set = async (day: string, classMin: number, classMax: number, classLevel: string) => {
      const questionId = await draftQuestion(adminCookies, taxonomy, { classLevel });
      await schedule(adminCookies, { day, classMin, classMax, questionId }).expect(201);
    };
    await set(d0, 6, 8, 'Class 7');
    await set(d1, 3, 12, 'Class 9'); // all classes: one quiz, ten documents
    await set(d2, 7, 7, 'Class 7');
    await set(d3, 6, 8, 'Class 6'); // today, once the clock moves
    await set(d4, 6, 8, 'Class 8'); // tomorrow

    clockTo(d3, 12);
    const res = await past().expect(200);
    expect(days(res.body, '6-8')).toEqual([d2, d1, d0]);
    expect(days(res.body, '3-5')).toEqual([d1]);
    expect(days(res.body, '9-12')).toEqual([d1]);
    expect(group(res.body, '6-8').problems.map((p) => p.classRange.label)).toEqual(['Class 7', 'All classes', 'Classes 6–8']);

    const limited = await past('?limit=2').expect(200);
    expect(days(limited.body, '6-8')).toEqual([d2, d1]);

    expect((await past('?limit=0')).status).toBe(400);
    expect((await past('?limit=15')).status).toBe(400);
  });

  it('skips a daily challenge from before the quiz, which has no question of its own to show', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const questionId = await draftQuestion(adminCookies, taxonomy);
    await DailyChallenge.create({ day: today(), classLevel: 'Class 9', question: questionId, source: 'automatic', marks: 4 });
    clockTo(today(), 24);

    const res = await past().expect(200);
    expect(group(res.body, '9-12').problems).toEqual([]);
  });
});

// ===========================================================================
// A picture question as the Daily Quiz (Phase 7b)
// ===========================================================================

describe('a picture question as the Daily Quiz', () => {
  /**
   * A picture's key is the permission to fetch it, so it is held to the answer key's rules: the
   * question's picture from Start (as the text is), the solution's only from the reveal — and the
   * quiz keeps the pictures it was scheduled with, whatever later happens to the bank question.
   */
  it('shows the picture from Start, its solution picture only from the reveal, and keeps both', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const upload = async (type: string, base64: string) =>
      (
        await request(app)
          .post(`${API}/admin/question-images`)
          .set('Cookie', cookieHeader(adminCookies))
          .send({ image: `data:${type};base64,${base64}` })
          .expect(201)
      ).body.image as { key: string; url: string };
    const picture = await upload('image/png', TINY_PNG_BASE64);
    const solutionPicture = await upload('image/jpeg', TINY_JPEG_BASE64);
    const questionId = await draftQuestion(adminCookies, taxonomy, {
      questionText: '',
      image: { key: picture.key, alt: 'A triangle with sides 3, 4 and 5' },
      solution: null,
      solutionImage: { key: solutionPicture.key },
    });
    const day = today();
    await schedule(adminCookies, { day, classMin: 9, classMax: 12, questionId }).expect(201);
    const { cookies } = await registerVerifyLogin(app);

    const before = JSON.stringify((await getQuiz(cookies).expect(200)).body);
    expect(before).not.toContain(picture.key);
    expect(before).not.toContain(solutionPicture.key);

    const started = await start(cookies).expect(201);
    expect(started.body.question.image).toEqual({ url: picture.url, alt: 'A triangle with sides 3, 4 and 5', width: 1, height: 1 });
    expect(JSON.stringify(started.body)).not.toContain(solutionPicture.key);

    const { correct } = await optionIds();
    const submitted = await submit(cookies, correct).expect(200);
    expect(JSON.stringify(submitted.body)).not.toContain(solutionPicture.key);
    expect(JSON.stringify((await history(cookies).expect(200)).body)).not.toContain(solutionPicture.key);

    // The bank question moves on to another picture; the quiz still shows the one it was set with.
    const replacement = await upload('image/png', TINY_PNG_BASE64);
    await request(app)
      .put(`${API}/admin/questions/${questionId}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(
        validQuestion(taxonomy, {
          questionText: '',
          image: { key: replacement.key, alt: 'Another picture' },
          solution: null,
          solutionImage: { key: solutionPicture.key },
        }),
      )
      .expect(200);

    clockTo(day, 24);
    const revealed = await history(cookies).expect(200);
    const row = JSON.stringify(revealed.body);
    expect(row).toContain(solutionPicture.url);
    expect(row).toContain(picture.url);
    expect(row).not.toContain(replacement.key);

    const archive = await request(app).get(`${API}/daily-quiz/archive?group=9-12`).expect(200);
    expect(archive.body.problems[0].image.url).toBe(picture.url);
    expect(archive.body.problems[0].solutionImage.url).toBe(solutionPicture.url);
  });
});

// ===========================================================================
// Today, for the Diwali hero's countdown (Phase 7)
// ===========================================================================

describe('GET /daily-quiz/today', () => {
  const todayPublic = () => request(app).get(`${API}/daily-quiz/today`);

  it('says whether a quiz is on and when today closes, by the server clock, and is never cached', async () => {
    clockTo(today(), 10);
    const none = await todayPublic().expect(200);
    expect(none.body.today).toEqual({
      day: today(),
      hasQuiz: false,
      closesAt: quizWindow(today()).closesAt.toISOString(),
      serverNow: now().toISOString(),
    });
    expect(none.headers['cache-control']).toBe('no-store');

    await seedTodaysQuiz();
    const on = await todayPublic().expect(200);
    expect(on.body.today.hasQuiz).toBe(true);
    // It names no question, option or answer.
    expect(JSON.stringify(on.body)).not.toContain('x^2 - 5x + 6');

    // A quiz on another day is not today's.
    clockTo(shiftDay(today(), -1), 10);
    expect((await todayPublic().expect(200)).body.today.hasQuiz).toBe(false);
  });
});

// ===========================================================================
// The public archive of past quizzes (Phase 7)
// ===========================================================================

describe('GET /daily-quiz/archive', () => {
  const archive = (query: string) => request(app).get(`${API}/daily-quiz/archive${query}`);
  const daysOf = (body: { problems: Array<{ day: string }> }) => body.problems.map((problem) => problem.day);

  it('pages one class group back a whole day at a time, and never reaches today', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const d0 = today();
    const after = (n: number) => shiftDay(d0, -n); // n days after d0
    const set = async (day: string, classMin: number, classMax: number, classLevel: string) => {
      const questionId = await draftQuestion(adminCookies, taxonomy, { classLevel });
      await schedule(adminCookies, { day, classMin, classMax, questionId }).expect(201);
    };
    await set(d0, 6, 8, 'Class 7');
    await set(after(1), 3, 12, 'Class 9'); // every class: one quiz, ten documents
    await set(after(2), 7, 7, 'Class 7');
    await set(after(2), 8, 8, 'Class 8'); // a second quiz on the same day, for another class
    await set(after(3), 6, 8, 'Class 6'); // today, once the clock moves
    await set(after(4), 6, 8, 'Class 8'); // tomorrow

    clockTo(after(3), 12);
    const first = await archive('?group=6-8&days=2').expect(200);
    expect(first.body.group).toEqual({ id: '6-8', label: 'Classes 6–8', min: 6, max: 8 });
    // Two days — and both of the second day's quizzes: a page is cut between days, never inside one.
    expect(daysOf(first.body)).toEqual([after(2), after(2), after(1)]);
    expect(first.body.problems.map((p: { classRange: { label: string } }) => p.classRange.label)).toEqual([
      'Class 7',
      'Class 8',
      'All classes',
    ]);
    expect(first.body.nextBefore).toBe(after(1));
    expect(first.headers['cache-control']).toContain('public');
    expect(first.headers['set-cookie']).toBeUndefined();

    const second = await archive(`?group=6-8&days=2&before=${first.body.nextBefore}`).expect(200);
    expect(daysOf(second.body)).toEqual([d0]);
    expect(second.body.nextBefore).toBeNull();

    // Asking to page back from a day after today starts from today, not from that day.
    const ahead = await archive(`?group=6-8&before=${after(9)}`).expect(200);
    expect(daysOf(ahead.body)).toEqual([after(2), after(2), after(1), d0]);

    // Another group sees only the quiz that covered it.
    expect(daysOf((await archive('?group=3-5').expect(200)).body)).toEqual([after(1)]);
  });

  it('refuses a class group, a page size or a day it does not know', async () => {
    expect((await archive('')).status).toBe(400);
    expect((await archive('?group=1-2')).status).toBe(400);
    expect((await archive('?group=6-8&days=0')).status).toBe(400);
    expect((await archive('?group=6-8&days=32')).status).toBe(400);
    expect((await archive('?group=6-8&before=2026-02-30')).status).toBe(400);
    expect((await archive('?group=6-8')).status).toBe(200);
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
        request(app).get(`${prefix}/admin/daily-quiz/monthly`).set('Cookie', cookie),
        request(app).post(`${prefix}/admin/daily-quiz/monthly/2026-11/9-10/compute`).set('Cookie', cookie),
        request(app).delete(`${prefix}/admin/daily-quiz/${groupId}`).set('Cookie', cookie),
        request(app).post(`${prefix}/admin/daily-quiz/import/csv`).set('Cookie', cookie).send({}),
      ]);
      for (const res of responses) expect(res.status).toBe(403);
    }
  });
});

// ===========================================================================
// Monthly winners — one a month in each class band (owner, 2026-10-09 — PLAN.md Q24)
// ===========================================================================

describe('monthly winners', () => {
  type Row = { id: string; status: string; period: string; label: string; correctCount: number; solveTimeMs: number; student: { name: string } };

  /** A student in a class, distinct by `n`. */
  function student(firstName: string, lastName: string, n: number, classLevel = 'Class 9') {
    return registerVerifyLogin(app, {
      firstName,
      lastName,
      classLevel,
      mobile: `91000000${String(n).padStart(2, '0')}`,
      email: `${firstName.toLowerCase()}@example.com`,
    });
  }

  /** What a winner needs beyond registering: a city and a parent or guardian's phone. */
  async function eligible(studentId: string): Promise<void> {
    await Student.updateOne({ studentId }, { $set: { city: 'Jaipur', guardianPhone: '9876500000' } });
  }

  /** A Classes 9–12 quiz on each day, from fresh drafts, scheduled the day before the first. */
  async function scheduleDays(days: string[]): Promise<{ admin: string }> {
    clockTo(shiftDay(days[0]!, 1), 12);
    const { adminCookies, taxonomy } = await seedAdmin();
    for (const day of days) {
      const questionId = await draftQuestion(adminCookies, taxonomy);
      await schedule(adminCookies, { day, classMin: 9, classMax: 12, questionId }).expect(201);
    }
    return { admin: cookieHeader(adminCookies) };
  }

  /** A day's correct and wrong option ids — the same in every class of a quiz. */
  async function optionsOn(day: string): Promise<{ correct: string; wrong: string }> {
    const content = (await DailyChallenge.findOne({ day }))!.content!;
    return {
      correct: content.options.find((option) => option.key === content.correctOptionKey)!.id,
      wrong: content.options.find((option) => option.key !== content.correctOptionKey)!.id,
    };
  }

  /** Starts at 06:00 IST on `day` and submits `ms` later — right, unless told otherwise. */
  async function answer(day: string, cookies: Record<string, string>, ms: number, right = true): Promise<void> {
    clockTo(day, 6);
    await start(cookies).expect(201);
    clockTo(day, 6, ms);
    const { correct, wrong } = await optionsOn(day);
    await submit(cookies, right ? correct : wrong).expect(200);
  }

  const compute = (admin: string, month: string, band: string) =>
    request(app).post(`${API}/admin/daily-quiz/monthly/${month}/${band}/compute`).set('Cookie', admin);
  const action = (admin: string, winnerId: string, name: string, body: Record<string, unknown> = {}) =>
    request(app).post(`${API}/admin/daily-quiz/winners/${winnerId}/${name}`).set('Cookie', admin).send(body);

  it('ranks each band’s month by correct answers, then total solve time, and waits for a person', async () => {
    const { admin } = await scheduleDays(['2026-11-10', '2026-11-11']);
    const asha = await student('Asha', 'Verma', 1);
    const ravi = await student('Ravi', 'Singh', 2);
    const neel = await student('Neel', 'Rao', 3, 'Class 10');
    const meera = await student('Meera', 'Iyer', 4, 'Class 11');
    await eligible(asha.studentId);
    await eligible(ravi.studentId);
    await eligible(meera.studentId);
    // Neel has no city and no guardian phone: as many right as anyone, the quickest, and not eligible.

    await answer('2026-11-10', asha.cookies, 12_000);
    await answer('2026-11-10', ravi.cookies, 70_000);
    await answer('2026-11-10', neel.cookies, 5_000);
    await answer('2026-11-10', meera.cookies, 20_000);
    await answer('2026-11-11', asha.cookies, 8_000, false);
    await answer('2026-11-11', ravi.cookies, 30_000);
    await answer('2026-11-11', neel.cookies, 5_000);

    // A student sees their own month's score, counted as the page shows correctness.
    expect((await history(ravi.cookies).expect(200)).body.summary.thisMonth).toEqual({
      month: '2026-11',
      label: 'November 2026',
      correct: 2,
    });

    // Not before the month is over, and never for a month before the prizes began.
    clockTo('2026-11-30', 23);
    const early = await compute(admin, '2026-11', '9-10');
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/once the month is over/);
    expect((await compute(admin, '2026-10', '9-10')).body.error).toMatch(/start with November 2026/);

    clockTo('2026-12-01', 1);
    const band = await compute(admin, '2026-11', '9-10').expect(200);
    expect(band.body).toMatchObject({ correctAnswers: 5, students: 3 });
    const rows = band.body.winners as Row[];
    expect(rows.map((row) => [row.student.name, row.correctCount, row.solveTimeMs])).toEqual([
      ['Ravi Kumar Singh', 2, 100_000],
      ['Asha Kumar Verma', 1, 12_000],
    ]);
    expect(rows.every((row) => row.status === 'provisional' && row.period === 'month' && row.label === 'Classes 9–10 · November 2026')).toBe(true);
    expect(band.body.ineligible[0]).toMatchObject({ name: 'Neel Kumar Rao', correctCount: 2, missing: ['city', 'guardian-phone'] });

    const upper = await compute(admin, '2026-11', '11-12').expect(200);
    expect((upper.body.winners as Row[]).map((row) => row.student.name)).toEqual(['Meera Kumar Iyer']);

    const page = await request(app).get(`${API}/admin/daily-quiz/monthly?month=2026-11`).set('Cookie', admin).expect(200);
    expect(page.body.monthly).toMatchObject({ month: '2026-11', label: 'November 2026', closed: true, countsFrom: '2026-11-08' });
    expect(page.body.monthly.bands.map((b: { id: string; winners: Row[] }) => [b.id, b.winners.length])).toEqual([
      ['3-5', 0],
      ['6-8', 0],
      ['9-10', 2],
      ['11-12', 1],
    ]);

    // Nothing is public yet.
    expect((await request(app).get(`${API}/daily-quiz/winners`)).body.winners).toEqual([]);

    const [first, second] = rows;
    const confirmed = await action(admin, first!.id, 'confirm').expect(200);
    expect(confirmed.body.winner).toMatchObject({ status: 'confirmed', cashAmount: null });
    expect(confirmed.body.winner.prizeText).toBeTruthy();
    const again = await action(admin, second!.id, 'confirm');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/Classes 9–10 already has its winner for November 2026/);
    // Another band's winner is another prize.
    await action(admin, (upper.body.winners as Row[])[0]!.id, 'confirm').expect(200);

    await action(admin, first!.id, 'publish').expect(200);
    const publicList = await request(app).get(`${API}/daily-quiz/winners`).expect(200);
    expect(publicList.body.winners).toEqual([
      {
        period: 'month',
        day: '2026-11-30',
        month: '2026-11',
        prizeLabel: 'November 2026 · Classes 9–10',
        displayName: 'Ravi S.',
        classLevel: 'Class 9',
        place: 'Jaipur',
        prizeText: confirmed.body.winner.prizeText,
      },
    ]);
    expect(JSON.stringify(publicList.body)).not.toContain('9876500000');

    const notice = await Notification.findOne({ dedupeKey: `dailyquiz-winner:${first!.id}` });
    expect(notice?.title).toBe('You won the Daily Quiz for November 2026!');
    expect(notice?.body).toMatch(/the most Daily Quizzes correctly in Classes 9–10 in November 2026/);

    // A month's prize was not won on one day: no day of the history says so; the summary counts it.
    const record = await history(ravi.cookies).expect(200);
    expect(record.body.attempts.some((row: { won: boolean }) => row.won)).toBe(false);
    expect(record.body.summary.wins).toBe(1);

    expect(await AuditLog.countDocuments({ action: 'dailyquiz.monthly.computed' })).toBe(2);
    expect(await AuditLog.countDocuments({ action: 'dailyquiz.winner.published' })).toBe(1);
  });

  it('counts November from the 8th, and each answer in the band of the class it was answered in', async () => {
    const { admin } = await scheduleDays(['2026-11-07', '2026-11-08', '2026-11-09']);
    const kiran = await student('Kiran', 'Das', 5, 'Class 10');
    await eligible(kiran.studentId);
    await answer('2026-11-07', kiran.cookies, 10_000); // before the launch: no prize counts it
    await answer('2026-11-08', kiran.cookies, 10_000);
    // Moved up a class mid-month: the next answer is a Class 11 answer.
    await Student.updateOne({ studentId: kiran.studentId }, { $set: { classLevel: 'Class 11' } });
    await answer('2026-11-09', kiran.cookies, 10_000);

    clockTo('2026-12-01', 1);
    const lower = await compute(admin, '2026-11', '9-10').expect(200);
    expect((lower.body.winners as Row[]).map((row) => row.correctCount)).toEqual([1]);
    const upper = await compute(admin, '2026-11', '11-12').expect(200);
    expect((upper.body.winners as Row[]).map((row) => row.correctCount)).toEqual([1]);

    // A quiz's staff page names the prize its answers count towards — none before the launch.
    const pageOf = async (day: string) => {
      const groupId = String((await DailyChallenge.findOne({ day }))!.groupId);
      return (await request(app).get(`${API}/admin/daily-quiz/${groupId}`).set('Cookie', admin).expect(200)).body;
    };
    expect((await pageOf('2026-11-07')).prizeMonth).toBeNull();
    expect((await pageOf('2026-11-08')).prizeMonth).toEqual({ month: '2026-11', label: 'November 2026' });
  });

  it('never offers a member of staff a prize, however many they answered (owner, 2026-10-10)', async () => {
    const { admin } = await scheduleDays(['2026-11-10']);
    const staff = await student('Sunil', 'Staff', 1);
    const pupil = await student('Asha', 'Verma', 2);
    await eligible(staff.studentId);
    await eligible(pupil.studentId);
    await answer('2026-11-10', staff.cookies, 3_000);
    await answer('2026-11-10', pupil.cookies, 40_000);
    // Promoted after answering: what counts is the role when the prize is decided.
    await Student.updateOne({ studentId: staff.studentId }, { $set: { role: 'admin' } });

    clockTo('2026-12-01', 1);
    const band = await compute(admin, '2026-11', '9-10').expect(200);
    expect((band.body.winners as Row[]).map((row) => row.student.name)).toEqual(['Asha Kumar Verma']);
    expect(JSON.stringify(band.body.ineligible)).not.toContain('Sunil');
  });

  it('shows a winner who opted out of public lists as their class only', async () => {
    const { admin } = await scheduleDays(['2026-11-12']);
    const winner = await student('Tara', 'Shah', 6);
    await Student.updateOne(
      { studentId: winner.studentId },
      { $set: { city: 'Pune', guardianPhone: '9876500000', hideFromPublicLists: true } },
    );
    await answer('2026-11-12', winner.cookies, 15_000);

    clockTo('2026-12-01', 1);
    const id = ((await compute(admin, '2026-11', '9-10').expect(200)).body.winners as Row[])[0]!.id;
    await action(admin, id, 'confirm').expect(200);
    await action(admin, id, 'publish').expect(200);

    const publicList = await request(app).get(`${API}/daily-quiz/winners`).expect(200);
    expect(publicList.body.winners[0]).toMatchObject({
      displayName: 'A Class 9 student',
      place: null,
      prizeLabel: 'November 2026 · Classes 9–10',
    });
    expect(JSON.stringify(publicList.body)).not.toContain('Pune');
  });

  it('keeps every prize decision through a reset of the Daily Quiz', async () => {
    const { admin } = await scheduleDays(['2026-11-12']);
    const winner = await student('Tara', 'Shah', 6);
    await eligible(winner.studentId);
    await answer('2026-11-12', winner.cookies, 15_000);
    clockTo('2026-12-01', 1);
    const id = ((await compute(admin, '2026-11', '9-10').expect(200)).body.winners as Row[])[0]!.id;
    await action(admin, id, 'confirm').expect(200);

    await performReset('daily-challenges', 'test');

    expect(await DailyChallengeAttempt.countDocuments({})).toBe(0);
    expect((await DailyQuizWinner.find({})).map((row) => row.status)).toEqual(['confirmed']);
    const desk = await request(app).get(`${API}/admin/daily-quiz/winners?view=outstanding`).set('Cookie', admin).expect(200);
    expect(desk.body.winners[0]).toMatchObject({
      status: 'confirmed',
      period: 'month',
      label: 'Classes 9–10 · November 2026',
      quizExists: true,
    });
  });

  it('opens on the last month that has ended, and has no page for a month outside the prizes', async () => {
    const { adminCookies } = await seedAdmin();
    const admin = cookieHeader(adminCookies);
    clockTo('2026-12-15', 12);

    const page = await request(app).get(`${API}/admin/daily-quiz/monthly`).set('Cookie', admin).expect(200);
    expect(page.body.monthly).toMatchObject({ month: '2026-11', closed: true });
    expect(page.body.monthly.months.map((m: { key: string }) => m.key)).toEqual(['2026-11', '2026-12']);

    expect((await request(app).get(`${API}/admin/daily-quiz/monthly?month=2026-10`).set('Cookie', admin)).status).toBe(404);
    expect((await request(app).get(`${API}/admin/daily-quiz/monthly?month=2027-01`).set('Cookie', admin)).status).toBe(404);
    expect((await request(app).get(`${API}/admin/daily-quiz/monthly?month=2026-13`).set('Cookie', admin)).status).toBe(400);
    expect((await compute(admin, '2026-11', '9-12')).status).toBe(400);
  });

  it('retires the daily rule: the public information, the settings and the old headline', async () => {
    const info = (await request(app).get(`${API}/daily-quiz/info`).expect(200)).body.info;
    expect(info).toMatchObject({ period: 'month', winnersPerBand: 1, prizesFrom: '2026-11-08', prizeHeadline: 'Solve daily. Win every month.' });
    expect(info.bands.map((band: { label: string }) => band.label)).toEqual(['Classes 3–5', 'Classes 6–8', 'Classes 9–10', 'Classes 11–12']);
    expect(info.howWinnersAreChosen).toMatch(/the most Daily Quizzes correctly/);
    expect(info).not.toHaveProperty('winnerRule');

    // A document saved before the change still says "Win daily": it is read as today's headline.
    await DailyQuizSettings.updateOne({ key: 'default' }, { $set: { prizeHeadline: 'Solve daily. Win daily.', prizeText: 'A medal' } }, { upsert: true });
    expect((await request(app).get(`${API}/daily-quiz/info`)).body.info).toMatchObject({
      prizeHeadline: 'Solve daily. Win every month.',
      prizeText: 'A medal',
    });

    // The settings no longer take a winner rule: a request still sending one has it dropped.
    const { adminCookies } = await seedAdmin();
    const saved = await request(app)
      .put(`${API}/admin/daily-quiz/settings`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ prizeHeadline: 'Win every month', prizeText: 'A medal', cashAmount: null, instantResult: true, winnerRule: 'FIRST_CORRECT', winnersPerQuiz: 3 })
      .expect(200);
    expect(saved.body.settings).not.toHaveProperty('winnerRule');
    expect(saved.body.settings.prizeHeadline).toBe('Win every month');
  });
});
