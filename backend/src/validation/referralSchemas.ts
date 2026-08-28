import { z } from 'zod';
import { REFERRAL_REWARD_STATUSES } from '../models';

/**
 * Refer & Earn (Milestone 22, Phase E).
 *
 * The referral code as a shape: `AMIT` plus six characters from the unambiguous alphabet
 * (`0`/`O` and `1`/`I`/`L` are absent, because this gets read off a screenshot and typed by
 * hand). Uppercased before it is compared, so a code shared in lower case still works — a
 * referrer losing credit over capitalisation would be the most annoying possible bug in
 * this feature.
 */
export const referralCode = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .regex(/^AMIT[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/, 'That referral code is not in the right format'),
  );

/** `GET /referrals/validate?code=…` — public, so the register page can check a link. */
export const validateReferralQuerySchema = z.object({ code: referralCode });
export type ValidateReferralQuery = z.infer<typeof validateReferralQuerySchema>;

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const listReferralsQuerySchema = z.object({
  ...pagination,
  rewardStatus: z.enum(REFERRAL_REWARD_STATUSES).optional(),
  /** A student id, an email or a referral code. Resolved to ids before any query. */
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListReferralsQuery = z.infer<typeof listReferralsQuerySchema>;

export const referralIdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-f\d]{24}$/i, 'That is not a valid referral id'),
});

/**
 * Marking a reward paid.
 *
 * The reference is **required**. A payout nobody can trace is a payout nobody can verify
 * happened — the same reasoning that makes a certificate revocation carry a mandatory
 * reason. Free text, because it might be a UPI reference, a bank reference or "handed over
 * in cash at the centre", and only the person who paid knows which.
 *
 * Note what is absent: an **amount**. It was snapshotted onto the referral when it
 * converted, and no request may supply one — the same rule that keeps XP, ranks and the
 * entry fee out of request bodies.
 */
export const markPaidSchema = z.object({
  payoutReference: z
    .string({ error: 'Record how this reward was paid' })
    .trim()
    .min(2, 'Record how this reward was paid')
    .max(200),
});
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

/** Rejecting a referral. A reason is mandatory: this is the row somebody will ask about. */
export const rejectReferralSchema = z.object({
  reason: z.string({ error: 'Give a reason' }).trim().min(3, 'Give a reason').max(500),
});
export type RejectReferralInput = z.infer<typeof rejectReferralSchema>;

/**
 * The reward settings.
 *
 * **Eligibility is deliberately absent.** A referral converts when the referred student's
 * entry fee is actually captured, and that rule lives in code — not because it could not be
 * expressed here, but because a deployment that could configure it could quietly start
 * paying out on registration alone, which is the one thing a referral programme must not
 * do. Amounts are business decisions; rules about when money is owed are correctness ones.
 */
export const referralSettingsSchema = z.object({
  rewardEnabled: z.boolean(),
  /** Paise. `0` is valid and is the default — see `models/ReferralSettings.ts`. */
  rewardAmount: z
    .number()
    .int('The reward must be a whole number of paise')
    .min(0)
    .max(10_000_000, 'That reward is implausibly large — check the amount is in paise'),
  /** What the student is told they get. Cleared to `null` when blank. */
  terms: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});
export type ReferralSettingsInput = z.infer<typeof referralSettingsSchema>;
