import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';

/**
 * A mock test: an admin-authored, timed paper made of specific questions.
 *
 * ## How this differs from the two things either side of it
 *
 * The **Practice Zone** (Milestone 6) draws a random paper from whatever the student
 * chooses, has no clock and may be repeated without limit. The **official Olympiad**
 * is a single national sitting that produces a published result, a rank and a
 * certificate. A mock test sits between them and is its own thing: the *author*
 * chooses the questions, the *author* sets the clock and the window, and the student
 * gets a fixed number of attempts at a paper that is identical for everybody who
 * sits it. None of those three can be expressed as a variation of another without
 * one of them acquiring a field that lies about it, which is why this is a third
 * collection rather than a flag on an existing one (see DECISIONS.md).
 *
 * ## What is authored here versus computed
 *
 * Everything on this document is an editorial decision except `totalMarks`, which is
 * the sum of the per-question marks and is written by the service on every save. It
 * is stored rather than derived on read only because the student-facing listing shows
 * it for many tests at once and would otherwise have to load every paper's questions
 * to print one number.
 *
 * ## Timing lives here, enforcement does not
 *
 * This document says how long the test is (`durationMinutes`) and when it may be
 * sat (`availableFrom` / `availableTo`). It is `MockTestAttempt.expiresAt` — computed
 * by the server when an attempt starts — that is actually enforced. Nothing about the
 * clock is ever taken from a client.
 */

export const MOCK_TEST_STATUSES = ['draft', 'published', 'archived'] as const;
export type MockTestStatus = (typeof MOCK_TEST_STATUSES)[number];

/** The one status in which a student may sit a test. Kept here so no route re-states it. */
export const STUDENT_VISIBLE_TEST_STATUSES: readonly MockTestStatus[] = ['published'];

/**
 * When a student may see their **score**.
 *
 * Separate from `reviewPolicy` on purpose: showing a mark is a much smaller
 * disclosure than showing the answer key, and a competition commonly wants the first
 * immediately and the second only once nobody else can still be sitting the paper.
 */
export const RESULT_DISPLAY_MODES = [
  /** As soon as the attempt is submitted. */
  'immediate',
  /** Only once `availableTo` has passed, so no one still sitting can be told. */
  'after_close',
  /** Never through the student UI; staff read results from the admin side. */
  'hidden',
] as const;
export type ResultDisplayMode = (typeof RESULT_DISPLAY_MODES)[number];

/**
 * When a student may see the **correct answers and explanations**.
 *
 * `after_close` is the safe default for a real assessment: revealing the key while
 * the window is still open lets the first student who sits the paper hand the answers
 * to everyone who has not.
 */
export const REVIEW_POLICIES = ['immediate', 'after_close', 'never'] as const;
export type ReviewPolicy = (typeof REVIEW_POLICIES)[number];

/**
 * One question on the paper, with the marks it carries **on this test**.
 *
 * The marks are copied from the question when it is added and may then be overridden
 * by the author, because the same question can legitimately be worth 2 marks on a
 * quick quiz and 6 on a final. The question bank's own `marks` stays the default, not
 * the authority. `order` is stored explicitly rather than relying on array position,
 * so a reorder is a data change a client can send and the server can validate.
 */
export interface MockTestQuestionRef {
  question: Types.ObjectId;
  order: number;
  marks: number;
  negativeMarks: number;
}

export interface MockTestDocument extends Document {
  title: string;
  description?: string | null;
  /** Shown on the pre-start screen. Plain text with LaTeX islands, like a question. */
  instructions?: string | null;
  /** Which class the paper is for. A student may only sit their own class's tests. */
  classLevel: ClassLevel;
  questions: MockTestQuestionRef[];
  durationMinutes: number;
  /** Sum of `questions[].marks`. Written by the service, never by a client. */
  totalMarks: number;
  /** Null means "as soon as it is published". */
  availableFrom?: Date | null;
  /** Null means "open indefinitely". */
  availableTo?: Date | null;
  /** How many times one student may sit it. 1 by default — a mock test is an assessment. */
  maxAttempts: number;
  resultDisplay: ResultDisplayMode;
  reviewPolicy: ReviewPolicy;
  status: MockTestStatus;
  createdBy?: Types.ObjectId | null;
  createdByLabel?: string | null;
  updatedBy?: Types.ObjectId | null;
  updatedByLabel?: string | null;
  publishedAt?: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const mockTestQuestionSchema = new Schema<MockTestQuestionRef>(
  {
    question: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    order: { type: Number, required: true, min: 1 },
    marks: { type: Number, required: true, min: 0.25, max: 100 },
    negativeMarks: { type: Number, required: true, min: 0, max: 100, default: 0 },
  },
  { _id: false },
);

const mockTestSchema = new Schema<MockTestDocument>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: null, trim: true, maxlength: 2000 },
    instructions: { type: String, default: null, trim: true, maxlength: 5000 },
    classLevel: { type: String, enum: CLASS_LEVELS, required: true, index: true },
    questions: { type: [mockTestQuestionSchema], default: [] },
    durationMinutes: { type: Number, required: true, min: 1, max: 600 },
    totalMarks: { type: Number, required: true, min: 0, default: 0 },
    availableFrom: { type: Date, default: null },
    availableTo: { type: Date, default: null },
    maxAttempts: { type: Number, required: true, min: 1, max: 10, default: 1 },
    resultDisplay: { type: String, enum: RESULT_DISPLAY_MODES, default: 'immediate' },
    reviewPolicy: { type: String, enum: REVIEW_POLICIES, default: 'after_close' },
    status: { type: String, enum: MOCK_TEST_STATUSES, default: 'draft', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    createdByLabel: { type: String, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    updatedByLabel: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The student listing is "published tests for my class, soonest window first"; the
// admin listing is "everything, newest first, optionally filtered by status".
mockTestSchema.index({ status: 1, classLevel: 1, availableFrom: 1 });
mockTestSchema.index({ status: 1, createdAt: -1 });

export const MockTest = mongoose.model<MockTestDocument>('MockTest', mockTestSchema);
