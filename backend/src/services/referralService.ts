import crypto from 'node:crypto';
import type { Types } from 'mongoose';
import { config } from '../config';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import {
  Payment,
  Referral,
  ReferralSettings,
  Student,
  DEFAULT_REFERRAL_REWARD_PAISE,
  type ReferralDocument,
  type ReferralRewardStatus,
  type StudentDocument,
} from '../models';
import { displayNameFor } from './leaderboardService';

/**
 * THE referral path (Milestone 22, Phase E). Codes, attribution, conversion and rewards.
 *
 * ## The four rules
 *
 * 1. **Attribution happens once, at registration, and is decided by the database.** The
 *    unique index on `Referral.referred` is what enforces one referrer per registration,
 *    no duplicate attribution, and no changing it afterwards. There is no route that
 *    re-attributes, and no handler check that could race.
 * 2. **A referral converts on captured money, never on a registration.** The hook runs
 *    from `capturePayment()`, the single place a payment becomes real — so a referral
 *    cannot become payable because somebody opened a checkout. Note it deliberately does
 *    **not** use `hasEntryEntitlement()`, which returns true when the fee is switched off:
 *    that answers "may this student compete?", and "did money arrive?" is a different
 *    question with a different answer.
 * 3. **The reward amount is snapshotted at conversion.** Re-pricing must never rewrite
 *    what somebody already earned — the discipline `Payment.amount` and
 *    `StudentActivity.xpAwarded` follow.
 * 4. **No reward rule was invented.** Nothing in this project has ever specified an amount
 *    or an eligibility condition, so the reward is switched off and worth zero until an
 *    administrator sets it. Tracking is complete regardless. See `models/ReferralSettings.ts`.
 *
 * ## Why the referral code is not the student id
 *
 * `AMIT_0000`–`AMIT_9999` is ten thousand identifiers, walkable in an afternoon — anything
 * keyed on it is a list somebody can enumerate, which is exactly why the public result and
 * certificate lookups had to be masked and rate limited. A referral code is posted in
 * WhatsApp groups and typed by strangers, so it gets its own value: six characters from a
 * 31-symbol alphabet, `crypto`-random, ~30 bits. Not a secret, but not a walk either.
 */

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * The alphabet, minus every character that gets misread when a code is read aloud, copied
 * off a screenshot or typed from a poster: `0`/`O`, `1`/`I`/`L`. The same reasoning as the
 * certificate verification code, and it matters more here — a mistyped referral code costs
 * somebody their credit for an introduction they really made.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `AMIT${out}`;
}

/** True for a duplicate-key error, whatever else it carries. */
function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * The caller's referral code, generating one the first time it is asked for.
 *
 * **Lazily**, rather than at registration, for two reasons: every account that predates
 * this feature needs one and there is no migration; and a code that is never looked at
 * costs nothing to not exist. The write is conditional on the field still being absent, so
 * two concurrent requests cannot hand the same account two codes.
 */
export async function ensureReferralCode(studentId: Types.ObjectId): Promise<string> {
  const existing = await Student.findById(studentId).select('referralCode');
  if (!existing) throw ApiError.notFound('No account found.');
  if (existing.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    try {
      // Conditional on `referralCode` still being unset: if another request won, this
      // updates nothing and we re-read theirs rather than overwriting it.
      const updated = await Student.findOneAndUpdate(
        { _id: studentId, $or: [{ referralCode: { $exists: false } }, { referralCode: null }] },
        { $set: { referralCode: code } },
        { new: true },
      ).select('referralCode');

      if (updated?.referralCode) return updated.referralCode;

      const raced = await Student.findById(studentId).select('referralCode');
      if (raced?.referralCode) return raced.referralCode;
    } catch (err) {
      // A collision on the unique index. ~887 million codes makes this vanishingly rare,
      // and retrying is the same pattern `studentId` and the certificate serial use.
      if (!isDuplicateKey(err)) throw err;
    }
  }

  logger.error({ student: String(studentId) }, 'Could not allocate a unique referral code');
  throw ApiError.conflict('Could not create a referral code just now. Please try again.');
}

/**
 * The student a code belongs to, or `null`.
 *
 * Only an **active** account resolves. A suspended or blocked referrer's code stops
 * working, which is the point: a code is a live invitation, and an account that has lost
 * standing should not keep recruiting. The referrals it already made are untouched — those
 * are historical facts.
 */
export async function resolveReferralCode(code: string): Promise<StudentDocument | null> {
  const normalised = code.trim().toUpperCase();
  if (!normalised) return null;
  return Student.findOne({ referralCode: normalised, status: 'active' });
}

/** The link a student shares. Built from `FRONTEND_URL`, never a hardcoded domain. */
export function referralLinkFor(code: string): string {
  return `${config.publicAppUrl}/register?ref=${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface EffectiveReferralSettings {
  rewardEnabled: boolean;
  rewardAmount: number;
  currency: string;
  terms: string | null;
}

/** The saved settings, or the code defaults — which are "off, and worth nothing". */
export async function getReferralSettings(): Promise<EffectiveReferralSettings> {
  const saved = await ReferralSettings.findOne({ key: 'default' }).lean();
  return {
    // Off unless somebody deliberately turned it on. A reward that defaults on is a
    // liability nobody agreed to — the mirror image of the paywall's default.
    rewardEnabled: saved?.rewardEnabled ?? false,
    rewardAmount: saved?.rewardAmount ?? DEFAULT_REFERRAL_REWARD_PAISE,
    currency: saved?.currency ?? 'INR',
    terms: saved?.terms ?? null,
  };
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export interface AttributionInput {
  code: string;
  referred: Types.ObjectId;
}

/**
 * Records who introduced a newly registered student.
 *
 * Called from the registration handler **after** the account exists, and it throws on a
 * code that does not resolve — the registration refuses rather than silently dropping the
 * attribution. Losing it quietly would mean the referrer never gets credit and nobody ever
 * finds out why; the frontend validates the code from the link before the form is
 * submitted, so in practice a student meets this only if they typed one by hand.
 *
 * Self-referral is checked even though it is structurally impossible at registration (the
 * account is created in the same request and cannot already own a code). The check is here
 * so the *service* is correct rather than only its current caller — if attribution is ever
 * offered anywhere else, this is the rule that has to hold.
 */
export async function attributeReferral(input: AttributionInput): Promise<ReferralDocument | null> {
  const code = input.code.trim().toUpperCase();
  const referrer = await resolveReferralCode(code);
  if (!referrer) {
    throw ApiError.badRequest(
      `The referral code “${code}” is not valid. Remove it to continue, or check it with whoever shared it.`,
    );
  }

  if (String(referrer._id) === String(input.referred)) {
    throw ApiError.badRequest('You cannot refer yourself.');
  }

  try {
    return await Referral.create({
      referrer: referrer._id,
      referred: input.referred,
      // The code as it was used, snapshotted — see `models/Referral.ts`. Taken from the
      // request rather than re-read off the account, so it is literally the string that
      // brought this student in.
      code,
      registeredAt: new Date(),
      rewardStatus: 'pending_conversion' satisfies ReferralRewardStatus,
      rewardAmount: 0,
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      // This account already has a referrer. The unique index is the rule, and reaching it
      // means a retry or a race — not an error worth failing a registration over.
      logger.warn({ referred: String(input.referred) }, 'Referral already attributed; leaving the first one in place');
      return Referral.findOne({ referred: input.referred });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Promotes a referral once the referred student's entry fee is captured.
 *
 * Called from `capturePayment()` — the one place in the product where money becomes real —
 * and **best-effort**: it never throws into the payment path, because a referral is
 * bookkeeping and a capture is money. A failure here is logged and reconciled on the next
 * read (see `reconcileReferral`), which is the same shape as the audit trail's promise
 * never to fail the action it describes.
 *
 * The write is **conditional on the row still being `pending_conversion`**, so a duplicate
 * webhook, a reconcile and a browser return journey landing in the same second cannot
 * accrue two rewards. That is the "duplicate reward creation" rule, enforced by the
 * database rather than by a check.
 */
export async function onEntryPaymentCaptured(
  student: Types.ObjectId,
  paymentId: Types.ObjectId | null,
): Promise<void> {
  try {
    const settings = await getReferralSettings();
    const payable = settings.rewardEnabled && settings.rewardAmount > 0;

    const updated = await Referral.findOneAndUpdate(
      { referred: student, rewardStatus: 'pending_conversion' },
      {
        $set: {
          convertedAt: new Date(),
          payment: paymentId,
          // `no_reward` rather than `accrued` when nothing is configured: the introduction
          // still converted and is still counted, there is simply nothing owed. Recording
          // it as pending would show an administrator a debt that does not exist.
          rewardStatus: payable ? 'accrued' : 'no_reward',
          // Snapshotted here and never recalculated.
          rewardAmount: payable ? settings.rewardAmount : 0,
        },
      },
      { new: true },
    );

    if (updated) {
      logger.info(
        { referral: String(updated._id), status: updated.rewardStatus, amount: updated.rewardAmount },
        'Referral converted',
      );
    }
  } catch (err) {
    // Never rethrown. The payment is the thing that must not fail.
    logger.error({ err, student: String(student) }, 'Could not convert a referral after payment capture');
  }
}

/**
 * Brings one stale row up to date on read.
 *
 * The hook above is a push, and a push can be missed — the process can die between the
 * capture and the update, and a referral created *after* a payment (a support fix, an
 * import) never sees one at all. This is the pull, and it is the same answer
 * `reconcileOrder()` gives for payments: any time we have reason to look at a row, check
 * the authority and correct it.
 *
 * Only ever promotes out of `pending_conversion`; an approved or paid reward is never
 * revisited.
 */
export async function reconcileReferral(referral: ReferralDocument): Promise<ReferralDocument> {
  if (referral.rewardStatus !== 'pending_conversion') return referral;

  const captured = await Payment.findOne({
    student: referral.referred,
    purpose: 'olympiad_entry',
    status: 'captured',
  }).sort({ capturedAt: 1 });

  if (!captured) return referral;

  await onEntryPaymentCaptured(referral.referred, captured._id as Types.ObjectId);
  return (await Referral.findById(referral._id)) ?? referral;
}

// ---------------------------------------------------------------------------
// The student's own view
// ---------------------------------------------------------------------------

export interface ReferralSummary {
  code: string;
  link: string;
  settings: EffectiveReferralSettings;
  counts: {
    total: number;
    pendingConversion: number;
    converted: number;
    rejected: number;
  };
  rewards: {
    accruedPaise: number;
    approvedPaise: number;
    paidPaise: number;
  };
  referrals: Array<{
    id: string;
    /** Masked, never the full legal name — see `displayNameFor()`. */
    name: string;
    classLevel: string | null;
    registeredAt: Date;
    converted: boolean;
    convertedAt: Date | null;
    rewardStatus: ReferralRewardStatus;
    rewardAmount: number;
    rewardDisplay: string;
  }>;
}

/**
 * Everything the student's Refer & Earn page shows, and nothing it does not.
 *
 * Every figure is counted from `Referral` rows that really exist. Where the reward is
 * switched off the totals are genuinely zero and `settings.rewardEnabled` is false, so the
 * page can say the programme is not running rather than displaying ₹0 as though it were a
 * reward.
 *
 * **The people a student referred are masked.** `displayNameFor()` — the same function the
 * public leaderboard uses — because a referral list is a list of children, and the student
 * looking at it is not staff. They see "Rahul S.", which is enough to recognise somebody
 * they invited.
 */
export async function getReferralSummary(student: Types.ObjectId): Promise<ReferralSummary> {
  const code = await ensureReferralCode(student);
  const settings = await getReferralSettings();

  const rows = await Referral.find({ referrer: student }).sort({ createdAt: -1 }).limit(200);

  // Stale rows are corrected as they are read, so a missed hook heals rather than
  // persisting as a referral that paid but does not say so.
  const referrals = await Promise.all(rows.map((row) => reconcileReferral(row)));

  const referredIds = referrals.map((row) => row.referred);
  const accounts = await Student.find({ _id: { $in: referredIds } }).select(
    'firstName lastName fullName classLevel',
  );
  const byId = new Map(accounts.map((account) => [String(account._id), account]));

  const sumOf = (status: ReferralRewardStatus): number =>
    referrals.filter((row) => row.rewardStatus === status).reduce((total, row) => total + row.rewardAmount, 0);

  const converted = referrals.filter((row) => row.convertedAt !== null).length;

  return {
    code,
    link: referralLinkFor(code),
    settings,
    counts: {
      total: referrals.length,
      pendingConversion: referrals.filter((row) => row.rewardStatus === 'pending_conversion').length,
      converted,
      rejected: referrals.filter((row) => row.rewardStatus === 'rejected').length,
    },
    rewards: {
      accruedPaise: sumOf('accrued'),
      approvedPaise: sumOf('approved'),
      paidPaise: sumOf('paid'),
    },
    referrals: referrals.map((row) => {
      const account = byId.get(String(row.referred));
      return {
        id: String(row._id),
        name: account ? displayNameFor(account) : 'A student',
        classLevel: account?.classLevel ?? null,
        registeredAt: row.registeredAt,
        converted: row.convertedAt !== null,
        convertedAt: row.convertedAt,
        rewardStatus: row.rewardStatus,
        rewardAmount: row.rewardAmount,
        rewardDisplay: `₹${(row.rewardAmount / 100).toFixed(2)}`,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// The administrative view
// ---------------------------------------------------------------------------

export interface AdminReferralFilters {
  rewardStatus?: ReferralRewardStatus;
  /** Matches either side of the introduction: the referrer's or the referred's id. */
  search?: string;
}

interface ReferralPartyView {
  studentId: string | null;
  fullName: string | null;
  email: string | null;
  classLevel: string | null;
}

function partyView(account: StudentDocument | undefined): ReferralPartyView {
  if (!account) return { studentId: null, fullName: null, email: null, classLevel: null };
  return {
    // Staff see real names here, unlike the student's own view: this is the console that
    // decides whether to pay somebody, and it already requires `students:read`.
    studentId: account.studentId,
    fullName: account.fullName ?? null,
    email: account.email,
    classLevel: account.classLevel ?? null,
  };
}

export interface AdminReferralRow {
  id: string;
  code: string;
  referrer: ReferralPartyView;
  referred: ReferralPartyView;
  registeredAt: Date;
  convertedAt: Date | null;
  /** Derived from the payment record at read time — never a stored duplicate. */
  referredHasPaid: boolean;
  paymentId: string | null;
  rewardStatus: ReferralRewardStatus;
  rewardAmount: number;
  rewardDisplay: string;
  approvedAt: Date | null;
  approvedBy: string | null;
  paidAt: Date | null;
  paidBy: string | null;
  payoutReference: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectedReason: string | null;
}

interface ReferralFilter {
  rewardStatus?: ReferralRewardStatus;
  $or?: Array<{ referrer: Types.ObjectId } | { referred: Types.ObjectId } | { code: string }>;
}

/** One page of the referral console, with the totals owed across the whole programme. */
export async function listReferralsForAdmin(
  filters: AdminReferralFilters,
  page: number,
  limit: number,
): Promise<{
  referrals: AdminReferralRow[];
  total: number;
  totals: { accruedPaise: number; approvedPaise: number; paidPaise: number };
}> {
  const filter: ReferralFilter = {};
  if (filters.rewardStatus) filter.rewardStatus = filters.rewardStatus;

  if (filters.search) {
    const term = filters.search.trim();
    // Resolved to ids first, so nothing user-controlled reaches Mongo as a pattern. A
    // search that matches no account still matches the code, which is the other thing
    // staff paste in.
    const matches = await Student.find({
      $or: [
        { studentId: term.toUpperCase() },
        { email: term.toLowerCase() },
        { referralCode: term.toUpperCase() },
      ],
    }).select('_id');

    filter.$or = [
      ...matches.map((account) => ({ referrer: account._id as Types.ObjectId })),
      ...matches.map((account) => ({ referred: account._id as Types.ObjectId })),
      { code: term.toUpperCase() },
    ];
  }

  const [rows, total, sums] = await Promise.all([
    Referral.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Referral.countDocuments(filter),
    // Programme-wide, not page-wide: "what do we owe?" is a question about the whole
    // programme, and answering it from the current page would be a different number every
    // time somebody paged.
    Referral.aggregate<{ _id: ReferralRewardStatus; amount: number }>([
      { $group: { _id: '$rewardStatus', amount: { $sum: '$rewardAmount' } } },
    ]),
  ]);

  const reconciled = await Promise.all(rows.map((row) => reconcileReferral(row)));

  const ids = reconciled.flatMap((row) => [row.referrer, row.referred]);
  const accounts = await Student.find({ _id: { $in: ids } }).select(
    'studentId fullName email classLevel firstName lastName',
  );
  const byId = new Map(accounts.map((account) => [String(account._id), account]));

  const paidStudents = await Payment.find({
    student: { $in: reconciled.map((row) => row.referred) },
    purpose: 'olympiad_entry',
    status: 'captured',
  }).select('student');
  const hasPaid = new Set(paidStudents.map((payment) => String(payment.student)));

  const sumFor = (status: ReferralRewardStatus): number =>
    sums.find((row) => row._id === status)?.amount ?? 0;

  return {
    referrals: reconciled.map((row) => ({
      id: String(row._id),
      code: row.code,
      referrer: partyView(byId.get(String(row.referrer))),
      referred: partyView(byId.get(String(row.referred))),
      registeredAt: row.registeredAt,
      convertedAt: row.convertedAt,
      referredHasPaid: hasPaid.has(String(row.referred)),
      paymentId: row.payment ? String(row.payment) : null,
      rewardStatus: row.rewardStatus,
      rewardAmount: row.rewardAmount,
      rewardDisplay: `₹${(row.rewardAmount / 100).toFixed(2)}`,
      approvedAt: row.approvedAt,
      approvedBy: row.approvedBy,
      paidAt: row.paidAt,
      paidBy: row.paidBy,
      payoutReference: row.payoutReference,
      rejectedAt: row.rejectedAt,
      rejectedBy: row.rejectedBy,
      rejectedReason: row.rejectedReason,
    })),
    total,
    totals: {
      accruedPaise: sumFor('accrued'),
      approvedPaise: sumFor('approved'),
      paidPaise: sumFor('paid'),
    },
  };
}

// ---------------------------------------------------------------------------
// Administrative acts on a reward
// ---------------------------------------------------------------------------

/**
 * Every state change an administrator can make, as **conditional writes**.
 *
 * Each one names the state it is allowed to move *from*, so the transition is decided by
 * the database rather than by a read followed by a write. Two administrators pressing
 * "mark paid" at the same moment produce one payout and one "already paid" — which is the
 * whole point, because the second one is money leaving twice.
 *
 * An administrator can never *create* a reward or set its amount: the amount is
 * snapshotted at conversion from the settings, and these routes only move a row along.
 * That is what stops the console from being a way to pay an arbitrary sum to an arbitrary
 * person.
 */
async function transition(
  id: string,
  from: ReferralRewardStatus[],
  set: Record<string, unknown>,
  refusal: string,
): Promise<ReferralDocument> {
  const updated = await Referral.findOneAndUpdate(
    { _id: id, rewardStatus: { $in: from } },
    { $set: set },
    { new: true },
  );

  if (updated) return updated;

  const existing = await Referral.findById(id);
  if (!existing) throw ApiError.notFound('No referral with that id.');
  throw ApiError.conflict(`${refusal} This one is “${existing.rewardStatus.replace(/_/g, ' ')}”.`);
}

/** `accrued` → `approved`. Agreeing that a reward is payable. */
export async function approveReward(id: string, actor: string): Promise<ReferralDocument> {
  return transition(
    id,
    ['accrued'],
    { rewardStatus: 'approved', approvedAt: new Date(), approvedBy: actor },
    'Only a referral that has accrued a reward can be approved.',
  );
}

/**
 * `approved` → `paid`. **Terminal.**
 *
 * Deliberately not reachable from `accrued`: approving and paying are two decisions, and
 * collapsing them would remove the only checkpoint between "this looks payable" and "money
 * has left". A payout reference is required for the same reason a revocation reason is —
 * a payment nobody can trace is a payment nobody can verify happened.
 */
export async function markRewardPaid(id: string, actor: string, reference: string): Promise<ReferralDocument> {
  return transition(
    id,
    ['approved'],
    { rewardStatus: 'paid', paidAt: new Date(), paidBy: actor, payoutReference: reference },
    'Only an approved reward can be marked paid.',
  );
}

/**
 * → `rejected`, from anything that has not already been paid.
 *
 * A reason is mandatory. This is the row somebody will ask about, and "rejected" with no
 * explanation is the answer that generates the support ticket.
 */
export async function rejectReferral(id: string, actor: string, reason: string): Promise<ReferralDocument> {
  return transition(
    id,
    ['pending_conversion', 'no_reward', 'accrued', 'approved'],
    { rewardStatus: 'rejected', rejectedAt: new Date(), rejectedBy: actor, rejectedReason: reason },
    'A reward that has already been paid cannot be rejected.',
  );
}
