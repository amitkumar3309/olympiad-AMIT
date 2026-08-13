import { reach, type RewardFacts } from './rewardFacts';

/**
 * The badge catalogue.
 *
 * ## How a badge differs from an achievement
 *
 * They were the same thing until Milestone 9, and `FEATURE_STATUS.md` said so plainly:
 * badges were "delivered as achievements". Making them genuinely distinct rather than
 * two names for one list is the point of this file.
 *
 * - An **achievement** is a one-off goal. You have it or you do not, and once earned it
 *   stops changing.
 * - A **badge** is a *rank in a family*, held at a tier. `Practitioner` is not earned
 *   once; it is held at bronze, then silver, then gold as the student does more of the
 *   same thing. A student holds at most one tier per family — the highest reached — and
 *   the next tier is always visible with real progress toward it.
 *
 * That distinction is what makes both worth having on one page: the achievements answer
 * "what have I done?", the badges answer "how far along am I?".
 *
 * ## The two rules this file inherits
 *
 * 1. **Nothing is stored as earned.** A tier is derived from `RewardFacts` on every
 *    read, so it cannot be granted by a bug elsewhere, cannot go stale, and cannot
 *    disagree with the activity log behind it.
 * 2. **Nothing unearnable is advertised.** Every family below measures something the
 *    platform genuinely records today. There is deliberately no accuracy or official-exam
 *    badge: those would be permanently stuck at bronze-locked with a bar that cannot
 *    move, which is a fake statistic wearing a lock icon.
 */

export const BADGE_TIERS = ['bronze', 'silver', 'gold'] as const;
export type BadgeTier = (typeof BADGE_TIERS)[number];

/** The tier label a student is shown. `null` means the family is not yet held. */
export type HeldTier = BadgeTier | null;

export interface BadgeDefinition {
  code: string;
  name: string;
  /** What the family is *about*, independent of tier. */
  description: string;
  /** Phosphor icon name, so the frontend needs no mapping table of its own. */
  icon: string;
  /** What the family counts, in the student's words — e.g. "practice sessions". */
  unit: string;
  /** The three thresholds, ascending. */
  thresholds: readonly [number, number, number];
  measure: (facts: RewardFacts) => number;
}

export interface EvaluatedBadge {
  code: string;
  name: string;
  description: string;
  icon: string;
  unit: string;
  /** The highest tier reached, or null. */
  tier: HeldTier;
  /** The student's real count in this family. */
  value: number;
  /** The next tier to reach, or null when gold is already held. */
  nextTier: BadgeTier | null;
  /** Progress toward `nextTier`, capped. Both figures are real counts. */
  progress: number;
  target: number;
  /** All three thresholds, so the UI can show the ladder rather than one step. */
  thresholds: readonly [number, number, number];
}

export const BADGES: readonly BadgeDefinition[] = [
  {
    code: 'scholar',
    name: 'Scholar',
    description: 'Experience earned across everything you do here.',
    icon: 'ph-student',
    unit: 'XP',
    thresholds: [100, 500, 2000],
    measure: (f) => f.xp,
  },
  {
    code: 'regular',
    name: 'Regular',
    description: 'Your longest run of consecutive days.',
    icon: 'ph-flame',
    unit: 'day streak',
    thresholds: [3, 7, 30],
    measure: (f) => f.longestStreak,
  },
  {
    code: 'practitioner',
    name: 'Practitioner',
    description: 'Practice sessions you have finished and had marked.',
    icon: 'ph-target',
    unit: 'sessions',
    thresholds: [1, 10, 50],
    measure: (f) => f.practiceSessionsCompleted,
  },
  {
    code: 'test_taker',
    name: 'Test Taker',
    description: 'Mock tests sat under the clock.',
    icon: 'ph-exam',
    unit: 'tests',
    thresholds: [1, 5, 20],
    measure: (f) => f.mockTestsCompleted,
  },
  {
    code: 'daily_solver',
    name: 'Daily Solver',
    description: 'Daily challenges answered.',
    icon: 'ph-dice-five',
    unit: 'challenges',
    thresholds: [1, 10, 50],
    measure: (f) => f.challengesCompleted,
  },
];

/**
 * The tier a value has reached, and what is next.
 *
 * Exported because the boundary behaviour is worth testing directly: a value *equal* to
 * a threshold holds that tier (10 sessions is silver, not "almost silver"), and a value
 * past gold reports `nextTier: null` with progress pinned at the gold threshold rather
 * than a bar that keeps filling past its end.
 */
export function tierFor(
  value: number,
  thresholds: readonly [number, number, number],
): { tier: HeldTier; nextTier: BadgeTier | null; progress: number; target: number } {
  const [bronze, silver, gold] = thresholds;

  if (value >= gold) {
    return { tier: 'gold', nextTier: null, progress: gold, target: gold };
  }
  if (value >= silver) {
    return { tier: 'silver', nextTier: 'gold', ...reach(value, gold) };
  }
  if (value >= bronze) {
    return { tier: 'bronze', nextTier: 'silver', ...reach(value, silver) };
  }
  return { tier: null, nextTier: 'bronze', ...reach(value, bronze) };
}

export function evaluateBadges(facts: RewardFacts): EvaluatedBadge[] {
  return BADGES.map((definition) => {
    const value = definition.measure(facts);
    const { tier, nextTier, progress, target } = tierFor(value, definition.thresholds);
    return {
      code: definition.code,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      unit: definition.unit,
      tier,
      value,
      nextTier,
      progress,
      target,
      thresholds: definition.thresholds,
    };
  });
}

export interface BadgeSummary {
  /** How many families are held at any tier — the headline figure. */
  heldCount: number;
  total: number;
  /** Held families first (gold, then silver, then bronze), then the unheld ones. */
  badges: EvaluatedBadge[];
}

const TIER_ORDER: Record<string, number> = { gold: 3, silver: 2, bronze: 1, null: 0 };

export function summariseBadges(facts: RewardFacts): BadgeSummary {
  const badges = evaluateBadges(facts).sort((a, b) => {
    const byTier = TIER_ORDER[String(b.tier)]! - TIER_ORDER[String(a.tier)]!;
    if (byTier !== 0) return byTier;
    // Within a tier, the one closest to its next step first — that is the one the
    // student can actually do something about today.
    return b.progress / b.target - a.progress / a.target;
  });

  return { heldCount: badges.filter((badge) => badge.tier !== null).length, total: badges.length, badges };
}
