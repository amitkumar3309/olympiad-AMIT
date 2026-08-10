/**
 * The achievement catalogue.
 *
 * Two rules shape this file:
 *
 * 1. **An achievement is earned only by evaluating real recorded facts.** Nothing
 *    is stored as "earned"; the earned flag is derived on every read from the
 *    student's activity log, so it cannot be granted by a bug elsewhere and cannot
 *    go stale. `ProgressFacts` is the complete set of inputs available.
 *
 * 2. **Nothing unearnable is advertised.** There are no exam or accuracy
 *    achievements here, however natural they would look on the dashboard, because
 *    no exam result exists anywhere in the product yet — listing them would show
 *    every student a permanently locked row with a progress bar that can never
 *    move, which is a fake statistic wearing a lock icon. They arrive with the
 *    exam milestone, alongside the data that can satisfy them.
 *
 * The catalogue is code rather than a collection for the same reason the
 * role → permission table is: it is a rule set, not user data, so it belongs
 * somewhere reviewable and diffable.
 */

/** Everything an achievement predicate is allowed to look at — all of it real. */
export interface ProgressFacts {
  /**
   * The caller holds a real registered account. Always true in practice, and
   * stated as a fact anyway so the "Enrolled" predicate below reads as the thing
   * it actually asserts instead of inferring enrolment from a side effect.
   */
  registered: boolean;
  xp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  /** Distinct competition days on which this student did anything at all. */
  activeDays: number;
  isEmailVerified: boolean;
  /** Submitted exam attempts. Always 0 until the exam milestone exists. */
  examsCompleted: number;
}

export interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  /** Phosphor icon name, so the frontend needs no mapping table of its own. */
  icon: string;
  /**
   * How far along the student is, and what would complete it. Both are real
   * counts, so a locked achievement shows genuine progress instead of a
   * decorative empty bar.
   */
  measure: (facts: ProgressFacts) => { progress: number; target: number };
}

export interface EvaluatedAchievement {
  code: string;
  name: string;
  description: string;
  icon: string;
  earned: boolean;
  progress: number;
  target: number;
}

/** Progress toward a simple "reach N" achievement, never overstated past the target. */
function reach(value: number, target: number): { progress: number; target: number } {
  return { progress: Math.min(value, target), target };
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    code: 'enrolled',
    name: 'Enrolled',
    description: 'Created your AMIT Olympiad account.',
    icon: 'ph-user-plus',
    // Earned by everyone who has an account, because that is exactly what it
    // claims. Kept in the catalogue rather than dropped as trivial: it is the one
    // row a brand-new student can see already filled in, which is what makes the
    // empty ones read as "not yet" instead of "broken".
    measure: (f) => reach(f.registered ? 1 : 0, 1),
  },
  {
    code: 'verified',
    name: 'Verified',
    description: 'Confirmed your email address.',
    icon: 'ph-seal-check',
    measure: (f) => reach(f.isEmailVerified ? 1 : 0, 1),
  },
  {
    code: 'streak_3',
    name: 'Three in a row',
    description: 'Visited on 3 consecutive days.',
    icon: 'ph-flame',
    measure: (f) => reach(f.longestStreak, 3),
  },
  {
    code: 'streak_7',
    name: 'Week warrior',
    description: 'Visited on 7 consecutive days.',
    icon: 'ph-fire',
    measure: (f) => reach(f.longestStreak, 7),
  },
  {
    code: 'active_10_days',
    name: 'Ten days in',
    description: 'Active on 10 different days.',
    icon: 'ph-calendar-check',
    measure: (f) => reach(f.activeDays, 10),
  },
  {
    code: 'xp_100',
    name: 'First hundred',
    description: 'Earned 100 XP.',
    icon: 'ph-star',
    measure: (f) => reach(f.xp, 100),
  },
  {
    code: 'xp_500',
    name: 'Five hundred club',
    description: 'Earned 500 XP.',
    icon: 'ph-medal',
    measure: (f) => reach(f.xp, 500),
  },
  {
    code: 'level_5',
    name: 'Level five',
    description: 'Reached level 5.',
    icon: 'ph-trend-up',
    measure: (f) => reach(f.level, 5),
  },
];

export function evaluateAchievements(facts: ProgressFacts): EvaluatedAchievement[] {
  return ACHIEVEMENTS.map((definition) => {
    const { progress, target } = definition.measure(facts);
    return {
      code: definition.code,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      earned: progress >= target,
      progress,
      target,
    };
  });
}

export interface AchievementSummary {
  earnedCount: number;
  total: number;
  earned: EvaluatedAchievement[];
  /**
   * The locked achievements closest to completion, so the dashboard can show what
   * is actually within reach rather than the whole catalogue.
   */
  next: EvaluatedAchievement[];
}

export function summariseAchievements(facts: ProgressFacts, nextLimit = 3): AchievementSummary {
  const all = evaluateAchievements(facts);
  const earned = all.filter((a) => a.earned);
  const locked = all
    .filter((a) => !a.earned)
    // Closest to done first; ties broken by the smaller target, which is the
    // cheaper one to finish.
    .sort((a, b) => b.progress / b.target - a.progress / a.target || a.target - b.target);

  return { earnedCount: earned.length, total: all.length, earned, next: locked.slice(0, nextLimit) };
}
