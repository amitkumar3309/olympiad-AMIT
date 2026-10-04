import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { dailyQuizLimiter } from '../../middleware/rateLimiter';
import { Student, type StudentDocument } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { now } from '../../lib/clock';
import { dayKeyOf } from '../../lib/competitionDay';
import { isClassLevel } from '../../lib/classLevels';
import { respondToServiceError } from '../../lib/serviceError';
import { resolveXpFor } from '../../services/rewardService';
import {
  getQuizSettings,
  listQuizHistory,
  publicQuizInfo,
  publicRecentWinners,
  quizSummary,
  resolveQuizFor,
  startQuiz,
  submitQuiz,
  todayPayload,
} from '../../services/dailyChallengeService';
import { rewardSubmission, settlePendingQuizRewards } from '../../services/dailyQuizRewards';
import {
  publicWinnersQuerySchema,
  quizHistoryQuerySchema,
  submitQuizSchema,
  type PublicWinnersQuery,
  type QuizHistoryQuery,
  type SubmitQuizBody,
} from '../../validation/dailyChallengeSchemas';

/**
 * The Daily Quiz, from the student's side (Milestone 30, Phase 2) — the daily challenge's
 * routes, upgraded. The old `/me/daily-challenge` paths are gone: their answer view
 * revealed the correct answer and the solution at once, which a prize quiz cannot do.
 *
 *  - `GET  /me/daily-quiz`         today's quiz and this student's state in it
 *  - `POST /me/daily-quiz/start`   show the question and start the server's clock
 *  - `POST /me/daily-quiz/submit`  answer it, once
 *  - `GET  /me/daily-quiz/history` every quiz day, with solutions once unlocked
 *  - `GET  /daily-quiz/info`       public: the prize and how winners are chosen
 *  - `GET  /daily-quiz/winners`    public: recent published winners
 *
 * ## What is not negotiable from the client
 *
 * **The day and every instant** — `lib/clock.ts → now()`, read once per request so one
 * response can never mix two days. **The outcome** — marked server-side against the
 * quiz's own snapshot. **The answer key** — never in any response before the reveal;
 * `revealOf()` in the service is the only reader, and a test stringifies every response
 * on both sides of midnight.
 *
 * Gated with `requireAuth()` like the rest of `/me`: the requirement is an identity ("my
 * own quiz"), the account always comes from the token, and no route accepts a student id.
 * Every personal response is `Cache-Control: private, no-store`.
 */
const router = Router();

/** Personal responses must never be stored by a browser, a proxy or a CDN. */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'private, no-store');
  next();
}

async function loadSelf(req: Request, res: Response): Promise<StudentDocument | null> {
  const sub = req.user?.sub;
  if (!sub) {
    sendError(res, 404, 'The root administrator has no Daily Quiz. Sign in with a student account.');
    return null;
  }
  const student = await Student.findById(sub);
  if (!student) {
    sendError(res, 404, 'Your account could not be found.');
    return null;
  }
  return student;
}

const idOf = (student: StudentDocument): Types.ObjectId => student._id as Types.ObjectId;

async function payloadFor(student: StudentDocument, at: Date) {
  const [settings, xpForCorrect] = await Promise.all([getQuizSettings(), resolveXpFor('daily_challenge_completed')]);
  return { settings, payload: await todayPayload({ student, settings, xpForCorrect, at }) };
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

router.get('/me/daily-quiz', requireAuth(), noStore, ensureDb, async (req: Request, res: Response) => {
  try {
    const at = now();
    const student = await loadSelf(req, res);
    if (!student) return;

    await settlePendingQuizRewards(idOf(student), at);
    const { payload } = await payloadFor(student, at);
    sendSuccess(res, 200, payload);
  } catch (err) {
    logger.error({ err }, 'Failed to load the Daily Quiz');
    sendError(res, 500, 'Could not load today’s quiz. Please try again.');
  }
});

/**
 * Presses Start: the question appears, and the server's clock starts.
 *
 * Idempotent — a second press returns the same start, so the clock never restarts. A
 * student who has already submitted today gets their submitted state back rather than an
 * error. Responds with the whole of today's state, so the page has one shape to render.
 */
router.post(
  '/me/daily-quiz/start',
  requireAuth(),
  noStore,
  dailyQuizLimiter,
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const at = now();
      const student = await loadSelf(req, res);
      if (!student) return;

      if (!isClassLevel(student.classLevel)) {
        sendError(res, 409, 'Add your class to your profile to play the Daily Quiz.');
        return;
      }

      const challenge = await resolveQuizFor(student.classLevel, dayKeyOf(at));
      if (!challenge) {
        sendError(res, 409, 'There is no Daily Quiz for your class today.');
        return;
      }

      const { created } = await startQuiz({
        challenge,
        student: idOf(student),
        ip: req.ip,
        userAgent: req.get('user-agent') ?? null,
        at,
      });

      const { payload } = await payloadFor(student, at);
      sendSuccess(res, created ? 201 : 200, { ...payload, alreadyStarted: !created });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to start the Daily Quiz',
        fallback: 'Could not start the quiz. Please try again.',
      });
    }
  },
);

/**
 * Answers today's quiz, once.
 *
 * The second submission is a **200 with `alreadySubmitted: true`**, not an error: the
 * student has answered, and an error would invite another try. Nothing is re-marked and
 * nothing re-paid. `xpAwarded` is what **this request** earned — 0 for a repeat, and 0 for
 * now when results are held until the reveal.
 */
router.post(
  '/me/daily-quiz/submit',
  requireAuth(),
  noStore,
  dailyQuizLimiter,
  validate({ body: submitQuizSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const at = now();
      const student = await loadSelf(req, res);
      if (!student) return;

      const { selectedOptionId } = req.body as SubmitQuizBody;
      const { attempt, created } = await submitQuiz({
        student: idOf(student),
        selectedOptionId,
        ip: req.ip,
        userAgent: req.get('user-agent') ?? null,
        at,
      });

      const settings = await getQuizSettings();
      const xpAwarded = created ? await rewardSubmission(attempt, settings.instantResult) : 0;

      const { payload } = await payloadFor(student, at);
      sendSuccess(res, 200, { ...payload, alreadySubmitted: !created, xpAwarded });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to submit a Daily Quiz answer',
        fallback: 'Could not submit your answer. Please try again — it has not been counted yet.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

router.get(
  '/me/daily-quiz/history',
  requireAuth(),
  noStore,
  validate({ query: quizHistoryQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const at = now();
      const student = await loadSelf(req, res);
      if (!student) return;

      await settlePendingQuizRewards(idOf(student), at);
      const { page, limit } = req.query as unknown as QuizHistoryQuery;
      const settings = await getQuizSettings();
      const [{ rows, total }, summary] = await Promise.all([
        listQuizHistory(idOf(student), { page, limit }, settings, at),
        quizSummary(idOf(student), settings, at),
      ]);

      sendSuccess(res, 200, {
        serverNow: at.toISOString(),
        attempts: rows,
        summary,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to load the Daily Quiz history');
      sendError(res, 500, 'Could not load your quiz history. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * The prize and the rule, for the Rewards section, the Login Gate and the rules page —
 * the sentence about how winners are chosen is generated from the settings the
 * computation itself reads, so the two cannot disagree.
 */
router.get('/daily-quiz/info', ensureDb, async (_req: Request, res: Response) => {
  try {
    const [settings, xpForCorrect] = await Promise.all([getQuizSettings(), resolveXpFor('daily_challenge_completed')]);
    res.set('Cache-Control', 'public, max-age=60');
    sendSuccess(res, 200, { info: publicQuizInfo(settings, xpForCorrect) });
  } catch (err) {
    logger.error({ err }, 'Failed to load the Daily Quiz info');
    sendError(res, 500, 'Could not load the quiz details. Please try again.');
  }
});

/** Recently published winners — masked names, class, city or school; nothing else. */
router.get(
  '/daily-quiz/winners',
  validate({ query: publicWinnersQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { limit } = req.query as unknown as PublicWinnersQuery;
      res.set('Cache-Control', 'public, max-age=60');
      sendSuccess(res, 200, { winners: await publicRecentWinners(limit) });
    } catch (err) {
      logger.error({ err }, 'Failed to load the Daily Quiz winners');
      sendError(res, 500, 'Could not load the winners. Please try again.');
    }
  },
);

export default router;
