import mongoose, { Schema, type Document } from 'mongoose';

/**
 * The fee, as a single administrator-editable document (Milestone 19).
 *
 * ## Why this is not an environment variable
 *
 * The price is **business configuration, not a credential**. Only secrets belong in the
 * environment; a fee in `.env` means changing what students pay is a redeploy, cannot
 * be done by the person who actually decides it, and leaves no record of who changed it
 * or when. The same reasoning already put the XP award table in `RewardSettings`.
 *
 * ## One document, pinned
 *
 * `key` is a constant with a unique index, exactly as `RewardSettings` does it, so two
 * concurrent saves cannot produce two settings documents that disagree about the price.
 * Until somebody saves one, the code default below is what applies — there is nothing
 * to seed and nothing to migrate.
 *
 * ## Changing the price never re-prices a completed payment
 *
 * `Payment.amount` is a snapshot of what was charged, the same discipline
 * `StudentActivity.xpAwarded` follows. Raising the fee changes what the next student
 * pays and can never alter, invalidate or top-up a payment already captured.
 */

export interface PaymentSettingsDocument extends Document {
  key: 'default';
  /** Paise. Integer arithmetic only — see the note on `Payment.amount`. */
  olympiadEntryFee: number;
  currency: string;
  /**
   * Turns the paid gate off entirely: every student may sit the exam.
   *
   * **Defaults to `false`: the paid gate is opt-in.**
   *
   * That default is deliberate and was chosen after the gate broke nine existing exam
   * tests. Deploying a payment requirement that is on by default would instantly refuse
   * entry to every student who could sit the exam yesterday — before Razorpay is even
   * configured in production. A payment gate has to be switched on by somebody who
   * knows the checkout works, not by a deploy.
   *
   * It is also the answer to a provider outage during an exam window, which needs a
   * response that is not "nobody can enter"; and it is deliberately explicit rather than
   * inferred from the credentials being absent, because "we chose to run this free" and
   * "the keys are missing" are different situations that must not look the same.
   */
  entryFeeEnabled: boolean;
  updatedByLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** ₹499. Applies until an administrator saves anything else. */
export const DEFAULT_ENTRY_FEE_PAISE = 49_900;

const paymentSettingsSchema = new Schema<PaymentSettingsDocument>(
  {
    key: { type: String, required: true, unique: true, default: 'default', enum: ['default'] },
    // `min: 100` mirrors Razorpay's own floor: an order below one rupee is refused by
    // their API, so accepting it here would only move the failure later.
    olympiadEntryFee: { type: Number, required: true, min: 100, max: 10_000_000, default: DEFAULT_ENTRY_FEE_PAISE },
    currency: { type: String, required: true, default: 'INR' },
    entryFeeEnabled: { type: Boolean, required: true, default: false },
    updatedByLabel: { type: String, default: null },
  },
  { timestamps: true },
);

export const PaymentSettings = mongoose.model<PaymentSettingsDocument>('PaymentSettings', paymentSettingsSchema);
