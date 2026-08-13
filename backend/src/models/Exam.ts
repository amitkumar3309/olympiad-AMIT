import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';

/**
 * The **official Olympiad sitting** — the thing the whole product is named after.
 *
 * ## Why this is a fourth collection, not a flag on `MockTest`
 *
 * The Practice Zone has no clock and may be repeated forever. A mock test is a
 * rehearsal: the author sets the clock and the window, and a student may sit it more
 * than once. An official exam is neither. It happens **once**, in a window the
 * organisers announce in advance, a student gets **one** attempt, and what comes out
 * of it is a published result carrying a rank — and a certificate.
 *
 * Expressing that as a `MockTest` with `maxAttempts: 1` would be a lie in a field:
 * every mock test would then be one settings-change away from minting certificates,
 * and CLAUDE.md's rule that a mock is not the exam would live only in a comment. The
 * separation is what makes "a certificate can only come from an official exam" true
 * in the schema rather than intended by a handler.
 *
 * ## The window is mandatory here
 *
 * `MockTest.availableFrom`/`availableTo` are nullable, meaning "as soon as published"
 * and "open indefinitely". For an official exam both are **required**: the timeline is
 * decided by the organisers and notified to students beforehand, so an exam with no
 * announced window is not an exam. Enforcement is still not here — it is
 * `ExamAttempt.expiresAt`, computed by the server when the attempt starts, that
 * actually holds the clock. Nothing about timing is ever taken from a client.
 *
 * ## Thresholds live on the paper
 *
 * `meritThresholdPercent` and `distinctionThresholdPercent` are per-exam rather than
 * global, because papers differ in difficulty and 60% on one is not 60% on another.
 * They are read once, at issuance, and **snapshotted onto the certificate** — so
 * re-tuning a threshold for next year cannot retroactively change what somebody's
 * certificate says they achieved.
 */

export const EXAM_STATUSES = ['draft', 'published', 'archived'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

/** The one status in which a student may sit. Kept here so no route re-states it. */
export const STUDENT_VISIBLE_EXAM_STATUSES: readonly ExamStatus[] = ['published'];

/**
 * One question on the paper, with the marks it carries **on this exam**.
 * Same shape as a mock test's, and for the same reason: the bank's own `marks` is a
 * default, not the authority.
 */
export interface ExamQuestionRef {
  question: Types.ObjectId;
  order: number;
  marks: number;
  negativeMarks: number;
}

export interface ExamDocument extends Document {
  title: string;
  /**
   * The human-facing paper code, e.g. `AMIT-2026-C9`. Unique, and printed on every
   * certificate issued for this exam so a holder can name the sitting.
   */
  examCode: string;
  description?: string | null;
  instructions?: string | null;
  classLevel: ClassLevel;
  questions: ExamQuestionRef[];
  durationMinutes: number;
  /** Sum of `questions[].marks`. Written by the service, never by a client. */
  totalMarks: number;
  /** The announced window. Both mandatory — see the note above. */
  opensAt: Date;
  closesAt: Date;
  status: ExamStatus;
  /**
   * Set when an administrator releases results. Until then no student sees a score,
   * a rank or a certificate, however long ago they sat the paper.
   */
  resultsPublishedAt?: Date | null;
  resultsPublishedBy?: string | null;
  /** Percentage at or above which a certificate is upgraded. Snapshotted at issuance. */
  meritThresholdPercent: number;
  distinctionThresholdPercent: number;
  createdBy?: Types.ObjectId | null;
  createdByLabel?: string | null;
  updatedBy?: Types.ObjectId | null;
  updatedByLabel?: string | null;
  publishedAt?: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const examQuestionSchema = new Schema<ExamQuestionRef>(
  {
    question: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    order: { type: Number, required: true, min: 1 },
    marks: { type: Number, required: true, min: 0.25, max: 100 },
    negativeMarks: { type: Number, required: true, min: 0, max: 100, default: 0 },
  },
  { _id: false },
);

const examSchema = new Schema<ExamDocument>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    examCode: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 40 },
    description: { type: String, default: null, trim: true, maxlength: 2000 },
    instructions: { type: String, default: null, trim: true, maxlength: 5000 },
    classLevel: { type: String, enum: CLASS_LEVELS, required: true, index: true },
    questions: { type: [examQuestionSchema], default: [] },
    durationMinutes: { type: Number, required: true, min: 1, max: 600 },
    totalMarks: { type: Number, required: true, min: 0, default: 0 },
    opensAt: { type: Date, required: true },
    closesAt: { type: Date, required: true },
    status: { type: String, enum: EXAM_STATUSES, default: 'draft', index: true },
    resultsPublishedAt: { type: Date, default: null },
    resultsPublishedBy: { type: String, default: null },
    meritThresholdPercent: { type: Number, required: true, min: 1, max: 100, default: 60 },
    distinctionThresholdPercent: { type: Number, required: true, min: 1, max: 100, default: 85 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    createdByLabel: { type: String, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    updatedByLabel: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The student listing is "published exams for my class, soonest window first"; the
// admin listing is "everything, newest first, optionally filtered by status".
examSchema.index({ status: 1, classLevel: 1, opensAt: 1 });
examSchema.index({ status: 1, createdAt: -1 });

export const Exam = mongoose.model<ExamDocument>('Exam', examSchema);
