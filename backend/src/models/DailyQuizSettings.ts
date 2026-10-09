import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { WINNER_RULES, type WinnerRule } from '../lib/dailyQuiz';

/**
 * The owner-editable Daily Quiz settings — one pinned document (Milestone 30, Phase 2).
 *
 * Business configuration, not a credential, so it lives in the database where the person
 * who decides it can change it and the audit trail can show who did — exactly the
 * reasoning `PaymentSettings` and `ReferralSettings` follow.
 *
 * ## Money is never invented
 *
 * `cashAmount` is **null by default**, and every surface says "cash prize" without a
 * figure until the owner sets one (brief §3, §7.4). A default of 0 would print "₹0 cash
 * prize", and any other default would be a promise nobody made.
 *
 * ## `instantResult`
 *
 * On (the default, the owner's request): a student sees Correct or Incorrect the moment
 * they submit — never *which* option was right, which stays locked until the reveal. Off:
 * even correctness waits for the reveal, and so does the XP, because paying 20 XP the
 * moment an answer lands would tell the student it was right. The brief keeps this switch
 * because instant feedback plus a cash prize makes answer-elimination with several
 * accounts possible (§6.7).
 *
 * ## `winnerRule` and `winnersPerQuiz` are retired
 *
 * They chose and counted each quiz's winners. Since 2026-10-09 the prize is monthly, one
 * winner per class band, by a rule fixed in code (`lib/dailyQuiz.ts`, PLAN.md Q24): nothing
 * reads them, the settings page no longer offers them, and they stay in the schema only so a
 * saved document still loads.
 */
export interface DailyQuizSettingsDocument extends Document {
  key: string;
  prizeHeadline: string;
  prizeText: string;
  /** In rupees. Null: "cash prize" with no figure. */
  cashAmount: number | null;
  winnerRule: WinnerRule;
  winnersPerQuiz: number;
  instantResult: boolean;
  updatedBy?: Types.ObjectId | null;
  updatedByLabel?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DAILY_QUIZ_SETTINGS_KEY = 'default';

/**
 * The headline every install had until the prize became monthly — no longer true, so a saved
 * document still carrying it is read as the new default (`getQuizSettings()`). Any headline an
 * administrator wrote themselves is left alone.
 */
export const RETIRED_PRIZE_HEADLINE = 'Solve daily. Win daily.';

/** The values in force when no settings document has been saved. One definition. */
export const DAILY_QUIZ_DEFAULTS = {
  prizeHeadline: 'Solve daily. Win every month.',
  prizeText: 'Surprise gift + cash prize',
  cashAmount: null as number | null,
  winnerRule: 'FASTEST_CORRECT' as WinnerRule,
  winnersPerQuiz: 1,
  instantResult: true,
};

const dailyQuizSettingsSchema = new Schema<DailyQuizSettingsDocument>(
  {
    key: { type: String, required: true, unique: true, default: DAILY_QUIZ_SETTINGS_KEY },
    prizeHeadline: { type: String, required: true, trim: true, maxlength: 80, default: DAILY_QUIZ_DEFAULTS.prizeHeadline },
    prizeText: { type: String, required: true, trim: true, maxlength: 120, default: DAILY_QUIZ_DEFAULTS.prizeText },
    cashAmount: { type: Number, default: null, min: 0, max: 100000 },
    winnerRule: { type: String, enum: WINNER_RULES, required: true, default: DAILY_QUIZ_DEFAULTS.winnerRule },
    winnersPerQuiz: { type: Number, required: true, min: 1, max: 5, default: DAILY_QUIZ_DEFAULTS.winnersPerQuiz },
    instantResult: { type: Boolean, required: true, default: DAILY_QUIZ_DEFAULTS.instantResult },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    updatedByLabel: { type: String, default: null },
  },
  { timestamps: true },
);

export const DailyQuizSettings = mongoose.model<DailyQuizSettingsDocument>('DailyQuizSettings', dailyQuizSettingsSchema);
