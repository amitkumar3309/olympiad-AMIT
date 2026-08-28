import { DIFFICULTIES, QUESTION_TYPES, type Difficulty, type QuestionType } from '../models/Question';

/**
 * Reading a human-written answer, shared by every import format (Milestone 21, Phase D).
 *
 * ## Why this is not in the Excel parser any more
 *
 * It started there, and moving it out is the same argument that keeps one grader and one
 * screener: **"the answer is B" must mean the same thing whichever file it was written in.** A
 * spreadsheet cell and a `Answer: B` line in a Word document are the same human statement, and two
 * implementations of reading it would eventually disagree — at which point the same question
 * imported from two formats would carry two different answer keys.
 *
 * Everything here is a **pure function of a string**. No database, no configuration, no I/O, like
 * `lib/questionQuality.ts` and the reward catalogues, so every reading is reproducible from its
 * input and testable without a fixture file.
 *
 * ## Forgiving about spelling, never about meaning
 *
 * These readers accept the many ways a real examiner writes the same thing — `TRUE`, `T`, `Yes`;
 * `A, C`, `A and C`, `A;C`; `MCQ` for `single_choice`. What they never do is **guess**: an
 * unrecognised value returns `null` and the caller reports it against its row or question number.
 * That is the `normalizeAnswerText()` principle applied one layer earlier — a reader that guesses
 * puts a wrong answer key in front of a child, and the mistake is invisible until a correct answer
 * is marked wrong.
 */

/** A label reduced to comparable form: lowercase letters and digits only. */
export function normaliseLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

// ---------------------------------------------------------------------------
// True and false
// ---------------------------------------------------------------------------

/** Every spelling of yes and no a real document contains. */
const TRUE_WORDS = ['true', 't', 'yes', 'y', '1', 'correct'];
const FALSE_WORDS = ['false', 'f', 'no', 'n', '0', 'incorrect'];

export function readBoolean(value: string): boolean | null {
  const text = value.trim().toLowerCase();
  if (TRUE_WORDS.includes(text)) return true;
  if (FALSE_WORDS.includes(text)) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Which options are correct
// ---------------------------------------------------------------------------

/** The separators an examiner uses between two correct answers. */
const ANSWER_SEPARATORS = /\s*(?:,|;|\/|\+|&|\band\b)\s*/iu;

/**
 * Which options an answer statement names.
 *
 * Accepts option **letters** (`B`, `b`, `(b)`, `b)`, `Option B`) and option **text** matched
 * case-insensitively. Both are needed: a document written for a human says `B`, and one exported
 * from another system repeats the answer text.
 *
 * Returns what it resolved *plus* what it could not, rather than throwing on the first problem —
 * `"B, Z"` should tell the examiner about `Z` specifically rather than refusing the whole row.
 */
export function readCorrectOptions(
  value: string,
  optionTexts: readonly string[],
): { positions: number[]; unresolved: string[] } {
  const positions = new Set<number>();
  const unresolved: string[] = [];

  const tokens = value
    .split(ANSWER_SEPARATORS)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  for (const token of tokens) {
    const bare = token.replace(/^\(|[).:]$/gu, '').trim();

    const letter = /^(?:option\s*|choice\s*)?([a-h])$/iu.exec(bare);
    if (letter?.[1]) {
      const index = letter[1].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
      if (index < optionTexts.length) {
        positions.add(index);
        continue;
      }
      // `D` on a three-option question is a real mistake, not a text match to go hunting for.
      unresolved.push(token);
      continue;
    }

    /**
     * A parenthesised or bare number, as `(1)`–`(4)` papers use.
     *
     * One-based, because a document that numbers its options from 1 means "the first option" by
     * `1`. Only accepted when it lands inside the options that exist, so `5` on a four-option
     * question is reported rather than silently ignored.
     */
    const digit = /^([1-8])$/u.exec(bare);
    if (digit?.[1]) {
      const index = Number(digit[1]) - 1;
      if (index < optionTexts.length) {
        positions.add(index);
        continue;
      }
      unresolved.push(token);
      continue;
    }

    const byText = optionTexts.findIndex((text) => text.trim().toLowerCase() === bare.toLowerCase());
    if (byText !== -1) {
      positions.add(byText);
      continue;
    }

    unresolved.push(token);
  }

  return { positions: [...positions].sort((a, b) => a - b), unresolved };
}

/** How many distinct answers a statement appears to name. Used only for type inference. */
export function countAnswerTokens(value: string): number {
  return value.split(ANSWER_SEPARATORS).filter((token) => token.trim().length > 0).length;
}

// ---------------------------------------------------------------------------
// Fill-in-the-blank
// ---------------------------------------------------------------------------

/**
 * The accepted answers for a fill-in-the-blank question.
 *
 * Split on `|` rather than a comma, and that choice is load-bearing: `1,000`, `2, 3 and 5` and any
 * coordinate pair are **single answers containing commas**, so a comma-separated list would
 * silently split real answers into wrong ones. The failure would be invisible — the question
 * imports, looks right on the review screen, and marks a correct answer wrong months later.
 */
export function readAcceptedAnswers(value: string): string[] {
  return value
    .split('|')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// ---------------------------------------------------------------------------
// The question type
// ---------------------------------------------------------------------------

/** The names an examiner writes for a question type, beyond the canonical ones. */
const TYPE_ALIASES: Record<string, QuestionType> = {
  mcq: 'single_choice',
  single: 'single_choice',
  singleanswer: 'single_choice',
  singlecorrect: 'single_choice',
  onecorrect: 'single_choice',
  objective: 'single_choice',
  multiple: 'multiple_choice',
  multi: 'multiple_choice',
  mcqmultiple: 'multiple_choice',
  multipleanswer: 'multiple_choice',
  multiplecorrect: 'multiple_choice',
  morethanonecorrect: 'multiple_choice',
  truefalse: 'true_false',
  tf: 'true_false',
  boolean: 'true_false',
  assertion: 'true_false',
  number: 'numeric',
  numerical: 'numeric',
  integer: 'numeric',
  integertype: 'numeric',
  fillblank: 'fill_blank',
  fillintheblank: 'fill_blank',
  fillintheblanks: 'fill_blank',
  fillinblanks: 'fill_blank',
  blank: 'fill_blank',
  fill: 'fill_blank',
};

export function readQuestionType(value: string): QuestionType | null {
  const normalised = normaliseLabel(value);
  if (normalised.length === 0) return null;

  const direct = QUESTION_TYPES.find((candidate) => normaliseLabel(candidate) === normalised);
  if (direct) return direct;

  return TYPE_ALIASES[normalised] ?? null;
}

/** A difficulty, case-insensitively. Nothing more forgiving than that. */
export function readDifficulty(value: string): Difficulty | null {
  const trimmed = value.trim().toLowerCase();
  return DIFFICULTIES.find((level) => level.toLowerCase() === trimmed) ?? null;
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

/**
 * Works out what kind of question this is when the file does not say.
 *
 * Ordered most-certain first. **Options are decisive** — nothing but a choice question has them.
 * After that a true/false word beats a number, because `1` and `0` are both boolean spellings and
 * a bare `1` in an answer position is far more often "true" than the number one. Everything else
 * with a text answer is a fill-in-the-blank, which is the only remaining auto-gradable shape
 * (there is deliberately no short-answer type — see the Milestone 18 ADR).
 *
 * **Always returns a note**, because an inference is precisely the thing a reviewer should check.
 */
export function inferType(optionCount: number, answerText: string): { type: QuestionType; note: string } {
  if (optionCount > 0) {
    return countAnswerTokens(answerText) > 1
      ? {
          type: 'multiple_choice',
          note: 'No question type was given; read as multiple-choice because more than one answer was listed.',
        }
      : { type: 'single_choice', note: 'No question type was given; read as single-choice from its options.' };
  }

  if (readBoolean(answerText) !== null) {
    return { type: 'true_false', note: 'No question type was given; read as true/false from its answer.' };
  }

  if (answerText.length > 0 && Number.isFinite(Number(answerText.replace(/[\s,]/gu, '')))) {
    return { type: 'numeric', note: 'No question type was given; read as a numeric answer.' };
  }

  return { type: 'fill_blank', note: 'No question type was given; read as fill-in-the-blank from its answer.' };
}

/** A number as a document writes it, or `null` for blank, or `undefined` for nonsense. */
export function readNumber(value: string): number | null | undefined {
  const text = value.trim();
  if (text.length === 0) return null;
  const parsed = Number(text.replace(/[\s,]/gu, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}
