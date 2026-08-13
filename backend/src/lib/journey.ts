import { reach, type RewardFacts } from './rewardFacts';

/**
 * The journey map: the route through this platform, as an ordered path.
 *
 * ## What it is for, and why it is not a third badge list
 *
 * Achievements answer "what have I done?" and badges answer "how far along am I?".
 * Neither answers the question a new student actually has, which is **"what should I do
 * next?"** — and that question has a right answer, because the product has an intended
 * order: verify your address, try practice where nothing is at stake, meet the daily
 * habit, then sit a timed paper.
 *
 * So the journey is **ordered and gated in presentation**: exactly one stage is
 * `current` — the first incomplete one — and it is the thing to do next. A student who
 * has done everything has no current stage and a completed path.
 *
 * ## Derived, like everything else
 *
 * Every stage is a pure predicate over `RewardFacts`. Nothing is stored as reached, so
 * the path cannot go stale, cannot be granted by a bug, and cannot disagree with the
 * activity log. Stages are deliberately **not** re-lockable: they measure cumulative
 * facts (`practiceSessionsCompleted`, `xp`, `longestStreak`), never a current-streak
 * figure that could fall back and un-complete a stage the student really did reach.
 * That last point is the one real trap in this file — see `stage_habit` below.
 */

export interface JourneyStageDefinition {
  id: string;
  title: string;
  /** What the student is being asked to do, in their words. */
  description: string;
  icon: string;
  /** Progress toward completing this stage. `progress >= target` means done. */
  measure: (facts: RewardFacts) => { progress: number; target: number };
}

export interface EvaluatedJourneyStage {
  id: string;
  title: string;
  description: string;
  icon: string;
  complete: boolean;
  /** True for the first incomplete stage — the one thing to do next. */
  current: boolean;
  progress: number;
  target: number;
}

export const JOURNEY_STAGES: readonly JourneyStageDefinition[] = [
  {
    id: 'enrolled',
    title: 'Enrolled',
    description: 'Your account is created. Welcome to the Olympiad.',
    icon: 'ph-user-plus',
    measure: (f) => reach(f.registered ? 1 : 0, 1),
  },
  {
    id: 'verified',
    title: 'Email verified',
    description: 'Confirm your address so you can sign in and recover your account.',
    icon: 'ph-seal-check',
    measure: (f) => reach(f.isEmailVerified ? 1 : 0, 1),
  },
  {
    id: 'first_practice',
    title: 'First practice',
    description: 'Finish a practice session. Nothing is at stake — it is the place to get comfortable.',
    icon: 'ph-target',
    measure: (f) => reach(f.practiceSessionsCompleted, 1),
  },
  {
    id: 'first_challenge',
    title: 'First daily challenge',
    description: 'Answer the question of the day. One a day is the habit that builds a streak.',
    icon: 'ph-dice-five',
    measure: (f) => reach(f.challengesCompleted, 1),
  },
  {
    id: 'habit',
    title: 'Three days running',
    /**
     * Measured on the **longest** streak, not the current one. Using the current streak
     * would let a completed stage un-complete itself the day a student missed — the map
     * would walk backwards, which is not what a journey does and would read as the site
     * taking something away.
     */
    description: 'Show up three days in a row.',
    icon: 'ph-flame',
    measure: (f) => reach(f.longestStreak, 3),
  },
  {
    id: 'first_mock',
    title: 'First mock test',
    description: 'Sit a timed paper. The clock is real, and so is the marking.',
    icon: 'ph-exam',
    measure: (f) => reach(f.mockTestsCompleted, 1),
  },
  {
    id: 'level_3',
    title: 'Level 3',
    description: 'Keep going until you reach level 3.',
    icon: 'ph-trend-up',
    measure: (f) => reach(f.level, 3),
  },
  {
    id: 'seasoned',
    title: 'Ten practice sessions',
    description: 'Ten finished sessions is the point at which the topic list starts to feel small.',
    icon: 'ph-books',
    measure: (f) => reach(f.practiceSessionsCompleted, 10),
  },
  {
    id: 'olympiad_ready',
    title: 'Olympiad ready',
    description: 'Five mock tests sat. You know what the day will feel like.',
    icon: 'ph-medal',
    measure: (f) => reach(f.mockTestsCompleted, 5),
  },
];

export interface JourneySummary {
  stages: EvaluatedJourneyStage[];
  completedCount: number;
  total: number;
  /** 0–100, rounded for display only. */
  percent: number;
  /** The id of the one thing to do next, or null when the path is finished. */
  currentStageId: string | null;
}

export function summariseJourney(facts: RewardFacts): JourneySummary {
  let currentFound = false;

  const stages: EvaluatedJourneyStage[] = JOURNEY_STAGES.map((definition) => {
    const { progress, target } = definition.measure(facts);
    const complete = progress >= target;
    // The first incomplete stage is the current one; every later one is simply ahead.
    const current = !complete && !currentFound;
    if (current) currentFound = true;

    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      icon: definition.icon,
      complete,
      current,
      progress,
      target,
    };
  });

  const completedCount = stages.filter((stage) => stage.complete).length;

  return {
    stages,
    completedCount,
    total: stages.length,
    percent: Math.round((completedCount / stages.length) * 100),
    currentStageId: stages.find((stage) => stage.current)?.id ?? null,
  };
}
