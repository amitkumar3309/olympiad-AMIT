import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission, callerCan, callerCanFresh } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { adminActionLimiter, exportLimiter } from '../../middleware/rateLimiter';
import { AuditLog, Student, StudentPhoto, type AuditAction, type StudentDocument } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { recordAudit } from '../../lib/audit';
import { revokeAllRefreshTokens } from '../../lib/tokens';
import { hashPassword } from '../../lib/password';
import { logger } from '../../lib/logger';
import { notifyAccountRoleChanged, notifyAccountStatusChanged } from '../../services/systemNotifier';
import { adminAccountView, collectStudentDirectory, listStudentDirectory } from '../../services/studentDirectoryService';
import {
  buildStudentExportWorkbook,
  describeExport,
  studentExportFilename,
  EXPORT_MAX_ROWS,
} from '../../services/studentExportExcel';
import {
  listStudentsQuerySchema,
  exportStudentsQuerySchema,
  studentIdParamSchema,
  updateStatusSchema,
  updateRoleSchema,
  accountActionSchema,
  deleteAccountSchema,
  listAuditLogsQuerySchema,
  type ListStudentsQuery,
  type ExportStudentsQuery,
  type UpdateStatusInput,
  type UpdateRoleInput,
  type AccountActionInput,
  type DeleteAccountInput,
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
 *
 * The student listing's own filter moved to `services/studentDirectoryService.ts` in
 * Milestone 22, because the export has to build the identical one.
 */
interface AuditFilter {
  action?: AuditAction;
  outcome?: 'success' | 'denied';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `adminAccountView()` lives in `services/studentDirectoryService.ts` as of Milestone 22
 * and is imported above. It moved because the directory aggregation returns plain objects
 * rather than documents and had to render through the *same* view — two views of an
 * account would eventually disagree about what staff may see, and the more generous one
 * would win.
 */

function objectId(account: StudentDocument): mongoose.Types.ObjectId {
  return account._id as mongoose.Types.ObjectId;
}

/** True when the actor is acting on their own account. */
function isSelf(req: Request, account: StudentDocument): boolean {
  return req.user?.sub === String(account._id);
}

/**
 * The one place that decides whether a caller may act **on this particular
 * account**, as opposed to whether they may perform the action at all — which
 * `requirePermission` already settled at the route.
 *
 * Two rules, and every account-management route applies them before doing
 * anything:
 *
 * 1. **The super administrator is not manageable through the API.** Not suspended,
 *    not demoted, not deleted, not password-reset — by anybody, including itself.
 *    It is the account that can restore all the others, so a mistake here is the
 *    one with no way back. Withdrawing it means changing the environment and
 *    redeploying, which is a deliberately higher bar than a click.
 * 2. **An ordinary admin may only act on plain students.** Acting on an account
 *    that holds a role is a lateral move against the very people who could stop a
 *    misbehaving admin, so it needs the super admin's own permission.
 *
 * Returning a message rather than a boolean keeps the refusal specific: "you may
 * not do this to an administrator" and "nobody may do this to the super admin" are
 * different facts, and a caller who cannot tell them apart will file the wrong bug.
 */
function refuseIfProtected(req: Request, account: StudentDocument): string | null {
  if (account.role === 'superadmin') {
    return 'The super administrator account cannot be managed through the API.';
  }
  if (account.role !== 'student' && !callerCan(req, 'users:role:write')) {
    return 'Only a super admin can act on an administrator account.';
  }
  return null;
}

/**
 * A temporary password, generated server-side and shown to staff exactly once.
 *
 * Deliberately not a memorable-word scheme: this is read aloud or written on a slip
 * and used within minutes, so entropy matters more than pronounceability. The
 * alphabet omits the characters that get misread when a password is dictated over a
 * phone or copied off a whiteboard — `0`/`O`, `1`/`l`/`I` — because a reset that has
 * to be done twice is a reset that gets replaced by a shared password.
 *
 * `crypto.randomInt` rather than `Math.random`: this is a credential, and it grants
 * whatever the account can do until it is changed.
 */
function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 14; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  /**
   * The suffix guarantees every class the policy in `authSchemas.ts` requires — a
   * lowercase letter, an uppercase letter, a digit and a special character. The alphabet
   * above makes the first three overwhelmingly likely but not certain, and since the
   * owner added the special-character rule (2026-09-02) it can produce none at all.
   *
   * Appended rather than hoped for: a generated credential that its own validator would
   * reject is a support call waiting to happen. `!` is deliberately the one special
   * character used, because this password gets dictated over a phone.
   */
  return `${out}aA7!`;
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

/**
 * The student directory: **every** registered account, whatever its payment state.
 *
 * Widened in Milestone 22 from a `find()` over `Student` to the aggregation in
 * `services/studentDirectoryService.ts`, which rolls up each student's entry payment so
 * the console can show and filter on it. The response is a superset of what it was —
 * `students` and `pagination` are unchanged in shape, so the admin dashboard's three
 * count calls keep working untouched.
 *
 * **Nothing is filtered out for not having paid.** `paymentState` narrows the list only
 * when an administrator explicitly asks for a state.
 */
router.get(
  '/admin/students',
  requirePermission('students:read'),
  validate({ query: listStudentsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, ...filters } = req.query as unknown as ListStudentsQuery;

      const { entries, total } = await listStudentDirectory(filters, page, limit);

      sendSuccess(res, 200, {
        students: entries,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list students');
      sendError(res, 500, 'Could not load the student list. Please try again.');
    }
  },
);

/**
 * The student directory as an `.xlsx` file.
 *
 * **Declared before `/admin/students/:studentId`, and that is load-bearing.** Express
 * matches in declaration order, so with the parameterised route first this path is
 * captured as a student id and answered 400 — the exact trap that swallowed
 * `GET /admin/questions/practice-availability`, and the reason `questionsImport` is
 * mounted ahead of `questionsAdmin`. There is a regression test.
 *
 * Not gated on a new permission: it publishes what the listing above already publishes, to
 * the same people, and a capability that says "you may read this, but not in a file" is a
 * distinction without a difference. It is **rate limited**, because unlike the listing it
 * reads the whole result set and builds a workbook in memory — an unbounded repeat of that
 * is the cheapest way to exhaust a serverless function.
 *
 * One of the few routes that does not answer with the `{ success, ... }` envelope, for the
 * same reason the certificate PDF does not: the response body is the file. Failures still
 * do, because a failure has no file to be.
 */
router.get(
  '/admin/students/export',
  requirePermission('students:read'),
  exportLimiter,
  validate({ query: exportStudentsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { scope, ...filters } = req.query as unknown as ExportStudentsQuery;

      /**
       * `scope: 'all'` discards the filters rather than the caller omitting them, so the
       * request states which of the two it meant — see the schema.
       */
      const query = scope === 'all' ? { sort: filters.sort, order: filters.order } : filters;

      const { entries, overflowed } = await collectStudentDirectory(query, EXPORT_MAX_ROWS);

      if (overflowed) {
        // Refused, never truncated. A spreadsheet quietly missing its last few thousand
        // rows looks complete, gets filed, and is reconciled against months later.
        sendError(
          res,
          413,
          `That export would contain more than ${EXPORT_MAX_ROWS.toLocaleString('en-IN')} students, which is more than one file can carry. Narrow it with a class, a payment status or a registration date range and download it in parts.`,
        );
        return;
      }

      const generatedAt = new Date();
      const workbook = await buildStudentExportWorkbook(entries, {
        description: describeExport(scope, filters),
        generatedAt,
        // The account id, never a name or an address — the same identifier the audit
        // trail uses, so the two can be read side by side.
        generatedBy: req.user?.studentId ?? req.user?.email ?? 'unknown',
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${studentExportFilename(generatedAt)}"`);
      res.setHeader('Content-Length', String(workbook.length));
      // Personal data behind an authorization check: a shared cache must never hand one
      // administrator's export to another request.
      res.setHeader('Cache-Control', 'private, max-age=0, no-store');
      res.send(workbook);
    } catch (err) {
      logger.error({ err }, 'Failed to export the student directory');
      sendError(res, 500, 'Could not build that export. Please try again.');
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
      const protectedReason = refuseIfProtected(req, account);
      if (protectedReason) {
        sendError(res, 403, protectedReason);
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

      // A `security` notice, so it reaches them whatever their preferences say —
      // being suspended without being told is how an account looks broken instead of
      // acted upon. Note this is the one case where the notice must survive the
      // account no longer being active, which is why `emailAllowedFor()` checks the
      // category *before* the status.
      await notifyAccountStatusChanged(account, req.user?.email ?? req.user?.studentId ?? null);

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
      // Catches the super admin specifically: `users:role:write` would otherwise
      // let its holder demote the account the whole recovery path depends on.
      const protectedReason = refuseIfProtected(req, account);
      if (protectedReason) {
        sendError(res, 403, protectedReason);
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

      // Their sessions were just revoked, so without this they would meet an
      // unexplained sign-out. The notice says what changed and that a fresh sign-in
      // is expected.
      await notifyAccountRoleChanged(account);

      sendSuccess(res, 200, { changed: true, student: adminAccountView(account) });
    } catch (err) {
      logger.error({ err }, 'Failed to change account role');
      sendError(res, 500, 'Could not update that role. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Password reset, session revocation and deletion
// ---------------------------------------------------------------------------

/**
 * Issues a one-time temporary password for someone else's account.
 *
 * The password is returned **once**, in this response, and never stored in
 * readable form or written to the audit trail — the trail records that a reset
 * happened and who did it, which is the part that matters afterwards. Staff read
 * it out to the student; `mustChangePassword` then holds the account on a forced
 * change screen until it is replaced.
 *
 * Every live session is ended first. A reset exists because control of the account
 * is in doubt, so leaving whoever currently holds a session signed in would defeat
 * the point.
 *
 * Held by `admin` as well as `superadmin` because this is routine competition-desk
 * work — but `refuseIfProtected` confines an admin to plain student accounts, so
 * one cannot mint a working credential for a peer, and nobody can mint one for the
 * super administrator.
 */
router.post(
  '/admin/users/:studentId/reset-password',
  requirePermission('users:password:reset'),
  // The one administrative route that hands out a working credential, so it is the one
  // whose damage scales with repetition — see `adminActionLimiter`.
  adminActionLimiter,
  validate({ params: studentIdParamSchema, body: accountActionSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { reason } = req.body as AccountActionInput;
      const account = await Student.findOne({ studentId: req.params.studentId });

      if (!account) {
        sendError(res, 404, 'No account exists with that student ID.');
        return;
      }
      if (isSelf(req, account)) {
        sendError(res, 409, 'Use account settings to change your own password.');
        return;
      }
      const protectedReason = refuseIfProtected(req, account);
      if (protectedReason) {
        sendError(res, 403, protectedReason);
        return;
      }

      const temporaryPassword = generateTemporaryPassword();
      account.passwordHash = await hashPassword(temporaryPassword);
      account.mustChangePassword = true;
      account.passwordResetAt = new Date();
      account.passwordResetBy = req.user?.email ?? req.user?.studentId ?? 'unknown';
      // Clears any standing lockout too: the credential just changed, so the
      // failure count that produced the lock is about a password that no longer
      // exists — and being locked out of a password you were just given is the
      // most confusing possible outcome of asking for help.
      account.failedLoginAttempts = 0;
      account.lockedUntil = null;
      await terminateSessions(account);
      await account.save();

      await recordAudit(req, {
        action: 'user.password.reset',
        targetType: 'student',
        targetId: account.studentId,
        targetLabel: account.email,
        metadata: { reason: reason ?? null },
      });

      logger.warn(
        { target: account.studentId, actor: req.user?.email ?? req.user?.studentId },
        'Password reset for another account by staff',
      );

      sendSuccess(res, 200, {
        temporaryPassword,
        student: adminAccountView(account),
        message: 'Share this password with the account holder. It is shown only once, and must be changed at their next sign-in.',
      });
    } catch (err) {
      logger.error({ err }, 'Failed to reset the account password');
      sendError(res, 500, 'Could not reset that password. Please try again.');
    }
  },
);

/**
 * Ends every live session for an account without changing anything else.
 *
 * The mild remedy — "they left themselves signed in on a school computer" — and
 * separate from suspension for that reason: it interrupts access without marking
 * the account as being in any trouble, and the holder can simply sign in again.
 */
router.post(
  '/admin/users/:studentId/revoke-sessions',
  requirePermission('users:sessions:revoke'),
  adminActionLimiter,
  validate({ params: studentIdParamSchema, body: accountActionSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { reason } = req.body as AccountActionInput;
      const account = await Student.findOne({ studentId: req.params.studentId });

      if (!account) {
        sendError(res, 404, 'No account exists with that student ID.');
        return;
      }
      const protectedReason = refuseIfProtected(req, account);
      if (protectedReason) {
        sendError(res, 403, protectedReason);
        return;
      }

      await terminateSessions(account);
      await account.save();

      await recordAudit(req, {
        action: 'user.sessions.revoked',
        targetType: 'student',
        targetId: account.studentId,
        targetLabel: account.email,
        metadata: { reason: reason ?? null },
      });

      sendSuccess(res, 200, { student: adminAccountView(account) });
    } catch (err) {
      logger.error({ err }, 'Failed to revoke sessions');
      sendError(res, 500, 'Could not sign that account out. Please try again.');
    }
  },
);

/**
 * Permanently deletes an **unverified** account, and its photo with it.
 *
 * Confined to the super admin, and the sharpest line between the two roles: every
 * other administrative act in this product is reversible and this one is not.
 *
 * It is confined a second time by the data. An account that has never verified its
 * email is an abandoned registration — it cannot have sat a paper, earned XP or
 * appeared on a board, because login is gated on verification. So what this can
 * destroy is a typo, not a competitor's history. Removing a *verified* account is
 * deliberately not offered at all: `deactivated` is the reversible equivalent, and
 * it keeps the results of everyone that account ever competed against intact.
 */
router.delete(
  '/admin/users/:studentId',
  requirePermission('users:delete'),
  adminActionLimiter,
  validate({ params: studentIdParamSchema, body: deleteAccountSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { reason, confirmStudentId } = req.body as DeleteAccountInput;
      const account = await Student.findOne({ studentId: req.params.studentId });

      if (!account) {
        sendError(res, 404, 'No account exists with that student ID.');
        return;
      }
      if (confirmStudentId !== account.studentId) {
        sendError(res, 400, 'The confirmation does not match this account’s student ID.');
        return;
      }
      if (isSelf(req, account)) {
        sendError(res, 409, 'You cannot delete your own account.');
        return;
      }
      const protectedReason = refuseIfProtected(req, account);
      if (protectedReason) {
        sendError(res, 403, protectedReason);
        return;
      }
      if (account.isEmailVerified) {
        sendError(
          res,
          409,
          'Only an unverified account can be deleted. Deactivate this account instead — it is reversible and keeps its exam history.',
        );
        return;
      }

      // Denormalised into the audit entry *before* the delete, because afterwards
      // there is no document left to join against and an entry that says only
      // "an account was deleted" answers nothing.
      const snapshot = {
        studentId: account.studentId,
        email: account.email,
        fullName: account.fullName ?? null,
        registeredAt: account.registeredAt,
      };

      await StudentPhoto.deleteOne({ student: objectId(account) });
      await revokeAllRefreshTokens(objectId(account));
      await Student.deleteOne({ _id: account._id });

      await recordAudit(req, {
        action: 'user.deleted',
        targetType: 'student',
        targetId: snapshot.studentId,
        targetLabel: snapshot.email,
        metadata: { ...snapshot, registeredAt: snapshot.registeredAt.toISOString(), reason: reason ?? null },
      });

      logger.warn({ ...snapshot, actor: req.user?.email ?? req.user?.studentId }, 'Unverified account deleted');

      sendSuccess(res, 200, { deleted: true, student: snapshot });
    } catch (err) {
      logger.error({ err }, 'Failed to delete the account');
      sendError(res, 500, 'Could not delete that account. Please try again.');
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
