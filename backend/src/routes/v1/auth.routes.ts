import { Router, type Request, type Response } from 'express';
import { config } from '../../config';
import { Student, StudentPhoto, type AccountStatus, type StudentDocument } from '../../models';
import { resolveRootSuperadmin, isRootAdminEmail } from '../../services/rootAdminService';
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
  verifyAccessToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  issueVerificationToken,
  consumeVerificationToken,
  hasLiveVerificationToken,
  newestLiveVerificationToken,
  releaseVerificationToken,
} from '../../lib/tokens';
import { buildVerificationEmail, buildPasswordResetEmail } from '../../lib/email';
import { enqueueEmail } from '../../services/emailOutbox';
import { logger } from '../../lib/logger';
import { respondToServiceError } from '../../lib/serviceError';
import { attributeReferral } from '../../services/referralService';
import { grantDailyVisit, grantReward } from '../../services/rewardService';
import { hasEntryEntitlement } from '../../services/paymentService';

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
async function sessionEnvelope(student: StudentDocument) {
  return {
    role: student.role,
    permissions: permissionsFor(student.role),
    student: publicStudent(student),
    /**
     * Set when staff have issued a temporary password. The frontend holds the
     * session on a forced change screen until it clears; the flag travels on every
     * auth response so a reload cannot step around it.
     */
    mustChangePassword: student.mustChangePassword === true,
    /**
     * What this account has *paid for*, as opposed to what its role permits.
     *
     * It rides on every auth response for exactly the reason `permissions` does: the
     * frontend must not re-derive it. A page that decided "have they paid?" for itself
     * would be a second source of truth about money, and the two would disagree the
     * first time somebody paid in another tab.
     *
     * This is **presentation only**. It decides whether a lock icon or a paper is
     * rendered; it does not decide whether the paper is served. `requireEntry` on the
     * route is the guarantee, and it re-derives the answer from the payment record on
     * every gated request — so a tampered client gets a nicer-looking 402.
     */
    entitlements: {
      olympiadEntry: await hasEntryEntitlement(studentObjectId(student)),
    },
  };
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

/**
 * Queues the verification link rather than sending it inline.
 *
 * This used to `await sendEmail(...)`, which meant a registering student's request
 * waited on a third-party SMTP handshake, and a failed handshake **lost the link
 * silently** — and since login requires verification, a lost link is an unusable
 * account. `enqueueEmail()` persists the message first and returns; delivery and
 * retries happen off the request path. See `services/emailOutbox.ts`.
 *
 * No `dedupeKey`: resending a verification link is a legitimate thing to ask for
 * (that is what `/auth/resend-verification` is), so these must not collide.
 */
/**
 * How long a student must wait between verification emails (owner's request,
 * 2026-09-02). Five minutes.
 *
 * ## The server owns this clock, and the browser only displays it
 *
 * Same rule as the daily challenge's rollover: the page counts down from a figure this
 * server sent and re-asks when it reaches zero. A cooldown enforced only in the browser
 * is a suggestion — and this one exists partly to protect a mail quota, which a
 * suggestion cannot do.
 *
 * ## Why the answer is the same for an address that is not registered
 *
 * `/auth/resend-verification` deliberately answers identically whether or not the
 * account exists, so it cannot be used to test which addresses are registered. A
 * *truthful* remaining time would break that: an unknown address would always report a
 * full five minutes while a real one reported 4:12. So the response always says "five
 * minutes from now", and the real window is enforced separately, against the age of the
 * link actually sitting in the inbox. A client's timer therefore never expires *before*
 * the server would allow the next send.
 */
export const RESEND_COOLDOWN_SECONDS = 5 * 60;

/** The instant the caller may ask for another link. Constant, for the reason above. */
function nextResendAt(): string {
  return new Date(Date.now() + RESEND_COOLDOWN_SECONDS * 1000).toISOString();
}

/**
 * Whether a fresh link may be emailed to this account yet.
 *
 * Measured from the newest **live** link, so it answers "how long ago did we actually
 * send one" rather than "how long ago did somebody press a button". A link that has been
 * redeemed or superseded is not in play, and an account with no live link at all has
 * nothing to wait for.
 */
async function verificationCooldownRemaining(student: StudentDocument): Promise<number> {
  const live = await newestLiveVerificationToken(studentObjectId(student), 'email_verify');
  if (!live) return 0;
  const elapsedSeconds = (Date.now() - live.createdAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsedSeconds));
}

async function sendVerificationLink(student: StudentDocument): Promise<void> {
  const { token } = await issueVerificationToken(studentObjectId(student), 'email_verify');
  await enqueueEmail({
    ...buildVerificationEmail(student.email, token),
    category: 'transactional',
    student: studentObjectId(student),
  });
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
  const { photo, password, referralCode, ...details } = req.body as RegisterInput;

  try {
    // The bootstrap super-admin address is not registrable. Without this, anyone
    // who learned `ADMIN_EMAIL` could claim it as an ordinary account *before* the
    // first administrative sign-in provisioned it — and then authenticate against
    // their own password at the admin portal. `resolveRootSuperadmin()` refuses to
    // adopt a non-superadmin document for exactly that reason; this closes the
    // window from the other side. The message is the ordinary "already registered"
    // one, so this does not disclose which address is the administrator's.
    if (isRootAdminEmail(details.email)) {
      sendError(res, 409, 'This email address is already registered.');
      return;
    }

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

    /**
     * Who introduced them (Milestone 22, Phase E).
     *
     * **Not** best-effort, unlike the reward and the email below: a code that does not
     * resolve throws, and the registration is rolled back and refused. That is deliberate
     * and it is the opposite of how the rest of this handler treats a failure — because
     * the alternatives are both worse. Keeping the account and dropping the attribution
     * means the referrer silently never gets credit; keeping it and *guessing* is
     * unthinkable. Refusing tells the student something they can act on, and the register
     * page validates the code from their link long before they reach this point.
     *
     * Attribution itself is decided by a unique index on `Referral.referred`, so a retry
     * cannot produce two referrers for one registration.
     */
    if (referralCode) {
      try {
        await attributeReferral({ code: referralCode, referred: studentObjectId(student) });
      } catch (err) {
        // The account and its photo are removed again, exactly as a failed photo write
        // does above — there is no transaction here, and a half-registered account is
        // worse than asking the student to submit the form once more.
        await StudentPhoto.deleteOne({ student: studentObjectId(student) });
        await Student.deleteOne({ _id: student._id });
        respondToServiceError(res, err, {
          log: 'Registration refused: the referral code did not resolve',
          fallback: 'That referral code could not be used. Remove it and try again.',
        });
        return;
      }
    }

    // The first entry on the student's activity feed, and the first XP they hold.
    // Best-effort by design (see services/activityService.ts): a failed log write
    // must not undo a completed registration.
    await grantReward({ student: studentObjectId(student), event: 'account_created' });

    await sendVerificationLink(student);

    sendSuccess(res, 201, {
      message: 'Registration successful. Check your email for a verification link to activate your account.',
      requiresEmailVerification: config.auth.requireEmailVerification,
      student: publicStudent(student),
      /**
       * When they may ask for another link. The success screen counts down to it, so the
       * first thing a new student sees after registering is how long the link they have
       * just been sent is worth waiting for — rather than a resend button that invites
       * them to supersede it immediately.
       */
      nextResendAt: nextResendAt(),
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
      /**
       * A spent token is not automatically a failure.
       *
       * If the account it pointed at is verified, this link already did its job and the
       * honest answer is success — the student can sign in. Reporting "already used"
       * there is a dead end produced by a *duplicate* of a request that worked: a
       * double submit, a mail scanner that follows links, a retried request after a
       * cold start, or simply someone clicking twice.
       *
       * If the account is **not** verified, the link really was burned without doing
       * its job, and saying "try signing in" would send the student at a door that
       * cannot open. That case is now largely prevented by the release below, but it is
       * still reported honestly, with the action that actually helps.
       */
      if (outcome.reason === 'used' || outcome.reason === 'expired' || outcome.reason === 'superseded') {
        let account = await Student.findById(outcome.studentId);

        /**
         * **Two requests for one click.**
         *
         * A page that fires twice, an impatient double click, a mail scanner that
         * follows links, a retried request after a cold start: one of the pair consumes
         * the token and verifies the account, and the other arrives to find it spent.
         * That loser can read the account *before* the winner's save lands, conclude the
         * link was burned without doing its job, and email a replacement — which
         * supersedes the live link and starts the loop this whole branch exists to
         * avoid.
         *
         * So wait briefly and look again, rather than deciding on a read taken in the
         * middle of somebody else's write. Bounded and short: three reads over ~600ms,
         * only on a path that has already failed, and only for a *redeemed* token —
         * a superseded or expired one was never being redeemed by anybody, so there is
         * nothing to wait for.
         */
        if (account && !account.isEmailVerified && outcome.reason === 'used') {
          for (let attempt = 0; attempt < 3 && !account.isEmailVerified; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            account = await Student.findById(outcome.studentId);
            if (!account) break;
          }
        }

        if (account?.isEmailVerified) {
          sendSuccess(res, 200, { message: 'Your email is already verified. You can sign in.', alreadyVerified: true });
          return;
        }

        /**
         * **A live link is never destroyed to make a point.**
         *
         * Issuing a token invalidates the outstanding one, so resending on every stale
         * click killed the exact link this message tells the reader to open — and the
         * next click killed its replacement. Production ran that loop 24 times across two
         * registrations and left both accounts unable to verify at all; see
         * TROUBLESHOOTING.md.
         *
         * So: if a working link is already sitting in their inbox, say so and send
         * nothing. This is also the answer to two verify requests arriving for one click
         * (a page that fires twice, a mail scanner that follows links, an impatient double
         * click): the loser of that race no longer mails anybody.
         */
        if (account && (await hasLiveVerificationToken(studentObjectId(account), 'email_verify'))) {
          logger.info(
            { studentId: account.studentId, reason: outcome.reason },
            'Stale verification link presented while a newer one is still live — not sending another',
          );
          sendError(
            res,
            400,
            'That link is out of date — a newer one has already been sent. Please open the most recent '
              + 'verification email and use the link in that one.',
          );
          return;
        }

        /**
         * A spent or expired link on an account that is **still unverified** used to be
         * a dead end: the student was shown an error and a form asking them to retype
         * the address they had just proved they owned, on a page they reached by doing
         * exactly what the email told them to do. Most people stop there.
         *
         * So we send a fresh link instead of asking. It is safe and it discloses
         * nothing: whoever is holding this token got it from that mailbox, and the new
         * link goes to that same address and nowhere else. Issuing one invalidates the
         * old, and the route's own rate limiter caps how often this can happen.
         *
         * This is a deliberate belt to the brace added alongside it — the token is no
         * longer burned by a failed attempt in the first place — because the causes of
         * a spent token are not all ours. A mail provider that follows links, a
         * forwarded message, a second registration attempt, or somebody opening the
         * older of two emails all produce one, and none of them should cost a student
         * their account.
         */
        // Nothing live is outstanding, so there is a real dead end here to fix, and
        // sending a link cannot destroy one.
        if (account) {
          logger.warn(
            { studentId: account.studentId, reason: outcome.reason },
            'Verification link was spent or expired with no live link outstanding — issuing a fresh one',
          );
          await sendVerificationLink(account);
          sendError(
            res,
            400,
            outcome.reason === 'expired'
              ? 'That link had expired, so we have emailed you a new one. Please open the newest email and try again.'
              : 'That link had already been used, so we have emailed you a new one. Please open the newest email and try again.',
          );
          return;
        }
      }

      // No account behind the token, or no token at all. Nothing to send anywhere.
      const message =
        outcome.reason === 'expired'
          ? 'This verification link has expired. Request a new one.'
          : 'This verification link is invalid. Request a new one.';
      logger.warn({ reason: outcome.reason }, 'Verification failed with no account to re-send to');
      sendError(res, 400, message);
      return;
    }

    // From here the token is spent. Anything that throws must give it back, or the link
    // in the student's inbox is dead for ever while the account stays unverified — and
    // since login requires verification, that locks them out of their own account with
    // no way back except asking for a new link they have no reason to think they need.
    try {
      const student = await Student.findById(outcome.studentId);
      if (!student) {
        sendError(res, 400, 'This verification link is invalid. Request a new one.');
        return;
      }

      if (!student.isEmailVerified) {
        student.isEmailVerified = true;
        await student.save();

        // Best-effort, and deliberately after the save: XP is a reward for verifying,
        // not a condition of it. The same rule the audit trail follows — a failure here
        // must never cost a student the thing it was describing.
        try {
          // Only on the transition, so re-reading a link cannot pay twice — though the
          // once-per-account unique index would refuse it anyway.
          await grantReward({ student: studentObjectId(student), event: 'email_verified' });
        } catch (rewardErr) {
          logger.error({ err: rewardErr }, 'Email verified, but the XP grant failed');
        }
      }

      sendSuccess(res, 200, { message: 'Email verified. You can now sign in.', student: publicStudent(student) });
    } catch (err) {
      await releaseVerificationToken(token, 'email_verify');
      throw err;
    }
  } catch (err) {
    logger.error({ err }, 'Email verification failed');
    sendError(res, 500, 'Could not verify your email. Please try again — your link is still valid.');
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
        /**
         * Refused quietly while a link sent in the last five minutes is still live.
         *
         * Quietly, because the response may not vary with what we know about the
         * address. The reader is not left guessing: they were given the same countdown
         * when the link was sent, and the button that reaches this route is disabled
         * until it runs out.
         *
         * This also protects the link itself. Issuing a token supersedes the outstanding
         * one, so an impatient second press used to invalidate the link already in the
         * inbox — the churn behind the 24-token loop recorded in TROUBLESHOOTING.md.
         */
        const waitSeconds = await verificationCooldownRemaining(student);
        if (waitSeconds > 0) {
          logger.info(
            { studentId: student.studentId, waitSeconds },
            'Verification resend refused: a link sent within the cooldown is still live',
          );
        } else {
          await sendVerificationLink(student);
        }
      }
      sendSuccess(res, 200, { message: genericMessage, nextResendAt: nextResendAt() });
    } catch (err) {
      logger.error({ err }, 'Resend verification failed');
      sendSuccess(res, 200, { message: genericMessage, nextResendAt: nextResendAt() });
    }
  },
);

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

type AuthFailure = { ok: false; status: number; message: string; code?: string };
type AuthOutcome = { ok: true } | AuthFailure;

/** Why an account that exists is nevertheless barred from signing in. */
function barredMessage(status: AccountStatus): string {
  switch (status) {
    case 'suspended':
      return 'This account has been suspended. Contact support for help.';
    case 'blocked':
      return 'This account has been blocked. Contact support if you believe this is a mistake.';
    default:
      return 'This account has been deactivated.';
  }
}

/**
 * The **only** password check in this backend.
 *
 * Both sign-in routes run through here — the ordinary one and the root super
 * admin's — so lockout, account status, email verification, the failure counter and
 * session establishment are defined exactly once. A second copy for the most
 * privileged account is precisely where a missing status check would go unnoticed
 * for a year, which is why the super admin now authenticates through the same path
 * as a Class 9 student rather than through a bespoke branch.
 *
 * The caller supplies the account (already loaded with `+passwordHash`) and the
 * message to use for a bad password, because "check your mobile number or email"
 * makes no sense at the admin portal. Everything else is shared.
 *
 * `refuseAfterPassword` lets a route reject an account that is not meant to sign in
 * *there* — currently only the student login turning the super administrator away.
 * It is deliberately applied **after** the password is verified, and that ordering
 * is the whole point: refusing earlier would answer differently for the
 * administrator's address than for any other, which is an account-enumeration
 * oracle pointing straight at the most privileged account in the system. A caller
 * who does not already know the password still gets the same generic failure as
 * for any other wrong guess.
 *
 * On success the session cookies are already set when this returns.
 */
async function authenticateAccount(
  student: StudentDocument,
  password: string,
  req: Request,
  res: Response,
  invalidCredentialsMessage: string,
  refuseAfterPassword: AuthFailure | null = null,
): Promise<AuthOutcome> {
  if (student.lockedUntil && student.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((student.lockedUntil.getTime() - Date.now()) / 60000));
    return {
      ok: false,
      status: 423,
      message: `Account temporarily locked after too many failed attempts. Try again in ${minutes} minute(s).`,
    };
  }

  if (!(await verifyPassword(password, student.passwordHash))) {
    student.failedLoginAttempts += 1;
    if (student.failedLoginAttempts >= config.auth.maxFailedLogins) {
      student.lockedUntil = new Date(Date.now() + config.auth.accountLockMinutes * 60 * 1000);
      student.failedLoginAttempts = 0;
      logger.warn({ studentId: student.studentId }, 'Account locked after repeated failed logins');
    }
    await student.save();
    return { ok: false, status: 401, message: invalidCredentialsMessage };
  }

  // The password was right, so answering specifically here reveals nothing an
  // attacker did not already have. No session is established.
  if (refuseAfterPassword) return refuseAfterPassword;

  if (student.status !== 'active') {
    return { ok: false, status: 403, message: barredMessage(student.status) };
  }

  if (config.auth.requireEmailVerification && !student.isEmailVerified) {
    return {
      ok: false,
      status: 403,
      message: 'Please verify your email address before signing in. Check your inbox for the link.',
      code: 'EMAIL_NOT_VERIFIED',
    };
  }

  // A successful login clears the failure counter and any expired lock.
  student.failedLoginAttempts = 0;
  student.lockedUntil = null;
  student.lastLoginAt = new Date();
  await student.save();

  await establishSession(res, student, req);

  // Counts toward the daily streak. Idempotent per competition day, so signing in
  // from a second device does not earn a second visit. The engine decides who is
  // eligible — the bootstrap super admin earns nothing, and this call does not need
  // to know that.
  await grantDailyVisit(studentObjectId(student));

  req.user = studentClaims(student);
  return { ok: true };
}

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

    /**
     * The bootstrap super administrator is **staff, not an entrant**, and signs in
     * only at the administrator portal. It has no class, no school and no photo, so
     * a student session would drop it into a dashboard built for a competitor — and
     * the public login form is the most-attacked surface in the product, which is
     * not where the most privileged account in the system should be reachable.
     *
     * A *promoted* admin is unaffected: it really is a student who was given extra
     * capability, and this is its normal way in (the `/admin` portal falls back to
     * this route for exactly that reason).
     */
    const staffOnly: AuthFailure | null =
      student.role === 'superadmin'
        ? {
            ok: false,
            status: 403,
            message: 'Administrator accounts sign in from the administrator portal at /admin.',
          }
        : null;

    const outcome = await authenticateAccount(student, password, req, res, invalidCredentials, staffOnly);
    if (!outcome.ok) {
      sendError(res, outcome.status, outcome.message, outcome.code ? { code: outcome.code } : undefined);
      return;
    }

    // A sign-in by an account that holds administrative capability is itself worth
    // recording — it is the event every later administrative action hangs off.
    if (isPrivilegedRole(student.role)) {
      await recordAudit(req, {
        action: 'admin.session.started',
        targetType: 'system',
        targetLabel: student.email,
        metadata: { role: student.role, via: 'password' },
      });
    }

    sendSuccess(res, 200, await sessionEnvelope(student));
  } catch (err) {
    logger.error({ err }, 'Login failed');
    sendError(res, 500, 'Could not sign you in. Please try again.');
  }
});

/**
 * Signs in the **root super administrator**, provisioning its account on first use.
 *
 * Since Milestone 11 this identity has a real `Student` document, so it holds a
 * rotating refresh token, a `tokenVersion`, and a row in the account listing like
 * everybody else — see `services/rootAdminService.ts` for why that was worth
 * reversing. `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` remain the bootstrap seed.
 *
 * Once the document exists, authentication runs through the **same** path as an
 * ordinary sign-in — lockout, status, verification and session establishment — via
 * `authenticateAccount()`. There is no second password check anywhere in this
 * backend, which is the point: a bespoke one for the most privileged account is
 * exactly where a missing lockout or status check would never be noticed.
 *
 * `ensureDb` is now required, where the old environment-only version answered
 * without a database. That is a real consequence and a deliberate one: every other
 * privileged request already needs the database in order to authorize (see
 * DECISIONS.md), so an admin session that could be *created* without one only ever
 * bought a session that could do nothing.
 */
router.post('/auth/admin/login', loginLimiter, validate({ body: adminLoginSchema }), ensureDb, async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const resolution = await resolveRootSuperadmin(email);

    if (!resolution.ok) {
      if (resolution.reason === 'not-configured') {
        sendError(res, 500, 'Admin account is not configured.');
        return;
      }
      if (resolution.reason === 'email-taken') {
        sendError(res, 500, 'The configured administrator address belongs to another account. Contact the operator.');
        return;
      }
      // 'not-root' — this is not the bootstrap address. The frontend portal reads
      // this 401 as its cue to retry against the ordinary login, which is how a
      // *promoted* admin signs in at the same form.
      sendError(res, 401, 'Invalid admin credentials.');
      return;
    }

    const outcome = await authenticateAccount(resolution.account, password, req, res, 'Invalid admin credentials.');
    if (!outcome.ok) {
      sendError(res, outcome.status, outcome.message, outcome.code ? { code: outcome.code } : undefined);
      return;
    }

    await recordAudit(req, {
      action: 'admin.session.started',
      targetType: 'system',
      targetLabel: resolution.account.email,
      metadata: {
        role: resolution.account.role,
        via: resolution.provisioned ? 'root-bootstrap' : 'root-credentials',
      },
    });

    sendSuccess(res, 200, await sessionEnvelope(resolution.account));
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
    sendSuccess(res, 200, await sessionEnvelope(student));
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

  // Since Milestone 11 there is no document-less identity: the root super admin has
  // an account like everybody else, so this route no longer has a special case, and
  // every caller is resolved the same way.
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
    sendSuccess(res, 200, await sessionEnvelope(student));
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
      // Queued, not sent inline — so the generic response below is returned at the
      // same speed whether or not an account exists. Awaiting a real SMTP round trip
      // here made this endpoint a *timing* oracle for account existence, which is
      // precisely what the identical message is meant to prevent.
      await enqueueEmail({
        ...buildPasswordResetEmail(student.email, token),
        category: 'transactional',
        student: studentObjectId(student),
      });
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
          : outcome.reason === 'superseded'
            // Not "already used": a newer link was requested, so the working one is in
            // the most recent email. Telling them to request another would supersede
            // that one in turn.
            ? 'This reset link is out of date — a newer one has been sent. Open the most recent email.'
            : outcome.reason === 'used'
              ? 'This reset link has already been used. Request a new one.'
              : 'This reset link is invalid. Request a new one.';
      sendError(res, 400, message);
      return;
    }

    // As with email verification, the token is already spent at this point, so any
    // failure below has to give it back — otherwise a transient error turns a valid
    // reset link into a dead one, and the student cannot ask for another without
    // realising they need to.
    try {
    const student = await Student.findById(outcome.studentId);
    if (!student) {
      sendError(res, 400, 'This reset link is invalid. Request a new one.');
      return;
    }

    student.passwordHash = await hashPassword(password);
    student.tokenVersion += 1;
    student.failedLoginAttempts = 0;
    student.lockedUntil = null;
    // Also clears a staff-issued temporary password: the holder has just chosen a
    // password of their own, which is exactly what the flag was waiting for.
    student.mustChangePassword = false;
    // Completing a reset proves control of the mailbox, so treat it as verifying it.
    const wasUnverified = !student.isEmailVerified;
    student.isEmailVerified = true;
    await student.save();

    // The feed should show a password change however it happened, not only when it
    // was done from account settings. Same reasoning for the verification: the reset
    // link proved control of the mailbox just as the verification link would have.
    await grantReward({ student: studentObjectId(student), event: 'password_changed', detail: 'Via emailed reset link' });
    if (wasUnverified) {
      await grantReward({ student: studentObjectId(student), event: 'email_verified' });
    }

    await revokeAllRefreshTokens(studentObjectId(student));
    clearSessionCookies(res);

    sendSuccess(res, 200, { message: 'Password updated. You can now sign in with your new password.' });
    } catch (err) {
      await releaseVerificationToken(token, 'password_reset');
      throw err;
    }
  } catch (err) {
    logger.error({ err }, 'Password reset failed');
    sendError(res, 500, 'Could not reset your password. Please try again — your link is still valid.');
  }
});

export default router;
