import { z } from 'zod';

/**
 * What the checkout hands back (Milestone 19).
 *
 * The field names are Razorpay's snake_case, deliberately unchanged: they arrive
 * verbatim from their checkout callback, and renaming them at the boundary would mean a
 * frontend mapping step whose only possible contribution is a typo.
 *
 * **Note what is absent: an amount, a status, and a student.** A client cannot state
 * what was paid, whether it succeeded, or on whose behalf — the amount comes from the
 * settings document, the status from a verified signature, and the student from the
 * session token. Those omissions are the schema's real job.
 */
export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().trim().min(1, 'Missing order id').max(120),
  razorpay_payment_id: z.string().trim().min(1, 'Missing payment id').max(120),
  razorpay_signature: z
    .string()
    .trim()
    // A hex HMAC-SHA256 digest is exactly 64 hex characters. Pinning the shape here
    // means a malformed signature is a 400 rather than something the comparison has to
    // handle, and it costs an attacker the ability to probe with odd input.
    .regex(/^[a-f0-9]{64}$/i, 'That signature is not well formed'),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

/**
 * A payment id in the path (Milestone 22, invoices).
 *
 * Pinned to the shape of an `ObjectId` so a path parameter can never become a filter —
 * the same reason `studentIdParamSchema` pins `AMIT_0000`.
 */
export const paymentIdParamSchema = z.object({
  paymentId: z
    .string()
    .trim()
    .regex(/^[a-f\d]{24}$/i, 'That is not a valid payment id'),
});

/** Administrator-editable fee settings. The amount is business config, never an env var. */
export const paymentSettingsSchema = z.object({
  /** Paise. Razorpay refuses anything under 100, so accepting less only defers the error. */
  olympiadEntryFee: z.number().int('The fee must be a whole number of paise').min(100, 'The fee must be at least ₹1').max(10_000_000),
  entryFeeEnabled: z.boolean().default(true),
});
export type PaymentSettingsInput = z.infer<typeof paymentSettingsSchema>;
