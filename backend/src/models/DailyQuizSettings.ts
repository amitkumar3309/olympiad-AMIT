import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { WINNER_RULES, type WinnerRule } from '../lib/dailyQuiz';
import type { DayKey } from '../lib/competitionDay';

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
 *
 * ## Reminders (Milestone 30 Phase 7b, PLAN.md Q20)
 *
 * `remindersEnabled` is the programme's switch — **on** by default, because each student
 * still has to turn reminders on for themselves, so the switch sends nothing on its own. It
 * exists for the day the provider's quota is needed for something else. `reminderDailyCap`
 * keeps the 7:00 AM batch inside that quota: Brevo's free plan is 300 emails a day **for
 * everything**, verification links included, so the default is a third of it and the ceiling
 * is all of it. `lastReminderRun` is written by the job, not by a person — it is how the
 * owner can see the outside scheduler is really calling.
 */
export interface ReminderRun {
  /** The quiz day the run was for (IST). */
  day: DayKey;
  at: Date;
  /** False when the run found reminders switched off and queued nothing. */
  enabled: boolean;
  /** Students who wanted a reminder and could receive one, in a class with a quiz today. */
  eligible: number;
  /** Of those, how many had already pressed Start — they need no reminder. */
  alreadyStarted: number;
  /** Already sent one today by an earlier run (the dedupe key). */
  alreadyReminded: number;
  /** Left out because the day's cap was reached. */
  overCap: number;
  /** Queued by this run. */
  queued: number;
  /** Could not be queued at all (logged; the outbox was unreachable). */
  failed: number;
}

/**
 * Where an automatic Daily Quiz comes from (owner, 2026-10-10): the staff's own pool first — draft
 * questions tagged "daily quiz" — and a generated question when the pool has none for the class; or
 * generated questions only.
 */
export const AUTO_QUIZ_SOURCES = ['pool_then_generated', 'generated_only'] as const;
export type AutoQuizSource = (typeof AUTO_QUIZ_SOURCES)[number];

export interface DailyQuizSettingsDocument extends Document {
  key: string;
  prizeHeadline: string;
  prizeText: string;
  /** In rupees. Null: "cash prize" with no figure. */
  cashAmount: number | null;
  winnerRule: WinnerRule;
  winnersPerQuiz: number;
  instantResult: boolean;
  remindersEnabled: boolean;
  reminderDailyCap: number;
  /** Fill every class left without a quiz on a day automatically (2026-10-10). */
  autoSchedule: boolean;
  autoSource: AutoQuizSource;
  lastReminderRun: ReminderRun | null;
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

/**
 * The most reminders one day may queue — the email provider's whole free daily quota
 * (Brevo: 300), which verification links share. A cap above it would only ever be reached
 * by starving sign-ups.
 */
export const REMINDER_DAILY_CAP_MAX = 300;

/** The values in force when no settings document has been saved. One definition. */
export const DAILY_QUIZ_DEFAULTS = {
  prizeHeadline: 'Solve daily. Win every month.',
  prizeText: 'Surprise gift + cash prize',
  cashAmount: null as number | null,
  winnerRule: 'FASTEST_CORRECT' as WinnerRule,
  winnersPerQuiz: 1,
  instantResult: true,
  remindersEnabled: true,
  reminderDailyCap: 100,
  // On by default: the owner asked for the Daily Quiz to run itself (2026-10-10). A quiz staff
  // schedule always wins — automation fills only a class that has none.
  autoSchedule: true,
  autoSource: 'pool_then_generated' as AutoQuizSource,
};

const reminderRunSchema = new Schema<ReminderRun>(
  {
    day: { type: String, required: true },
    at: { type: Date, required: true },
    enabled: { type: Boolean, required: true },
    eligible: { type: Number, required: true, min: 0 },
    alreadyStarted: { type: Number, required: true, min: 0 },
    alreadyReminded: { type: Number, required: true, min: 0 },
    overCap: { type: Number, required: true, min: 0 },
    queued: { type: Number, required: true, min: 0 },
    failed: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const dailyQuizSettingsSchema = new Schema<DailyQuizSettingsDocument>(
  {
    key: { type: String, required: true, unique: true, default: DAILY_QUIZ_SETTINGS_KEY },
    prizeHeadline: { type: String, required: true, trim: true, maxlength: 80, default: DAILY_QUIZ_DEFAULTS.prizeHeadline },
    prizeText: { type: String, required: true, trim: true, maxlength: 120, default: DAILY_QUIZ_DEFAULTS.prizeText },
    cashAmount: { type: Number, default: null, min: 0, max: 100000 },
    winnerRule: { type: String, enum: WINNER_RULES, required: true, default: DAILY_QUIZ_DEFAULTS.winnerRule },
    winnersPerQuiz: { type: Number, required: true, min: 1, max: 5, default: DAILY_QUIZ_DEFAULTS.winnersPerQuiz },
    instantResult: { type: Boolean, required: true, default: DAILY_QUIZ_DEFAULTS.instantResult },
    remindersEnabled: { type: Boolean, required: true, default: DAILY_QUIZ_DEFAULTS.remindersEnabled },
    reminderDailyCap: {
      type: Number,
      required: true,
      min: 0,
      max: REMINDER_DAILY_CAP_MAX,
      default: DAILY_QUIZ_DEFAULTS.reminderDailyCap,
    },
    autoSchedule: { type: Boolean, required: true, default: DAILY_QUIZ_DEFAULTS.autoSchedule },
    autoSource: { type: String, enum: AUTO_QUIZ_SOURCES, required: true, default: DAILY_QUIZ_DEFAULTS.autoSource },
    lastReminderRun: { type: reminderRunSchema, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    updatedByLabel: { type: String, default: null },
  },
  { timestamps: true },
);

export const DailyQuizSettings = mongoose.model<DailyQuizSettingsDocument>('DailyQuizSettings', dailyQuizSettingsSchema);
