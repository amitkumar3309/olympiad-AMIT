import type { Difficulty, QuestionType } from '../models';
import type { ClassLevel } from './classLevels';

/**
 * THE contract for a question generator (Milestone 17, reworked in Milestone 18).
 *
 * ## What changed in Milestone 18, and why it is the important change
 *
 * Milestone 17 generated questions and **saved them immediately** as drafts. That was
 * defensible — a draft is not visible to a student — but it meant the bank filled up
 * with machine output nobody had read, and "delete the bad ones" was the reviewer's
 * job rather than "keep the good ones".
 *
 * Now **nothing is persisted by generation at all**. `generate()` returns candidates,
 * they are held in the reviewer's browser, and a separate, explicit approval call is
 * the only thing that writes to the database. The template generator is gone with it:
 * a blank placeholder was only ever useful as something to type into, and a reviewer
 * who wants that can still create a question by hand.
 *
 * ## The safety property, unchanged and still the whole design
 *
 * **A generator produces a candidate. It does not produce a question.**
 *
 * Every candidate is parsed by `createQuestionSchema` — the *identical* schema a human
 * author's question goes through, including `validateMathContent()` — and anything
 * that fails is **rejected and reported**, never repaired. The taxonomy is attached by
 * the service from the reviewer's own request, so a model cannot file a question
 * anywhere it was not asked to: `GeneratedCandidate` has no `subject`, `topic`,
 * `classLevel` or `difficulty` field, and adding one would break that guarantee.
 */

// ---------------------------------------------------------------------------
// What a generator is asked for
// ---------------------------------------------------------------------------

/**
 * Bloom's taxonomy levels, ordered from recall to creation.
 *
 * Carried through to the prompt and stored as a tag rather than a first-class field:
 * it describes the *intent* of a question, nothing in the product branches on it, and
 * a stored field nothing reads is the shape of thing Milestone 15 deleted.
 */
export const BLOOM_LEVELS = ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'] as const;
export type BloomLevel = (typeof BLOOM_LEVELS)[number];

/** Languages the bank can be authored in. */
export const GENERATION_LANGUAGES = ['English', 'Hindi', 'Hinglish'] as const;
export type GenerationLanguage = (typeof GENERATION_LANGUAGES)[number];

/** One chapter the questions may be drawn from, named for the prompt. */
export interface ChapterRef {
  id: string;
  name: string;
}

export interface GenerationRequest {
  subjectName: string;
  /**
   * One or more chapters. The generator is told to spread questions across them, and
   * the service attaches whichever chapter id the reviewer picked as primary — a
   * question belongs to exactly one topic in this bank.
   */
  chapters: ChapterRef[];
  classLevel: ClassLevel;
  difficulty: Difficulty;
  count: number;
  /** The answer shape to produce. One per request, so the reviewer knows what to expect. */
  questionType: QuestionType;
  language: GenerationLanguage;
  bloomLevel: BloomLevel | null;
  /** Marks per question, and the deduction for a wrong answer. */
  marks: number;
  negativeMarks: number;
  /** Options per MCQ. Ignored for the types that carry no options. */
  optionCount: number;
  instructions: string | null;
  /**
   * Question text the model must not reproduce — what is already in the bank for this
   * topic, plus anything already in the batch. This is how "unique and non-repetitive"
   * is asked for; `services/questionGeneratorService.ts` enforces it afterwards, because
   * an instruction is a request and a check is a guarantee.
   */
  avoid: string[];
}

// ---------------------------------------------------------------------------
// What a generator returns
// ---------------------------------------------------------------------------

/**
 * One proposed question. Note what is absent: the taxonomy, the status, and any
 * identifier. A candidate is a suggestion about *content* and nothing else.
 *
 * `options` carries no `key` — keys are assigned server-side, which is what makes "the
 * correct answer is option b" a fact about stored data rather than about whatever order
 * a model happened to emit.
 */
export interface GeneratedCandidate {
  questionText: string;
  type: QuestionType;
  options: Array<{ text: string; isCorrect: boolean }>;
  booleanAnswer: boolean | null;
  numericAnswer: number | null;
  tolerance: number | null;
  /** `fill_blank` only: every spelling that counts as correct. */
  acceptedAnswers: string[];
  solution: string | null;
  marks: number;
  negativeMarks: number;
  tags: string[];
}

/** How a generator describes itself. `kind` is a statement of fact, not a label. */
export interface GeneratorDescriptor {
  id: string;
  label: string;
  /** `'model'` only when a real language model produced the text. */
  kind: 'model';
  /** One sentence the UI shows verbatim. */
  basis: string;
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * The interface an alternative provider implements.
 *
 * Adding OpenAI or Claude is: implement this, `registerQuestionGenerator(yours)`, set
 * `QUESTION_GENERATOR` to its id. Nothing about the routes, the validation, the review
 * screen or the approval path changes — they all speak `GeneratedCandidate`, which is
 * provider-agnostic by construction.
 */
export interface QuestionGenerator {
  readonly descriptor: GeneratorDescriptor;
  /** False when the provider is unconfigured. Checked before use, reported clearly. */
  isAvailable(): boolean;
  /** May throw; the caller reports the provider's own message rather than swallowing it. */
  generate(request: GenerationRequest): Promise<GeneratedCandidate[]>;
}

/** Why a candidate was thrown away. Reported to the reviewer, never swallowed. */
export interface RejectedCandidate {
  index: number;
  reason: string;
}
