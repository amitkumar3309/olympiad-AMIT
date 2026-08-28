import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { adminActionLimiter, publicLookupLimiter } from '../../middleware/rateLimiter';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { ReferralSettings } from '../../models';
import { displayNameFor } from '../../services/leaderboardService';
import {
  approveReward,
  getReferralSettings,
  getReferralSummary,
  listReferralsForAdmin,
  markRewardPaid,
  rejectReferral,
  resolveReferralCode,
} from '../../services/referralService';
import {
  validateReferralQuerySchema,
  listReferralsQuerySchema,
  referralIdParamSchema,
  markPaidSchema,
  rejectReferralSchema,
  referralSettingsSchema,
  type ValidateReferralQuery,
  type ListReferralsQuery,
  type MarkPaidInput,
  type RejectReferralInput,
  type ReferralSettingsInput,
} from '../../validation/referralSchemas';

/**
 * Refer & Earn (Milestone 22, Phase E).
 *
 * Everything about how a referral behaves lives in `services/referralService.ts`. These
 * routes are the gates, and there are three different kinds:
 *
 * - **Public** — one code check, so the register page can tell a student their link is
 *   good before they fill in a form. Rate limited, and it publishes a masked name only.
 * - **Identity** — `/me/referrals`, like the rest of `/me`: your referrals are yours.
 * - **Privileged** — the console reads on `students:read` (it is student account data) and
 *   the three acts that move money need `referrals:write`.
 *
 * **No route here creates a referral or sets a reward amount.** Attribution happens once,
 * inside registration; the amount is snapshotted at conversion from the settings. These
 * endpoints only move an existing row along a fixed path, which is what stops the console
 * being a way to pay an arbitrary sum to an arbitrary person.
 */
const router = Router();

function callerId(req: Request): Types.ObjectId {
  return new Types.ObjectId(req.user!.sub);
}

function actorLabel(req: Request): string {
  return req.user?.studentId ?? req.user?.email ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Public: is this code real?
// ---------------------------------------------------------------------------

/**
 * Checks a referral code before somebody registers with it.
 *
 * Public and unauthenticated, because the person using it does not have an account yet —
 * that is the entire point of a referral link. Two things keep that safe:
 *
 * - **The name is masked** by `displayNameFor()`, the same function the public leaderboard
 *   uses. "Rahul S." is enough to reassure somebody they followed the right link; a full
 *   legal name would make this an endpoint that turns codes into children's names.
 * - **`publicLookupLimiter`**, the limiter written for the public result and certificate
 *   lookups. A code is ~30 bits, so guessing is impractical, but a public endpoint that
 *   confirms whether a string exists should not be readable hundreds of times an hour from
 *   one address.
 *
 * An unknown code is `{ valid: false }` with a 200, not a 404: this is a question, and "no"
 * is a successful answer to it.
 */
router.get(
  '/referrals/validate',
  publicLookupLimiter,
  validate({ query: validateReferralQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { code } = req.query as unknown as ValidateReferralQuery;
      const referrer = await resolveReferralCode(code);

      sendSuccess(res, 200, {
        valid: referrer !== null,
        code,
        referrerName: referrer ? displayNameFor(referrer) : null,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to validate a referral code',
        fallback: 'Could not check that referral code.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// The student's own referrals
// ---------------------------------------------------------------------------

/**
 * The caller's code, link, referrals and reward totals.
 *
 * An identity gate, like `/me/certificates` and `/me/invoices`. The code is generated on
 * the first call — lazily, so accounts that predate the feature need no migration.
 *
 * Every number here is counted from real `Referral` rows, and where the reward is switched
 * off the totals are genuinely zero with `settings.rewardEnabled: false` beside them, so
 * the page can say the programme is not running rather than displaying ₹0 as if it were an
 * offer.
 */
router.get('/me/referrals', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    sendSuccess(res, 200, { referral: await getReferralSummary(callerId(req)) });
  } catch (err) {
    respondToServiceError(res, err, {
      log: 'Failed to load referral summary',
      fallback: 'Could not load your referrals.',
    });
  }
});

// ---------------------------------------------------------------------------
// The administrative console
// ---------------------------------------------------------------------------

/**
 * Every referral, for staff.
 *
 * Gated on `students:read` rather than `referrals:write`, matching `/admin/payments`: it
 * exposes who introduced whom, which is student account data, and the roles that may
 * already read a student's record are the same set that should see this. Approving a
 * payout is a separate permission.
 *
 * `referredHasPaid` is derived from the payment record at read time rather than trusted
 * from the referral row, so a stale row is visible as such instead of quietly wrong.
 */
router.get(
  '/admin/referrals',
  requirePermission('students:read'),
  validate({ query: listReferralsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, ...filters } = req.query as unknown as ListReferralsQuery;
      const { referrals, total, totals } = await listReferralsForAdmin(filters, page, limit);

      sendSuccess(res, 200, {
        referrals,
        totals: {
          ...totals,
          accruedDisplay: `₹${(totals.accruedPaise / 100).toFixed(2)}`,
          approvedDisplay: `₹${(totals.approvedPaise / 100).toFixed(2)}`,
          paidDisplay: `₹${(totals.paidPaise / 100).toFixed(2)}`,
        },
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to list referrals',
        fallback: 'Could not load the referrals.',
      });
    }
  },
);

/**
 * One audit entry for all three acts, distinguished by `metadata.action`.
 *
 * They are the same kind of event — an administrator moving a reward along its path — and
 * three action names would only make the trail harder to filter for "what happened to
 * referral rewards this month?".
 */
async function recordRewardChange(
  req: Request,
  referral: Awaited<ReturnType<typeof approveReward>>,
  action: 'approved' | 'paid' | 'rejected',
  extra: Record<string, unknown> = {},
): Promise<void> {
  await recordAudit(req, {
    action: 'referral.reward.changed',
    targetType: 'referral',
    targetId: String(referral._id),
    targetLabel: `${referral.code} → ${referral.rewardStatus}`,
    metadata: {
      action,
      code: referral.code,
      referrer: String(referral.referrer),
      referred: String(referral.referred),
      // The amount is on the entry because it is the fact somebody will be checking.
      amountPaise: referral.rewardAmount,
      ...extra,
    },
  });
}

/** `accrued` → `approved`. */
router.post(
  '/admin/referrals/:id/approve',
  requirePermission('referrals:write'),
  adminActionLimiter,
  validate({ params: referralIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const referral = await approveReward(String(req.params.id), actorLabel(req));
      await recordRewardChange(req, referral, 'approved');
      sendSuccess(res, 200, { referral: { id: String(referral._id), rewardStatus: referral.rewardStatus } });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to approve a referral reward',
        fallback: 'Could not approve that reward.',
      });
    }
  },
);

/**
 * `approved` → `paid`. **Terminal**, and deliberately not reachable from `accrued`:
 * approving and paying are two decisions, and collapsing them removes the only checkpoint
 * between "this looks payable" and "money has left".
 */
router.post(
  '/admin/referrals/:id/mark-paid',
  requirePermission('referrals:write'),
  adminActionLimiter,
  validate({ params: referralIdParamSchema, body: markPaidSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { payoutReference } = req.body as MarkPaidInput;
      const referral = await markRewardPaid(String(req.params.id), actorLabel(req), payoutReference);
      await recordRewardChange(req, referral, 'paid', { payoutReference });
      sendSuccess(res, 200, { referral: { id: String(referral._id), rewardStatus: referral.rewardStatus } });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to mark a referral reward paid',
        fallback: 'Could not mark that reward paid.',
      });
    }
  },
);

/** → `rejected`, from anything not already paid. A reason is mandatory. */
router.post(
  '/admin/referrals/:id/reject',
  requirePermission('referrals:write'),
  adminActionLimiter,
  validate({ params: referralIdParamSchema, body: rejectReferralSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { reason } = req.body as RejectReferralInput;
      const referral = await rejectReferral(String(req.params.id), actorLabel(req), reason);
      await recordRewardChange(req, referral, 'rejected', { reason });
      sendSuccess(res, 200, { referral: { id: String(referral._id), rewardStatus: referral.rewardStatus } });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to reject a referral',
        fallback: 'Could not reject that referral.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// What a referral is worth
// ---------------------------------------------------------------------------

router.get(
  '/admin/referral-settings',
  requirePermission('students:read'),
  ensureDb,
  async (_req: Request, res: Response) => {
    try {
      const settings = await getReferralSettings();
      sendSuccess(res, 200, {
        ...settings,
        rewardDisplay: `₹${(settings.rewardAmount / 100).toFixed(2)}`,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to read referral settings',
        fallback: 'Could not load the referral settings.',
      });
    }
  },
);

/**
 * Sets what a referral is worth.
 *
 * **Changing this never re-prices a reward already earned.** `Referral.rewardAmount` is
 * snapshotted at conversion, the same discipline `Payment.amount` and
 * `StudentActivity.xpAwarded` follow — a rise applies to the next conversion only.
 *
 * Gated on `referrals:write`, not on the read permission: seeing what a referral is worth
 * and deciding it are different acts. Both sides of the change are audited, because "who
 * changed the reward, from what, to what" is the question the entry exists to answer.
 */
router.put(
  '/admin/referral-settings',
  requirePermission('referrals:write'),
  validate({ body: referralSettingsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as ReferralSettingsInput;
      const before = await getReferralSettings();

      const saved = await ReferralSettings.findOneAndUpdate(
        { key: 'default' },
        {
          $set: {
            rewardEnabled: input.rewardEnabled,
            rewardAmount: input.rewardAmount,
            terms: input.terms,
            updatedByLabel: actorLabel(req),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      await recordAudit(req, {
        action: 'referral.settings.updated',
        targetType: 'system',
        targetLabel: `Referral reward ₹${(saved.rewardAmount / 100).toFixed(2)}`,
        metadata: {
          fromEnabled: before.rewardEnabled,
          toEnabled: saved.rewardEnabled,
          fromPaise: before.rewardAmount,
          toPaise: saved.rewardAmount,
        },
      });

      sendSuccess(res, 200, {
        rewardEnabled: saved.rewardEnabled,
        rewardAmount: saved.rewardAmount,
        currency: saved.currency,
        terms: saved.terms,
        rewardDisplay: `₹${(saved.rewardAmount / 100).toFixed(2)}`,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to update referral settings',
        fallback: 'Could not save the referral settings.',
      });
    }
  },
);

export default router;
