import type { Types } from 'mongoose';
import type { QuestionDocument } from '../models';
import type { AttemptAnswerEntry } from '../models/attemptAnswer';

/**
 * How a question becomes an entry on a served paper.
 *
 * Extracted from `mockTestService.ts` in Milestone 13, when the official exam became
 * a second surface that serves papers. Sharing it is not merely tidiness: this
 * function is the **answer-key snapshot**, and it is what makes "editing a question
 * cannot retroactively change a paper somebody has already sat" true. A second copy
 * is how one surface ends up snapshotting a field the other has since added — and a
 * missing key field means a wrong mark on a student's report.
 *
 * There is exactly one grader (`services/grading.ts`) reading this one shape, and now
 * exactly one place that produces it.
 */

/** What a paper says a question is worth, which may differ from the bank's default. */
export interface PricedQuestionRef {
  question: Types.ObjectId;
  order: number;
  marks: number;
  negativeMarks: number;
}

export function snapshotOf(question: QuestionDocument, ref: PricedQuestionRef): AttemptAnswerEntry {
  return {
    question: question._id as Types.ObjectId,
    revision: question.revision,
    type: question.type,
    // The paper's marks, not the bank's: a paper may re-price a question, and the
    // attempt must be graded against what the student was actually offered.
    marks: ref.marks,
    negativeMarks: ref.negativeMarks,
    correctOptionKeys: question.options.filter((option) => option.isCorrect).map((option) => option.key),
    booleanAnswer: question.booleanAnswer ?? null,
    numericAnswer: question.numericAnswer ?? null,
    tolerance: question.tolerance ?? null,
    selectedOptionKeys: [],
    numericResponse: null,
    booleanResponse: null,
    answeredAt: null,
    isCorrect: null,
    awardedMarks: null,
  };
}
