/**
 * Everything the gamification catalogues are allowed to look at — all of it real.
 *
 * There are three catalogues (achievements, badges, the journey map) and they are all
 * **pure functions of this one object**. None of them reads a database, none of them
 * knows where a number came from, and none of them can invent one: if a fact is not on
 * this interface, no badge can be awarded for it.
 *
 * That is the whole design of the gamification engine in one sentence. `RewardFacts` is
 * assembled once per request by `services/rewardService.ts`, which is the only place
 * that queries for these figures; the catalogues are rule sets in code, reviewable in a
 * diff and testable without a database.
 *
 * Adding a fact is therefore a deliberate two-step act — declare it here, supply it
 * there — and that friction is the point. It is what stopped an "exam accuracy"
 * achievement from being written before anything recorded an exam.
 */
export interface RewardFacts {
  /**
   * The caller holds a real registered account. Always true in practice, and stated as
   * a fact anyway so the "Enrolled" rules read as what they assert rather than
   * inferring enrolment from a side effect.
   */
  registered: boolean;
  isEmailVerified: boolean;

  // --- Progress, derived from the activity log ---
  xp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  /** Distinct competition days on which this student did anything at all. */
  activeDays: number;

  // --- Real work, counted from the attempt collections ---
  /** Submitted practice sessions (Milestone 6). */
  practiceSessionsCompleted: number;
  /** Submitted mock-test attempts (Milestone 7). */
  mockTestsCompleted: number;
  /** Answered daily challenges, and the longest run of consecutive days (Milestone 8). */
  challengesCompleted: number;
  longestChallengeStreak: number;
  /** Submitted **official** exam attempts. Always 0 until that milestone exists. */
  examsCompleted: number;
}

/**
 * Facts for a caller whose history cannot be read — no database, or an account that
 * predates a field. Zeroes rather than absence, so a locked row shows an honest
 * `0 / 5` instead of vanishing or throwing.
 */
export const EMPTY_REWARD_FACTS: RewardFacts = {
  registered: true,
  isEmailVerified: false,
  xp: 0,
  level: 1,
  currentStreak: 0,
  longestStreak: 0,
  activeDays: 0,
  practiceSessionsCompleted: 0,
  mockTestsCompleted: 0,
  challengesCompleted: 0,
  longestChallengeStreak: 0,
  examsCompleted: 0,
};

/** Progress toward a "reach N" goal, never overstated past the target. */
export function reach(value: number, target: number): { progress: number; target: number } {
  return { progress: Math.min(value, target), target };
}
