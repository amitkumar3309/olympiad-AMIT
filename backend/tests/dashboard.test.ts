import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app';
import { DailyChallengeAttempt, MockTestAttempt, PracticeSession, Student, StudentActivity, StudentPhoto } from '../src/models';
import { dayKeyOf, daysBetween, isDayKey, shiftDay, todayKey } from '../src/lib/competitionDay';
import { levelProgressFor, XP_AWARDS } from '../src/lib/xp';
import { summariseAchievements } from '../src/lib/achievements';
import { getCachedPublicStats, resetPublicStatsCache, summariseStreak } from '../src/services/progressService';
import { JOURNEY_STAGES } from '../src/lib/journey';
import { displayNameFor } from '../src/services/leaderboardService';
import { recordActivity } from '../src/services/activityService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, loginRootAdmin, otherStudent, registerVerifyLogin } from './helpers/auth';
import { createPublishedQuestion, createQuestionVia, createTaxonomy } from './helpers/questions';
import { publishAndIssue, seedExam, seedSubmittedAttempt } from './helpers/exams';

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
  // The public figures are cached per process for ten minutes; each test starts cold.
  resetPublicStatsCache();
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

  it('serves the root administrator its own dashboard, now that it has a record', async () => {
    // Reversed in Milestone 11. This used to be a 404, because the root admin was
    // an environment identity with nothing to look up. It now has an account, so
    // every `/me` route resolves for it like anybody else — and a route that
    // cannot 404 for the most privileged caller is one fewer special case.
    const cookies = await loginRootAdmin(app);
    const res = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookieHeader(cookies));

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);
    expect(res.body.dashboard.student.studentId).toMatch(/^ADMIN_\d{4}$/);
    // Zero, and deliberately so: the super admin earns no XP, because every
    // leaderboard is an aggregation over the same activity log and a staff account
    // has no business ranking above the children who entered.
    expect(res.body.dashboard.progress.xp).toBe(0);
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
  });

  it('shows an empty challenge list when the question bank has nothing for the class', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);
    expect(dashboard.challenges).toEqual([]);
  });
});

// ===========================================================================
// The launch dashboard's figures (Milestone 30, Phase 4)
// ===========================================================================

describe('GET /me/dashboard — the launch figures', () => {
  const quizAnswer = (student: mongoose.Types.ObjectId, day: string, isCorrect: boolean, submittedAt = new Date()) =>
    DailyChallengeAttempt.create({
      challenge: new mongoose.Types.ObjectId(),
      student,
      day,
      answer: {
        question: new mongoose.Types.ObjectId(),
        revision: 1,
        type: 'single_choice',
        marks: 1,
        negativeMarks: 0,
        correctOptionKeys: ['a'],
        selectedOptionKeys: [isCorrect ? 'a' : 'b'],
        isCorrect,
        awardedMarks: isCorrect ? 1 : 0,
      },
      xpAwarded: 0,
      submittedAt,
    });

  /** A submitted practice session with `correct` of `answered` right, out of `served`. */
  const practice = (student: mongoose.Types.ObjectId, correct: number, answered: number, submittedAt = new Date(), served = answered) =>
    PracticeSession.create({
      student,
      filters: { classLevel: 'Class 9' },
      totalQuestions: served,
      unansweredCount: served - answered,
      maxMarks: served * 4,
      status: 'submitted',
      submittedAt,
      correctCount: correct,
    });

  it('tells a new student the truth: XP this week, nothing solved, no accuracy yet, the journey started', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);

    // Every XP a new account has was earned today, so all of it is "this week".
    expect(dashboard.stats.xpThisWeek).toBe(NEW_ACCOUNT_XP);
    expect(dashboard.stats.questionsSolved).toEqual({ total: 0, thisWeek: 0 });
    // Null, not zero: "answered nothing" is not "answered everything wrong".
    expect(dashboard.stats.accuracy).toEqual({ percent: null, correct: 0, answered: 0, attempts: 0, window: 30 });
    expect(dashboard.journey.stages).toHaveLength(JOURNEY_STAGES.length);
    expect(dashboard.journey.stages[0].complete).toBe(true);
    expect(dashboard.journey.currentStageId).not.toBeNull();
    expect(dashboard.student.hasPhoto).toBe(true);
    expect(dashboard.upcoming).toEqual([]);
    // The panels the mockup does not have are gone from the payload too.
    expect(dashboard.recentTests).toBeUndefined();
    expect(dashboard.leaderboard.top).toBeUndefined();
  });

  it('counts the student’s own questions solved — this week by submission, and a Daily Quiz only once revealed', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const { studentId: otherId } = await registerVerifyLogin(app, otherStudent);
    const me = await objectIdOf(studentId);
    const today = todayKey();

    await practice(me, 3, 5); // this week
    await practice(me, 2, 4, new Date(Date.now() - 10 * 86_400_000)); // ten days ago: total only
    await practice(await objectIdOf(otherId), 7, 7); // somebody else's
    await quizAnswer(me, shiftDay(today, 1), true); // yesterday's, revealed: both
    await quizAnswer(me, shiftDay(today, 2), false); // wrong: neither
    await quizAnswer(me, today, true); // today's, not revealed yet: neither

    const dashboard = await loadDashboard(cookies);
    expect(dashboard.stats.questionsSolved).toEqual({ total: 3 + 2 + 1, thisWeek: 3 + 1 });
  });

  it('measures accuracy over the last 30 attempts by summing raw counts, never averaging percentages', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const me = await objectIdOf(studentId);

    await practice(me, 1, 1, new Date(Date.now() - 2000));
    await practice(me, 1, 9, new Date(Date.now() - 1000));
    // In progress: nothing on it has been marked, so it is not an attempt yet.
    await PracticeSession.create({ student: me, filters: { classLevel: 'Class 9' }, totalQuestions: 5, maxMarks: 20, status: 'in_progress', correctCount: 5 });

    const dashboard = await loadDashboard(cookies);
    // 2 of 10 is 20%. The average of 100% and 11.1% would be 55.6%.
    expect(dashboard.stats.accuracy).toMatchObject({ percent: 20, correct: 2, answered: 10, attempts: 2 });
  });

  it('keeps only the most recent 30 attempts in the accuracy window', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const me = await objectIdOf(studentId);
    const base = Date.now() - 60 * 60_000;

    // The oldest attempt is all wrong; the thirty after it are all right.
    await practice(me, 0, 10, new Date(base));
    for (let i = 1; i <= 30; i += 1) await quizAnswer(me, shiftDay(todayKey(), 31 - i + 1), true, new Date(base + i * 1000));

    const dashboard = await loadDashboard(cookies);
    expect(dashboard.stats.accuracy).toMatchObject({ percent: 100, correct: 30, answered: 30, attempts: 30 });
  });

  it('shows today’s board for the student’s own class, with their own standing', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const { studentId: classmateId } = await registerVerifyLogin(app, otherStudent);
    await registerVerifyLogin(app, { ...otherStudent, mobile: '9000000777', email: 'seventh@example.com', classLevel: 'Class 7' });

    const dashboard = await loadDashboard(cookies);
    expect(dashboard.classToday.classLevel).toBe('Class 9');
    const ids = dashboard.classToday.rows.map((row: { studentId: string }) => row.studentId);
    expect(ids.sort()).toEqual([classmateId, studentId].sort());
    // Everybody's XP today is the same three events, so the two share first place.
    expect(dashboard.classToday.rows.every((row: { rank: number }) => row.rank === 1)).toBe(true);
    expect(dashboard.classToday.me).toMatchObject({ rank: 1, xp: NEW_ACCOUNT_XP, totalRanked: 2 });
  });

  it('lists only real exam windows still to come for the student’s class', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });
    const hour = 60 * 60 * 1000;
    const soon = await seedExam(app, adminCookies, { opensAt: new Date(Date.now() + 2 * hour), closesAt: new Date(Date.now() + 5 * hour) });
    const open = await seedExam(app, adminCookies, { opensAt: new Date(Date.now() - hour), closesAt: new Date(Date.now() + hour) });
    await seedExam(app, adminCookies); // closed an hour ago
    await seedExam(app, adminCookies, { classLevel: 'Class 7', opensAt: new Date(Date.now() + hour), closesAt: new Date(Date.now() + 2 * hour) });
    await seedExam(app, adminCookies, { status: 'draft', opensAt: new Date(Date.now() + hour), closesAt: new Date(Date.now() + 2 * hour) });

    const { cookies } = await registerVerifyLogin(app);
    const dashboard = await loadDashboard(cookies);
    expect(dashboard.upcoming.map((row: { id: string }) => row.id)).toEqual([String(open.exam._id), String(soon.exam._id)]);
    expect(dashboard.upcoming[0]).toMatchObject({ isOpen: true, title: open.exam.title });
    expect(dashboard.upcoming[1].isOpen).toBe(false);
    // Never a question on it.
    expect(JSON.stringify(dashboard.upcoming)).not.toContain('question');
  });

  it('says on the session whether the account has a photo, so the app never asks for one that is missing', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const me = await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(me.body.student.hasPhoto).toBe(true);

    await StudentPhoto.deleteMany({ student: await objectIdOf(studentId) });
    const without = await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(without.body.student.hasPhoto).toBe(false);
    expect((await loadDashboard(cookies)).student.hasPhoto).toBe(false);
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
      questionsSolved: 0,
    });
  });

  it('counts questions answered correctly — submitted papers and revealed Daily Quizzes only', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const student = (await Student.findOne({ studentId }))!._id as mongoose.Types.ObjectId;
    const today = todayKey();

    const practice = { student, filters: { classLevel: 'Class 9' as const }, totalQuestions: 5, maxMarks: 20 };
    await PracticeSession.create({ ...practice, status: 'submitted', submittedAt: new Date(), correctCount: 3 });
    // Abandoned half-way: none of its answers were ever submitted, so none count.
    await PracticeSession.create({ ...practice, status: 'in_progress', correctCount: 5 });

    await MockTestAttempt.create({
      test: new mongoose.Types.ObjectId(),
      student,
      attemptNumber: 1,
      status: 'submitted',
      totalQuestions: 10,
      maxMarks: 40,
      durationMinutes: 30,
      score: 16,
      correctCount: 4,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60_000),
      submittedAt: new Date(),
    });

    const quizAnswer = (day: string, isCorrect: boolean) =>
      DailyChallengeAttempt.create({
        challenge: new mongoose.Types.ObjectId(),
        student,
        day,
        answer: {
          question: new mongoose.Types.ObjectId(),
          revision: 1,
          type: 'single_choice',
          marks: 1,
          negativeMarks: 0,
          correctOptionKeys: ['a'],
          selectedOptionKeys: [isCorrect ? 'a' : 'b'],
          isCorrect,
          awardedMarks: isCorrect ? 1 : 0,
        },
        xpAwarded: 0,
        submittedAt: new Date(),
      });
    await quizAnswer(shiftDay(today, 1), true); // yesterday's, revealed: counts
    await quizAnswer(shiftDay(today, 2), false); // revealed but wrong: does not
    await quizAnswer(today, true); // today's is not revealed yet: does not

    const res = await request(app).get(`${API}/public/stats`).expect(200);
    expect(res.body.stats.questionsSolved).toBe(3 + 4 + 1);
  });

  it('serves one computation for ten minutes, and says so to shared caches', async () => {
    await registerVerifyLogin(app);
    const first = await request(app).get(`${API}/public/stats`).expect(200);
    expect(first.body.stats.studentsRegistered).toBe(1);
    expect(first.headers['cache-control']).toContain('s-maxage=600');

    await registerVerifyLogin(app, otherStudent);
    const cached = await request(app).get(`${API}/public/stats`).expect(200);
    expect(cached.body.stats.studentsRegistered).toBe(1);

    // Past the ten minutes, the figures are recomputed.
    const later = await getCachedPublicStats(Date.now() + 11 * 60_000);
    expect(later.studentsRegistered).toBe(2);
  });
});

describe('GET /public/journey', () => {
  it('lists the nine milestones from the one definition, words only', async () => {
    const res = await request(app).get(`${API}/public/journey`).expect(200);

    expect(res.body.stages).toHaveLength(JOURNEY_STAGES.length);
    expect(res.body.stages.map((s: { id: string }) => s.id)).toEqual(JOURNEY_STAGES.map((s) => s.id));
    for (const stage of res.body.stages) {
      expect(Object.keys(stage).sort()).toEqual(['description', 'id', 'title']);
    }
    expect(res.headers['cache-control']).toContain('public');
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

  /**
   * The tile must not advertise practice the practice page then refuses to start.
   *
   * `getPracticeAvailability()` and `startPracticeSession()` became subject-scoped in Milestone 21
   * Phase J, so an unscoped tile here offered "Physics · 104 questions" against a practice page with
   * nothing to show for it. A promise the next screen cannot keep is worse than an absent one.
   */
  it('does not advertise another subject’s questions', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Staff',
      lastName: 'Member',
      mobile: '9000000001',
      email: 'staff@example.com',
    });
    const maths = await createTaxonomy(app, adminCookies);
    await createPublishedQuestion(app, adminCookies, maths, { classLevel: 'Class 9' });

    const physics = await createTaxonomy(app, adminCookies, {
      subject: 'Physics',
      topic: 'Semiconductor Electronics',
    });
    await createPublishedQuestion(app, adminCookies, physics, { classLevel: 'Class 9' });

    const { cookies } = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const dashboard = await loadDashboard(cookies);

    expect(dashboard.challenges).toHaveLength(1);
    expect(dashboard.challenges[0].subjectName).toBe('Mathematics');
    expect(dashboard.challenges[0].questionCount).toBe(1);
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

// `GET /me/daily-challenge` was replaced by the Daily Quiz in Milestone 30. Its
// properties — the answer key withheld, the day pinned, no quiz invented, a session
// required — are asserted against the new routes in `tests/dailyQuiz.test.ts`.

describe('GET /analytics/:studentId', () => {
  /**
   * The exact figures the deleted `MOCK_ANALYTICS_FALLBACK` served to every student,
   * as their own measured performance, on a page linked from their dashboard.
   */
  const FABRICATED = ['Calculus & Limits', 'Algebraic Identities', 'Trigonometric Ratios', 'Coordinate Geometry', 'top 5%', '450'];

  it('reports honestly that accuracy is not measured yet, instead of inventing it', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/analytics/${studentId}`).set('Cookie', cookieHeader(cookies)).expect(200);

    // The shape changed in Milestone 15 — analytics are now derived from real attempts
    // rather than read from the never-written `StudentAnalytics` document, so there is
    // no `data: null` / `reason` pair any more. The property under test is unchanged
    // and is the one that matters: a student who has answered nothing is told that,
    // rather than being shown a number.
    expect(res.body.analytics.hasData).toBe(false);
    expect(res.body.analytics.overall.accuracyPercent).toBeNull();
    expect(res.body.analytics.overall.answered).toBe(0);
    expect(res.body.analytics.notes).toContain('nothing-submitted-yet');
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
  /**
   * A published result, produced by the **real** publication path (Milestone 13):
   * an official exam, a submitted attempt, then `publishResults()`. Inserting a
   * `Result` row by hand would skip the very code that computes rank and percentile.
   */
  async function publishResultFor(studentId: string): Promise<void> {
    // The examiner is a second account; `otherStudent` is free because the student
    // under test is always `validStudent`, and the database is cleared between tests.
    const { cookies } = await createAdminSession(app, otherStudent);
    const { exam } = await seedExam(app, cookies, { questionCount: 5, marksEach: 10 });
    await seedSubmittedAttempt(exam, studentId, 5);
    await publishAndIssue(exam);
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

    // Five questions at 10 marks, all correct.
    expect(res.body.result.score).toBe(50);
    expect(res.body.result.totalMarks).toBe(50);
    expect(res.body.result.percentage).toBe(100);
    expect(res.body.result.accuracy).toBe(100);
    // The only candidate, so first of one — computed, not asserted into existence.
    expect(res.body.result.rank).toBe(1);
    expect(res.body.result.totalCandidates).toBe(1);
    expect(res.body.result.percentile).toBe(100);
    /**
     * Masked, not the full legal name it used to be (security audit, 2026-08-17).
     * This route is unauthenticated and keyed on an identifier with only ten thousand
     * values, so returning "Test Kumar Student" made it a way to walk the numbering and
     * harvest the roll — more than the leaderboard publishes about the same children.
     * `displayNameFor()` is the one place that decides this.
     */
    expect(res.body.result.studentName).toBe('Test S.');
    expect(JSON.stringify(res.body)).not.toContain('Test Kumar Student');
  });

  it('keeps an unpublished result invisible, so marks cannot be read before release', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);
    const { exam } = await seedExam(app, cookies, { questionCount: 2 });
    await seedSubmittedAttempt(exam, studentId, 2);
    // Submitted and graded, but never published — the common real state.

    const res = await request(app).get(`${API}/results/${studentId}`).expect(200);
    expect(res.body.result).toBeNull();
    expect(res.body.reason).toBe('not-published');
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

  it('issues one once an official result is published', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);
    const { exam } = await seedExam(app, cookies, { questionCount: 4, marksEach: 10 });
    await seedSubmittedAttempt(exam, studentId, 4);
    await publishAndIssue(exam);

    const res = await request(app).get(`${API}/certificates/${studentId}`).expect(200);

    expect(res.body.certificates).toHaveLength(1);
    // Masked for the same reason as the result portal above — this listing is public.
    expect(res.body.certificates[0].studentName).toBe('Test S.');
    // 100% clears the default 85% distinction threshold.
    expect(res.body.certificates[0].tier).toBe('distinction');
    expect(res.body.certificates[0].percentage).toBe(100);
    // A real issue date now exists, because a real issuance happened.
    expect(res.body.certificates[0].issuedAt).not.toBeNull();
    expect(res.body.certificates[0].certificateId).toMatch(/^AMIT-CERT-\d{4}-\d{6}$/);
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
