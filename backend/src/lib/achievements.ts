import { reach, type RewardFacts } from './rewardFacts';

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

/**
 * Everything an achievement predicate is allowed to look at — all of it real.
 *
 * Moved to `lib/rewardFacts.ts` in Milestone 9, when badges and the journey map needed
 * exactly the same inputs. One facts object, three pure catalogues: whatever is not on
 * it cannot be awarded for. The alias is kept because "progress facts" is what the
 * achievement code has always called it.
 */
export type ProgressFacts = RewardFacts;

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
  /**
   * The two challenge achievements (Milestone 8). These are the first ones in the
   * catalogue that require the student to have *answered a question* rather than
   * merely turned up — and they satisfy rule 2 above only because the daily challenge
   * now records attempts. Before Milestone 8 they would have been exactly the
   * permanently-locked rows this file refuses to advertise.
   */
  {
    code: 'challenge_first',
    name: 'Challenger',
    description: 'Answered your first daily challenge.',
    icon: 'ph-dice-five',
    measure: (f) => reach(f.challengesCompleted, 1),
  },
  {
    code: 'challenge_streak_5',
    name: 'Five days sharp',
    description: 'Answered the daily challenge on 5 consecutive days.',
    icon: 'ph-lightning',
    measure: (f) => reach(f.longestChallengeStreak, 5),
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
