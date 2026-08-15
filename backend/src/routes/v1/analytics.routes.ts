import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requirePermission, callerCanFresh } from '../../middleware/auth';
import { Student } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { ensureDb } from '../../middleware/ensureDb';
import { logger } from '../../lib/logger';
import { getXpByDay } from '../../services/progressService';
import { getStudentAnalytics } from '../../services/analyticsService';
import { getRecommendations } from '../../services/recommendationService';

const router = Router();

/**
 * Resolves the account named in the path and checks the caller may read it.
 *
 * Shared by both routes below so the two cannot drift apart: they expose the same
 * student's record, so one being stricter than the other would be a disclosure bug in
 * whichever is looser. Returns null having already answered, so a handler that forgets
 * to return early fails loudly rather than continuing unauthorised.
 */
async function resolveReadableAccount(req: Request, res: Response) {
  // Reading someone else's record is a separate capability. The check is fresh (a
  // database read) rather than token-based, so a demoted admin cannot keep browsing
  // other students' data until their access token expires.
  const isOwnRecord = req.user!.studentId === req.params.studentId;
  if (!isOwnRecord && !(await callerCanFresh(req, 'analytics:read:any'))) {
    sendError(res, 403, 'You can only view your own analytics.');
    return null;
  }

  const account = await Student.findOne({ studentId: req.params.studentId }).select('_id classLevel');
  if (!account) {
    sendError(res, 404, 'No account exists with that student ID.');
    return null;
  }

  return account;
}

/**
 * Performance analytics for one student — **real, and derived on read** (Milestone 15).
 *
 * ## The two things this endpoint used to be
 *
 * First it **lied**: with no `StudentAnalytics` document — which was every student,
 * because nothing ever wrote one — it returned a hardcoded 88% accuracy over 450
 * questions, a rising five-point learning curve, four invented topic breakdowns and
 * "you are currently in the top 5% of all national Olympiad participants". That was
 * deleted in the Milestone 5 follow-up.
 *
 * Then it was **honestly empty**: `data: null` with `reason: 'no-exam-data'`, because
 * the only real thing available was an XP series. That was correct at the time and is
 * no longer, because four collections now hold graded answers.
 *
 * ## What it is now
 *
 * Everything is computed from submitted `PracticeSession`, `MockTestAttempt`,
 * `DailyChallengeAttempt` and `ExamAttempt` documents by `services/analyticsService.ts`.
 * There is **no analytics collection**, deliberately — the same decision XP, levels,
 * streaks and the leaderboard rest on. A stored breakdown is a number that can drift
 * from the answers behind it, and it would need invalidating on every submission.
 *
 * `StudentAnalytics` is **gone**, not repurposed: it predated Milestone 4, keyed on a
 * string `studentId`, and stored topics as free text with no reference to the `Topic`
 * collection. See the Milestone 15 ADR.
 *
 * `xpByDay` is kept alongside, unchanged. It measures participation where the rest of
 * this measures ability, and both belong on the page.
 */
router.get(
  '/analytics/:studentId',
  requirePermission('analytics:read:self'),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const account = await resolveReadableAccount(req, res);
      if (!account) return;

      const studentObjectId = account._id as Types.ObjectId;
      const [analytics, xpByDay] = await Promise.all([
        getStudentAnalytics(studentObjectId),
        getXpByDay(studentObjectId),
      ]);

      sendSuccess(res, 200, { analytics, xpByDay });
    } catch (err) {
      logger.error({ err, studentId: req.params.studentId }, 'Failed to derive student analytics');
      sendError(res, 500, 'Could not load those analytics right now. Please try again.');
    }
  },
);

/**
 * What the student should do next — Milestone 16.
 *
 * Derived from the same submitted attempts the route above reports, plus the published
 * question bank for the student's own class. Nothing is stored: there is no
 * recommendation collection, for the reason `StudentAnalytics` no longer exists.
 *
 * ## Why it is not folded into `GET /analytics/:studentId`
 *
 * The engine behind it is a **seam** (`lib/recommendationTypes.ts`): the default is
 * arithmetic, but a model-backed engine can be registered instead, and a model has
 * latency the arithmetic does not. A separate request means the analytics page paints
 * its figures immediately and fills this panel when it arrives — a slow engine costs one
 * panel rather than the page. The two cannot disagree, because every recommendation
 * carries the counts it was derived from rather than pointing at the other response.
 *
 * The authorization is deliberately the *same* check, through the same function: this
 * exposes the same student's record, and a recommendation quotes their accuracy in its
 * own text.
 */
router.get(
  '/analytics/:studentId/recommendations',
  requirePermission('analytics:read:self'),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const account = await resolveReadableAccount(req, res);
      if (!account) return;

      const recommendations = await getRecommendations(
        account._id as Types.ObjectId,
        // Staff have no class, so there is no bank to recommend from. Null rather than
        // a guess: the engine returns a note saying so.
        account.classLevel ?? null,
      );

      sendSuccess(res, 200, { recommendations });
    } catch (err) {
      logger.error({ err, studentId: req.params.studentId }, 'Failed to derive recommendations');
      sendError(res, 500, 'Could not work out your recommendations right now. Please try again.');
    }
  },
);

export default router;
