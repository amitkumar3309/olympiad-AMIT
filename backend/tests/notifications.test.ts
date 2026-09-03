import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { EmailOutbox, Notification, Student } from '../src/models';
import { clearTestInbox as clearInbox, failNextDeliveries, getTestInbox } from '../src/lib/email';
import { drainOutbox, enqueueEmail, outboxStats } from '../src/services/emailOutbox';
import { emailAllowedFor, resolvePrefs } from '../src/services/notificationService';
import { isOptionalCategory } from '../src/lib/systemNotifications';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  validStudent,
  otherStudent,
  cookieHeader,
  registerVerifyLogin,
  createAdminSession,
} from './helpers/auth';
import { seedExam, seedSubmittedAttempt } from './helpers/exams';
import type { ClassLevel } from '../src/lib/classLevels';

/**
 * Milestone 14 — the notification system.
 *
 * Milestone 12 already built the in-app half (one document with an audience rule, a
 * student inbox, read state, a staff composer), and `adminPlatform.test.ts` covers it.
 * This suite is about the four things Milestone 14 added, and it is weighted heavily
 * toward the first:
 *
 * 1. **Failure handling.** The happy path of an email system runs on every
 *    registration; the retry path runs only when somebody's provider is down, which is
 *    exactly when nobody is watching. So most of this file makes delivery fail on
 *    purpose — transiently, then permanently — and asserts that the user's request
 *    still succeeded, that nothing was lost, and that a recovered provider actually
 *    delivers.
 * 2. **Non-blocking delivery.** The request path enqueues and returns.
 * 3. **System notifications**, including the disclosure property that a per-student
 *    notice reaches exactly one student.
 * 4. **Preferences**, including the streams that deliberately cannot be switched off.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearInbox();
});

/** The unversioned alias. Every gate must hold here too. */
const ALIAS = '/api';

/**
 * The class both student fixtures are in.
 *
 * Stated as a typed constant rather than read off `otherStudent.classLevel`, which the
 * fixture widens to `string`. An exam is set for one class, so the seeded exam and the
 * seeded student have to agree or the student is not a candidate for their own paper.
 */
const STUDENT_CLASS: ClassLevel = 'Class 9';

// ===========================================================================
// The outbox: nothing is sent inline, and nothing is lost
// ===========================================================================

describe('email is queued, not sent inline', () => {
  it('registration writes an outbox row rather than emailing during the request', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const rows = await EmailOutbox.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe('transactional');
    expect(rows[0]!.to).toBe(validStudent.email);
    // Under test the drain runs inline for determinism, so it is already sent — the
    // point of this assertion is that a durable row exists either way. Before
    // Milestone 14 there was no record at all.
    expect(rows[0]!.status).toBe('sent');
  });

  it('records the student on the row, so a delivery can be traced to an account', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const account = await Student.findOne({ studentId });

    const row = await EmailOutbox.findOne({ category: 'transactional' });
    expect(String(row!.student)).toBe(String(account!._id));
  });

  it('a dead provider does NOT fail the registration it belongs to', async () => {
    failNextDeliveries(Infinity);

    // The whole property in one assertion: the student's account was created and the
    // response was a success, even though not one byte of email left the building.
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    expect(await Student.countDocuments({ email: validStudent.email })).toBe(1);
    expect(getTestInbox()).toHaveLength(0);
  });

  it('keeps a failed message for a later attempt instead of losing it', async () => {
    failNextDeliveries(Infinity);
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const row = await EmailOutbox.findOne({});
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(1);
    // The provider's own words, kept for the delivery console.
    expect(row!.lastError).toContain('Simulated SMTP failure');
    // Backed off rather than retried immediately.
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('delivers on a later attempt once the provider recovers', async () => {
    // Fail exactly once. A test that only ever fails permanently proves the give-up
    // path but says nothing about whether a recovered provider is ever retried.
    failNextDeliveries(1);
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    expect(getTestInbox()).toHaveLength(0);

    // Drain with a clock past the backoff, the way a later request would.
    const later = new Date(Date.now() + 10 * 60 * 1000);
    const outcome = await drainOutbox(later);

    expect(outcome.sent).toBe(1);
    expect(getTestInbox()).toHaveLength(1);
    const row = await EmailOutbox.findOne({});
    expect(row!.status).toBe('sent');
    expect(row!.sentAt).toBeTruthy();
    expect(row!.attempts).toBe(2);
  });

  it('does not retry before the backoff has elapsed', async () => {
    failNextDeliveries(Infinity);
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    // Immediately again: the row is not yet due, so there is nothing to claim.
    const outcome = await drainOutbox();
    expect(outcome.claimed).toBe(0);
    expect((await EmailOutbox.findOne({}))!.attempts).toBe(1);
  });

  it('gives up after the last attempt and records why', async () => {
    failNextDeliveries(Infinity);
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const row = await EmailOutbox.findOne({});
    const max = row!.maxAttempts;

    // Walk the clock forward far enough that each retry is due.
    for (let i = 1; i < max; i += 1) {
      await drainOutbox(new Date(Date.now() + (i + 1) * 6 * 60 * 60 * 1000));
    }

    const finished = await EmailOutbox.findById(row!._id);
    expect(finished!.attempts).toBe(max);
    // Terminal, so a genuinely dead address is not retried for ever.
    expect(finished!.status).toBe('failed');
    expect(finished!.lastError).toContain('Simulated SMTP failure');

    // And it stays visible rather than disappearing.
    expect((await outboxStats()).failed).toBe(1);
  });

  it('a failed row can be requeued and then delivers', async () => {
    // The admin is created *before* the transport is broken: `createAdminSession`
    // reads a real verification token out of the captured email, so it cannot run
    // while delivery is failing.
    const admin = await createAdminSession(app, otherStudent);

    failNextDeliveries(Infinity);
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const row = await EmailOutbox.findOne({ to: validStudent.email });
    for (let i = 1; i < row!.maxAttempts; i += 1) {
      await drainOutbox(new Date(Date.now() + (i + 1) * 6 * 60 * 60 * 1000));
    }
    expect((await EmailOutbox.findById(row!._id))!.status).toBe('failed');

    // The provider is fixed; staff press "Requeue failed".
    clearInbox();
    const res = await request(app)
      .post(`${API}/admin/email-deliveries/retry`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    expect(res.body.requeued).toBeGreaterThanOrEqual(1);
    expect((await EmailOutbox.findById(row!._id))!.status).toBe('sent');
  });

  it('two concurrent drains never send the same message twice', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    // Put it back in the queue so there is exactly one due row to race for.
    await EmailOutbox.updateMany({}, { $set: { status: 'pending', nextAttemptAt: new Date(0), attempts: 0 } });
    clearInbox();

    // The claim is a conditional write, so of two racing drains only one can win the
    // row. A read-then-write check would let both through, and on serverless the two
    // halves can land in different invocations.
    const [a, b] = await Promise.all([drainOutbox(), drainOutbox()]);

    expect(a.claimed + b.claimed).toBe(1);
    expect(getTestInbox()).toHaveLength(1);
  });

  it('refuses a duplicate enqueue for the same event key', async () => {
    const first = await enqueueEmail({
      to: 'dup@example.com',
      subject: 'Once',
      text: 'Once',
      html: '<p>Once</p>',
      category: 'results',
      dedupeKey: 'results:exam-1:student-1',
    });
    const second = await enqueueEmail({
      to: 'dup@example.com',
      subject: 'Once',
      text: 'Once',
      html: '<p>Once</p>',
      category: 'results',
      dedupeKey: 'results:exam-1:student-1',
    });

    expect(first.queued).toBe(true);
    expect(second.queued).toBe(false);
    expect(second.reason).toBe('duplicate');
    expect(await EmailOutbox.countDocuments({ dedupeKey: 'results:exam-1:student-1' })).toBe(1);
  });

  it('allows two rows with no dedupe key, so a resend is still possible', async () => {
    // The partial index must not make every keyless row collide on null — a student
    // legitimately may ask for a second verification link.
    for (let i = 0; i < 2; i += 1) {
      const result = await enqueueEmail({
        to: 'resend@example.com',
        subject: 'Verify',
        text: 'Link',
        html: '<p>Link</p>',
        category: 'transactional',
      });
      expect(result.queued).toBe(true);
    }
    expect(await EmailOutbox.countDocuments({ to: 'resend@example.com' })).toBe(2);
  });

  it('forgot-password stays a generic 200 even with a dead provider', async () => {
    const { student } = await registerVerifyLogin(app);
    failNextDeliveries(Infinity);

    const known = await request(app).post(`${API}/auth/forgot-password`).send({ email: student.email }).expect(200);
    const unknown = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'nobody@example.com' })
      .expect(200);

    // Identical, so a broken mail provider cannot become an account-enumeration
    // oracle. Queueing rather than sending inline is also what keeps the two
    // responses the same *speed*.
    expect(known.body.message).toBe(unknown.body.message);
  });
});

// ===========================================================================
// System notifications
// ===========================================================================

describe('system notifications for real events', () => {
  it('announces a published exam to its class, in-app only', async () => {
    const admin = await createAdminSession(app);
    const { exam } = await seedExam(app, admin.cookies, { classLevel: 'Class 9', status: 'draft' });

    await request(app)
      .patch(`${API}/admin/exams/${String(exam._id)}/status`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ status: 'published' })
      .expect(200);

    const notice = await Notification.findOne({ event: 'exam.published' });
    expect(notice).toBeTruthy();
    expect(notice!.audience).toBe('class');
    expect(notice!.classLevel).toBe('Class 9');
    expect(notice!.source).toBe('system');
    expect(notice!.isPublished).toBe(true);
    expect(notice!.link).toBe('/exam');

    // Deliberately not emailed: broadcasting practice-and-schedule news to a whole
    // class is the free-tier deliverability problem the design declines to create.
    expect(await EmailOutbox.countDocuments({ category: 'announcement' })).toBe(0);
  });

  it('does not announce the same exam twice when it is republished', async () => {
    const admin = await createAdminSession(app);
    const { exam } = await seedExam(app, admin.cookies, { status: 'draft' });
    const header = cookieHeader(admin.cookies);

    await request(app).patch(`${API}/admin/exams/${String(exam._id)}/status`).set('Cookie', header).send({ status: 'published' }).expect(200);
    await request(app).patch(`${API}/admin/exams/${String(exam._id)}/status`).set('Cookie', header).send({ status: 'draft' }).expect(200);
    await request(app).patch(`${API}/admin/exams/${String(exam._id)}/status`).set('Cookie', header).send({ status: 'published' }).expect(200);

    expect(await Notification.countDocuments({ event: 'exam.published' })).toBe(1);
  });

  it('tells each candidate their result, with the real score and rank', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { exam } = await seedExam(app, admin.cookies, {
      classLevel: STUDENT_CLASS,
      questionCount: 4,
      marksEach: 10,
    });
    await seedSubmittedAttempt(exam, student.studentId, 3);

    await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({})
      .expect(200);

    const notice = await Notification.findOne({ event: 'exam.results_published' });
    expect(notice).toBeTruthy();
    expect(notice!.audience).toBe('student');
    expect(notice!.link).toBe('/result');
    // The figures come from the `Result` rows that were really written, so the notice
    // cannot disagree with the portal it links to.
    expect(notice!.body).toContain('30 / 40');
    expect(notice!.body).toContain('Rank: 1 of 1');
    // Issued in the same operation, so it is named in the same message rather than
    // arriving as a second notification.
    expect(notice!.body).toContain('Certificate of Merit');

    // And this one IS emailed — it is the news the product exists to deliver.
    const email = await EmailOutbox.findOne({ category: 'results' });
    expect(email).toBeTruthy();
    expect(email!.to).toBe(otherStudent.email);
  });

  it('does not re-notify when results are released a second time', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { exam } = await seedExam(app, admin.cookies, { classLevel: STUDENT_CLASS, questionCount: 2 });
    await seedSubmittedAttempt(exam, student.studentId, 2);
    const header = cookieHeader(admin.cookies);

    await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', header)
      .send({})
      .expect(200);
    const second = await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', header)
      .send({})
      .expect(200);

    // Publication is idempotent by design; the notification must be too, or a nervous
    // administrator clicking twice tells the whole cohort their results are out twice.
    expect(await Notification.countDocuments({ event: 'exam.results_published' })).toBe(1);
    expect(await EmailOutbox.countDocuments({ category: 'results' })).toBe(1);
    expect(second.body.notifications.notified).toBe(0);
  });

  it('keeps a per-student result private to that student', async () => {
    const admin = await createAdminSession(app);
    const mine = await registerVerifyLogin(app, otherStudent);
    const theirs = await registerVerifyLogin(app, {
      ...validStudent,
      email: 'third@example.com',
      mobile: '9000000031',
      classLevel: STUDENT_CLASS,
    });

    const { exam } = await seedExam(app, admin.cookies, { classLevel: STUDENT_CLASS, questionCount: 2 });
    await seedSubmittedAttempt(exam, mine.studentId, 2);
    await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({})
      .expect(200);

    // The disclosure property. A result notice names a score and a rank, so a filter
    // that leaked one row across the class boundary would be a data breach rather
    // than a display glitch — and these two students are in the *same* class, which
    // is what makes the audience clause rather than the class clause the thing under
    // test here.
    const inbox = await request(app)
      .get(`${API}/me/notifications`)
      .set('Cookie', cookieHeader(theirs.cookies))
      .expect(200);

    const resultRows = inbox.body.notifications.filter(
      (n: { audience: string }) => n.audience === 'student',
    );
    expect(resultRows).toHaveLength(0);
    expect(JSON.stringify(inbox.body)).not.toContain('Rank:');
  });

  it('lets the owner read and mark their own per-student notice', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const { exam } = await seedExam(app, admin.cookies, { classLevel: STUDENT_CLASS, questionCount: 2 });
    await seedSubmittedAttempt(exam, student.studentId, 2);
    await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({})
      .expect(200);

    const header = cookieHeader(student.cookies);
    const inbox = await request(app).get(`${API}/me/notifications`).set('Cookie', header).expect(200);
    const row = inbox.body.notifications.find((n: { audience: string }) => n.audience === 'student');
    expect(row).toBeTruthy();
    expect(row.source).toBe('system');

    // Marking read had to go through the shared visibility rule for this to work: the
    // route used to hand-write the audience comparison, which knew about `all` and
    // `class` only and would have refused this with a 404.
    const marked = await request(app).post(`${API}/me/notifications/${row.id}/read`).set('Cookie', header).expect(200);
    expect(marked.body.read).toBe(true);
  });

  it('refuses to mark another student’s notice read', async () => {
    const admin = await createAdminSession(app);
    const mine = await registerVerifyLogin(app, otherStudent);
    const theirs = await registerVerifyLogin(app, {
      ...validStudent,
      email: 'fourth@example.com',
      mobile: '9000000041',
      classLevel: STUDENT_CLASS,
    });
    const { exam } = await seedExam(app, admin.cookies, { classLevel: STUDENT_CLASS, questionCount: 2 });
    await seedSubmittedAttempt(exam, mine.studentId, 2);
    await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({})
      .expect(200);

    const notice = await Notification.findOne({ audience: 'student' });
    // 404 rather than 403: the route must not confirm that an id it will not show
    // nevertheless exists.
    await request(app)
      .post(`${API}/me/notifications/${String(notice!._id)}/read`)
      .set('Cookie', cookieHeader(theirs.cookies))
      .expect(404);
  });

  it('warns the owner when their password changes, whatever their preferences say', async () => {
    const { cookies, student } = await registerVerifyLogin(app);
    const header = cookieHeader(cookies);

    // Switch off everything switchable first, to prove security mail ignores it.
    await request(app)
      .patch(`${API}/me/notification-preferences`)
      .set('Cookie', header)
      .send({ announcements: false, results: false })
      .expect(200);
    clearInbox();

    await request(app)
      .post(`${API}/me/change-password`)
      .set('Cookie', header)
      .send({ currentPassword: student.password, newPassword: 'BrandNewPass9!', confirmPassword: 'BrandNewPass9!' })
      .expect(200);

    expect(await Notification.countDocuments({ event: 'account.password_changed' })).toBe(1);
    // This is the detection signal for a stolen session. An option to silence it
    // would only ever help the thief.
    const email = await EmailOutbox.findOne({ category: 'security' });
    expect(email).toBeTruthy();
    expect(email!.to).toBe(student.email);
  });

  it('tells a suspended account it was suspended', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);

    await request(app)
      .patch(`${API}/admin/students/${student.studentId}/status`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ status: 'suspended', reason: 'Testing' })
      .expect(200);

    const notice = await Notification.findOne({ event: 'account.status_changed' });
    expect(notice!.body).toContain('suspended');

    // The ordering inside `emailAllowedFor()` is what makes this work: the category
    // check comes *before* the account-status check, so the one message a suspended
    // account must receive is not swallowed by its own suspension.
    //
    // Scoped by address: promoting the administrator above legitimately produced its
    // own `security` email, so an unscoped `findOne` would assert against that one.
    const email = await EmailOutbox.findOne({ category: 'security', to: otherStudent.email });
    expect(email).toBeTruthy();
    expect(email!.subject).toContain('status changed');
  });

  it('tells a promoted account its role changed', async () => {
    // `createAdminSession` promotes an account, which is the event under test.
    await createAdminSession(app);
    const notice = await Notification.findOne({ event: 'account.role_changed' });
    expect(notice).toBeTruthy();
    expect(notice!.audience).toBe('student');
    expect(notice!.body).toContain('admin');
  });

  it('announces a published mock test to its class without emailing', async () => {
    const admin = await createAdminSession(app);
    const { exam } = await seedExam(app, admin.cookies, { classLevel: 'Class 9' });

    // Reuse the exam's questions to build a mock test through the real route.
    const created = await request(app)
      .post(`${API}/admin/mock-tests`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({
        title: 'Rehearsal paper',
        classLevel: 'Class 9',
        durationMinutes: 30,
        instructions: 'Do your best.',
        questions: exam.questions.slice(0, 2).map((q, i) => ({ question: String(q.question), order: i + 1, marks: 5 })),
      })
      .expect(201);

    await request(app)
      .patch(`${API}/admin/mock-tests/${created.body.test.id}/status`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ status: 'published' })
      .expect(200);

    const notice = await Notification.findOne({ event: 'mocktest.published' });
    expect(notice!.audience).toBe('class');
    expect(notice!.link).toBe('/mock-tests');
    expect(await EmailOutbox.countDocuments({ category: 'announcement' })).toBe(0);
  });

  it('refuses to edit a system notification but allows deleting it', async () => {
    const admin = await createAdminSession(app);
    const header = cookieHeader(admin.cookies);
    const notice = await Notification.findOne({ event: 'account.role_changed' });

    // Editing the text of a record of something that happened would turn it into a
    // claim about something that did not — and would then disagree with the email
    // already delivered from it.
    await request(app)
      .patch(`${API}/admin/notifications/${String(notice!._id)}`)
      .set('Cookie', header)
      .send({ title: 'Something else entirely' })
      .expect(409);

    // Housekeeping is not falsification, so removal stays available.
    await request(app).delete(`${API}/admin/notifications/${String(notice!._id)}`).set('Cookie', header).expect(200);
  });

  it('lists staff announcements by default, not the per-student flood', async () => {
    const admin = await createAdminSession(app);
    const header = cookieHeader(admin.cookies);
    await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', header)
      .send({ title: 'Written by a human', body: 'Hello.', isPublished: true })
      .expect(201);

    // The promotion in `createAdminSession` produced a system row, so both streams
    // exist. Releasing one national exam's results would produce one per candidate,
    // which is why the composer's list must not default to everything.
    const staffOnly = await request(app).get(`${API}/admin/notifications`).set('Cookie', header).expect(200);
    expect(staffOnly.body.notifications).toHaveLength(1);
    expect(staffOnly.body.notifications[0].source).toBe('staff');

    const both = await request(app).get(`${API}/admin/notifications?source=all`).set('Cookie', header).expect(200);
    expect(both.body.pagination.total).toBe(2);

    const systemOnly = await request(app).get(`${API}/admin/notifications?source=system`).set('Cookie', header).expect(200);
    expect(systemOnly.body.notifications.every((n: { source: string }) => n.source === 'system')).toBe(true);
  });

  it('never lets staff address one student from the composer', async () => {
    const { cookies } = await createAdminSession(app);
    // `student` is absent from the staff schema rather than rejected by the handler,
    // which is the same discipline the leaderboard uses for ranked values.
    await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(cookies))
      .send({ title: 'Just for you', body: 'Private.', audience: 'student', isPublished: true })
      .expect(400);
  });
});

// ===========================================================================
// Preferences
// ===========================================================================

describe('notification preferences', () => {
  it('defaults to on for an account that has never chosen', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app)
      .get(`${API}/me/notification-preferences`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    // On, because a student who registered before this existed was already receiving
    // everything — defaulting to off would silently take something away.
    expect(res.body.preferences).toEqual({ announcements: true, results: true });
    expect(res.body.inAppAlwaysOn).toBe(true);
    // The page is told what it may *not* switch off, rather than silently omitting it.
    expect(res.body.always.map((a: { category: string }) => a.category)).toEqual(['transactional', 'security']);
  });

  it('treats a missing preferences object as all-on', () => {
    expect(resolvePrefs({})).toEqual({ announcements: true, results: true });
    expect(resolvePrefs({ notificationPrefs: { announcements: false, results: true } })).toEqual({
      announcements: false,
      results: true,
    });
  });

  it('saves one switch without disturbing the other', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const header = cookieHeader(cookies);

    const res = await request(app)
      .patch(`${API}/me/notification-preferences`)
      .set('Cookie', header)
      .send({ results: false })
      .expect(200);

    expect(res.body.preferences).toEqual({ announcements: true, results: false });
    const reread = await request(app).get(`${API}/me/notification-preferences`).set('Cookie', header).expect(200);
    expect(reread.body.preferences).toEqual({ announcements: true, results: false });
  });

  it('rejects an empty update', async () => {
    const { cookies } = await registerVerifyLogin(app);
    await request(app)
      .patch(`${API}/me/notification-preferences`)
      .set('Cookie', cookieHeader(cookies))
      .send({})
      .expect(400);
  });

  it('suppresses the result EMAIL but never the in-app notification', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);

    await request(app)
      .patch(`${API}/me/notification-preferences`)
      .set('Cookie', cookieHeader(student.cookies))
      .send({ results: false })
      .expect(200);

    const { exam } = await seedExam(app, admin.cookies, { classLevel: STUDENT_CLASS, questionCount: 2 });
    await seedSubmittedAttempt(exam, student.studentId, 2);
    await request(app)
      .post(`${API}/admin/exams/${String(exam._id)}/publish-results`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({})
      .expect(200);

    // This is the central guarantee of the preference model: declining an email never
    // costs you the record. The notice board is always complete.
    expect(await Notification.countDocuments({ event: 'exam.results_published' })).toBe(1);
    expect(await EmailOutbox.countDocuments({ category: 'results' })).toBe(0);
  });

  it('cannot switch off a non-optional category', () => {
    expect(isOptionalCategory('transactional')).toBe(false);
    expect(isOptionalCategory('security')).toBe(false);
    expect(isOptionalCategory('announcement')).toBe(true);
    expect(isOptionalCategory('results')).toBe(true);

    const optedOut = {
      email: 'x@example.com',
      status: 'active' as const,
      notificationPrefs: { announcements: false, results: false },
    };
    expect(emailAllowedFor(optedOut, 'security')).toBe(true);
    expect(emailAllowedFor(optedOut, 'transactional')).toBe(true);
    expect(emailAllowedFor(optedOut, 'announcement')).toBe(false);
    expect(emailAllowedFor(optedOut, 'results')).toBe(false);
  });

  it('stops optional email to an account not in good standing', () => {
    const suspended = { email: 'x@example.com', status: 'suspended' as const, notificationPrefs: undefined };
    expect(emailAllowedFor(suspended, 'announcement')).toBe(false);
    // But security mail still gets through — the category check comes first.
    expect(emailAllowedFor(suspended, 'security')).toBe(true);
  });

  it('sends nothing to an account with no address', () => {
    const noAddress = { email: '', status: 'active' as const, notificationPrefs: undefined };
    expect(emailAllowedFor(noAddress, 'security')).toBe(false);
  });

  it('needs a session', async () => {
    await request(app).get(`${API}/me/notification-preferences`).expect(401);
    await request(app).patch(`${API}/me/notification-preferences`).send({ results: false }).expect(401);
    // The gate must hold on the unversioned alias too.
    await request(app).get(`${ALIAS}/me/notification-preferences`).expect(401);
  });
});

// ===========================================================================
// Staff email broadcast
// ===========================================================================

describe('emailing an announcement is opt-in and reported honestly', () => {
  it('queues nothing unless staff ask for it', async () => {
    const admin = await createAdminSession(app);
    await registerVerifyLogin(app, otherStudent);

    await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ title: 'In-app only', body: 'No email please.', isPublished: true })
      .expect(201);

    expect(await EmailOutbox.countDocuments({ category: 'announcement' })).toBe(0);
  });

  it('queues one email per eligible recipient when asked', async () => {
    const admin = await createAdminSession(app);
    await registerVerifyLogin(app, otherStudent);

    const res = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ title: 'Big news', body: 'Read this.', isPublished: true, emailBroadcast: true })
      .expect(201);

    expect(res.body.broadcast.queued).toBe(1);
    expect(res.body.broadcast.suppressed).toBe(0);
    const email = await EmailOutbox.findOne({ category: 'announcement' });
    expect(email!.to).toBe(otherStudent.email);
  });

  it('counts and reports recipients who opted out rather than hiding them', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    await request(app)
      .patch(`${API}/me/notification-preferences`)
      .set('Cookie', cookieHeader(student.cookies))
      .send({ announcements: false })
      .expect(200);

    const res = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ title: 'Big news', body: 'Read this.', isPublished: true, emailBroadcast: true })
      .expect(201);

    // Reported, not silently dropped: staff who see "0 queued" with no explanation
    // will reasonably conclude it is broken and send it again.
    expect(res.body.broadcast.queued).toBe(0);
    expect(res.body.broadcast.suppressed).toBe(1);
    // The in-app announcement still reached them.
    expect(await Notification.countDocuments({ source: 'staff', isPublished: true })).toBe(1);
  });

  it('does not email a draft', async () => {
    const admin = await createAdminSession(app);
    await registerVerifyLogin(app, otherStudent);

    const res = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ title: 'Not yet', body: 'Draft.', isPublished: false, emailBroadcast: true })
      .expect(201);

    expect(res.body.broadcast).toBeNull();
    expect(await EmailOutbox.countDocuments({ category: 'announcement' })).toBe(0);
  });

  it('does not email the same student twice for one announcement', async () => {
    const admin = await createAdminSession(app);
    await registerVerifyLogin(app, otherStudent);
    const header = cookieHeader(admin.cookies);

    const created = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', header)
      .send({ title: 'Once only', body: 'Body.', isPublished: true, emailBroadcast: true })
      .expect(201);

    // Publish, withdraw, publish again, asking for email each time.
    await request(app)
      .patch(`${API}/admin/notifications/${created.body.notification.id}`)
      .set('Cookie', header)
      .send({ isPublished: true, emailBroadcast: true })
      .expect(200);

    expect(await EmailOutbox.countDocuments({ category: 'announcement' })).toBe(1);
  });

  it('respects the class audience when choosing recipients', async () => {
    const admin = await createAdminSession(app);
    await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    await registerVerifyLogin(app, {
      ...validStudent,
      email: 'ten@example.com',
      mobile: '9000000051',
      classLevel: 'Class 10',
    });

    const res = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({
        title: 'Class 9 only',
        body: 'Your paper moved.',
        audience: 'class',
        classLevel: 'Class 9',
        isPublished: true,
        emailBroadcast: true,
      })
      .expect(201);

    expect(res.body.broadcast.queued).toBe(1);
    const emails = await EmailOutbox.find({ category: 'announcement' });
    expect(emails.map((e) => e.to)).toEqual([otherStudent.email]);
  });
});

// ===========================================================================
// The delivery console
// ===========================================================================

describe('the email delivery console', () => {
  it('is closed to guests and to plain students, on both prefixes', async () => {
    const student = await registerVerifyLogin(app);

    for (const base of [API, ALIAS]) {
      await request(base === API ? app : app)
        .get(`${base}/admin/email-deliveries`)
        .expect(401);
      await request(app)
        .get(`${base}/admin/email-deliveries`)
        .set('Cookie', cookieHeader(student.cookies))
        .expect(403);
      await request(app)
        .post(`${base}/admin/email-deliveries/drain`)
        .set('Cookie', cookieHeader(student.cookies))
        .expect(403);
      await request(app)
        .post(`${base}/admin/email-deliveries/retry`)
        .set('Cookie', cookieHeader(student.cookies))
        .expect(403);
    }
  });

  it('lists rows with counted statistics', async () => {
    const admin = await createAdminSession(app);
    const res = await request(app)
      .get(`${API}/admin/email-deliveries`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    // The promotion inside `createAdminSession` produced real mail: a verification
    // email and a role-change security notice.
    expect(res.body.deliveries.length).toBeGreaterThan(0);
    expect(res.body.stats.sent).toBeGreaterThan(0);
    expect(res.body.stats).toHaveProperty('oldestPendingAt');
    // The subject is listed; the body never is.
    expect(res.body.deliveries[0]).not.toHaveProperty('text');
    expect(res.body.deliveries[0]).not.toHaveProperty('html');
  });

  it('filters by status and category', async () => {
    const admin = await createAdminSession(app);
    const header = cookieHeader(admin.cookies);

    const sent = await request(app).get(`${API}/admin/email-deliveries?status=sent`).set('Cookie', header).expect(200);
    expect(sent.body.deliveries.every((d: { status: string }) => d.status === 'sent')).toBe(true);

    const security = await request(app)
      .get(`${API}/admin/email-deliveries?category=security`)
      .set('Cookie', header)
      .expect(200);
    expect(security.body.deliveries.every((d: { category: string }) => d.category === 'security')).toBe(true);
  });

  it('drains the queue on demand', async () => {
    const admin = await createAdminSession(app);
    // Put everything back in the queue so there is something to send.
    await EmailOutbox.updateMany({}, { $set: { status: 'pending', nextAttemptAt: new Date(0), attempts: 0 } });
    clearInbox();

    const res = await request(app)
      .post(`${API}/admin/email-deliveries/drain`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    expect(res.body.drain.sent).toBeGreaterThan(0);
    expect(getTestInbox().length).toBeGreaterThan(0);
  });

  it('reports an empty drain honestly rather than claiming success', async () => {
    const admin = await createAdminSession(app);
    // Everything already sent, so there is nothing due.
    const res = await request(app)
      .post(`${API}/admin/email-deliveries/drain`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    expect(res.body.drain).toEqual({ claimed: 0, sent: 0, failed: 0, retrying: 0 });
  });

  /**
   * A delivered message with a dead link is the failure this reports.
   *
   * Every verification and reset link is built from `FRONTEND_URL`; unset, it falls
   * back to `http://localhost:5173`, which is unreachable for a student. The outbox row
   * still reads `sent`, so nothing on this page would show it — which is exactly how it
   * goes unnoticed until somebody reports "the link doesn't work".
   */
  it('reports where the links in these emails point', async () => {
    const { cookies } = await createAdminSession(app, { email: 'staff-links@example.com', mobile: '9000000077' });

    const res = await request(app)
      .get(`${API}/admin/email-deliveries`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.linkBase).toBeDefined();
    expect(typeof res.body.linkBase.url).toBe('string');
    // Outside production the local fallback is the correct answer, so this is not
    // flagged — the warning is about a *deployed* backend emailing localhost links.
    expect(res.body.linkBase.configured).toBe(true);
  });
});
