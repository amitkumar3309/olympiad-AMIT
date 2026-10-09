import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { AuditLog, DailyChallenge, DailyQuizSettings, EmailOutbox, Student } from '../src/models';
import { getTestInbox } from '../src/lib/email';
import { dayKeyOf, shiftDay } from '../src/lib/competitionDay';
import { freezeClock, now, resetClock } from '../src/lib/clock';
import { quizWindow } from '../src/lib/dailyQuiz';
import { enqueueEmail } from '../src/services/emailOutbox';
import { reminderKey, rotationOrder } from '../src/services/dailyQuizReminders';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, registerVerifyLogin, validStudent } from './helpers/auth';
import { createQuestionVia, createTaxonomy, type Taxonomy } from './helpers/questions';

/**
 * Milestone 30 Phase 7b — Daily Quiz reminder emails (PLAN.md Q20), through the API.
 *
 * What matters, each asserted on its effect:
 *
 *  1. **The job routes are the scheduler's alone** — 503 naming `JOBS_SECRET` when it is not
 *     configured, 401 for a missing or wrong bearer, on both prefixes.
 *  2. **Exactly the right students get exactly one email** — opted in, verified, active, in a
 *     class with a quiz today, not yet started — and a second trigger sends nobody another.
 *  3. **The email gives nothing away** — the class range, the topic and the closing time,
 *     never the question or an option.
 *  4. **Reminders never crowd out a verification link** — the outbox sends by priority, keeps
 *     to the daily cap, and forgets a reminder fourteen days after queueing it.
 */

/** Obviously fake, and long enough for the schema's 32-character floor. */
const SECRET = 'test-only-jobs-secret-0123456789abcdef-not-real';
const ORIGINAL_SECRET = config.jobs.secret;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeAll(startTestDb, 60_000);
afterAll(async () => {
  config.jobs.secret = ORIGINAL_SECRET;
  await stopTestDb();
});
// 07:00 IST on the real day — when the scheduler calls — so nothing straddles a midnight.
beforeEach(() => {
  config.jobs.secret = SECRET;
  freezeClock(new Date(quizWindow(dayKeyOf(new Date())).opensAt.getTime() + 7 * HOUR));
});
afterEach(async () => {
  resetClock();
  config.jobs.secret = ORIGINAL_SECRET;
  await clearTestDb();
  clearTestInbox();
});

const today = (): string => dayKeyOf(now());

const runReminders = (secret: string = SECRET) =>
  request(app).post(`${API}/jobs/daily-quiz-reminders`).set('Authorization', `Bearer ${secret}`);
const runOutbox = (secret: string = SECRET) => request(app).post(`${API}/jobs/outbox`).set('Authorization', `Bearer ${secret}`);

/** The reminder emails captured so far — everything else in the inbox is a verification link. */
const reminderMail = () => getTestInbox().filter((mail) => mail.subject.startsWith("Today's Daily Quiz is open"));

async function seedAdmin(): Promise<{ adminCookies: Record<string, string>; taxonomy: Taxonomy }> {
  const { cookies: adminCookies } = await createAdminSession(app, {
    firstName: 'Author',
    lastName: 'Admin',
    mobile: '9000000001',
    email: 'author@example.com',
  });
  return { adminCookies, taxonomy: await createTaxonomy(app, adminCookies) };
}

/** Schedules a quiz for a class range on a day (today by default) from a fresh draft question. */
async function scheduleQuiz(
  adminCookies: Record<string, string>,
  taxonomy: Taxonomy,
  options: { day?: string; classMin?: number; classMax?: number; question?: Record<string, unknown> } = {},
): Promise<void> {
  const question = await createQuestionVia(app, adminCookies, taxonomy, options.question ?? {});
  await request(app)
    .post(`${API}/admin/daily-quiz`)
    .set('Cookie', cookieHeader(adminCookies))
    .send({ day: options.day ?? today(), classMin: options.classMin ?? 9, classMax: options.classMax ?? 12, questionId: question.id })
    .expect(201);
}

let serial = 0;

/** A verified, signed-in student with their own mobile and address; `remind` turns reminders on through the API. */
async function pupil(overrides: Partial<typeof validStudent> = {}, options: { remind?: boolean } = {}) {
  serial += 1;
  const tag = String(serial).padStart(4, '0');
  const { cookies, studentId, student } = await registerVerifyLogin(app, {
    mobile: `970000${tag}`,
    email: `pupil${tag}@example.com`,
    ...overrides,
  });
  if (options.remind) await setReminders(cookies, true);
  return { cookies, studentId, email: student.email };
}

function setReminders(cookies: Record<string, string>, on: boolean) {
  return request(app)
    .patch(`${API}/me/notification-preferences`)
    .set('Cookie', cookieHeader(cookies))
    .send({ dailyQuizReminders: on })
    .expect(200);
}

function putSettings(adminCookies: Record<string, string>, extra: Record<string, unknown>) {
  return request(app)
    .put(`${API}/admin/daily-quiz/settings`)
    .set('Cookie', cookieHeader(adminCookies))
    .send({ prizeHeadline: 'Solve daily. Win every month.', prizeText: 'Surprise gift + cash prize', cashAmount: null, instantResult: true, ...extra });
}

// ===========================================================================
// The job routes belong to the scheduler
// ===========================================================================

describe('the job routes need the scheduler’s secret', () => {
  it('answer 503 naming JOBS_SECRET when no secret is configured', async () => {
    config.jobs.secret = undefined;
    for (const path of ['/jobs/daily-quiz-reminders', '/jobs/outbox']) {
      const res = await request(app).post(`${API}${path}`).set('Authorization', `Bearer ${SECRET}`);
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('JOBS_SECRET');
    }
  });

  it('answer 401 to a missing, wrong or misspelt bearer — on both prefixes', async () => {
    for (const prefix of [API, '/api']) {
      for (const path of ['/jobs/daily-quiz-reminders', '/jobs/outbox']) {
        const missing = await request(app).post(`${prefix}${path}`);
        expect(missing.status).toBe(401);
        expect(missing.headers['www-authenticate']).toContain('Bearer');

        expect((await request(app).post(`${prefix}${path}`).set('Authorization', 'Bearer wrong')).status).toBe(401);
        // One character more, one character less: the comparison is of the whole secret.
        expect((await request(app).post(`${prefix}${path}`).set('Authorization', `Bearer ${SECRET}x`)).status).toBe(401);
        expect((await request(app).post(`${prefix}${path}`).set('Authorization', `Bearer ${SECRET.slice(0, -1)}`)).status).toBe(401);
        // The right value under the wrong scheme is still refused.
        expect((await request(app).post(`${prefix}${path}`).set('Authorization', `Basic ${SECRET}`)).status).toBe(401);
      }
    }
    // A refusal did nothing: no run was recorded.
    expect(await DailyQuizSettings.countDocuments({})).toBe(0);
  });

  it('answer 200 to the right secret, whatever the case of the scheme', async () => {
    const outbox = await runOutbox().expect(200);
    expect(outbox.body).toEqual({ success: true, drain: { claimed: 0, sent: 0, failed: 0, retrying: 0 } });
    expect(outbox.headers['cache-control']).toBe('no-store');

    const reminders = await request(app).post(`${API}/jobs/daily-quiz-reminders`).set('Authorization', `bearer ${SECRET}`).expect(200);
    expect(reminders.body.run).toMatchObject({ day: today(), enabled: true, eligible: 0, queued: 0 });
  });
});

// ===========================================================================
// Who is reminded
// ===========================================================================

describe('who gets a reminder', () => {
  it('reaches only opted-in, verified, active students in a class with a quiz who have not started — once each', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await scheduleQuiz(adminCookies, taxonomy, { classMin: 9, classMax: 12 });

    const wanted = await pupil({ classLevel: 'Class 9' }, { remind: true });
    const alsoWanted = await pupil({ classLevel: 'Class 12' }, { remind: true });
    await pupil({ classLevel: 'Class 9' }); // never turned reminders on
    await pupil({ classLevel: 'Class 5' }, { remind: true }); // no quiz for Class 5 today
    const started = await pupil({ classLevel: 'Class 10' }, { remind: true });
    await request(app).post(`${API}/me/daily-quiz/start`).set('Cookie', cookieHeader(started.cookies)).expect(201);
    const suspended = await pupil({ classLevel: 'Class 11' }, { remind: true });
    await Student.updateOne({ email: suspended.email }, { $set: { status: 'suspended' } });
    // Registered but never verified: the preference is set in the database, since they cannot sign in.
    await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, mobile: '9600000001', email: 'unverified@example.com' })
      .expect(201);
    await Student.updateOne({ email: 'unverified@example.com' }, { $set: { 'notificationPrefs.dailyQuizReminders': true } });

    const res = await runReminders().expect(200);
    expect(res.body.run).toMatchObject({
      day: today(),
      enabled: true,
      eligible: 3,
      alreadyStarted: 1,
      alreadyReminded: 0,
      overCap: 0,
      queued: 2,
      failed: 0,
    });

    const sentTo = reminderMail().map((mail) => mail.to).sort();
    expect(sentTo).toEqual([wanted.email, alsoWanted.email].sort());

    const rows = await EmailOutbox.find({ category: 'reminders' }).lean();
    expect(rows).toHaveLength(2);
    const ids = await Student.find({ email: { $in: [wanted.email, alsoWanted.email] } }).select('_id');
    expect(rows.map((row) => row.dedupeKey).sort()).toEqual(ids.map((doc) => reminderKey(today(), String(doc._id))).sort());
  });

  it('sends nobody a second reminder when the scheduler calls again — only a new opt-in is reached', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await scheduleQuiz(adminCookies, taxonomy);
    await pupil({}, { remind: true });
    await pupil({}, { remind: true });

    expect((await runReminders().expect(200)).body.run.queued).toBe(2);
    const again = await runReminders().expect(200);
    expect(again.body.run).toMatchObject({ eligible: 2, alreadyReminded: 2, queued: 0 });
    expect(await EmailOutbox.countDocuments({ category: 'reminders' })).toBe(2);
    expect(reminderMail()).toHaveLength(2);

    const late = await pupil({}, { remind: true });
    const third = await runReminders().expect(200);
    expect(third.body.run).toMatchObject({ eligible: 3, alreadyReminded: 2, queued: 1 });
    expect(reminderMail().map((mail) => mail.to)).toContain(late.email);
    expect(reminderMail()).toHaveLength(3);
  });

  it('sends nothing on a day with no quiz for anybody, even to students who want reminders', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    // Tomorrow's quiz is not today's.
    await scheduleQuiz(adminCookies, taxonomy, { day: shiftDay(today(), -1) });
    await pupil({}, { remind: true });

    const res = await runReminders().expect(200);
    expect(res.body.run).toMatchObject({ eligible: 0, queued: 0 });
    expect(await EmailOutbox.countDocuments({ category: 'reminders' })).toBe(0);
  });

  it('keeps to the daily cap, counting what is already queued, and a raised cap reaches the rest', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await scheduleQuiz(adminCookies, taxonomy);
    await putSettings(adminCookies, { reminderDailyCap: 2 }).expect(200);
    await pupil({}, { remind: true });
    await pupil({}, { remind: true });
    await pupil({}, { remind: true });

    const first = await runReminders().expect(200);
    expect(first.body.run).toMatchObject({ eligible: 3, queued: 2, overCap: 1 });

    // The two already queued count against today's cap, so a second run adds nobody.
    const second = await runReminders().expect(200);
    expect(second.body.run).toMatchObject({ queued: 0, alreadyReminded: 2, overCap: 1 });
    expect(await EmailOutbox.countDocuments({ category: 'reminders' })).toBe(2);

    await putSettings(adminCookies, { reminderDailyCap: 3 }).expect(200);
    const third = await runReminders().expect(200);
    expect(third.body.run).toMatchObject({ queued: 1, alreadyReminded: 2, overCap: 0 });
    expect(await EmailOutbox.countDocuments({ category: 'reminders' })).toBe(3);
  });

  it('queues nothing at a cap of 0', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await scheduleQuiz(adminCookies, taxonomy);
    await putSettings(adminCookies, { reminderDailyCap: 0 }).expect(200);
    await pupil({}, { remind: true });

    expect((await runReminders().expect(200)).body.run).toMatchObject({ eligible: 1, queued: 0, overCap: 1 });
    expect(await EmailOutbox.countDocuments({ category: 'reminders' })).toBe(0);
  });

  it('orders a capped day by a hash of the day — fixed within a day, different between days', () => {
    const students = Array.from({ length: 20 }, (_, index) => ({ _id: `student-${index}` }));
    const day = '2026-11-08';
    const order = rotationOrder(day, students).map((student) => student._id);
    expect(rotationOrder(day, students).map((student) => student._id)).toEqual(order);
    expect(rotationOrder(day, [...students].reverse()).map((student) => student._id)).toEqual(order);
    expect(rotationOrder('2026-11-09', students).map((student) => student._id)).not.toEqual(order);
    expect([...order].sort()).toEqual(students.map((student) => student._id).sort());
  });

  it('sends nothing while reminders are switched off, and still records that it ran', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await scheduleQuiz(adminCookies, taxonomy);
    await putSettings(adminCookies, { remindersEnabled: false }).expect(200);
    await pupil({}, { remind: true });

    const res = await runReminders().expect(200);
    expect(res.body.run).toMatchObject({ enabled: false, eligible: 0, queued: 0 });
    expect(await EmailOutbox.countDocuments({ category: 'reminders' })).toBe(0);

    const settings = await request(app).get(`${API}/admin/daily-quiz/settings`).set('Cookie', cookieHeader(adminCookies)).expect(200);
    expect(settings.body.settings.lastReminderRun).toMatchObject({ day: today(), enabled: false, queued: 0 });
  });
});

// ===========================================================================
// What the email says
// ===========================================================================

describe('the reminder email', () => {
  it('names the class range, the topic and the closing time — never the question or an option', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await scheduleQuiz(adminCookies, taxonomy, {
      question: {
        questionText: 'QUESTION-MARKER: what is $7 \\times 6$?',
        options: [
          { text: 'OPTION-MARKER-ONE', isCorrect: true },
          { text: 'OPTION-MARKER-TWO', isCorrect: false },
          { text: 'OPTION-MARKER-THREE', isCorrect: false },
          { text: 'OPTION-MARKER-FOUR', isCorrect: false },
        ],
        solution: 'SOLUTION-MARKER: six sevens are forty-two.',
      },
    });
    const quiz = await DailyChallenge.findOne({ day: today(), classLevel: 'Class 9' });
    const topic = quiz!.content!.topicName!;
    expect(topic).toBeTruthy();
    await pupil({ classLevel: 'Class 9' }, { remind: true });

    await runReminders().expect(200);
    const [mail] = reminderMail();
    expect(mail).toBeDefined();

    expect(mail!.subject).toBe("Today's Daily Quiz is open — Classes 9–12");
    for (const part of [mail!.text, mail!.html]) {
      expect(part).toContain('Classes 9–12');
      expect(part).toContain(topic);
      expect(part).toContain('11:59 PM tonight, India time');
      expect(part).toContain(`${config.publicAppUrl}/daily-quiz`);
      // How to turn it off — reminders are opt-in, so the off switch is named every time.
      expect(part).toContain('Notification preferences');
      // Nothing a reader could use before pressing Start.
      expect(part).not.toContain('MARKER');
      expect(part).not.toContain('7 \\times 6');
    }
    // It loads nothing: no image, no stylesheet, no web font.
    expect(mail!.html).not.toMatch(/<img|<link|@import|url\(/i);
  });
});

// ===========================================================================
// The outbox: priority, the batch, and expiry
// ===========================================================================

describe('the outbox and reminders', () => {
  it('sends a verification email before reminders that were queued earlier', async () => {
    for (const n of [1, 2, 3]) {
      await enqueueEmail(
        { to: `r${n}@example.com`, subject: "Today's Daily Quiz is open — Class 9", text: 'x', html: '<p>x</p>', category: 'reminders' },
        { dispatch: false },
      );
    }
    // Queued, not sent: `dispatch: false` starts no drain.
    expect(await EmailOutbox.countDocuments({ status: 'pending' })).toBe(3);

    // Registration queues a verification link and starts a drain, which picks by priority.
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const subjects = getTestInbox().map((mail) => mail.subject);
    expect(subjects).toHaveLength(4);
    expect(subjects[0]).toContain('Verify');
    expect(subjects.slice(1).every((subject) => subject.startsWith("Today's Daily Quiz"))).toBe(true);

    const rows = await EmailOutbox.find({}).lean();
    expect(rows.find((row) => row.category === 'transactional')?.priority).toBe(0);
    expect(rows.filter((row) => row.category === 'reminders').every((row) => row.priority === 2)).toBe(true);
  });

  it('gives each category its priority: account mail 0, news 1, reminders 2', async () => {
    const categories = ['transactional', 'security', 'announcement', 'results', 'reminders'] as const;
    for (const category of categories) {
      await enqueueEmail({ to: `${category}@example.com`, subject: category, text: 'x', html: 'x', category }, { dispatch: false });
    }
    const rows = await EmailOutbox.find({}).lean();
    const priority = Object.fromEntries(rows.map((row) => [row.category, row.priority]));
    expect(priority).toEqual({ transactional: 0, security: 0, announcement: 1, results: 1, reminders: 2 });
  });

  it('drains what is waiting when the scheduler calls /jobs/outbox', async () => {
    await enqueueEmail({ to: 'a@example.com', subject: 'One', text: 'x', html: 'x', category: 'announcement' }, { dispatch: false });
    await enqueueEmail({ to: 'b@example.com', subject: 'Two', text: 'x', html: 'x', category: 'reminders' }, { dispatch: false });
    expect(getTestInbox()).toHaveLength(0);

    const res = await runOutbox().expect(200);
    expect(res.body.drain).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
    expect(getTestInbox().map((mail) => mail.subject)).toEqual(['One', 'Two']);
    expect(await EmailOutbox.countDocuments({ status: 'sent' })).toBe(2);
  });

  it('expires a reminder fourteen days after it was queued, and nothing else', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await scheduleQuiz(adminCookies, taxonomy);
    await pupil({}, { remind: true });
    await runReminders().expect(200);

    const rows = await EmailOutbox.find({}).lean();
    const reminders = rows.filter((row) => row.category === 'reminders');
    expect(reminders).toHaveLength(1);
    const reminder = reminders[0]!;
    expect(reminder.expiresAt).toBeInstanceOf(Date);
    const kept = reminder.expiresAt!.getTime() - reminder.createdAt.getTime();
    expect(Math.abs(kept - 14 * DAY)).toBeLessThan(60_000);

    // Every verification link this test sent is kept for ever: no field for the TTL to read.
    const others = rows.filter((row) => row.category !== 'reminders');
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((row) => !('expiresAt' in row))).toBe(true);
  });

  it('has the TTL index on expiresAt and the drain’s priority index', async () => {
    const indexes = await EmailOutbox.collection.indexes();
    const ttl = indexes.find((index) => JSON.stringify(index.key) === JSON.stringify({ expiresAt: 1 }));
    expect(ttl?.expireAfterSeconds).toBe(0);
    expect(indexes.some((index) => JSON.stringify(index.key) === JSON.stringify({ status: 1, priority: 1, nextAttemptAt: 1 }))).toBe(true);
  });
});

// ===========================================================================
// The student's switch
// ===========================================================================

describe('the reminder preference', () => {
  it('is off until the student turns it on, saves alone, and is audited', async () => {
    const { cookies, studentId } = await pupil();
    const header = cookieHeader(cookies);

    const before = await request(app).get(`${API}/me/notification-preferences`).set('Cookie', header).expect(200);
    expect(before.body.preferences).toEqual({ announcements: true, results: true, dailyQuizReminders: false });

    const on = await setReminders(cookies, true);
    expect(on.body.preferences).toEqual({ announcements: true, results: true, dailyQuizReminders: true });
    const reread = await request(app).get(`${API}/me/notification-preferences`).set('Cookie', header).expect(200);
    expect(reread.body.preferences.dailyQuizReminders).toBe(true);

    const audit = await AuditLog.findOne({ action: 'student.profile.updated', targetId: studentId }).sort({ createdAt: -1 });
    expect(audit?.metadata).toMatchObject({ self: true, area: 'notification-preferences', fields: ['dailyQuizReminders'] });

    // Turning another switch leaves this one alone.
    await request(app).patch(`${API}/me/notification-preferences`).set('Cookie', header).send({ results: false }).expect(200);
    const after = await request(app).get(`${API}/me/notification-preferences`).set('Cookie', header).expect(200);
    expect(after.body.preferences).toEqual({ announcements: true, results: false, dailyQuizReminders: true });

    await request(app).patch(`${API}/me/notification-preferences`).set('Cookie', header).send({ dailyQuizReminders: 'yes' }).expect(400);
  });
});

// ===========================================================================
// The settings
// ===========================================================================

describe('the reminder settings', () => {
  it('round-trip, keep an omitted field, and refuse a cap outside 0–300', async () => {
    const { adminCookies } = await seedAdmin();
    const header = cookieHeader(adminCookies);

    const defaults = await request(app).get(`${API}/admin/daily-quiz/settings`).set('Cookie', header).expect(200);
    expect(defaults.body.settings).toMatchObject({ remindersEnabled: true, reminderDailyCap: 100, lastReminderRun: null });
    // Whether the scheduler can run here — a yes or no for the page, never the secret.
    expect(defaults.body.scheduler).toEqual({ configured: true });
    expect(JSON.stringify(defaults.body)).not.toContain(SECRET);
    config.jobs.secret = undefined;
    const unconfigured = await request(app).get(`${API}/admin/daily-quiz/settings`).set('Cookie', header).expect(200);
    expect(unconfigured.body.scheduler).toEqual({ configured: false });
    config.jobs.secret = SECRET;

    const saved = await putSettings(adminCookies, { remindersEnabled: false, reminderDailyCap: 50 }).expect(200);
    expect(saved.body.settings).toMatchObject({ remindersEnabled: false, reminderDailyCap: 50 });

    // A save that does not mention reminders keeps them as they were.
    const prizeOnly = await putSettings(adminCookies, { prizeText: 'A medal and a cash prize' }).expect(200);
    expect(prizeOnly.body.settings).toMatchObject({ prizeText: 'A medal and a cash prize', remindersEnabled: false, reminderDailyCap: 50 });

    await putSettings(adminCookies, { reminderDailyCap: 301 }).expect(400);
    await putSettings(adminCookies, { reminderDailyCap: -1 }).expect(400);
    await putSettings(adminCookies, { reminderDailyCap: 2.5 }).expect(400);
    // The last run is the job's to write, never a person's.
    await putSettings(adminCookies, { lastReminderRun: { day: today(), queued: 999 } }).expect(200);
    const reread = await request(app).get(`${API}/admin/daily-quiz/settings`).set('Cookie', header).expect(200);
    expect(reread.body.settings.lastReminderRun).toBeNull();
    expect(reread.body.settings.reminderDailyCap).toBe(50);
  });

  it('records the last run for the settings page without touching "last changed"', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    const header = cookieHeader(adminCookies);
    await scheduleQuiz(adminCookies, taxonomy);
    await putSettings(adminCookies, {}).expect(200);
    const changedAt = (await request(app).get(`${API}/admin/daily-quiz/settings`).set('Cookie', header).expect(200)).body.settings.updatedAt;
    await pupil({}, { remind: true });

    await runReminders().expect(200);

    const res = await request(app).get(`${API}/admin/daily-quiz/settings`).set('Cookie', header).expect(200);
    expect(res.body.settings.lastReminderRun).toEqual({
      day: today(),
      at: now().toISOString(),
      enabled: true,
      eligible: 1,
      alreadyStarted: 0,
      alreadyReminded: 0,
      overCap: 0,
      queued: 1,
      failed: 0,
    });
    expect(res.body.settings.updatedAt).toBe(changedAt);
  });

  it('records a run on an install that never saved its settings, and still says the defaults are in use', async () => {
    const { adminCookies } = await seedAdmin();
    await runReminders().expect(200);
    const res = await request(app).get(`${API}/admin/daily-quiz/settings`).set('Cookie', cookieHeader(adminCookies)).expect(200);
    expect(res.body.settings).toMatchObject({ updatedAt: null, remindersEnabled: true, reminderDailyCap: 100 });
    expect(res.body.settings.lastReminderRun).toMatchObject({ day: today(), queued: 0 });
  });
});

// ===========================================================================
// What the Daily Quiz page is told
// ===========================================================================

describe('today’s quiz offers a reminder only when one can be sent', () => {
  const getQuiz = (cookies: Record<string, string>) => request(app).get(`${API}/me/daily-quiz`).set('Cookie', cookieHeader(cookies));

  it('is unavailable without the scheduler’s secret, available with it, and reports the student’s own switch', async () => {
    const { adminCookies, taxonomy } = await seedAdmin();
    await scheduleQuiz(adminCookies, taxonomy);
    const { cookies } = await pupil();

    config.jobs.secret = undefined;
    expect((await getQuiz(cookies).expect(200)).body.reminders).toEqual({ on: false, available: false });

    config.jobs.secret = SECRET;
    expect((await getQuiz(cookies).expect(200)).body.reminders).toEqual({ on: false, available: true });

    await setReminders(cookies, true);
    expect((await getQuiz(cookies).expect(200)).body.reminders).toEqual({ on: true, available: true });

    await putSettings(adminCookies, { remindersEnabled: false }).expect(200);
    expect((await getQuiz(cookies).expect(200)).body.reminders).toEqual({ on: true, available: false });
  });

  it('is part of the answer on a day with no quiz too', async () => {
    const { cookies } = await pupil({}, { remind: true });
    const res = await getQuiz(cookies).expect(200);
    expect(res.body.reason).toBe('none-scheduled');
    expect(res.body.reminders).toEqual({ on: true, available: true });
  });
});
