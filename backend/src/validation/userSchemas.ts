import { z } from 'zod';
import { AUDIT_ACTIONS } from '../models';
import { ASSIGNABLE_ROLES } from '../lib/permissions';

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
  status: z.enum(['active', 'suspended', 'deactivated']).optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  verified: z.enum(['true', 'false']).optional(),
});
export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;

/** `AMIT_0000`–`AMIT_9999`. Pinning the shape keeps a path param from becoming a filter. */
export const studentIdParamSchema = z.object({
  studentId: z
    .string()
    .trim()
    .regex(/^AMIT_\d{4}$/, 'studentId must look like AMIT_0000'),
});

export const updateStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'deactivated']),
  /** Recorded in the audit trail so a suspension always carries a stated reason. */
  reason: z.string().trim().min(3).max(500).optional(),
});
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

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
