import type { GeneratedCandidate } from './questionGeneratorTypes';

/**
 * Advisory checks on a proposed question — the things a reviewer's eye slides past
 * (Milestone 20).
 *
 * ## What this is not
 *
 * **It does not verify that a question is mathematically correct, and nothing here should
 * be read as saying it does.** Checking that $x^2-5x+6=0$ really has $3$ as its larger
 * root requires solving the question, which is the reviewer's job and is precisely why the
 * review step is mandatory. Claiming otherwise would be worse than claiming nothing: a
 * reviewer who believes the answer key was checked stops checking it.
 *
 * What this does is the narrow band of defects that **are** decidable from the text alone:
 * a question that refers to a diagram it cannot have, a solution that restates the answer
 * instead of reaching it, a numeric tolerance so wide it will mark a wrong answer right, a
 * correct option that is conspicuously the longest, the correct answer sitting in the same
 * position all the way down a batch. Every one of those is a real defect an examiner would
 * want to know about, and every one of them is cheap arithmetic over strings.
 *
 * ## Why they are warnings and not rejections
 *
 * Each of these is a strong *hint* rather than a rule, and a rule that is sometimes wrong
 * must not throw a question away. `createQuestionSchema` holds the rules — the things that
 * are always defects — and it rejects. This layer annotates, the reviewer decides, and
 * approval is never blocked by it. That division is the same one that keeps
 * `services/grading.ts` singular: the gate is one place, and this is not it.
 *
 * ## Pure, like the reward catalogues
 *
 * No database, no configuration, no I/O — a function of the candidates and nothing else,
 * for the reason `lib/achievements.ts` is: it makes every warning reproducible from its
 * inputs and testable without a fixture.
 */

export interface QualityWarning {
  /** Stable machine name, so the UI can group or suppress without parsing prose. */
  code: string;
  /** One sentence, addressed to the examiner, naming what to look at. */
  message: string;
}

/** Warnings about one candidate, plus the ones only visible across the whole batch. */
export interface QualityReport {
  /** Per candidate, in the order they were proposed. */
  perQuestion: QualityWarning[][];
  /** About the set as a whole. */
  batch: QualityWarning[];
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Strips LaTeX delimiters, spacing macros and punctuation so two spellings compare equal. */
function bare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\$/gu, '')
    .replace(/\\(?:left|right|,|;|:|!|quad|qquad|text|mathrm)\b/gu, '')
    .replace(/[{}\s]/gu, '')
    .replace(/[.,]$/u, '');
}

/** True when the text contains at least one `$…$` island. */
function hasMathIsland(text: string): boolean {
  return /\$[^$]+\$/u.test(text);
}

// ---------------------------------------------------------------------------
// Per-question checks
// ---------------------------------------------------------------------------

/**
 * A question that cannot be answered from its own text.
 *
 * The prompt forbids this explicitly and the model still does it occasionally, because
 * "the figure below" is how most textbook geometry is written. It is the single most
 * common way a generated question turns out to be unanswerable, and it is trivially
 * detectable.
 */
const FIGURE_WORDS = /\b(?:diagram|figure|fig\.|graph shown|image|picture|shown below|as shown|given below in the)\b/iu;

function inspectOne(candidate: GeneratedCandidate): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const text = candidate.questionText;
  const solution = candidate.solution ?? '';

  if (FIGURE_WORDS.test(text)) {
    warnings.push({
      code: 'figure_reference',
      message:
        'This refers to a diagram, figure or image. Questions are text and LaTeX only, so a student would have nothing to look at.',
    });
  }

  if (/\d/u.test(text) && !hasMathIsland(text)) {
    warnings.push({
      code: 'unformatted_maths',
      message: 'There are numbers here but no $…$ maths. Check the notation renders as you expect.',
    });
  }

  // A solution with no relation and barely any text is almost always a restatement of the
  // answer rather than a route to it — the failure the prompt asks against by name.
  if (solution.length > 0 && solution.length < 60 && !solution.includes('=')) {
    warnings.push({
      code: 'thin_solution',
      message: 'The solution is very short and shows no working. Check it explains how the answer is reached.',
    });
  }

  if (candidate.type === 'single_choice' || candidate.type === 'multiple_choice') {
    const bareTexts = candidate.options.map((option) => bare(option.text));
    // Exact duplicates are refused by the schema; this catches the same value written two
    // ways ("$x=3$" and "x = 3"), which is just as ambiguous to a student.
    if (new Set(bareTexts).size !== bareTexts.length) {
      warnings.push({
        code: 'equivalent_options',
        message: 'Two options say the same thing once notation and spacing are ignored.',
      });
    }

    const correct = candidate.options.filter((option) => option.isCorrect);
    const wrong = candidate.options.filter((option) => !option.isCorrect);
    if (correct.length === 1 && wrong.length >= 2) {
      const correctLength = correct[0]!.text.length;
      const averageWrong = wrong.reduce((total, option) => total + option.text.length, 0) / wrong.length;
      // The oldest tell in multiple choice: the answer is the one the author took care
      // over. A guessable question measures test-craft rather than mathematics.
      if (correctLength > 12 && correctLength > averageWrong * 1.6) {
        warnings.push({
          code: 'correct_option_longest',
          message: 'The correct option is much longer than the others, which makes it guessable without doing the maths.',
        });
      }
    }
  }

  if (candidate.type === 'numeric') {
    const answer = candidate.numericAnswer;
    const tolerance = candidate.tolerance ?? 0;
    if (answer !== null && tolerance > 0 && Math.abs(answer) > 0 && tolerance / Math.abs(answer) > 0.1) {
      warnings.push({
        code: 'loose_tolerance',
        message: `A tolerance of ${tolerance} on an answer of ${answer} accepts anything within 10%, which will mark wrong answers right.`,
      });
    }
    // Only the bare number is compared, so the unit and the rounding have to be asked for
    // in the text or two students with the same understanding get different marks.
    if (answer !== null && !Number.isInteger(answer) && !/round|decimal place|significant figure|nearest/iu.test(text)) {
      warnings.push({
        code: 'rounding_unstated',
        message: 'The answer is not a whole number but the question does not say how to round. Say so, or grading will be arbitrary.',
      });
    }
    if (answer !== null && solution.length > 0 && !solution.includes(String(answer))) {
      warnings.push({
        code: 'answer_absent_from_solution',
        message: `The solution never states ${answer}. Check the working actually arrives at the stored answer.`,
      });
    }
  }

  if (candidate.type === 'fill_blank') {
    if (!/_{2,}/u.test(text)) {
      warnings.push({
        code: 'blank_marker_missing',
        message: 'There is no ____ marking the blank, so a student cannot tell what is being asked for.',
      });
    }
    const first = candidate.acceptedAnswers[0];
    if (first && solution.length > 0 && !bare(solution).includes(bare(first))) {
      warnings.push({
        code: 'answer_absent_from_solution',
        message: `The solution never states "${first}". Check the working arrives at an accepted answer.`,
      });
    }
  }

  if (candidate.type === 'true_false' && /^\s*true\s*(?:or|\/)\s*false/iu.test(text)) {
    warnings.push({
      code: 'true_false_prefix',
      message: 'Drop the "True or False:" prefix — the runner already tells the student what kind of question this is.',
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Batch checks
// ---------------------------------------------------------------------------

/** Below this many single-answer questions, a repeated position is coincidence. */
const POSITION_BIAS_MIN_SAMPLE = 4;

/** Above this share in one position, it is a pattern a student would spot. */
const POSITION_BIAS_SHARE = 0.75;

function inspectBatch(candidates: GeneratedCandidate[]): QualityWarning[] {
  const warnings: QualityWarning[] = [];

  const positions = candidates
    .filter((candidate) => candidate.type === 'single_choice')
    .map((candidate) => candidate.options.findIndex((option) => option.isCorrect))
    .filter((index) => index >= 0);

  if (positions.length >= POSITION_BIAS_MIN_SAMPLE) {
    const counts = new Map<number, number>();
    for (const index of positions) counts.set(index, (counts.get(index) ?? 0) + 1);
    for (const [index, count] of counts) {
      if (count / positions.length >= POSITION_BIAS_SHARE) {
        warnings.push({
          code: 'answer_position_bias',
          message: `The correct answer is option ${String.fromCharCode(97 + index)} in ${count} of ${positions.length} questions. Shuffle a few before saving, or the paper is guessable.`,
        });
        break;
      }
    }
  }

  return warnings;
}

/**
 * Inspects a whole proposal.
 *
 * Returns one array of warnings per candidate, positionally, plus the batch-level ones —
 * never throws, never rejects, and an empty report is the normal case.
 */
export function inspectCandidates(candidates: GeneratedCandidate[]): QualityReport {
  return {
    perQuestion: candidates.map(inspectOne),
    batch: inspectBatch(candidates),
  };
}
