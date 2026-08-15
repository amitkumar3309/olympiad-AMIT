import type { Difficulty, QuestionType } from '../models';
import type { ClassLevel } from './classLevels';

/**
 * THE contract for a question generator (Milestone 17).
 *
 * The admin page has had a "generate questions" button since before Milestone 4, and
 * until now it filled a template string. This file is what an actual model plugs into.
 *
 * ## The safety property the whole design turns on
 *
 * **A generator produces a candidate. It does not produce a question.**
 *
 * Nothing here is trusted. Every candidate is parsed by `createQuestionSchema` — the
 * *identical* schema a human author's question goes through, including
 * `validateMathContent()` — and anything that fails is **rejected and reported**, never
 * repaired and never stored. Then it is written as a `draft`, because
 * `createQuestion()` has no other mode. So the worst a badly-behaved model can do is
 * waste a reviewer's time, which is a cost, not a hazard.
 *
 * ## Why a candidate cannot choose its own taxonomy
 *
 * `GeneratedCandidate` deliberately has **no** `subject`, `topic`, `classLevel` or
 * `difficulty` field. Those come from the validated request the administrator made and
 * are attached by the service afterwards. A model therefore cannot file a question
 * under a topic nobody asked for, or invent taxonomy that nothing else knows about —
 * the same failure Milestone 4 closed when it stopped the template generator accepting
 * a free-text subject. It is structural rather than checked, which is the same trick
 * `RecommendationDraft` uses to stop an engine describing itself.
 */

// ---------------------------------------------------------------------------
// What a generator is asked for
// ---------------------------------------------------------------------------

/**
 * Names rather than ids, because a model needs the words. The ids stay on the server
 * side of this boundary and are never sent anywhere.
 */
export interface GenerationRequest {
  subjectName: string;
  topicName: string;
  classLevel: ClassLevel;
  difficulty: Difficulty;
  count: number;
  /** Optional steer from the administrator ("focus on word problems"). May be null. */
  instructions: string | null;
}

// ---------------------------------------------------------------------------
// What a generator returns
// ---------------------------------------------------------------------------

/**
 * One proposed question. Note what is absent: the taxonomy, the status, and any
 * identifier. A candidate is a suggestion about *content* and nothing else.
 *
 * `options` carries no `key` either — keys are assigned server-side, which is what
 * makes "the correct answer is option b" a fact about stored data rather than about
 * whatever order a model happened to emit.
 */
export interface GeneratedCandidate {
  questionText: string;
  type: QuestionType;
  options: Array<{ text: string; isCorrect: boolean }>;
  booleanAnswer: boolean | null;
  numericAnswer: number | null;
  tolerance: number | null;
  solution: string | null;
  marks: number;
  negativeMarks: number;
  tags: string[];
}

/** How a generator describes itself. `kind` is a statement of fact, not a label. */
export interface GeneratorDescriptor {
  id: string;
  label: string;
  /**
   * `'template'` for string filling. `'model'` **only** when a real language model
   * produced the text. The admin page prints this, and the audit trail records it, so
   * "was this question written by a machine?" stays answerable years later.
   */
  kind: 'template' | 'model';
  /** One sentence the UI shows verbatim. */
  basis: string;
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

export interface QuestionGenerator {
  readonly descriptor: GeneratorDescriptor;
  /**
   * False when the generator cannot run — typically an unconfigured API key.
   *
   * Checked *before* use so an unconfigured provider is a clean fallback to the
   * template generator rather than an error the administrator has to interpret. This
   * is what keeps the product working with no credentials at all.
   */
  isAvailable(): boolean;
  /**
   * May throw. The service catches, reports the provider's own message, and falls back
   * to the template generator, so a dead quota costs a nicer button, not the feature.
   */
  generate(request: GenerationRequest): Promise<GeneratedCandidate[]>;
}

/** Why a candidate was thrown away. Reported to the administrator, never swallowed. */
export interface RejectedCandidate {
  index: number;
  reason: string;
}
