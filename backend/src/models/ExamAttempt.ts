import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { attemptAnswerSchema, type AttemptAnswerEntry } from './attemptAnswer';

/**
 * One student's single sitting of an official exam.
 *
 * ## This is a rewrite (Milestone 13)
 *
 * The previous version predated Milestone 4 and was never written by any route. It
 * carried `studentId` as a plain string, `answers` as `{ questionId, selectedOption }`
 * and no answer-key snapshot at all — a shape that could not be graded by the
 * grader this codebase now has, and could not survive a question being edited after
 * the paper was served. There were no documents to migrate, because nothing had ever
 * created one. See DECISIONS.md.
 *
 * ## One attempt, enforced by the database
 *
 * `maxAttempts` does not exist here. An official sitting happens once, so
 * `{ exam, student }` is **uniquely indexed** — a second attempt is a duplicate-key
 * error rather than a count a handler has to remember to check. That matters because
 * on a serverless platform a read and its write can land in different invocations,
 * so "count the attempts, then insert" has a race that a unique index does not.
 *
 * ## The server owns the clock
 *
 * `expiresAt` is computed and stored when the attempt is created and **never
 * recomputed**. No request body may carry a time, an elapsed duration or a deadline.
 * An answer arriving after the deadline is refused and not stored; a late submission
 * is graded as at the deadline. A countdown in the browser is a display derived from
 * `secondsRemaining`, never an input.
 *
 * ## The answer key is snapshotted
 *
 * `questions[]` is the shared `attemptAnswer` subdocument, carrying the key as it was
 * when the paper was served. Grading reads that snapshot, not the live `Question`, so
 * editing or re-pricing a question cannot retroactively change a paper somebody has
 * already sat. **Nothing in this shape may reach a client before results are
 * published** — the routes build explicit views and never return a raw document.
 */

export const EXAM_ATTEMPT_STATUSES = ['in_progress', 'submitted'] as const;
export type ExamAttemptStatus = (typeof EXAM_ATTEMPT_STATUSES)[number];

/**
 * There is deliberately no `expired` status. An attempt whose time ran out is graded
 * exactly like a submitted one — it is finished, not void. `submissionReason` records
 * which of the two it was.
 */
export const EXAM_SUBMISSION_REASONS = ['manual', 'time_expired'] as const;
export type ExamSubmissionReason = (typeof EXAM_SUBMISSION_REASONS)[number];

export interface ExamAttemptDocument extends Document {
  exam: Types.ObjectId;
  student: Types.ObjectId;
  status: ExamAttemptStatus;

  /** The paper as served, each entry carrying its own answer-key snapshot. */
  questions: AttemptAnswerEntry[];
  totalQuestions: number;
  /** Sum of the snapshotted `marks`: the best possible score for this attempt. */
  maxMarks: number;
  /** The duration in force when the attempt began, for the record. */
  durationMinutes: number;

  // --- Set at submission. ---
  /** Sum of `awardedMarks`. **May be negative** where negative marking applies. */
  score: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  /** Correct as a percentage of *answered*, not of served. 0 when none answered. */
  accuracy: number;

  startedAt: Date;
  /** The hard deadline. Authoritative; see the note above. */
  expiresAt: Date;
  submittedAt?: Date | null;
  /** Wall-clock seconds from start to submission, capped by the deadline. */
  timeTakenSeconds: number;
  submissionReason?: ExamSubmissionReason | null;

  createdAt: Date;
  updatedAt: Date;
}

const examAttemptSchema = new Schema<ExamAttemptDocument>(
  {
    exam: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    status: { type: String, enum: EXAM_ATTEMPT_STATUSES, default: 'in_progress', index: true },

    questions: { type: [attemptAnswerSchema], default: [] },
    totalQuestions: { type: Number, required: true, min: 0, default: 0 },
    maxMarks: { type: Number, required: true, min: 0, default: 0 },
    durationMinutes: { type: Number, required: true, min: 1 },

    score: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    incorrectCount: { type: Number, default: 0 },
    unansweredCount: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },

    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    timeTakenSeconds: { type: Number, default: 0 },
    submissionReason: { type: String, enum: EXAM_SUBMISSION_REASONS, default: null },
  },
  { timestamps: true },
);

/**
 * **One attempt per student per exam**, guaranteed here rather than by a handler that
 * counts first. This is the difference between a mock test and the official sitting.
 */
examAttemptSchema.index({ exam: 1, student: 1 }, { unique: true });

/** Ranking reads "submitted attempts for this exam, best score first". */
examAttemptSchema.index({ exam: 1, status: 1, score: -1 });

export const ExamAttempt = mongoose.model<ExamAttemptDocument>('ExamAttempt', examAttemptSchema);
