import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { attachUserIfPresent } from '../../middleware/auth';
import { ensureDb } from '../../middleware/ensureDb';
import { validate } from '../../middleware/validate';
import { sendError, sendSuccess } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { todayKey } from '../../lib/competitionDay';
import {
  getLeaderboardPage,
  getStandingFor,
  type LeaderboardScopeInput,
  type LeaderboardStanding,
} from '../../services/leaderboardService';
import { getHallOfFame } from '../../services/hallOfFameService';
import {
  hallOfFameQuerySchema,
  leaderboardQuerySchema,
  type HallOfFameQuery,
  type LeaderboardQuery,
} from '../../validation/leaderboardSchemas';

/**
 * The public standing: leaderboards and the Hall of Fame.
 *
 * Both are readable **without signing in**, which is the trade the project owner
 * accepted so the landing page can show a real standing rather than an invented one.
 * Three things keep that safe, and all three survive the scopes and pagination this
 * milestone added:
 *
 *  - names are shortened to a first name and a last initial by `displayNameFor()`, the
 *    single place that decides how much of a child's name this product publishes;
 *  - no contact detail, date of birth or student record is projected — a row is a name,
 *    a class, a school and a number;
 *  - the depth an anonymous visitor may reach is capped (see below), so the endpoint
 *    returns a *leaderboard* and cannot be walked to enumerate the roll.
 *
 * See SECURITY.md.
 */
const router = Router();

/**
 * How far into the board an anonymous visitor may page.
 *
 * Before pagination, "cannot be used to dump the roll" was guaranteed by the 50-row
 * cap on a single request. Pagination removes that guarantee by itself — fifty rows at
 * a time, repeatedly, is the whole list — so the property is restored explicitly here:
 * a signed-out caller sees the top hundred, which is a leaderboard, and a signed-in
 * student may page the whole board, which is a list they are already part of and need
 * in order to find themselves. The entrants are minors and this page is indexable; that
 * asymmetry is the point.
 */
export const PUBLIC_LEADERBOARD_MAX_ROWS = 100;

/** The caller's own account id, when a student session is present. */
function callerStudentId(req: Request): mongoose.Types.ObjectId | null {
  const sub = req.user?.sub;
  // The root administrator has no `Student` document at all, so it has no standing —
  // and `sub` is absent from its claims entirely.
  if (!sub || !mongoose.isValidObjectId(sub)) return null;
  return new mongoose.Types.ObjectId(sub);
}

/**
 * A page of a leaderboard.
 *
 * `scope` selects the roll (everybody, or one class), `period` selects the days whose XP
 * is counted (all time, or the last 30 / 7 / 1 competition days), and `page`/`limit`
 * select the slice. Everything else about a row — the XP, the rank, the name — is
 * derived by the service from rows this backend wrote. The request cannot state a value;
 * see `validation/leaderboardSchemas.ts`.
 *
 * The response keeps its original `leaderboard` array key, so the landing page and any
 * other existing caller keep working unchanged; the scope, window, pagination and the
 * caller's own standing are additions alongside it.
 */
router.get(
  '/leaderboard',
  validate({ query: leaderboardQuerySchema }),
  attachUserIfPresent,
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { scope, classLevel, period, page, limit } = req.query as unknown as LeaderboardQuery;
      const signedIn = req.user !== undefined;
      const today = todayKey();

      const rowsBefore = (page - 1) * limit;
      if (!signedIn && rowsBefore >= PUBLIC_LEADERBOARD_MAX_ROWS) {
        sendError(
          res,
          403,
          `Sign in to see past the top ${PUBLIC_LEADERBOARD_MAX_ROWS} of the leaderboard.`,
        );
        return;
      }

      // The union is what makes a class board without a class unrepresentable; the zod
      // schema has already refused that combination, so this narrowing restates a fact
      // rather than checking one.
      const target: LeaderboardScopeInput =
        scope === 'class' ? { scope, classLevel: classLevel!, period, today } : { scope: 'overall', period, today };

      const board = await getLeaderboardPage(target, { page, limit });

      // A signed-in student gets their own standing on the board they are looking at, in
      // the same response — including when they are not on it, which is a real answer
      // ("you have no XP this week") rather than a missing one.
      const student = callerStudentId(req);
      let me: LeaderboardStanding | null = null;
      if (student) me = await getStandingFor(student, target);

      sendSuccess(res, 200, {
        leaderboard: board.rows,
        scope: board.scope,
        classLevel: board.classLevel,
        period: board.period,
        window: board.window,
        pagination: board.pagination,
        me,
        /** Null when the caller may page the whole board. */
        maxRankedDepth: signedIn ? null : PUBLIC_LEADERBOARD_MAX_ROWS,
        today,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to load the leaderboard');
      sendError(res, 500, 'Could not load the leaderboard right now.');
    }
  },
);

/**
 * The Hall of Fame: five boards of real, dated achievement.
 *
 * Unpaginated on purpose. An honours list is short by definition — the whole point is
 * that being on it means something — so each board carries a handful of names and the
 * only knob is how many. A board with nothing behind it is returned **empty with a
 * reason**, never padded.
 */
router.get('/hall-of-fame', validate({ query: hallOfFameQuerySchema }), ensureDb, async (req: Request, res: Response) => {
  try {
    const { limit } = req.query as unknown as HallOfFameQuery;
    sendSuccess(res, 200, { hallOfFame: await getHallOfFame(limit) });
  } catch (err) {
    logger.error({ err }, 'Failed to load the hall of fame');
    sendError(res, 500, 'Could not load the Hall of Fame right now.');
  }
});

export default router;
