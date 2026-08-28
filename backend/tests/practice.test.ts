import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { PracticeSession, Student, StudentActivity } from '../src/models';
import { XP_AWARDS } from '../src/lib/xp';
import { gradeEntry, isAnswered } from '../src/services/practiceService';
import type { PracticeQuestionEntry } from '../src/models';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  clearTestInbox,
  cookieHeader,
  createAdminSession,
  otherStudent,
  registerVerifyLogin,
} from './helpers/auth';
import { createPublishedQuestion, createTaxonomy, type Taxonomy } from './helpers/questions';

/**
 * Milestone 6 — the Practice Zone.
 *
 * Two properties dominate this suite.
 *
 * **Answer integrity.** The correct answer must not reach the client before the
 * session is submitted. That is asserted not by inspecting one field but by
 * stringifying whole response bodies and requiring that the forbidden names and the
 * literal correct values are absent — the same technique the question-bank suite uses,
 * because it survives someone adding a field to a projection without thinking.
 *
 * **Grading is the server's.** Every marking rule is tested directly as a pure
 * function *and* through the API, including the cases that decide fairness: an
 * unanswered question must never be penalised, and a partially-correct
 * multiple-choice answer must not score.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** The field names that would give an answer away if they ever appeared. */
const FORBIDDEN_BEFORE_SUBMIT = ['isCorrect', 'correctOptionKeys', 'correctAnswer', 'booleanAnswer', 'numericAnswer', 'tolerance', 'solution', 'explanation', 'awardedMarks'];

async function seedBank(overridesList: Array<Record<string, unknown>> = [{}]): Promise<{
  adminCookies: Record<string, string>;
  taxonomy: Taxonomy;
  questionIds: string[];
}> {
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

async function startSession(
  cookies: Record<string, string>,
  body: Record<string, unknown> = {},
): Promise<Record<string, never> & { id: string; questions: Array<{ id: string; options: Array<{ key: string }> }> }> {
  const res = await request(app)
    .post(`${API}/practice/sessions`)
    .set('Cookie', cookieHeader(cookies))
    .send(body)
    .expect(201);
  return res.body.session;
}

async function saveAnswer(
  cookies: Record<string, string>,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app)
    .put(`${API}/practice/sessions/${sessionId}/answers`)
    .set('Cookie', cookieHeader(cookies))
    .send(body);
}

async function submit(cookies: Record<string, string>, sessionId: string): Promise<request.Response> {
  return request(app).post(`${API}/practice/sessions/${sessionId}/submit`).set('Cookie', cookieHeader(cookies));
}

/** A minimal snapshot entry, for testing the pure grading rules. */
function entry(overrides: Partial<PracticeQuestionEntry>): PracticeQuestionEntry {
  return {
    question: '000000000000000000000000' as unknown as PracticeQuestionEntry['question'],
    revision: 1,
    type: 'single_choice',
    marks: 4,
    negativeMarks: 1,
    correctOptionKeys: ['a'],
    booleanAnswer: null,
    numericAnswer: null,
    tolerance: null,
    acceptedAnswers: [],
    selectedOptionKeys: [],
    numericResponse: null,
    booleanResponse: null,
    answeredAt: null,
    isCorrect: null,
    awardedMarks: null,
    ...overrides,
  };
}

// ===========================================================================
// Pure grading rules
// ===========================================================================

describe('grading rules', () => {
  it('never penalises an unanswered question, whatever the negative marking', () => {
    const outcome = gradeEntry(entry({ negativeMarks: 4, selectedOptionKeys: [] }));
    expect(outcome).toEqual({ answered: false, isCorrect: false, awardedMarks: 0 });
  });

  it('awards the marks for a right single choice and deducts for a wrong one', () => {
    expect(gradeEntry(entry({ selectedOptionKeys: ['a'] })).awardedMarks).toBe(4);
    expect(gradeEntry(entry({ selectedOptionKeys: ['b'] })).awardedMarks).toBe(-1);
  });

  it('requires the exact set for multiple choice, so a partial answer scores nothing', () => {
    const base = { type: 'multiple_choice' as const, correctOptionKeys: ['a', 'c'] };
    expect(gradeEntry(entry({ ...base, selectedOptionKeys: ['a', 'c'] })).isCorrect).toBe(true);
    // Order must not matter.
    expect(gradeEntry(entry({ ...base, selectedOptionKeys: ['c', 'a'] })).isCorrect).toBe(true);
    // One of two right is not right.
    expect(gradeEntry(entry({ ...base, selectedOptionKeys: ['a'] })).isCorrect).toBe(false);
    // A superset is not right either.
    expect(gradeEntry(entry({ ...base, selectedOptionKeys: ['a', 'b', 'c'] })).isCorrect).toBe(false);
  });

  it('marks true/false against the stored boolean, and treats false as an answer', () => {
    const base = { type: 'true_false' as const, correctOptionKeys: [], booleanAnswer: false };
    expect(gradeEntry(entry({ ...base, booleanResponse: false })).isCorrect).toBe(true);
    expect(gradeEntry(entry({ ...base, booleanResponse: true })).isCorrect).toBe(false);
    // `false` is a real response, not an absent one — the classic falsy bug.
    expect(gradeEntry(entry({ ...base, booleanResponse: false })).answered).toBe(true);
  });

  it('accepts a numeric answer within tolerance and rejects one outside it', () => {
    const base = { type: 'numeric' as const, correctOptionKeys: [], numericAnswer: 3.14, tolerance: 0.01 };
    expect(gradeEntry(entry({ ...base, numericResponse: 3.14 })).isCorrect).toBe(true);
    expect(gradeEntry(entry({ ...base, numericResponse: 3.15 })).isCorrect).toBe(true);
    expect(gradeEntry(entry({ ...base, numericResponse: 3.2 })).isCorrect).toBe(false);
    // Zero tolerance means exact.
    expect(gradeEntry(entry({ ...base, tolerance: 0, numericResponse: 3.1400001 })).isCorrect).toBe(false);
    // Zero is a real response.
    expect(isAnswered(entry({ ...base, numericResponse: 0 }))).toBe(true);
  });

  it('treats a null tolerance as requiring an exact match', () => {
    const base = { type: 'numeric' as const, correctOptionKeys: [], numericAnswer: 10, tolerance: null };
    expect(gradeEntry(entry({ ...base, numericResponse: 10 })).isCorrect).toBe(true);
    expect(gradeEntry(entry({ ...base, numericResponse: 10.0001 })).isCorrect).toBe(false);
  });
});

// ===========================================================================
// Availability
// ===========================================================================

describe('GET /practice/options', () => {
  it('reports an empty bank honestly rather than offering something that cannot start', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/practice/options`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.subjects).toEqual([]);
    expect(res.body.classLevel).toBe('Class 9');
  });

  it('returns real per-topic counts and only the difficulties that exist', async () => {
    await seedBank([{ difficulty: 'Easy' }, { difficulty: 'Easy' }, { difficulty: 'Hard' }]);
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/practice/options`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.subjects).toHaveLength(1);
    const subject = res.body.subjects[0];
    expect(subject.subjectName).toBe('Mathematics');
    expect(subject.questionCount).toBe(3);
    // Medium was never published, so it must not be offered.
    expect(subject.difficulties).toEqual(['Easy', 'Hard']);
    expect(subject.topics[0].topicName).toBe('Algebra');
    expect(subject.topics[0].questionCount).toBe(3);
  });

  it('does not count questions published for another class', async () => {
    await seedBank([{ classLevel: 'Class 6' }]);
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/practice/options`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(res.body.subjects).toEqual([]);
  });

  /**
   * The Mathematics-only scope, enforced where it is served rather than where it is displayed.
   *
   * Milestone 21 Phase J removed the subject dropdown, and the practice page now flattens every
   * subject's chapters into one list. On a database still holding a legacy second subject that
   * turned a stray Physics chapter into an offer of maths practice. Hiding it in the browser would
   * not have been enough — the session endpoint would still serve the questions.
   */
  it('does not offer another subject’s chapters now that nobody picks a subject', async () => {
    const { adminCookies } = await seedBank();
    const physics = await createTaxonomy(app, adminCookies, {
      subject: 'Physics',
      topic: 'Semiconductor Electronics',
    });
    await createPublishedQuestion(app, adminCookies, physics);

    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/practice/options`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.subjects).toHaveLength(1);
    expect(res.body.subjects[0].subjectName).toBe('Mathematics');
    const topicNames = res.body.subjects[0].topics.map((topic: { topicName: string }) => topic.topicName);
    expect(topicNames).not.toContain('Semiconductor Electronics');
  });

  it('refuses a guest', async () => {
    await request(app).get(`${API}/practice/options`).expect(401);
  });
});

// ===========================================================================
// Starting a session
// ===========================================================================

describe('POST /practice/sessions', () => {
  it('refuses when nothing published matches the selection', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app).post(`${API}/practice/sessions`).set('Cookie', cookieHeader(cookies)).send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no published questions/i);
  });

  it('serves a paper and persists the session with its questions', async () => {
    await seedBank([{}, {}, {}]);
    const { cookies, studentId } = await registerVerifyLogin(app);

    const session = await startSession(cookies, { questionCount: 3 });

    expect(session.questions).toHaveLength(3);

    // Read the document back rather than trusting the response.
    const stored = await PracticeSession.findById(session.id);
    const account = await Student.findOne({ studentId });
    expect(stored).not.toBeNull();
    expect(String(stored!.student)).toBe(String(account!._id));
    expect(stored!.status).toBe('in_progress');
    expect(stored!.totalQuestions).toBe(3);
    expect(stored!.maxMarks).toBe(12); // 3 questions at 4 marks
    // The answer key was snapshotted at serve time.
    expect(stored!.questions[0]!.correctOptionKeys).toEqual(['a']);
    expect(stored!.questions[0]!.revision).toBe(1);
  });

  it('gives however many questions really exist when fewer than asked for', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);

    const session = await startSession(cookies, { questionCount: 25 });
    expect(session.questions).toHaveLength(1);
  });

  it('draws only from the caller’s own class, and ignores a class sent in the body', async () => {
    await seedBank([{ classLevel: 'Class 6' }, { classLevel: 'Class 9' }]);
    const { cookies } = await registerVerifyLogin(app);

    // A Class 9 student asking for Class 6 must still get their own class.
    const session = await startSession(cookies, { questionCount: 10, classLevel: 'Class 6' });

    expect(session.questions).toHaveLength(1);
    const stored = await PracticeSession.findById(session.id);
    expect(stored!.filters.classLevel).toBe('Class 9');
  });

  it('narrows by topic and difficulty', async () => {
    const { adminCookies, taxonomy } = await seedBank([{ difficulty: 'Easy' }, { difficulty: 'Hard' }]);
    const other = await createTaxonomy(app, adminCookies, { subject: 'Geometry', topic: 'Circles', subtopic: 'Arcs' });
    await createPublishedQuestion(app, adminCookies, other, { difficulty: 'Easy' });

    const { cookies } = await registerVerifyLogin(app);

    const byDifficulty = await startSession(cookies, { difficulty: 'Hard', questionCount: 10 });
    expect(byDifficulty.questions).toHaveLength(1);

    const byTopic = await startSession(cookies, { topicId: taxonomy.topicId, questionCount: 10 });
    expect(byTopic.questions).toHaveLength(2);
  });

  /**
   * The one that actually decides what a child is marked on: mixed practice must mean mixed
   * *mathematics*. The picker sends no `subjectId` at all since Phase J, so without this the draw
   * ran over every subject in the database and the answer-key snapshot would make a Physics
   * question a real mark on a maths report.
   */
  it('draws mixed practice from the implicit subject only', async () => {
    const { adminCookies } = await seedBank([{}, {}]);
    const physics = await createTaxonomy(app, adminCookies, {
      subject: 'Physics',
      topic: 'Semiconductor Electronics',
    });
    for (let i = 0; i < 5; i += 1) await createPublishedQuestion(app, adminCookies, physics);

    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies, { questionCount: 20 });

    // Seven published questions exist for this class; only the two mathematics ones may be dealt.
    expect(session.questions).toHaveLength(2);
  });

  it('rejects a malformed subject id instead of searching for it', async () => {
    await seedBank();
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app)
      .post(`${API}/practice/sessions`)
      .set('Cookie', cookieHeader(cookies))
      .send({ subjectId: 'not-an-id' });

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });

  it('refuses a guest', async () => {
    await request(app).post(`${API}/practice/sessions`).send({}).expect(401);
  });
});

// ===========================================================================
// Answer integrity — the property that matters most
// ===========================================================================

describe('answer integrity', () => {
  it('does not reveal the answer key when a session is started', async () => {
    await seedBank([{}, {}]);
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app)
      .post(`${API}/practice/sessions`)
      .set('Cookie', cookieHeader(cookies))
      .send({ questionCount: 2 })
      .expect(201);

    const body = JSON.stringify(res.body);
    for (const name of FORBIDDEN_BEFORE_SUBMIT) {
      expect(body, `start response leaks ${name}`).not.toContain(name);
    }
    // And the worked solution's distinctive text is nowhere in it.
    expect(body).not.toContain('Factorise');
  });

  it('does not reveal the answer key when an in-progress session is re-read', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);

    const res = await request(app)
      .get(`${API}/practice/sessions/${session.id}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    const body = JSON.stringify(res.body);
    for (const name of FORBIDDEN_BEFORE_SUBMIT) {
      expect(body, `resume response leaks ${name}`).not.toContain(name);
    }
  });

  it('does not tell the student whether a saved answer was right', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);
    const question = session.questions[0]!;

    const res = await saveAnswer(cookies, session.id, {
      questionId: question.id,
      selectedOptionKeys: [question.options[0]!.key],
    });

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    for (const name of FORBIDDEN_BEFORE_SUBMIT) {
      expect(body, `save response leaks ${name}`).not.toContain(name);
    }
  });

  it('refuses to review a session that has not been submitted', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);

    // The GET falls back to the in-progress view rather than revealing, and the
    // review shape is simply absent from it.
    const res = await request(app)
      .get(`${API}/practice/sessions/${session.id}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.session.score).toBeUndefined();
    expect(res.body.session.status).toBe('in_progress');
  });

  it('reveals the answer and the explanation only after submission', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);
    const question = session.questions[0]!;
    await saveAnswer(cookies, session.id, { questionId: question.id, selectedOptionKeys: [question.options[0]!.key] });

    const res = await submit(cookies, session.id);
    expect(res.status).toBe(200);

    const reviewed = res.body.session.questions[0];
    expect(reviewed.correctAnswer.optionKeys).toEqual(['a']);
    expect(reviewed.explanation).toContain('Factorise');
    expect(reviewed.outcome.isCorrect).toBe(true);
  });

  it('keeps one student out of another student’s session entirely', async () => {
    await seedBank([{}]);
    const mine = await registerVerifyLogin(app);
    const theirs = await registerVerifyLogin(app, { ...otherStudent, email: 'nosy@example.com', mobile: '9000000009' });

    const session = await startSession(mine.cookies);

    // Indistinguishable from a session that does not exist — no 403 that would
    // confirm the id is real.
    const read = await request(app)
      .get(`${API}/practice/sessions/${session.id}`)
      .set('Cookie', cookieHeader(theirs.cookies));
    expect(read.status).toBe(404);

    const answered = await saveAnswer(theirs.cookies, session.id, {
      questionId: session.questions[0]!.id,
      selectedOptionKeys: ['a'],
    });
    expect(answered.status).toBe(404);

    const submitted = await submit(theirs.cookies, session.id);
    expect(submitted.status).toBe(404);

    // And mine is untouched.
    const stored = await PracticeSession.findById(session.id);
    expect(stored!.status).toBe('in_progress');
  });
});

// ===========================================================================
// Answering and navigating
// ===========================================================================

describe('PUT /practice/sessions/:id/answers', () => {
  it('persists an answer and reports progress', async () => {
    await seedBank([{}, {}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies, { questionCount: 2 });
    const first = session.questions[0]!;

    const res = await saveAnswer(cookies, session.id, {
      questionId: first.id,
      selectedOptionKeys: [first.options[1]!.key],
    });

    expect(res.status).toBe(200);
    expect(res.body.answeredCount).toBe(1);
    expect(res.body.totalQuestions).toBe(2);

    const stored = await PracticeSession.findById(session.id);
    const entryFor = stored!.questions.find((q) => String(q.question) === first.id)!;
    expect(entryFor.selectedOptionKeys).toEqual([first.options[1]!.key]);
    expect(entryFor.answeredAt).not.toBeNull();
    // Not graded yet.
    expect(entryFor.isCorrect).toBeNull();
  });

  it('lets a student change and then clear an answer', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);
    const question = session.questions[0]!;

    await saveAnswer(cookies, session.id, { questionId: question.id, selectedOptionKeys: ['a'] });
    await saveAnswer(cookies, session.id, { questionId: question.id, selectedOptionKeys: ['b'] });
    let stored = await PracticeSession.findById(session.id);
    expect(stored!.questions[0]!.selectedOptionKeys).toEqual(['b']);

    const cleared = await saveAnswer(cookies, session.id, { questionId: question.id, selectedOptionKeys: [] });
    expect(cleared.body.answeredCount).toBe(0);
    stored = await PracticeSession.findById(session.id);
    expect(stored!.questions[0]!.answeredAt).toBeNull();
  });

  it('refuses an option key the question never offered', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);

    const res = await saveAnswer(cookies, session.id, {
      questionId: session.questions[0]!.id,
      selectedOptionKeys: ['zz'],
    });
    expect(res.status).toBe(400);
  });

  it('refuses more than one option on a single-choice question', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);

    const res = await saveAnswer(cookies, session.id, {
      questionId: session.questions[0]!.id,
      selectedOptionKeys: ['a', 'b'],
    });
    expect(res.status).toBe(400);
  });

  it('refuses a question that is not part of the session', async () => {
    const { adminCookies, taxonomy } = await seedBank([{}]);
    const outsider = await createPublishedQuestion(app, adminCookies, taxonomy, { difficulty: 'Hard' });
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies, { difficulty: 'Medium' });

    const res = await saveAnswer(cookies, session.id, { questionId: outsider.id, selectedOptionKeys: ['a'] });
    expect(res.status).toBe(404);
  });

  it('refuses to change an answer after submission', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);
    await submit(cookies, session.id);

    const res = await saveAnswer(cookies, session.id, {
      questionId: session.questions[0]!.id,
      selectedOptionKeys: ['a'],
    });
    expect(res.status).toBe(409);
  });
});

// ===========================================================================
// Submitting and scoring
// ===========================================================================

describe('POST /practice/sessions/:id/submit', () => {
  it('scores a mixed paper correctly and persists every part of it', async () => {
    // Three questions: one answered right, one answered wrong, one left blank.
    await seedBank([{}, {}, {}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies, { questionCount: 3 });

    await saveAnswer(cookies, session.id, { questionId: session.questions[0]!.id, selectedOptionKeys: ['a'] });
    await saveAnswer(cookies, session.id, { questionId: session.questions[1]!.id, selectedOptionKeys: ['b'] });

    const res = await submit(cookies, session.id);
    expect(res.status).toBe(200);

    const graded = res.body.session;
    expect(graded.status).toBe('submitted');
    expect(graded.correctCount).toBe(1);
    expect(graded.incorrectCount).toBe(1);
    expect(graded.unansweredCount).toBe(1);
    // +4 for the right one, -1 for the wrong one, 0 for the blank.
    expect(graded.score).toBe(3);
    expect(graded.maxMarks).toBe(12);
    // Accuracy is over *answered*: one of two.
    expect(graded.accuracy).toBe(50);

    const stored = await PracticeSession.findById(session.id);
    expect(stored!.status).toBe('submitted');
    expect(stored!.score).toBe(3);
    expect(stored!.correctCount).toBe(1);
    expect(stored!.unansweredCount).toBe(1);
    expect(stored!.submittedAt).not.toBeNull();
    expect(stored!.timeTakenSeconds).toBeGreaterThanOrEqual(0);
    // Per-question outcomes were written.
    const outcomes = stored!.questions.map((q) => q.awardedMarks);
    expect(outcomes).toContain(4);
    expect(outcomes).toContain(-1);
    expect(outcomes).toContain(0);
  });

  it('reports zero rather than a negative total is not clamped — the arithmetic is honest', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);

    await saveAnswer(cookies, session.id, { questionId: session.questions[0]!.id, selectedOptionKeys: ['b'] });
    const res = await submit(cookies, session.id);

    // One wrong answer at -1 with nothing right: the score really is -1.
    expect(res.body.session.score).toBe(-1);
    expect(res.body.session.accuracy).toBe(0);
  });

  it('gives an untouched paper a zero score and no penalty', async () => {
    await seedBank([{}, {}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies, { questionCount: 2 });

    const res = await submit(cookies, session.id);

    expect(res.body.session.score).toBe(0);
    expect(res.body.session.unansweredCount).toBe(2);
    expect(res.body.session.accuracy).toBe(0);
  });

  it('marks a true/false and a numeric question through the API', async () => {
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
      questionText: 'What is $\\pi$ to two places?',
      type: 'numeric',
      options: [],
      numericAnswer: 3.14,
      tolerance: 0.01,
      marks: 3,
      negativeMarks: 0,
    });

    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies, { questionCount: 2 });

    for (const question of session.questions) {
      const isBoolean = (question as unknown as { type: string }).type === 'true_false';
      await saveAnswer(cookies, session.id, {
        questionId: question.id,
        ...(isBoolean ? { booleanResponse: true } : { numericResponse: 3.145 }),
      });
    }

    const res = await submit(cookies, session.id);
    expect(res.body.session.correctCount).toBe(2);
    expect(res.body.session.score).toBe(5);
  });

  it('cannot be submitted twice', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);

    await submit(cookies, session.id).then((res) => expect(res.status).toBe(200));
    const again = await submit(cookies, session.id);
    expect(again.status).toBe(409);
  });

  it('returns 404 for a session id that does not exist', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await submit(cookies, '0123456789abcdef01234567');
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
  });
});

// ===========================================================================
// XP
// ===========================================================================

describe('practice XP', () => {
  it('awards XP once for a session with real work in it', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);
    await saveAnswer(cookies, session.id, { questionId: session.questions[0]!.id, selectedOptionKeys: ['a'] });

    const res = await submit(cookies, session.id);
    expect(res.body.xpAwarded).toBe(XP_AWARDS.practice_completed);

    const logged = await StudentActivity.find({ type: 'practice_completed' });
    expect(logged).toHaveLength(1);
    expect(logged[0]!.xpAwarded).toBe(XP_AWARDS.practice_completed);
  });

  it('does not award XP again for a second session on the same day', async () => {
    await seedBank([{}, {}]);
    const { cookies } = await registerVerifyLogin(app);

    const first = await startSession(cookies);
    await saveAnswer(cookies, first.id, { questionId: first.questions[0]!.id, selectedOptionKeys: ['a'] });
    await submit(cookies, first.id);

    const second = await startSession(cookies);
    await saveAnswer(cookies, second.id, { questionId: second.questions[0]!.id, selectedOptionKeys: ['a'] });
    const res = await submit(cookies, second.id);

    expect(res.body.xpAwarded).toBe(0);
    // The session itself is still recorded in full — only the XP is capped.
    expect(await PracticeSession.countDocuments({ status: 'submitted' })).toBe(2);
    expect(await StudentActivity.countDocuments({ type: 'practice_completed' })).toBe(1);
  });

  it('awards nothing for submitting a paper with no answers', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);

    const res = await submit(cookies, session.id);

    expect(res.body.xpAwarded).toBe(0);
    expect(await StudentActivity.countDocuments({ type: 'practice_completed' })).toBe(0);
  });

  it('shows the completed practice on the dashboard activity feed', async () => {
    await seedBank([{}]);
    const { cookies } = await registerVerifyLogin(app);
    const session = await startSession(cookies);
    await saveAnswer(cookies, session.id, { questionId: session.questions[0]!.id, selectedOptionKeys: ['a'] });
    await submit(cookies, session.id);

    const dash = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies)).expect(200);
    const types = dash.body.dashboard.activity.map((a: { type: string }) => a.type);
    expect(types).toContain('practice_completed');
  });
});

// ===========================================================================
// History
// ===========================================================================

describe('GET /practice/sessions', () => {
  it('is empty for a student who has never practised', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/practice/sessions`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.sessions).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('lists the student’s own sessions newest first, without any answers', async () => {
    await seedBank([{}, {}]);
    const { cookies } = await registerVerifyLogin(app);

    const first = await startSession(cookies);
    await saveAnswer(cookies, first.id, { questionId: first.questions[0]!.id, selectedOptionKeys: ['a'] });
    await submit(cookies, first.id);
    await startSession(cookies);

    const res = await request(app).get(`${API}/practice/sessions`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.sessions).toHaveLength(2);
    // Newest first: the still-open one.
    expect(res.body.sessions[0].status).toBe('in_progress');
    expect(res.body.sessions[0].score).toBeNull();
    expect(res.body.sessions[1].status).toBe('submitted');
    expect(res.body.sessions[1].score).toBe(4);

    // A history listing must not carry per-question detail or answers.
    const body = JSON.stringify(res.body);
    for (const name of ['correctOptionKeys', 'solution', 'selectedOptionKeys']) {
      expect(body, `history leaks ${name}`).not.toContain(name);
    }
  });

  it('does not show one student another student’s sessions', async () => {
    await seedBank([{}]);
    const mine = await registerVerifyLogin(app);
    await startSession(mine.cookies);

    const theirs = await registerVerifyLogin(app, { ...otherStudent, email: 'peer@example.com', mobile: '9000000008' });
    const res = await request(app).get(`${API}/practice/sessions`).set('Cookie', cookieHeader(theirs.cookies)).expect(200);

    expect(res.body.sessions).toEqual([]);
  });
});
