import { Router, type Request, type Response } from 'express';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { getPublicStats, getTopLeaderboard } from '../../services/progressService';
import { leaderboardQuerySchema, type LeaderboardQuery } from '../../validation/profileSchemas';

/**
 * The two public, unauthenticated reads the landing page needs.
 *
 * Both used to be hardcoded mocks in this file — a five-name leaderboard with
 * invented XP and accuracy figures, and a "450+ participating schools" counter. They
 * are now real aggregations. That was an explicit decision by the project owner
 * (Milestone 5): the landing page is the first thing a parent or a teacher sees, and
 * a fabricated standing there is the least defensible fake statistic in the product.
 *
 * They are readable **without signing in**, which is the deliberate trade that
 * decision carries. Two things bound the exposure:
 *  - names are shortened to a first name and a last initial by `displayNameFor`,
 *    because the entrants are schoolchildren and this page is indexable;
 *  - `limit` is validated and capped, so the endpoint returns a leaderboard and
 *    cannot be walked to enumerate the roll.
 */
const router = Router();

/**
 * The competition's real participation figures.
 *
 * Counts, not estimates: registered accounts in good standing, how many of those
 * registered today, how many distinct schools they come from, and how many students
 * have been active today. A brand-new deployment truthfully answers zero for all
 * four, and the landing page is written to handle that.
 */
router.get('/public/stats', ensureDb, async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, 200, { stats: await getPublicStats() });
  } catch (err) {
    logger.error({ err }, 'Failed to load public stats');
    sendError(res, 500, 'Could not load the competition figures right now.');
  }
});

router.get('/leaderboard', validate({ query: leaderboardQuerySchema }), ensureDb, async (req: Request, res: Response) => {
  try {
    const { limit } = req.query as unknown as LeaderboardQuery;
    const leaderboard = await getTopLeaderboard(limit);
    // An empty leaderboard is a correct answer, not an error: nobody has XP yet.
    sendSuccess(res, 200, { leaderboard });
  } catch (err) {
    logger.error({ err }, 'Failed to load the leaderboard');
    sendError(res, 500, 'Could not load the leaderboard right now.');
  }
});

/**
 * **Still a mock, and still called by nothing.**
 *
 * Left exactly as it was found. It is out of this milestone's scope (the Certificate
 * page renders client-side from the signed-in student's own name and never calls
 * this), and issuing real certificates depends on exam results that do not exist
 * yet — so there is nothing real to return. It is recorded as an open item in
 * FEATURE_STATUS.md rather than quietly deleted, because removing a published
 * endpoint is a decision for the project owner.
 */
router.get('/certificates/:studentId', (_req, res) => {
  sendSuccess(res, 200, {
    certificates: [
      { id: 'CERT-2026-01', title: 'National Math Olympiad Finalist', date: '15 June 2026', status: 'Verified & Ready' },
      { id: 'CERT-2026-02', title: 'Advanced Calculus Masterclass', date: '02 May 2026', status: 'Verified & Ready' },
    ],
  });
});

export default router;
