import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app';
import {
  DailyChallengeAttempt,
  MockTestAttempt,
  PracticeSession,
  Student,
  StudentActivity,
  type StudentDocument,
} from '../src/models';
import { shiftDay, todayKey, type DayKey } from '../src/lib/competitionDay';
import type { ClassLevel } from '../src/lib/classLevels';
import {
  getLeaderboardPage,
  getStandingFor,
  periodWindow,
  type LeaderboardPeriod,
} from '../src/services/leaderboardService';
import { getHallOfFame, type HallOfFameBoardCode } from '../src/services/hallOfFameService';
import { PUBLIC_LEADERBOARD_MAX_ROWS } from '../src/routes/v1/leaderboard.routes';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, registerVerifyLogin } from './helpers/auth';

/**
 * Milestone 10 — leaderboards and the Hall of Fame.
 *
 * These tests exist to defend three properties, in descending order of how badly a
 * regression in each would hurt:
 *
 *  1. **A rank is correct.** Ranking is the one feature of this product whose output a
 *     student will compare against another student's screen. It has to order by the
 *     right number, share a rank between equals, skip after a tie, keep the same order
 *     between two identical requests, and stay consistent across a page boundary — the
 *     place where an off-by-one is easiest to write and hardest to notice.
 *  2. **The value ranked is the server's.** Nothing a client sends may become an XP
 *     total or a rank. The endpoint's whole input surface is a scope, a period and a
 *     page.
 *  3. **The Hall of Fame is real.** Every entry is a feat somebody performed, and a
 *     board with nothing behind it is empty rather than padded.
 *
 * Most of the fixtures write `StudentActivity` rows directly rather than driving the
 * product to earn them. That is deliberate: these suites are about *ranking* a set of
 * totals, and earning 2,000 XP through the API would take a hundred requests and pin
 * down the reward rules a second time (they already have their own suite). The rows
 * written are the same shape `recordActivity()` writes.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

const TODAY: DayKey = '2026-08-13';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sequence = 0;

interface SeedOptions {
  firstName?: string;
  lastName?: string;
  classLevel?: ClassLevel;
  schoolName?: string;
  status?: 'active' | 'suspended' | 'deactivated';
}

/** A registered account, created directly — registration has its own 40 tests. */
async function seedStudent(options: SeedOptions = {}): Promise<StudentDocument> {
  sequence += 1;
  const n = String(sequence).padStart(4, '0');
  return Student.create({
    firstName: options.firstName ?? `Student${n}`,
    lastName: options.lastName ?? 'Example',
    fatherName: 'Father Example',
    motherName: 'Mother Example',
    dateOfBirth: new Date('2010-04-15'),
    classLevel: options.classLevel ?? 'Class 9',
    schoolName: options.schoolName ?? 'Springfield Public School',
    address: '12 Example Road, Example City, 110001',
    mobile: `90000${n}`,
    email: `seed-${n}@example.com`,
    passwordHash: 'not-a-real-hash',
    studentId: `AMIT_${n}`,
    isEmailVerified: true,
    status: options.status ?? 'active',
  });
}

function idOf(student: StudentDocument): mongoose.Types.ObjectId {
  return student._id as mongoose.Types.ObjectId;
}

/**
 * Records XP on a given competition day.
 *
 * Uses `profile_updated` because it is the one *repeatable* activity type — it carries
 * no dedupe key, so the partial unique index lets a fixture place several rows on one
 * day. The XP is passed explicitly, exactly as `recordActivity()` stores it: a snapshot
 * of what the event was worth at the time, never a lookup on read.
 */
async function award(student: StudentDocument, xp: number, day: DayKey = TODAY, at = new Date(`${day}T06:00:00.000Z`)) {
  await StudentActivity.create({
    student: idOf(student),
    type: 'profile_updated',
    xpAwarded: xp,
    occurredOn: day,
    createdAt: at,
  });
}

/** A student holding exactly `xp`, whose total was reached at `at`. */
async function studentWith(xp: number, options: SeedOptions & { day?: DayKey; at?: Date } = {}) {
  const student = await seedStudent(options);
  if (xp > 0) await award(student, xp, options.day ?? TODAY, options.at);
  return student;
}

async function overallBoard(page = 1, limit = 10, period: LeaderboardPeriod = 'all_time') {
  return getLeaderboardPage({ scope: 'overall', period, today: TODAY }, { page, limit });
}

// ===========================================================================
// Ordering and ranks
// ===========================================================================

describe('ranking: order and rank numbers', () => {
  it('orders by XP descending and numbers the ranks from one', async () => {
    await studentWith(50, { firstName: 'Low' });
    await studentWith(300, { firstName: 'High' });
    await studentWith(150, { firstName: 'Middle' });

    const { rows } = await overallBoard();

    expect(rows.map((r) => r.displayName)).toEqual(['High E.', 'Middle E.', 'Low E.']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.xp)).toEqual([300, 150, 50]);
  });

  it('gives tied students the same rank, and skips the ranks the tie consumed', async () => {
    await studentWith(300, { firstName: 'Alpha' });
    await studentWith(200, { firstName: 'Bravo' });
    await studentWith(200, { firstName: 'Charlie' });
    await studentWith(100, { firstName: 'Delta' });

    const { rows } = await overallBoard();

    // Standard competition ranking: 1, 2, 2, 4 — never 1, 2, 3, 4 and never 1, 2, 2, 3.
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(rows.map((r) => r.xp)).toEqual([300, 200, 200, 100]);
  });

  it('breaks a tie in favour of whoever reached the total first', async () => {
    // Same XP, different moments of arriving at it.
    await studentWith(200, { firstName: 'Later', at: new Date(`${TODAY}T10:00:00.000Z`) });
    await studentWith(200, { firstName: 'Earlier', at: new Date(`${TODAY}T04:00:00.000Z`) });

    const { rows } = await overallBoard();

    expect(rows.map((r) => r.displayName)).toEqual(['Earlier E.', 'Later E.']);
    // ...and they still *share* the rank. Order is a display decision; the rank is not.
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });

  it('returns the identical order for two identical requests', async () => {
    // Six students all on the same XP and the same instant: nothing but the final
    // tie-break on the account id can order them, which is exactly the case that would
    // come back shuffled if the ordering were not a total one.
    const at = new Date(`${TODAY}T08:00:00.000Z`);
    for (let i = 0; i < 6; i += 1) await studentWith(120, { firstName: `Same${i}`, at });

    const first = await overallBoard();
    const second = await overallBoard();

    expect(second.rows.map((r) => r.studentId)).toEqual(first.rows.map((r) => r.studentId));
    expect(first.rows.every((r) => r.rank === 1)).toBe(true);
  });

  it('leaves a student with no XP unranked rather than showing them last', async () => {
    await studentWith(0, { firstName: 'Nothing' });
    await studentWith(10, { firstName: 'Something' });

    const { rows, pagination } = await overallBoard();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe('Something E.');
    expect(pagination.total).toBe(1);
  });

  it('excludes accounts that are not in good standing, without leaving a gap', async () => {
    await studentWith(500, { firstName: 'Suspended', status: 'suspended' });
    await studentWith(400, { firstName: 'Deactivated', status: 'deactivated' });
    await studentWith(300, { firstName: 'Active' });
    await studentWith(200, { firstName: 'AlsoActive' });

    const { rows, pagination } = await overallBoard();

    expect(rows.map((r) => r.displayName)).toEqual(['Active E.', 'AlsoActive E.']);
    // The suspended pair must not have consumed ranks 1 and 2 and pushed these to 3 and 4.
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(pagination.total).toBe(2);
  });
});

// ===========================================================================
// One student's standing
// ===========================================================================

describe('ranking: a single standing', () => {
  it('agrees with the position that student occupies in the list', async () => {
    await studentWith(500);
    await studentWith(400);
    const me = await studentWith(300);
    await studentWith(100);

    const standing = await getStandingFor(idOf(me), { scope: 'overall', period: 'all_time', today: TODAY });
    const { rows } = await overallBoard();

    expect(standing.rank).toBe(3);
    expect(standing.xp).toBe(300);
    expect(standing.totalRanked).toBe(4);
    expect(rows.find((r) => r.studentId === me.studentId)!.rank).toBe(standing.rank);
  });

  it('shares the rank of an equal, matching the list', async () => {
    await studentWith(500);
    const me = await studentWith(200);
    await studentWith(200);

    const standing = await getStandingFor(idOf(me), { scope: 'overall', period: 'all_time', today: TODAY });
    expect(standing.rank).toBe(2);
  });

  it('reports a real XP total but no rank for a suspended account', async () => {
    const me = await studentWith(900, { status: 'suspended' });
    await studentWith(100);

    const standing = await getStandingFor(idOf(me), { scope: 'overall', period: 'all_time', today: TODAY });

    // The XP is theirs and is reported honestly; what they have lost is the position.
    expect(standing.xp).toBe(900);
    expect(standing.rank).toBeNull();
    expect(standing.totalRanked).toBe(1);
  });

  it('reports no rank on a class board the student is not in', async () => {
    const me = await studentWith(900, { classLevel: 'Class 9' });
    await studentWith(100, { classLevel: 'Class 10' });

    const standing = await getStandingFor(idOf(me), {
      scope: 'class',
      classLevel: 'Class 10',
      period: 'all_time',
      today: TODAY,
    });

    expect(standing.rank).toBeNull();
    expect(standing.totalRanked).toBe(1);
  });

  it('reports no rank for a student with no XP', async () => {
    const me = await studentWith(0);
    await studentWith(100);

    const standing = await getStandingFor(idOf(me), { scope: 'overall', period: 'all_time', today: TODAY });
    expect(standing.rank).toBeNull();
    expect(standing.xp).toBe(0);
  });
});

// ===========================================================================
// Scopes
// ===========================================================================

describe('ranking: class scope', () => {
  it('ranks within the class, not within the platform', async () => {
    await studentWith(900, { firstName: 'Senior', classLevel: 'Class 12 - Science' });
    await studentWith(800, { firstName: 'AlsoSenior', classLevel: 'Class 12 - Science' });
    await studentWith(200, { firstName: 'Junior', classLevel: 'Class 9' });
    await studentWith(100, { firstName: 'AlsoJunior', classLevel: 'Class 9' });

    const { rows, pagination } = await getLeaderboardPage(
      { scope: 'class', classLevel: 'Class 9', period: 'all_time', today: TODAY },
      { page: 1, limit: 10 },
    );

    expect(rows.map((r) => r.displayName)).toEqual(['Junior E.', 'AlsoJunior E.']);
    // Ranks 1 and 2 — the two Class 12 students, who hold more XP, are not ahead here.
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(pagination.total).toBe(2);
    expect(rows.every((r) => r.classLevel === 'Class 9')).toBe(true);
  });

  it('is empty, not wrong, for a class nobody has XP in', async () => {
    await studentWith(500, { classLevel: 'Class 9' });

    const { rows, pagination } = await getLeaderboardPage(
      { scope: 'class', classLevel: 'Class 7', period: 'all_time', today: TODAY },
      { page: 1, limit: 10 },
    );

    expect(rows).toEqual([]);
    expect(pagination.total).toBe(0);
  });
});

// ===========================================================================
// Periods
// ===========================================================================

describe('ranking: time periods', () => {
  it('counts only XP earned inside the window', async () => {
    const veteran = await seedStudent({ firstName: 'Veteran' });
    // A large total, all of it earned well before this week.
    await award(veteran, 2000, shiftDay(TODAY, 20));

    const newcomer = await seedStudent({ firstName: 'Newcomer' });
    await award(newcomer, 50, TODAY);
    await award(newcomer, 40, shiftDay(TODAY, 2));

    const allTime = await overallBoard(1, 10, 'all_time');
    expect(allTime.rows.map((r) => r.displayName)).toEqual(['Veteran E.', 'Newcomer E.']);
    expect(allTime.rows[0]!.xp).toBe(2000);

    // Over the last seven days the veteran has earned nothing, so they are not on the
    // board at all — not present with a large number, and not present with zero.
    const weekly = await overallBoard(1, 10, 'weekly');
    expect(weekly.rows.map((r) => r.displayName)).toEqual(['Newcomer E.']);
    expect(weekly.rows[0]!.xp).toBe(90);
  });

  it('includes the oldest day of the window and excludes the day before it', async () => {
    const inside = await seedStudent({ firstName: 'Inside' });
    await award(inside, 10, shiftDay(TODAY, 6)); // the 7th day back, inclusive

    const outside = await seedStudent({ firstName: 'Outside' });
    await award(outside, 999, shiftDay(TODAY, 7)); // one day too old

    const weekly = await overallBoard(1, 10, 'weekly');
    expect(weekly.rows.map((r) => r.displayName)).toEqual(['Inside E.']);
  });

  it('counts today only on the daily board', async () => {
    const today = await seedStudent({ firstName: 'Today' });
    await award(today, 25, TODAY);

    const yesterday = await seedStudent({ firstName: 'Yesterday' });
    await award(yesterday, 500, shiftDay(TODAY, 1));

    const daily = await overallBoard(1, 10, 'daily');
    expect(daily.rows.map((r) => r.displayName)).toEqual(['Today E.']);
    expect(daily.rows[0]!.xp).toBe(25);
  });

  it('reports the window it summed, so a page never has to guess', () => {
    expect(periodWindow('all_time', TODAY)).toEqual({ from: null, to: TODAY });
    expect(periodWindow('daily', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(periodWindow('weekly', TODAY)).toEqual({ from: '2026-08-07', to: TODAY });
    expect(periodWindow('monthly', TODAY)).toEqual({ from: '2026-07-15', to: TODAY });
  });

  it('ranks a period board on the period total, not the lifetime one', async () => {
    const steady = await seedStudent({ firstName: 'Steady' });
    await award(steady, 5000, shiftDay(TODAY, 40));
    await award(steady, 10, TODAY);

    const surging = await seedStudent({ firstName: 'Surging' });
    await award(surging, 300, TODAY);

    const daily = await overallBoard(1, 10, 'daily');
    expect(daily.rows.map((r) => r.displayName)).toEqual(['Surging E.', 'Steady E.']);
    expect(daily.rows.map((r) => r.xp)).toEqual([300, 10]);
  });
});

// ===========================================================================
// Pagination
// ===========================================================================

describe('ranking: pagination', () => {
  /** Twelve students on 1200, 1100, ... 100 XP — a strict order with no ties. */
  async function seedDescendingCohort(count: number) {
    for (let i = 0; i < count; i += 1) {
      await studentWith((count - i) * 100, { firstName: `Rank${String(i + 1).padStart(2, '0')}` });
    }
  }

  it('continues the ranks across pages without a gap or an overlap', async () => {
    await seedDescendingCohort(12);

    const first = await overallBoard(1, 5);
    const second = await overallBoard(2, 5);
    const third = await overallBoard(3, 5);

    expect(first.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(second.rows.map((r) => r.rank)).toEqual([6, 7, 8, 9, 10]);
    expect(third.rows.map((r) => r.rank)).toEqual([11, 12]);

    const seen = [...first.rows, ...second.rows, ...third.rows].map((r) => r.studentId);
    expect(new Set(seen).size).toBe(12);
  });

  it('keeps a shared rank when the tie straddles a page boundary', async () => {
    // Four students, the middle two tied — with a page size of 2 the tie is split
    // across the boundary, which is the case a naive `skip + index + 1` gets wrong.
    await studentWith(400, { firstName: 'First' });
    await studentWith(300, { firstName: 'TiedA', at: new Date(`${TODAY}T04:00:00.000Z`) });
    await studentWith(300, { firstName: 'TiedB', at: new Date(`${TODAY}T05:00:00.000Z`) });
    await studentWith(100, { firstName: 'Last' });

    const first = await overallBoard(1, 2);
    const second = await overallBoard(2, 2);

    expect(first.rows.map((r) => r.rank)).toEqual([1, 2]);
    // The second half of the tie still holds rank 2, then the next distinct XP is 4.
    expect(second.rows.map((r) => r.rank)).toEqual([2, 4]);
    expect(second.rows.map((r) => r.displayName)).toEqual(['TiedB E.', 'Last E.']);
  });

  it('agrees with the whole board read in one request', async () => {
    await seedDescendingCohort(9);

    const whole = await overallBoard(1, 50);
    const paged = [
      ...(await overallBoard(1, 4)).rows,
      ...(await overallBoard(2, 4)).rows,
      ...(await overallBoard(3, 4)).rows,
    ];

    expect(paged).toEqual(whole.rows);
  });

  it('counts the whole board, not the page', async () => {
    await seedDescendingCohort(7);

    const { pagination } = await overallBoard(2, 3);
    expect(pagination).toEqual({ page: 2, limit: 3, total: 7, totalPages: 3 });
  });

  it('returns an empty page past the end rather than failing', async () => {
    await seedDescendingCohort(3);

    const { rows, pagination } = await overallBoard(9, 10);
    expect(rows).toEqual([]);
    expect(pagination.total).toBe(3);
  });
});

// ===========================================================================
// The HTTP surface
// ===========================================================================

describe('GET /leaderboard', () => {
  it('is readable without signing in, and publishes a masked name only', async () => {
    await studentWith(300, { firstName: 'Ishaan', lastName: 'Verma' });

    const res = await request(app).get(`${API}/leaderboard`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.leaderboard[0].displayName).toBe('Ishaan V.');
    // The whole body, not just the fields the page happens to read: a leaderboard row
    // must never carry a contact detail, and a full surname is a contact detail here.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Verma');
    expect(body).not.toContain('@example.com');
    expect(body).not.toContain('90000');
    expect(body).not.toContain('Example Road');
  });

  it('ignores an XP or rank supplied in the query string', async () => {
    await studentWith(120, { firstName: 'Honest' });

    const res = await request(app)
      .get(`${API}/leaderboard?xp=999999&rank=1&score=500&totalRanked=99&displayName=Hacker`)
      .expect(200);

    // The unknown keys are stripped by the schema before the handler runs, and the row
    // still reports what the activity log actually holds.
    expect(res.body.leaderboard).toHaveLength(1);
    expect(res.body.leaderboard[0].xp).toBe(120);
    expect(res.body.leaderboard[0].rank).toBe(1);
    expect(res.body.leaderboard[0].displayName).toBe('Honest E.');
  });

  it('has no write surface at all', async () => {
    // There is no way to *submit* a standing: the resource is a read.
    await request(app).post(`${API}/leaderboard`).send({ xp: 100000 }).expect(404);
    await request(app).put(`${API}/leaderboard`).send({ rank: 1 }).expect(404);
  });

  it('refuses a class board without a class, and an unknown class', async () => {
    await request(app).get(`${API}/leaderboard?scope=class`).expect(400);
    await request(app).get(`${API}/leaderboard?scope=class&classLevel=Class%2099`).expect(400);
    await request(app).get(`${API}/leaderboard?scope=overall&period=fortnightly`).expect(400);
  });

  it('accepts the scopes and periods it documents', async () => {
    await studentWith(80, { classLevel: 'Class 9' });

    for (const period of ['all_time', 'monthly', 'weekly', 'daily']) {
      const res = await request(app).get(`${API}/leaderboard?period=${period}`).expect(200);
      expect(res.body.period).toBe(period);
    }
    const scoped = await request(app).get(`${API}/leaderboard?scope=class&classLevel=Class%209`).expect(200);
    expect(scoped.body.scope).toBe('class');
    expect(scoped.body.classLevel).toBe('Class 9');
  });

  it('caps how deep an anonymous visitor may page, but not a signed-in student', async () => {
    const { cookies } = await registerVerifyLogin(app);

    const pageWithinCap = Math.floor(PUBLIC_LEADERBOARD_MAX_ROWS / 50);
    const pageBeyondCap = pageWithinCap + 1;

    await request(app).get(`${API}/leaderboard?limit=50&page=${pageWithinCap}`).expect(200);

    const refused = await request(app).get(`${API}/leaderboard?limit=50&page=${pageBeyondCap}`).expect(403);
    expect(refused.body.success).toBe(false);

    // The same request from inside the product is fine: a student is already part of
    // this list and needs to be able to find themselves in it.
    await request(app)
      .get(`${API}/leaderboard?limit=50&page=${pageBeyondCap}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
  });

  it('tells an anonymous caller how deep they may go, and a student that they are unlimited', async () => {
    const anonymous = await request(app).get(`${API}/leaderboard`).expect(200);
    expect(anonymous.body.maxRankedDepth).toBe(PUBLIC_LEADERBOARD_MAX_ROWS);
    expect(anonymous.body.me).toBeNull();

    const { cookies } = await registerVerifyLogin(app);
    const signedIn = await request(app).get(`${API}/leaderboard`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(signedIn.body.maxRankedDepth).toBeNull();
  });

  it("includes a signed-in student's own standing alongside the rows", async () => {
    // A real account earning real XP through the product, so this asserts the standing
    // against the reward engine's own figures rather than a hand-written fixture.
    const { cookies, studentId } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/leaderboard`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.me).not.toBeNull();
    expect(res.body.me.rank).toBe(1);
    expect(res.body.me.totalRanked).toBe(1);
    const own = res.body.leaderboard.find((row: { studentId: string }) => row.studentId === studentId);
    expect(own.xp).toBe(res.body.me.xp);
  });

  it('answers an empty platform with an empty board rather than an error', async () => {
    const res = await request(app).get(`${API}/leaderboard`).expect(200);
    expect(res.body.leaderboard).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('is reachable on the unversioned compatibility alias too', async () => {
    await studentWith(60);
    const versioned = await request(app).get(`${API}/leaderboard`).expect(200);
    const alias = await request(app).get('/api/leaderboard').expect(200);
    expect(alias.body.leaderboard).toEqual(versioned.body.leaderboard);
  });
});

// ===========================================================================
// Hall of Fame
// ===========================================================================

const BOARD_CODES: HallOfFameBoardCode[] = [
  'xp_champions',
  'mock_masters',
  'streak_legends',
  'challenge_champions',
  'practice_devotees',
];

function boardOf(view: Awaited<ReturnType<typeof getHallOfFame>>, code: HallOfFameBoardCode) {
  const board = view.boards.find((b) => b.code === code);
  if (!board) throw new Error(`No board ${code}`);
  return board;
}

/** A submitted mock-test attempt scoring `score` out of `maxMarks`. */
async function seedMockAttempt(
  student: StudentDocument,
  score: number,
  maxMarks: number,
  extra: { accuracy?: number; timeTakenSeconds?: number; submittedAt?: Date } = {},
) {
  await MockTestAttempt.create({
    test: new mongoose.Types.ObjectId(),
    student: idOf(student),
    attemptNumber: 1,
    status: 'submitted',
    totalQuestions: 10,
    maxMarks,
    durationMinutes: 30,
    score,
    accuracy: extra.accuracy ?? 100,
    startedAt: new Date(`${TODAY}T05:00:00.000Z`),
    expiresAt: new Date(`${TODAY}T05:30:00.000Z`),
    submittedAt: extra.submittedAt ?? new Date(`${TODAY}T05:20:00.000Z`),
    timeTakenSeconds: extra.timeTakenSeconds ?? 1200,
  });
}

async function seedChallengeAttempt(student: StudentDocument, day: DayKey, isCorrect: boolean) {
  await DailyChallengeAttempt.create({
    challenge: new mongoose.Types.ObjectId(),
    student: idOf(student),
    day,
    answer: {
      question: new mongoose.Types.ObjectId(),
      revision: 1,
      type: 'single_choice',
      marks: 3,
      negativeMarks: 0,
      correctOptionKeys: ['a'],
      selectedOptionKeys: [isCorrect ? 'a' : 'b'],
      isCorrect,
      awardedMarks: isCorrect ? 3 : 0,
    },
    xpAwarded: 15,
    submittedAt: new Date(`${day}T06:00:00.000Z`),
  });
}

async function seedPracticeSession(student: StudentDocument, status: 'submitted' | 'in_progress') {
  await PracticeSession.create({
    student: idOf(student),
    filters: { classLevel: 'Class 9' },
    totalQuestions: 5,
    maxMarks: 20,
    status,
    submittedAt: status === 'submitted' ? new Date(`${TODAY}T07:00:00.000Z`) : null,
  });
}

describe('hall of fame', () => {
  it('presents every board empty, with a reason, on a platform where nothing has happened', async () => {
    const view = await getHallOfFame(5, TODAY);

    expect(view.boards.map((b) => b.code)).toEqual(BOARD_CODES);
    for (const board of view.boards) {
      expect(board.entries).toEqual([]);
      // Empty, and honest about it — never a placeholder name to fill the space.
      expect(board.emptyReason.length).toBeGreaterThan(10);
    }
    expect(view.totals).toEqual({
      studentsRanked: 0,
      xpAwarded: 0,
      mockTestsGraded: 0,
      challengesAnswered: 0,
      practiceSessionsCompleted: 0,
    });
  });

  it('honours the same XP order the leaderboard shows', async () => {
    await studentWith(400, { firstName: 'Top' });
    await studentWith(200, { firstName: 'Second' });

    const view = await getHallOfFame(5, TODAY);
    const board = boardOf(view, 'xp_champions');
    const { rows } = await overallBoard();

    expect(board.entries.map((e) => e.studentId)).toEqual(rows.map((r) => r.studentId));
    expect(board.entries.map((e) => e.rank)).toEqual(rows.map((r) => r.rank));
    expect(board.entries[0]!.value).toBe(400);
  });

  it('ranks the best paper by percentage, not by raw score', async () => {
    const short = await seedStudent({ firstName: 'Short' });
    await seedMockAttempt(short, 20, 20); // 100% of a small paper

    const long = await seedStudent({ firstName: 'Long' });
    await seedMockAttempt(long, 60, 100); // a bigger score, a worse paper

    const board = boardOf(await getHallOfFame(5, TODAY), 'mock_masters');

    expect(board.entries.map((e) => e.displayName)).toEqual(['Short E.', 'Long E.']);
    expect(board.entries[0]!.value).toBe(100);
    expect(board.entries[0]!.valueLabel).toBe('100% · 20/20');
  });

  it('keeps only each student’s best paper', async () => {
    const student = await seedStudent({ firstName: 'Improving' });
    await seedMockAttempt(student, 10, 100);
    await MockTestAttempt.create({
      test: new mongoose.Types.ObjectId(),
      student: idOf(student),
      attemptNumber: 2,
      status: 'submitted',
      totalQuestions: 10,
      maxMarks: 100,
      durationMinutes: 30,
      score: 90,
      accuracy: 90,
      startedAt: new Date(`${TODAY}T08:00:00.000Z`),
      expiresAt: new Date(`${TODAY}T08:30:00.000Z`),
      submittedAt: new Date(`${TODAY}T08:20:00.000Z`),
      timeTakenSeconds: 1200,
    });

    const board = boardOf(await getHallOfFame(5, TODAY), 'mock_masters');

    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]!.value).toBe(90);
  });

  it('leaves an unfinished or unscored paper off the board', async () => {
    const zero = await seedStudent({ firstName: 'Zero' });
    await seedMockAttempt(zero, 0, 50);

    const open = await seedStudent({ firstName: 'Open' });
    await MockTestAttempt.create({
      test: new mongoose.Types.ObjectId(),
      student: idOf(open),
      attemptNumber: 1,
      status: 'in_progress',
      totalQuestions: 10,
      maxMarks: 50,
      durationMinutes: 30,
      score: 50,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const board = boardOf(await getHallOfFame(5, TODAY), 'mock_masters');
    expect(board.entries).toEqual([]);
  });

  it('honours the longest streak, and does not withdraw it when the run is broken', async () => {
    const student = await seedStudent({ firstName: 'Consistent' });
    // Four consecutive days, ending a fortnight ago: the current streak is zero.
    for (let back = 17; back >= 14; back -= 1) await award(student, 10, shiftDay(TODAY, back));

    const board = boardOf(await getHallOfFame(5, TODAY), 'streak_legends');

    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]!.value).toBe(4);
    expect(board.entries[0]!.valueLabel).toBe('4 days');
  });

  it('does not call a single day a streak', async () => {
    const student = await seedStudent({ firstName: 'Onceonly' });
    await award(student, 10, TODAY);

    const board = boardOf(await getHallOfFame(5, TODAY), 'streak_legends');
    expect(board.entries).toEqual([]);
  });

  it('counts only correct daily-challenge answers', async () => {
    const sharp = await seedStudent({ firstName: 'Sharp' });
    await seedChallengeAttempt(sharp, TODAY, true);
    await seedChallengeAttempt(sharp, shiftDay(TODAY, 1), true);

    const trying = await seedStudent({ firstName: 'Trying' });
    await seedChallengeAttempt(trying, TODAY, false);
    await seedChallengeAttempt(trying, shiftDay(TODAY, 1), false);
    await seedChallengeAttempt(trying, shiftDay(TODAY, 2), true);

    const board = boardOf(await getHallOfFame(5, TODAY), 'challenge_champions');

    expect(board.entries.map((e) => e.displayName)).toEqual(['Sharp E.', 'Trying E.']);
    expect(board.entries.map((e) => e.value)).toEqual([2, 1]);
  });

  it('counts only practice sessions that were actually submitted', async () => {
    const finisher = await seedStudent({ firstName: 'Finisher' });
    await seedPracticeSession(finisher, 'submitted');
    await seedPracticeSession(finisher, 'submitted');
    await seedPracticeSession(finisher, 'in_progress');

    const board = boardOf(await getHallOfFame(5, TODAY), 'practice_devotees');

    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]!.value).toBe(2);
    expect(board.entries[0]!.valueLabel).toBe('2 sessions');
  });

  it('shares a rank between equal feats', async () => {
    const a = await seedStudent({ firstName: 'Equal' });
    const b = await seedStudent({ firstName: 'AlsoEqual' });
    const c = await seedStudent({ firstName: 'Behind' });
    await seedPracticeSession(a, 'submitted');
    await seedPracticeSession(a, 'submitted');
    await seedPracticeSession(b, 'submitted');
    await seedPracticeSession(b, 'submitted');
    await seedPracticeSession(c, 'submitted');

    const board = boardOf(await getHallOfFame(5, TODAY), 'practice_devotees');
    expect(board.entries.map((e) => e.rank)).toEqual([1, 1, 3]);
  });

  it('leaves a suspended account out of every board', async () => {
    const banned = await studentWith(9000, { firstName: 'Banned', status: 'suspended' });
    await seedMockAttempt(banned, 100, 100);
    await seedChallengeAttempt(banned, TODAY, true);
    await seedPracticeSession(banned, 'submitted');
    await award(banned, 10, shiftDay(TODAY, 1));
    await award(banned, 10, shiftDay(TODAY, 2));

    const view = await getHallOfFame(5, TODAY);

    for (const board of view.boards) expect(board.entries).toEqual([]);
    expect(view.totals.studentsRanked).toBe(0);
  });

  it('honours no more names than asked for', async () => {
    for (let i = 0; i < 8; i += 1) await studentWith((8 - i) * 10, { firstName: `Person${i}` });

    const board = boardOf(await getHallOfFame(3, TODAY), 'xp_champions');
    expect(board.entries).toHaveLength(3);
  });

  it('reports real platform totals', async () => {
    const student = await studentWith(250, { firstName: 'Busy' });
    await seedMockAttempt(student, 40, 50);
    await seedChallengeAttempt(student, TODAY, true);
    await seedPracticeSession(student, 'submitted');
    await seedPracticeSession(student, 'in_progress');

    const view = await getHallOfFame(5, TODAY);

    expect(view.totals).toEqual({
      studentsRanked: 1,
      xpAwarded: 250,
      mockTestsGraded: 1,
      challengesAnswered: 1,
      practiceSessionsCompleted: 1,
    });
  });
});

describe('GET /hall-of-fame', () => {
  it('is public, and returns all five boards', async () => {
    const res = await request(app).get(`${API}/hall-of-fame`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.hallOfFame.boards.map((b: { code: string }) => b.code)).toEqual(BOARD_CODES);
    expect(res.body.hallOfFame.generatedFor).toBe(todayKey());
  });

  it('publishes a masked name and no contact details', async () => {
    await studentWith(300, { firstName: 'Ananya', lastName: 'Sharma' });

    const res = await request(app).get(`${API}/hall-of-fame`).expect(200);
    const body = JSON.stringify(res.body);

    expect(body).toContain('Ananya S.');
    expect(body).not.toContain('Sharma');
    expect(body).not.toContain('@example.com');
  });

  it('refuses a board size outside its bounds', async () => {
    await request(app).get(`${API}/hall-of-fame?limit=0`).expect(400);
    await request(app).get(`${API}/hall-of-fame?limit=500`).expect(400);
  });
});
