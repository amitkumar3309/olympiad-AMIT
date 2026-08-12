import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type { DayKey } from '../lib/competitionDay';
import { attemptAnswerSchema, type AttemptAnswerEntry } from './attemptAnswer';

/**
 * One student's answer to one day's challenge.
 *
 * ## One shot, and no in-progress state
 *
 * A challenge is a single question, so unlike a practice session or a mock test there
 * is nothing to save half-way through: the document is created *by* the submission.
 * That removes a whole class of state to get wrong — there is no attempt that can be
 * resumed, abandoned, or left open across a day boundary — and it is why this
 * collection has no `status` field. If a row exists, the student answered.
 *
 * ## The reward guard
 *
 * The unique index on `{student, day}` is what makes "one challenge, one reward per
 * day" true in the database rather than intended by the handler that checks first. It
 * matters more here than anywhere else in the product, because the daily challenge is
 * the one feature whose whole purpose is a repeatable daily reward — so a second
 * submission must be impossible rather than merely discouraged. `recordActivity()`
 * independently caps the XP at once per competition day, so the reward is guarded
 * twice over by two different unique indexes.
 *
 * Keying on the **day** rather than on the challenge id is deliberate: a student who
 * changed class mid-day would otherwise face a different challenge document and be
 * able to claim a second reward for the same calendar day.
 *
 * ## The day is the competition's day
 *
 * `day` is an IST calendar day (`lib/competitionDay.ts`), copied from the challenge
 * being answered. Two submissions two minutes apart across IST midnight are two
 * different days and both count — which is correct, and is what the boundary tests
 * pin down.
 */
export interface DailyChallengeAttemptDocument extends Document {
  challenge: Types.ObjectId;
  student: Types.ObjectId;
  day: DayKey;
  /**
   * The single answered question: the answer-key snapshot taken when it was served,
   * the student's response, and the grade. The same shared shape the practice and
   * mock-test attempts embed, so the same one grader marks all three.
   */
  answer: AttemptAnswerEntry;
  /**
   * What the submission earned, copied from the activity award at the time.
   *
   * `StudentActivity` remains the single source of truth for a student's XP total —
   * this is a record of what *this* attempt was worth, so the result screen and the
   * history can explain themselves without re-deriving anything. It is 0 for a
   * submission that earned nothing because the day's reward was already claimed.
   */
  xpAwarded: number;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const dailyChallengeAttemptSchema = new Schema<DailyChallengeAttemptDocument>(
  {
    challenge: { type: Schema.Types.ObjectId, ref: 'DailyChallenge', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    day: { type: String, required: true },
    answer: { type: attemptAnswerSchema, required: true },
    xpAwarded: { type: Number, required: true, min: 0, default: 0 },
    submittedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

/** The reward guard. See the note above — this is the important line in this file. */
dailyChallengeAttemptSchema.index({ student: 1, day: 1 }, { unique: true });

// The student's own history, newest first, and the per-challenge admin figures.
dailyChallengeAttemptSchema.index({ student: 1, day: -1 });
dailyChallengeAttemptSchema.index({ challenge: 1 });

/**
 * No TTL, like every other record of work a student really did. Expiring these would
 * also silently shorten a challenge streak the student had actually kept.
 */
export const DailyChallengeAttempt = mongoose.model<DailyChallengeAttemptDocument>(
  'DailyChallengeAttempt',
  dailyChallengeAttemptSchema,
);
