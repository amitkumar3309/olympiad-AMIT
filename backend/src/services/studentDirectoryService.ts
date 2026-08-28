import type { PipelineStage, Types } from 'mongoose';
import { Payment, Referral, Student, type AccountStatus, type PaymentPurpose } from '../models';
import { paymentView, type PaymentViewFields } from './paymentService';
import type { ClassLevel } from '../lib/classLevels';
import type { Role } from '../lib/permissions';

/**
 * THE student directory (Milestone 22, Phase B): every registered account, with what
 * the platform actually knows about its entry payment.
 *
 * ## One assembly, two outputs
 *
 * `GET /admin/students` and `GET /admin/students/export` are the same query with a
 * different renderer. That is deliberate and it is the whole reason this file exists: an
 * export built from its own second query is an export that quietly disagrees with the
 * table the administrator was looking at when they pressed the button — and the person
 * who spots the disagreement is whoever is reconciling the money, months later. Add a
 * filter here and both surfaces gain it.
 *
 * ## Payment state is DERIVED, never stored
 *
 * There is no `paymentStatus` field on `Student`, and there must not be one, for exactly
 * the reason there is no `hasPaid` flag (see the note at the top of `models/Payment.ts`):
 * a stored rollup is a second source of truth about money, and when it drifts a student
 * who paid is shown as unpaid. The state below is computed from the student's own
 * `Payment` rows on every read, in the database, so it cannot drift and so it can be
 * filtered and paginated correctly.
 *
 * ## Nobody is filtered out for not having paid
 *
 * The directory's purpose is a **complete** view of everyone who registered. With no
 * payment filter applied, a student with no payment row at all appears exactly as
 * prominently as one who has paid; `not_started` is a first-class state rather than an
 * absence. A filter narrows the list only when an administrator asks for it.
 *
 * ## An aggregation bypasses `select: false`
 *
 * `Student.passwordHash` is excluded at the schema level, which protects `find()` and
 * nothing else — an aggregation pipeline reads the raw document. Every stage that can
 * reach a response therefore ends in an **explicit `$project` allow-list**
 * (`ACCOUNT_PROJECTION` below). Do not replace it with an exclusion list: a field added
 * to `Student` later would then be published by default, and the field most likely to be
 * added to a student record is another secret.
 */

/** Only the entry fee is in scope here; it is the only purpose that exists today. */
const ENTRY_PURPOSE: PaymentPurpose = 'olympiad_entry';

/**
 * A student's entry-payment state, rolled up from their `Payment` rows.
 *
 * Five values, each a distinct fact an administrator acts on differently:
 *
 * - `paid`        — a captured payment exists. This is the entitlement.
 * - `refunded`    — money was taken and given back. Kept apart from `failed` because one
 *                   is a decision somebody made and the other is a card that did not work.
 * - `failed`      — the most recent attempt failed and none ever succeeded.
 * - `pending`     — an order exists and has not resolved either way (`created`/`attempted`):
 *                   a checkout that was opened and abandoned, or one still in flight.
 * - `not_started` — no payment row at all. Registered, never attempted to pay.
 *
 * There is deliberately **no `cancelled`**: the platform has no such payment status, and
 * inventing one here would put a state on an administrator's screen that no code path can
 * ever produce. If Razorpay cancellations are ever recorded, add the status to
 * `PAYMENT_STATUSES` first and this rollup second.
 */
export const STUDENT_PAYMENT_STATES = ['paid', 'pending', 'failed', 'refunded', 'not_started'] as const;
export type StudentPaymentState = (typeof STUDENT_PAYMENT_STATES)[number];

/**
 * Sort keys a client may ask for, mapped to a real field below.
 *
 * An allow-list rather than passing the parameter through, for the reason
 * `QUESTION_SORT_KEYS` gives: a raw `sort` value from `req.query` reaching Mongo lets a
 * caller sort by any field — including unindexed ones, which is a cheap way to make the
 * database do expensive work — and, with an object-shaped value, worse.
 */
export const STUDENT_SORT_KEYS = [
  'registeredAt',
  'fullName',
  'classLevel',
  'lastLoginAt',
  'paymentState',
  'paymentAmount',
] as const;
export type StudentSortKey = (typeof STUDENT_SORT_KEYS)[number];

const SORT_FIELDS: Record<StudentSortKey, string> = {
  registeredAt: 'registeredAt',
  fullName: 'fullName',
  classLevel: 'classLevel',
  lastLoginAt: 'lastLoginAt',
  // Alphabetical on the derived state, which groups the board by payment state — the
  // useful reading of it. It is not a "progress" order, and no order over five unrelated
  // facts would be.
  paymentState: 'paymentState',
  paymentAmount: 'payment.amount',
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface StudentDirectoryFilters {
  search?: string;
  status?: AccountStatus;
  role?: Role;
  verified?: 'true' | 'false';
  classLevel?: ClassLevel;
  paymentState?: StudentPaymentState;
  /** Inclusive `registeredAt` bounds, already parsed to dates by the schema. */
  registeredFrom?: Date;
  registeredTo?: Date;
}

export interface StudentDirectoryQuery extends StudentDirectoryFilters {
  sort: StudentSortKey;
  order: 'asc' | 'desc';
}

/** Escapes a user-supplied string so it is matched literally, never as a pattern. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The `Student` half of the filter, built field by field from validated values only.
 *
 * No part of `req.query` is ever spread in, so no operator object can reach Mongo — the
 * same discipline the rest of the admin listings follow (see SECURITY.md).
 */
interface StudentMatch {
  status?: AccountStatus;
  role?: Role;
  isEmailVerified?: boolean;
  classLevel?: ClassLevel;
  registeredAt?: { $gte?: Date; $lte?: Date };
  $or?: Array<Record<string, RegExp>>;
}

function studentMatchFor(filters: StudentDirectoryFilters): StudentMatch {
  const match: StudentMatch = {};
  if (filters.status) match.status = filters.status;
  if (filters.role) match.role = filters.role;
  if (filters.verified) match.isEmailVerified = filters.verified === 'true';
  if (filters.classLevel) match.classLevel = filters.classLevel;

  if (filters.registeredFrom || filters.registeredTo) {
    match.registeredAt = {};
    if (filters.registeredFrom) match.registeredAt.$gte = filters.registeredFrom;
    if (filters.registeredTo) match.registeredAt.$lte = filters.registeredTo;
  }

  if (filters.search) {
    const pattern = new RegExp(escapeRegex(filters.search), 'i');
    // `schoolName` is here and is not in the older `find()`-based filter: a competition
    // desk is routinely asked for "everyone from St Xavier's", and a directory that
    // cannot answer that sends staff to a spreadsheet.
    match.$or = [
      { fullName: pattern },
      { email: pattern },
      { mobile: pattern },
      { studentId: pattern },
      { schoolName: pattern },
    ];
  }

  return match;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Fields published about an account. An allow-list — see the note at the top of the file
 * about `select: false` not applying to an aggregation.
 */
const ACCOUNT_PROJECTION = {
  studentId: 1,
  fullName: 1,
  firstName: 1,
  middleName: 1,
  lastName: 1,
  fatherName: 1,
  motherName: 1,
  dateOfBirth: 1,
  classLevel: 1,
  schoolName: 1,
  address: 1,
  email: 1,
  mobile: 1,
  role: 1,
  status: 1,
  isEmailVerified: 1,
  registeredAt: 1,
  lastLoginAt: 1,
  lockedUntil: 1,
  roleUpdatedAt: 1,
  roleUpdatedBy: 1,
  mustChangePassword: 1,
  passwordResetAt: 1,
  passwordResetBy: 1,
  referralCode: 1,
  // Derived above, not stored.
  paymentState: 1,
  paymentAttempts: 1,
  payment: 1,
  referredBy: 1,
} as const;

/** The payment fields `paymentView()` reads, and nothing more. */
const PAYMENT_PROJECTION = {
  _id: 1,
  purpose: 1,
  amount: 1,
  currency: 1,
  status: 1,
  method: 1,
  razorpayOrderId: 1,
  razorpayPaymentId: 1,
  failureReason: 1,
  capturedAt: 1,
  createdAt: 1,
} as const;

/**
 * Everything up to and including the payment-state filter, shared by the paged listing
 * and the export so the two cannot select different students.
 */
function directoryPipeline(filters: StudentDirectoryFilters): PipelineStage[] {
  const stages: PipelineStage[] = [{ $match: studentMatchFor(filters) }];

  stages.push({
    $lookup: {
      // Read from the model rather than hardcoding `'payments'`, so renaming the
      // collection cannot leave a silently empty join behind.
      from: Payment.collection.name,
      let: { studentId: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$student', '$$studentId'] }, purpose: ENTRY_PURPOSE } },
        // Newest first, so element 0 is always "the latest attempt".
        { $sort: { createdAt: -1 } },
        { $project: PAYMENT_PROJECTION },
      ],
      as: 'entryPayments',
    },
  });

  stages.push({
    $addFields: {
      capturedPayments: {
        $filter: { input: '$entryPayments', as: 'p', cond: { $eq: ['$$p.status', 'captured'] } },
      },
      refundedPayments: {
        $filter: { input: '$entryPayments', as: 'p', cond: { $eq: ['$$p.status', 'refunded'] } },
      },
    },
  });

  stages.push({
    $addFields: {
      paymentState: {
        $switch: {
          branches: [
            // Order matters. A captured payment is the entitlement and outranks
            // everything else on the row: a student who failed twice and then paid has
            // paid. A refund outranks a failure for the same reason in reverse — it is
            // the later, deliberate fact about the money.
            { case: { $gt: [{ $size: '$capturedPayments' }, 0] }, then: 'paid' },
            { case: { $gt: [{ $size: '$refundedPayments' }, 0] }, then: 'refunded' },
            { case: { $eq: [{ $size: '$entryPayments' }, 0] }, then: 'not_started' },
            { case: { $eq: [{ $arrayElemAt: ['$entryPayments.status', 0] }, 'failed'] }, then: 'failed' },
          ],
          // `created` and `attempted`: an order that has not resolved either way.
          default: 'pending',
        },
      },
      /**
       * The row's representative payment: the captured one if there is one, otherwise the
       * most recent attempt. Staff asking "what happened with this student's money?" want
       * the successful payment where one exists and the last failure where one does not.
       *
       * The three-argument `$ifNull` is deliberate: `$arrayElemAt` on an empty array
       * returns *missing* rather than null, and a missing field would leave `payment`
       * absent from the document instead of explicitly null.
       */
      payment: {
        $ifNull: [{ $arrayElemAt: ['$capturedPayments', 0] }, { $arrayElemAt: ['$entryPayments', 0] }, null],
      },
      /** How many times this student has tried. `0` for a student who never started. */
      paymentAttempts: { $size: '$entryPayments' },
    },
  });

  /**
   * Who introduced this student (Milestone 22, Phase E).
   *
   * A second join rather than a field on `Student`, because the referral is its own record
   * with its own reward lifecycle — see `models/Referral.ts`. Only the referrer's readable
   * id and name are pulled through; the reward state belongs to the referral console, not
   * to a column in the student list.
   */
  stages.push({
    $lookup: {
      from: Referral.collection.name,
      let: { studentId: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$referred', '$$studentId'] } } },
        { $limit: 1 },
        {
          $lookup: {
            from: Student.collection.name,
            localField: 'referrer',
            foreignField: '_id',
            as: 'referrerAccount',
          },
        },
        {
          $project: {
            _id: 0,
            code: 1,
            studentId: { $first: '$referrerAccount.studentId' },
            fullName: { $first: '$referrerAccount.fullName' },
          },
        },
      ],
      as: 'referralRows',
    },
  });

  stages.push({
    $addFields: {
      referredBy: { $ifNull: [{ $arrayElemAt: ['$referralRows', 0] }, null] },
    },
  });

  // Applied *after* the rollup, because it filters on the derived value. Doing it in the
  // database rather than in JavaScript is what makes the page counts and the pagination
  // correct — a filter applied after `$limit` would return short pages and a wrong total.
  if (filters.paymentState) {
    stages.push({ $match: { paymentState: filters.paymentState } });
  }

  return stages;
}

function sortStage(query: StudentDirectoryQuery): PipelineStage.Sort {
  const direction = query.order === 'asc' ? 1 : -1;
  return {
    // `_id` is the tiebreaker, and it is not optional: without a total order, two
    // students with the same registration instant (or the same class, or the same
    // payment state) can appear on two consecutive pages or on neither. The leaderboard
    // learned this the hard way; see `services/leaderboardService.ts`.
    $sort: { [SORT_FIELDS[query.sort]]: direction, _id: 1 },
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** The account fields the admin view reads. Satisfied by a document *and* by a lean row. */
export interface AdminAccountFields {
  _id: unknown;
  studentId: string;
  fullName?: string | null;
  email: string;
  mobile: string;
  role: Role;
  status: AccountStatus;
  isEmailVerified: boolean;
  registeredAt: Date;
  lastLoginAt?: Date | null;
  lockedUntil?: Date | null;
  roleUpdatedAt?: Date | null;
  roleUpdatedBy?: string | null;
  mustChangePassword?: boolean;
  passwordResetAt?: Date | null;
  passwordResetBy?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  dateOfBirth?: Date | null;
  classLevel?: ClassLevel | null;
  schoolName?: string | null;
  address?: string | null;
}

/**
 * The shape of an account as an administrator sees it. Wider than the student's own
 * `publicStudent` view (it adds role, activity and lock state) but still an explicit
 * allow-list — `passwordHash` is `select: false` and nothing here would pick it up even if
 * that guard were lost.
 *
 * Typed against a **field interface** rather than `StudentDocument` so the directory
 * aggregation, which returns plain objects, renders through this same function. Two views
 * of an account would eventually disagree about what staff may see, and the more generous
 * one would win.
 */
export function adminAccountView(account: AdminAccountFields) {
  return {
    id: String(account._id),
    studentId: account.studentId,
    fullName: account.fullName ?? null,
    email: account.email,
    mobile: account.mobile,
    role: account.role,
    status: account.status,
    isEmailVerified: account.isEmailVerified,
    registeredAt: account.registeredAt,
    lastLoginAt: account.lastLoginAt ?? null,
    lockedUntil: account.lockedUntil ?? null,
    roleUpdatedAt: account.roleUpdatedAt ?? null,
    roleUpdatedBy: account.roleUpdatedBy ?? null,
    // Staff need to see that a reset is outstanding: an account sitting on a temporary
    // password looks identical to a working one otherwise.
    mustChangePassword: account.mustChangePassword === true,
    passwordResetAt: account.passwordResetAt ?? null,
    passwordResetBy: account.passwordResetBy ?? null,
    // Milestone 4 registration details. Nullable throughout because accounts created
    // before Milestone 4 do not have them (see DATABASE_SCHEMA.md).
    firstName: account.firstName ?? null,
    middleName: account.middleName ?? null,
    lastName: account.lastName ?? null,
    fatherName: account.fatherName ?? null,
    motherName: account.motherName ?? null,
    dateOfBirth: account.dateOfBirth ? account.dateOfBirth.toISOString().slice(0, 10) : null,
    classLevel: account.classLevel ?? null,
    schoolName: account.schoolName ?? null,
    address: account.address ?? null,
  };
}

/** Who introduced this student, joined from `Referral`. `null` for most accounts. */
export interface ReferredByView {
  code: string;
  studentId: string | null;
  fullName: string | null;
}

/** One row of the aggregation: an account, its rolled-up entry payment, and its referrer. */
interface DirectoryRow extends AdminAccountFields {
  paymentState: StudentPaymentState;
  paymentAttempts: number;
  payment: PaymentViewFields | null;
  referralCode?: string | null;
  referredBy?: ReferredByView | null;
}

export type StudentDirectoryEntry = ReturnType<typeof directoryEntryView>;

/**
 * One directory row as the API publishes it.
 *
 * The payment half goes through `paymentView()` — the same formatter the student's own
 * payment history uses — so paise-to-rupees happens in exactly one place and the console
 * cannot display a different amount from the student's receipt. It never includes
 * `razorpaySignature`; that field is not even projected out of the collection.
 */
export function directoryEntryView(row: DirectoryRow) {
  return {
    ...adminAccountView(row),
    paymentState: row.paymentState,
    paymentAttempts: row.paymentAttempts,
    /** The entitlement, stated plainly rather than left for a client to re-derive. */
    hasPaid: row.paymentState === 'paid',
    payment: row.payment ? paymentView(row.payment) : null,
    /** This student's own Refer & Earn code, once they have asked for one. */
    referralCode: row.referralCode ?? null,
    /** Who introduced them, or `null`. */
    referredBy: row.referredBy ?? null,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface StudentDirectoryPage {
  entries: StudentDirectoryEntry[];
  total: number;
}

interface FacetResult {
  rows: DirectoryRow[];
  total: Array<{ value: number }>;
}

/** One page of the directory, with the total for the same filters. */
export async function listStudentDirectory(
  query: StudentDirectoryQuery,
  page: number,
  limit: number,
): Promise<StudentDirectoryPage> {
  const facet = await Student.aggregate<FacetResult>([
    ...directoryPipeline(query),
    {
      // One round trip for the rows and the count. They must come from the same
      // pipeline: a `countDocuments` beside a filtered aggregation is how a total of 40
      // ends up over a list of 12.
      $facet: {
        rows: [sortStage(query), { $skip: (page - 1) * limit }, { $limit: limit }, { $project: ACCOUNT_PROJECTION }],
        total: [{ $count: 'value' }],
      },
    },
  ]);

  const result = facet[0];
  return {
    entries: (result?.rows ?? []).map(directoryEntryView),
    total: result?.total[0]?.value ?? 0,
  };
}

/**
 * Every matching row, for the export. **No pagination**, so it is bounded instead.
 *
 * Returns `overflowed` rather than silently truncating. A spreadsheet that is quietly
 * missing its last four thousand students is worse than a refusal: it looks complete,
 * gets filed, and is reconciled against months later. The caller turns this into a
 * message naming the cap.
 */
export async function collectStudentDirectory(
  query: StudentDirectoryQuery,
  cap: number,
): Promise<{ entries: StudentDirectoryEntry[]; overflowed: boolean }> {
  const rows = await Student.aggregate<DirectoryRow>([
    ...directoryPipeline(query),
    sortStage(query),
    // One more than the cap, so "there are too many" is answered by the same read that
    // fetches them rather than by a second count.
    { $limit: cap + 1 },
    { $project: ACCOUNT_PROJECTION },
  ]);

  if (rows.length > cap) return { entries: [], overflowed: true };
  return { entries: rows.map(directoryEntryView), overflowed: false };
}

/** Re-exported so route code has one import for the id type it passes around. */
export type { Types };
