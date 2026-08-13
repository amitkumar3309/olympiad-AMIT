import { z } from 'zod';
import { CLASS_LEVELS } from '../lib/classLevels';
import { MAX_BOARD_SIZE } from '../services/hallOfFameService';
import { LEADERBOARD_PERIODS, LEADERBOARD_SCOPES } from '../services/leaderboardService';

/**
 * What a caller may say about a leaderboard.
 *
 * The whole surface is here, and it is worth noticing how small it is: a scope, a class,
 * a period, and where in the list to look. **There is no field through which a client can
 * state an XP total, a score, a rank or a name** — those are not omitted by the handler,
 * they are absent from the schema, and `validate()` replaces the query with the parse
 * result, so an extra key in the request string cannot reach the service at all. The
 * numbers on a board are aggregated from rows this backend wrote; the request only
 * chooses which of them to add up.
 *
 * That is the same reasoning `profileSchemas.ts` records for leaving `role` and `status`
 * out of the profile update schema, applied to the one part of the product where a user
 * has an obvious incentive to lie about a number.
 */

const scope = z.enum(LEADERBOARD_SCOPES).default('overall');
const period = z.enum(LEADERBOARD_PERIODS).default('all_time');

export const leaderboardQuerySchema = z
  .object({
    scope,
    /**
     * Validated against the ten offered classes rather than accepted as free text, so a
     * class board cannot be requested for a class that does not exist (which would
     * silently return an empty board and read as "nobody in Class 7 has any XP").
     */
    classLevel: z.enum(CLASS_LEVELS).optional(),
    period,
    page: z.coerce.number().int().min(1).default(1),
    /**
     * Capped, as it has been since Milestone 5, so a single request cannot dump the
     * roll. Pagination now makes depth a separate question from page size — see
     * `PUBLIC_LEADERBOARD_MAX_ROWS` in the route, which is what keeps a public caller
     * from walking the whole list one page at a time.
     */
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .refine((value) => value.scope !== 'class' || value.classLevel !== undefined, {
    // Deliberately an error rather than a fallback to the caller's own class: a board
    // that quietly changed which cohort it was showing would be worse than one that
    // asks. The frontend always sends the class it is displaying.
    message: 'Choose a class to see a class leaderboard',
    path: ['classLevel'],
  });
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

/** The Hall of Fame takes only a board size — the boards themselves are fixed. */
export const hallOfFameQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_BOARD_SIZE).default(5),
});
export type HallOfFameQuery = z.infer<typeof hallOfFameQuerySchema>;
