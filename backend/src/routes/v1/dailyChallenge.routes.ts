import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { challengeLimiter } from '../../middleware/rateLimiter';
import { Student, type StudentDocument } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { isClassLevel } from '../../lib/classLevels';
import { todayKey } from '../../lib/competitionDay';
import { xpFor } from '../../lib/xp';
import { respondToServiceError } from '../../lib/serviceError';
import { recordActivity } from '../../services/activityService';
import {
  attemptHistoryView,
  attemptResultView,
  challengeQuestionView,
  findOwnAttempt,
  getChallengeFacts,
  listOwnAttempts,
  loadChallengeQuestion,
  loadQuestionsByIds,
  resolveChallengeFor,
  submitChallengeAnswer,
} from '../../services/dailyChallengeService';
import {
  answerChallengeSchema,
  listChallengeHistoryQuerySchema,
  type AnswerChallengeBody,
  type ListChallengeHistoryQuery,
} from '../../validation/dailyChallengeSchemas';

/**
 * The daily challenge, from the student's side (Milestone 8).
 *
 * One question a day for the student's own class: view it, answer it, get the result
 * and the explanation immediately, and earn the day's XP once.
 *
 * ## What is not negotiable from the client
 *
 * **The day.** No route here accepts one. Which day it is comes from
 * `lib/competitionDay.ts` (an IST calendar day), so a student cannot claim yesterday's
 * reward by naming yesterday, and a browser in another timezone cannot disagree about
 * which challenge is today's.
 *
 * **The reward.** The XP is looked up from the award table by `recordActivity()`, which
 * is the only thing in this backend allowed to write a `StudentActivity` row and caps
 * `daily_challenge_completed` at once per competition day. Combined with the unique
 * index on `{student, day}`, claiming twice takes two independent guarantees failing.
 *
 * **The outcome.** Grading is server-side against the snapshot the attempt stores.
 * Nothing in a request body describes correctness, and the unanswered view carries no
 * answer key to compare against.
 *
 * Gated with `requireAuth()` rather than a permission, like the rest of `/me`: the
 * requirement is an identity ("my own challenge"), the account always comes from the
 * token's `sub`, and no route here accepts a student id.
 */
const router = Router();

/** The caller's own account. The root admin has no student record, so no class. */
async function loadSelf(req: Request, res: Response): Promise<StudentDocument | null> {
  const sub = req.user?.sub;
  if (!sub) {
    sendError(res, 404, 'The root administrator has no daily challenge. Sign in with a student account.');
    return null;
  }
  const student = await Student.findById(sub);
  if (!student) {
    sendError(res, 404, 'Your account could not be found.');
    return null;
  }
  return student;
}

function studentId(student: StudentDocument): Types.ObjectId {
  return student._id as Types.ObjectId;
}

/** What answering today is worth, so the page can say so before it is claimed. */
function rewardXp(): number {
  return xpFor('daily_challenge_completed');
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

/**
 * Today's challenge for the caller's class, and their own attempt at it.
 *
 * One endpoint for both states, decided by the server:
 *  - **not answered yet** → the answer-stripped question, and no reveal anywhere in the
 *    payload;
 *  - **answered** → the question plus the result: what they chose, whether it was
 *    right, the correct answer and the author's explanation.
 *
 * The reveal is safe here in a way it would not be for a mock test, and for a stated
 * reason: an attempt document only exists once the student has answered, so there is no
 * path that reveals anything to someone who has not. A daily challenge has no
 * disclosure policy on purpose — its entire point is to teach one question a day, and
 * withholding the explanation until some later window would defeat that.
 *
 * Both `/me/daily-challenge` and the older bare `/daily-challenge` are served, because
 * the second is the path already published in API_DOCUMENTATION.md.
 */
router.get(
  ['/me/daily-challenge', '/daily-challenge'],
  requireAuth(),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const today = todayKey();

      if (!isClassLevel(student.classLevel)) {
        sendSuccess(res, 200, { challenge: null, attempt: null, reason: 'no-class', today });
        return;
      }

      const challenge = await resolveChallengeFor(student.classLevel, today);
      if (!challenge) {
        // Not a 404: "there is no challenge today" is a normal answer while the bank
        // has nothing published for this class.
        sendSuccess(res, 200, { challenge: null, attempt: null, reason: 'none-published', today });
        return;
      }

      const question = await loadChallengeQuestion(challenge);
      if (!question) {
        // The pinned question has been hard-deleted. Only ever possible for a
        // never-published question, which could not have been pinned — so this is a
        // belt-and-braces path, reported honestly rather than as a crash.
        logger.error(
          { challengeId: String(challenge._id), questionId: String(challenge.question) },
          'Daily challenge points at a missing question',
        );
        sendSuccess(res, 200, { challenge: null, attempt: null, reason: 'none-published', today });
        return;
      }

      const attempt = await findOwnAttempt(studentId(student), today);
      const facts = await getChallengeFacts(studentId(student), today);

      sendSuccess(res, 200, {
        challenge: challengeQuestionView(challenge, question),
        attempt: attempt ? attemptResultView(attempt, question) : null,
        streak: { current: facts.currentChallengeStreak, longest: facts.longestChallengeStreak },
        completedCount: facts.challengesCompleted,
        reward: { xp: rewardXp(), claimed: attempt !== null },
        today,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to load the daily challenge');
      sendError(res, 500, 'Could not load today’s challenge. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/**
 * Answers today's challenge.
 *
 * Idempotent by design rather than by accident: the second submission of the day
 * returns the stored attempt with `alreadyAnswered: true` and `xpAwarded: 0`. That is a
 * **200, not a 409** — from the student's point of view they have answered today, and
 * an error would invite them to try again — but nothing is re-graded and nothing is
 * re-paid.
 *
 * The order of writes matters and is deliberate: the attempt is created first, so the
 * unique index has already decided whether this is today's one submission before any
 * reward is considered. `recordActivity()` then says what was actually awarded, and
 * only that figure is written back onto the attempt — so a failed award leaves an
 * honest `xpAwarded: 0` rather than a claim the student was never paid.
 */
router.post(
  '/me/daily-challenge/answer',
  requireAuth(),
  challengeLimiter,
  validate({ body: answerChallengeSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      if (!isClassLevel(student.classLevel)) {
        sendError(res, 409, 'Add your class to your profile before answering the daily challenge.');
        return;
      }

      const today = todayKey();
      const challenge = await resolveChallengeFor(student.classLevel, today);
      if (!challenge) {
        sendError(res, 409, 'There is no challenge for your class today.');
        return;
      }

      const question = await loadChallengeQuestion(challenge);
      if (!question) {
        sendError(res, 409, 'Today’s challenge is unavailable. Please tell your administrator.');
        return;
      }

      const body = req.body as AnswerChallengeBody;
      const { attempt, created } = await submitChallengeAnswer({
        challenge,
        question,
        student: studentId(student),
        answer: {
          selectedOptionKeys: body.selectedOptionKeys,
          numericResponse: body.numericResponse,
          booleanResponse: body.booleanResponse,
        },
      });

      // The reward, and the only place this milestone touches XP. `recordActivity` owns
      // both what the event is worth and the once-per-day rule; this route neither
      // knows nor decides either.
      if (created) {
        const outcome = await recordActivity({
          student: studentId(student),
          type: 'daily_challenge_completed',
          detail: attempt.answer.isCorrect ? 'Correct' : 'Answered',
        });
        if (outcome.xpAwarded > 0) {
          attempt.xpAwarded = outcome.xpAwarded;
          await attempt.save();
        }
      }

      const facts = await getChallengeFacts(studentId(student), today);

      sendSuccess(res, 200, {
        attempt: attemptResultView(attempt, question),
        alreadyAnswered: !created,
        /**
         * What **this request** awarded, which is 0 for a repeat submission — not the
         * attempt's stored total, which would still read 15 and let a client show
         * "+15 XP" every time the button was pressed. The ledger was never at risk;
         * the *claim on screen* was, and that is the half a student would notice.
         * The attempt's own figure stays inside `attempt` for the record.
         */
        xpAwarded: created ? attempt.xpAwarded : 0,
        streak: { current: facts.currentChallengeStreak, longest: facts.longestChallengeStreak },
        completedCount: facts.challengesCompleted,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to answer the daily challenge',
        fallback: 'Could not submit your answer. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * The caller's own past challenges, newest day first, with the streak derived from
 * them. Carries the question text and whether they were right — everything in it is
 * about attempts they have already made, so there is nothing left to withhold.
 */
router.get(
  '/me/daily-challenge/history',
  requireAuth(),
  validate({ query: listChallengeHistoryQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { page, limit } = req.query as unknown as ListChallengeHistoryQuery;
      const today = todayKey();
      const [{ attempts, total }, facts] = await Promise.all([
        listOwnAttempts(studentId(student), { page, limit }),
        getChallengeFacts(studentId(student), today),
      ]);

      // Looked up by the ids the **attempts** snapshotted, not by what their challenges
      // point at now: a future day's challenge can be re-pointed, and a history row has
      // to describe the question the student actually answered.
      const questions = await loadQuestionsByIds(attempts.map((attempt) => attempt.answer.question));

      sendSuccess(res, 200, {
        attempts: attempts.map((attempt) =>
          attemptHistoryView(attempt, questions.get(String(attempt.answer.question)) ?? null),
        ),
        streak: { current: facts.currentChallengeStreak, longest: facts.longestChallengeStreak },
        completedCount: facts.challengesCompleted,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to load the daily challenge history');
      sendError(res, 500, 'Could not load your challenge history. Please try again.');
    }
  },
);

export default router;
