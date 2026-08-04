import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission, callerCan, callerCanFresh } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { AuditLog, Student, StudentPhoto, type AccountStatus, type AuditAction, type StudentDocument } from '../../models';
import type { AssignableRole } from '../../lib/permissions';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { recordAudit } from '../../lib/audit';
import { revokeAllRefreshTokens } from '../../lib/tokens';
import { logger } from '../../lib/logger';
import {
  listStudentsQuerySchema,
  studentIdParamSchema,
  updateStatusSchema,
  updateRoleSchema,
  listAuditLogsQuerySchema,
  type ListStudentsQuery,
  type UpdateStatusInput,
  type UpdateRoleInput,
  type ListAuditLogsQuery,
} from '../../validation/userSchemas';
import type mongoose from 'mongoose';

const router = Router();

/**
 * Mongoose 9 no longer exports a public `FilterQuery`, so the shape of each filter
 * is spelled out here. Being explicit is the point: the listing endpoints accept
 * user-controlled query params, and a narrow type is what guarantees only these
 * fields — never an operator object smuggled in from `req.query` — can reach Mongo.
 * (`any` is forbidden on the backend; see CLAUDE.md "TypeScript Rules".)
 */
interface StudentFilter {
  status?: AccountStatus;
  role?: AssignableRole;
  isEmailVerified?: boolean;
  $or?: Array<{ fullName?: RegExp } | { email?: RegExp } | { mobile?: RegExp } | { studentId?: RegExp }>;
}

interface AuditFilter {
  action?: AuditAction;
  outcome?: 'success' | 'denied';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The shape of an account as an administrator sees it. Wider than the student's
 * own `publicStudent` view (it adds role, activity and lock state) but still an
 * explicit allow-list — `passwordHash` is `select: false` and nothing here would
 * pick it up even if that guard were lost.
 */
function adminAccountView(account: StudentDocument) {
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
    // Milestone 4 registration details. Nullable throughout because accounts
    // created before Milestone 4 do not have them (see DATABASE_SCHEMA.md).
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

/** Escapes a user-supplied string so it is matched literally, never as a pattern. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function objectId(account: StudentDocument): mongoose.Types.ObjectId {
  return account._id as mongoose.Types.ObjectId;
}

/** True when the actor is acting on their own account. */
function isSelf(req: Request, account: StudentDocument): boolean {
  return req.user?.sub === String(account._id);
}

/**
 * Ends every live session for an account: revokes its refresh tokens and bumps
 * `tokenVersion` so already-issued access tokens are rejected on their next
 * privileged request. Used whenever an account loses standing (suspension) or
 * changes role, so the change takes effect now rather than at token expiry.
 */
async function terminateSessions(account: StudentDocument): Promise<void> {
  account.tokenVersion += 1;
  await revokeAllRefreshTokens(objectId(account));
}

// ---------------------------------------------------------------------------
// Student / account listing
// ---------------------------------------------------------------------------

router.get(
  '/admin/students',
  requirePermission('students:read'),
  validate({ query: listStudentsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, search, status, role, verified } = req.query as unknown as ListStudentsQuery;

      // Built field by field from validated values only — no part of req.query is
      // ever spread into the filter, so no operator object can reach Mongo.
      const filter: StudentFilter = {};
      if (status) filter.status = status;
      if (role) filter.role = role;
      if (verified) filter.isEmailVerified = verified === 'true';
      if (search) {
        const pattern = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ fullName: pattern }, { email: pattern }, { mobile: pattern }, { studentId: pattern }];
      }

      const [accounts, total] = await Promise.all([
        Student.find(filter)
          .sort({ registeredAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Student.countDocuments(filter),
      ]);

      sendSuccess(res, 200, {
        students: accounts.map(adminAccountView),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list students');
      sendError(res, 500, 'Could not load the student list. Please try again.');
    }
  },
);

router.get(
  '/admin/students/:studentId',
  requirePermission('students:read'),
  validate({ params: studentIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const account = await Student.findOne({ studentId: req.params.studentId });
      if (!account) {
        sendError(res, 404, 'No account exists with that student ID.');
        return;
      }
      sendSuccess(res, 200, { student: adminAccountView(account) });
    } catch (err) {
      logger.error({ err }, 'Failed to load student');
      sendError(res, 500, 'Could not load that account. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Account status (suspend / deactivate / reactivate)
// ---------------------------------------------------------------------------

/**
 * Gives the `status` field the administrative UI it never had — until now only a
 * direct database edit could set it (recorded as a known gap in PROJECT_STATE.md).
 */
router.patch(
  '/admin/students/:studentId/status',
  requirePermission('students:status:write'),
  validate({ params: studentIdParamSchema, body: updateStatusSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { status, reason } = req.body as UpdateStatusInput;
      const account = await Student.findOne({ studentId: req.params.studentId });

      if (!account) {
        sendError(res, 404, 'No account exists with that student ID.');
        return;
      }
      if (isSelf(req, account)) {
        sendError(res, 409, 'You cannot change the status of your own account.');
        return;
      }
      // An ordinary admin must not be able to disable a peer — that is a lateral
      // move against the people who could otherwise stop them. Only the role
      // owner (the super admin) may act on an account that holds a role.
      if (account.role !== 'student' && !callerCan(req, 'users:role:write')) {
        sendError(res, 403, 'Only a super admin can change the status of an administrator account.');
        return;
      }

      const previous = account.status;
      if (previous === status) {
        sendSuccess(res, 200, { changed: false, student: adminAccountView(account) });
        return;
      }

      account.status = status;
      if (status === 'active') {
        // Reinstating clears the failure counter and any standing lock, otherwise
        // the account would come back still locked out.
        account.failedLoginAttempts = 0;
        account.lockedUntil = null;
        await account.save();
      } else {
        await terminateSessions(account);
        await account.save();
      }

      await recordAudit(req, {
        action: 'student.status.changed',
        targetType: 'student',
        targetId: account.studentId,
        targetLabel: account.email,
        metadata: { from: previous, to: status, reason: reason ?? null },
      });

      sendSuccess(res, 200, { changed: true, student: adminAccountView(account) });
    } catch (err) {
      logger.error({ err }, 'Failed to change account status');
      sendError(res, 500, 'Could not update that account. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Role assignment (super admin only)
// ---------------------------------------------------------------------------

/**
 * Grants or revokes the `admin` role on an existing account. Confined to
 * `users:role:write`, which only the super admin holds — an admin cannot mint
 * further admins, so a single compromised admin session cannot widen itself.
 */
router.patch(
  '/admin/users/:studentId/role',
  requirePermission('users:role:write'),
  validate({ params: studentIdParamSchema, body: updateRoleSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { role, reason } = req.body as UpdateRoleInput;
      const account = await Student.findOne({ studentId: req.params.studentId });

      if (!account) {
        sendError(res, 404, 'No account exists with that student ID.');
        return;
      }
      if (isSelf(req, account)) {
        sendError(res, 409, 'You cannot change your own role.');
        return;
      }

      const previous = account.role;
      if (previous === role) {
        sendSuccess(res, 200, { changed: false, student: adminAccountView(account) });
        return;
      }

      // Never hand administrative access to an account whose owner has not proven
      // control of the mailbox, or that is not in good standing.
      if (role === 'admin' && (!account.isEmailVerified || account.status !== 'active')) {
        sendError(res, 409, 'Only a verified, active account can be made an administrator.');
        return;
      }

      account.role = role;
      account.roleUpdatedAt = new Date();
      account.roleUpdatedBy = req.user?.email ?? req.user?.studentId ?? 'unknown';
      // Force a fresh sign-in: the role lives in the access token, and revoking
      // here means a demotion cannot be outlived by an already-issued token even
      // for the seconds before the freshness check would catch it.
      await terminateSessions(account);
      await account.save();

      await recordAudit(req, {
        action: 'user.role.changed',
        targetType: 'student',
        targetId: account.studentId,
        targetLabel: account.email,
        metadata: { from: previous, to: role, reason: reason ?? null },
      });

      logger.warn(
        { target: account.studentId, from: previous, to: role, actor: req.user?.email },
        'Account role changed',
      );

      sendSuccess(res, 200, { changed: true, student: adminAccountView(account) });
    } catch (err) {
      logger.error({ err }, 'Failed to change account role');
      sendError(res, 500, 'Could not update that role. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Registration photo
// ---------------------------------------------------------------------------

/**
 * Serves a student's registration photo as raw image bytes.
 *
 * The gate is identity-based rather than a single permission, because both
 * answers are legitimate: a student may fetch their own photo, and a member of
 * staff holding `students:read` may fetch anyone's. The staff half is checked
 * *fresh* against the database — this is someone else's personal data, so a
 * demoted admin must not keep reading it for the remainder of their access
 * token's life (CLAUDE.md, "Backend Conventions").
 */
router.get(
  '/students/:studentId/photo',
  requireAuth(),
  validate({ params: studentIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const isOwnRecord = req.user!.studentId === req.params.studentId;
      if (!isOwnRecord && !(await callerCanFresh(req, 'students:read'))) {
        sendError(res, 403, 'You can only view your own photo.');
        return;
      }

      const account = await Student.findOne({ studentId: req.params.studentId }).select('_id');
      if (!account) {
        sendError(res, 404, 'No account exists with that student ID.');
        return;
      }

      const photo = await StudentPhoto.findOne({ student: account._id });
      if (!photo) {
        sendError(res, 404, 'No photo has been uploaded for this account.');
        return;
      }

      // `private` because this is personal data behind an authorization check:
      // a shared cache must never hand one student's photo to another.
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Type', photo.contentType);
      res.setHeader('Content-Length', String(photo.size));
      res.send(photo.data);
    } catch (err) {
      logger.error({ err }, 'Failed to load student photo');
      sendError(res, 500, 'Could not load that photo. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

router.get(
  '/admin/audit-logs',
  requirePermission('audit:read'),
  validate({ query: listAuditLogsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, action, outcome } = req.query as unknown as ListAuditLogsQuery;

      const filter: AuditFilter = {};
      if (action) filter.action = action;
      if (outcome) filter.outcome = outcome;

      const [entries, total] = await Promise.all([
        AuditLog.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        AuditLog.countDocuments(filter),
      ]);

      sendSuccess(res, 200, {
        entries: entries.map((entry) => ({
          id: String(entry._id),
          action: entry.action,
          actorRole: entry.actorRole,
          actorLabel: entry.actorLabel,
          targetType: entry.targetType,
          targetId: entry.targetId ?? null,
          targetLabel: entry.targetLabel ?? null,
          outcome: entry.outcome,
          metadata: entry.metadata ?? null,
          ip: entry.ip ?? null,
          createdAt: entry.createdAt,
        })),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list audit logs');
      sendError(res, 500, 'Could not load the audit trail. Please try again.');
    }
  },
);

export default router;
