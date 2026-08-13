import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type { DayKey } from '../lib/competitionDay';

/**
 * The kinds of real student event this platform records.
 *
 * Closed list, like `AUDIT_ACTIONS`, so the feed stays queryable and so nothing
 * can quietly start awarding XP for an event nobody defined. Each type's XP value
 * lives in `lib/xp.ts`.
 *
 * Every one of these corresponds to something the student actually did. There is
 * still deliberately no `exam_submitted`, because no *official* exam is recorded
 * anywhere in this codebase — `practice_completed` (Milestone 6) is a genuinely
 * different event and must not be conflated with sitting the Olympiad.
 */
export const ACTIVITY_TYPES = [
  /** The account was registered. Once per account, for the lifetime of the account. */
  'account_created',
  /** The email address was confirmed through a real single-use link. Once per account. */
  'email_verified',
  /** The student opened their dashboard on this competition day. Once per day. */
  'daily_visit',
  /** Profile details were edited. Repeatable. */
  'profile_updated',
  /** The profile photo was replaced. Repeatable. */
  'photo_updated',
  /** The password was changed from the account settings. Repeatable. */
  'password_changed',
  /**
   * A practice session was submitted and graded (Milestone 6). **Once per day**,
   * deliberately — see the ADR in DECISIONS.md. Paying per session would make XP
   * farmable by starting and submitting empty sessions in a loop, and paying per
   * correct answer would need a separate daily cap to achieve the same thing. Extra
   * sessions on the same day are still recorded in full as `PracticeSession`
   * documents; they simply do not multiply XP.
   */
  'practice_completed',
  /**
   * A mock test was submitted and graded (Milestone 7). **Once per day**, for the
   * same anti-farming reason as `practice_completed`, and worth more because a mock
   * test is a timed assessment on an author-set paper rather than a self-chosen
   * warm-up. Still not `exam_submitted`: the official Olympiad is a different event
   * and must not be conflated with a mock (see DECISIONS.md).
   */
  'mock_test_completed',
  /**
   * The day's challenge was answered and graded (Milestone 8). **Once per day** — and
   * here that is not merely anti-farming policy but the definition of the feature: a
   * daily challenge that could be answered twice for twice the reward would not be a
   * daily challenge. Guarded twice over, by this dedupe key and by the unique index on
   * `DailyChallengeAttempt {student, day}`.
   */
  'daily_challenge_completed',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * How often a given type may legitimately occur. This drives the deduplication
 * key, and therefore the unique index, so the *database* is what stops a second
 * `daily_visit` for the same day rather than a check that a future caller could
 * forget to perform.
 */
export const ONCE_PER_ACCOUNT: readonly ActivityType[] = ['account_created', 'email_verified'];
export const ONCE_PER_DAY: readonly ActivityType[] = [
  'daily_visit',
  'practice_completed',
  'mock_test_completed',
  'daily_challenge_completed',
];

export interface StudentActivityDocument extends Document {
  student: Types.ObjectId;
  type: ActivityType;
  /**
   * XP this event was worth **when it happened**, copied from `XP_AWARDS` at write
   * time rather than looked up on read. Re-pricing an event later must not silently
   * restate what students already earned, so history stays true the same way
   * `AuditLog.actorRole` does.
   */
  xpAwarded: number;
  /** Competition-local calendar day (`YYYY-MM-DD`) — see `lib/competitionDay.ts`. */
  occurredOn: DayKey;
  /**
   * Uniqueness token, or absent for a freely repeatable event:
   *  - `'once'` for a once-per-account type,
   *  - the day key for a once-per-day type,
   *  - **unset** for a repeatable type, which excludes the document from the
   *    partial unique index below.
   */
  dedupeKey?: string;
  /** Short human-readable detail for the feed, e.g. `Class 9 → Class 10`. */
  detail?: string | null;
  createdAt: Date;
}

const studentActivitySchema = new Schema<StudentActivityDocument>({
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  type: { type: String, enum: ACTIVITY_TYPES, required: true },
  xpAwarded: { type: Number, required: true, min: 0 },
  occurredOn: { type: String, required: true },
  // No `default: null` — the field must be genuinely absent for a repeatable
  // event, because the unique index below is partial on its existence. A stored
  // null would make every repeatable event collide with the previous one.
  dedupeKey: { type: String },
  detail: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

// The feed and the XP/streak derivations all read one student's rows newest-first.
studentActivitySchema.index({ student: 1, createdAt: -1 });
// Backs the distinct-days query the streak is computed from.
studentActivitySchema.index({ student: 1, occurredOn: -1 });
/**
 * Backs the **period** leaderboards (Milestone 10), which narrow the whole collection
 * to a window of competition days before grouping — `occurredOn` leading, with no
 * student, so the compound index above cannot serve them. Cheap to keep: this is an
 * append-only log with one small string field indexed.
 */
studentActivitySchema.index({ occurredOn: -1 });

/**
 * The rule that makes "once per day" and "once per account" true rather than
 * merely intended.
 *
 * **Partial**, on the existence of `dedupeKey`, so it constrains exactly the
 * events that are supposed to be constrained and leaves repeatable ones alone. A
 * plain unique index would forbid a student from ever editing their profile twice;
 * a `sparse` compound index would not work either, since sparse only skips a
 * document missing *every* indexed field, and these documents always have
 * `student` and `type`.
 *
 * `recordActivity()` relies on this: it inserts and treats a duplicate-key error
 * as "already recorded today", which is race-free in a way a read-then-write check
 * across two serverless invocations would not be.
 */
studentActivitySchema.index(
  { student: 1, type: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $exists: true } } },
);

/**
 * Deliberately **no TTL index**. This log is the sole source of truth for XP,
 * levels, streaks and achievements: expiring a row would silently take points
 * away from a student who earned them. `AuditLog` is kept forever for the same
 * class of reason.
 */
export const StudentActivity = mongoose.model<StudentActivityDocument>('StudentActivity', studentActivitySchema);
