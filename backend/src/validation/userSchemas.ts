import { z } from 'zod';
import { ACCOUNT_STATUSES, AUDIT_ACTIONS } from '../models';
import { ASSIGNABLE_ROLES, ROLES } from '../lib/permissions';
import { CLASS_LEVELS } from '../lib/classLevels';
import { STUDENT_PAYMENT_STATES, STUDENT_SORT_KEYS } from '../services/studentDirectoryService';

/**
 * Query params arrive as strings, and a repeated key still yields an array — the
 * same type-confusion hazard documented in `questionSchemas.ts`. Everything the
 * admin listing feeds into a Mongoose filter is parsed here first, so no operator
 * object from `req.query` can reach the database. See SECURITY.md.
 */
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

/**
 * A calendar day from a date input, as an inclusive bound on `registeredAt`.
 *
 * `from` anchors to the start of the day and `to` to its end, in UTC. Both bounds being
 * inclusive is what a human means by "registered between the 1st and the 7th" — a naive
 * `$lte` against midnight would silently drop everybody who registered on the last day,
 * which is the day an administrator is usually most interested in.
 */
const registeredBound = (end: boolean) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form YYYY-MM-DD')
    .transform((value) => new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`))
    .refine((date) => !Number.isNaN(date.getTime()), 'That is not a real date');

/**
 * The student directory's filters (Milestone 22).
 *
 * Shared by the listing and the export, deliberately: the export's whole promise is that
 * it contains what the screen showed, and it cannot keep that promise if the two accept
 * different parameters. Everything here is an enum, a bounded string or a parsed date
 * before it reaches a Mongo stage.
 */
const directoryFilters = {
  /** Free-text match on name, email, mobile, student ID or school. */
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  // The full role list, not the assignable subset: the super admin now has a
  // document, and a listing that could not filter for it would be hiding the most
  // privileged account in the system from the person auditing it.
  role: z.enum(ROLES).optional(),
  verified: z.enum(['true', 'false']).optional(),
  classLevel: z.enum(CLASS_LEVELS).optional(),
  /**
   * The **derived** entry-payment state — see `STUDENT_PAYMENT_STATES`. Optional, and
   * absent by default on purpose: the directory's job is to show everyone who registered,
   * so it must never default to the paid subset.
   */
  paymentState: z.enum(STUDENT_PAYMENT_STATES).optional(),
  registeredFrom: registeredBound(false).optional(),
  registeredTo: registeredBound(true).optional(),
  sort: z.enum(STUDENT_SORT_KEYS).default('registeredAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
};

export const listStudentsQuerySchema = z.object({
  ...pagination,
  ...directoryFilters,
});
export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;

/**
 * The export (Milestone 22).
 *
 * Takes the same filters and no pagination — the file is the whole result set — plus one
 * extra decision the administrator has to make explicitly.
 *
 * `scope: 'all'` **ignores every filter** and exports the entire roll. It is a separate
 * parameter rather than "send no filters", because the two intentions are different and
 * only one of them is safe to infer: a client that dropped its filters through a bug
 * would otherwise silently download the whole database. Making it an explicit word means
 * the request says which of the two it meant, and the response can say so back.
 */
export const exportStudentsQuerySchema = z.object({
  ...directoryFilters,
  scope: z.enum(['filtered', 'all']).default('filtered'),
});
export type ExportStudentsQuery = z.infer<typeof exportStudentsQuerySchema>;

/**
 * Two namespaces, both four digits: `AMIT_xxxx` for entrants and `ADMIN_xxxx` for
 * staff accounts created by the bootstrap. Pinning the shape keeps a path param
 * from becoming a filter.
 *
 * `ADMIN_` is accepted here deliberately, even though the super administrator can
 * never be acted on: refusing it at the schema would answer "must look like
 * AMIT_0000", which is a format complaint about a perfectly well-formed id and
 * sends the caller looking for the wrong problem. Letting it through means the
 * request reaches `refuseIfProtected()` and gets the true answer — that this
 * account is not managed through the API — and it keeps that guard exercised by
 * real requests rather than sitting unreachable behind a regex.
 */
const ACCOUNT_ID_PATTERN = /^(?:AMIT|ADMIN)_\d{4}$/;

export const studentIdParamSchema = z.object({
  studentId: z.string().trim().regex(ACCOUNT_ID_PATTERN, 'studentId must look like AMIT_0000'),
});

export const updateStatusSchema = z.object({
  status: z.enum(ACCOUNT_STATUSES),
  /** Recorded in the audit trail so a suspension always carries a stated reason. */
  reason: z.string().trim().min(3).max(500).optional(),
});
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

/**
 * The three account actions that take something away. Each carries an optional
 * stated reason for the same purpose as a suspension's: the trail should be able
 * to answer "why" without anyone having to remember.
 */
export const accountActionSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});
export type AccountActionInput = z.infer<typeof accountActionSchema>;

/**
 * Deleting an account is the one irreversible administrative act, so it asks the
 * caller to retype the account's own identifier. This is not authorization — the
 * permission gate already happened — it is a guard against the wrong row: the
 * confirmation is worthless unless it is something only someone looking at the
 * right account can supply.
 */
export const deleteAccountSchema = accountActionSchema.extend({
  confirmStudentId: z.string().trim().regex(ACCOUNT_ID_PATTERN, 'Type the account’s student ID to confirm'),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export const updateRoleSchema = z.object({
  // `superadmin` is intentionally absent: the root admin comes from environment
  // variables only, so no API call can ever mint another one.
  role: z.enum(ASSIGNABLE_ROLES),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const listAuditLogsQuerySchema = z.object({
  ...pagination,
  action: z.enum(AUDIT_ACTIONS).optional(),
  outcome: z.enum(['success', 'denied']).optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
