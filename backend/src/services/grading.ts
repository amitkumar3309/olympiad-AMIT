import type { AttemptAnswerEntry } from '../models';

/**
 * The marking rules. **The only place in this codebase that decides whether an answer
 * is right**, for practice sessions and for mock tests alike.
 *
 * It lives on its own, and takes a plain snapshot entry rather than a document,
 * because of what it is: pure functions over the answer-key snapshot, with no
 * database access, no HTTP and no notion of which collection the entry came from.
 * That makes every rule below testable directly, and it means the mock-test grader
 * cannot drift from the practice grader — there is only one.
 *
 * These functions moved out of `practiceService.ts` in Milestone 7. Practice still
 * re-exports them, so its own callers and tests are unchanged.
 *
 * Nothing here ever runs in a browser. Grading is server-side in both surfaces,
 * which is what makes it safe never to send the client anything it could mark itself
 * with (see CLAUDE.md, "The answer key must never reach the client").
 */

/** True when the student has actually given a response of the right shape. */
export function isAnswered(entry: AttemptAnswerEntry): boolean {
  switch (entry.type) {
    case 'single_choice':
    case 'multiple_choice':
      return entry.selectedOptionKeys.length > 0;
    case 'true_false':
      return entry.booleanResponse !== null && entry.booleanResponse !== undefined;
    case 'numeric':
      return entry.numericResponse !== null && entry.numericResponse !== undefined;
  }
}

export interface GradeOutcome {
  answered: boolean;
  isCorrect: boolean;
  awardedMarks: number;
}

/**
 * Marks one answer.
 *
 * The rules, all deliberate:
 *  - **Unanswered scores zero and is never penalised.** A blank is not a wrong
 *    answer, and penalising it would push students to guess.
 *  - `multiple_choice` requires the **exact** set. No partial credit: with negative
 *    marking present, part-marks would need a second policy for how much to deduct
 *    for a partially-right answer, and the question bank has no field for it.
 *  - `numeric` compares within the question's own `tolerance`, defaulting to exact.
 *  - A wrong answer costs `negativeMarks`, which is 0 unless the author set it.
 *
 * Every figure comes from the snapshot on the entry, never from the live `Question`,
 * so editing or re-pricing a question cannot retroactively change a paper somebody
 * has already sat.
 */
export function gradeEntry(entry: AttemptAnswerEntry): GradeOutcome {
  if (!isAnswered(entry)) {
    return { answered: false, isCorrect: false, awardedMarks: 0 };
  }

  let isCorrect = false;

  switch (entry.type) {
    case 'single_choice': {
      const [chosen] = entry.selectedOptionKeys;
      isCorrect = chosen !== undefined && entry.correctOptionKeys.includes(chosen);
      break;
    }
    case 'multiple_choice': {
      const chosen = new Set(entry.selectedOptionKeys);
      const correct = new Set(entry.correctOptionKeys);
      isCorrect = chosen.size === correct.size && [...correct].every((key) => chosen.has(key));
      break;
    }
    case 'true_false': {
      isCorrect = entry.booleanResponse === entry.booleanAnswer;
      break;
    }
    case 'numeric': {
      const expected = entry.numericAnswer;
      const given = entry.numericResponse;
      if (expected === null || expected === undefined || given === null || given === undefined) {
        isCorrect = false;
      } else {
        isCorrect = Math.abs(given - expected) <= (entry.tolerance ?? 0);
      }
      break;
    }
  }

  return {
    answered: true,
    isCorrect,
    awardedMarks: isCorrect ? entry.marks : -entry.negativeMarks,
  };
}

/** The totals a graded set of entries produces. */
export interface ScoreTotals {
  score: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  accuracy: number;
}

/**
 * Grades every entry in place and returns the totals.
 *
 * Shared by both submission paths so the summary figures mean the same thing on a
 * practice review and on a mock-test result. In particular `accuracy` is correct as a
 * percentage of **answered** questions, not of served ones: skipping ten and getting
 * two of two right is 100% accurate on what was attempted, which is the number a
 * student can act on. The unanswered count travels beside it, so the picture is never
 * flattering by omission.
 */
export function gradeEntries(entries: AttemptAnswerEntry[]): ScoreTotals {
  let score = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;

  for (const entry of entries) {
    const outcome = gradeEntry(entry);
    entry.isCorrect = outcome.answered ? outcome.isCorrect : null;
    entry.awardedMarks = outcome.awardedMarks;
    score += outcome.awardedMarks;

    if (!outcome.answered) unansweredCount += 1;
    else if (outcome.isCorrect) correctCount += 1;
    else incorrectCount += 1;
  }

  const answered = correctCount + incorrectCount;

  return {
    score,
    correctCount,
    incorrectCount,
    unansweredCount,
    accuracy: answered === 0 ? 0 : Math.round((correctCount / answered) * 100),
  };
}
