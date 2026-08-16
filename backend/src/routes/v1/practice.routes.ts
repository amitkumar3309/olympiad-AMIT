import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { practiceLimiter } from '../../middleware/rateLimiter';
import { requireEntry } from '../../middleware/requireEntry';
import { PracticeSession, Student, type StudentDocument } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { isClassLevel } from '../../lib/classLevels';
import { respondToServiceError } from '../../lib/serviceError';
import { grantReward } from '../../services/rewardService';
import {
  applyAnswer,
  findOwnSession,
  getPracticeAvailability,
  gradeSession,
  loadSessionQuestions,
  sessionHistoryView,
  sessionInProgressView,
  sessionReviewView,
  startPracticeSession,
} from '../../services/practiceService';
import {
  listPracticeQuerySchema,
  practiceSessionParamSchema,
  saveAnswerSchema,
  startPracticeSchema,
  type ListPracticeQuery,
  type SaveAnswerInput,
  type StartPracticeInputBody,
} from '../../validation/practiceSchemas';

/**
 * The Practice Zone (Milestone 6).
 *
 * A student chooses a subject, a topic and optionally a difficulty, is served real
 * published questions for their own class, answers and navigates them, submits, and
 * gets a marked review with explanations. Everything is persisted: the session, the
 * questions served, each answer, its correctness, the score, the time taken and the
 * completion status.
 *
 * ## Two rules this file exists to hold
 *
 * **1. The answer key never leaves the server before submission.** Every in-progress
 * response is built by `sessionInProgressView`, which composes the same
 * answer-stripped projection the question endpoints use. The reveal lives in exactly
 * one function, `sessionReviewView`, which refuses to run on an unsubmitted session.
 * Grading is server-side, so the browser is never given anything to mark itself with.
 *
 * **2. A session is addressable only by its owner.** Every handler loads through
 * `findOwnSession`, which puts `student` in the query rather than checking it
 * afterwards. Another student's session is therefore indistinguishable from one that
 * does not exist, so a session id cannot be used to probe for other people's work.
 *
 * Like the rest of `/me`, these routes gate on `requireAuth()` rather than a
 * permission: the requirement is an identity ("my own session"), not a capability, and
 * the caller's account is always resolved from the token's `sub`. No route here
 * accepts a student id.
 */
const router = Router();

/**
 * The caller's own account. The environment-configured root administrator has no
 * `Student` document, so it has no class to draw a paper for and no practice history —
 * answered as a clear 404 rather than a null dereference, exactly as `me.routes.ts`
 * does.
 */
async function loadSelf(req: Request, res: Response): Promise<StudentDocument | null> {
  const sub = req.user?.sub;
  if (!sub) {
    sendError(res, 404, 'The root administrator cannot practise. Sign in with a student account.');
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

// ---------------------------------------------------------------------------
// What can be practised
// ---------------------------------------------------------------------------

/**
 * Real availability for the caller's class, grouped subject → topic with per-topic
 * question counts and the difficulties that actually exist.
 *
 * Every number here is a count of real published questions, so a bank with nothing for
 * this class returns an empty list and the page says so — the picker never offers a
 * combination that would then fail to start.
 */
router.get('/practice/options', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const student = await loadSelf(req, res);
    if (!student) return;

    if (!isClassLevel(student.classLevel)) {
      // An account from before the class field existed. Honest empty rather than a crash.
      sendSuccess(res, 200, { classLevel: null, subjects: [], reason: 'no-class' });
      return;
    }

    sendSuccess(res, 200, {
      classLevel: student.classLevel,
      subjects: await getPracticeAvailability(student.classLevel),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load practice options');
    sendError(res, 500, 'Could not load what is available to practise. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// Starting, resuming and answering
// ---------------------------------------------------------------------------

router.post(
  '/practice/sessions',
  requireAuth(),
  practiceLimiter,
  validate({ body: startPracticeSchema }),
  ensureDb,
  // Paid students only. Deliberately on *starting* a session rather than on reading
  // one: a session already in progress when the fee arrived is finishable, and the
  // options endpoint above stays open so an unpaid student can see what practice offers.
  requireEntry,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      if (!isClassLevel(student.classLevel)) {
        sendError(res, 409, 'Add your class to your profile before starting practice.');
        return;
      }

      const { subjectId, topicId, difficulty, questionCount } = req.body as StartPracticeInputBody;

      const session = await startPracticeSession({
        student: studentId(student),
        classLevel: student.classLevel,
        subjectId,
        topicId,
        difficulty,
        questionCount,
      });

      const questions = await loadSessionQuestions(session);
      sendSuccess(res, 201, { session: sessionInProgressView(session, questions) });
    } catch (err) {
      // A "nothing matches that selection" 409 from the service is an expected refusal
      // and is passed through with its own message; anything else is a bug and becomes
      // a logged 500.
      respondToServiceError(res, err, {
        log: 'Failed to start a practice session',
        fallback: 'Could not start practice. Please try again.',
      });
    }
  },
);

/**
 * Reads one session. Answer-stripped while in progress, fully marked once submitted,
 * so a student can resume an unfinished session or come back to a review later from
 * the same URL.
 */
router.get(
  '/practice/sessions/:sessionId',
  requireAuth(),
  validate({ params: practiceSessionParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { sessionId } = req.params as unknown as { sessionId: string };
      const session = await findOwnSession(sessionId, studentId(student));
      if (!session) {
        sendError(res, 404, 'No practice session found.');
        return;
      }

      const questions = await loadSessionQuestions(session);
      sendSuccess(res, 200, {
        session:
          session.status === 'submitted'
            ? sessionReviewView(session, questions)
            : sessionInProgressView(session, questions),
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to load a practice session',
        fallback: 'Could not load that practice session. Please try again.',
      });
    }
  },
);

/**
 * Saves a single answer.
 *
 * Per-answer rather than one bulk submit, so nothing is lost if a browser is closed
 * mid-session — the persistence requirement is that a student's answers survive, not
 * just their final submission. The response deliberately carries no outcome: telling
 * the client whether the answer was right would reveal the key before submission.
 */
router.put(
  '/practice/sessions/:sessionId/answers',
  requireAuth(),
  validate({ params: practiceSessionParamSchema, body: saveAnswerSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { sessionId } = req.params as unknown as { sessionId: string };
      const session = await findOwnSession(sessionId, studentId(student));
      if (!session) {
        sendError(res, 404, 'No practice session found.');
        return;
      }

      const body = req.body as SaveAnswerInput;
      const questions = await loadSessionQuestions(session);
      const served = questions.get(body.questionId);

      applyAnswer(
        session,
        body.questionId,
        {
          selectedOptionKeys: body.selectedOptionKeys,
          numericResponse: body.numericResponse,
          booleanResponse: body.booleanResponse,
        },
        // The option keys as actually served, so an invented key is refused.
        served ? served.options.map((option) => option.key) : [],
      );
      await session.save();

      const answered = session.questions.filter((entry) => entry.answeredAt !== null).length;
      sendSuccess(res, 200, { saved: true, answeredCount: answered, totalQuestions: session.totalQuestions });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to save a practice answer',
        fallback: 'Could not save that answer. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

/**
 * Grades the session and returns the full review in the same response.
 *
 * Grading is entirely server-side against the snapshot taken when the questions were
 * served. Submission is also the moment XP is earned — `practice_completed`, **once
 * per competition day** rather than once per session, so the reward cannot be farmed
 * by submitting empty sessions in a loop. A session with nothing answered earns
 * nothing at all.
 */
router.post(
  '/practice/sessions/:sessionId/submit',
  requireAuth(),
  practiceLimiter,
  validate({ params: practiceSessionParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { sessionId } = req.params as unknown as { sessionId: string };
      const session = await findOwnSession(sessionId, studentId(student));
      if (!session) {
        sendError(res, 404, 'No practice session found.');
        return;
      }

      gradeSession(session);
      await session.save();

      // The route says what happened; the engine decides whether that is worth
      // anything and how much. "Only a session with real work in it earns" used to be
      // an `if` here — it is now the `answeredCount` rule in `rewardService`, so a
      // future surface cannot forget it or state it differently.
      const { xpAwarded } = await grantReward({
        student: studentId(student),
        event: 'practice_completed',
        detail: `${session.correctCount}/${session.totalQuestions} correct`,
        context: { answeredCount: session.correctCount + session.incorrectCount },
      });

      const questions = await loadSessionQuestions(session);
      sendSuccess(res, 200, { session: sessionReviewView(session, questions), xpAwarded });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to submit a practice session',
        fallback: 'Could not submit your practice session. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * The student's own past sessions, newest first. Carries scores and accuracy but no
 * per-question detail and no answers — the review endpoint is the only way to those.
 */
router.get(
  '/practice/sessions',
  requireAuth(),
  validate({ query: listPracticeQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { page, limit } = req.query as unknown as ListPracticeQuery;
      const filter = { student: studentId(student) };

      const [sessions, total] = await Promise.all([
        PracticeSession.find(filter)
          .sort({ startedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        PracticeSession.countDocuments(filter),
      ]);

      sendSuccess(res, 200, {
        sessions: sessions.map(sessionHistoryView),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list practice sessions');
      sendError(res, 500, 'Could not load your practice history. Please try again.');
    }
  },
);

export default router;
