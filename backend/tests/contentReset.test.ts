import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import {
  AuditLog,
  DailyChallenge,
  DailyChallengeAttempt,
  MockTest,
  MockTestAttempt,
  Question,
  Student,
  StudentActivity,
  Subject,
  Topic,
} from '../src/models';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, loginRootAdmin, registerVerifyLogin } from './helpers/auth';
import { createTaxonomy, createPublishedQuestion, type Taxonomy } from './helpers/questions';

/**
 * Milestone 22 — the content reset.
 *
 * This is the most destructive capability in the product, so the suite is weighted towards
 * everything that should **stop** it rather than the deletion itself:
 *
 * - an ordinary admin (not just a student) is refused, because `content:reset` is super
 *   admin only and that is the whole safety argument for the feature existing at all;
 * - a wrong, empty or borrowed-from-another-scope confirmation phrase is refused;
 * - a reset that would orphan rows is refused **and names what to reset first**, checked
 *   at the moment of the write rather than only in the dialog;
 * - and what must survive is asserted explicitly: XP after mock tests are wiped, practice
 *   history after the question bank is wiped, chapters after questions are wiped.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/**
 * The root super admin, plus a subject/chapter/subtopic created through the real API.
 *
 * Driven through the API rather than written straight to the collections, because the
 * reset's blockers are about **references between real documents** and a hand-built
 * fixture is exactly where a missing one hides.
 */
async function rootWithTaxonomy(): Promise<{ root: Record<string, string>; taxonomy: Taxonomy }> {
  const root = await loginRootAdmin(app);
  const taxonomy = await createTaxonomy(app, root);
  return { root, taxonomy };
}

/** One published question in the seeded chapter. */
async function publishedQuestion(root: Record<string, string>, taxonomy: Taxonomy): Promise<string> {
  const { id } = await createPublishedQuestion(app, root, taxonomy);
  return id;
}

/** A mock test built from one question, in whatever state the caller needs. */
async function createMockTest(questionId: string, status: 'draft' | 'published' = 'draft') {
  return MockTest.create({
    title: 'Rehearsal',
    classLevel: 'Class 9',
    status,
    durationMinutes: 30,
    questions: [{ question: questionId, marks: 4, negativeMarks: 1, order: 1 }],
    totalMarks: 4,
    ...(status === 'published' ? { publishedAt: new Date() } : {}),
  });
}

function preview(scope: string, cookies: Record<string, string>): request.Test {
  return request(app).get(`${API}/admin/reset/${scope}/preview`).set('Cookie', cookieHeader(cookies));
}

function reset(scope: string, cookies: Record<string, string>, confirm: string): request.Test {
  return request(app).post(`${API}/admin/reset/${scope}`).set('Cookie', cookieHeader(cookies)).send({ confirm });
}

interface PreviewBody {
  preview: {
    scope: string
    label: string
    confirmPhrase: string
    deletes: Array<{ label: string; count: number; note?: string }>
    preserves: string[]
    blockers: Array<{ label: string; count: number; resolveWith: string | null }>
    canReset: boolean
    totalToDelete: number
  }
}

// ---------------------------------------------------------------------------
// Authorization — the first line, and the one that matters
// ---------------------------------------------------------------------------

describe('only a super admin may reset anything', () => {
  it('refuses an ordinary administrator', async () => {
    const admin = await createAdminSession(app, { email: 'reset-admin@example.com', mobile: '9600000001' });

    const previewRes = await preview('questions', admin.cookies);
    const resetRes = await reset('questions', admin.cookies, 'RESET QUESTIONS');

    // The point of the permission: an admin can already do a great deal, and emptying the
    // question bank an hour before an Olympiad is a different order of damage.
    expect(previewRes.status).toBe(403);
    expect(resetRes.status).toBe(403);
  });

  it('refuses a plain student and a guest, on both URL prefixes', async () => {
    const student = await registerVerifyLogin(app, { email: 'plain-reset@example.com', mobile: '9600000002' });

    const asStudent = await reset('chapters', student.cookies, 'RESET CHAPTERS');
    const asGuest = await request(app).post(`${API}/admin/reset/chapters`).send({ confirm: 'RESET CHAPTERS' });
    const onAlias = await request(app)
      .post('/api/admin/reset/chapters')
      .set('Cookie', cookieHeader(student.cookies))
      .send({ confirm: 'RESET CHAPTERS' });

    expect(asStudent.status).toBe(403);
    expect(asGuest.status).toBe(401);
    expect(onAlias.status).toBe(403);
  });

  it('deletes nothing when it refuses', async () => {
    const admin = await createAdminSession(app, { email: 'reset-admin@example.com', mobile: '9600000003' });
    const taxonomy = await createTaxonomy(app, admin.cookies);

    await reset('chapters', admin.cookies, 'RESET CHAPTERS').expect(403);

    // The assertion that matters: a 403 that had already deleted half the chapters would
    // pass a status-code-only test.
    expect(await Topic.countDocuments({})).toBeGreaterThan(0);
    expect(await Topic.findById(taxonomy.topicId)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The confirmation phrase
// ---------------------------------------------------------------------------

describe('the confirmation phrase', () => {
  it('refuses a missing one, and says nothing was deleted', async () => {
    const { root } = await rootWithTaxonomy();
    const before = await Topic.countDocuments({});

    const res = await request(app).post(`${API}/admin/reset/chapters`).set('Cookie', cookieHeader(root)).send({});

    expect(res.status).toBe(400);
    expect(await Topic.countDocuments({})).toBe(before);
  });

  it('refuses the wrong words, and names the right ones', async () => {
    const { root } = await rootWithTaxonomy();

    const res = await reset('chapters', root, 'yes delete everything');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('RESET CHAPTERS');
    expect(await Topic.countDocuments({})).toBeGreaterThan(0);
  });

  it("refuses another scope's phrase", async () => {
    const { root } = await rootWithTaxonomy();

    // The phrases differ per scope precisely so one dialog's confirmation cannot be
    // pasted into another and empty the wrong area.
    const res = await reset('chapters', root, 'RESET QUESTIONS');

    expect(res.status).toBe(400);
    expect(await Topic.countDocuments({})).toBeGreaterThan(0);
  });

  it('accepts the phrase with surrounding whitespace but not in the wrong case', async () => {
    const { root } = await rootWithTaxonomy();

    const wrongCase = await reset('chapters', root, 'reset chapters');
    expect(wrongCase.status).toBe(400);

    const padded = await reset('chapters', root, '  RESET CHAPTERS  ');
    expect(padded.status).toBe(200);
    expect(await Topic.countDocuments({})).toBe(0);
  });

  it('refuses an unknown scope rather than guessing at one', async () => {
    const root = await loginRootAdmin(app);

    const res = await request(app)
      .post(`${API}/admin/reset/students`)
      .set('Cookie', cookieHeader(root))
      .send({ confirm: 'RESET STUDENTS' });

    // There is no reset for students, payments or the official exam, and a typo must not
    // fall through to something that does exist.
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

describe('the preview', () => {
  it('counts what will go, from the collections', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    await publishedQuestion(root, taxonomy);
    await publishedQuestion(root, taxonomy);

    const body = (await preview('questions', root).expect(200)).body as PreviewBody;

    expect(body.preview.totalToDelete).toBe(2);
    expect(body.preview.deletes[0]?.count).toBe(2);
    // Spelled out by status, so "all questions" cannot be read as "the published ones".
    expect(body.preview.deletes[0]?.note).toContain('published');
    expect(body.preview.confirmPhrase).toBe('RESET QUESTIONS');
  });

  it('writes nothing', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    await publishedQuestion(root, taxonomy);

    await preview('questions', root).expect(200);
    await preview('chapters', root).expect(200);

    expect(await Question.countDocuments({})).toBe(1);
    expect(await Topic.countDocuments({})).toBeGreaterThan(0);
  });

  it('says what the reset will preserve, not only what it destroys', async () => {
    const root = await loginRootAdmin(app);

    const body = (await preview('mock-tests', root).expect(200)).body as PreviewBody;

    expect(body.preview.preserves.join(' ')).toContain('XP');
  });

  it('reports canReset false for an area that is already empty', async () => {
    const root = await loginRootAdmin(app);

    const body = (await preview('mock-tests', root).expect(200)).body as PreviewBody;

    expect(body.preview.totalToDelete).toBe(0);
    expect(body.preview.canReset).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Blockers — refuse, never cascade
// ---------------------------------------------------------------------------

describe('a reset that would orphan rows is refused', () => {
  it('will not empty the chapters while questions are filed under them', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    await publishedQuestion(root, taxonomy);

    const body = (await preview('chapters', root).expect(200)).body as PreviewBody;
    expect(body.preview.canReset).toBe(false);
    expect(body.preview.blockers[0]?.resolveWith).toBe('questions');

    const res = await reset('chapters', root, 'RESET CHAPTERS');

    // Refused at the moment of the write, not only in the dialog — and the message names
    // what to do about it.
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('question');
    expect(await Topic.countDocuments({})).toBeGreaterThan(0);
  });

  it('will not empty the question bank while a mock test is built from it', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    await createMockTest(await publishedQuestion(root, taxonomy));

    const res = await reset('questions', root, 'RESET QUESTIONS');

    expect(res.status).toBe(409);
    // Singular verb agreement included: this string is the only description of what is
    // about to be destroyed, and one that reads like a bug is one people stop believing.
    expect(res.body.error).toContain('1 mock test is built from these questions');
    expect(await Question.countDocuments({})).toBe(1);
  });

  it('resets cleanly once the blocker is cleared, in dependency order', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    await createMockTest(await publishedQuestion(root, taxonomy));

    await reset('mock-tests', root, 'RESET MOCK TESTS').expect(200);
    await reset('questions', root, 'RESET QUESTIONS').expect(200);
    await reset('chapters', root, 'RESET CHAPTERS').expect(200);

    expect(await MockTest.countDocuments({})).toBe(0);
    expect(await Question.countDocuments({})).toBe(0);
    expect(await Topic.countDocuments({})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// What each reset actually does
// ---------------------------------------------------------------------------

describe('resetting the question bank', () => {
  it('deletes every question whatever its status, including published ones', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    await publishedQuestion(root, taxonomy);
    await publishedQuestion(root, taxonomy);
    await Question.updateOne({}, { $set: { status: 'draft' } });

    const res = await reset('questions', root, 'RESET QUESTIONS').expect(200);

    // A single delete refuses anything ever published (`deleteQuestion()`); this
    // deliberately does not, which is exactly why it is super-admin-only and typed.
    expect(res.body.totalDeleted).toBe(2);
    expect(await Question.countDocuments({})).toBe(0);
  });

  it('leaves the chapters standing, so the bank can be refilled', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    await publishedQuestion(root, taxonomy);
    const chaptersBefore = await Topic.countDocuments({});

    await reset('questions', root, 'RESET QUESTIONS').expect(200);

    expect(await Topic.countDocuments({})).toBe(chaptersBefore);
  });
});

describe('resetting mock tests', () => {
  it('deletes the tests and their attempts together', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    const questionId = await publishedQuestion(root, taxonomy);
    const test = await createMockTest(questionId, 'published');
    const student = await registerVerifyLogin(app, { email: 'mocker@example.com', mobile: '9600000010' });
    const account = await Student.findOne({ studentId: student.studentId }).select('_id');

    await MockTestAttempt.create({
      test: test._id,
      student: account!._id,
      attemptNumber: 1,
      totalQuestions: 1,
      maxMarks: 4,
      durationMinutes: 30,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    expect(await MockTestAttempt.countDocuments({})).toBe(1);

    const res = await reset('mock-tests', root, 'RESET MOCK TESTS').expect(200);

    expect(await MockTest.countDocuments({})).toBe(0);
    // An attempt cannot outlive its paper: the student's page could not render it.
    expect(await MockTestAttempt.countDocuments({})).toBe(0);
    expect(res.body.totalDeleted).toBe(2);
  });

  it('does not take back the XP a student earned', async () => {
    const root = await loginRootAdmin(app);
    const student = await registerVerifyLogin(app, { email: 'xp@example.com', mobile: '9600000011' });
    expect(student.studentId).toBeTruthy();

    // Registration itself grants XP, so there is already activity to protect.
    const xpBefore = await StudentActivity.countDocuments({});
    expect(xpBefore).toBeGreaterThan(0);

    await reset('mock-tests', root, 'RESET MOCK TESTS');

    // The rule this protects: XP is a record of something that really happened, and
    // taking it back would re-rank the leaderboard against children who did nothing wrong.
    expect(await StudentActivity.countDocuments({})).toBe(xpBefore);
  });
});

describe('resetting daily challenges', () => {
  it('deletes the schedule and the attempts, and leaves the questions alone', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    const questionId = await publishedQuestion(root, taxonomy);

    await DailyChallenge.create({
      day: '2026-08-20',
      classLevel: 'Class 9',
      question: questionId,
      source: 'automatic',
      marks: 4,
    });

    await reset('daily-challenges', root, 'RESET DAILY CHALLENGES').expect(200);

    expect(await DailyChallenge.countDocuments({})).toBe(0);
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(0);
    // The question is bank content, not challenge content.
    expect(await Question.countDocuments({})).toBe(1);
  });
});

describe('resetting chapters', () => {
  it('deletes chapters and subtopics but keeps the subject', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();

    const res = await reset('chapters', root, 'RESET CHAPTERS').expect(200);

    expect(await Topic.countDocuments({})).toBe(0);
    expect(res.body.totalDeleted).toBeGreaterThan(0);

    // The subject survives. That matters rather than being incidental: `Topic` is scoped
    // by subject and `requireImplicitSubject()` refuses a write without one, so deleting
    // it here would leave an administrator unable to create the first replacement chapter.
    expect(await Subject.findById(taxonomy.subjectId)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

describe('every reset is on the record', () => {
  it('writes an audit entry carrying the counts, because afterwards nothing is left to count', async () => {
    const { root, taxonomy } = await rootWithTaxonomy();
    await publishedQuestion(root, taxonomy);
    await publishedQuestion(root, taxonomy);

    await reset('questions', root, 'RESET QUESTIONS').expect(200);

    const entry = await AuditLog.findOne({ action: 'content.reset' });
    expect(entry).not.toBeNull();
    expect(entry?.targetId).toBe('questions');
    expect(entry?.metadata?.totalDeleted).toBe(2);
    expect(entry?.actorLabel).toBeTruthy();
  });
});
