import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * One referred registration (Milestone 22, Phase E).
 *
 * ## Why this collection exists at all, when so much else here is derived
 *
 * The rest of this product derives what it can: the entry entitlement is a query over
 * `Payment`, analytics are computed on read, an invoice is a rendering. A referral cannot
 * be, and the reason is specific — **it is the only fact here that nothing else records.**
 * "Who introduced this student?" is not recoverable from any other collection, and it has
 * to survive the referrer changing their code, the fee changing, and the reward rules
 * changing. So it is written down once, at registration, and never rewritten.
 *
 * What *is* derived, and deliberately not stored: whether the referred student has paid.
 * That is a query over `Payment`, exactly as the entitlement is, and duplicating it here
 * would be a second source of truth about money.
 *
 * ## `referred` is unique, and that is the whole abuse model
 *
 * A unique index on `referred` — not a check in a handler — is what enforces three of the
 * rules at once: **one referrer per registration**, **no duplicate attribution**, and **no
 * changing who referred you afterwards**. A check would be a read followed by a write, and
 * on a serverless platform those land in different invocations; an index is decided by the
 * database.
 *
 * ## The reward is a snapshot, like every other amount in this product
 *
 * `rewardAmount` is frozen at the moment the referral converts, for the reason
 * `Payment.amount` and `StudentActivity.xpAwarded` are: re-pricing must never rewrite what
 * somebody has already earned. An administrator raising the reward tomorrow owes the new
 * amount on tomorrow's referrals and the old amount on today's.
 */

/**
 * Where a referral stands. Six values, and each is a distinct fact somebody acts on
 * differently:
 *
 * - `pending_conversion` — registered, and the entry fee has not been captured. The
 *   ordinary state of most rows.
 * - `no_reward`          — the referred student **paid**, but no reward was configured at
 *   that moment. The introduction still happened and is still counted; there is simply
 *   nothing owed. Kept distinct from `pending_conversion` because "they converted and we
 *   owe nothing" and "they have not converted" are different answers to an administrator.
 * - `accrued`            — converted while a reward was configured. Money is owed, pending
 *   approval.
 * - `approved`           — an administrator has agreed it is payable, and it is awaiting
 *   payout.
 * - `paid`               — paid out, with a reference recorded. **Terminal.**
 * - `rejected`           — refused by an administrator, with a reason. **Terminal.**
 */
export const REFERRAL_REWARD_STATUSES = [
  'pending_conversion',
  'no_reward',
  'accrued',
  'approved',
  'paid',
  'rejected',
] as const;
export type ReferralRewardStatus = (typeof REFERRAL_REWARD_STATUSES)[number];

export interface ReferralDocument extends Document {
  /** The account whose code was used. */
  referrer: Types.ObjectId;
  /** The account that registered with it. **Unique** — see the note above. */
  referred: Types.ObjectId;
  /**
   * The code exactly as it was used, snapshotted.
   *
   * Kept even though `referrer` already identifies the account, because a code can in
   * principle be reissued, and an audit of "which code brought these forty students in?"
   * has to be answerable from the row rather than from whatever the account holds today.
   */
  code: string;

  /** When the referred student registered. The referral's own date. */
  registeredAt: Date;
  /**
   * When their entry fee was captured. `null` until it is.
   *
   * Written by the payment-capture hook, and never a substitute for asking `Payment` —
   * it records *when we observed* the conversion, which is why a stale row can be
   * reconciled on read.
   */
  convertedAt: Date | null;
  /** The payment that converted it, so the money is traceable both ways. */
  payment: Types.ObjectId | null;

  rewardStatus: ReferralRewardStatus;
  /**
   * Paise, snapshotted when the referral converted. `0` until then, and `0` for ever on a
   * conversion that happened while no reward was configured.
   */
  rewardAmount: number;

  approvedAt: Date | null;
  approvedBy: string | null;
  paidAt: Date | null;
  paidBy: string | null;
  /** How the payout was made — a UPI reference, a bank reference, "cash". Free text. */
  payoutReference: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectedReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const referralSchema = new Schema<ReferralDocument>(
  {
    referrer: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    // **Unique.** One referrer per registration, no duplicate attribution, and no changing
    // it later — enforced by the database rather than by a handler.
    referred: { type: Schema.Types.ObjectId, ref: 'Student', required: true, unique: true },
    code: { type: String, required: true, uppercase: true, trim: true },

    registeredAt: { type: Date, required: true, default: Date.now },
    convertedAt: { type: Date, default: null },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },

    rewardStatus: {
      type: String,
      enum: REFERRAL_REWARD_STATUSES,
      required: true,
      default: 'pending_conversion',
    },
    rewardAmount: { type: Number, required: true, min: 0, default: 0 },

    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: null },
    paidAt: { type: Date, default: null },
    paidBy: { type: String, default: null },
    payoutReference: { type: String, default: null, trim: true, maxlength: 200 },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null },
    rejectedReason: { type: String, default: null, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

/** "How is this student's referral programme going?" — the student's own dashboard. */
referralSchema.index({ referrer: 1, createdAt: -1 });

/** The admin console: filter by reward state, newest first. */
referralSchema.index({ rewardStatus: 1, createdAt: -1 });

/** "Which registrations came from this code?" */
referralSchema.index({ code: 1 });

/**
 * Deliberately **no TTL**, like `Payment`, `AuditLog` and `StudentActivity`. A referral is
 * a record of who introduced whom and what was owed for it — expiring one would delete the
 * evidence behind a payment somebody can be asked about years later.
 */
export const Referral = mongoose.model<ReferralDocument>('Referral', referralSchema);
