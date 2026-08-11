import type { Difficulty, QuestionType } from '../../src/models/Question';

/**
 * The shape the Class 12 question seeds are authored in, plus four helpers that
 * build it.
 *
 * The point of this module is that authoring a question should be one line and
 * should make the *answer* impossible to get wrong by accident. Writing raw
 * `options: [{ text, isCorrect }]` arrays by hand across two hundred questions is
 * how a paper ends up with two correct options or none — the validation layer would
 * catch it, but only after the fact. Here the correct answer is a separate argument
 * from the distractors, so it cannot be omitted or duplicated.
 *
 * ## Option order
 *
 * Helpers take the correct answer first, for readability. The **runner shuffles**
 * the options deterministically before writing (see `seed-class12.ts`), so the
 * correct choice is not always `a`. That is not cosmetic: a bank where every answer
 * is the first option is worthless for practice, and the Practice Zone records
 * answers against the option *key*.
 *
 * ## LaTeX
 *
 * Author with the `r` tag (`String.raw`) so backslashes are written once:
 * `r`$\int x^2\,dx$`` rather than `'$\\int x^2\\,dx$'`. Every field still passes
 * through `validateMathContent()` in the runner, the same check the API applies, so
 * an unbalanced `$` fails the seed rather than reaching the database.
 */

/** `String.raw`, for authoring LaTeX without doubling every backslash. */
export const r = String.raw;

export interface SeedQuestion {
  questionText: string;
  type: QuestionType;
  options: Array<{ text: string; isCorrect: boolean }>;
  booleanAnswer: boolean | null;
  numericAnswer: number | null;
  tolerance: number | null;
  solution: string;
  difficulty: Difficulty;
  marks: number;
  negativeMarks: number;
  tags: string[];
}

/** One topic's worth of questions. Topics are created if they do not exist. */
export interface SeedTopic {
  topic: string;
  questions: SeedQuestion[];
}

export interface SeedSubject {
  subject: string;
  topics: SeedTopic[];
}

interface Extras {
  d?: Difficulty;
  marks?: number;
  /** Amount deducted for a wrong answer. Never allowed to exceed `marks`. */
  neg?: number;
  tags?: string[];
}

function base(extras: Extras = {}) {
  return {
    difficulty: extras.d ?? 'Medium',
    marks: extras.marks ?? 4,
    negativeMarks: extras.neg ?? 1,
    tags: extras.tags ?? [],
  } satisfies Pick<SeedQuestion, 'difficulty' | 'marks' | 'negativeMarks' | 'tags'>;
}

/** Single correct answer out of several. The commonest olympiad format. */
export function sc(
  questionText: string,
  correct: string,
  wrong: string[],
  solution: string,
  extras: Extras = {},
): SeedQuestion {
  return {
    questionText,
    type: 'single_choice',
    options: [{ text: correct, isCorrect: true }, ...wrong.map((text) => ({ text, isCorrect: false }))],
    booleanAnswer: null,
    numericAnswer: null,
    tolerance: null,
    solution,
    ...base(extras),
  };
}

/** Two or more correct options; the Practice Zone requires the exact set. */
export function mc(
  questionText: string,
  correct: string[],
  wrong: string[],
  solution: string,
  extras: Extras = {},
): SeedQuestion {
  return {
    questionText,
    type: 'multiple_choice',
    options: [
      ...correct.map((text) => ({ text, isCorrect: true })),
      ...wrong.map((text) => ({ text, isCorrect: false })),
    ],
    booleanAnswer: null,
    numericAnswer: null,
    tolerance: null,
    solution,
    ...base(extras),
  };
}

/** True/false. Carries no options — the answer is the boolean. */
export function tf(questionText: string, answer: boolean, solution: string, extras: Extras = {}): SeedQuestion {
  return {
    questionText,
    type: 'true_false',
    options: [],
    booleanAnswer: answer,
    numericAnswer: null,
    tolerance: null,
    solution,
    // A true/false question is worth less and carries no penalty by default: with a
    // 50% chance of a lucky guess, negative marking on it punishes the honest
    // student who thought about it more than the one who flipped a coin.
    ...base({ marks: 2, neg: 0, ...extras }),
  };
}

/**
 * Numeric answer, compared within `tolerance`.
 *
 * `tolerance` defaults to 0 (exact). Always set one for a value that is irrational
 * or the result of a division — asking for $\sqrt{14}$ to an exact match is a
 * question nobody can answer.
 */
export function num(
  questionText: string,
  answer: number,
  solution: string,
  extras: Extras & { tol?: number } = {},
): SeedQuestion {
  return {
    questionText,
    type: 'numeric',
    options: [],
    booleanAnswer: null,
    numericAnswer: answer,
    tolerance: extras.tol ?? 0,
    solution,
    ...base({ marks: 3, neg: 0, ...extras }),
  };
}
