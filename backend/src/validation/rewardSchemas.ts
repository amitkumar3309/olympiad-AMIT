import { z } from 'zod';
import { ACTIVITY_TYPES } from '../models/StudentActivity';
import { MAX_CONFIGURABLE_XP } from '../services/rewardService';

/**
 * Reward configuration validation (Milestone 9).
 *
 * Only **amounts** are configurable. Which events exist, how often each may be earned,
 * what makes one eligible and where the level boundaries fall all stay in code — a rule
 * is something to review in a diff, an amount is something to tune on a Tuesday.
 *
 * The record is keyed by the activity-type enum rather than by an open string, so an
 * unknown key is a 400 here rather than a silently ignored override that an
 * administrator would swear they had set. The service re-checks the same two rules,
 * because it is also reachable from a script.
 */
export const updateRewardConfigSchema = z.object({
  /**
   * The complete override set. An event absent from this object reverts to its code
   * default — that is the only way back to it, and it is why this is a replacement
   * rather than a patch.
   */
  xpOverrides: z
    // `partialRecord`, not `record`: with an enum key, zod's `record` requires *every*
    // event to be present, which would turn "override one thing" into "restate the
    // whole table" and make an absent key impossible to express.
    .partialRecord(
      z.enum(ACTIVITY_TYPES),
      z
        .number()
        .int('XP must be a whole number')
        .min(0, 'XP cannot be negative')
        .max(MAX_CONFIGURABLE_XP, `XP cannot exceed ${MAX_CONFIGURABLE_XP} for a single event`),
    )
    .default({}),
});
export type UpdateRewardConfigBody = z.infer<typeof updateRewardConfigSchema>;
