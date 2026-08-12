/**
 * Experience points and levels.
 *
 * The rule this module exists to enforce: **XP is never invented.** Every point a
 * student holds is the sum of `xpAwarded` over their real `StudentActivity`
 * documents, and this file is the only place that says what an event is worth.
 * There is no stored XP counter to drift out of step with the log, and no code
 * path that adds XP without writing the event that earned it.
 *
 * What earns XP is deliberately small, and every entry is an event the platform
 * genuinely records: creating an account, verifying the email address, showing up
 * on a given day, and — since Milestone 6 — completing a graded practice session.
 * Official exam submission is still absent because no official exam is recorded
 * anywhere yet (see PROJECT_STATE.md); when it lands it earns XP by adding an
 * activity type here, not by special-casing.
 */

import type { ActivityType } from '../models/StudentActivity';

/**
 * What each real event is worth.
 *
 * Zero is a deliberate value, not a placeholder: editing a profile or changing a
 * password is worth *recording* (it belongs on the activity feed, and it is a
 * security-relevant event) but must not be worth *points*, because both are
 * repeatable at will and paying for them would make XP a measure of how often you
 * clicked Save.
 */
export const XP_AWARDS: Record<ActivityType, number> = {
  account_created: 50,
  email_verified: 50,
  daily_visit: 10,
  profile_updated: 0,
  photo_updated: 0,
  password_changed: 0,
  /**
   * Worth more than showing up, because it is the first event that requires a
   * student to actually answer questions. Awarded **once per day** however many
   * sessions they complete (see `ONCE_PER_DAY` and the ADR in DECISIONS.md): paying
   * per session would be farmable by submitting empty ones in a loop.
   */
  practice_completed: 25,
  /**
   * Worth more than practice because it is a harder thing to do: a timed paper the
   * student did not choose the questions for, sat under a server-enforced clock.
   * Awarded **once per day** on the same reasoning — a student who sits three mock
   * tests in a day is not three times as good as one who sits one, and paying per
   * attempt would reward starting papers rather than doing them.
   */
  mock_test_completed: 50,
};

export function xpFor(type: ActivityType): number {
  return XP_AWARDS[type];
}

/**
 * Cumulative XP at which each level begins. Index 0 is level 1, so a brand-new
 * account is level 1 at 0 XP rather than level 0.
 *
 * The early steps are close together so that a student who has done nothing but
 * register and verify can still see honest movement, and widen after that.
 */
const LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 1750, 2750, 4000, 5500, 7500] as const;

/** Past the table, every further level costs this much. Keeps levels unbounded. */
const XP_PER_LEVEL_BEYOND_TABLE = 2500;

export interface LevelProgress {
  xp: number;
  level: number;
  /** Cumulative XP at which the current level began. */
  levelStartsAt: number;
  /** Cumulative XP at which the next level begins. */
  nextLevelAt: number;
  /** XP earned since the current level began. */
  xpIntoLevel: number;
  /** XP the whole current level spans, i.e. `nextLevelAt - levelStartsAt`. */
  xpForNextLevel: number;
  /** 0–100, progress through the current level. Rounded for display only. */
  percentToNextLevel: number;
}

/** Cumulative XP at which `level` (1-based) begins. */
function thresholdFor(level: number): number {
  const index = level - 1;
  const last = LEVEL_THRESHOLDS.length - 1;
  if (index <= last) return LEVEL_THRESHOLDS[index]!;
  return LEVEL_THRESHOLDS[last]! + (index - last) * XP_PER_LEVEL_BEYOND_TABLE;
}

/**
 * The level, and the position within it, for a given XP total.
 *
 * Negative input is clamped to 0: XP can only ever be a sum of non-negative
 * awards, so a negative total means a bug elsewhere, and reporting level 1 is a
 * better failure than an unhandled one.
 */
export function levelProgressFor(totalXp: number): LevelProgress {
  const xp = Math.max(0, Math.floor(totalXp));

  let level = 1;
  while (xp >= thresholdFor(level + 1)) level += 1;

  const levelStartsAt = thresholdFor(level);
  const nextLevelAt = thresholdFor(level + 1);
  const xpForNextLevel = nextLevelAt - levelStartsAt;
  const xpIntoLevel = xp - levelStartsAt;

  return {
    xp,
    level,
    levelStartsAt,
    nextLevelAt,
    xpIntoLevel,
    xpForNextLevel,
    percentToNextLevel: Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100)),
  };
}
