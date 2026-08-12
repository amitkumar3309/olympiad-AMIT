import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';
import type { DayKey } from '../lib/competitionDay';

/**
 * One day's challenge question for one class.
 *
 * ## Why this collection exists at all
 *
 * Before Milestone 8 the daily challenge was computed on the fly: hash the day key,
 * `skip` that many questions into the published bank, serve whatever came out. That
 * is deterministic *given a fixed bank* — and the bank is not fixed. Publishing a
 * single new question changes the total the modulus is taken against, so it silently
 * changes which question "today" resolves to, mid-day, for everybody. It also made
 * "what was the challenge on the 10th?" unanswerable, because the answer depended on
 * a bank that had since moved.
 *
 * A challenge is therefore **pinned to a document** the first time it is needed, and
 * every later read — and every attempt — refers to that document. The consequences
 * are the point: today's question cannot change under a student who is looking at it,
 * two students in the same class are provably answering the same thing, and the
 * history is a record rather than a re-derivation.
 *
 * ## Scheduled versus automatic
 *
 * `source` records how the day got its question:
 *
 *  - `scheduled` — staff chose it in advance through the admin UI. This is the
 *    intended path for a competition that wants to curate the run-up to an exam.
 *  - `automatic` — nobody scheduled one, so the deterministic pick was materialised
 *    on first request. This keeps the feature working every day without requiring
 *    somebody to sit down and schedule 365 questions, which is the realistic
 *    alternative to it quietly not working on a Sunday.
 *
 * Both are the same shape, because from the student's side they are the same thing.
 */

export const CHALLENGE_SOURCES = ['scheduled', 'automatic'] as const;
export type ChallengeSource = (typeof CHALLENGE_SOURCES)[number];

export interface DailyChallengeDocument extends Document {
  /** Competition-local calendar day (`YYYY-MM-DD`) — see `lib/competitionDay.ts`. */
  day: DayKey;
  classLevel: ClassLevel;
  question: Types.ObjectId;
  source: ChallengeSource;
  /**
   * The marks on offer, snapshotted when the day was pinned.
   *
   * Copied rather than read from the live `Question` for the same reason the attempt
   * snapshots its answer key: re-pricing a question must not change what a challenge
   * was worth to the students who already answered it, nor make two students on the
   * same day disagree about the score they were playing for.
   */
  marks: number;
  createdBy?: Types.ObjectId | null;
  createdByLabel?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const dailyChallengeSchema = new Schema<DailyChallengeDocument>(
  {
    day: { type: String, required: true },
    classLevel: { type: String, enum: CLASS_LEVELS, required: true },
    question: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    source: { type: String, enum: CHALLENGE_SOURCES, required: true, default: 'scheduled' },
    marks: { type: Number, required: true, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    createdByLabel: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * **One challenge per day per class**, enforced by the database rather than by the
 * code that looks first.
 *
 * This is what makes the automatic path safe: two students opening the dashboard at
 * the same moment both compute the same question (the pick is deterministic) and both
 * try to pin it. One insert wins, the other gets a duplicate-key error and re-reads
 * the winner's document — so the day still ends up with exactly one challenge, with
 * no transaction and no lock.
 */
dailyChallengeSchema.index({ day: 1, classLevel: 1 }, { unique: true });

// The admin listing reads a date range for one class, newest day first.
dailyChallengeSchema.index({ classLevel: 1, day: -1 });

/**
 * No TTL. A challenge is the question a cohort was actually set on a given day, and
 * an attempt refers to it — expiring it would orphan the attempts and erase what the
 * student was answering. Same reasoning as `AuditLog` and the attempt collections.
 */
export const DailyChallenge = mongoose.model<DailyChallengeDocument>('DailyChallenge', dailyChallengeSchema);
