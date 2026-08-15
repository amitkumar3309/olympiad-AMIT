import { Schema, type Types } from 'mongoose';
import { QUESTION_TYPES, type QuestionType } from './Question';

/**
 * One served question inside an attempt: the answer-key snapshot taken when it was
 * served, the student's response, and the grade it eventually earned.
 *
 * ## Why this shape is shared
 *
 * `PracticeSession` (Milestone 6) defined it first, and `MockTestAttempt`
 * (Milestone 7) needs exactly the same thing: the same four answer shapes, the same
 * snapshot-at-serve-time rule, the same three-part structure of key / response /
 * outcome. Copying it would mean two definitions of what "correct" looks like and
 * therefore, sooner or later, two graders that disagree — and a grader that
 * disagrees with the answer key is a marking bug that shows up as a student's wrong
 * score. One definition here, one grader in `services/grading.ts`, both used by both
 * collections.
 *
 * What is deliberately **not** shared is the surrounding document: a practice
 * session and a mock-test attempt differ in everything else (self-chosen filters
 * versus an admin-authored paper, untimed versus a server-enforced deadline,
 * unlimited versus a capped number of attempts), and they stay separate collections
 * for the reasons recorded in DECISIONS.md.
 *
 * ## The snapshot, and why it is duplicated data
 *
 * Each entry carries a **copy** of what counts as correct, and of the marks on
 * offer, taken at the moment the question was served. An author may edit, re-price
 * or archive a question while an attempt is open; grading against the live document
 * would mark a student against a paper they were never shown, or fail outright if
 * the answer shape changed. `revision` records which version was served, so a review
 * can say the question has since been edited rather than silently showing new text.
 *
 * The cost is that the answer key now exists in a second collection, so projection
 * discipline matters more, not less: **nothing in this shape may reach a client
 * before the attempt is finished and disclosure is permitted.** Both services build
 * explicit views for that reason and never return a raw document.
 */
export interface AttemptAnswerEntry {
  question: Types.ObjectId;
  /** Which revision of the question was served, so a later edit is detectable. */
  revision: number;
  type: QuestionType;
  /** Snapshot of the marks on offer, so re-pricing a question cannot rewrite a grade. */
  marks: number;
  negativeMarks: number;

  // --- Answer key, snapshotted at serve time. Never projected before reveal. ---
  /** Correct option keys for the two choice types; empty for the others. */
  correctOptionKeys: string[];
  booleanAnswer?: boolean | null;
  numericAnswer?: number | null;
  tolerance?: number | null;
  /** `fill_blank` only: every accepted spelling, snapshotted like the rest of the key. */
  acceptedAnswers: string[];

  // --- The student's response. ---
  /** Chosen option keys. Always an array, so `multiple_choice` needs no special case. */
  selectedOptionKeys: string[];
  numericResponse?: number | null;
  booleanResponse?: boolean | null;
  /** `fill_blank` only: what the student typed, stored verbatim. */
  textResponse?: string | null;
  answeredAt?: Date | null;

  // --- Grading outcome, written once at submission. ---
  isCorrect?: boolean | null;
  /** Marks actually awarded: `+marks`, `-negativeMarks`, or 0 if unanswered. */
  awardedMarks?: number | null;
}

/**
 * The sub-schema, shared by both attempt collections.
 *
 * A single `Schema` instance is safe to embed in more than one model — Mongoose
 * compiles it per parent — and sharing the instance is the point: it is the same
 * data, so a field added for one collection must exist in the other.
 */
export const attemptAnswerSchema = new Schema<AttemptAnswerEntry>(
  {
    question: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    revision: { type: Number, required: true, min: 1 },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    marks: { type: Number, required: true, min: 0 },
    negativeMarks: { type: Number, required: true, min: 0, default: 0 },

    correctOptionKeys: { type: [String], default: [] },
    booleanAnswer: { type: Boolean, default: null },
    numericAnswer: { type: Number, default: null },
    tolerance: { type: Number, default: null, min: 0 },
    acceptedAnswers: { type: [String], default: [] },

    selectedOptionKeys: { type: [String], default: [] },
    numericResponse: { type: Number, default: null },
    booleanResponse: { type: Boolean, default: null },
    // Stored verbatim, not normalised: what the student actually typed is the record,
    // and normalisation is the grader's business rather than the store's.
    textResponse: { type: String, default: null },
    answeredAt: { type: Date, default: null },

    isCorrect: { type: Boolean, default: null },
    awardedMarks: { type: Number, default: null },
  },
  { _id: false },
);
