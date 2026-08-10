import { Router } from 'express';
import { config } from '../../config';
import { Student, StudentPhoto, type StudentDocument } from '../../models';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { requireAuth } from '../../middleware/auth';
import {
  loginLimiter,
  registerLimiter,
  emailActionLimiter,
  tokenSubmitLimiter,
  refreshLimiter,
} from '../../middleware/rateLimiter';
import {
  registerSchema,
  type RegisterInput,
  loginSchema,
  adminLoginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../../validation/authSchemas';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { hashPassword, verifyPassword } from '../../lib/password';
import { permissionsFor, isPrivilegedRole } from '../../lib/permissions';
import { recordAudit } from '../../lib/audit';
import {
  studentObjectId,
  studentClaims,
  setAccessCookie,
  establishSession,
  clearSessionCookies,
} from '../../lib/session';
import {
  signAccessToken,
  verifyAccessToken,
  type AccessTokenClaims,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  issueVerificationToken,
  consumeVerificationToken,
} from '../../lib/tokens';
import { sendEmail, buildVerificationEmail, buildPasswordResetEmail } from '../../lib/email';
import { logger } from '../../lib/logger';
import { recordActivity, touchDailyVisit } from '../../services/activityService';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The only shape of student data ever sent to a client. */
function publicStudent(student: StudentDocument) {
  return {
    fullName: student.fullName,
    firstName: student.firstName,
    middleName: student.middleName ?? null,
    lastName: student.lastName,
    fatherName: student.fatherName,
    motherName: student.motherName,
    dateOfBirth: student.dateOfBirth ? student.dateOfBirth.toISOString().slice(0, 10) : null,
    classLevel: student.classLevel,
    schoolName: student.schoolName,
    address: student.address,
    mobile: student.mobile,
    email: student.email,
    studentId: student.studentId,
    isEmailVerified: student.isEmailVerified,
    status: student.status,
    role: student.role,
  };
}

/**
 * Every authenticated response carries the caller's role *and* its effective
 * permission list, so the frontend can drive guards and navigation from the
 * server's own authorization table instead of re-implementing it and drifting.
 */
function sessionEnvelope(student: StudentDocument) {
  return { role: student.role, permissions: permissionsFor(student.role), student: publicStudent(student) };
}

/**
 * `studentObjectId`, `studentClaims`, `setAccessCookie`, `establishSession` and
 * `clearSessionCookies` now live in `lib/session.ts`, because the account-settings
 * password change also has to issue a session. Imported above rather than
 * re-declared here.
 */

/**
 * `AMIT_xxxx` is only 4 digits, so collisions matter once there are a few
 * hundred students. `studentId` is now uniquely indexed and we retry on
 * duplicate-key rather than silently issuing a shared ID (the bug recorded in
 * PROJECT_STATE.md).
 */
function generateStudentId(): string {
  return `AMIT_${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`;
}

function isDuplicateKeyError(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

function duplicateField(err: { keyPattern?: Record<string, unknown> }): string | undefined {
  return Object.keys(err.keyPattern ?? {})[0];
}

async function sendVerificationLink(student: StudentDocument): Promise<void> {
  const { token } = await issueVerificationToken(studentObjectId(student), 'email_verify');
  await sendEmail(buildVerificationEmail(student.email, token));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Creates an unverified account and emails a verification link. Deliberately
 * does NOT establish a session: the student must verify first (owner's choice,
 * see DECISIONS.md), which also means a mistyped address can't yield a usable
 * account.
 */
router.post('/auth/register', registerLimiter, validate({ body: registerSchema }), ensureDb, async (req, res) => {
  const { photo, password, ...details } = req.body as RegisterInput;

  try {
    const passwordHash = await hashPassword(password);

    let student: StudentDocument | null = null;
    let lastError: unknown = null;

    // Retry only for studentId collisions; mobile/email duplicates are real
    // conflicts and must surface to the user.
    for (let attempt = 0; attempt < 5 && !student; attempt += 1) {
      try {
        student = await Student.create({
          // `fullName` is not passed: the schema derives it from the name parts.
          ...details,
          passwordHash,
          studentId: generateStudentId(),
        });
      } catch (err) {
        lastError = err;
        if (isDuplicateKeyError(err)) {
          const field = duplicateField(err);
          if (field === 'mobile') {
            sendError(res, 409, 'This mobile number is already registered.');
            return;
          }
          if (field === 'email') {
            sendError(res, 409, 'This email address is already registered.');
            return;
          }
          if (field === 'studentId') continue; // collision — try another ID
        }
        throw err;
      }
    }

    if (!student) {
      logger.error({ err: lastError }, 'Could not allocate a unique studentId after several attempts');
      sendError(res, 500, 'Could not complete registration. Please try again.');
      return;
    }

    // The photo is mandatory, so an account without one is not a valid account.
    // There is no transaction available here (Atlas free tier aside, the local
    // test database is a single node), so on failure the student document is
    // removed again rather than left behind in a state registration can never
    // reach — the student can simply register again.
    try {
      await StudentPhoto.create({
        student: studentObjectId(student),
        contentType: photo.contentType,
        size: photo.data.length,
        data: photo.data,
      });
    } catch (err) {
      logger.error({ err, studentId: student.studentId }, 'Could not store the registration photo; rolling back the account');
      await Student.deleteOne({ _id: student._id });
      sendError(res, 500, 'Could not save your photo. Please try registering again.');
      return;
    }

    // The first entry on the student's activity feed, and the first XP they hold.
    // Best-effort by design (see services/activityService.ts): a failed log write
    // must not undo a completed registration.
    await recordActivity({ student: studentObjectId(student), type: 'account_created' });

    await sendVerificationLink(student);

    sendSuccess(res, 201, {
      message: 'Registration successful. Check your email for a verification link to activate your account.',
      requiresEmailVerification: config.auth.requireEmailVerification,
      student: publicStudent(student),
    });
  } catch (err) {
    logger.error({ err }, 'Registration failed');
    sendError(res, 500, 'Could not complete registration. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

router.post('/auth/verify-email', tokenSubmitLimiter, validate({ body: verifyEmailSchema }), ensureDb, async (req, res) => {
  try {
    const { token } = req.body as { token: string };
    const outcome = await consumeVerificationToken(token, 'email_verify');

    if (!outcome.ok) {
      const message =
        outcome.reason === 'expired'
          ? 'This verification link has expired. Request a new one.'
          : outcome.reason === 'used'
            ? 'This verification link has already been used. Try signing in.'
            : 'This verification link is invalid. Request a new one.';
      sendError(res, 400, message);
      return;
    }

    const student = await Student.findById(outcome.studentId);
    if (!student) {
      sendError(res, 400, 'This verification link is invalid. Request a new one.');
      return;
    }

    if (!student.isEmailVerified) {
      student.isEmailVerified = true;
      await student.save();
      // Only on the transition, so re-reading a link cannot pay twice — though the
      // once-per-account unique index would refuse it anyway.
      await recordActivity({ student: studentObjectId(student), type: 'email_verified' });
    }

    sendSuccess(res, 200, { message: 'Email verified. You can now sign in.', student: publicStudent(student) });
  } catch (err) {
    logger.error({ err }, 'Email verification failed');
    sendError(res, 500, 'Could not verify your email. Please try again.');
  }
});

/**
 * Always answers 200, whether or not the address exists or is already verified —
 * otherwise this endpoint becomes a way to test which emails are registered.
 */
router.post(
  '/auth/resend-verification',
  emailActionLimiter,
  validate({ body: resendVerificationSchema }),
  ensureDb,
  async (req, res) => {
    const genericMessage = 'If that address needs verification, a new link is on its way.';
    try {
      const { email } = req.body as { email: string };
      const student = await Student.findOne({ email });
      if (student && !student.isEmailVerified && student.status === 'active') {
        await sendVerificationLink(student);
      }
      sendSuccess(res, 200, { message: genericMessage });
    } catch (err) {
      logger.error({ err }, 'Resend verification failed');
      sendSuccess(res, 200, { message: genericMessage });
    }
  },
);

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

router.post('/auth/login', loginLimiter, validate({ body: loginSchema }), ensureDb, async (req, res) => {
  try {
    const { identifier, password } = req.body as { identifier: string; password: string };

    // The filter is built from explicitly-normalised strings, so no query
    // operator from user input can reach Mongo.
    const student = await Student.findOne({
      $or: [{ email: identifier.toLowerCase() }, { mobile: identifier.replace(/[\s-]/g, '') }],
    }).select('+passwordHash');

    // One message for both "no such account" and "wrong password": telling them
    // apart would let an attacker enumerate registered accounts.
    const invalidCredentials = 'Invalid credentials. Check your mobile number or email and password.';

    if (!student) {
      sendError(res, 401, invalidCredentials);
      return;
    }

    if (student.lockedUntil && student.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((student.lockedUntil.getTime() - Date.now()) / 60000));
      sendError(res, 423, `Account temporarily locked after too many failed attempts. Try again in ${minutes} minute(s).`);
      return;
    }

    const passwordOk = await verifyPassword(password, student.passwordHash);
    if (!passwordOk) {
      student.failedLoginAttempts += 1;
      if (student.failedLoginAttempts >= config.auth.maxFailedLogins) {
        student.lockedUntil = new Date(Date.now() + config.auth.accountLockMinutes * 60 * 1000);
        student.failedLoginAttempts = 0;
        logger.warn({ studentId: student.studentId }, 'Account locked after repeated failed logins');
      }
      await student.save();
      sendError(res, 401, invalidCredentials);
      return;
    }

    if (student.status !== 'active') {
      const message =
        student.status === 'suspended'
          ? 'This account has been suspended. Contact support for help.'
          : 'This account has been deactivated.';
      sendError(res, 403, message);
      return;
    }

    if (config.auth.requireEmailVerification && !student.isEmailVerified) {
      sendError(res, 403, 'Please verify your email address before signing in. Check your inbox for the link.', {
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    // A successful login clears the failure counter and any expired lock.
    student.failedLoginAttempts = 0;
    student.lockedUntil = null;
    student.lastLoginAt = new Date();
    await student.save();

    await establishSession(res, student, req);

    // Counts toward the daily streak. Idempotent per competition day, so signing in
    // from a second device does not earn a second visit.
    await touchDailyVisit(studentObjectId(student));

    // A sign-in by an account that holds administrative capability is itself worth
    // recording — it is the event every later administrative action hangs off.
    if (isPrivilegedRole(student.role)) {
      req.user = studentClaims(student);
      await recordAudit(req, {
        action: 'admin.session.started',
        targetType: 'system',
        targetLabel: student.email,
        metadata: { role: student.role, via: 'password' },
      });
    }

    sendSuccess(res, 200, sessionEnvelope(student));
  } catch (err) {
    logger.error({ err }, 'Login failed');
    sendError(res, 500, 'Could not sign you in. Please try again.');
  }
});

router.post('/auth/admin/login', loginLimiter, validate({ body: adminLoginSchema }), async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const { email: adminEmail, passwordHash: adminPasswordHash } = config.admin;

    if (!adminEmail || !adminPasswordHash) {
      sendError(res, 500, 'Admin account is not configured.');
      return;
    }
    if (email !== adminEmail || !(await verifyPassword(password, adminPasswordHash))) {
      sendError(res, 401, 'Invalid admin credentials.');
      return;
    }

    // The environment-configured account is the *root* administrator: it holds
    // `superadmin`, the only role that can grant or revoke admin rights, and it is
    // the bootstrap identity (nothing else can create the first admin). It has no
    // database record, so no refresh-token family to rotate — it gets a single
    // longer-lived access token, marked `root` so the authorization layer knows not
    // to look for a document. See DECISIONS.md.
    const claims: AccessTokenClaims = { role: 'superadmin', email, root: true };
    res.cookie(config.auth.accessCookieName, signAccessToken(claims), config.auth.accessCookieOptions);

    req.user = claims;
    await recordAudit(req, {
      action: 'admin.session.started',
      targetType: 'system',
      targetLabel: email,
      metadata: { role: 'superadmin', via: 'root-credentials' },
    });

    sendSuccess(res, 200, {
      role: 'superadmin',
      permissions: permissionsFor('superadmin'),
      admin: { email, role: 'superadmin' },
    });
  } catch (err) {
    logger.error({ err }, 'Admin login failed');
    sendError(res, 500, 'Admin login failed.');
  }
});

// ---------------------------------------------------------------------------
// Refresh / logout
// ---------------------------------------------------------------------------

/**
 * Exchanges a refresh token for a new access token, rotating the refresh token.
 * Reuse of an already-rotated token kills the whole family (theft response).
 */
router.post('/auth/refresh', refreshLimiter, ensureDb, async (req, res) => {
  try {
    const presented = req.cookies?.[config.auth.refreshCookieName];
    const outcome = await rotateRefreshToken(presented, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });

    if (!outcome.ok) {
      clearSessionCookies(res);
      const message =
        outcome.reason === 'reused'
          ? 'Your session was ended for security reasons. Please sign in again.'
          : 'Your session has expired. Please sign in again.';
      sendError(res, 401, message);
      return;
    }

    const student = await Student.findById(outcome.studentId);
    if (!student || student.status !== 'active') {
      clearSessionCookies(res);
      sendError(res, 401, 'Your session is no longer valid. Please sign in again.');
      return;
    }

    setAccessCookie(res, student);
    res.cookie(config.auth.refreshCookieName, outcome.next.token, config.auth.refreshCookieOptions);
    // Re-issuing from the database is what makes a role change reach the client:
    // the new access token and the returned permission list both come from the
    // account as it is now, not as it was when the session began.
    sendSuccess(res, 200, sessionEnvelope(student));
  } catch (err) {
    logger.error({ err }, 'Token refresh failed');
    sendError(res, 500, 'Could not refresh your session. Please sign in again.');
  }
});

/** Revokes the presented refresh token only, leaving other devices signed in. */
router.post('/auth/logout', ensureDb, async (req, res) => {
  try {
    await revokeRefreshToken(req.cookies?.[config.auth.refreshCookieName]);
  } catch (err) {
    // Never fail a logout: the cookies must be cleared regardless.
    logger.error({ err }, 'Failed to revoke refresh token during logout');
  }
  clearSessionCookies(res);
  sendSuccess(res, 200, { message: 'Signed out.' });
});

/**
 * Signs out everywhere: revokes all refresh tokens and bumps `tokenVersion`, so
 * previously issued access tokens are rejected by /auth/me and cannot be refreshed.
 */
router.post('/auth/logout-all', requireAuth(), ensureDb, async (req, res) => {
  try {
    // Any signed-in account may end its own sessions — including a promoted admin,
    // which is why this is not gated on the `student` role. The root admin has no
    // `sub` (and no refresh-token family), so there is nothing to revoke but the cookies.
    const student = req.user!.sub ? await Student.findById(req.user!.sub) : null;
    if (student) {
      await revokeAllRefreshTokens(studentObjectId(student));
      student.tokenVersion += 1;
      await student.save();
    }
    clearSessionCookies(res);
    sendSuccess(res, 200, { message: 'Signed out on all devices.' });
  } catch (err) {
    logger.error({ err }, 'Logout-all failed');
    sendError(res, 500, 'Could not sign you out everywhere. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

router.get('/auth/me', async (req, res) => {
  const payload = verifyAccessToken(req.cookies?.[config.auth.accessCookieName]);

  if (!payload) {
    sendError(res, 401, 'Not authenticated');
    return;
  }

  // The root admin's identity lives entirely in the token — no database read
  // needed, so this answers even when MongoDB is unreachable.
  if (payload.root) {
    sendSuccess(res, 200, {
      role: payload.role,
      permissions: permissionsFor(payload.role),
      admin: { email: payload.email, role: payload.role },
    });
    return;
  }

  try {
    const student = await Student.findById(payload.sub);
    if (!student) {
      sendError(res, 401, 'Your session is no longer valid.');
      return;
    }
    // A stale `tv` means the session was revoked (password reset / logout-all).
    if (typeof payload.tv === 'number' && payload.tv !== student.tokenVersion) {
      sendError(res, 401, 'Your session has been revoked. Please sign in again.');
      return;
    }
    if (student.status !== 'active') {
      sendError(res, 403, 'This account is no longer active.');
      return;
    }
    // The role and permissions come from the account as it is now, so a promotion
    // or demotion is reflected on the next page load without a re-login.
    sendSuccess(res, 200, sessionEnvelope(student));
  } catch (err) {
    logger.error({ err }, 'Failed to load current user');
    sendError(res, 503, 'Could not load your session right now. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// Forgot / reset password
// ---------------------------------------------------------------------------

/**
 * Always answers 200 with the same message, so this cannot be used to discover
 * which email addresses have accounts.
 */
router.post('/auth/forgot-password', emailActionLimiter, validate({ body: forgotPasswordSchema }), ensureDb, async (req, res) => {
  const genericMessage = 'If an account exists for that address, a password reset link is on its way.';
  try {
    const { email } = req.body as { email: string };
    const student = await Student.findOne({ email });

    if (student && student.status === 'active') {
      const { token } = await issueVerificationToken(studentObjectId(student), 'password_reset');
      await sendEmail(buildPasswordResetEmail(student.email, token));
    }

    sendSuccess(res, 200, { message: genericMessage });
  } catch (err) {
    logger.error({ err }, 'Forgot-password request failed');
    sendSuccess(res, 200, { message: genericMessage });
  }
});

/**
 * Consumes a single-use reset token, sets the new password, and revokes every
 * existing session — if the account was compromised, the attacker's sessions die
 * with the password change.
 */
router.post('/auth/reset-password', tokenSubmitLimiter, validate({ body: resetPasswordSchema }), ensureDb, async (req, res) => {
  try {
    const { token, password } = req.body as { token: string; password: string };
    const outcome = await consumeVerificationToken(token, 'password_reset');

    if (!outcome.ok) {
      const message =
        outcome.reason === 'expired'
          ? 'This reset link has expired. Request a new one.'
          : outcome.reason === 'used'
            ? 'This reset link has already been used. Request a new one.'
            : 'This reset link is invalid. Request a new one.';
      sendError(res, 400, message);
      return;
    }

    const student = await Student.findById(outcome.studentId);
    if (!student) {
      sendError(res, 400, 'This reset link is invalid. Request a new one.');
      return;
    }

    student.passwordHash = await hashPassword(password);
    student.tokenVersion += 1;
    student.failedLoginAttempts = 0;
    student.lockedUntil = null;
    // Completing a reset proves control of the mailbox, so treat it as verifying it.
    const wasUnverified = !student.isEmailVerified;
    student.isEmailVerified = true;
    await student.save();

    // The feed should show a password change however it happened, not only when it
    // was done from account settings. Same reasoning for the verification: the reset
    // link proved control of the mailbox just as the verification link would have.
    await recordActivity({ student: studentObjectId(student), type: 'password_changed', detail: 'Via emailed reset link' });
    if (wasUnverified) {
      await recordActivity({ student: studentObjectId(student), type: 'email_verified' });
    }

    await revokeAllRefreshTokens(studentObjectId(student));
    clearSessionCookies(res);

    sendSuccess(res, 200, { message: 'Password updated. You can now sign in with your new password.' });
  } catch (err) {
    logger.error({ err }, 'Password reset failed');
    sendError(res, 500, 'Could not reset your password. Please try again.');
  }
});

export default router;
