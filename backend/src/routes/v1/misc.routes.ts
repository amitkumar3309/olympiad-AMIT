import { Router, type Request, type Response } from 'express';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { requirePermission } from '../../middleware/auth';
import { publicLookupLimiter } from '../../middleware/rateLimiter';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { getPublicStats } from '../../services/progressService';
import { findEarnedCertificates, findPublishedResult, getAdminStats } from '../../services/resultService';
import { studentIdParamSchema } from '../../validation/userSchemas';

/**
 * Public reads, the result portal, and the admin dashboard's statistics.
 *
 * **Nothing in this file returns invented data any more.** It previously held three
 * hardcoded mocks — a five-name leaderboard with made-up XP and accuracy, a "450+
 * participating schools" counter, and a two-item certificate list returned for any
 * student ID. All three are now real queries.
 */
const router = Router();

// ---------------------------------------------------------------------------
// Public — the landing page
// ---------------------------------------------------------------------------

/**
 * The competition's real participation figures: registered accounts in good
 * standing, how many registered today, how many distinct schools they come from, and
 * how many students have been active today. A brand-new deployment truthfully
 * answers zero for all four, and the landing page is written to handle that.
 */
router.get('/public/stats', ensureDb, async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, 200, { stats: await getPublicStats() });
  } catch (err) {
    logger.error({ err }, 'Failed to load public stats');
    sendError(res, 500, 'Could not load the competition figures right now.');
  }
});

/**
 * `GET /leaderboard` moved to `leaderboard.routes.ts` in Milestone 10, alongside
 * `GET /hall-of-fame`, when it gained scopes, periods and pagination. Its response still
 * carries the same `leaderboard` array, so the landing page did not change.
 */

// ---------------------------------------------------------------------------
// Result portal
// ---------------------------------------------------------------------------

/**
 * Looks up a **published** result by student ID.
 *
 * This replaced the single worst piece of fabrication in the product. The result page
 * used to compute a score, a national rank and a percentile by hashing whatever
 * string was typed into its search box — so any visitor could enter any ID, or a
 * made-up one, and be shown an authoritative-looking "72/100, National Rank #146,
 * 91.4th percentile" for a competition that has not been sat. It is gone.
 *
 * Deliberately **unauthenticated**, because a public result portal is what the page
 * is for (a parent or a school checking a child's result should not need an account),
 * with four properties that keep that safe:
 *
 *  - only `isPublished` results are visible, so marks cannot be read before release;
 *  - the response for "no such account" and "no published result" is **identical**,
 *    so the portal cannot be used to enumerate which student IDs exist;
 *  - it returns marks and ranks only — no email, mobile, address or date of birth;
 *  - the name is **masked** to a first name and last initial, and the route is rate
 *    limited. Both were added by the security audit: `AMIT_xxxx` is only ten thousand
 *    identifiers, so without them this was a way to walk the numbering and harvest
 *    every entrant's full legal name beside their score and national rank — more than
 *    the leaderboard is allowed to publish about the same children.
 */
router.get(
  '/results/:studentId',
  publicLookupLimiter,
  validate({ params: studentIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      // `validate({ params })` has already parsed and replaced these against
      // `studentIdParamSchema`, so narrowing here states an established fact — the same
      // pattern the question routes use for their id param.
      const { studentId } = req.params as unknown as { studentId: string };
      const lookup = await findPublishedResult(studentId);

      if (!lookup.found) {
        // One shape for both reasons. A 200 rather than a 404 because "there is no
        // result yet" is the expected, ordinary answer for every student today.
        sendSuccess(res, 200, { result: null, reason: 'not-published' });
        return;
      }

      sendSuccess(res, 200, { result: lookup.result });
    } catch (err) {
      logger.error({ err }, 'Failed to look up a result');
      sendError(res, 500, 'Could not look up that result. Please try again.');
    }
  },
);

/**
 * Certificates a student has **actually earned**, which requires a published result.
 *
 * Was a hardcoded two-item array returned for any `:studentId`, including one that
 * did not exist. Now a real query, which today returns `[]` for everyone — and the
 * certificate page renders "not earned yet" rather than printing an award nobody won.
 *
 * Public, and therefore masked and rate limited for the same reason as the result
 * portal above. The `verificationCode` is never included here — that is what public
 * verification keys on, and it is the difference between confirming a document
 * somebody holds and being handed one.
 */
router.get(
  '/certificates/:studentId',
  publicLookupLimiter,
  validate({ params: studentIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { studentId } = req.params as unknown as { studentId: string };
      sendSuccess(res, 200, { certificates: await findEarnedCertificates(studentId) });
    } catch (err) {
      logger.error({ err }, 'Failed to load certificates');
      sendError(res, 500, 'Could not load certificates. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Administrative statistics
// ---------------------------------------------------------------------------

/**
 * Real platform activity for the admin dashboard chart: registrations per day and
 * active students per day, over the last two weeks.
 *
 * Replaces a hardcoded "Weekly Accuracy Trend" (`72, 78, 75, 82, 88, 90, 92` against
 * Mon–Sun). That was labelled as sample data, but a labelled invention is still an
 * invention — and an accuracy trend cannot exist while no answer has ever been
 * scored. These two series are things the platform genuinely knows.
 */
router.get('/admin/stats', requirePermission('students:read'), ensureDb, async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, 200, { stats: await getAdminStats() });
  } catch (err) {
    logger.error({ err }, 'Failed to load admin stats');
    sendError(res, 500, 'Could not load platform statistics. Please try again.');
  }
});

export default router;
