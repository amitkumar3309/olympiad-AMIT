import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * One attempt to pay, from order creation to its final state (Milestone 19).
 *
 * ## This collection *is* the entitlement
 *
 * There is deliberately **no `hasPaid` flag on `Student`**. "May this student sit the
 * official exam?" is answered by asking whether a `captured` payment exists for them,
 * exactly as XP is a `$sum` over activity and analytics are derived from attempts. A
 * stored boolean is a second source of truth that can drift from the money, and when it
 * drifts, a student who paid is refused entry or one who did not is let in — both of
 * which are worse than an indexed query.
 *
 * ## Why a row exists before any money moves
 *
 * A `Payment` is created in `created` status *before* the checkout opens, because the
 * Razorpay order id has to be recorded against a student somewhere the server trusts.
 * Without that row, a webhook arriving later carries an order id belonging to nobody,
 * and the only way to attribute it would be to believe whatever the browser said — the
 * exact thing that must never be trusted.
 *
 * ## Status is a one-way street
 *
 * `created → attempted → captured` or `→ failed`. A `captured` payment is **terminal
 * and never rewritten**: a duplicate webhook, a late webhook, or a verify call arriving
 * after a webhook all find it already captured and change nothing. That is what makes
 * every write path here idempotent, and it is enforced by conditional updates rather
 * than by reading-then-writing — on serverless the two halves can land in different
 * invocations.
 */

export const PAYMENT_STATUSES = ['created', 'attempted', 'captured', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * What a payment buys. One value today; an enum because per-exam entry fees are the
 * obvious next shape and a string field would make that a data migration.
 */
export const PAYMENT_PURPOSES = ['olympiad_entry'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/** How the final state was reached — worth recording because they fail differently. */
export const PAYMENT_SOURCES = ['checkout_verify', 'webhook', 'manual'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export interface PaymentDocument extends Document {
  student: Types.ObjectId;
  purpose: PaymentPurpose;

  // --- Money. Integers in the smallest unit, always. ---
  /**
   * Paise, never rupees. Razorpay's API is in paise, and a floating-point rupee amount
   * is how a ₹499.00 fee becomes ₹498.99999999 — money is integer arithmetic or it is
   * wrong. Every display divides by 100 at the edge.
   */
  amount: number;
  currency: string;

  // --- Razorpay's identifiers ---
  /** `order_…`. Unique: one row per order, which is what makes webhooks idempotent. */
  razorpayOrderId: string;
  /** `pay_…`. Absent until a payment is actually attempted against the order. */
  razorpayPaymentId: string | null;
  /** Set only once a signature has been verified server-side. Never from the browser. */
  razorpaySignature: string | null;

  status: PaymentStatus;
  /** Which path last moved it. A capture from a webhook and one from the return
   *  journey are the same outcome by different routes, and both happen. */
  statusSource: PaymentSource | null;
  /** Razorpay's own failure reason, kept verbatim so support can act on it. */
  failureReason: string | null;
  /** Card / upi / netbanking, as reported by Razorpay. Display only. */
  method: string | null;

  /** When the money was confirmed captured. The entitlement's effective date. */
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<PaymentDocument>(
  {
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    purpose: { type: String, enum: PAYMENT_PURPOSES, required: true },

    amount: { type: Number, required: true, min: 100 },
    currency: { type: String, required: true, default: 'INR' },

    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null },

    status: { type: String, enum: PAYMENT_STATUSES, required: true, default: 'created' },
    statusSource: { type: String, enum: PAYMENT_SOURCES, default: null },
    failureReason: { type: String, default: null },
    method: { type: String, default: null },

    capturedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * The entitlement query: "has this student a captured payment for this purpose?"
 *
 * Indexed because it runs on every attempt to start the official exam, which is the
 * one moment a slow answer is unacceptable.
 */
paymentSchema.index({ student: 1, purpose: 1, status: 1 });

/** The student's own transaction history, newest first. */
paymentSchema.index({ student: 1, createdAt: -1 });

/** The admin console: filter by state, newest first. */
paymentSchema.index({ status: 1, createdAt: -1 });

/**
 * Deliberately **no TTL**, like `AuditLog` and `StudentActivity`. A payment record is
 * financial evidence — that somebody paid, when, how much, and what it entitled them
 * to. Expiring one would delete the proof of a transaction a student can be asked
 * about years later.
 */
export const Payment = mongoose.model<PaymentDocument>('Payment', paymentSchema);
