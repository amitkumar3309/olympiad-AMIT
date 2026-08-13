import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * A **published** result for one student's official exam attempt.
 *
 * ## This is a rewrite (Milestone 13)
 *
 * The previous version predated the current models and was never written: it keyed on
 * a string `studentId`, referenced an `examId` string for an `Exam` collection that
 * did not exist, and carried a `badges: string[]` nothing populated. There were no
 * documents to migrate. See DECISIONS.md.
 *
 * ## Why this exists at all, when the attempt already has the score
 *
 * Two reasons, and both are about **release**.
 *
 * A score exists the moment an attempt is graded, but a *result* is an announcement.
 * Ranks cannot be computed until the window has closed and everybody who is going to
 * sit the paper has sat it, and the organisers decide when to release them. So this
 * row is created by the publication step, not by submission — and `isPublished` gates
 * every student-facing read. An attempt with no `Result` is a paper that has been sat
 * and not yet announced, which is a real and common state.
 *
 * Second, rank and percentile are **cohort facts**, not attempt facts. They are true
 * only relative to a particular set of candidates at a particular moment, so they are
 * stored once at publication rather than recomputed on every read — otherwise a
 * student's rank would silently change if a late attempt were ever graded.
 */
export interface ResultDocument extends Document {
  exam: Types.ObjectId;
  student: Types.ObjectId;
  attempt: Types.ObjectId;

  /** Copied from the attempt at publication, so a result reads standalone. */
  score: number;
  maxMarks: number;
  /** `score / maxMarks * 100`, rounded to one decimal. The basis for a certificate tier. */
  percentage: number;
  accuracy: number;

  /**
   * Position within this exam's submitted attempts, best first. Equal scores share a
   * rank (standard competition ranking), the same rule the leaderboard uses.
   */
  rank: number;
  totalCandidates: number;
  /** Percentage of candidates this student scored at least as well as, 0–100. */
  percentile: number;

  isPublished: boolean;
  publishedAt?: Date | null;
  publishedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const resultSchema = new Schema<ResultDocument>(
  {
    exam: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    attempt: { type: Schema.Types.ObjectId, ref: 'ExamAttempt', required: true },

    score: { type: Number, required: true },
    maxMarks: { type: Number, required: true, min: 0 },
    percentage: { type: Number, required: true },
    accuracy: { type: Number, required: true, default: 0 },

    rank: { type: Number, required: true, min: 1 },
    totalCandidates: { type: Number, required: true, min: 1 },
    percentile: { type: Number, required: true, min: 0, max: 100 },

    isPublished: { type: Boolean, default: false, index: true },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: String, default: null },
  },
  { timestamps: true },
);

/** One result per student per exam. Republishing updates the row rather than adding one. */
resultSchema.index({ exam: 1, student: 1 }, { unique: true });

export const Result = mongoose.model<ResultDocument>('Result', resultSchema);
