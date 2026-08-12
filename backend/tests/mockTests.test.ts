import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { MockTest, MockTestAttempt, StudentActivity } from '../src/models';
import { XP_AWARDS } from '../src/lib/xp';
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
 * Milestone 7 — the Mock Test System.
 *
 * Four properties dominate this suite, and they are the four things that would make a
 * timed online assessment worthless if any of them were merely *intended*:
 *
 * **1. The server owns the clock.** Nothing a client sends can extend a deadline, an
 * answer submitted after time is not stored, and a paper is graded as at its deadline
 * rather than as at the moment the server noticed. Expiry is simulated by moving the
 * stored `expiresAt` into the past — never by mocking time inside the code under test,
 * so what is exercised is the real comparison against the real stored deadline.
 *
 * **2. An attempt is graded exactly once.** Tested with sequential *and* genuinely
 * concurrent submissions, because the guard is a conditional write and a sequential
 * test alone would pass even if it were an ordinary read-then-write.
 *
 * **3. The answer key does not leak.** Asserted by stringifying whole response bodies
 * and requiring that the forbidden names and the literal correct values are absent —
 * the same technique the practice and question-bank suites use, because it survives
 * someone adding a field to a projection without thinking. Here it has to hold under
 * the test's own disclosure settings too: `reviewPolicy: 'never'` must withhold the key
 * *after* submission, which no earlier surface in this codebase had to do.
 *
 * **4. Grading is the server's, against the paper as served.** Including the case the
 * bank cannot express: a question re-priced by the test must be marked at the test's
 * marks, not the bank's.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** Field names and values that would give the answer away if they ever appeared. */
const FORBIDDEN_BEFORE_REVEAL = [
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

interface Seeded {
  adminCookies: Record<string, string>;
  taxonomy: Taxonomy;
  questionIds: string[];
}

/** An admin, a taxonomy, and however many published questions were asked for. */
async function seedBank(overridesList: Array<Record<string, unknown>> = [{}]): Promise<Seeded> {
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

type TestBody = Record<string, unknown>;

function testBody(questionIds: string[], overrides: TestBody = {}): TestBody {
  return {
    title: 'Weekly Mock Test 1',
    description: 'A short timed paper.',
    instructions: 'Answer all questions. Negative marking applies.',
    classLevel: 'Class 9',
    questions: questionIds.map((id) => ({ question: id, marks: 4, negativeMarks: 1 })),
    durationMinutes: 30,
    maxAttempts: 1,
    resultDisplay: 'immediate',
    reviewPolicy: 'immediate',
    ...overrides,
  };
}

async function createTest(
  adminCookies: Record<string, string>,
  questionIds: string[],
  overrides: TestBody = {},
): Promise<Record<string, never> & { id: string; totalMarks: number; status: string }> {
  const res = await request(app)
    .post(`${API}/admin/mock-tests`)
    .set('Cookie', cookieHeader(adminCookies))
    .send(testBody(questionIds, overrides));
  expect(res.status).toBe(201);
  return res.body.test;
}

async function setStatus(
  adminCookies: Record<string, string>,
  testId: string,
  status: string,
): Promise<request.Response> {
  return request(app)
    .patch(`${API}/admin/mock-tests/${testId}/status`)
    .set('Cookie', cookieHeader(adminCookies))
    .send({ status });
}

/** Creates and publishes a test in one step — the usual starting point. */
async function publishedTest(
  adminCookies: Record<string, string>,
  questionIds: string[],
  overrides: TestBody = {},
): Promise<{ id: string; totalMarks: number }> {
  const test = await createTest(adminCookies, questionIds, overrides);
  const res = await setStatus(adminCookies, test.id, 'published');
  expect(res.status).toBe(200);
  return { id: test.id, totalMarks: test.totalMarks };
}

interface AttemptView {
  id: string;
  status: string;
  totalQuestions: number;
  maxMarks: number;
  expiresAt: string;
  secondsRemaining: number;
  questions: Array<{ id: string; type: string; marks: number; options: Array<{ key: string }> }>;
}

async function startAttempt(cookies: Record<string, string>, testId: string): Promise<AttemptView> {
  const res = await request(app)
    .post(`${API}/mock-tests/${testId}/attempts`)
    .set('Cookie', cookieHeader(cookies))
    .send({});
  expect([200, 201]).toContain(res.status);
  return res.body.attempt as AttemptView;
}

async function saveAnswer(
  cookies: Record<string, string>,
  attemptId: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app)
    .put(`${API}/mock-tests/attempts/${attemptId}/answers`)
    .set('Cookie', cookieHeader(cookies))
    .send(body);
}

async function submitAttempt(cookies: Record<string, string>, attemptId: string): Promise<request.Response> {
  return request(app)
    .post(`${API}/mock-tests/attempts/${attemptId}/submit`)
    .set('Cookie', cookieHeader(cookies))
    .send({});
}

async function readAttempt(cookies: Record<string, string>, attemptId: string): Promise<request.Response> {
  return request(app).get(`${API}/mock-tests/attempts/${attemptId}`).set('Cookie', cookieHeader(cookies));
}

/**
 * Moves an attempt's stored deadline into the past, which is how every timing test
 * here makes "time ran out" happen.
 *
 * Deliberately a direct write to the field the server actually consults, rather than a
 * faked system clock: what is under test is the comparison against the persisted
 * deadline, and a mocked `Date` would pass even if the code were reading a
 * client-supplied time.
 */
async function expireAttempt(attemptId: string, options: { durationMinutes?: number; agoSeconds?: number } = {}) {
  const agoSeconds = options.agoSeconds ?? 60;
  const duration = (options.durationMinutes ?? 30) * 60;
  const expiresAt = new Date(Date.now() - agoSeconds * 1000);
  const startedAt = new Date(expiresAt.getTime() - duration * 1000);
  await MockTestAttempt.updateOne({ _id: attemptId }, { $set: { expiresAt, startedAt } });
  return { startedAt, expiresAt };
}

const minutesFromNow = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

// ===========================================================================
// Authoring
// ===========================================================================

describe('authoring a mock test', () => {
  it('creates a draft and computes the total marks from the paper', async () => {
    const { adminCookies, questionIds } = await seedBank([{}, {}]);

    const test = await createTest(adminCookies, questionIds, {
      questions: [
        { question: questionIds[0], marks: 4, negativeMarks: 1 },
        { question: questionIds[1], marks: 6, negativeMarks: 2 },
      ],
    });

    expect(test.status).toBe('draft');
    expect(test.totalMarks).toBe(10);

    // Read back out of the database rather than trusting the response.
    const stored = await MockTest.findById(test.id);
    expect(stored?.totalMarks).toBe(10);
    expect(stored?.questions).toHaveLength(2);
    expect(stored?.questions[0]?.order).toBe(1);
    expect(stored?.questions[1]?.order).toBe(2);
  });

  it('refuses a question that belongs to a different class', async () => {
    const { adminCookies, taxonomy } = await seedBank([]);
    const class12 = await createPublishedQuestion(app, adminCookies, taxonomy, { classLevel: 'Class 11' });

    const res = await request(app)
      .post(`${API}/admin/mock-tests`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(testBody([class12.id], { classLevel: 'Class 9' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Class 11/);
  });

  it('refuses negative marking larger than the marks on offer', async () => {
    const { adminCookies, questionIds } = await seedBank();

    const res = await request(app)
      .post(`${API}/admin/mock-tests`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(testBody(questionIds, { questions: [{ question: questionIds[0], marks: 2, negativeMarks: 3 }] }));

    expect(res.status).toBe(400);
  });

  it('refuses the same question twice on one paper', async () => {
    const { adminCookies, questionIds } = await seedBank();

    const res = await request(app)
      .post(`${API}/admin/mock-tests`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(
        testBody(questionIds, {
          questions: [
            { question: questionIds[0], marks: 4, negativeMarks: 0 },
            { question: questionIds[0], marks: 4, negativeMarks: 0 },
          ],
        }),
      );

    expect(res.status).toBe(400);
  });

  it('refuses an empty paper', async () => {
    const { adminCookies } = await seedBank([]);

    const res = await request(app)
      .post(`${API}/admin/mock-tests`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(testBody([], { questions: [] }));

    expect(res.status).toBe(400);
  });

  it('refuses a disclosure setting of after_close when there is no closing time', async () => {
    const { adminCookies, questionIds } = await seedBank();

    const res = await request(app)
      .post(`${API}/admin/mock-tests`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(testBody(questionIds, { reviewPolicy: 'after_close', availableTo: null }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closing time/i);
  });

  it('refuses a closing time that is not after the opening time', async () => {
    const { adminCookies, questionIds } = await seedBank();

    const res = await request(app)
      .post(`${API}/admin/mock-tests`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(testBody(questionIds, { availableFrom: minutesFromNow(120), availableTo: minutesFromNow(60) }));

    expect(res.status).toBe(400);
  });

  it('refuses to publish a test holding an unpublished question', async () => {
    const { adminCookies, taxonomy } = await seedBank([]);
    const draft = await createQuestionVia(app, adminCookies, taxonomy);

    const test = await createTest(adminCookies, [draft.id]);
    const res = await setStatus(adminCookies, test.id, 'published');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not published yet/i);
  });

  it('publishes, unpublishes and archives, and records each in the audit trail', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await createTest(adminCookies, questionIds);

    expect((await setStatus(adminCookies, test.id, 'published')).status).toBe(200);
    expect((await setStatus(adminCookies, test.id, 'draft')).status).toBe(200);
    expect((await setStatus(adminCookies, test.id, 'archived')).status).toBe(200);

    const audit = await request(app)
      .get(`${API}/admin/audit-logs?limit=50`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);

    const actions = (audit.body.entries as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toContain('mocktest.created');
    expect(actions.filter((action) => action === 'mocktest.status.changed')).toHaveLength(3);
  });

  it('lets a student see nothing of an unpublished test', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await createTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);

    const list = await request(app).get(`${API}/mock-tests`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(list.body.tests).toHaveLength(0);

    // Not merely absent from the listing: unreachable, and indistinguishable from a
    // test that does not exist, so the endpoint cannot enumerate drafts.
    const direct = await request(app).get(`${API}/mock-tests/${test.id}`).set('Cookie', cookieHeader(cookies));
    expect(direct.status).toBe(404);

    const start = await request(app)
      .post(`${API}/mock-tests/${test.id}/attempts`)
      .set('Cookie', cookieHeader(cookies))
      .send({});
    expect(start.status).toBe(404);
  });

  it('offers a published test only to its own class', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { classLevel: 'Class 9' });

    const { cookies: right } = await registerVerifyLogin(app);
    const { cookies: wrong } = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 10' });

    const forClass9 = await request(app).get(`${API}/mock-tests`).set('Cookie', cookieHeader(right)).expect(200);
    expect(forClass9.body.tests).toHaveLength(1);
    expect(forClass9.body.tests[0].id).toBe(test.id);
    // No paper in the listing, whatever the window says.
    expect(JSON.stringify(forClass9.body)).not.toContain('questionText');

    const forClass10 = await request(app).get(`${API}/mock-tests`).set('Cookie', cookieHeader(wrong)).expect(200);
    expect(forClass10.body.tests).toHaveLength(0);

    const start = await request(app)
      .post(`${API}/mock-tests/${test.id}/attempts`)
      .set('Cookie', cookieHeader(wrong))
      .send({});
    expect(start.status).toBe(403);
  });
});

describe('editing a mock test', () => {
  it('keeps the paper and the clock editable until somebody has sat it', async () => {
    const { adminCookies, questionIds } = await seedBank([{}, {}]);
    const test = await createTest(adminCookies, [questionIds[0]!]);

    const res = await request(app)
      .put(`${API}/admin/mock-tests/${test.id}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(
        testBody(questionIds, {
          durationMinutes: 45,
          questions: questionIds.map((id) => ({ question: id, marks: 5, negativeMarks: 0 })),
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.test.totalMarks).toBe(10);
    expect(res.body.test.durationMinutes).toBe(45);
  });

  it('refuses to change the paper or the duration once a student has sat it', async () => {
    const { adminCookies, questionIds } = await seedBank([{}, {}]);
    const test = await publishedTest(adminCookies, [questionIds[0]!]);
    const { cookies } = await registerVerifyLogin(app);
    await startAttempt(cookies, test.id);

    const paper = await request(app)
      .put(`${API}/admin/mock-tests/${test.id}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(testBody(questionIds));
    expect(paper.status).toBe(409);
    expect(paper.body.error).toMatch(/already sat/i);

    const clock = await request(app)
      .put(`${API}/admin/mock-tests/${test.id}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(testBody([questionIds[0]!], { durationMinutes: 90 }));
    expect(clock.status).toBe(409);
  });

  it('still allows the instructions, window and disclosure settings to be changed after attempts exist', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    await startAttempt(cookies, test.id);

    const res = await request(app)
      .put(`${API}/admin/mock-tests/${test.id}`)
      .set('Cookie', cookieHeader(adminCookies))
      .send(
        testBody(questionIds, {
          instructions: 'Updated instructions.',
          availableTo: minutesFromNow(240),
          reviewPolicy: 'after_close',
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.test.reviewPolicy).toBe('after_close');
  });

  it('deletes a never-published draft but refuses one that has been published', async () => {
    const { adminCookies, questionIds } = await seedBank();

    const draft = await createTest(adminCookies, questionIds);
    const deleted = await request(app)
      .delete(`${API}/admin/mock-tests/${draft.id}`)
      .set('Cookie', cookieHeader(adminCookies));
    expect(deleted.status).toBe(200);
    expect(await MockTest.findById(draft.id)).toBeNull();

    const published = await publishedTest(adminCookies, questionIds);
    await setStatus(adminCookies, published.id, 'draft');
    const refused = await request(app)
      .delete(`${API}/admin/mock-tests/${published.id}`)
      .set('Cookie', cookieHeader(adminCookies));
    expect(refused.status).toBe(409);
    expect(await MockTest.findById(published.id)).not.toBeNull();
  });
});

describe('authorization on the authoring routes', () => {
  it('refuses a plain student on every admin mock-test route, on both API prefixes', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const cookie = cookieHeader(cookies);

    const calls = [
      request(app).get(`${API}/admin/mock-tests`).set('Cookie', cookie),
      request(app).get(`${API}/admin/mock-tests/${test.id}`).set('Cookie', cookie),
      request(app).post(`${API}/admin/mock-tests`).set('Cookie', cookie).send(testBody(questionIds)),
      request(app).put(`${API}/admin/mock-tests/${test.id}`).set('Cookie', cookie).send(testBody(questionIds)),
      request(app)
        .patch(`${API}/admin/mock-tests/${test.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'draft' }),
      request(app).delete(`${API}/admin/mock-tests/${test.id}`).set('Cookie', cookie),
      request(app).get(`${API}/admin/mock-tests/${test.id}/results`).set('Cookie', cookie),
      // The unversioned compatibility alias mounts the same router, so the gate has to
      // hold there too.
      request(app).get(`/api/admin/mock-tests`).set('Cookie', cookie),
      request(app).get(`/api/admin/mock-tests/${test.id}/results`).set('Cookie', cookie),
    ];

    for (const call of await Promise.all(calls)) {
      expect(call.status).toBe(403);
    }
  });

  it('refuses an unauthenticated caller on the student routes', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);

    expect((await request(app).get(`${API}/mock-tests`)).status).toBe(401);
    expect((await request(app).post(`${API}/mock-tests/${test.id}/attempts`).send({})).status).toBe(401);
  });
});

// ===========================================================================
// Availability and starting
// ===========================================================================

describe('availability', () => {
  it('refuses to start before the window opens and after it closes', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const { cookies } = await registerVerifyLogin(app);

    const future = await publishedTest(adminCookies, questionIds, {
      availableFrom: minutesFromNow(60),
      availableTo: minutesFromNow(120),
    });
    const early = await request(app)
      .post(`${API}/mock-tests/${future.id}/attempts`)
      .set('Cookie', cookieHeader(cookies))
      .send({});
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/not opened yet/i);

    const past = await publishedTest(adminCookies, questionIds, {
      availableFrom: minutesFromNow(-120),
      availableTo: minutesFromNow(-60),
      title: 'Closed Mock Test',
    });
    const late = await request(app)
      .post(`${API}/mock-tests/${past.id}/attempts`)
      .set('Cookie', cookieHeader(cookies))
      .send({});
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/closed/i);
  });

  it('refuses to start when too little of the window is left to be worth it', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { availableTo: new Date(Date.now() + 20_000).toISOString() });
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app)
      .post(`${API}/mock-tests/${test.id}/attempts`)
      .set('Cookie', cookieHeader(cookies))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not enough time/i);
  });

  it('clamps the deadline to the closing time rather than running past it', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const closesAt = new Date(Date.now() + 10 * 60_000);
    // A 60-minute paper in a window that shuts in 10 minutes.
    const test = await publishedTest(adminCookies, questionIds, {
      durationMinutes: 60,
      availableTo: closesAt.toISOString(),
    });
    const { cookies } = await registerVerifyLogin(app);

    const attempt = await startAttempt(cookies, test.id);

    expect(new Date(attempt.expiresAt).getTime()).toBe(closesAt.getTime());
    expect(attempt.secondsRemaining).toBeLessThanOrEqual(600);
  });

  it('sets the deadline from the duration when the window is open-ended', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { durationMinutes: 30 });
    const { cookies } = await registerVerifyLogin(app);

    const attempt = await startAttempt(cookies, test.id);
    const stored = await MockTestAttempt.findById(attempt.id);

    const span = stored!.expiresAt.getTime() - stored!.startedAt.getTime();
    expect(span).toBe(30 * 60_000);
    expect(attempt.secondsRemaining).toBeGreaterThan(1750);
    expect(attempt.secondsRemaining).toBeLessThanOrEqual(1800);
  });
});

describe('attempt limits and resuming', () => {
  it('enforces a single attempt', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { maxAttempts: 1 });
    const { cookies } = await registerVerifyLogin(app);

    const first = await startAttempt(cookies, test.id);
    await submitAttempt(cookies, first.id);

    const second = await request(app)
      .post(`${API}/mock-tests/${test.id}/attempts`)
      .set('Cookie', cookieHeader(cookies))
      .send({});

    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already used your attempt/i);
    expect(await MockTestAttempt.countDocuments({ test: test.id })).toBe(1);
  });

  it('allows a second attempt when the test permits two', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { maxAttempts: 2 });
    const { cookies } = await registerVerifyLogin(app);

    const first = await startAttempt(cookies, test.id);
    await submitAttempt(cookies, first.id);
    const second = await startAttempt(cookies, test.id);

    expect(second.id).not.toBe(first.id);
    const stored = await MockTestAttempt.find({ test: test.id }).sort({ attemptNumber: 1 });
    expect(stored.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
  });

  it('resumes the open attempt with its original deadline instead of issuing a fresh clock', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { maxAttempts: 3 });
    const { cookies } = await registerVerifyLogin(app);

    const first = await startAttempt(cookies, test.id);
    // Pretend some of the paper has already been used up.
    await MockTestAttempt.updateOne(
      { _id: first.id },
      { $set: { startedAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() + 20 * 60_000) } },
    );

    const again = await request(app)
      .post(`${API}/mock-tests/${test.id}/attempts`)
      .set('Cookie', cookieHeader(cookies))
      .send({});

    expect(again.status).toBe(200);
    expect(again.body.resumed).toBe(true);
    expect(again.body.attempt.id).toBe(first.id);
    // The clock did not restart: ~20 minutes left of the 30, not 30.
    expect(again.body.attempt.secondsRemaining).toBeLessThan(21 * 60);
    expect(await MockTestAttempt.countDocuments({ test: test.id })).toBe(1);
  });

  it('does not create two attempts when two requests start at the same moment', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { maxAttempts: 3 });
    const { cookies } = await registerVerifyLogin(app);
    const cookie = cookieHeader(cookies);

    const [a, b] = await Promise.all([
      request(app).post(`${API}/mock-tests/${test.id}/attempts`).set('Cookie', cookie).send({}),
      request(app).post(`${API}/mock-tests/${test.id}/attempts`).set('Cookie', cookie).send({}),
    ]);

    expect(a.status).not.toBe(500);
    expect(b.status).not.toBe(500);
    expect(await MockTestAttempt.countDocuments({ test: test.id })).toBe(1);
  });
});

// ===========================================================================
// Answer persistence and integrity
// ===========================================================================

describe('answering', () => {
  it('serves a paper with no trace of the answer key', async () => {
    const { adminCookies, taxonomy } = await seedBank([]);
    await createPublishedQuestion(app, adminCookies, taxonomy, {
      questionText: 'Is $2+2=4$?',
      type: 'true_false',
      options: [],
      booleanAnswer: true,
      marks: 2,
      negativeMarks: 0,
    });
    await createPublishedQuestion(app, adminCookies, taxonomy, {
      questionText: 'Give $\\pi$ to two places.',
      type: 'numeric',
      options: [],
      numericAnswer: 3.14,
      tolerance: 0.01,
      marks: 3,
      negativeMarks: 0,
      solution: 'Pi is about $3.14$.',
    });
    const ids = (await MockTest.db.collection('questions').find({}).toArray()).map((doc) => String(doc._id));
    const test = await publishedTest(adminCookies, ids);
    const { cookies } = await registerVerifyLogin(app);

    const attempt = await startAttempt(cookies, test.id);
    const body = JSON.stringify(attempt);

    for (const name of FORBIDDEN_BEFORE_REVEAL) {
      expect(body).not.toContain(name);
    }
    // Nor the literal correct values.
    expect(body).not.toContain('3.14');
    expect(body).not.toContain('Pi is about');
  });

  it('saves, changes and clears an answer, and persists it across a reload', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    const question = attempt.questions[0]!;

    const saved = await saveAnswer(cookies, attempt.id, { questionId: question.id, selectedOptionKeys: ['b'] });
    expect(saved.status).toBe(200);
    expect(saved.body.answeredCount).toBe(1);
    expect(saved.body.secondsRemaining).toBeGreaterThan(0);

    const reloaded = await readAttempt(cookies, attempt.id).then((res) => res.body.attempt as AttemptView);
    expect((reloaded.questions[0] as unknown as { response: { selectedOptionKeys: string[] } }).response.selectedOptionKeys).toEqual(['b']);

    await saveAnswer(cookies, attempt.id, { questionId: question.id, selectedOptionKeys: ['a'] });
    const changed = await MockTestAttempt.findById(attempt.id);
    expect(changed?.questions[0]?.selectedOptionKeys).toEqual(['a']);

    const cleared = await saveAnswer(cookies, attempt.id, { questionId: question.id, selectedOptionKeys: [] });
    expect(cleared.body.answeredCount).toBe(0);
  });

  it('refuses an option key that was never served, and a second key on a single-choice question', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    const question = attempt.questions[0]!;

    const invented = await saveAnswer(cookies, attempt.id, { questionId: question.id, selectedOptionKeys: ['z'] });
    expect(invented.status).toBe(400);

    const two = await saveAnswer(cookies, attempt.id, { questionId: question.id, selectedOptionKeys: ['a', 'b'] });
    expect(two.status).toBe(400);

    const stored = await MockTestAttempt.findById(attempt.id);
    expect(stored?.questions[0]?.selectedOptionKeys).toEqual([]);
  });

  it('refuses an answer to a question that is not on this paper', async () => {
    const { adminCookies, questionIds, taxonomy } = await seedBank();
    const elsewhere = await createPublishedQuestion(app, adminCookies, taxonomy, { questionText: 'Not on the paper?' });
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);

    const res = await saveAnswer(cookies, attempt.id, { questionId: elsewhere.id, selectedOptionKeys: ['a'] });
    expect(res.status).toBe(404);
  });
});

describe('ownership', () => {
  it('hides another student’s attempt from every attempt route', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { maxAttempts: 2 });
    const { cookies: mine } = await registerVerifyLogin(app);
    const { cookies: theirs } = await registerVerifyLogin(app, otherStudent);

    const attempt = await startAttempt(mine, test.id);

    expect((await readAttempt(theirs, attempt.id)).status).toBe(404);
    expect((await saveAnswer(theirs, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] })).status).toBe(404);
    expect((await submitAttempt(theirs, attempt.id)).status).toBe(404);

    // Untouched by the intrusion attempts.
    const stored = await MockTestAttempt.findById(attempt.id);
    expect(stored?.status).toBe('in_progress');
  });
});

// ===========================================================================
// Timing — the server's clock is the only one that counts
// ===========================================================================

describe('server-enforced timing', () => {
  it('refuses an answer after the deadline, does not store it, and submits the paper', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    const question = attempt.questions[0]!;

    await expireAttempt(attempt.id);

    const res = await saveAnswer(cookies, attempt.id, { questionId: question.id, selectedOptionKeys: ['a'] });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/time for this test is up/i);

    const stored = await MockTestAttempt.findById(attempt.id);
    // Not stored — not stored late, not stored and ignored.
    expect(stored?.questions[0]?.selectedOptionKeys).toEqual([]);
    // And the paper is now marked, automatically.
    expect(stored?.status).toBe('submitted');
    expect(stored?.submissionReason).toBe('time_expired');
  });

  it('automatically submits an expired attempt when the student comes back to it', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    const { expiresAt } = await expireAttempt(attempt.id, { durationMinutes: 30, agoSeconds: 300 });

    const res = await readAttempt(cookies, attempt.id);

    expect(res.status).toBe(200);
    expect(res.body.attempt.status).toBe('submitted');
    expect(res.body.attempt.autoSubmitted).toBe(true);
    // Answers saved before time ran out still count.
    expect(res.body.attempt.correctCount).toBe(1);
    // Graded as at the deadline, not as at the moment it was noticed five minutes later.
    expect(new Date(res.body.attempt.submittedAt).getTime()).toBe(expiresAt.getTime());
    expect(res.body.attempt.timeTakenSeconds).toBe(30 * 60);
  });

  it('reports an expired attempt as submitted in the same response that finalises it', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    await expireAttempt(attempt.id);

    // The three surfaces that sweep. Each finalises the attempt as a side effect, and
    // each must render the *result* of that grading rather than the stale document it
    // swept — otherwise the paper reads as unfinished in the very response that
    // finished it, and only corrects itself on a reload.
    const history = await request(app)
      .get(`${API}/mock-tests/attempts`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(history.body.attempts[0].status).toBe('submitted');
    expect(history.body.attempts[0].autoSubmitted).toBe(true);
    expect(history.body.attempts[0].score).toBe(4);

    // Reset and repeat for the test listing.
    await MockTestAttempt.updateOne(
      { _id: attempt.id },
      { $set: { status: 'in_progress', submittedAt: null, submissionReason: null, score: 0 } },
    );
    const list = await request(app).get(`${API}/mock-tests`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(list.body.tests[0].attempts[0].status).toBe('submitted');
    expect(list.body.tests[0].resumeAttemptId).toBeNull();

    // And for the single-test briefing.
    await MockTestAttempt.updateOne(
      { _id: attempt.id },
      { $set: { status: 'in_progress', submittedAt: null, submissionReason: null, score: 0 } },
    );
    const detail = await request(app)
      .get(`${API}/mock-tests/${test.id}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(detail.body.test.attempts[0].status).toBe('submitted');
    expect(detail.body.test.resumeAttemptId).toBeNull();
  });

  it('grades a late submission as at the deadline rather than crediting the extra time', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { durationMinutes: 20 });
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);

    const { expiresAt } = await expireAttempt(attempt.id, { durationMinutes: 20, agoSeconds: 600 });

    const res = await submitAttempt(cookies, attempt.id);

    expect(res.status).toBe(200);
    expect(res.body.attempt.timeTakenSeconds).toBe(20 * 60);
    expect(res.body.attempt.autoSubmitted).toBe(true);
    const stored = await MockTestAttempt.findById(attempt.id);
    expect(stored?.submittedAt?.getTime()).toBe(expiresAt.getTime());
  });

  it('cannot be given more time by anything in a request', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    const before = await MockTestAttempt.findById(attempt.id);

    // Everything a client might try to push at the server. `validate` replaces the
    // body with the parse result, so none of these fields exists by the time a handler
    // runs — which is exactly why the deadline cannot be moved from outside.
    await saveAnswer(cookies, attempt.id, {
      questionId: attempt.questions[0]!.id,
      selectedOptionKeys: ['a'],
      expiresAt: new Date(Date.now() + 999 * 60_000).toISOString(),
      secondsRemaining: 99_999,
      durationMinutes: 999,
      timeTakenSeconds: 1,
      startedAt: new Date().toISOString(),
    });
    await request(app)
      .post(`${API}/mock-tests/${test.id}/attempts`)
      .set('Cookie', cookieHeader(cookies))
      .send({ durationMinutes: 999, expiresAt: new Date(Date.now() + 999 * 60_000).toISOString() });

    const after = await MockTestAttempt.findById(attempt.id);
    expect(after?.expiresAt.getTime()).toBe(before?.expiresAt.getTime());
    expect(after?.startedAt.getTime()).toBe(before?.startedAt.getTime());
    expect(after?.durationMinutes).toBe(30);
  });

  it('lets a student finish an attempt that was under way when the test was unpublished', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);

    await setStatus(adminCookies, test.id, 'draft');

    const saved = await saveAnswer(cookies, attempt.id, {
      questionId: attempt.questions[0]!.id,
      selectedOptionKeys: ['a'],
    });
    expect(saved.status).toBe(200);

    const submitted = await submitAttempt(cookies, attempt.id);
    expect(submitted.status).toBe(200);
    expect(submitted.body.attempt.score).toBe(4);
  });
});

// ===========================================================================
// Submission: exactly once
// ===========================================================================

describe('duplicate submission', () => {
  it('returns the existing result for a second submission without re-marking it', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    const first = await submitAttempt(cookies, attempt.id);
    expect(first.status).toBe(200);
    expect(first.body.alreadySubmitted).toBe(false);
    const submittedAt = (await MockTestAttempt.findById(attempt.id))!.submittedAt!.getTime();

    const second = await submitAttempt(cookies, attempt.id);
    expect(second.status).toBe(200);
    expect(second.body.alreadySubmitted).toBe(true);
    expect(second.body.attempt.score).toBe(first.body.attempt.score);
    // The recorded submission time did not move.
    expect((await MockTestAttempt.findById(attempt.id))!.submittedAt!.getTime()).toBe(submittedAt);
  });

  it('cannot change an answer after submitting, even though the answers are now visible', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['b'] });
    await submitAttempt(cookies, attempt.id);

    const res = await saveAnswer(cookies, attempt.id, {
      questionId: attempt.questions[0]!.id,
      selectedOptionKeys: ['a'],
    });

    expect(res.status).toBe(409);
    const stored = await MockTestAttempt.findById(attempt.id);
    expect(stored?.questions[0]?.selectedOptionKeys).toEqual(['b']);
    expect(stored?.score).toBe(-1);
  });

  it('grades once when two submissions arrive at the same moment', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const cookie = cookieHeader(cookies);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    const [a, b] = await Promise.all([
      request(app).post(`${API}/mock-tests/attempts/${attempt.id}/submit`).set('Cookie', cookie).send({}),
      request(app).post(`${API}/mock-tests/attempts/${attempt.id}/submit`).set('Cookie', cookie).send({}),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Exactly one of the two did the grading.
    expect([a.body.alreadySubmitted, b.body.alreadySubmitted].filter((value) => value === false)).toHaveLength(1);
    expect(a.body.attempt.score).toBe(b.body.attempt.score);

    // And exactly one lot of XP, whichever won.
    const activity = await StudentActivity.countDocuments({ type: 'mock_test_completed' });
    expect(activity).toBe(1);
  });
});

// ===========================================================================
// Grading
// ===========================================================================

describe('grading', () => {
  it('marks all four question types, with negative marking, at the marks the test set', async () => {
    const { adminCookies, taxonomy } = await seedBank([]);
    const single = await createPublishedQuestion(app, adminCookies, taxonomy, { questionText: 'Single choice?' });
    const multi = await createPublishedQuestion(app, adminCookies, taxonomy, {
      questionText: 'Which of these are prime?',
      type: 'multiple_choice',
      options: [
        { text: '$2$', isCorrect: true },
        { text: '$3$', isCorrect: true },
        { text: '$4$', isCorrect: false },
        { text: '$9$', isCorrect: false },
      ],
    });
    const boolean = await createPublishedQuestion(app, adminCookies, taxonomy, {
      questionText: 'Is $2+2=4$?',
      type: 'true_false',
      options: [],
      booleanAnswer: true,
    });
    const numeric = await createPublishedQuestion(app, adminCookies, taxonomy, {
      questionText: 'Give $\\pi$ to two places.',
      type: 'numeric',
      options: [],
      numericAnswer: 3.14,
      tolerance: 0.01,
    });

    // The bank prices each of these at 4 marks (see the fixture). This test prices them
    // at 10, which is the case a snapshot has to get right.
    const test = await publishedTest(adminCookies, [single.id, multi.id, boolean.id, numeric.id], {
      questions: [single.id, multi.id, boolean.id, numeric.id].map((id) => ({
        question: id,
        marks: 10,
        negativeMarks: 5,
      })),
    });
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    expect(attempt.maxMarks).toBe(40);

    const byId = new Map(attempt.questions.map((question) => [question.id, question]));
    expect(byId.get(single.id)!.marks).toBe(10);

    // Correct single choice: +10.
    await saveAnswer(cookies, attempt.id, { questionId: single.id, selectedOptionKeys: ['a'] });
    // Partially correct multiple choice: no partial credit, so −5.
    await saveAnswer(cookies, attempt.id, { questionId: multi.id, selectedOptionKeys: ['a'] });
    // Correct true/false: +10.
    await saveAnswer(cookies, attempt.id, { questionId: boolean.id, booleanResponse: true });
    // Numeric inside the tolerance: +10.
    await saveAnswer(cookies, attempt.id, { questionId: numeric.id, numericResponse: 3.145 });

    const res = await submitAttempt(cookies, attempt.id);

    expect(res.status).toBe(200);
    expect(res.body.attempt.score).toBe(25);
    expect(res.body.attempt.correctCount).toBe(3);
    expect(res.body.attempt.incorrectCount).toBe(1);
    expect(res.body.attempt.unansweredCount).toBe(0);
    expect(res.body.attempt.accuracy).toBe(75);
  });

  it('never penalises an unanswered question and reports accuracy over what was answered', async () => {
    const { adminCookies, questionIds } = await seedBank([{}, {}, {}]);
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);

    // One right, two left blank.
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    const res = await submitAttempt(cookies, attempt.id);

    expect(res.body.attempt.score).toBe(4);
    expect(res.body.attempt.unansweredCount).toBe(2);
    // 1 of 1 answered, not 1 of 3 served.
    expect(res.body.attempt.accuracy).toBe(100);
  });

  it('reports a negative total unclamped', async () => {
    const { adminCookies, questionIds } = await seedBank([{}, {}]);
    const test = await publishedTest(adminCookies, questionIds, {
      questions: questionIds.map((id) => ({ question: id, marks: 4, negativeMarks: 2 })),
    });
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);

    for (const question of attempt.questions) {
      await saveAnswer(cookies, attempt.id, { questionId: question.id, selectedOptionKeys: ['b'] });
    }

    const res = await submitAttempt(cookies, attempt.id);
    expect(res.body.attempt.score).toBe(-4);
    expect(res.body.attempt.accuracy).toBe(0);
  });

  it('gives an untouched paper zero rather than a penalty', async () => {
    const { adminCookies, questionIds } = await seedBank([{}, {}]);
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);

    const res = await submitAttempt(cookies, attempt.id);

    expect(res.body.attempt.score).toBe(0);
    expect(res.body.attempt.unansweredCount).toBe(2);
    // Nothing was attempted, so nothing was earned.
    expect(res.body.xpAwarded).toBe(0);
  });

  it('marks against the paper as served, not against a question edited afterwards', async () => {
    const { adminCookies, questionIds, taxonomy } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    // The author moves the correct answer to option B after the student answered A.
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

    const res = await submitAttempt(cookies, attempt.id);

    // Still correct: graded against the snapshot taken when the paper was served.
    expect(res.body.attempt.score).toBe(4);
    expect(res.body.attempt.correctCount).toBe(1);
    // And the student is told the question has since changed.
    expect(res.body.attempt.questions[0].revisionChanged).toBe(true);
  });
});

// ===========================================================================
// Disclosure — review according to the test's settings
// ===========================================================================

describe('disclosure', () => {
  it('reveals answers and explanations immediately when the test says so', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { reviewPolicy: 'immediate' });
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    const res = await submitAttempt(cookies, attempt.id);

    expect(res.body.disclosure.showResult).toBe(true);
    expect(res.body.disclosure.showReview).toBe(true);
    expect(res.body.attempt.questions[0].correctAnswer.optionKeys).toEqual(['a']);
    expect(res.body.attempt.questions[0].explanation).toMatch(/Factorise/);
  });

  it('withholds the answer key entirely when the review policy is never', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, {
      reviewPolicy: 'never',
      resultDisplay: 'immediate',
    });
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    const submitted = await submitAttempt(cookies, attempt.id);
    const reread = await readAttempt(cookies, attempt.id);

    for (const res of [submitted, reread]) {
      expect(res.status).toBe(200);
      // The score is shown, because `resultDisplay` allows it...
      expect(res.body.attempt.score).toBe(4);
      expect(res.body.disclosure.showReview).toBe(false);
      // ...but nothing that would reveal the key, and no per-question detail at all.
      expect(res.body.attempt.questions).toBeUndefined();
      const body = JSON.stringify(res.body);
      for (const name of ['correctAnswer', 'correctOptionKeys', 'solution', 'explanation']) {
        expect(body).not.toContain(name);
      }
    }
  });

  it('tells a student nothing at all when both settings withhold', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, {
      resultDisplay: 'hidden',
      reviewPolicy: 'never',
    });
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    const res = await submitAttempt(cookies, attempt.id);

    expect(res.body.submitted).toBe(true);
    expect(res.body.disclosure.showResult).toBe(false);
    expect(res.body.attempt.score).toBeUndefined();
    expect(res.body.attempt.accuracy).toBeUndefined();
    // The work was still graded and stored — the student simply is not shown it.
    const stored = await MockTestAttempt.findById(attempt.id);
    expect(stored?.score).toBe(4);
    expect(stored?.status).toBe('submitted');
  });

  it('releases the score and the answers only once the window has closed', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, {
      availableTo: minutesFromNow(120),
      resultDisplay: 'after_close',
      reviewPolicy: 'after_close',
    });
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });
    await submitAttempt(cookies, attempt.id);

    const whileOpen = await readAttempt(cookies, attempt.id);
    expect(whileOpen.body.disclosure.showResult).toBe(false);
    expect(whileOpen.body.disclosure.reason).toBe('awaiting-close');
    expect(whileOpen.body.attempt.score).toBeUndefined();
    expect(JSON.stringify(whileOpen.body)).not.toContain('correctAnswer');

    // The history row is withheld too, not merely hidden by the page that renders it.
    const history = await request(app)
      .get(`${API}/mock-tests/attempts`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(history.body.attempts[0].score).toBeNull();
    expect(history.body.attempts[0].resultAvailable).toBe(false);

    // The window closes.
    await MockTest.updateOne({ _id: test.id }, { $set: { availableTo: new Date(Date.now() - 1000) } });

    const afterClose = await readAttempt(cookies, attempt.id);
    expect(afterClose.body.disclosure.showResult).toBe(true);
    expect(afterClose.body.disclosure.showReview).toBe(true);
    expect(afterClose.body.attempt.score).toBe(4);
    expect(afterClose.body.attempt.questions[0].correctAnswer.optionKeys).toEqual(['a']);
  });

  it('never discloses anything about an attempt that is still open, whatever the settings', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds, { reviewPolicy: 'immediate' });
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);

    const res = await readAttempt(cookies, attempt.id);

    expect(res.body.attempt.status).toBe('in_progress');
    const body = JSON.stringify(res.body);
    for (const name of FORBIDDEN_BEFORE_REVEAL) {
      expect(body).not.toContain(name);
    }
  });
});

// ===========================================================================
// XP
// ===========================================================================

describe('experience points', () => {
  it('awards the mock-test XP once per day however many tests are submitted', async () => {
    const { adminCookies, questionIds } = await seedBank([{}, {}]);
    const first = await publishedTest(adminCookies, [questionIds[0]!], { title: 'Mock A' });
    const second = await publishedTest(adminCookies, [questionIds[1]!], { title: 'Mock B' });
    const { cookies } = await registerVerifyLogin(app);

    const a = await startAttempt(cookies, first.id);
    await saveAnswer(cookies, a.id, { questionId: a.questions[0]!.id, selectedOptionKeys: ['a'] });
    const firstSubmit = await submitAttempt(cookies, a.id);

    const b = await startAttempt(cookies, second.id);
    await saveAnswer(cookies, b.id, { questionId: b.questions[0]!.id, selectedOptionKeys: ['a'] });
    const secondSubmit = await submitAttempt(cookies, b.id);

    expect(firstSubmit.body.xpAwarded).toBe(XP_AWARDS.mock_test_completed);
    expect(secondSubmit.body.xpAwarded).toBe(0);
    expect(await StudentActivity.countDocuments({ type: 'mock_test_completed' })).toBe(1);
  });
});

// ===========================================================================
// Admin results
// ===========================================================================

describe('results for staff', () => {
  it('reports every attempt with cohort statistics, ranking and per-question outcomes', async () => {
    const { adminCookies, questionIds } = await seedBank([{}, {}]);
    const test = await publishedTest(adminCookies, questionIds);

    // Two students: one gets both right, the other one right and one wrong.
    const { cookies: strong } = await registerVerifyLogin(app);
    const strongAttempt = await startAttempt(strong, test.id);
    for (const question of strongAttempt.questions) {
      await saveAnswer(strong, strongAttempt.id, { questionId: question.id, selectedOptionKeys: ['a'] });
    }
    await submitAttempt(strong, strongAttempt.id);

    const { cookies: weaker } = await registerVerifyLogin(app, otherStudent);
    const weakerAttempt = await startAttempt(weaker, test.id);
    await saveAnswer(weaker, weakerAttempt.id, {
      questionId: weakerAttempt.questions[0]!.id,
      selectedOptionKeys: ['a'],
    });
    await saveAnswer(weaker, weakerAttempt.id, {
      questionId: weakerAttempt.questions[1]!.id,
      selectedOptionKeys: ['b'],
    });
    await submitAttempt(weaker, weakerAttempt.id);

    const res = await request(app)
      .get(`${API}/admin/mock-tests/${test.id}/results`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);

    expect(res.body.stats.attemptsStarted).toBe(2);
    expect(res.body.stats.attemptsSubmitted).toBe(2);
    expect(res.body.stats.distinctStudents).toBe(2);
    expect(res.body.stats.highestScore).toBe(8);
    expect(res.body.stats.lowestScore).toBe(3);
    expect(res.body.stats.averageScore).toBe(5.5);

    // Ranked best first, and the rows name the students.
    expect(res.body.rows[0].score).toBe(8);
    expect(res.body.rows[0].rank).toBe(1);
    expect(res.body.rows[1].rank).toBe(2);
    expect(res.body.rows[0].student.studentId).toMatch(/^AMIT_/);

    // Per-question: both got Q1 right, one of two got Q2 right.
    expect(res.body.questionStats[0].correct).toBe(2);
    expect(res.body.questionStats[0].correctPercent).toBe(100);
    expect(res.body.questionStats[1].correct).toBe(1);
    expect(res.body.questionStats[1].correctPercent).toBe(50);
  });

  it('gives tied scores the same rank', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);

    for (const overrides of [{}, otherStudent]) {
      const { cookies } = await registerVerifyLogin(app, overrides);
      const attempt = await startAttempt(cookies, test.id);
      await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });
      await submitAttempt(cookies, attempt.id);
    }

    const res = await request(app)
      .get(`${API}/admin/mock-tests/${test.id}/results`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);

    expect(res.body.rows.map((row: { rank: number }) => row.rank)).toEqual([1, 1]);
  });

  it('finalises an abandoned attempt when the results are read', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);
    const { cookies } = await registerVerifyLogin(app);
    const attempt = await startAttempt(cookies, test.id);
    await saveAnswer(cookies, attempt.id, { questionId: attempt.questions[0]!.id, selectedOptionKeys: ['a'] });

    // The student walks away and never comes back; the clock runs out.
    await expireAttempt(attempt.id);

    const res = await request(app)
      .get(`${API}/admin/mock-tests/${test.id}/results`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);

    expect(res.body.stats.attemptsInProgress).toBe(0);
    expect(res.body.stats.attemptsSubmitted).toBe(1);
    expect(res.body.stats.autoSubmittedCount).toBe(1);
    expect(res.body.rows[0].score).toBe(4);
    expect(res.body.rows[0].autoSubmitted).toBe(true);
  });

  it('reports an empty test honestly rather than with zeros that look like results', async () => {
    const { adminCookies, questionIds } = await seedBank();
    const test = await publishedTest(adminCookies, questionIds);

    const res = await request(app)
      .get(`${API}/admin/mock-tests/${test.id}/results`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);

    expect(res.body.stats.attemptsStarted).toBe(0);
    expect(res.body.stats.averageScore).toBeNull();
    expect(res.body.stats.highestScore).toBeNull();
    expect(res.body.questionStats[0].correctPercent).toBeNull();
    expect(res.body.rows).toEqual([]);
  });
});
