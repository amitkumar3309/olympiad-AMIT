import type { Types } from 'mongoose';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import { todayKey, type DayKey } from '../lib/competitionDay';
import { summariseAchievements, type AchievementSummary } from '../lib/achievements';
import { summariseBadges, type BadgeSummary } from '../lib/badges';
import { summariseJourney, type JourneySummary } from '../lib/journey';
import { EMPTY_REWARD_FACTS, type RewardFacts } from '../lib/rewardFacts';
import { levelProgressFor, XP_AWARDS, xpFor, type LevelProgress } from '../lib/xp';
import {
  ACTIVITY_TYPES,
  DailyChallengeAttempt,
  MockTestAttempt,
  PracticeSession,
  REWARD_SETTINGS_KEY,
  RewardSettings,
  Student,
  type ActivityType,
  type RewardSettingsDocument,
  type StudentDocument,
} from '../models';
import type { Actor } from './taxonomyService';
import { recordActivity, type RecordActivityResult } from './activityService';
import { getProgress, type StreakSummary } from './progressService';
import { challengeStreakOf } from './dailyChallengeService';

/**
 * The gamification engine: **the one place a reward is decided, priced and granted.**
 *
 * ## Why this exists
 *
 * By Milestone 8 the pieces were right but scattered. `recordActivity()` was already the
 * only writer and `lib/xp.ts` the only pricer — but five different routes each decided
 * *for themselves* whether an event deserved paying for, with the rule written inline
 * (`if (session.correctCount + session.incorrectCount > 0)`) next to the HTTP handling.
 * Nothing was wrong yet; the shape was wrong. A sixth surface would have written a sixth
 * rule, and the answer to "when does practice pay?" would have lived in a route.
 *
 * So there is now exactly one entry point, `grantReward()`, and the division of labour
 * is stated rather than implied:
 *
 *  - **The caller says what happened.** It knows whether a session was submitted or an
 *    attempt was created; that is not something the engine can see.
 *  - **The engine decides whether that is worth anything, and how much.** Eligibility
 *    rules live in `REWARD_RULES` below, amounts come from the award table (with any
 *    administrator override applied), and the write goes through `recordActivity()`,
 *    which owns the once-per-day and once-per-account constraints via a unique index.
 *
 * No route may call `recordActivity()` directly any more, and none does.
 *
 * ## Duplicate grants
 *
 * Idempotency is **not** implemented here, deliberately. It lives one layer down, in the
 * partial unique index on `StudentActivity {student, type, dedupeKey}`: `recordActivity`
 * inserts and treats a duplicate-key error as "already counted". A check in this file
 * would be a read-then-write across two serverless invocations, which is exactly the
 * race that index exists to lose safely. `grantReward` therefore reports what the
 * database decided (`granted: false, reason: 'already-claimed'`) rather than predicting
 * it.
 */

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Facts about what just happened, supplied by the caller so the engine can apply the
 * eligibility rule instead of the route applying it.
 */
export interface RewardContext {
  /** How many questions the student actually answered. Used by the "real work" rule. */
  answeredCount?: number;
}

/**
 * Events that require the student to have actually answered something.
 *
 * Without this, an empty practice session or a mock test submitted untouched would pay
 * the same as one that was worked through — which is the cheapest possible way to farm
 * a daily reward. The daily challenge needs no entry here: it refuses a blank
 * submission before an attempt exists at all.
 */
const REQUIRES_REAL_WORK: readonly ActivityType[] = ['practice_completed', 'mock_test_completed'];

export type RewardReason = 'granted' | 'already-claimed' | 'not-eligible' | 'failed';

export interface RewardOutcome {
  /** True only when this call created the activity row and paid for it. */
  granted: boolean;
  xpAwarded: number;
  reason: RewardReason;
}

export interface GrantRewardInput {
  student: Types.ObjectId;
  event: ActivityType;
  /** Short human-readable line for the activity feed. */
  detail?: string | null;
  context?: RewardContext;
  /** Overrides "now". Used by tests and the backfill script only. */
  at?: Date;
}

/** Whether an event, in this context, is worth paying for at all. */
function isEligible(event: ActivityType, context: RewardContext | undefined): boolean {
  if (!REQUIRES_REAL_WORK.includes(event)) return true;
  return (context?.answeredCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * What one event is worth right now: the administrator's override if there is one, and
 * the code default otherwise.
 *
 * Reading the settings on each grant is a deliberate choice over caching. Grants are
 * rare (a handful per student per day), the read is a single indexed document, and on a
 * serverless platform a process-level cache would be per-container anyway — it would buy
 * nothing and make "why is it still paying the old amount?" a real question.
 *
 * A missing or unreadable settings document is not an error: the code table is the
 * answer, and an outage in a *configuration* read must not stop a student being paid for
 * work they did.
 */
export async function resolveXpFor(event: ActivityType): Promise<number> {
  try {
    const settings = await RewardSettings.findOne({ key: REWARD_SETTINGS_KEY });
    const override = settings?.xpOverrides?.get(event);
    if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override;
  } catch (err) {
    logger.error({ err, event }, 'Could not read reward settings; falling back to the code award table');
  }
  return xpFor(event);
}

// ---------------------------------------------------------------------------
// Granting
// ---------------------------------------------------------------------------

/**
 * Whether this account competes at all.
 *
 * The bootstrap super administrator is a `Student` document because that is where
 * accounts live, but it never entered anything: it has no class, no school and no
 * photo. It must therefore never earn XP — and the reason is not tidiness. XP is
 * derived from `StudentActivity`, and **every leaderboard is an aggregation over
 * that same log**, so a single daily-visit row would place a staff account on a
 * *public* board above children who actually competed. With no rows at all it has
 * no standing to rank, so it cannot appear.
 *
 * Checked here, inside the engine, rather than at the call sites. There are already
 * two places that mark a daily visit, and the next surface to grant a reward would
 * have had to remember a rule it has no reason to know about — which is precisely
 * the failure mode the single-engine rule in CLAUDE.md exists to prevent. One
 * indexed read on a path that is about to write a document is a cheap way to make
 * the rule impossible to forget.
 *
 * A *promoted* admin is an entrant and keeps earning: it registered as a student,
 * has a class, and can still sit a paper (Milestone 3 ADR).
 */
async function isEntrant(student: Types.ObjectId): Promise<boolean> {
  try {
    const account = await Student.findById(student).select('role');
    // A missing account cannot earn either — but that is `recordActivity`'s problem
    // to log, not a reason to fail here.
    return account?.role !== 'superadmin';
  } catch (err) {
    // A reward must never fail the action that earned it. If the role cannot be
    // read, fall through to granting: under-paying a real student is the worse of
    // the two mistakes, and the super admin's grants are capped at one a day anyway.
    logger.error({ err, student: String(student) }, 'Could not check entrant status; granting anyway');
    return true;
  }
}

/**
 * Grants the reward for one real event. **The only way anything in this backend earns
 * XP.**
 *
 * Safe to call more than once for the same event: the second call is refused by the
 * unique index and reported as `already-claimed` with `xpAwarded: 0`, so a retried
 * request, a double-clicked button or a duplicated webhook cannot pay twice. Never
 * throws — a failed reward must not fail the action that earned it, exactly as
 * `recordActivity` and `recordAudit` do not.
 */
export async function grantReward(input: GrantRewardInput): Promise<RewardOutcome> {
  const { student, event, detail = null, context, at } = input;

  if (!isEligible(event, context)) {
    return { granted: false, xpAwarded: 0, reason: 'not-eligible' };
  }

  if (!(await isEntrant(student))) {
    return { granted: false, xpAwarded: 0, reason: 'not-eligible' };
  }

  const xpAwarded = await resolveXpFor(event);

  const result: RecordActivityResult = await recordActivity({
    student,
    type: event,
    detail,
    at,
    xpOverride: xpAwarded,
  });

  if (result.recorded) return { granted: true, xpAwarded: result.xpAwarded, reason: 'granted' };
  // `recordActivity` reports both "already counted" and "the write failed" as
  // `recorded: false`, and logs the second. From a caller's point of view the
  // actionable difference is nil — nothing was paid — so this reports the common case
  // and the logs carry the rare one.
  return { granted: false, xpAwarded: 0, reason: 'already-claimed' };
}

/**
 * Marks the student present today, which is what a streak measures.
 *
 * Kept as a named function rather than leaving callers to remember the event name,
 * because it is called from two places (sign-in and the dashboard) and the reason it is
 * called from both is worth stating: a session cookie outlives a sign-in by up to 30
 * days, so keying the streak on logins alone would miss every day a returning student
 * was already signed in.
 */
export async function grantDailyVisit(student: Types.ObjectId, at?: Date): Promise<RewardOutcome> {
  return grantReward({ student, event: 'daily_visit', at });
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/**
 * Assembles the one facts object the three catalogues read.
 *
 * This is the **only** place these figures are queried. `lib/achievements.ts`,
 * `lib/badges.ts` and `lib/journey.ts` are pure functions of what comes back, so they
 * stay reviewable rule sets that can be tested without a database — and no catalogue can
 * quietly start counting something nobody declared.
 */
export async function buildRewardFacts(
  studentDoc: StudentDocument,
  today: DayKey = todayKey(),
): Promise<{ facts: RewardFacts; level: LevelProgress; streak: StreakSummary }> {
  const student = studentDoc._id as Types.ObjectId;

  const [progress, practiceSessionsCompleted, mockTestsCompleted, challengeDays] = await Promise.all([
    getProgress(student, today),
    PracticeSession.countDocuments({ student, status: 'submitted' }),
    MockTestAttempt.countDocuments({ student, status: 'submitted' }),
    DailyChallengeAttempt.distinct('day', { student }) as Promise<DayKey[]>,
  ]);

  const challengeStreak = challengeStreakOf(challengeDays, today);

  const facts: RewardFacts = {
    registered: true,
    isEmailVerified: studentDoc.isEmailVerified,
    xp: progress.level.xp,
    level: progress.level.level,
    currentStreak: progress.streak.current,
    longestStreak: progress.streak.longest,
    activeDays: progress.streak.activeDays,
    practiceSessionsCompleted,
    mockTestsCompleted,
    challengesCompleted: challengeDays.length,
    longestChallengeStreak: challengeStreak.longest,
    // The official exam records nothing yet. Stated as 0 rather than omitted, so a rule
    // that reads it gets an honest zero instead of undefined.
    examsCompleted: 0,
  };

  return { facts, level: progress.level, streak: progress.streak };
}

// ---------------------------------------------------------------------------
// The student's whole reward picture
// ---------------------------------------------------------------------------

export interface RewardSummary {
  level: LevelProgress;
  streak: StreakSummary;
  challengeStreak: { current: number; longest: number };
  badges: BadgeSummary;
  achievements: AchievementSummary;
  journey: JourneySummary;
  facts: RewardFacts;
}

/**
 * Everything the rewards page shows, from one facts object.
 *
 * The catalogues are evaluated here rather than in the route so that the route stays
 * HTTP and every surface that wants "the student's standing" gets the same answer — the
 * dashboard's achievement panel and the rewards page cannot disagree, because they are
 * the same function.
 */
export async function summariseRewards(
  studentDoc: StudentDocument,
  today: DayKey = todayKey(),
): Promise<RewardSummary> {
  const { facts, level, streak } = await buildRewardFacts(studentDoc, today);
  const challengeDays = (await DailyChallengeAttempt.distinct('day', {
    student: studentDoc._id as Types.ObjectId,
  })) as DayKey[];

  return {
    level,
    streak,
    challengeStreak: challengeStreakOf(challengeDays, today),
    badges: summariseBadges(facts),
    // The whole catalogue, not the dashboard's top three: this page is where a student
    // comes to see everything, including what is still a long way off.
    achievements: summariseAchievements(facts, 99),
    journey: summariseJourney(facts),
    facts,
  };
}

/** The empty picture, for a caller with no readable history (no class, no data yet). */
export function emptyRewardSummary(): RewardSummary {
  const facts = EMPTY_REWARD_FACTS;
  return {
    level: levelProgressFor(0),
    streak: { current: 0, longest: 0, activeDays: 0, lastActiveOn: null, countedToday: false },
    challengeStreak: { current: 0, longest: 0 },
    badges: summariseBadges(facts),
    achievements: summariseAchievements(facts, 99),
    journey: summariseJourney(facts),
    facts,
  };
}

// ---------------------------------------------------------------------------
// Administrator configuration
// ---------------------------------------------------------------------------

/** The award table as it currently stands: the default, and any override, per event. */
export interface RewardTableRow {
  event: ActivityType;
  /** What `lib/xp.ts` says. */
  defaultXp: number;
  /** What an administrator set, or null when the default applies. */
  overrideXp: number | null;
  /** What a grant would actually pay right now. */
  effectiveXp: number;
}

export interface RewardConfigView {
  table: RewardTableRow[];
  updatedByLabel: string | null;
  updatedAt: Date | null;
}

export async function getRewardConfig(): Promise<RewardConfigView> {
  const settings = await RewardSettings.findOne({ key: REWARD_SETTINGS_KEY });

  const table: RewardTableRow[] = ACTIVITY_TYPES.map((event) => {
    const override = settings?.xpOverrides?.get(event);
    const overrideXp = typeof override === 'number' ? override : null;
    return {
      event,
      defaultXp: XP_AWARDS[event],
      overrideXp,
      effectiveXp: overrideXp ?? XP_AWARDS[event],
    };
  });

  return {
    table,
    updatedByLabel: settings?.updatedByLabel ?? null,
    updatedAt: settings?.updatedAt ?? null,
  };
}

/** The most any single event may be worth. Bounded so one edit cannot break the levels. */
export const MAX_CONFIGURABLE_XP = 500;

/**
 * Replaces the override table.
 *
 * Sends the **whole** set, like a question edit: a partial patch would make "remove this
 * override" and "leave it alone" indistinguishable on the wire. An event absent from the
 * payload therefore reverts to its code default, which is the only way back to it.
 *
 * **This never re-prices history.** Every `StudentActivity` row stores what its event was
 * worth when it happened, and a student's total is the sum of those recorded values — so
 * changing this table changes what the *next* event pays and nothing else. That is the
 * property that makes a tunable table safe to offer, and it has its own test.
 */
export async function updateRewardConfig(
  overrides: Record<string, number>,
  actor: Actor,
): Promise<RewardConfigView> {
  const known = new Set<string>(ACTIVITY_TYPES);

  for (const [event, value] of Object.entries(overrides)) {
    if (!known.has(event)) {
      throw ApiError.badRequest(`"${event}" is not an event this platform records.`);
    }
    if (!Number.isFinite(value) || value < 0 || value > MAX_CONFIGURABLE_XP) {
      throw ApiError.badRequest(`XP for "${event}" must be between 0 and ${MAX_CONFIGURABLE_XP}.`);
    }
  }

  const settings: RewardSettingsDocument = await RewardSettings.findOneAndUpdate(
    { key: REWARD_SETTINGS_KEY },
    {
      $set: {
        xpOverrides: new Map(Object.entries(overrides)),
        updatedBy: actor.id,
        updatedByLabel: actor.label,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  return {
    table: ACTIVITY_TYPES.map((event) => {
      const override = settings.xpOverrides?.get(event);
      const overrideXp = typeof override === 'number' ? override : null;
      return { event, defaultXp: XP_AWARDS[event], overrideXp, effectiveXp: overrideXp ?? XP_AWARDS[event] };
    }),
    updatedByLabel: settings.updatedByLabel ?? null,
    updatedAt: settings.updatedAt ?? null,
  };
}
