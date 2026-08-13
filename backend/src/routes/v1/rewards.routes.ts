import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { Student, type StudentDocument } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { recordAudit } from '../../lib/audit';
import { todayKey } from '../../lib/competitionDay';
import { respondToServiceError } from '../../lib/serviceError';
import { actorFrom } from '../../services/taxonomyService';
import { emptyRewardSummary, getRewardConfig, summariseRewards, updateRewardConfig } from '../../services/rewardService';
import { updateRewardConfigSchema, type UpdateRewardConfigBody } from '../../validation/rewardSchemas';

/**
 * The gamification surface (Milestone 9): a student's whole standing in one response,
 * and the administrator's award table.
 *
 * The student route is `requireAuth()` like the rest of `/me` — the requirement is an
 * identity, and no route here accepts a student id. The configuration routes gate on
 * `rewards:write`, which is elevated, so the caller's role is re-read from the database
 * on every request.
 *
 * Nothing in this file computes a reward, a tier or a stage. It asks
 * `services/rewardService.ts` and renders the answer.
 */
const router = Router();

/** The caller's own account. The root admin has no student record and so no standing. */
async function loadSelf(req: Request, res: Response): Promise<StudentDocument | null> {
  const sub = req.user?.sub;
  if (!sub) {
    sendError(res, 404, 'The root administrator has no rewards. Sign in with a student account.');
    return null;
  }
  const student = await Student.findById(sub);
  if (!student) {
    sendError(res, 404, 'Your account could not be found.');
    return null;
  }
  return student;
}

// ---------------------------------------------------------------------------
// The student's standing
// ---------------------------------------------------------------------------

/**
 * XP, level, streaks, badges, achievements and the journey map — everything the
 * rewards page shows, in one request.
 *
 * **Every figure is derived from recorded events.** There is no stored progress
 * document anywhere in this product: XP is a sum over the activity log, the level is a
 * pure function of it, streaks come from the distinct days that log contains, and the
 * three catalogues are pure functions of one facts object. A student who has done
 * nothing sees honest zeroes and real targets, not a decorated empty state.
 *
 * The whole catalogue is returned rather than the dashboard's top three: this is the
 * page a student opens to see everything, including what is still a long way off.
 */
router.get('/me/rewards', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const student = await loadSelf(req, res);
    if (!student) return;

    const rewards = await summariseRewards(student, todayKey());

    sendSuccess(res, 200, {
      rewards: {
        xp: rewards.level.xp,
        level: rewards.level,
        streak: rewards.streak,
        challengeStreak: rewards.challengeStreak,
        badges: rewards.badges,
        achievements: rewards.achievements,
        journey: rewards.journey,
        // The counts the catalogues were evaluated from, so the page can show "12
        // practice sessions" beside the badge that measures them rather than making
        // the student infer the number from a progress bar.
        totals: {
          practiceSessions: rewards.facts.practiceSessionsCompleted,
          mockTests: rewards.facts.mockTestsCompleted,
          dailyChallenges: rewards.facts.challengesCompleted,
          activeDays: rewards.facts.activeDays,
        },
      },
      today: todayKey(),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load the reward summary');
    // The empty shape rather than a 500: a page of zeroes with a warning is a better
    // outcome than a blank screen, and every figure on it is still honest.
    sendError(res, 500, 'Could not load your rewards. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// Administrator configuration
// ---------------------------------------------------------------------------

/**
 * The award table: what each event is worth by default, what has been overridden, and
 * what a grant would actually pay right now.
 *
 * Deliberately shows all three columns rather than just the effective value, because
 * "someone changed this" and "this is how it ships" are different facts, and an
 * administrator looking at a number needs to know which one they are seeing.
 */
router.get(
  '/admin/reward-settings',
  requirePermission('rewards:write'),
  ensureDb,
  async (_req: Request, res: Response) => {
    try {
      sendSuccess(res, 200, { config: await getRewardConfig() });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to load reward settings',
        fallback: 'Could not load the reward settings. Please try again.',
      });
    }
  },
);

/**
 * Replaces the override table.
 *
 * **This cannot re-price anybody's history.** Every activity row stores what its event
 * was worth at the time, and a student's total is the sum of those recorded values — so
 * this changes what the *next* event pays and nothing else. That is a property of the
 * data model rather than a promise made here, and it has its own test.
 *
 * The whole set is sent, like a question edit: an event absent from the payload reverts
 * to its code default, which is the only way back to it. A partial patch would make
 * "remove this override" and "leave it alone" the same request.
 */
router.put(
  '/admin/reward-settings',
  requirePermission('rewards:write'),
  validate({ body: updateRewardConfigSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { xpOverrides } = req.body as UpdateRewardConfigBody;
      const config = await updateRewardConfig(xpOverrides, actorFrom(req));

      await recordAudit(req, {
        action: 'reward.settings.updated',
        targetType: 'system',
        targetId: 'reward-settings',
        targetLabel: 'XP award table',
        // The whole resulting table, so the trail answers "what was it changed to?"
        // without needing the document as it stood at that moment.
        metadata: { overrides: xpOverrides },
      });

      sendSuccess(res, 200, { config });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to update reward settings',
        fallback: 'Could not save the reward settings. Please try again.',
      });
    }
  },
);

export { emptyRewardSummary };
export default router;
