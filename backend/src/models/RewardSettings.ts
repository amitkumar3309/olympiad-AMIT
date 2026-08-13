import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * Administrator overrides for what each event is worth.
 *
 * ## Why this can exist safely
 *
 * Because `StudentActivity.xpAwarded` is a **snapshot**: every activity row records
 * what its event was worth at the moment it happened, and a student's total is the sum
 * of those recorded values. Re-pricing an event therefore cannot restate what anybody
 * has already earned — it changes only what the *next* event pays. That property was
 * designed in at Milestone 5 for exactly this reason, and it is what makes a tunable
 * award table a safe thing to offer rather than a way to silently rewrite history. A
 * test pins it.
 *
 * ## Why a single document
 *
 * There is one award table, not one per anything, so this collection holds exactly one
 * row — pinned by a unique index on a constant `key`. That is a deliberate use of the
 * database as the place a *setting* lives, rather than a collection of settings with an
 * implicit "the newest one wins" rule that a reader has to know about.
 *
 * ## What is deliberately not here
 *
 * The **rules** — which events exist, how often each may be earned, what makes one
 * eligible, and the level thresholds — stay in code (`models/StudentActivity.ts`,
 * `lib/xp.ts`, `services/rewardService.ts`). Only the *amounts* are tunable. A rule is
 * something to review in a diff; an amount is something to tune on a Tuesday.
 */

export interface RewardSettingsDocument extends Document {
  /** Always `'default'`. The unique index on it is what keeps this a singleton. */
  key: string;
  /**
   * Per-activity XP overrides, keyed by `ActivityType`. An absent key means "use the
   * code default in `lib/xp.ts`" — an override is an exception, not a copy of the
   * whole table, so adding a new activity type does not require touching this document.
   */
  xpOverrides: Map<string, number>;
  updatedBy?: Types.ObjectId | null;
  updatedByLabel?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const rewardSettingsSchema = new Schema<RewardSettingsDocument>(
  {
    key: { type: String, required: true, default: 'default' },
    xpOverrides: { type: Map, of: Number, default: () => new Map<string, number>() },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    updatedByLabel: { type: String, default: null },
  },
  { timestamps: true },
);

/** One settings document, enforced by the database rather than by convention. */
rewardSettingsSchema.index({ key: 1 }, { unique: true });

export const RewardSettings = mongoose.model<RewardSettingsDocument>('RewardSettings', rewardSettingsSchema);

/** The key of the one document. Exported so no caller has to spell it. */
export const REWARD_SETTINGS_KEY = 'default';
