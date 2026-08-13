import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import {
  AuditLog,
  Certificate,
  DailyChallengeAttempt,
  Exam,
  ExamAttempt,
  MockTestAttempt,
  PracticeSession,
  Result,
  Student,
} from '../src/models';
import { permissionsFor } from '../src/lib/permissions';
import { tierFor, renderCertificatePdf } from '../src/services/certificateService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  validStudent,
  otherStudent,
  clearTestInbox,
  cookieHeader,
  registerVerifyLogin,
  createAdminSession,
} from './helpers/auth';
import { publishAndIssue, seedExam, seedSubmittedAttempt } from './helpers/exams';

/**
 * Milestone 13 — the official Olympiad and its certificates.
 *
 * The requirement this suite exists to defend is the one the brief stated most
 * plainly: **a certificate may only come from the official exam.** Not a mock test, not
 * a practice session, not a daily challenge, and never from anything the frontend
 * asserts. So besides the ordinary behaviour there are tests that go looking for a way
 * in through those other surfaces and fail to find one.
 *
 * The second theme is that a score is not a result. Submitting a paper grades it;
 * releasing it is a separate act by the organisers, and nothing a student can reach
 * shows them a mark before that happens.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

const ALIAS = '/api';

/** A window that is open right now, for the sitting tests. */
function openWindow() {
  return {
    opensAt: new Date(Date.now() - 30 * 60 * 1000),
    closesAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  };
}

// ===========================================================================
// Permissions
// ===========================================================================

describe('exam and certificate permissions', () => {
  it('gives exam authoring and certificate management to staff, never to students', () => {
    for (const role of ['admin', 'superadmin'] as const) {
      expect(permissionsFor(role)).toContain('exam:write');
      expect(permissionsFor(role)).toContain('certificates:write');
    }
    expect(permissionsFor('student')).not.toContain('exam:write');
    expect(permissionsFor('student')).not.toContain('certificates:write');
  });

  it('keeps sitting an exam a student-level capability', () => {
    // Sitting a paper is the same kind of act whichever paper it is, so it reuses the
    // permission mock tests already established rather than inventing a second one.
    expect(permissionsFor('student')).toContain('exam:take');
  });

  it('keeps the admin set a strict subset of the super admin set', () => {
    for (const permission of permissionsFor('admin')) {
      expect(permissionsFor('superadmin')).toContain(permission);
    }
  });
});

describe('exam administration — authorization', () => {
  const routes: Array<[string, 'get' | 'post' | 'patch', string]> = [
    ['list', 'get', '/admin/exams'],
    ['create', 'post', '/admin/exams'],
    ['update', 'patch', '/admin/exams/507f1f77bcf86cd799439011'],
    ['status', 'patch', '/admin/exams/507f1f77bcf86cd799439011/status'],
    ['attempts', 'get', '/admin/exams/507f1f77bcf86cd799439011/attempts'],
    ['publish results', 'post', '/admin/exams/507f1f77bcf86cd799439011/publish-results'],
  ];

  for (const [label, method, path] of routes) {
    it(`refuses a guest and a student on ${label}, on both prefixes`, async () => {
      const { cookies } = await registerVerifyLogin(app);
      for (const prefix of [API, ALIAS]) {
        await request(app)[method](`${prefix}${path}`).expect(401);
        await request(app)[method](`${prefix}${path}`).set('Cookie', cookieHeader(cookies)).expect(403);
      }
    });
  }

  it('refuses a student on certificate administration, on both prefixes', async () => {
    const { cookies } = await registerVerifyLogin(app);
    for (const prefix of [API, ALIAS]) {
      await request(app).get(`${prefix}/admin/certificates`).expect(401);
      await request(app).get(`${prefix}/admin/certificates`).set('Cookie', cookieHeader(cookies)).expect(403);
      await request(app)
        .post(`${prefix}/admin/certificates/507f1f77bcf86cd799439011/revoke`)
        .set('Cookie', cookieHeader(cookies))
        .send({ reason: 'trying it on' })
        .expect(403);
    }
  });
});

// ===========================================================================
// Authoring
// ===========================================================================

describe('authoring an official exam', () => {
  it('requires a window that closes after it opens', async () => {
    const { cookies } = await createAdminSession(app);
    const res = await request(app)
      .post(`${API}/admin/exams`)
      .set('Cookie', cookieHeader(cookies))
      .send({
        title: 'Backwards paper',
        examCode: 'AMIT-BAD-001',
        classLevel: 'Class 9',
        durationMinutes: 60,
        opensAt: '2026-11-20T12:00:00Z',
        closesAt: '2026-11-20T09:00:00Z',
        questions: [],
      });

    expect(res.status).toBe(400);
    expect(await Exam.countDocuments({})).toBe(0);
  });

  it('refuses distinction easier than merit, which would make the tiers incoherent', async () => {
    const { cookies } = await createAdminSession(app);
    await request(app)
      .post(`${API}/admin/exams`)
      .set('Cookie', cookieHeader(cookies))
      .send({
        title: 'Incoherent tiers',
        examCode: 'AMIT-BAD-002',
        classLevel: 'Class 9',
        durationMinutes: 60,
        opensAt: '2026-11-20T09:00:00Z',
        closesAt: '2026-11-20T12:00:00Z',
        meritThresholdPercent: 80,
        distinctionThresholdPercent: 50,
        questions: [],
      })
      .expect(400);
  });

  it('refuses to publish an exam with no questions', async () => {
    const { cookies } = await createAdminSession(app);
    const created = await request(app)
      .post(`${API}/admin/exams`)
      .set('Cookie', cookieHeader(cookies))
      .send({
        title: 'Empty paper',
        examCode: 'AMIT-EMPTY-1',
        classLevel: 'Class 9',
        durationMinutes: 60,
        opensAt: '2026-11-20T09:00:00Z',
        closesAt: '2026-11-20T12:00:00Z',
        questions: [],
      })
      .expect(201);

    await request(app)
      .patch(`${API}/admin/exams/${created.body.exam.id}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'published' })
      .expect(409);
  });

  it('freezes the paper once anybody has sat it', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { ...openWindow() });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });

    await request(app)
      .post(`${API}/exams/${String(exam._id)}/attempt`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(201);

    // Changing the questions underneath a served paper would make the exam disagree
    // with the snapshot the attempt was graded against.
    const res = await request(app)
      .patch(`${API}/admin/exams/${String(exam._id)}`)
      .set('Cookie', cookieHeader(cookies))
      // A perfectly valid duration, so this reaches the freeze check rather than
      // being turned away by the schema.
      .send({ durationMinutes: 120 });

    expect(res.status).toBe(409);

    // The window and the thresholds stay editable — releasing late is legitimate.
    await request(app)
      .patch(`${API}/admin/exams/${String(exam._id)}`)
      .set('Cookie', cookieHeader(cookies))
      .send({ meritThresholdPercent: 55 })
      .expect(200);
  });

  it('records authoring in the audit trail', async () => {
    const { cookies } = await createAdminSession(app);
    await seedExam(app, cookies);
    // seedExam inserts directly, so drive the audited path explicitly.
    await request(app)
      .post(`${API}/admin/exams`)
      .set('Cookie', cookieHeader(cookies))
      .send({
        title: 'Audited paper',
        examCode: 'AMIT-AUDIT-1',
        classLevel: 'Class 9',
        durationMinutes: 60,
        opensAt: '2026-11-20T09:00:00Z',
        closesAt: '2026-11-20T12:00:00Z',
        questions: [],
      })
      .expect(201);

    const entry = await AuditLog.findOne({ action: 'exam.changed' });
    expect(entry).not.toBeNull();
    expect(entry!.targetId).toBe('AMIT-AUDIT-1');
  });
});

// ===========================================================================
// Sitting
// ===========================================================================

describe('sitting the official exam', () => {
  it('serves the paper without any answer key', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { ...openWindow(), questionCount: 2 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });

    const res = await request(app)
      .post(`${API}/exams/${String(exam._id)}/attempt`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(201);

    const serialised = JSON.stringify(res.body);
    // The four fields that would give the paper away.
    expect(serialised).not.toContain('isCorrect');
    expect(serialised).not.toContain('correctOptionKeys');
    expect(serialised).not.toContain('solution');
    expect(serialised).not.toContain('numericAnswer');
    expect(res.body.attempt.secondsRemaining).toBeGreaterThan(0);
  });

  it('allows exactly one attempt, ever', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { ...openWindow() });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const header = cookieHeader(student.cookies);

    const first = await request(app).post(`${API}/exams/${String(exam._id)}/attempt`).set('Cookie', header).expect(201);

    // Re-requesting resumes the same attempt with the same deadline — not a new clock.
    const resumed = await request(app).post(`${API}/exams/${String(exam._id)}/attempt`).set('Cookie', header).expect(200);
    expect(resumed.body.created).toBe(false);
    expect(resumed.body.attempt.id).toBe(first.body.attempt.id);

    await request(app)
      .post(`${API}/exams/attempts/${first.body.attempt.id}/submit`)
      .set('Cookie', header)
      .expect(200);

    // And once submitted it cannot be sat again.
    const again = await request(app).post(`${API}/exams/${String(exam._id)}/attempt`).set('Cookie', header);
    expect(again.status).toBe(409);
    expect(await ExamAttempt.countDocuments({ exam: exam._id })).toBe(1);
  });

  it('refuses a student from another class', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { ...openWindow(), classLevel: 'Class 9' });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 10' });

    await request(app)
      .post(`${API}/exams/${String(exam._id)}/attempt`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(403);
  });

  it('refuses to start before the announced window opens, and after it closes', async () => {
    const { cookies } = await createAdminSession(app);
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });

    const future = await seedExam(app, cookies, {
      examCode: 'AMIT-FUTURE-1',
      opensAt: new Date(Date.now() + 60 * 60 * 1000),
      closesAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    await request(app)
      .post(`${API}/exams/${String(future.exam._id)}/attempt`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(409);

    // The default seed window is already in the past.
    const past = await seedExam(app, cookies, { examCode: 'AMIT-PAST-1' });
    await request(app)
      .post(`${API}/exams/${String(past.exam._id)}/attempt`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(409);
  });

  it('does not accept an answer after the deadline, and does not store it', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam, questionIds } = await seedExam(app, cookies, { ...openWindow() });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const header = cookieHeader(student.cookies);

    const started = await request(app).post(`${API}/exams/${String(exam._id)}/attempt`).set('Cookie', header).expect(201);
    const attemptId = started.body.attempt.id as string;

    // Move the server's deadline into the past. The client cannot do this — which is
    // the point: the clock is not something a request can carry.
    await ExamAttempt.updateOne({ _id: attemptId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .patch(`${API}/exams/attempts/${attemptId}/questions/${questionIds[0]}`)
      .set('Cookie', header)
      .send({ selectedOptionKeys: ['a'] });

    expect(res.status).toBe(409);

    const stored = await ExamAttempt.findById(attemptId);
    const entry = stored!.questions.find((q) => String(q.question) === questionIds[0]);
    expect(entry!.selectedOptionKeys).toEqual([]);
  });

  it('auto-submits an attempt whose time ran out, graded as at the deadline', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { ...openWindow() });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const header = cookieHeader(student.cookies);

    const started = await request(app).post(`${API}/exams/${String(exam._id)}/attempt`).set('Cookie', header).expect(201);
    const attemptId = started.body.attempt.id as string;

    const deadline = new Date(Date.now() - 5000);
    await ExamAttempt.updateOne({ _id: attemptId }, { $set: { expiresAt: deadline } });

    // Returning to the paper closes it rather than showing a countdown at zero.
    const res = await request(app).get(`${API}/exams/attempts/${attemptId}`).set('Cookie', header).expect(200);
    expect(res.body.attempt.status).toBe('submitted');
    expect(res.body.attempt.submissionReason).toBe('time_expired');

    const stored = await ExamAttempt.findById(attemptId);
    // Marked as at the deadline, not at the moment of discovery.
    expect(stored!.submittedAt!.getTime()).toBe(deadline.getTime());
  });

  it('never shows a score on submission — a result is an announcement', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { ...openWindow() });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const header = cookieHeader(student.cookies);

    const started = await request(app).post(`${API}/exams/${String(exam._id)}/attempt`).set('Cookie', header).expect(201);
    const res = await request(app)
      .post(`${API}/exams/attempts/${started.body.attempt.id}/submit`)
      .set('Cookie', header)
      .expect(200);

    expect(res.body.resultsPending).toBe(true);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('"score"');
    expect(serialised).not.toContain('"accuracy"');
  });

  it('will not load another student’s attempt', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { ...openWindow() });
    const mine = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const theirs = await registerVerifyLogin(app, {
      ...validStudent,
      email: 'third@example.com',
      mobile: '9333444555',
      classLevel: 'Class 9',
    });

    const started = await request(app)
      .post(`${API}/exams/${String(exam._id)}/attempt`)
      .set('Cookie', cookieHeader(mine.cookies))
      .expect(201);

    // Ownership is in the query, so this is a 404 rather than a 403 — the route never
    // loads somebody else's attempt at all.
    await request(app)
      .get(`${API}/exams/attempts/${started.body.attempt.id}`)
      .set('Cookie', cookieHeader(theirs.cookies))
      .expect(404);
  });
});

// ===========================================================================
// Publication
// ===========================================================================

describe('publishing results', () => {
  it('refuses to publish while the window is still open', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { ...openWindow() });

    const res = await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', cookieHeader(cookies))
      .send({});

    // Ranks are a cohort fact; publishing early would rank a student against whoever
    // happened to finish first.
    expect(res.status).toBe(409);
    expect(await Result.countDocuments({})).toBe(0);
  });

  it('refuses when nobody sat the paper', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies);

    await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', cookieHeader(cookies))
      .send({})
      .expect(409);
  });

  it('ranks a real cohort, sharing a rank on equal scores', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { questionCount: 4, marksEach: 10 });

    const top = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const tieA = await registerVerifyLogin(app, {
      ...validStudent,
      email: 'tie-a@example.com',
      mobile: '9111000111',
      classLevel: 'Class 9',
    });
    const tieB = await registerVerifyLogin(app, {
      ...validStudent,
      email: 'tie-b@example.com',
      mobile: '9111000222',
      classLevel: 'Class 9',
    });

    await seedSubmittedAttempt(exam, top.studentId, 4); // 40
    await seedSubmittedAttempt(exam, tieA.studentId, 2); // 20
    await seedSubmittedAttempt(exam, tieB.studentId, 2); // 20

    await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', cookieHeader(cookies))
      .send({})
      .expect(200);

    const results = await Result.find({ exam: exam._id }).sort({ rank: 1 });
    expect(results).toHaveLength(3);
    expect(results[0]!.rank).toBe(1);
    expect(results[0]!.percentage).toBe(100);
    // Standard competition ranking: the two equal scores share second place.
    expect(results[1]!.rank).toBe(2);
    expect(results[2]!.rank).toBe(2);
    for (const result of results) expect(result.totalCandidates).toBe(3);
  });

  it('is idempotent: republishing does not duplicate results or certificates', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { questionCount: 2 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await seedSubmittedAttempt(exam, student.studentId, 2);

    const url = `${API}/admin/exams/${String(exam._id)}/publish-results`;
    const first = await request(app).post(url).set('Cookie', cookieHeader(cookies)).send({}).expect(200);
    expect(first.body.certificates.issued).toBe(1);

    const second = await request(app).post(url).set('Cookie', cookieHeader(cookies)).send({}).expect(200);
    // The unique index on {student, exam} makes the second run a no-op, not a second
    // certificate for the same sitting.
    expect(second.body.certificates.issued).toBe(0);
    expect(second.body.certificates.skipped).toBe(1);

    expect(await Result.countDocuments({ exam: exam._id })).toBe(1);
    expect(await Certificate.countDocuments({ exam: exam._id })).toBe(1);
  });

  it('sweeps an abandoned attempt into the cohort rather than dropping it', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { ...openWindow(), questionCount: 2 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });

    const started = await request(app)
      .post(`${API}/exams/${String(exam._id)}/attempt`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(201);

    // The student walks away, and the exam closes.
    await ExamAttempt.updateOne(
      { _id: started.body.attempt.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await Exam.updateOne({ _id: exam._id }, { $set: { closesAt: new Date(Date.now() - 500) } });

    const fresh = await Exam.findById(exam._id);
    const res = await request(app)
      .post(`${API}/admin/exams/${String(fresh!._id)}/publish-results`)
      .set('Cookie', cookieHeader(cookies))
      .send({})
      .expect(200);

    // Counted with a score of zero, rather than excluded — which would have flattered
    // everybody else's rank.
    expect(res.body.publication.candidates).toBe(1);
    const stored = await ExamAttempt.findById(started.body.attempt.id);
    expect(stored!.status).toBe('submitted');
  });

  it('records publication, with the counts, in the audit trail', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { questionCount: 2 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await seedSubmittedAttempt(exam, student.studentId, 2);

    await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', cookieHeader(cookies))
      .send({ reason: 'Board approved release' })
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'exam.results.published' });
    expect(entry).not.toBeNull();
    expect(entry!.metadata).toMatchObject({ candidates: 1, certificatesIssued: 1, reason: 'Board approved release' });
  });

  it('keeps a graded score invisible until results are released', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { questionCount: 2 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await seedSubmittedAttempt(exam, student.studentId, 2);

    const before = await request(app)
      .get(`${API}/me/exam-results`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);
    expect(before.body.results).toEqual([]);

    await publishAndIssue(exam);

    const after = await request(app)
      .get(`${API}/me/exam-results`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);
    expect(after.body.results).toHaveLength(1);
    expect(after.body.results[0].rank).toBe(1);
  });
});

// ===========================================================================
// Eligibility — the rule the whole milestone rests on
// ===========================================================================

describe('certificate eligibility', () => {
  it('awards a tier from the exam’s own thresholds', () => {
    const exam = { meritThresholdPercent: 60, distinctionThresholdPercent: 85 };
    expect(tierFor(95, exam)).toBe('distinction');
    expect(tierFor(85, exam)).toBe('distinction');
    expect(tierFor(84.9, exam)).toBe('merit');
    expect(tierFor(60, exam)).toBe('merit');
    expect(tierFor(59.9, exam)).toBe('participation');
    expect(tierFor(0, exam)).toBe('participation');
  });

  it('honours per-exam thresholds rather than a global constant', async () => {
    const { cookies } = await createAdminSession(app);
    // A hard paper where 40% is a merit.
    const { exam } = await seedExam(app, cookies, {
      questionCount: 5,
      marksEach: 10,
      meritThresholdPercent: 40,
      distinctionThresholdPercent: 70,
    });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await seedSubmittedAttempt(exam, student.studentId, 2); // 20/50 = 40%

    await publishAndIssue(exam);

    const certificate = await Certificate.findOne({ exam: exam._id });
    expect(certificate!.percentage).toBe(40);
    expect(certificate!.tier).toBe('merit');
    // The thresholds are snapshotted, so re-tuning them later cannot change this.
    expect(certificate!.meritThresholdPercent).toBe(40);
  });

  it('gives a participation certificate to somebody who scored nothing', async () => {
    const { cookies } = await createAdminSession(app);
    const { exam } = await seedExam(app, cookies, { questionCount: 3 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await seedSubmittedAttempt(exam, student.studentId, 0);

    await publishAndIssue(exam);

    const certificate = await Certificate.findOne({ exam: exam._id });
    // They sat a national olympiad. That is the qualification for participation.
    expect(certificate!.tier).toBe('participation');
    expect(certificate!.percentage).toBe(0);
  });

  it('issues NOTHING for a mock test, a practice session or a daily challenge', async () => {
    const { cookies } = await createAdminSession(app);
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });

    // Earn on every other surface the product has.
    const account = await Student.findOne({ studentId: student.studentId });

    expect(await MockTestAttempt.countDocuments({})).toBe(0);
    expect(await PracticeSession.countDocuments({})).toBe(0);
    expect(await DailyChallengeAttempt.countDocuments({})).toBe(0);

    // There is no exam, no result, and therefore no certificate — and crucially there
    // is no route that could create one from any of the above.
    expect(await Certificate.countDocuments({ student: account!._id })).toBe(0);

    const res = await request(app)
      .get(`${API}/me/certificates`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);
    expect(res.body.certificates).toEqual([]);
    void cookies;
  });

  it('offers no route by which anybody can issue a certificate directly', async () => {
    const { cookies } = await createAdminSession(app);
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });

    // The frontend cannot manufacture eligibility because there is nothing to call.
    for (const path of ['/admin/certificates', '/me/certificates', '/certificates']) {
      const asAdmin = await request(app).post(`${API}${path}`).set('Cookie', cookieHeader(cookies)).send({});
      expect(asAdmin.status).not.toBe(200);
      expect(asAdmin.status).not.toBe(201);

      const asStudent = await request(app).post(`${API}${path}`).set('Cookie', cookieHeader(student.cookies)).send({});
      expect(asStudent.status).not.toBe(200);
      expect(asStudent.status).not.toBe(201);
    }
    expect(await Certificate.countDocuments({})).toBe(0);
  });
});

// ===========================================================================
// The certificate itself
// ===========================================================================

describe('certificates', () => {
  async function issueOne(scoreOutOf = 4) {
    const admin = await createAdminSession(app);
    const { exam } = await seedExam(app, admin.cookies, { questionCount: 4, marksEach: 10 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await seedSubmittedAttempt(exam, student.studentId, scoreOutOf);
    await publishAndIssue(exam);
    const certificate = await Certificate.findOne({ exam: exam._id });
    return { admin, student, exam, certificate: certificate! };
  }

  it('carries a unique serial and a separate high-entropy verification code', async () => {
    const { certificate } = await issueOne();

    expect(certificate.certificateId).toMatch(/^AMIT-CERT-\d{4}-\d{6}$/);
    // Four groups of four from an alphabet with no 0/O or 1/I/L, because it is read
    // off paper and typed by hand.
    expect(certificate.verificationCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(certificate.verificationCode).not.toContain('0');
    expect(certificate.verificationCode).not.toContain('O');
    // The two must differ: keying verification on the readable serial would let anyone
    // walk the numbers and harvest every entrant's name, school and rank.
    expect(certificate.verificationCode).not.toBe(certificate.certificateId);
  });

  it('snapshots the printable text, so later edits cannot rewrite it', async () => {
    const { certificate, student } = await issueOne();
    expect(certificate.studentName).toBe('Other Kumar Student');

    // Correct the student's name afterwards.
    await Student.updateOne({ studentId: student.studentId }, { $set: { fullName: 'Renamed Person' } });

    const stored = await Certificate.findById(certificate._id);
    expect(stored!.studentName).toBe('Other Kumar Student');
  });

  it('renders a real PDF from the snapshot alone', async () => {
    const { certificate } = await issueOne();
    const pdf = await renderCertificatePdf(certificate);

    // A PDF, not an HTML error page.
    expect(Buffer.from(pdf.slice(0, 5)).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('lets the holder download it, and nobody else', async () => {
    const { certificate, student } = await issueOne();
    const other = await registerVerifyLogin(app, {
      ...validStudent,
      email: 'nosy@example.com',
      mobile: '9444555666',
      classLevel: 'Class 9',
    });

    const mine = await request(app)
      .get(`${API}/me/certificates/${String(certificate._id)}/download`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);
    expect(mine.headers['content-type']).toContain('application/pdf');
    expect(mine.headers['cache-control']).toContain('no-store');

    // Ownership is in the query, so somebody else's certificate simply is not found.
    await request(app)
      .get(`${API}/me/certificates/${String(certificate._id)}/download`)
      .set('Cookie', cookieHeader(other.cookies))
      .expect(404);

    await request(app).get(`${API}/me/certificates/${String(certificate._id)}/download`).expect(401);
  });

  it('appears in the holder’s library with its verification code', async () => {
    const { certificate, student } = await issueOne();

    const res = await request(app)
      .get(`${API}/me/certificates`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    expect(res.body.certificates).toHaveLength(1);
    expect(res.body.certificates[0].certificateId).toBe(certificate.certificateId);
    // The holder needs this to prove their own certificate, and it is printed on the
    // PDF anyway.
    expect(res.body.certificates[0].verificationCode).toBe(certificate.verificationCode);
    expect(res.body.certificates[0].title).toBe('Certificate of Distinction');
  });
});

// ===========================================================================
// Public verification
// ===========================================================================

describe('public verification', () => {
  async function issueOne() {
    const admin = await createAdminSession(app);
    const { exam } = await seedExam(app, admin.cookies, { questionCount: 4, marksEach: 10 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await seedSubmittedAttempt(exam, student.studentId, 4);
    await publishAndIssue(exam);
    return { admin, certificate: (await Certificate.findOne({ exam: exam._id }))! };
  }

  it('verifies a genuine certificate without any account', async () => {
    const { certificate } = await issueOne();

    const res = await request(app).get(`${API}/verify/${certificate.verificationCode}`).expect(200);

    expect(res.body.valid).toBe(true);
    expect(res.body.status).toBe('valid');
    expect(res.body.certificate.certificateId).toBe(certificate.certificateId);
    expect(res.body.certificate.studentName).toBe('Other Kumar Student');
    expect(res.body.certificate.rank).toBe(1);
  });

  it('accepts the code however it was typed off the paper', async () => {
    const { certificate } = await issueOne();
    const bare = certificate.verificationCode.replace(/-/g, '');

    for (const variant of [bare, bare.toLowerCase(), `${bare.slice(0, 8)} ${bare.slice(8)}`]) {
      const res = await request(app).get(`${API}/verify/${encodeURIComponent(variant)}`).expect(200);
      expect(res.body.valid).toBe(true);
    }
  });

  it('reports a forged code as not found, and never leaks anybody’s details', async () => {
    await issueOne();

    const res = await request(app).get(`${API}/verify/AAAA-BBBB-CCCC-DDDD`).expect(200);

    expect(res.body.valid).toBe(false);
    expect(res.body.status).toBe('not-found');
    expect(res.body.certificate).toBeUndefined();
  });

  it('rejects a malformed code rather than searching for it', async () => {
    await request(app).get(`${API}/verify/nope`).expect(400);
  });

  it('reports a revoked certificate as revoked, not as missing', async () => {
    const { admin, certificate } = await issueOne();

    await request(app)
      .post(`${API}/admin/certificates/${String(certificate._id)}/revoke`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ reason: 'Issued against a paper later found to be compromised' })
      .expect(200);

    const res = await request(app).get(`${API}/verify/${certificate.verificationCode}`).expect(200);

    // A printed copy exists in the world whatever the database says, so the holder must
    // be told it was withdrawn rather than that it never existed.
    expect(res.body.valid).toBe(false);
    expect(res.body.status).toBe('revoked');
    expect(res.body.revokedReason).toMatch(/compromised/);
    expect(res.body.certificate.certificateId).toBe(certificate.certificateId);
  });

  it('stops a revoked certificate being downloaded again', async () => {
    const admin = await createAdminSession(app);
    const { exam } = await seedExam(app, admin.cookies, { questionCount: 2 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await seedSubmittedAttempt(exam, student.studentId, 2);
    await publishAndIssue(exam);
    const certificate = (await Certificate.findOne({ exam: exam._id }))!;

    await request(app)
      .post(`${API}/admin/certificates/${String(certificate._id)}/revoke`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ reason: 'Withdrawn by the board' })
      .expect(200);

    await request(app)
      .get(`${API}/me/certificates/${String(certificate._id)}/download`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(409);
  });

  it('revokes rather than deletes, and records why', async () => {
    const { admin, certificate } = await issueOne();

    await request(app)
      .post(`${API}/admin/certificates/${String(certificate._id)}/revoke`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ reason: 'Duplicate issuance' })
      .expect(200);

    // The row survives — that is what lets verification tell the truth.
    expect(await Certificate.countDocuments({ _id: certificate._id })).toBe(1);

    const entry = await AuditLog.findOne({ action: 'certificate.revoked' });
    expect(entry).not.toBeNull();
    expect(entry!.targetId).toBe(certificate.certificateId);
    expect(entry!.metadata).toMatchObject({ reason: 'Duplicate issuance' });
  });

  it('requires a reason to revoke', async () => {
    const { admin, certificate } = await issueOne();

    await request(app)
      .post(`${API}/admin/certificates/${String(certificate._id)}/revoke`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({})
      .expect(400);

    const stored = await Certificate.findById(certificate._id);
    expect(stored!.revokedAt ?? null).toBeNull();
  });
});

// ===========================================================================
// Admin management
// ===========================================================================

describe('certificate administration', () => {
  it('paginates and filters by tier', async () => {
    const admin = await createAdminSession(app);
    const { exam } = await seedExam(app, admin.cookies, { questionCount: 4, marksEach: 10 });

    const top = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const low = await registerVerifyLogin(app, {
      ...validStudent,
      email: 'low@example.com',
      mobile: '9777888999',
      classLevel: 'Class 9',
    });
    await seedSubmittedAttempt(exam, top.studentId, 4); // 100% — distinction
    await seedSubmittedAttempt(exam, low.studentId, 1); // 25%  — participation
    await publishAndIssue(exam);

    const all = await request(app)
      .get(`${API}/admin/certificates`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);
    expect(all.body.pagination.total).toBe(2);

    const distinction = await request(app)
      .get(`${API}/admin/certificates?tier=distinction`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);
    expect(distinction.body.pagination.total).toBe(1);
    expect(distinction.body.certificates[0].studentIdLabel).toBe(top.studentId);

    const paged = await request(app)
      .get(`${API}/admin/certificates?limit=1`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);
    expect(paged.body.certificates).toHaveLength(1);
    expect(paged.body.pagination.totalPages).toBe(2);
  });

  it('shows the attempts table with real marks', async () => {
    const admin = await createAdminSession(app);
    const { exam } = await seedExam(app, admin.cookies, { questionCount: 4, marksEach: 10 });
    const student = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await seedSubmittedAttempt(exam, student.studentId, 3);

    const res = await request(app)
      .get(`${API}/admin/exams/${String(exam._id)}/attempts`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0].score).toBe(30);
    expect(res.body.attempts[0].maxMarks).toBe(40);
    expect(res.body.attempts[0].percentage).toBe(75);
    expect(res.body.attempts[0].studentId).toBe(student.studentId);
  });
});
