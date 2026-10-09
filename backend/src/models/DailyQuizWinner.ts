import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type { DayKey, MonthKey } from '../lib/competitionDay';
import { WINNER_RULES, type PrizeBandKey, type WinnerRule } from '../lib/dailyQuiz';

/**
 * A candidate for, or the winner of, a Daily Quiz prize (Milestone 30, Phase 2) — since
 * 2026-10-09 **one month's prize in one class band** (PLAN.md Q24): `period: 'month'`, with
 * `month`, `band` and `correctCount`. Rows from before have no `period` and were one quiz's
 * prize; they stay readable — the prize desk still tracks getting their prizes delivered —
 * and nothing writes them any more.
 *
 * ## A month's row, in the fields a quiz's row already had
 *
 *  - `groupId` is a key derived from the month and the band (`monthGroupId()`), so the
 *    unique `{groupId, student}` index still means "one row per student per prize";
 *  - `day` is the month's last day, `classMin`/`classMax` the band's;
 *  - `attempt` and `submittedAt` are the student's **last** correct answer that month;
 *  - `solveTimeMs` is the **total** solve time over the month's correct answers;
 *  - `sharedIpCount` counts the other students who answered from a connection they did.
 *
 * ## The lifecycle, and why nothing is public until a person says so
 *
 *   provisional → confirmed → published
 *        └────────→ disqualified (with a reason), from provisional or confirmed
 *
 *  - **provisional** — "Work out candidates" ranks the month's eligible students by the
 *    rule and writes the leading few here. Nobody sees these but staff.
 *  - **confirmed** — an administrator has checked the candidate (the profile, the
 *    shared-connection flag, a call to the parent) and chosen them.
 *  - **published** — announced: listed in the public Rewards section and told on their
 *    dashboard. `contactedAt` / `deliveredAt` then track getting the prize to them.
 *  - **disqualified** — kept, with the reason, so a recompute never offers the same
 *    student again and the trail says why they were passed over.
 *
 * Real money is involved, so every transition is an audited administrative act and a
 * conditional write (`status` in the filter), never an automatic consequence of a
 * computation.
 *
 * ## The prize is snapshotted at confirmation
 *
 * `prizeText` and `cashAmount` are copied from the settings when the winner is confirmed,
 * like an invoice's amount: changing tomorrow's prize must not rewrite what yesterday's
 * winner was told they had won.
 */

export const WINNER_STATUSES = ['provisional', 'confirmed', 'published', 'disqualified'] as const;
export type WinnerStatus = (typeof WINNER_STATUSES)[number];

/** What a row was the prize of. Absent on rows from before the monthly prize: one quiz. */
export const WINNER_PERIODS = ['quiz', 'month'] as const;
export type WinnerPeriod = (typeof WINNER_PERIODS)[number];

export interface DailyQuizWinnerDocument extends Document {
  period?: WinnerPeriod | null;
  /** A month's prize: which month, and which class band. */
  month?: MonthKey | null;
  band?: PrizeBandKey | null;
  /** A month's prize: the Daily Quizzes this student answered correctly that month, in the band. */
  correctCount?: number | null;
  groupId: Types.ObjectId;
  day: DayKey;
  classMin: number;
  classMax: number;
  student: Types.ObjectId;
  attempt: Types.ObjectId;
  /** Position in the computed order — 1 is the leading candidate. */
  rank: number;
  ruleUsed: WinnerRule;
  status: WinnerStatus;
  /** Required to disqualify. */
  reason?: string | null;
  solveTimeMs?: number | null;
  submittedAt: Date;
  /** Other correct answers in this quiz from the same connection — a prompt, not a verdict. */
  sharedIpCount: number;
  prizeText?: string | null;
  cashAmount?: number | null;
  decidedBy?: Types.ObjectId | null;
  decidedByLabel?: string | null;
  confirmedAt?: Date | null;
  publishedAt?: Date | null;
  contactedAt?: Date | null;
  deliveredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const dailyQuizWinnerSchema = new Schema<DailyQuizWinnerDocument>(
  {
    period: { type: String, enum: WINNER_PERIODS, default: undefined },
    month: { type: String, default: undefined },
    band: { type: String, default: undefined },
    correctCount: { type: Number, default: undefined, min: 0 },
    groupId: { type: Schema.Types.ObjectId, required: true },
    day: { type: String, required: true },
    classMin: { type: Number, required: true, min: 3, max: 12 },
    classMax: { type: Number, required: true, min: 3, max: 12 },
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    attempt: { type: Schema.Types.ObjectId, ref: 'DailyChallengeAttempt', required: true },
    rank: { type: Number, required: true, min: 1 },
    ruleUsed: { type: String, enum: WINNER_RULES, required: true },
    status: { type: String, enum: WINNER_STATUSES, required: true, default: 'provisional' },
    reason: { type: String, default: null, maxlength: 500 },
    solveTimeMs: { type: Number, default: null },
    submittedAt: { type: Date, required: true },
    sharedIpCount: { type: Number, default: 0, min: 0 },
    prizeText: { type: String, default: null },
    cashAmount: { type: Number, default: null, min: 0 },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    decidedByLabel: { type: String, default: null },
    confirmedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    contactedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** One row per student per prize — a recompute updates a candidate rather than adding one. */
dailyQuizWinnerSchema.index({ groupId: 1, student: 1 }, { unique: true });

// A month's rows, band by band, for the monthly winners page.
dailyQuizWinnerSchema.index({ month: 1, band: 1, rank: 1 });

// The public "recent winners" list, newest first.
dailyQuizWinnerSchema.index({ status: 1, publishedAt: -1 });

// A student's own wins, for their history.
dailyQuizWinnerSchema.index({ student: 1, status: 1 });

/**
 * No TTL, and the content reset does not delete these either: a winner is a record that a
 * child was promised a prize, which outlives any question bank.
 */
export const DailyQuizWinner = mongoose.model<DailyQuizWinnerDocument>('DailyQuizWinner', dailyQuizWinnerSchema);
