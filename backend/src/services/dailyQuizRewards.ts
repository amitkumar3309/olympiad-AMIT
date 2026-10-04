import type { Types } from 'mongoose';
import { logger } from '../lib/logger';
import { dayKeyOf } from '../lib/competitionDay';
import { quizPhaseAt } from '../lib/dailyQuiz';
import { DailyChallengeAttempt, type DailyChallengeAttemptDocument } from '../models';
import { grantReward } from './rewardService';

/**
 * Paying for a Daily Quiz answer (Milestone 30, Phase 2).
 *
 * The amount and the eligibility are the reward engine's (`grantReward`): a quiz pays
 * `daily_challenge_completed` — **20 XP for a correct answer, nothing for a wrong one**
 * (PLAN.md Q2) — once per competition day. This module decides only **when**:
 *
 *  - **instant results on** (the default): at submission, because the student is already
 *    being told whether they were right;
 *  - **instant results off**: after the reveal, because paying 20 XP the moment a correct
 *    answer lands would tell the student it was correct. Settled lazily on the student's
 *    next visit — no scheduled job — and filed under the day the answer was submitted, so
 *    the once-per-day rule and the leaderboard periods treat it as the day it was earned.
 *
 * It lives apart from `dailyChallengeService` because the reward engine imports that
 * service; the engine is reached from here instead, with no cycle.
 *
 * Settling is a **conditional write** (`xpSettled: false` in the filter) before the
 * grant, so two requests settling the same attempt at once cannot both pay — and the
 * engine's unique index would refuse the second grant anyway.
 */

async function settle(attempt: DailyChallengeAttemptDocument): Promise<number> {
  const claimed = await DailyChallengeAttempt.findOneAndUpdate(
    { _id: attempt._id, xpSettled: false },
    { $set: { xpSettled: true } },
    { new: true },
  );
  if (!claimed) return 0;

  let outcome: Awaited<ReturnType<typeof grantReward>>;
  try {
    outcome = await grantReward({
      student: attempt.student,
      event: 'daily_challenge_completed',
      detail: 'Solved the Daily Quiz',
      context: { isCorrect: attempt.answer.isCorrect === true },
      at: attempt.submittedAt,
    });
  } catch (err) {
    // Hand the claim back, so a later visit can settle it rather than the reward being
    // lost to one failed write. The engine's unique index still guards a double payment.
    await DailyChallengeAttempt.updateOne({ _id: attempt._id }, { $set: { xpSettled: false } });
    throw err;
  }

  if (outcome.xpAwarded > 0) {
    await DailyChallengeAttempt.updateOne({ _id: attempt._id }, { $set: { xpAwarded: outcome.xpAwarded } });
    attempt.xpAwarded = outcome.xpAwarded;
  }
  attempt.xpSettled = true;
  return outcome.xpAwarded;
}

/** Called right after a submission. Pays now when results are instant; otherwise waits. */
export async function rewardSubmission(attempt: DailyChallengeAttemptDocument, instantResult: boolean): Promise<number> {
  if (!instantResult) return 0;
  try {
    return await settle(attempt);
  } catch (err) {
    // A reward must never fail the answer that earned it; the next visit settles it.
    logger.error({ err, attempt: String(attempt._id) }, 'Could not pay for a Daily Quiz answer');
    return 0;
  }
}

/**
 * Pays any of this student's answers that were waiting for their reveal. Cheap when there
 * is nothing to do — one indexed query — so the quiz page and the history call it on
 * every visit. Never throws.
 */
export async function settlePendingQuizRewards(student: Types.ObjectId, at: Date): Promise<void> {
  try {
    const today = dayKeyOf(at);
    const pending = await DailyChallengeAttempt.find({ student, xpSettled: false, day: { $lt: today } });
    for (const attempt of pending) {
      // Revealed by construction (an earlier day), checked anyway: the reveal is the rule.
      if (quizPhaseAt(attempt.day, at) === 'revealed') await settle(attempt);
    }
  } catch (err) {
    logger.error({ err, student: String(student) }, 'Could not settle pending Daily Quiz rewards');
  }
}
