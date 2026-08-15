import type { Difficulty } from '../models';
import type { ClassLevel } from './classLevels';
import type { StudentAnalytics } from '../services/analyticsService';
import type { SubjectAvailability } from '../services/practiceService';

/**
 * THE contract of the recommendation seam (Milestone 16).
 *
 * This one file is everything an alternative engine — a statistical model, a trained
 * classifier, an LLM — has to read in order to be plugged in. Nothing else about the
 * product needs to change to swap the implementation: the route, the response shape and
 * the page all speak these types.
 *
 * ## The three rules the seam exists to enforce
 *
 * 1. **A recommendation must cite the numbers it came from.** `basis` is a required
 *    field, not an optional decoration, so a recommendation that cannot say what it was
 *    derived from cannot be constructed at all. This is the structural version of the
 *    lesson Milestone 15 was built on: the deleted `generateAIInsights()` produced
 *    confident prose with nothing behind it, and the only defence against that returning
 *    is making the evidence part of the type.
 *
 * 2. **An engine does not get to describe itself.** `recommend()` returns a
 *    `RecommendationDraft` — the content only. `services/recommendationService.ts`
 *    stamps `engine`, `generatedAt` and `hasData` onto it afterwards, from the registry
 *    entry it actually invoked. An engine therefore cannot claim to be something it is
 *    not, and cannot claim data exists when the student has answered nothing.
 *
 * 3. **`kind: 'model'` is a statement of fact, not a marketing label.** An engine may
 *    only declare it when a real trained model or language model produced the output.
 *    The default engine is `kind: 'statistical'` and the UI says so in plain words.
 *    Calling rule-based arithmetic "AI" is the exact fiction Milestone 15 deleted, and
 *    re-introducing it under a nicer name would be worse than the original because the
 *    numbers underneath are now real enough to be believed.
 *
 * ## What an engine may look at
 *
 * `RecommendationFacts`, and nothing else. Like `RewardFacts` for the gamification
 * catalogues, this is a deliberate wall: an engine cannot query, so it cannot invent a
 * figure that no collection could produce, and it cannot become slow in a way the
 * caller did not budget for. Adding a new input is a two-step act — declare it here,
 * supply it in the service — and that friction is the point.
 */

// ---------------------------------------------------------------------------
// What an engine is allowed to know
// ---------------------------------------------------------------------------

/**
 * Everything an engine may reason over. All of it is real and already derived:
 * `analytics` is THE Milestone 15 derivation, unchanged and un-re-implemented, and
 * `availability` is the real published question bank for this student's own class.
 *
 * The bank matters as much as the performance does. A recommendation to practise a
 * topic that has no published questions for the student's class is one the product
 * cannot honour, and a student who follows it lands on an empty picker — which reads as
 * the site being broken rather than as advice being approximate.
 */
export interface RecommendationFacts {
  /**
   * Null for a staff account, which has no class at all — `classLevel` is required only
   * of a `student` on create, and the bootstrap super admin is not an entrant. The bank
   * is then empty rather than guessed at, and a note says so.
   */
  classLevel: ClassLevel | null;
  /** The student's derived performance. Never recomputed by an engine. */
  analytics: StudentAnalytics;
  /** Published questions for this class, subject → topic, with real counts. */
  availability: SubjectAvailability[];
  /** Published mock tests set for this class. A count, because that is all a rule needs. */
  publishedMockTests: number;
  /** Fixed at assembly so an engine cannot produce time-dependent output twice. */
  now: Date;
}

// ---------------------------------------------------------------------------
// What an engine produces
// ---------------------------------------------------------------------------

export const RECOMMENDATION_KINDS = ['weak_topic', 'strong_topic', 'difficulty', 'practice', 'insight'] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

/**
 * How much weight the reader should give this.
 *
 * Derived from sample size alone, never from how strong the effect looks: a 0% accuracy
 * over five questions is a weaker claim than 55% over eighty, and presenting the first
 * as certain is how a real number becomes a false conclusion.
 */
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Which part of the student's record a recommendation was read out of. */
export type BasisScope = 'overall' | 'topic' | 'subject' | 'difficulty' | 'surface' | 'bank' | 'trend';

/**
 * The evidence. Required on every recommendation — see rule 1.
 *
 * `lowerBoundPercent` / `upperBoundPercent` are the 95% Wilson score interval around
 * the accuracy, which is what lets a rule say "confidently below par" rather than
 * "below par on the four questions we happened to see". They are null when there is no
 * sample to put an interval around.
 */
export interface RecommendationBasis {
  scope: BasisScope;
  /** Stable id of the thing measured (a topic id, a difficulty name), when there is one. */
  scopeId: string | null;
  /** Human name of the thing measured, as the UI should print it. */
  scopeName: string | null;
  answered: number;
  correct: number;
  /** `correct / answered`. Null when nothing was answered — never rendered as 0%. */
  accuracyPercent: number | null;
  lowerBoundPercent: number | null;
  upperBoundPercent: number | null;
  /**
   * Any other counts the sentence quotes — `{ availableQuestions: 12 }`. Numbers only,
   * so everything on a basis stays checkable against a collection.
   */
  figures: Record<string, number>;
}

/** Where a recommendation sends the student, when it can send them somewhere real. */
export interface RecommendationAction {
  label: string;
  /** A frontend route. Only ever built from ids the bank really contains. */
  href: string;
}

export interface Recommendation {
  /** Stable across reloads for the same finding, so the UI can key on it. */
  id: string;
  kind: RecommendationKind;
  title: string;
  /** One sentence, quoting the figures in `basis`. Never generated prose. */
  detail: string;
  /** 0–100, higher first. Comparable within a kind; see the engine for the formula. */
  priority: number;
  confidence: Confidence;
  basis: RecommendationBasis;
  action: RecommendationAction | null;
}

/**
 * What `recommend()` returns: content only.
 *
 * The five groups are the five things the product promises. They are separate fields
 * rather than one list with a `kind` filter so that an engine which cannot produce one
 * of them returns an empty array in the obvious place, and the page can explain the gap
 * per section instead of showing a shorter list with no reason.
 */
export interface RecommendationDraft {
  weakTopics: Recommendation[];
  strongTopics: Recommendation[];
  difficulty: Recommendation[];
  practice: Recommendation[];
  insights: Recommendation[];
  /** Machine-readable reasons a section is empty. Never a fabricated stand-in. */
  notes: string[];
}

/** How an engine describes itself. Written by the registry, never by the engine's output. */
export interface EngineDescriptor {
  id: string;
  label: string;
  /**
   * `'statistical'` for arithmetic over the facts. `'model'` **only** when a real
   * trained model or language model produced the output — see rule 3.
   */
  kind: 'statistical' | 'model';
  /** One sentence the UI can show verbatim to say how these were worked out. */
  basis: string;
}

/** The full response: an engine's draft, stamped with provenance by the service. */
export interface RecommendationSet extends RecommendationDraft {
  generatedAt: Date;
  engine: EngineDescriptor;
  /** False when the student has submitted nothing. The UI shows one honest message. */
  hasData: boolean;
  /** Answers an area needs before it may be called a strength or a weakness. */
  minimumSample: number;
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * The interface an alternative implementation implements.
 *
 * Deliberately allowed to be async, because a model-backed engine will be. The service
 * that calls it treats a rejection as a fault in the engine rather than in the request:
 * it falls back to the statistical engine and still answers, because losing the
 * recommendations panel is a smaller harm than losing the analytics page.
 *
 * To add one:
 *   1. implement this interface;
 *   2. `registerRecommendationEngine(yours)` from `services/recommendationService.ts`;
 *   3. set `RECOMMENDATION_ENGINE=<your id>`.
 *
 * There is no fourth step, and nothing about the route or the page changes.
 */
export interface RecommendationEngine {
  readonly descriptor: EngineDescriptor;
  recommend(facts: RecommendationFacts): RecommendationDraft | Promise<RecommendationDraft>;
}

// ---------------------------------------------------------------------------
// Shared helpers, so every engine agrees on what the words mean
// ---------------------------------------------------------------------------

/** Sample sizes at which a claim earns more weight. */
export const CONFIDENCE_MEDIUM_SAMPLE = 10;
export const CONFIDENCE_HIGH_SAMPLE = 20;

export function confidenceFor(answered: number): Confidence {
  if (answered >= CONFIDENCE_HIGH_SAMPLE) return 'high';
  if (answered >= CONFIDENCE_MEDIUM_SAMPLE) return 'medium';
  return 'low';
}

/** The difficulty ladder, low to high. Used to decide what "the next level up" means. */
export const DIFFICULTY_LADDER: readonly Difficulty[] = ['Easy', 'Medium', 'Hard'];

export function nextDifficultyUp(level: Difficulty): Difficulty | null {
  const index = DIFFICULTY_LADDER.indexOf(level);
  return index >= 0 ? (DIFFICULTY_LADDER[index + 1] ?? null) : null;
}
