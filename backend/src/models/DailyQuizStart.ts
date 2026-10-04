import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type { DayKey } from '../lib/competitionDay';

/**
 * A student pressed **Start** on a day's Daily Quiz (Milestone 30, Phase 2).
 *
 * ## Why a start is a record at all
 *
 * The launch brief measures a winner by **solve time**, and a solve time needs a starting
 * instant the student cannot choose. Pressing Start writes this document with the
 * server's clock; submitting later computes `submittedAt − startedAt` from it. Showing
 * the question only after Start is what makes that fair: nobody can read the question,
 * work it out, and *then* start the clock.
 *
 * ## Why not a `started` state on the attempt
 *
 * See `DailyChallengeAttempt`: a submission row still means "submitted", and six readers
 * rely on that. A start that is never followed by a submission is "Not submitted" — no
 * XP, no streak — and lives only here.
 *
 * ## One per student per day, by index
 *
 * The same `{student, day}` key as the attempt, for the same reason: a student who
 * changed class mid-day would otherwise face another class's quiz and could start (and
 * win) twice. Pressing Start again — a double click, a second tab, a retry — finds this
 * document and returns it, so the clock is never reset to give a better time.
 */
export interface DailyQuizStartDocument extends Document {
  /** The class document whose question was shown. Grading reads this, not the class. */
  challenge: Types.ObjectId;
  /** The quiz (all classes of it). */
  groupId: Types.ObjectId;
  student: Types.ObjectId;
  day: DayKey;
  startedAt: Date;
  /** The opaque option ids in the order this student sees them. Fixed at Start. */
  optionOrder: string[];
  ipHash?: string | null;
  userAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const dailyQuizStartSchema = new Schema<DailyQuizStartDocument>(
  {
    challenge: { type: Schema.Types.ObjectId, ref: 'DailyChallenge', required: true },
    groupId: { type: Schema.Types.ObjectId, required: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    day: { type: String, required: true },
    startedAt: { type: Date, required: true },
    optionOrder: { type: [String], default: [] },
    ipHash: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true },
);

/** One start per student per day. The clock cannot be restarted for a better time. */
dailyQuizStartSchema.index({ student: 1, day: 1 }, { unique: true });

// The per-quiz figures (how many started) and the reset.
dailyQuizStartSchema.index({ groupId: 1 });

/** No TTL: a start that was never submitted is what "Not submitted" in a history means. */
export const DailyQuizStart = mongoose.model<DailyQuizStartDocument>('DailyQuizStart', dailyQuizStartSchema);
