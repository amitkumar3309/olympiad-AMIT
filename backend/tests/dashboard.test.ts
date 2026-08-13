import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type mongoose from 'mongoose';
import app from '../src/app';
import { ExamAttempt, Result, Student, StudentActivity } from '../src/models';
import { dayKeyOf, daysBetween, isDayKey, shiftDay, todayKey } from '../src/lib/competitionDay';
import { levelProgressFor, XP_AWARDS } from '../src/lib/xp';
import { summariseAchievements } from '../src/lib/achievements';
import { summariseStreak } from '../src/services/progressService';
import { displayNameFor } from '../src/services/leaderboardService';
import { recordActivity } from '../src/services/activityService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, loginRootAdmin, otherStudent, registerVerifyLogin } from './helpers/auth';
import { createPublishedQuestion, createQuestionVia, createTaxonomy } from './helpers/questions';

/**
 * Milestone 5 — the student dashboard.
 *
 * The requirement these tests exist to defend is "no fake statistics": every figure
 * the dashboard shows must be derived from a real database read, and a student with
 * no data must get an empty state rather than a plausible-looking number. So besides
 * the ordinary behaviour, this suite pins down the exact XP a brand-new account has
 * (an explainable 110, not "some number"), asserts the panels that have no data
 * source yet come back genuinely empty, and checks that the specific invented values
 * this milestone deleted are gone.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/**
 * What `registerVerifyLogin` legitimately earns: the account was created, the email
 * was verified through a real link, and signing in counted as today's visit.
 */
const NEW_ACCOUNT_XP = XP_AWARDS.account_created + XP_AWARDS.email_verified + XP_AWARDS.daily_visit;

async function objectIdOf(studentId: string): Promise<mongoose.Types.ObjectId> {
  const account = await Student.findOne({ studentId });
  if (!account) throw new Error(`No account ${studentId}`);
  return account._id as mongoose.Types.ObjectId;
}

/** Loads the dashboard for a signed-in student. */
async function loadDashboard(cookies: Record<string, string>) {
  const res = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies)).expect(200);
  return res.body.dashboard;
}

// ===========================================================================
// Pure rules: day boundaries, levels, streaks, achievements
// ===========================================================================

describe('competition day boundary', () => {
  it('files an instant late in the IST evening under that IST date, not the UTC one', () => {
    // 2026-06-01T19:30:00Z is 2026-06-02T01:00 IST — a new competition day.
    expect(dayKeyOf(new Date('2026-06-01T19:30:00.000Z'))).toBe('2026-06-02');
    // ...while 18:00 IST the same evening is still 2026-06-01.
    expect(dayKeyOf(new Date('2026-06-01T12:30:00.000Z'))).toBe('2026-06-01');
  });

  it('measures whole days between keys and shifts them without drift', () => {
    expect(daysBetween('2026-06-01', '2026-06-08')).toBe(7);
    expect(daysBetween('2026-06-08', '2026-06-01')).toBe(-7);
    expect(shiftDay('2026-03-01', 1)).toBe('2026-02-28');
    // Leap year, the classic off-by-one.
    expect(shiftDay('2028-03-01', 1)).toBe('2028-02-29');
  });

  it('rejects a malformed or impossible date key', () => {
    expect(isDayKey('2026-06-01')).toBe(true);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('01-06-2026')).toBe(false);
    expect(isDayKey(20260601)).toBe(false);
  });
});

describe('levels', () => {
  it('starts a new account at level 1 with zero XP', () => {
    const progress = levelProgressFor(0);
    expect(progress.level).toBe(1);
    expect(progress.xpIntoLevel).toBe(0);
    expect(progress.percentToNextLevel).toBe(0);
  });

  it('advances exactly at the threshold, not before it', () => {
    expect(levelProgressFor(99).level).toBe(1);
    expect(levelProgressFor(100).level).toBe(2);
    expect(levelProgressFor(249).level).toBe(2);
    expect(levelProgressFor(250).level).toBe(3);
  });

  it('reports a coherent position inside the current level', () => {
    const progress = levelProgressFor(150);
    expect(progress.level).toBe(2);
    expect(progress.levelStartsAt).toBe(100);
    expect(progress.nextLevelAt).toBe(250);
    expect(progress.xpIntoLevel).toBe(50);
    expect(progress.xpForNextLevel).toBe(150);
    expect(progress.percentToNextLevel).toBe(33);
  });

  it('keeps going past the end of the threshold table', () => {
    expect(levelProgressFor(7500).level).toBe(10);
    expect(levelProgressFor(10_000).level).toBe(11);
    expect(levelProgressFor(1_000_000).level).toBeGreaterThan(11);
  });

  it('clamps nonsense input instead of reporting a negative level', () => {
    expect(levelProgressFor(-500).level).toBe(1);
    expect(levelProgressFor(-500).xp).toBe(0);
  });
});

describe('streaks', () => {
  const today = '2026-06-10';

  it('is zero for a student with no activity at all', () => {
    const streak = summariseStreak([], today);
    expect(streak).toEqual({ current: 0, longest: 0, activeDays: 0, lastActiveOn: null, countedToday: false });
  });

  it('counts a single visit today as a streak of one', () => {
    const streak = summariseStreak([today], today);
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(1);
    expect(streak.countedToday).toBe(true);
  });

  it('counts consecutive days up to today', () => {
    const streak = summariseStreak(['2026-06-08', '2026-06-09', '2026-06-10'], today);
    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
    expect(streak.activeDays).toBe(3);
  });

  it('keeps the streak alive when the last visit was yesterday, since today is not yet lost', () => {
    const streak = summariseStreak(['2026-06-08', '2026-06-09'], today);
    expect(streak.current).toBe(2);
    expect(streak.countedToday).toBe(false);
  });

  it('breaks the streak once a whole day has been missed', () => {
    const streak = summariseStreak(['2026-06-07', '2026-06-08'], today);
    expect(streak.current).toBe(0);
    // The run still happened, so it still counts as the longest.
    expect(streak.longest).toBe(2);
  });

  it('reports the longest historical run even when the current one is shorter', () => {
    const streak = summariseStreak(
      ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-06-09', '2026-06-10'],
      today,
    );
    expect(streak.longest).toBe(4);
    expect(streak.current).toBe(2);
    expect(streak.activeDays).toBe(6);
  });

  it('is not confused by duplicate or unsorted input', () => {
    const streak = summariseStreak(['2026-06-10', '2026-06-08', '2026-06-10', '2026-06-09'], today);
    expect(streak.current).toBe(3);
    expect(streak.activeDays).toBe(3);
  });
});

describe('achievements', () => {
  const noProgress = {
    registered: true,
    xp: 0,
    level: 1,
    currentStreak: 0,
    longestStreak: 0,
    activeDays: 0,
    isEmailVerified: false,
    examsCompleted: 0,
    // Milestone 8. Zero here, so this fixture still means "a student who has done
    // nothing" and the assertions below keep testing what they were written to test.
    challengesCompleted: 0,
    longestChallengeStreak: 0,
    // Milestone 9, same reasoning. `RewardFacts` is now shared by the achievement,
    // badge and journey catalogues, so a new fact lands here too.
    practiceSessionsCompleted: 0,
    mockTestsCompleted: 0,
  };

  it('earns only what the facts support', () => {
    const summary = summariseAchievements(noProgress);
    const earned = summary.earned.map((a) => a.code);
    expect(earned).toEqual(['enrolled']);
    expect(summary.earnedCount).toBe(1);
  });

  it('earns the verification badge from the real verification flag', () => {
    const summary = summariseAchievements({ ...noProgress, isEmailVerified: true });
    expect(summary.earned.map((a) => a.code)).toContain('verified');
  });

  it('shows real progress toward a locked achievement rather than an empty bar', () => {
    const summary = summariseAchievements({ ...noProgress, longestStreak: 2 });
    const streak3 = summary.next.find((a) => a.code === 'streak_3');
    expect(streak3).toBeDefined();
    expect(streak3!.progress).toBe(2);
    expect(streak3!.target).toBe(3);
    expect(streak3!.earned).toBe(false);
  });

  it('never advertises an achievement that no data source could satisfy', () => {
    // Nothing writes an exam attempt anywhere in this codebase yet, so an
    // exam-based achievement would be permanently unearnable — a fake statistic
    // wearing a lock icon. Deliberately absent until the exam milestone.
    const codes = summariseAchievements(noProgress, 99).earned.concat(summariseAchievements(noProgress, 99).next).map((a) => a.code);
    expect(codes.some((code) => code.includes('exam'))).toBe(false);
    expect(codes.some((code) => code.includes('accuracy'))).toBe(false);
  });

  it('caps its progress at the target so a bar cannot overfill', () => {
    const summary = summariseAchievements({ ...noProgress, xp: 99_999 }, 99);
    const xp100 = summary.earned.find((a) => a.code === 'xp_100');
    expect(xp100!.progress).toBe(100);
    expect(xp100!.target).toBe(100);
  });
});

describe('leaderboard display names', () => {
  it('shows a first name and a last initial, not a child’s full name', () => {
    expect(displayNameFor({ firstName: 'Aarav', lastName: 'Mehta' })).toBe('Aarav M.');
  });

  it('falls back to the derived fullName for an account created before the name parts existed', () => {
    expect(displayNameFor({ fullName: 'Sneha Kulkarni' })).toBe('Sneha K.');
    expect(displayNameFor({ fullName: 'Madonna' })).toBe('Madonna');
  });

  it('never renders an empty label', () => {
    expect(displayNameFor({})).toBe('AMIT student');
  });
});

// ===========================================================================
// XP and progress, end to end
// ===========================================================================

describe('XP accrual', () => {
  it('gives a brand-new verified account exactly the XP its real events are worth', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);

    expect(dashboard.progress.xp).toBe(NEW_ACCOUNT_XP);
    expect(NEW_ACCOUNT_XP).toBe(110);
    expect(dashboard.progress.level).toBe(2);
  });

  it('does not pay twice for the same day, however many times the dashboard is opened', async () => {
    const { cookies } = await registerVerifyLogin(app);

    const first = await loadDashboard(cookies);
    const second = await loadDashboard(cookies);
    const third = await loadDashboard(cookies);

    expect(second.progress.xp).toBe(first.progress.xp);
    expect(third.progress.xp).toBe(first.progress.xp);
    expect(third.progress.streak.current).toBe(1);
  });

  it('does not pay twice for verifying, even if the flow is replayed', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const id = await objectIdOf(studentId);

    // A second attempt at the once-per-account event is refused by the unique index.
    const again = await recordActivity({ student: id, type: 'email_verified' });
    expect(again.recorded).toBe(false);
    expect(await StudentActivity.countDocuments({ student: id, type: 'email_verified' })).toBe(1);
  });

  it('counts a real multi-day history as a streak', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const id = await objectIdOf(studentId);
    const today = todayKey();

    // Two genuine prior visits, written through the same path a live visit uses.
    for (const daysAgo of [1, 2]) {
      const at = new Date(`${shiftDay(today, daysAgo)}T09:00:00.000Z`);
      const result = await recordActivity({ student: id, type: 'daily_visit', at });
      expect(result.recorded).toBe(true);
    }

    const dashboard = await loadDashboard(cookies);
    expect(dashboard.progress.streak.current).toBe(3);
    expect(dashboard.progress.streak.longest).toBe(3);
    expect(dashboard.progress.streak.activeDays).toBe(3);
    expect(dashboard.progress.streak.countedToday).toBe(true);
    // Three visits at 10 XP each, plus the account and verification events.
    expect(dashboard.progress.xp).toBe(XP_AWARDS.account_created + XP_AWARDS.email_verified + 3 * XP_AWARDS.daily_visit);
  });
});

// ===========================================================================
// The dashboard payload
// ===========================================================================

describe('GET /me/dashboard', () => {
  it('refuses an unauthenticated request', async () => {
    const res = await request(app).get(`${API}/me/dashboard`);
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(500);
  });

  it('is gated on the unversioned /api alias too', async () => {
    const res = await request(app).get('/api/me/dashboard');
    expect(res.status).toBe(401);
  });

  it('answers 404 for the root admin, which has no student record', async () => {
    const cookies = await loginRootAdmin(app);
    const res = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
  });

  it('returns the signed-in student’s own identity, never another account’s', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    await registerVerifyLogin(app, otherStudent);

    const dashboard = await loadDashboard(cookies);
    expect(dashboard.student.studentId).toBe(studentId);
  });

  it('shows a real activity feed built from what the student actually did', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);

    const types = dashboard.activity.map((entry: { type: string }) => entry.type);
    expect(types).toContain('account_created');
    expect(types).toContain('email_verified');
    expect(types).toContain('daily_visit');
    // Newest first.
    expect(new Date(dashboard.activity[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(dashboard.activity[dashboard.activity.length - 1].createdAt).getTime(),
    );
  });

  it('reports no test performance at all, rather than sample results', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);

    // Nothing in the product writes an ExamAttempt yet, so the honest answer is an
    // empty list and the UI shows its empty state. This asserts the panel is empty
    // *and* that no placeholder score leaked in.
    expect(dashboard.recentTests).toEqual([]);
    const serialised = JSON.stringify(dashboard.recentTests);
    expect(serialised).not.toContain('accuracy');
    expect(serialised).not.toContain('score');
  });

  it('does not contain any of the invented figures this milestone removed', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);
    const serialised = JSON.stringify(dashboard);

    for (const ghost of ['Ananya Sharma', 'Rahul Verma', 'Priya Singh', 'Rapid Calculus Sprint', 'Aarav Gupta', '8.91', '450+']) {
      expect(serialised, `dashboard still mentions ${ghost}`).not.toContain(ghost);
    }
  });

  it('summarises achievements from real facts', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);

    const earned = dashboard.achievements.earned.map((a: { code: string }) => a.code);
    expect(earned).toContain('enrolled');
    expect(earned).toContain('verified');
    // 110 XP really is past the 100 mark.
    expect(earned).toContain('xp_100');
    expect(earned).not.toContain('xp_500');
    expect(dashboard.achievements.total).toBeGreaterThan(dashboard.achievements.earnedCount);
  });

  it('places a lone student first, and reports the size of the ranked field', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);

    expect(dashboard.leaderboard.me.rank).toBe(1);
    expect(dashboard.leaderboard.me.xp).toBe(NEW_ACCOUNT_XP);
    expect(dashboard.leaderboard.me.totalRanked).toBe(1);
    expect(dashboard.leaderboard.top).toHaveLength(1);
  });

  it('shows an empty challenge list when the question bank has nothing for the class', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);
    expect(dashboard.challenges).toEqual([]);
  });
});

// ===========================================================================
// Leaderboard
// ===========================================================================

describe('leaderboard', () => {
  it('ranks students by their real XP, highest first', async () => {
    const leader = await registerVerifyLogin(app);
    const follower = await registerVerifyLogin(app, otherStudent);

    // The leader genuinely visited on two extra days.
    const leaderId = await objectIdOf(leader.studentId);
    for (const daysAgo of [1, 2]) {
      await recordActivity({ student: leaderId, type: 'daily_visit', at: new Date(`${shiftDay(todayKey(), daysAgo)}T09:00:00.000Z`) });
    }

    const res = await request(app).get(`${API}/leaderboard`).expect(200);
    const board = res.body.leaderboard;

    expect(board).toHaveLength(2);
    expect(board[0].studentId).toBe(leader.studentId);
    expect(board[1].studentId).toBe(follower.studentId);
    expect(board[0].xp).toBeGreaterThan(board[1].xp);
    expect(board[0].rank).toBe(1);
    expect(board[1].rank).toBe(2);
  });

  it('is readable without signing in, but publishes only a first name and last initial', async () => {
    await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/leaderboard`).expect(200);
    const [top] = res.body.leaderboard;

    expect(top.displayName).toBe('Test S.');
    // The full legal name, the email and the mobile number must not be published.
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('Test Kumar Student');
    expect(serialised).not.toContain('student@example.com');
    expect(serialised).not.toContain('9876543210');
  });

  it('excludes an account that is not in good standing', async () => {
    const student = await registerVerifyLogin(app);
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });

    const before = await request(app).get(`${API}/leaderboard`).expect(200);
    expect(before.body.leaderboard.map((r: { studentId: string }) => r.studentId)).toContain(student.studentId);

    await request(app)
      .patch(`${API}/admin/students/${student.studentId}/status`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ status: 'suspended', reason: 'Testing exclusion' })
      .expect(200);

    const after = await request(app).get(`${API}/leaderboard`).expect(200);
    expect(after.body.leaderboard.map((r: { studentId: string }) => r.studentId)).not.toContain(student.studentId);
  });

  it('leaves a student with no XP genuinely unranked instead of showing them last', async () => {
    // Registered but never verified and never signed in, so no XP-bearing event
    // beyond creation... and then that one is removed to model a legacy account.
    const registration = await request(app)
      .post(`${API}/auth/register`)
      .send({ ...otherStudent, email: 'silent@example.com', mobile: '9000000002' })
      .expect(201);
    const id = await objectIdOf(registration.body.student.studentId);
    await StudentActivity.deleteMany({ student: id });

    const res = await request(app).get(`${API}/leaderboard`).expect(200);
    expect(res.body.leaderboard).toEqual([]);
  });

  it('caps how much of the field one request can read', async () => {
    const res = await request(app).get(`${API}/leaderboard?limit=500`);
    expect(res.status).toBe(400);
  });

  it('returns an empty board rather than an error when nobody has any XP', async () => {
    const res = await request(app).get(`${API}/leaderboard`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.leaderboard).toEqual([]);
  });
});

// ===========================================================================
// Public participation figures
// ===========================================================================

describe('GET /public/stats', () => {
  it('counts real accounts, real schools and real activity', async () => {
    await registerVerifyLogin(app);
    await registerVerifyLogin(app, { ...otherStudent, schoolName: 'A Different School' });

    const res = await request(app).get(`${API}/public/stats`).expect(200);
    const { stats } = res.body;

    expect(stats.studentsRegistered).toBe(2);
    expect(stats.registeredToday).toBe(2);
    expect(stats.schoolsRepresented).toBe(2);
    // Both signed in, so both are active today.
    expect(stats.studentsActiveToday).toBe(2);
  });

  it('answers zero on an empty deployment instead of inventing a headline number', async () => {
    const res = await request(app).get(`${API}/public/stats`).expect(200);
    expect(res.body.stats).toEqual({
      studentsRegistered: 0,
      registeredToday: 0,
      schoolsRepresented: 0,
      studentsActiveToday: 0,
    });
  });
});

// ===========================================================================
// Challenges, derived from the published question bank
// ===========================================================================

describe('available challenges', () => {
  it('lists published questions for the student’s own class, grouped by subject', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });
    const taxonomy = await createTaxonomy(app, adminCookies);
    await createPublishedQuestion(app, adminCookies, taxonomy, { classLevel: 'Class 9', marks: 4 });
    await createPublishedQuestion(app, adminCookies, taxonomy, { classLevel: 'Class 9', marks: 6, difficulty: 'Hard' });

    const { cookies } = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const dashboard = await loadDashboard(cookies);

    expect(dashboard.challenges).toHaveLength(1);
    expect(dashboard.challenges[0].subjectName).toBe('Mathematics');
    expect(dashboard.challenges[0].questionCount).toBe(2);
    expect(dashboard.challenges[0].totalMarks).toBe(10);
    expect(dashboard.challenges[0].difficulties).toEqual(['Hard', 'Medium']);
  });

  it('does not offer questions written for a different class', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });
    const taxonomy = await createTaxonomy(app, adminCookies);
    await createPublishedQuestion(app, adminCookies, taxonomy, { classLevel: 'Class 11' });

    const { cookies } = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 6' });
    const dashboard = await loadDashboard(cookies);
    expect(dashboard.challenges).toEqual([]);
  });

  it('does not count unpublished drafts as available', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });
    const taxonomy = await createTaxonomy(app, adminCookies);
    await createQuestionVia(app, adminCookies, taxonomy, { classLevel: 'Class 9' });

    const { cookies } = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const dashboard = await loadDashboard(cookies);
    expect(dashboard.challenges).toEqual([]);
  });
});

describe('GET /me/daily-challenge', () => {
  async function publishOneFor(classLevel: string) {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });
    const taxonomy = await createTaxonomy(app, adminCookies);
    await createPublishedQuestion(app, adminCookies, taxonomy, { classLevel });
  }

  it('never includes the answer key', async () => {
    await publishOneFor('Class 9');
    const { cookies } = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });

    const res = await request(app).get(`${API}/me/daily-challenge`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.challenge).not.toBeNull();
    const serialised = JSON.stringify(res.body);
    for (const forbidden of ['isCorrect', 'solution', 'booleanAnswer', 'numericAnswer', 'tolerance']) {
      expect(serialised, `daily challenge leaked ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('is the same question all day, so it cannot be rerolled by reloading', async () => {
    await publishOneFor('Class 9');
    const { cookies } = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const cookie = cookieHeader(cookies);

    const first = await request(app).get(`${API}/me/daily-challenge`).set('Cookie', cookie).expect(200);
    const second = await request(app).get(`${API}/me/daily-challenge`).set('Cookie', cookie).expect(200);

    expect(second.body.challenge.question.id).toBe(first.body.challenge.question.id);
    expect(second.body.challenge.day).toBe(first.body.challenge.day);
  });

  it('says there is no challenge rather than inventing one when nothing is published', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/me/daily-challenge`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.challenge).toBeNull();
    expect(res.body.reason).toBe('none-published');
  });

  it('still serves the legacy /daily-challenge path, but now requires a session', async () => {
    const anonymous = await request(app).get(`${API}/daily-challenge`);
    expect(anonymous.status).toBe(401);

    const { cookies } = await registerVerifyLogin(app);
    const signedIn = await request(app).get(`${API}/daily-challenge`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(signedIn.body.success).toBe(true);
    // The mock it replaced is gone.
    expect(JSON.stringify(signedIn.body)).not.toContain('Rapid Calculus Sprint');
  });
});

// ===========================================================================
// Analytics — the endpoint that used to fabricate a student's performance
// ===========================================================================

describe('GET /analytics/:studentId', () => {
  /**
   * The exact figures the deleted `MOCK_ANALYTICS_FALLBACK` served to every student,
   * as their own measured performance, on a page linked from their dashboard.
   */
  const FABRICATED = ['Calculus & Limits', 'Algebraic Identities', 'Trigonometric Ratios', 'Coordinate Geometry', 'top 5%', '450'];

  it('reports honestly that accuracy is not measured yet, instead of inventing it', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/analytics/${studentId}`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.data).toBeNull();
    expect(res.body.reason).toBe('no-exam-data');
  });

  it('contains none of the invented performance figures it used to return', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/analytics/${studentId}`).set('Cookie', cookieHeader(cookies)).expect(200);

    const serialised = JSON.stringify(res.body);
    for (const ghost of FABRICATED) {
      expect(serialised, `analytics still mentions ${ghost}`).not.toContain(ghost);
    }
    // The specific claim that mattered most: an accuracy the student never earned.
    expect(serialised).not.toContain('overallAccuracy');
  });

  it('returns real XP per day from the activity log', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const id = await objectIdOf(studentId);
    const today = todayKey();
    const yesterday = shiftDay(today, 1);

    await recordActivity({ student: id, type: 'daily_visit', at: new Date(`${yesterday}T09:00:00.000Z`) });

    const res = await request(app).get(`${API}/analytics/${studentId}`).set('Cookie', cookieHeader(cookies)).expect(200);

    const byDay: Array<{ day: string; xp: number }> = res.body.xpByDay;
    // Oldest first, and only days that actually have activity — a day the student
    // did nothing is omitted rather than plotted as a measured zero.
    expect(byDay.map((p) => p.day)).toEqual([yesterday, today]);
    expect(byDay[0]!.xp).toBe(XP_AWARDS.daily_visit);
    expect(byDay[1]!.xp).toBe(XP_AWARDS.account_created + XP_AWARDS.email_verified + XP_AWARDS.daily_visit);
    // The series sums to exactly the XP the dashboard reports — one source of truth.
    expect(byDay.reduce((sum, p) => sum + p.xp, 0)).toBe(NEW_ACCOUNT_XP + XP_AWARDS.daily_visit);
  });

  it('still refuses to show one student another student’s analytics', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const other = await registerVerifyLogin(app, otherStudent);

    const res = await request(app).get(`${API}/analytics/${other.studentId}`).set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(403);
  });

  it('answers 404 for a student ID that does not exist', async () => {
    const { cookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });

    const res = await request(app).get(`${API}/analytics/AMIT_9999`).set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
  });
});

// ===========================================================================
// Result portal — the page that used to invent a score from a hash
// ===========================================================================

describe('GET /results/:studentId', () => {
  /** A published result plus the attempt carrying the marks, inserted directly. */
  async function publishResultFor(studentId: string): Promise<void> {
    await Result.create({
      studentId,
      examId: 'OLYMPIAD-2027-PRELIM',
      nationalRank: 12,
      stateRank: 3,
      percentile: 97.5,
      xpEarned: 250,
      badges: ['Finalist'],
      isPublished: true,
    });
    await ExamAttempt.create({
      studentId,
      status: 'Submitted',
      totalScore: 46,
      accuracy: 92,
      timeTakenSeconds: 1800,
      answers: Array.from({ length: 50 }, (_, i) => ({ questionId: `q${i}`, selectedOption: 'a', isCorrect: i < 46 })),
      endTime: new Date(),
    });
  }

  it('reports that nothing is published rather than inventing a score', async () => {
    const { studentId } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/results/${studentId}`).expect(200);

    expect(res.body.result).toBeNull();
    expect(res.body.reason).toBe('not-published');
  });

  it('answers identically for a student ID that does not exist, so the portal cannot be used to enumerate accounts', async () => {
    const { studentId } = await registerVerifyLogin(app);

    const real = await request(app).get(`${API}/results/${studentId}`).expect(200);
    const fake = await request(app).get(`${API}/results/AMIT_0001`).expect(200);

    expect(fake.body).toEqual(real.body);
  });

  it('rejects a malformed student ID instead of searching for it', async () => {
    const res = await request(app).get(`${API}/results/not-an-id`);
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });

  it('returns the real marks and ranks once a result is published', async () => {
    const { studentId } = await registerVerifyLogin(app);
    await publishResultFor(studentId);

    const res = await request(app).get(`${API}/results/${studentId}`).expect(200);

    expect(res.body.result.score).toBe(46);
    expect(res.body.result.totalMarks).toBe(50);
    expect(res.body.result.accuracy).toBe(92);
    expect(res.body.result.nationalRank).toBe(12);
    expect(res.body.result.percentile).toBe(97.5);
    expect(res.body.result.badges).toEqual(['Finalist']);
    expect(res.body.result.studentName).toBe('Test Kumar Student');
  });

  it('keeps an unpublished result invisible, so marks cannot be read before release', async () => {
    const { studentId } = await registerVerifyLogin(app);
    await Result.create({ studentId, examId: 'OLYMPIAD-2027-PRELIM', isPublished: false, xpEarned: 0, badges: [] });

    const res = await request(app).get(`${API}/results/${studentId}`).expect(200);
    expect(res.body.result).toBeNull();
  });

  it('never exposes contact details alongside a published result', async () => {
    const { studentId } = await registerVerifyLogin(app);
    await publishResultFor(studentId);

    const res = await request(app).get(`${API}/results/${studentId}`).expect(200);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('student@example.com');
    expect(serialised).not.toContain('9876543210');
    expect(serialised).not.toContain('Example Road');
  });
});

describe('GET /certificates/:studentId', () => {
  it('issues nothing while no result is published, and no longer returns the old mock', async () => {
    const { studentId } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/certificates/${studentId}`).expect(200);

    expect(res.body.certificates).toEqual([]);
    const serialised = JSON.stringify(res.body);
    // The hardcoded pair this endpoint used to return for any id.
    expect(serialised).not.toContain('National Math Olympiad Finalist');
    expect(serialised).not.toContain('Advanced Calculus Masterclass');
    expect(serialised).not.toContain('CERT-2026-01');
  });

  it('issues one once a result is published', async () => {
    const { studentId } = await registerVerifyLogin(app);
    await Result.create({
      studentId,
      examId: 'OLYMPIAD-2027-PRELIM',
      percentile: 97.5,
      isPublished: true,
      xpEarned: 0,
      badges: [],
    });

    const res = await request(app).get(`${API}/certificates/${studentId}`).expect(200);

    expect(res.body.certificates).toHaveLength(1);
    expect(res.body.certificates[0].studentName).toBe('Test Kumar Student');
    expect(res.body.certificates[0].percentile).toBe(97.5);
    // No invented issue date — the model does not store one.
    expect(res.body.certificates[0].issuedAt).toBeNull();
  });
});

// ===========================================================================
// Admin statistics — replaced a hardcoded accuracy trend
// ===========================================================================

describe('GET /admin/stats', () => {
  it('refuses a student and a guest', async () => {
    const guest = await request(app).get(`${API}/admin/stats`);
    expect(guest.status).toBe(401);

    const { cookies } = await registerVerifyLogin(app);
    const student = await request(app).get(`${API}/admin/stats`).set('Cookie', cookieHeader(cookies));
    expect(student.status).toBe(403);
  });

  it('returns real registration and activity counts on a fixed 14-day axis', async () => {
    const { cookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });
    await registerVerifyLogin(app, { ...otherStudent, email: 'extra@example.com', mobile: '9000000002' });

    const res = await request(app).get(`${API}/admin/stats`).set('Cookie', cookieHeader(cookies)).expect(200);
    const { stats } = res.body;

    expect(stats.registrationsByDay).toHaveLength(14);
    expect(stats.activeStudentsByDay).toHaveLength(14);
    // Oldest first, ending today.
    expect(stats.registrationsByDay[13].day).toBe(todayKey());

    // Both accounts registered today; both signed in, so both are active today.
    expect(stats.registrationsByDay[13].count).toBe(2);
    expect(stats.activeStudentsByDay[13].count).toBe(2);
    expect(stats.totalStudents).toBe(2);
    expect(stats.totalActiveToday).toBe(2);
  });

  it('contains none of the fabricated accuracy figures it replaced', async () => {
    const { cookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });

    const res = await request(app).get(`${API}/admin/stats`).set('Cookie', cookieHeader(cookies)).expect(200);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('accuracy');
    for (const ghost of ['72', '78', '82', '88', '90', '92']) {
      // The old series, as a complete set — a real count could legitimately be any
      // single one of these, so the assertion is that they do not all appear together.
      expect(serialised.includes(`"count":${ghost}`)).toBe(false);
    }
  });
});

// ===========================================================================
// Activity feed
// ===========================================================================

describe('GET /me/activity', () => {
  it('paginates the student’s own real activity', async () => {
    const { cookies } = await registerVerifyLogin(app);
    await loadDashboard(cookies);

    const res = await request(app).get(`${API}/me/activity?page=1&limit=2`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it('refuses an unauthenticated request', async () => {
    const res = await request(app).get(`${API}/me/activity`);
    expect(res.status).toBe(401);
  });

  it('rejects a limit outside the allowed range instead of honouring it', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/me/activity?limit=5000`).set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(400);
  });
});
