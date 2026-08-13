import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { accountUpdateLimiter } from '../../middleware/rateLimiter';
import { Student, StudentPhoto, type StudentDocument } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { recordAudit } from '../../lib/audit';
import { hashPassword, verifyPassword } from '../../lib/password';
import { revokeAllRefreshTokens } from '../../lib/tokens';
import { establishSession, studentObjectId } from '../../lib/session';
import { summariseAchievements } from '../../lib/achievements';
import { todayKey } from '../../lib/competitionDay';
import { isClassLevel } from '../../lib/classLevels';
import { buildRewardFacts, grantDailyVisit, grantReward } from '../../services/rewardService';
import { getRecentActivity, listActivity, getRecentExamPerformance } from '../../services/progressService';
import { getStanding, getTopLeaderboard } from '../../services/leaderboardService';
import { getAvailableChallenges } from '../../services/challengeService';
import {
  updateProfileSchema,
  updatePhotoSchema,
  changePasswordSchema,
  listActivityQuerySchema,
  type UpdateProfileInput,
  type UpdatePhotoInput,
  type ChangePasswordInput,
  type ListActivityQuery,
} from '../../validation/profileSchemas';

/**
 * Everything a signed-in student can see or change about **themselves**: their
 * profile, their account settings, and the dashboard derived from their own
 * recorded activity.
 *
 * These routes are gated with `requireAuth()` rather than `requirePermission(...)`,
 * because the requirement genuinely is an identity and not a capability — "this is
 * my own account" is not something a permission can express, and inventing a
 * `profile:read:self` permission that literally every role holds would add a row to
 * the authorization table that never denies anything. That is the same reasoning
 * `/auth/logout-all` and the own-photo route already use (see CLAUDE.md, "Backend
 * Conventions"). Each handler then resolves the caller's *own* document from the
 * token's `sub`; no route here takes a student id from the request, so there is no
 * path on which one student could address another's record.
 */
const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The caller's own account, or a response explaining why there isn't one.
 *
 * The environment-configured root administrator has no `Student` document at all
 * (it is the bootstrap identity — see DECISIONS.md), so it has no profile, no
 * activity and no dashboard. That is answered as a clear 404 rather than a 500 from
 * a null dereference, and it is why every handler goes through here.
 */
async function loadSelf(req: Request, res: Response): Promise<StudentDocument | null> {
  const sub = req.user?.sub;
  if (!sub) {
    sendError(res, 404, 'The root administrator has no student profile. Sign in with a student account.');
    return null;
  }

  const student = await Student.findById(sub);
  if (!student) {
    sendError(res, 401, 'Your session is no longer valid.');
    return null;
  }
  return student;
}

/**
 * The student's own view of their profile.
 *
 * Wider than the session envelope's `publicStudent` — it adds the account metadata
 * a settings page needs (when the account was registered, whether a photo exists) —
 * and still an explicit allow-list. `passwordHash` is `select: false` and nothing
 * here would pick it up even if that guard were lost.
 */
function profileView(student: StudentDocument, hasPhoto: boolean) {
  return {
    studentId: student.studentId,
    fullName: student.fullName ?? null,
    firstName: student.firstName ?? null,
    middleName: student.middleName ?? null,
    lastName: student.lastName ?? null,
    fatherName: student.fatherName ?? null,
    motherName: student.motherName ?? null,
    dateOfBirth: student.dateOfBirth ? student.dateOfBirth.toISOString().slice(0, 10) : null,
    classLevel: student.classLevel ?? null,
    schoolName: student.schoolName ?? null,
    address: student.address ?? null,
    // Identity fields: shown so the student can read them, but not editable here —
    // see the note in validation/profileSchemas.ts.
    mobile: student.mobile,
    email: student.email,
    isEmailVerified: student.isEmailVerified,
    status: student.status,
    role: student.role,
    registeredAt: student.registeredAt,
    lastLoginAt: student.lastLoginAt ?? null,
    hasPhoto,
  };
}

/** Describes what changed, for the activity feed and the audit trail. */
function changedFields(before: UpdateProfileInput, after: UpdateProfileInput): string[] {
  const keys = Object.keys(after) as Array<keyof UpdateProfileInput>;
  return keys.filter((key) => {
    const a = before[key];
    const b = after[key];
    if (a instanceof Date && b instanceof Date) return a.getTime() !== b.getTime();
    return (a ?? null) !== (b ?? null);
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

router.get('/me/profile', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const student = await loadSelf(req, res);
    if (!student) return;

    // Existence only — the bytes are served separately by /students/:id/photo, so a
    // profile load never drags a 2 MB image through this response.
    const photo = await StudentPhoto.exists({ student: studentObjectId(student) });
    sendSuccess(res, 200, { profile: profileView(student, photo !== null) });
  } catch (err) {
    logger.error({ err }, 'Failed to load own profile');
    sendError(res, 500, 'Could not load your profile. Please try again.');
  }
});

/**
 * Edits the caller's own details — the gap recorded in PROJECT_STATE.md as "no one
 * can edit their own details after registering".
 *
 * A full replacement of the editable set rather than a sparse patch: the form always
 * submits every field, and requiring all of them means a missing key is a validation
 * error instead of a silent no-change, which is the failure mode that leaves half a
 * form saved.
 */
router.patch(
  '/me/profile',
  requireAuth(),
  accountUpdateLimiter,
  validate({ body: updateProfileSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const update = req.body as UpdateProfileInput;
      const before: UpdateProfileInput = {
        firstName: student.firstName,
        middleName: student.middleName ?? null,
        lastName: student.lastName,
        fatherName: student.fatherName,
        motherName: student.motherName,
        dateOfBirth: student.dateOfBirth,
        classLevel: student.classLevel,
        schoolName: student.schoolName,
        address: student.address,
      };

      const changed = changedFields(before, update);
      if (changed.length === 0) {
        const photo = await StudentPhoto.exists({ student: studentObjectId(student) });
        sendSuccess(res, 200, { changed: false, profile: profileView(student, photo !== null) });
        return;
      }

      student.firstName = update.firstName;
      student.middleName = update.middleName;
      student.lastName = update.lastName;
      student.fatherName = update.fatherName;
      student.motherName = update.motherName;
      student.dateOfBirth = update.dateOfBirth;
      student.classLevel = update.classLevel;
      student.schoolName = update.schoolName;
      student.address = update.address;
      // `fullName` is derived by the schema's pre-validate hook, never assigned here.
      await student.save();

      const detail =
        changed.includes('classLevel') && isClassLevel(before.classLevel)
          ? `${before.classLevel} → ${update.classLevel}`
          : `Updated ${changed.length} field${changed.length === 1 ? '' : 's'}`;

      await grantReward({ student: studentObjectId(student), event: 'profile_updated', detail });
      // A change to an account belongs in the trail whoever made it — here, the
      // account's own owner. The changed field *names* are recorded, never the
      // values: this log is readable by any admin, and a student's home address is
      // not something to copy into it.
      await recordAudit(req, {
        action: 'student.profile.updated',
        targetType: 'student',
        targetId: student.studentId,
        targetLabel: student.email,
        metadata: { fields: changed, self: true },
      });

      const photo = await StudentPhoto.exists({ student: studentObjectId(student) });
      sendSuccess(res, 200, { changed: true, profile: profileView(student, photo !== null) });
    } catch (err) {
      logger.error({ err }, 'Failed to update own profile');
      sendError(res, 500, 'Could not save your profile. Please try again.');
    }
  },
);

/**
 * Replaces the caller's profile photo — the other half of known bug #9, "a photo
 * cannot be replaced or removed" (PROJECT_STATE.md), which until now needed a direct
 * database edit.
 *
 * `PUT` because it is a whole-resource replacement, and an upsert because the photo
 * is mandatory at registration but may be missing on a legacy account. Deletion is
 * deliberately not offered: the photo is a required part of an entrant's record, so
 * "remove" would leave the account in a state registration cannot produce.
 */
router.put(
  '/me/photo',
  requireAuth(),
  accountUpdateLimiter,
  validate({ body: updatePhotoSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { photo } = req.body as UpdatePhotoInput;

      await StudentPhoto.findOneAndUpdate(
        { student: studentObjectId(student) },
        {
          student: studentObjectId(student),
          contentType: photo.contentType,
          size: photo.data.length,
          data: photo.data,
          uploadedAt: new Date(),
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      );

      await grantReward({ student: studentObjectId(student), event: 'photo_updated' });
      await recordAudit(req, {
        action: 'student.photo.updated',
        targetType: 'student',
        targetId: student.studentId,
        targetLabel: student.email,
        metadata: { contentType: photo.contentType, bytes: photo.data.length, self: true },
      });

      sendSuccess(res, 200, { message: 'Your photo has been updated.', contentType: photo.contentType, size: photo.data.length });
    } catch (err) {
      logger.error({ err }, 'Failed to replace own photo');
      sendError(res, 500, 'Could not save your photo. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------

/**
 * Changes the caller's password.
 *
 * Requires the current password even though the caller already holds a session, so a
 * borrowed or stolen session cannot lock the real owner out of their own account.
 *
 * On success every existing session is revoked — the same response as a password
 * reset, because the reason to change a password is usually that someone else may
 * have it — and then *this* device is issued a fresh session. Signing the student
 * out of the page they are standing on would be a worse experience for no security
 * gain: they have just proved they know both passwords.
 */
router.post(
  '/me/change-password',
  requireAuth(),
  accountUpdateLimiter,
  validate({ body: changePasswordSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const sub = req.user?.sub;
      if (!sub) {
        sendError(res, 404, 'The root administrator has no student profile. Its password is set by environment variable.');
        return;
      }

      // Opt back in to the hash, which the schema hides by default.
      const student = await Student.findById(sub).select('+passwordHash');
      if (!student) {
        sendError(res, 401, 'Your session is no longer valid.');
        return;
      }

      const { currentPassword, newPassword } = req.body as ChangePasswordInput;
      if (!(await verifyPassword(currentPassword, student.passwordHash))) {
        // No lockout counter is touched here: this endpoint already needs a valid
        // session, and letting a wrong guess lock the account would hand any
        // borrowed session an easy way to deny the owner their own login.
        sendError(res, 401, 'That is not your current password.');
        return;
      }

      student.passwordHash = await hashPassword(newPassword);
      student.tokenVersion += 1;
      // Clears a staff-issued temporary password. This is the only route that
      // lowers the flag, which is what makes the forced-change screen escapable
      // exactly one way: by actually changing the password.
      student.mustChangePassword = false;
      await student.save();

      await revokeAllRefreshTokens(studentObjectId(student));
      // Re-issued *after* the revocation, and from the saved document, so the new
      // access token carries the bumped `tokenVersion` and is not itself invalidated.
      await establishSession(res, student, req);

      await grantReward({ student: studentObjectId(student), event: 'password_changed', detail: 'From account settings' });
      await recordAudit(req, {
        action: 'student.password.changed',
        targetType: 'student',
        targetId: student.studentId,
        targetLabel: student.email,
        metadata: { self: true, otherSessionsRevoked: true },
      });

      sendSuccess(res, 200, {
        message: 'Your password has been changed. Other devices have been signed out.',
      });
    } catch (err) {
      logger.error({ err }, 'Failed to change own password');
      sendError(res, 500, 'Could not change your password. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** How much of each list the dashboard carries. Full lists have their own endpoints. */
const DASHBOARD_ACTIVITY_LIMIT = 8;
const DASHBOARD_EXAM_LIMIT = 5;
const DASHBOARD_LEADERBOARD_LIMIT = 5;

/**
 * Everything the student dashboard shows, in one request.
 *
 * **Every figure in this response is derived from a real database read.** There is no
 * sample data and no fallback: where a student has nothing yet, the corresponding
 * array comes back empty and the frontend renders an empty state. In particular
 * `recentTests` is a live query against `ExamAttempt`, which nothing writes to yet —
 * so it is honestly empty today and starts working the moment exam submission
 * exists, rather than being a hardcoded `[]` that someone must remember to replace.
 *
 * The one deliberate side effect: opening the dashboard records the day's visit,
 * which is what a streak is made of. It is idempotent per competition day (enforced
 * by a unique index, not by a check here), so a page refresh cannot inflate it.
 */
router.get('/me/dashboard', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const student = await loadSelf(req, res);
    if (!student) return;

    const id = studentObjectId(student);
    const today = todayKey();

    // Recorded before the progress is read, so today's visit is included in the
    // streak the student is about to be shown rather than appearing a load later.
    await grantDailyVisit(id);

    // One facts object from the reward engine, which is the only place these figures
    // are queried (Milestone 9). The dashboard's achievement panel and the rewards page
    // therefore cannot disagree — they are literally the same function of the same
    // facts. Assembling them here by hand is what this replaced.
    const { facts, level, streak } = await buildRewardFacts(student, today);
    const progress = { level, streak };

    const [activity, exams, leaderboard, standing, challenges] = await Promise.all([
      getRecentActivity(id, DASHBOARD_ACTIVITY_LIMIT),
      getRecentExamPerformance(student.studentId, DASHBOARD_EXAM_LIMIT),
      getTopLeaderboard(DASHBOARD_LEADERBOARD_LIMIT),
      getStanding(id, level.xp),
      // A class is needed to know what is on offer. Legacy accounts predate the
      // field, so they get an empty list and an explanatory empty state rather than
      // questions for a class they are not in.
      isClassLevel(student.classLevel) ? getAvailableChallenges(student.classLevel) : Promise.resolve([]),
    ]);

    const achievements = summariseAchievements(facts);

    sendSuccess(res, 200, {
      dashboard: {
        student: {
          studentId: student.studentId,
          fullName: student.fullName ?? null,
          firstName: student.firstName ?? null,
          classLevel: student.classLevel ?? null,
          schoolName: student.schoolName ?? null,
        },
        progress: { ...progress.level, streak: progress.streak },
        activity,
        recentTests: exams,
        achievements,
        leaderboard: { top: leaderboard, me: standing },
        challenges,
        today,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load dashboard');
    sendError(res, 500, 'Could not load your dashboard. Please try again.');
  }
});

/** The full activity feed, paginated — the dashboard only carries the newest few. */
router.get(
  '/me/activity',
  requireAuth(),
  validate({ query: listActivityQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { page, limit } = req.query as unknown as ListActivityQuery;
      const { entries, total } = await listActivity(studentObjectId(student), page, limit);

      sendSuccess(res, 200, {
        entries,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to load activity feed');
      sendError(res, 500, 'Could not load your activity. Please try again.');
    }
  },
);

/**
 * `GET /me/daily-challenge` moved to `routes/v1/dailyChallenge.routes.ts` in
 * Milestone 8, when it stopped being a read-only view and became a thing a student
 * answers — with an attempt to persist, a reward to award once, and a scheduled
 * counterpart on the admin side. Both the `/me/...` and bare `/daily-challenge` paths
 * are still served there.
 */

export default router;
