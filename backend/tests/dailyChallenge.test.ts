import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { DailyChallenge, DailyChallengeAttempt, Student, StudentActivity } from '../src/models';
import { XP_AWARDS } from '../src/lib/xp';
import { dayKeyOf, shiftDay, todayKey } from '../src/lib/competitionDay';
import { challengeStreakOf } from '../src/services/dailyChallengeService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  clearTestInbox,
  cookieHeader,
  createAdminSession,
  otherStudent,
  registerVerifyLogin,
} from './helpers/auth';
import { createPublishedQuestion, createQuestionVia, createTaxonomy, type Taxonomy } from './helpers/questions';

/**
 * Milestone 8 — the Daily Challenge.
 *
 * Four properties dominate this suite, and each is the sort of thing that is either
 * true in the database or merely hoped for in a handler:
 *
 * **1. One reward per competition day.** Asserted by submitting twice and counting both
 * the attempts and the `StudentActivity` rows — the reward is guarded by two
 * independent unique indexes, and the test checks the *effect* rather than either
 * mechanism.
 *
 * **2. The day boundary is IST.** Tested as arithmetic on the day-key functions (where
 * the boundary can be named exactly) *and* through the API, by planting an attempt on
 * an adjacent day and showing that today's is still allowed.
 *
 * **3. A day's challenge is pinned.** Publishing more questions after a day has been
 * served must not change what that day's question is — which is precisely what the
 * pre-Milestone-8 implementation got wrong.
 *
 * **4. The answer key stays server-side until the student has answered.** Whole response
 * bodies are stringified and required not to contain the forbidden names, the same
 * technique the practice and mock-test suites use.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** Names that would give the answer away before the student has answered. */
const FORBIDDEN_BEFORE_ANSWERING = [
  'isCorrect',
  'correctOptionKeys',
  'correctAnswer',
  'booleanAnswer',
  'numericAnswer',
  'tolerance',
  'solution',
  'explanation',
  'awardedMarks',
];

async function seedBank(
  overridesList: Array<Record<string, unknown>> = [{}],
): Promise<{ adminCookies: Record<string, string>; taxonomy: Taxonomy; questionIds: string[] }> {
  const { cookies: adminCookies } = await createAdminSession(app, {
    firstName: 'Author',
    lastName: 'Admin',
    mobile: '9000000001',
    email: 'author@example.com',
  });
  const taxonomy = await createTaxonomy(app, adminCookies);
  const questionIds: string[] = [];
  for (const overrides of overridesList) {
    const created = await createPublishedQuestion(app, adminCookies, taxonomy, overrides);
    questionIds.push(created.id);
  }
  return { adminCookies, taxonomy, questionIds };
}

async function getToday(cookies: Record<string, string>): Promise<request.Response> {
  return request(app).get(`${API}/me/daily-challenge`).set('Cookie', cookieHeader(cookies));
}

async function answer(
  cookies: Record<string, string>,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app).post(`${API}/me/daily-challenge/answer`).set('Cookie', cookieHeader(cookies)).send(body);
}

async function schedule(
  adminCookies: Record<string, string>,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app).post(`${API}/admin/daily-challenges`).set('Cookie', cookieHeader(adminCookies)).send(body);
}

// ===========================================================================
// The day boundary
// ===========================================================================

describe('the competition day boundary', () => {
  it('files an instant just after IST midnight under the new day, not the UTC one', () => {
    // 18:35 UTC on the 11th is 00:05 IST on the 12th. A UTC-based day would file this
    // under the 11th and cost the student a day of their streak.
    expect(dayKeyOf(new Date('2026-08-11T18:35:00.000Z'))).toBe('2026-08-12');
    // One minute earlier is still the 11th in IST (23:59 IST).
    expect(dayKeyOf(new Date('2026-08-11T18:29:00.000Z'))).toBe('2026-08-11');
  });

  it('does not depend on the host timezone', () => {
    // The same instant expressed two ways — an ISO string and its epoch milliseconds —
    // must produce the same key. `dayKeyOf` reads the *UTC* parts of a shifted instant
    // precisely so the host's own zone (UTC on Vercel, something else on a laptop)
    // cannot change the answer.
    const instant = new Date('2026-08-11T18:35:00.000Z');
    expect(dayKeyOf(new Date(instant.getTime()))).toBe(dayKeyOf(instant));
    expect(dayKeyOf(instant)).toBe('2026-08-12');
  });

  it('counts a challenge streak in whole IST days, alive while yesterday still counts', () => {
    const today = '2026-08-12';

    expect(challengeStreakOf([], today)).toEqual({ current: 0, longest: 0 });
    // Answered today only.
    expect(challengeStreakOf(['2026-08-12'], today)).toEqual({ current: 1, longest: 1 });
    // Three consecutive days ending today.
    expect(challengeStreakOf(['2026-08-10', '2026-08-11', '2026-08-12'], today)).toEqual({ current: 3, longest: 3 });
    // Ending *yesterday* — still alive, because today is not lost until it passes.
    expect(challengeStreakOf(['2026-08-10', '2026-08-11'], today)).toEqual({ current: 2, longest: 2 });
    // A gap ends the current run but not the record of the longest.
    expect(challengeStreakOf(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-11'], today)).toEqual({
      current: 1,
      longest: 3,
    });
    // Nothing recent at all: no current streak, longest preserved.
    expect(challengeStreakOf(['2026-08-01', '2026-08-02'], today)).toEqual({ current: 0, longest: 2 });
  });

  it('lets a student answer again once the IST day has turned', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);

    // Yesterday's attempt, planted directly so no clock has to be faked.
    const first = await getToday(cookies);
    expect(first.status).toBe(200);
    await answer(cookies, { selectedOptionKeys: ['a'] });

    // **Both** guards have to be moved, because they are keyed independently: the
    // attempt on its own `day`, and the XP on the activity row's `occurredOn` +
    // `dedupeKey`. Moving only one would test a half-turned day that cannot happen.
    const yesterday = shiftDay(todayKey(), 1);
    await DailyChallengeAttempt.updateOne({}, { $set: { day: yesterday } });
    await StudentActivity.updateOne(
      { type: 'daily_challenge_completed' },
      { $set: { occurredOn: yesterday, dedupeKey: yesterday } },
    );

    // Today is a different competition day, so today's challenge is answerable — the
    // unique index is on {student, day}, not on {student}.
    const second = await answer(cookies, { selectedOptionKeys: ['a'] });
    expect(second.status).toBe(200);
    expect(second.body.alreadyAnswered).toBe(false);
    expect(second.body.xpAwarded).toBe(XP_AWARDS.daily_challenge_completed);

    const days = await DailyChallengeAttempt.distinct('day', {});
    expect(days.sort()).toEqual([yesterday, todayKey()].sort());
    expect(second.body.streak.current).toBe(2);
  });
});

// ===========================================================================
// Serving today's challenge
// ===========================================================================

describe('today’s challenge', () => {
  it('pins the day’s question so publishing more questions cannot change it', async () => {
    const { adminCookies, taxonomy } = await seedBank([{ questionText: 'The pinned one?' }]);
    const { cookies } = await registerVerifyLogin(app);

    const first = await getToday(cookies);
    const pinnedId = first.body.challenge.question.id;

    // Ten more published questions for the same class. The old implementation chose by
    // `hash(day) % count`, so this alone changed today's question for everybody.
    for (let i = 0; i < 10; i += 1) {
      await createPublishedQuestion(app, adminCookies, taxonomy, { questionText: `Filler question ${i}?` });
    }

    const second = await getToday(cookies);
    expect(second.body.challenge.question.id).toBe(pinnedId);
    expect(await DailyChallenge.countDocuments({})).toBe(1);
  });

  /**
   * The automatic pick is scoped to the implicit subject for the reason practice is — but it matters
   * more here, because a challenge is **pinned** once served. An unscoped pick would not be one
   * student's odd session; it would stand as the whole class's record for that day.
   *
   * Eleven Physics questions against one mathematics one, so an unscoped pick would land on Physics
   * with high probability rather than by luck of the seed.
   */
  it('never picks another subject’s question as the day’s maths challenge', async () => {
    const { adminCookies } = await seedBank([{ questionText: 'The only maths one?' }]);
    const physics = await createTaxonomy(app, adminCookies, {
      subject: 'Physics',
      topic: 'Semiconductor Electronics',
    });
    for (let i = 0; i < 11; i += 1) {
      await createPublishedQuestion(app, adminCookies, physics, { questionText: `Physics filler ${i}?` });
    }

    const { cookies } = await registerVerifyLogin(app);
    const today = await getToday(cookies);

    expect(today.status).toBe(200);
    expect(today.body.challenge.question.questionText).toBe('The only maths one?');
  });

  it('serves the same pinned question to every student in the class', async () => {
    await seedBank([{}, {}, {}, {}, {}]);
    const { cookies: a } = await registerVerifyLogin(app);
    const { cookies: b } = await registerVerifyLogin(app, otherStudent);

    const first = await getToday(a);
    const second = await getToday(b);

    expect(second.body.challenge.question.id).toBe(first.body.challenge.question.id);
    expect(second.body.challenge.day).toBe(first.body.challenge.day);
    // One document for the day, even though two students resolved it.
    expect(await DailyChallenge.countDocuments({})).toBe(1);
  });

  it('creates exactly one challenge when two students arrive at the same moment', async () => {
    await seedBank([{}, {}, {}]);
    const { cookies: a } = await registerVerifyLogin(app);
    const { cookies: b } = await registerVerifyLogin(app, otherStudent);

    const [first, second] = await Promise.all([getToday(a), getToday(b)]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await DailyChallenge.countDocuments({})).toBe(1);
    expect(second.body.challenge.question.id).toBe(first.body.challenge.question.id);
  });

  it('never includes the answer key before the student has answered', async () => {
    const { adminCookies, taxonomy } = await seedBank([]);
    await createPublishedQuestion(app, adminCookies, taxonomy, {
      questionText: 'Give $\\pi$ to two places.',
      type: 'numeric',
      options: [],
      numericAnswer: 3.14,
      tolerance: 0.01,
      solution: 'Pi is about $3.14$.',
    });
    const { cookies } = await registerVerifyLogin(app);

    const res = await getToday(cookies);

    expect(res.body.challenge).not.toBeNull();
    expect(res.body.attempt).toBeNull();
    const body = JSON.stringify(res.body);
    for (const name of FORBIDDEN_BEFORE_ANSWERING) {
      expect(body, `daily challenge leaked ${name}`).not.toContain(name);
    }
    expect(body).not.toContain('3.14');
    expect(body).not.toContain('Pi is about');
  });

  it('reports no challenge rather than inventing one when nothing is published', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await getToday(cookies);

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeNull();
    expect(res.body.reason).toBe('none-published');
    expect(await DailyChallenge.countDocuments({})).toBe(0);
  });

  it('says so honestly for an account that predates the class field', async () => {
    await seedBank();
    const { cookies, studentId } = await registerVerifyLogin(app);

    // A legacy account: `classLevel` was added in Milestone 4, so documents created
    // before it genuinely have no value. Unset directly, because no API can produce
    // this state — which is exactly why the branch needs its own test.
    await Student.updateOne({ studentId }, { $unset: { classLevel: '' } });

    const res = await getToday(cookies);

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeNull();
    expect(res.body.reason).toBe('no-class');
    // And answering is refused with an explanation rather than a crash.
    const attempted = await answer(cookies, { selectedOptionKeys: ['a'] });
    expect(attempted.status).toBe(409);
    expect(attempted.body.error).toMatch(/class/i);
  });

  it('is class-specific: two classes get their own pinned question', async () => {
    const { adminCookies, taxonomy } = await seedBank([]);
    await createPublishedQuestion(app, adminCookies, taxonomy, { classLevel: 'Class 9', questionText: 'Nine?' });
    await createPublishedQuestion(app, adminCookies, taxonomy, { classLevel: 'Class 10', questionText: 'Ten?' });

    const { cookies: nine } = await registerVerifyLogin(app, { classLevel: 'Class 9' });
    const { cookies: ten } = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 10' });

    const forNine = await getToday(nine);
    const forTen = await getToday(ten);

    expect(forNine.body.challenge.classLevel).toBe('Class 9');
    expect(forTen.body.challenge.classLevel).toBe('Class 10');
    expect(forTen.body.challenge.question.id).not.toBe(forNine.body.challenge.question.id);
    expect(await DailyChallenge.countDocuments({})).toBe(2);
  });

  it('still serves the legacy /daily-challenge path, and still requires a session', async () => {
    await seedBank();
    expect((await request(app).get(`${API}/daily-challenge`)).status).toBe(401);

    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/daily-challenge`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(res.body.challenge).not.toBeNull();
  });
});

// ===========================================================================
// Answering
// ===========================================================================

describe('answering the challenge', () => {
  it('marks a correct answer, reveals the explanation, and awards the day’s XP', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);
    await getToday(cookies);

    const res = await answer(cookies, { selectedOptionKeys: ['a'] });

    expect(res.status).toBe(200);
    expect(res.body.attempt.isCorrect).toBe(true);
    expect(res.body.attempt.awardedMarks).toBe(4);
    expect(res.body.attempt.correctAnswer.optionKeys).toEqual(['a']);
    expect(res.body.attempt.explanation).toMatch(/Factorise/);
    expect(res.body.xpAwarded).toBe(XP_AWARDS.daily_challenge_completed);
    expect(res.body.streak.current).toBe(1);
    expect(res.body.completedCount).toBe(1);

    const stored = await DailyChallengeAttempt.findOne({});
    expect(stored?.answer.isCorrect).toBe(true);
    expect(stored?.xpAwarded).toBe(XP_AWARDS.daily_challenge_completed);
    expect(stored?.day).toBe(todayKey());
  });

  it('marks a wrong answer without penalising it', async () => {
    // The bank fixture carries negativeMarks: 1, which a challenge must ignore.
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);

    const res = await answer(cookies, { selectedOptionKeys: ['b'] });

    expect(res.body.attempt.isCorrect).toBe(false);
    expect(res.body.attempt.awardedMarks).toBe(0);
    // Answering still earns the day's XP: the reward is for taking part.
    expect(res.body.xpAwarded).toBe(XP_AWARDS.daily_challenge_completed);

    const stored = await DailyChallengeAttempt.findOne({});
    expect(stored?.answer.negativeMarks).toBe(0);
    expect(stored?.answer.awardedMarks).toBe(0);
  });

  it('refuses a blank submission rather than paying for it', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);

    const res = await answer(cookies, { selectedOptionKeys: [] });

    expect(res.status).toBe(400);
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(0);
    expect(await StudentActivity.countDocuments({ type: 'daily_challenge_completed' })).toBe(0);
  });

  it('refuses an option that was never offered, and two answers to a single-choice question', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);

    expect((await answer(cookies, { selectedOptionKeys: ['z'] })).status).toBe(400);
    expect((await answer(cookies, { selectedOptionKeys: ['a', 'b'] })).status).toBe(400);
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(0);
  });

  it('marks a true/false and a numeric challenge through the API', async () => {
    const { adminCookies, taxonomy } = await seedBank([]);
    await createPublishedQuestion(app, adminCookies, taxonomy, {
      classLevel: 'Class 9',
      questionText: 'Is $2+2=4$?',
      type: 'true_false',
      options: [],
      booleanAnswer: true,
      marks: 2,
      negativeMarks: 0,
    });
    const { cookies } = await registerVerifyLogin(app);

    const boolean = await answer(cookies, { booleanResponse: true });
    expect(boolean.body.attempt.isCorrect).toBe(true);
    expect(boolean.body.attempt.awardedMarks).toBe(2);

    // A second class, so a numeric question can be the pinned challenge for someone.
    await createPublishedQuestion(app, adminCookies, taxonomy, {
      classLevel: 'Class 11',
      questionText: 'Give $\\pi$ to two places.',
      type: 'numeric',
      options: [],
      numericAnswer: 3.14,
      tolerance: 0.01,
      marks: 3,
      negativeMarks: 0,
    });
    const { cookies: other } = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 11' });

    // Inside the tolerance.
    const numeric = await answer(other, { numericResponse: 3.145 });
    expect(numeric.body.attempt.isCorrect).toBe(true);
    expect(numeric.body.attempt.awardedMarks).toBe(3);
  });

  it('grades against the question as served, even after the answer is edited', async () => {
    const { adminCookies, taxonomy, questionIds } = await seedBank();
    const { cookies } = await registerVerifyLogin(app);
    await answer(cookies, { selectedOptionKeys: ['a'] });

    // The author moves the correct answer to option B afterwards.
    await request(app)
      .put(`${API}/admin/questions/${questionIds[0]}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({
        questionText: 'Solve for $x$: $x^2 - 5x + 6 = 0$. What is the larger root?',
        type: 'single_choice',
        options: [
          { text: '$x = 3$', isCorrect: false },
          { text: '$x = 2$', isCorrect: true },
          { text: '$x = -3$', isCorrect: false },
          { text: '$x = 6$', isCorrect: false },
        ],
        solution: 'Edited after the fact.',
        subject: taxonomy.subjectId,
        topic: taxonomy.topicId,
        classLevel: 'Class 9',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        tags: [],
      })
      .expect(200);

    const res = await getToday(cookies);

    // Still correct, and the student is told the question has changed.
    expect(res.body.attempt.isCorrect).toBe(true);
    expect(res.body.attempt.awardedMarks).toBe(4);
    expect(res.body.attempt.revisionChanged).toBe(true);
  });

  it('returns the result on the answered view, with the reward marked claimed', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);
    await answer(cookies, { selectedOptionKeys: ['a'] });

    const res = await getToday(cookies);

    expect(res.body.attempt).not.toBeNull();
    expect(res.body.attempt.isCorrect).toBe(true);
    expect(res.body.reward.claimed).toBe(true);
    expect(res.body.reward.xp).toBe(XP_AWARDS.daily_challenge_completed);
  });

  it('refuses an anonymous answer', async () => {
    await seedBank();
    const res = await request(app).post(`${API}/me/daily-challenge/answer`).send({ selectedOptionKeys: ['a'] });
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// The reward guard
// ===========================================================================

describe('repeated reward claims', () => {
  it('pays once however many times the day’s challenge is submitted', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);

    const first = await answer(cookies, { selectedOptionKeys: ['a'] });
    const second = await answer(cookies, { selectedOptionKeys: ['b'] });
    const third = await answer(cookies, { selectedOptionKeys: ['b'] });

    expect(first.body.xpAwarded).toBe(XP_AWARDS.daily_challenge_completed);
    expect(second.status).toBe(200);
    expect(second.body.alreadyAnswered).toBe(true);
    expect(second.body.xpAwarded).toBe(0);
    expect(third.body.alreadyAnswered).toBe(true);

    // One attempt, one activity row, and the first answer is the one that stands.
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(1);
    expect(await StudentActivity.countDocuments({ type: 'daily_challenge_completed' })).toBe(1);
    const stored = await DailyChallengeAttempt.findOne({});
    expect(stored?.answer.selectedOptionKeys).toEqual(['a']);
    expect(stored?.answer.isCorrect).toBe(true);
  });

  it('pays once when two submissions arrive at the same moment', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);
    await getToday(cookies);

    const [a, b] = await Promise.all([
      answer(cookies, { selectedOptionKeys: ['a'] }),
      answer(cookies, { selectedOptionKeys: ['a'] }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(1);
    expect(await StudentActivity.countDocuments({ type: 'daily_challenge_completed' })).toBe(1);
    // Exactly one of the two did the awarding.
    const awarded = [a.body.xpAwarded, b.body.xpAwarded].filter((xp: number) => xp > 0);
    expect(awarded).toHaveLength(1);
  });

  it('cannot be re-claimed by another student’s attempt, and one student cannot see another’s', async () => {
    await seedBank();
    const { cookies: mine } = await registerVerifyLogin(app);
    const { cookies: theirs } = await registerVerifyLogin(app, otherStudent);

    await answer(mine, { selectedOptionKeys: ['a'] });
    const other = await getToday(theirs);

    // The same pinned question, but no sight of the other student's answer.
    expect(other.body.attempt).toBeNull();
    expect(other.body.reward.claimed).toBe(false);
    for (const name of FORBIDDEN_BEFORE_ANSWERING) {
      expect(JSON.stringify(other.body)).not.toContain(name);
    }

    // And their own answer earns its own reward.
    const theirAnswer = await answer(theirs, { selectedOptionKeys: ['a'] });
    expect(theirAnswer.body.xpAwarded).toBe(XP_AWARDS.daily_challenge_completed);
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(2);
  });

  it('counts the challenge XP in the student’s total exactly once', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);

    const before = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies)).expect(200);
    const xpBefore = before.body.dashboard.progress.xp;

    await answer(cookies, { selectedOptionKeys: ['a'] });
    await answer(cookies, { selectedOptionKeys: ['a'] });

    const after = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(after.body.dashboard.progress.xp).toBe(xpBefore + XP_AWARDS.daily_challenge_completed);
  });
});

// ===========================================================================
// Achievements — reached only through the service seam
// ===========================================================================

describe('achievements', () => {
  it('earns the challenge achievement from real attempts, and shows real progress before that', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);

    const before = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(before.body.dashboard.achievements.earned.some((a: { code: string }) => a.code === 'challenge_first')).toBe(
      false,
    );

    await answer(cookies, { selectedOptionKeys: ['a'] });

    const after = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(after.body.dashboard.achievements.earned.some((a: { code: string }) => a.code === 'challenge_first')).toBe(
      true,
    );
  });

  it('shows the five-day challenge streak as genuine progress, not an empty bar', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);
    await answer(cookies, { selectedOptionKeys: ['a'] });

    // Two more consecutive days, planted so no clock has to be faked.
    const attempt = await DailyChallengeAttempt.findOne({});
    for (const back of [1, 2]) {
      await DailyChallengeAttempt.create({
        challenge: attempt!.challenge,
        student: attempt!.student,
        day: shiftDay(todayKey(), back),
        answer: attempt!.answer,
        xpAwarded: 0,
        submittedAt: new Date(),
      });
    }

    const res = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies)).expect(200);
    const all = [...res.body.dashboard.achievements.earned, ...res.body.dashboard.achievements.next];
    const streak = all.find((a: { code: string }) => a.code === 'challenge_streak_5');

    expect(streak).toBeDefined();
    expect(streak.progress).toBe(3);
    expect(streak.target).toBe(5);
    expect(streak.earned).toBe(false);
  });
});

// ===========================================================================
// History
// ===========================================================================

describe('history', () => {
  it('lists the student’s own past challenges with the streak derived from them', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);
    await answer(cookies, { selectedOptionKeys: ['a'] });

    const res = await request(app)
      .get(`${API}/me/daily-challenge/history`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0].day).toBe(todayKey());
    expect(res.body.attempts[0].isCorrect).toBe(true);
    expect(res.body.attempts[0].questionText).toMatch(/Solve for/);
    expect(res.body.streak.current).toBe(1);
    expect(res.body.completedCount).toBe(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it('is empty and honest for a student who has never answered one', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app)
      .get(`${API}/me/daily-challenge/history`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.attempts).toEqual([]);
    expect(res.body.streak).toEqual({ current: 0, longest: 0 });
    expect(res.body.completedCount).toBe(0);
  });

  it('shows only the caller’s own attempts', async () => {
    await seedBank();
    const { cookies: mine } = await registerVerifyLogin(app);
    const { cookies: theirs } = await registerVerifyLogin(app, otherStudent);
    await answer(mine, { selectedOptionKeys: ['a'] });

    const res = await request(app)
      .get(`${API}/me/daily-challenge/history`)
      .set('Cookie', cookieHeader(theirs))
      .expect(200);

    expect(res.body.attempts).toEqual([]);
  });
});

// ===========================================================================
// Scheduling (staff)
// ===========================================================================

describe('scheduling', () => {
  it('serves a scheduled question rather than the automatic pick', async () => {
    const { adminCookies, taxonomy } = await seedBank([{ questionText: 'The automatic one?' }]);
    const chosen = await createPublishedQuestion(app, adminCookies, taxonomy, {
      questionText: 'The deliberately scheduled one?',
    });

    const scheduled = await schedule(adminCookies, {
      day: todayKey(),
      classLevel: 'Class 9',
      questionId: chosen.id,
    });
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.challenge.source).toBe('scheduled');

    const { cookies } = await registerVerifyLogin(app);
    const res = await getToday(cookies);

    expect(res.body.challenge.question.id).toBe(chosen.id);
    expect(res.body.challenge.question.questionText).toMatch(/deliberately scheduled/);
  });

  it('schedules a future day, which is invisible until it arrives', async () => {
    const { adminCookies, taxonomy } = await seedBank([]);
    const question = await createPublishedQuestion(app, adminCookies, taxonomy, { questionText: 'Tomorrow?' });
    const tomorrow = shiftDay(todayKey(), -1);

    const res = await schedule(adminCookies, {
      day: tomorrow,
      classLevel: 'Class 9',
      questionId: question.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.challenge.day).toBe(tomorrow);

    // Today resolves separately — the scheduled day is not served early.
    const { cookies } = await registerVerifyLogin(app);
    const today = await getToday(cookies);
    expect(today.body.challenge.day).toBe(todayKey());
    expect(await DailyChallenge.countDocuments({})).toBe(2);
  });

  it('refuses the past, a duplicate day, another class’s question and an unpublished one', async () => {
    const { adminCookies, taxonomy, questionIds } = await seedBank();
    const draft = await createQuestionVia(app, adminCookies, taxonomy, { questionText: 'Unreviewed?' });
    const otherClass = await createPublishedQuestion(app, adminCookies, taxonomy, { classLevel: 'Class 11' });

    const past = await schedule(adminCookies, {
      day: shiftDay(todayKey(), 1),
      classLevel: 'Class 9',
      questionId: questionIds[0],
    });
    expect(past.status).toBe(400);
    expect(past.body.error).toMatch(/past/i);

    expect(
      (await schedule(adminCookies, { day: todayKey(), classLevel: 'Class 9', questionId: draft.id })).status,
    ).toBe(409);

    expect(
      (await schedule(adminCookies, { day: todayKey(), classLevel: 'Class 9', questionId: otherClass.id })).status,
    ).toBe(400);

    expect(
      (await schedule(adminCookies, { day: '2026-02-30', classLevel: 'Class 9', questionId: questionIds[0] })).status,
    ).toBe(400);

    const first = await schedule(adminCookies, {
      day: todayKey(),
      classLevel: 'Class 9',
      questionId: questionIds[0],
    });
    expect(first.status).toBe(201);
    const duplicate = await schedule(adminCookies, {
      day: todayKey(),
      classLevel: 'Class 9',
      questionId: questionIds[0],
    });
    expect(duplicate.status).toBe(409);
    expect(await DailyChallenge.countDocuments({})).toBe(1);
  });

  it('can be re-pointed or removed until somebody answers it, and not after', async () => {
    const { adminCookies, taxonomy, questionIds } = await seedBank();
    const replacement = await createPublishedQuestion(app, adminCookies, taxonomy, { questionText: 'Replacement?' });

    const created = await schedule(adminCookies, {
      day: todayKey(),
      classLevel: 'Class 9',
      questionId: questionIds[0],
    });
    const id = created.body.challenge.id;

    const repointed = await request(app)
      .put(`${API}/admin/daily-challenges/${id}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ questionId: replacement.id });
    expect(repointed.status).toBe(200);
    expect(repointed.body.challenge.question.id).toBe(replacement.id);

    // A student answers it.
    const { cookies } = await registerVerifyLogin(app);
    await answer(cookies, { selectedOptionKeys: ['a'] });

    const tooLate = await request(app)
      .put(`${API}/admin/daily-challenges/${id}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ questionId: questionIds[0] });
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.error).toMatch(/already answered/i);

    const undeletable = await request(app)
      .delete(`${API}/admin/daily-challenges/${id}`)
      .set('Cookie', cookieHeader(adminCookies));
    expect(undeletable.status).toBe(409);
    expect(await DailyChallenge.countDocuments({})).toBe(1);
  });

  it('removes an unanswered scheduled day', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const created = await schedule(adminCookies, {
      day: shiftDay(todayKey(), -3),
      classLevel: 'Class 9',
      questionId: questionIds[0],
    });

    const res = await request(app)
      .delete(`${API}/admin/daily-challenges/${created.body.challenge.id}`)
      .set('Cookie', cookieHeader(adminCookies));

    expect(res.status).toBe(200);
    expect(await DailyChallenge.countDocuments({})).toBe(0);
  });

  it('reports how each day landed, without pretending a day nobody tried was failed', async () => {
    const { adminCookies } = await seedBank([{}, {}]);
    const { cookies: right } = await registerVerifyLogin(app);
    const { cookies: wrong } = await registerVerifyLogin(app, otherStudent);

    await answer(right, { selectedOptionKeys: ['a'] });
    await answer(wrong, { selectedOptionKeys: ['b'] });

    const res = await request(app)
      .get(`${API}/admin/daily-challenges`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);

    const today = res.body.challenges.find((c: { day: string }) => c.day === todayKey());
    expect(today.attempts).toBe(2);
    expect(today.correct).toBe(1);
    expect(today.correctPercent).toBe(50);
    expect(today.source).toBe('automatic');
    expect(res.body.today).toBe(todayKey());
    expect(res.body.upcoming[0]).toBe(todayKey());

    // A scheduled future day nobody could have answered.
    const untried = await schedule(adminCookies, {
      day: shiftDay(todayKey(), -1),
      classLevel: 'Class 9',
      questionId: today.question.id,
    });
    const withFuture = await request(app)
      .get(`${API}/admin/daily-challenges`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);
    const future = withFuture.body.challenges.find(
      (c: { id: string }) => c.id === untried.body.challenge.id,
    );
    expect(future.attempts).toBe(0);
    expect(future.correctPercent).toBeNull();
  });

  it('records scheduling in the audit trail', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const created = await schedule(adminCookies, {
      day: todayKey(),
      classLevel: 'Class 9',
      questionId: questionIds[0],
    });
    await request(app)
      .delete(`${API}/admin/daily-challenges/${created.body.challenge.id}`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);

    const audit = await request(app)
      .get(`${API}/admin/audit-logs?limit=50`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);

    const actions = (audit.body.entries as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toContain('dailychallenge.scheduled');
    expect(actions).toContain('dailychallenge.deleted');
  });

  it('refuses a plain student on every scheduling route, on both API prefixes', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const created = await schedule(adminCookies, {
      day: todayKey(),
      classLevel: 'Class 9',
      questionId: questionIds[0],
    });
    const id = created.body.challenge.id;
    const { cookies } = await registerVerifyLogin(app);
    const cookie = cookieHeader(cookies);

    const calls = [
      request(app).get(`${API}/admin/daily-challenges`).set('Cookie', cookie),
      request(app)
        .post(`${API}/admin/daily-challenges`)
        .set('Cookie', cookie)
        .send({ day: todayKey(), classLevel: 'Class 9', questionId: questionIds[0] }),
      request(app)
        .put(`${API}/admin/daily-challenges/${id}`)
        .set('Cookie', cookie)
        .send({ questionId: questionIds[0] }),
      request(app).delete(`${API}/admin/daily-challenges/${id}`).set('Cookie', cookie),
      // The unversioned compatibility alias mounts the same router.
      request(app).get('/api/admin/daily-challenges').set('Cookie', cookie),
    ];

    for (const call of await Promise.all(calls)) {
      expect(call.status).toBe(403);
    }
    expect(await DailyChallenge.countDocuments({})).toBe(1);
  });
});
