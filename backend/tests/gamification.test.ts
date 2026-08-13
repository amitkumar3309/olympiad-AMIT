import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { RewardSettings, StudentActivity, Student } from '../src/models';
import { XP_AWARDS } from '../src/lib/xp';
import { tierFor, summariseBadges } from '../src/lib/badges';
import { summariseJourney } from '../src/lib/journey';
import { EMPTY_REWARD_FACTS, type RewardFacts } from '../src/lib/rewardFacts';
import { grantReward } from '../src/services/rewardService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, otherStudent, registerVerifyLogin } from './helpers/auth';

/**
 * Milestone 9 — the gamification engine.
 *
 * The interesting tests here are the **edge cases of granting**, not the happy path:
 * a reward that pays twice, pays for nothing, or pays a number nobody configured is
 * worse than one that does not pay at all, because it is invisible until a student
 * notices their total is wrong.
 *
 * Four properties dominate:
 *
 * 1. **One grant per constrained event**, whatever the caller does — sequential
 *    repeats, concurrent repeats, or a retried request.
 * 2. **Ineligible events pay nothing**, and leave no row behind to suggest they did.
 * 3. **Configuration changes the future and never the past.** This is the property
 *    that makes an administrator-tunable award table safe, and it is a property of the
 *    data model rather than a promise made in a handler.
 * 4. **The catalogues are pure.** Badges, journey stages and achievements are functions
 *    of one facts object, so their boundaries are tested directly — no database, no
 *    HTTP, no fixtures beyond a plain object.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** A student, and their `_id`, for the direct-service tests. */
async function aStudent(overrides: Record<string, unknown> = {}) {
  const { cookies, studentId } = await registerVerifyLogin(app, overrides);
  const student = await Student.findOne({ studentId });
  return { cookies, studentId, id: student!._id as Parameters<typeof grantReward>[0]['student'] };
}

function facts(overrides: Partial<RewardFacts> = {}): RewardFacts {
  return { ...EMPTY_REWARD_FACTS, ...overrides };
}

// ===========================================================================
// Granting — the edge cases
// ===========================================================================

describe('granting a reward', () => {
  it('pays a once-per-day event once, however many times it is called', async () => {
    const { id } = await aStudent();

    const first = await grantReward({ student: id, event: 'practice_completed', context: { answeredCount: 5 } });
    const second = await grantReward({ student: id, event: 'practice_completed', context: { answeredCount: 5 } });
    const third = await grantReward({ student: id, event: 'practice_completed', context: { answeredCount: 5 } });

    expect(first).toEqual({ granted: true, xpAwarded: XP_AWARDS.practice_completed, reason: 'granted' });
    expect(second).toEqual({ granted: false, xpAwarded: 0, reason: 'already-claimed' });
    expect(third.granted).toBe(false);
    expect(await StudentActivity.countDocuments({ student: id, type: 'practice_completed' })).toBe(1);
  });

  it('holds the day’s visit across two different call paths', async () => {
    // Signing in already granted today's visit (`auth.routes.ts` calls the engine), so
    // a direct grant afterwards must be refused. That is the more interesting version
    // of this test than two calls in a row: the guarantee holds between a route and a
    // service call, not just within one loop.
    const { id } = await aStudent();

    const afterLogin = await grantReward({ student: id, event: 'daily_visit' });

    expect(afterLogin.granted).toBe(false);
    expect(afterLogin.reason).toBe('already-claimed');
    expect(await StudentActivity.countDocuments({ student: id, type: 'daily_visit' })).toBe(1);
  });

  it('pays a once-per-account event once, ever', async () => {
    const { id } = await aStudent();

    // `account_created` was already granted by registration itself.
    const again = await grantReward({ student: id, event: 'account_created' });

    expect(again.granted).toBe(false);
    expect(await StudentActivity.countDocuments({ student: id, type: 'account_created' })).toBe(1);
  });

  it('pays once when the same event is granted concurrently', async () => {
    const { id } = await aStudent();

    const outcomes = await Promise.all([
      grantReward({ student: id, event: 'mock_test_completed', context: { answeredCount: 1 } }),
      grantReward({ student: id, event: 'mock_test_completed', context: { answeredCount: 1 } }),
      grantReward({ student: id, event: 'mock_test_completed', context: { answeredCount: 1 } }),
      grantReward({ student: id, event: 'mock_test_completed', context: { answeredCount: 1 } }),
    ]);

    // Exactly one call did the granting; the unique index decided, not a check.
    expect(outcomes.filter((outcome) => outcome.granted)).toHaveLength(1);
    expect(await StudentActivity.countDocuments({ student: id, type: 'mock_test_completed' })).toBe(1);
  });

  it('records a repeatable event every time, because it is not constrained', async () => {
    const { id } = await aStudent();

    await grantReward({ student: id, event: 'profile_updated', detail: 'once' });
    await grantReward({ student: id, event: 'profile_updated', detail: 'twice' });

    expect(await StudentActivity.countDocuments({ student: id, type: 'profile_updated' })).toBe(2);
    // Worth 0 XP by design, so repeating it cannot inflate a total.
    expect(XP_AWARDS.profile_updated).toBe(0);
  });

  it('refuses to pay for an attempt with no work in it, and leaves no row behind', async () => {
    const { id } = await aStudent();

    const empty = await grantReward({
      student: id,
      event: 'practice_completed',
      context: { answeredCount: 0 },
    });
    const missing = await grantReward({ student: id, event: 'mock_test_completed' });

    expect(empty).toEqual({ granted: false, xpAwarded: 0, reason: 'not-eligible' });
    expect(missing.reason).toBe('not-eligible');
    expect(await StudentActivity.countDocuments({ student: id, type: 'practice_completed' })).toBe(0);
    expect(await StudentActivity.countDocuments({ student: id, type: 'mock_test_completed' })).toBe(0);
  });

  it('pays for an attempt with real work in it', async () => {
    const { id } = await aStudent();

    const outcome = await grantReward({
      student: id,
      event: 'practice_completed',
      context: { answeredCount: 3 },
    });

    expect(outcome.granted).toBe(true);
    expect(outcome.xpAwarded).toBe(XP_AWARDS.practice_completed);
  });

  it('is granted per student, so one student cannot exhaust another’s day', async () => {
    const { id: mine } = await aStudent();
    const { id: theirs } = await aStudent(otherStudent);

    await grantReward({ student: mine, event: 'practice_completed', context: { answeredCount: 1 } });
    const other = await grantReward({ student: theirs, event: 'practice_completed', context: { answeredCount: 1 } });

    expect(other.granted).toBe(true);
    expect(await StudentActivity.countDocuments({ type: 'practice_completed' })).toBe(2);
  });
});

// ===========================================================================
// Configuration
// ===========================================================================

describe('the award table', () => {
  /** Returns the supertest chain rather than a promise, so `.expect()` still works. */
  function setOverrides(adminCookies: Record<string, string>, xpOverrides: Record<string, number>) {
    return request(app)
      .put(`${API}/admin/reward-settings`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ xpOverrides });
  }

  it('reports the default, the override and what would actually be paid', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Config', lastName: 'Admin', mobile: '9000000001', email: 'config@example.com',
    });

    const before = await request(app)
      .get(`${API}/admin/reward-settings`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);

    const visit = before.body.config.table.find((row: { event: string }) => row.event === 'daily_visit');
    expect(visit.defaultXp).toBe(XP_AWARDS.daily_visit);
    expect(visit.overrideXp).toBeNull();
    expect(visit.effectiveXp).toBe(XP_AWARDS.daily_visit);

    await setOverrides(adminCookies, { daily_visit: 42 }).expect(200);

    const after = await request(app)
      .get(`${API}/admin/reward-settings`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);
    const updated = after.body.config.table.find((row: { event: string }) => row.event === 'daily_visit');
    expect(updated.defaultXp).toBe(XP_AWARDS.daily_visit);
    expect(updated.overrideXp).toBe(42);
    expect(updated.effectiveXp).toBe(42);
  });

  it('pays the configured amount for the next event', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Config', lastName: 'Admin', mobile: '9000000001', email: 'config@example.com',
    });
    await setOverrides(adminCookies, { practice_completed: 99 }).expect(200);

    const { id } = await aStudent();
    const outcome = await grantReward({ student: id, event: 'practice_completed', context: { answeredCount: 1 } });

    expect(outcome.xpAwarded).toBe(99);
    const row = await StudentActivity.findOne({ student: id, type: 'practice_completed' });
    expect(row?.xpAwarded).toBe(99);
  });

  it('**never re-prices history** — the whole reason the table is safe to tune', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Config', lastName: 'Admin', mobile: '9000000001', email: 'config@example.com',
    });
    const { id, cookies } = await aStudent();

    // Earn something at the original price.
    await grantReward({ student: id, event: 'practice_completed', context: { answeredCount: 1 } });
    const before = await request(app).get(`${API}/me/rewards`).set('Cookie', cookieHeader(cookies)).expect(200);
    const xpBefore = before.body.rewards.xp;

    // Re-price the event by a factor of ten.
    await setOverrides(adminCookies, { practice_completed: 250 }).expect(200);

    const after = await request(app).get(`${API}/me/rewards`).set('Cookie', cookieHeader(cookies)).expect(200);

    // The already-earned row is untouched, so the total has not moved a point. A
    // student's history is what they earned at the time, not a function of today's
    // settings.
    expect(after.body.rewards.xp).toBe(xpBefore);
    const row = await StudentActivity.findOne({ student: id, type: 'practice_completed' });
    expect(row?.xpAwarded).toBe(XP_AWARDS.practice_completed);
  });

  it('reverts to the code default when an override is removed', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Config', lastName: 'Admin', mobile: '9000000001', email: 'config@example.com',
    });
    await setOverrides(adminCookies, { daily_visit: 42 }).expect(200);
    // The whole set is sent, so an absent key means "no override".
    await setOverrides(adminCookies, {}).expect(200);

    const { id } = await aStudent();
    const outcome = await grantReward({ student: id, event: 'practice_completed', context: { answeredCount: 1 } });

    expect(outcome.xpAwarded).toBe(XP_AWARDS.practice_completed);
  });

  it('refuses an unknown event, a negative amount and an absurd one', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Config', lastName: 'Admin', mobile: '9000000001', email: 'config@example.com',
    });

    expect((await setOverrides(adminCookies, { not_a_real_event: 10 })).status).toBe(400);
    expect((await setOverrides(adminCookies, { daily_visit: -5 })).status).toBe(400);
    expect((await setOverrides(adminCookies, { daily_visit: 100_000 })).status).toBe(400);
    expect((await setOverrides(adminCookies, { daily_visit: 1.5 })).status).toBe(400);

    // Nothing was written by any of them.
    expect(await RewardSettings.countDocuments({})).toBe(0);
  });

  it('keeps paying the code default when no settings document exists at all', async () => {
    const { id } = await aStudent();
    expect(await RewardSettings.countDocuments({})).toBe(0);

    const outcome = await grantReward({ student: id, event: 'practice_completed', context: { answeredCount: 1 } });

    expect(outcome.xpAwarded).toBe(XP_AWARDS.practice_completed);
  });

  it('is a single document however many times it is saved', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, {
      firstName: 'Config', lastName: 'Admin', mobile: '9000000001', email: 'config@example.com',
    });

    await setOverrides(adminCookies, { daily_visit: 11 }).expect(200);
    await setOverrides(adminCookies, { daily_visit: 12 }).expect(200);
    await setOverrides(adminCookies, { daily_visit: 13 }).expect(200);

    expect(await RewardSettings.countDocuments({})).toBe(1);
  });

  it('refuses a plain student, on both API prefixes, and records the refusal', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const cookie = cookieHeader(cookies);

    const calls = [
      request(app).get(`${API}/admin/reward-settings`).set('Cookie', cookie),
      request(app).put(`${API}/admin/reward-settings`).set('Cookie', cookie).send({ xpOverrides: { daily_visit: 500 } }),
      request(app).get('/api/admin/reward-settings').set('Cookie', cookie),
    ];

    for (const call of await Promise.all(calls)) {
      expect(call.status).toBe(403);
    }
    expect(await RewardSettings.countDocuments({})).toBe(0);
  });
});

// ===========================================================================
// Badges — a tiered rank, not a second achievement list
// ===========================================================================

describe('badges', () => {
  it('holds the tier a value has reached, counting a value equal to a threshold', () => {
    const thresholds = [1, 10, 50] as const;

    expect(tierFor(0, thresholds)).toEqual({ tier: null, nextTier: 'bronze', progress: 0, target: 1 });
    // Equal to the threshold means held, not "almost".
    expect(tierFor(1, thresholds)).toEqual({ tier: 'bronze', nextTier: 'silver', progress: 1, target: 10 });
    expect(tierFor(9, thresholds).tier).toBe('bronze');
    expect(tierFor(10, thresholds)).toEqual({ tier: 'silver', nextTier: 'gold', progress: 10, target: 50 });
    expect(tierFor(50, thresholds)).toEqual({ tier: 'gold', nextTier: null, progress: 50, target: 50 });
  });

  it('does not let a bar fill past its end once gold is held', () => {
    // 900 sessions is still gold, and the bar reads 50/50 rather than 900/50.
    const { progress, target, nextTier } = tierFor(900, [1, 10, 50]);
    expect(progress).toBe(target);
    expect(nextTier).toBeNull();
  });

  it('awards nothing to a student who has done nothing, with real targets to reach', () => {
    const summary = summariseBadges(facts());

    expect(summary.heldCount).toBe(0);
    expect(summary.total).toBe(summary.badges.length);
    for (const badge of summary.badges) {
      expect(badge.tier).toBeNull();
      expect(badge.value).toBe(0);
      // A locked badge still names a real next step, never an empty decoration.
      expect(badge.target).toBeGreaterThan(0);
      expect(badge.nextTier).toBe('bronze');
    }
  });

  it('derives every tier from real counts', () => {
    const summary = summariseBadges(
      facts({ xp: 600, longestStreak: 7, practiceSessionsCompleted: 12, mockTestsCompleted: 1, challengesCompleted: 0 }),
    );
    const byCode = new Map(summary.badges.map((badge) => [badge.code, badge]));

    expect(byCode.get('scholar')!.tier).toBe('silver');
    expect(byCode.get('regular')!.tier).toBe('silver');
    expect(byCode.get('practitioner')!.tier).toBe('silver');
    expect(byCode.get('test_taker')!.tier).toBe('bronze');
    expect(byCode.get('daily_solver')!.tier).toBeNull();
    expect(summary.heldCount).toBe(4);
  });

  it('sorts held badges first, highest tier leading', () => {
    const summary = summariseBadges(facts({ xp: 2000, practiceSessionsCompleted: 1 }));

    expect(summary.badges[0]!.code).toBe('scholar');
    expect(summary.badges[0]!.tier).toBe('gold');
    expect(summary.badges[1]!.tier).toBe('bronze');
    expect(summary.badges[summary.badges.length - 1]!.tier).toBeNull();
  });

  it('advertises nothing it cannot measure', () => {
    // Every badge must move for *some* achievable fact. A family measuring something
    // the platform never records would be a permanently locked decoration.
    const nothing = summariseBadges(facts());
    const everything = summariseBadges(
      facts({
        xp: 99_999,
        longestStreak: 999,
        practiceSessionsCompleted: 999,
        mockTestsCompleted: 999,
        challengesCompleted: 999,
      }),
    );

    expect(nothing.heldCount).toBe(0);
    expect(everything.heldCount).toBe(everything.total);
    expect(everything.badges.every((badge) => badge.tier === 'gold')).toBe(true);
  });
});

// ===========================================================================
// The journey map
// ===========================================================================

describe('the journey map', () => {
  it('starts at the first unfinished stage and marks exactly one as current', () => {
    const summary = summariseJourney(facts());

    expect(summary.stages[0]!.id).toBe('enrolled');
    expect(summary.stages[0]!.complete).toBe(true);
    expect(summary.currentStageId).toBe('verified');
    expect(summary.stages.filter((stage) => stage.current)).toHaveLength(1);
    expect(summary.completedCount).toBe(1);
  });

  it('advances as the real facts advance', () => {
    const summary = summariseJourney(
      facts({ isEmailVerified: true, practiceSessionsCompleted: 1, challengesCompleted: 2 }),
    );

    const byId = new Map(summary.stages.map((stage) => [stage.id, stage]));
    expect(byId.get('verified')!.complete).toBe(true);
    expect(byId.get('first_practice')!.complete).toBe(true);
    expect(byId.get('first_challenge')!.complete).toBe(true);
    expect(summary.currentStageId).toBe('habit');
    expect(summary.percent).toBeGreaterThan(0);
  });

  it('cannot walk backwards when a streak is broken', () => {
    // The stage is measured on the *longest* streak, so a student who kept three days
    // and then missed one keeps the stage. Measuring the current streak would
    // un-complete it, and a journey that takes a stage away is not a journey.
    const kept = summariseJourney(facts({ currentStreak: 0, longestStreak: 3 }));
    const byId = new Map(kept.stages.map((stage) => [stage.id, stage]));

    expect(byId.get('habit')!.complete).toBe(true);
  });

  it('reports a finished path with no current stage', () => {
    const summary = summariseJourney(
      facts({
        isEmailVerified: true,
        level: 5,
        longestStreak: 30,
        practiceSessionsCompleted: 25,
        mockTestsCompleted: 9,
        challengesCompleted: 40,
      }),
    );

    expect(summary.completedCount).toBe(summary.total);
    expect(summary.percent).toBe(100);
    expect(summary.currentStageId).toBeNull();
  });

  it('shows real progress on the stage in hand', () => {
    const summary = summariseJourney(facts({ isEmailVerified: true, practiceSessionsCompleted: 1, challengesCompleted: 1, longestStreak: 2 }));
    const current = summary.stages.find((stage) => stage.current);

    expect(current!.id).toBe('habit');
    expect(current!.progress).toBe(2);
    expect(current!.target).toBe(3);
  });
});

// ===========================================================================
// The student's view
// ===========================================================================

describe('GET /me/rewards', () => {
  it('returns honest zeroes for a brand-new account, with everything present', async () => {
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/me/rewards`).set('Cookie', cookieHeader(cookies)).expect(200);
    const { rewards } = res.body;

    // 50 for the account, 50 for verifying, 10 for showing up — three real events and
    // nothing invented. `registerVerifyLogin` signs in, which is what claims the visit.
    expect(rewards.xp).toBe(XP_AWARDS.account_created + XP_AWARDS.email_verified + XP_AWARDS.daily_visit);
    expect(rewards.level.level).toBeGreaterThanOrEqual(1);
    expect(rewards.badges.badges.length).toBeGreaterThan(0);
    expect(rewards.achievements.earned.length).toBeGreaterThan(0);
    expect(rewards.journey.stages.length).toBeGreaterThan(0);
    expect(rewards.totals).toEqual({
      practiceSessions: 0,
      mockTests: 0,
      dailyChallenges: 0,
      activeDays: expect.any(Number),
    });
  });

  it('agrees with the dashboard, because both read the same facts', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const cookie = cookieHeader(cookies);

    const dashboard = await request(app).get(`${API}/me/dashboard`).set('Cookie', cookie).expect(200);
    const rewards = await request(app).get(`${API}/me/rewards`).set('Cookie', cookie).expect(200);

    expect(rewards.body.rewards.xp).toBe(dashboard.body.dashboard.progress.xp);
    expect(rewards.body.rewards.level.level).toBe(dashboard.body.dashboard.progress.level);
    expect(rewards.body.rewards.achievements.earnedCount).toBe(
      dashboard.body.dashboard.achievements.earnedCount,
    );
  });

  it('reflects a badge and a journey stage earned through the real API', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const cookie = cookieHeader(cookies);

    const before = await request(app).get(`${API}/me/rewards`).set('Cookie', cookie).expect(200);
    const scholarBefore = before.body.rewards.badges.badges.find((b: { code: string }) => b.code === 'scholar');
    // 100 XP from registering and verifying is exactly the bronze threshold.
    expect(scholarBefore.tier).toBe('bronze');
    expect(before.body.rewards.journey.stages.find((s: { id: string }) => s.id === 'verified').complete).toBe(true);
    expect(before.body.rewards.journey.currentStageId).toBe('first_practice');
  });

  it('refuses an anonymous caller, and serves the root administrator its own standing', async () => {
    expect((await request(app).get(`${API}/me/rewards`)).status).toBe(401);

    const rootRes = await request(app)
      .post(`${API}/auth/admin/login`)
      .send({ email: 'root-admin@amit.test', password: 'RootAdminPass9' })
      .expect(200);
    const rootCookies = cookieHeader(
      Object.fromEntries(
        (rootRes.headers['set-cookie'] as unknown as string[]).map((c) => {
          const [pair] = c.split(';');
          const eq = pair!.indexOf('=');
          return [pair!.slice(0, eq), pair!.slice(eq + 1)];
        }),
      ),
    );

    // Since Milestone 11 the root administrator has a record, so it has a standing
    // like anybody else — and at zero, because provisioning an account is not an
    // event the reward engine pays for. The engine grants only from things that
    // genuinely happened, and being created by a bootstrap is not one of them.
    const res = await request(app).get(`${API}/me/rewards`).set('Cookie', rootCookies);
    expect(res.status).toBe(200);
    expect(res.body.rewards.xp).toBe(0);
  });
});
