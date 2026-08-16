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
   * Turns the paid gate off entirely: every student may practise, rehearse and compete
   * without paying.
   *
   * **Defaults to `true` as of 2026-08-16: the fee is how this product works.**
   *
   * This reverses the default the feature shipped with earlier the same day, and the
   * reversal is an owner decision rather than a technical one. The original `false` was
   * chosen because switching a gate on by deploy would refuse entry to students who
   * could enter yesterday — a good argument while the fee bought only the official exam
   * and nobody had paid. It stopped applying when the owner made the fee the entry
   * condition for the whole platform: a paywall that defaults to off is not a paywall,
   * and every deployment would have had to remember to turn it on.
   *
   * The switch itself is kept, and matters more now than it did, because it is the
   * answer to two situations that have no other answer: a provider outage during an
   * exam window (which needs a response that is not "nobody can enter"), and a decision
   * to run a cohort free. It stays **explicit** rather than inferred from the
   * credentials being absent, because "we chose to run this free" and "the keys are
   * missing" are different situations that must never look the same — with the keys
   * missing and this `true`, students are correctly told payment is unavailable rather
   * than silently let in.
   */
  entryFeeEnabled: boolean;
  updatedByLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ₹100. Applies until an administrator saves anything else.
 *
 * Set by the owner on 2026-08-16, down from the ₹499 the feature shipped with. It is a
 * price, so it lives here as a starting value and is changed from `/admin/payments` —
 * not by editing this line.
 */
export const DEFAULT_ENTRY_FEE_PAISE = 10_000;

const paymentSettingsSchema = new Schema<PaymentSettingsDocument>(
  {
    key: { type: String, required: true, unique: true, default: 'default', enum: ['default'] },
    // `min: 100` mirrors Razorpay's own floor: an order below one rupee is refused by
    // their API, so accepting it here would only move the failure later.
    olympiadEntryFee: { type: Number, required: true, min: 100, max: 10_000_000, default: DEFAULT_ENTRY_FEE_PAISE },
    currency: { type: String, required: true, default: 'INR' },
    entryFeeEnabled: { type: Boolean, required: true, default: true },
    updatedByLabel: { type: String, default: null },
  },
  { timestamps: true },
);

export const PaymentSettings = mongoose.model<PaymentSettingsDocument>('PaymentSettings', paymentSettingsSchema);
