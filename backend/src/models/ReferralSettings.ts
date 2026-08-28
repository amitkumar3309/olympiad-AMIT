import mongoose, { Schema, type Document } from 'mongoose';

/**
 * What a referral is worth, as a single administrator-editable document (Milestone 22).
 *
 * ## The business rule this file exists to *avoid inventing*
 *
 * Nothing in this project has ever specified a referral reward — not an amount, not an
 * eligibility condition, not a payout method. So none was invented. The tracking is real
 * and complete: every introduction is recorded, and every conversion is observed from the
 * actual payment. The **reward** is switched off and worth zero until the owner sets it,
 * and every surface says so plainly rather than showing a number nobody decided.
 *
 * That is the honest shape for a rule that does not exist yet. A plausible default — ₹50,
 * say — would be indistinguishable from a decision somebody made, and it would start
 * accruing real liabilities against real students the day it shipped.
 *
 * ## Why this is a document and not an environment variable
 *
 * Identical reasoning to `PaymentSettings`: a reward is a **price**, and a price changes,
 * is decided by the person running the competition rather than the person deploying it,
 * and needs an audit entry naming who changed it and from what. Compare the invoice
 * issuer details, which *are* environment variables — those change roughly never and must
 * be absent rather than wrong.
 *
 * ## What is deliberately NOT configurable
 *
 * **Eligibility.** A referral converts when the referred student's entry fee is actually
 * captured, and that rule lives in code. It is not a knob, for the same reason the reward
 * *catalogue* is code while the XP *amounts* are settings: an amount is a business
 * decision, and a rule about when money is owed is a correctness decision. Making it
 * configurable would mean a deployment could quietly pay out on registration alone, which
 * is the one thing a referral programme must not do.
 */

export interface ReferralSettingsDocument extends Document {
  key: 'default';
  /**
   * Whether a converted referral accrues anything at all.
   *
   * **Defaults to `false`** — the opposite of `PaymentSettings.entryFeeEnabled`, and for
   * the opposite reason. A paywall that defaults off is not a paywall; a reward that
   * defaults *on* is a liability nobody agreed to. Tracking runs either way.
   */
  rewardEnabled: boolean;
  /**
   * Paise per successful referral. **Defaults to 0**, because no amount has been specified
   * by anybody.
   *
   * Snapshotted onto the `Referral` the moment it converts, so changing this can never
   * re-price a reward already earned.
   */
  rewardAmount: number;
  currency: string;
  /**
   * Free text shown to students beside their referral link — what they get, and when.
   *
   * Empty by default, and the UI says the programme is not yet running rather than
   * inventing terms. Whoever sets an amount writes the sentence that goes with it.
   */
  terms: string | null;
  updatedByLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Zero, until the owner decides otherwise. See the note above — this is not a placeholder. */
export const DEFAULT_REFERRAL_REWARD_PAISE = 0;

const referralSettingsSchema = new Schema<ReferralSettingsDocument>(
  {
    key: { type: String, required: true, unique: true, default: 'default', enum: ['default'] },
    rewardEnabled: { type: Boolean, required: true, default: false },
    rewardAmount: {
      type: Number,
      required: true,
      min: 0,
      // A cap, so a mistyped amount is refused rather than accrued. ₹1,00,000 per referral
      // is far beyond anything plausible and still leaves room for any real decision.
      max: 10_000_000,
      default: DEFAULT_REFERRAL_REWARD_PAISE,
    },
    currency: { type: String, required: true, default: 'INR' },
    terms: { type: String, default: null, trim: true, maxlength: 500 },
    updatedByLabel: { type: String, default: null },
  },
  { timestamps: true },
);

export const ReferralSettings = mongoose.model<ReferralSettingsDocument>(
  'ReferralSettings',
  referralSettingsSchema,
);
