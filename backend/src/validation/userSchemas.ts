import { z } from 'zod';
import { ACCOUNT_STATUSES, AUDIT_ACTIONS } from '../models';
import { ASSIGNABLE_ROLES, ROLES } from '../lib/permissions';

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

export const listStudentsQuerySchema = z.object({
  ...pagination,
  /** Free-text match on name, email, mobile or student ID. */
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  // The full role list, not the assignable subset: the super admin now has a
  // document, and a listing that could not filter for it would be hiding the most
  // privileged account in the system from the person auditing it.
  role: z.enum(ROLES).optional(),
  verified: z.enum(['true', 'false']).optional(),
});
export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;

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
