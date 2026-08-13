import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { attemptAnswerSchema, type AttemptAnswerEntry } from './attemptAnswer';

/**
 * One student's sitting of one mock test.
 *
 * Modelled on `PracticeSession`, which already solved the hard parts — the
 * answer-key snapshot, per-question outcome persistence, an owner-scoped query — and
 * adds the three things an *assessment* needs and self-directed practice does not.
 *
 * ## 1. A server-computed deadline
 *
 * `expiresAt` is written when the attempt is created: `startedAt + duration`, clamped
 * to the test's own closing time. It is the only clock that counts. The browser also
 * runs a countdown, because a student needs to see the time remaining, but that
 * countdown is a *display* — it is derived from `expiresAt`, it is never sent back,
 * and nothing in the grading path reads a client-supplied time. A tampered or simply
 * wrong client clock therefore changes nothing: an answer arriving after `expiresAt`
 * is refused, and the attempt is graded as at the deadline, not as at the moment the
 * server happened to notice.
 *
 * This is the reason the deadline is stored rather than recomputed from the test on
 * each request. An author may extend or shorten `durationMinutes` while somebody is
 * mid-paper; recomputing would silently move the finishing line of an attempt already
 * under way, in either direction.
 *
 * ## 2. Exactly one submission
 *
 * Two independent mechanisms, because this is the property most worth being sure of:
 *
 *  - **Grading is a guarded write.** The submit path closes the attempt with an
 *    update conditional on `status: 'in_progress'`, so of two concurrent submissions
 *    exactly one can win; the loser finds the attempt already graded and is answered
 *    with the existing result rather than re-grading it.
 *  - **A unique index** on `{test, student, attemptNumber}` means two requests racing
 *    to *start* an attempt cannot both create one. The loser gets a duplicate-key
 *    error and resumes the attempt that won.
 *
 * ## 3. Disclosure is the test's decision, not the attempt's
 *
 * The attempt records what happened; whether the student may *see* it is read from
 * the test's `resultDisplay` / `reviewPolicy` at request time and deliberately **not**
 * snapshotted here. An administrator must be able to release results after the window
 * closes, or withdraw a review they released early, and a snapshot would freeze that
 * decision at the moment of submission.
 */

export const MOCK_ATTEMPT_STATUSES = ['in_progress', 'submitted'] as const;
export type MockAttemptStatus = (typeof MOCK_ATTEMPT_STATUSES)[number];

/**
 * Why the attempt closed.
 *
 * There is deliberately no `expired` *status*: an attempt whose time ran out is
 * graded exactly like one the student submitted, on the answers they had saved. It is
 * finished, not void. Recording the reason keeps the distinction visible — to the
 * student on their result, and to staff reading the results table — without creating
 * a second kind of finished attempt that every query would have to remember.
 */
export const SUBMISSION_REASONS = ['manual', 'time_expired'] as const;
export type SubmissionReason = (typeof SUBMISSION_REASONS)[number];

export interface MockTestAttemptDocument extends Document {
  test: Types.ObjectId;
  student: Types.ObjectId;
  /** 1 for a student's first sitting of this test. Bounded by the test's `maxAttempts`. */
  attemptNumber: number;
  status: MockAttemptStatus;

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
  submissionReason?: SubmissionReason | null;

  createdAt: Date;
  updatedAt: Date;
}

const mockTestAttemptSchema = new Schema<MockTestAttemptDocument>(
  {
    test: { type: Schema.Types.ObjectId, ref: 'MockTest', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    attemptNumber: { type: Number, required: true, min: 1 },
    status: { type: String, enum: MOCK_ATTEMPT_STATUSES, default: 'in_progress', index: true },

    questions: { type: [attemptAnswerSchema], default: [] },
    totalQuestions: { type: Number, required: true, min: 1 },
    maxMarks: { type: Number, required: true, min: 0 },
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
    submissionReason: { type: String, enum: SUBMISSION_REASONS, default: null },
  },
  { timestamps: true },
);

/**
 * The rule that makes "one attempt per student per sitting" true in the database
 * rather than merely intended by the handler that counts them. Two requests racing to
 * start the same numbered attempt cannot both succeed; `startAttempt()` treats the
 * duplicate-key error as "somebody already started this one" and resumes it.
 */
mockTestAttemptSchema.index({ test: 1, student: 1, attemptNumber: 1 }, { unique: true });

// A student's own history, newest first.
mockTestAttemptSchema.index({ student: 1, startedAt: -1 });
/**
 * A student's own **submitted** attempts in submission order — added in Milestone 15
 * for analytics, which reads exactly that and nothing else.
 *
 * The index above cannot serve it: `{student, startedAt}` narrows to the student but
 * then has to fetch and discard every unfinished attempt, and returns them in the wrong
 * order for a progress trend, which is chronological by *submission*.
 */
mockTestAttemptSchema.index({ student: 1, status: 1, submittedAt: 1 });
// The admin results table for one test, and the lazy sweep for expired attempts.
mockTestAttemptSchema.index({ test: 1, status: 1, score: -1 });

/**
 * Deliberately **no TTL index**, for the same reason as `PracticeSession`,
 * `StudentActivity` and `AuditLog`: this is the record of an assessment a student
 * actually sat. Expiring it would delete the evidence behind their result.
 */
export const MockTestAttempt = mongoose.model<MockTestAttemptDocument>('MockTestAttempt', mockTestAttemptSchema);
