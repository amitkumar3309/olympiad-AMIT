import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { Exam, ExamAttempt, Question, Result, Student, type ExamAttemptDocument } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { ApiError } from '../../lib/ApiError';
import { studentQuestionView } from '../../services/questionView';
import {
  applyExamAnswer,
  finalizeExamAttempt,
  finalizeIfExpired,
  secondsRemaining,
  startExamAttempt,
  studentExamSummary,
} from '../../services/examService';
import {
  examIdParamSchema,
  attemptIdParamSchema,
  examQuestionParamSchema,
  examAnswerSchema,
  type ExamAnswerBody,
} from '../../validation/examSchemas';

/**
 * Sitting the **official Olympiad** (Milestone 13).
 *
 * Gated on `exam:take`, the student-level capability that already existed for mock
 * tests — sitting a paper is the same kind of act whichever paper it is, and inventing
 * a second student permission would mean two things to keep in step.
 *
 * No route here accepts a student id: the account comes from the token's `sub`, and
 * ownership is part of every query. And **no route here reveals a score**. A score
 * exists the moment an attempt is graded, but it is released by
 * `POST /admin/exams/:id/publish-results` and read from `Result` — so a student who
 * submits sees confirmation that their paper is in, and nothing more, until the
 * organisers announce results.
 */
const router = Router();

/** The caller's account, for the class an exam is targeted at. */
async function callerAccount(req: Request) {
  const account = await Student.findById(req.user!.sub).select('classLevel studentId');
  if (!account) throw ApiError.notFound('Your account could not be found.');
  return account;
}

/**
 * The attempt, if it belongs to the caller. Ownership is in the **query**, not checked
 * afterwards, so there is no path that loads somebody else's attempt at all.
 */
async function ownAttempt(req: Request, attemptId: string): Promise<ExamAttemptDocument> {
  const attempt = await ExamAttempt.findOne({ _id: attemptId, student: req.user!.sub });
  if (!attempt) throw ApiError.notFound('No exam attempt of yours with that id.');
  return attempt;
}

/**
 * The paper as the student sees it: question content with **no answer key**.
 *
 * Composes the shared `studentQuestionView`, which is the only answer-stripped
 * projection in the codebase. A hand-written projection here would be one forgotten
 * field away from leaking the key (CLAUDE.md).
 */
async function inProgressView(attempt: ExamAttemptDocument, now = new Date()) {
  const docs = await Question.find({ _id: { $in: attempt.questions.map((entry) => entry.question) } });
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

  return {
    id: String(attempt._id),
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    /** The browser's countdown is a display of this. It is never an input. */
    secondsRemaining: secondsRemaining(attempt, now),
    totalQuestions: attempt.totalQuestions,
    maxMarks: attempt.maxMarks,
    questions: attempt.questions.map((entry, index) => {
      const question = byId.get(String(entry.question));
      return {
        position: index + 1,
        marks: entry.marks,
        negativeMarks: entry.negativeMarks,
        // The student's own response comes back so a reload restores the paper.
        selectedOptionKeys: entry.selectedOptionKeys,
        numericResponse: entry.numericResponse ?? null,
        booleanResponse: entry.booleanResponse ?? null,
        textResponse: entry.textResponse ?? null,
        answered: entry.answeredAt !== null && entry.answeredAt !== undefined,
        question: question ? studentQuestionView(question) : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

router.get('/exams', requirePermission('exam:take'), ensureDb, async (req: Request, res: Response) => {
  try {
    const account = await callerAccount(req);
    if (!account.classLevel) {
      sendSuccess(res, 200, { exams: [], reason: 'no-class' });
      return;
    }

    const exams = await Exam.find({ status: 'published', classLevel: account.classLevel }).sort({ opensAt: 1 });
    const attempts = await ExamAttempt.find({ exam: { $in: exams.map((e) => e._id) }, student: account._id });
    const byExam = new Map(attempts.map((a) => [String(a.exam), a]));

    // Close anything whose clock ran out while the student was away, so the listing
    // cannot show a paper as resumable when it is not.
    for (const attempt of attempts) await finalizeIfExpired(attempt);

    sendSuccess(res, 200, {
      exams: exams.map((exam) => studentExamSummary(exam, byExam.get(String(exam._id)) ?? null)),
    });
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err.statusCode, err.message);
      return;
    }
    logger.error({ err }, 'Failed to list exams for a student');
    sendError(res, 500, 'Could not load your exams right now.');
  }
});

// ---------------------------------------------------------------------------
// Sitting
// ---------------------------------------------------------------------------

router.post(
  '/exams/:id/attempt',
  requirePermission('exam:take'),
  validate({ params: examIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const account = await callerAccount(req);
      const exam = await Exam.findById(req.params.id);
      if (!exam) {
        sendError(res, 404, 'No exam with that id.');
        return;
      }

      const { attempt, created } = await startExamAttempt({
        exam,
        student: account._id as Types.ObjectId,
        studentClassLevel: account.classLevel,
      });

      sendSuccess(res, created ? 201 : 200, { created, attempt: await inProgressView(attempt) });
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err.statusCode, err.message);
        return;
      }
      logger.error({ err }, 'Failed to start an exam attempt');
      sendError(res, 500, 'Could not start that exam. Please try again.');
    }
  },
);

router.get(
  '/exams/attempts/:attemptId',
  requirePermission('exam:take'),
  validate({ params: attemptIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const loaded = await ownAttempt(req, String(req.params.attemptId));
      // Returning to a paper whose time ran out closes it, rather than showing a
      // countdown at zero that accepts nothing.
      const { attempt } = await finalizeIfExpired(loaded);

      if (attempt.status === 'submitted') {
        sendSuccess(res, 200, {
          attempt: {
            id: String(attempt._id),
            status: attempt.status,
            submittedAt: attempt.submittedAt ?? null,
            submissionReason: attempt.submissionReason ?? null,
            totalQuestions: attempt.totalQuestions,
          },
          // Deliberately no score: results are released by the organisers, not by
          // submission. See the file header.
          resultsPending: true,
        });
        return;
      }

      sendSuccess(res, 200, { attempt: await inProgressView(attempt) });
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err.statusCode, err.message);
        return;
      }
      logger.error({ err }, 'Failed to load an exam attempt');
      sendError(res, 500, 'Could not load that attempt. Please try again.');
    }
  },
);

router.patch(
  '/exams/attempts/:attemptId/questions/:questionId',
  requirePermission('exam:take'),
  validate({ params: examQuestionParamSchema, body: examAnswerSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const attempt = await ownAttempt(req, String(req.params.attemptId));
      const questionId = String(req.params.questionId);

      const question = await Question.findById(questionId).select('options');
      const servedOptionKeys = (question?.options ?? []).map((option) => option.key);

      // Throws if the attempt is submitted, or if the deadline has passed — in which
      // case the answer is **not stored**.
      applyExamAnswer(attempt, questionId, req.body as ExamAnswerBody, servedOptionKeys);
      await attempt.save();

      const entry = attempt.questions.find((candidate) => String(candidate.question) === questionId)!;
      sendSuccess(res, 200, {
        saved: true,
        secondsRemaining: secondsRemaining(attempt),
        answer: {
          selectedOptionKeys: entry.selectedOptionKeys,
          numericResponse: entry.numericResponse ?? null,
          booleanResponse: entry.booleanResponse ?? null,
          answered: entry.answeredAt !== null && entry.answeredAt !== undefined,
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err.statusCode, err.message);
        return;
      }
      logger.error({ err }, 'Failed to save an exam answer');
      sendError(res, 500, 'Could not save that answer. Please try again.');
    }
  },
);

router.post(
  '/exams/attempts/:attemptId/submit',
  requirePermission('exam:take'),
  validate({ params: attemptIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const loaded = await ownAttempt(req, String(req.params.attemptId));
      const { attempt } = await finalizeExamAttempt(loaded, 'manual');

      sendSuccess(res, 200, {
        submitted: true,
        attempt: {
          id: String(attempt._id),
          status: attempt.status,
          submittedAt: attempt.submittedAt ?? null,
          submissionReason: attempt.submissionReason ?? null,
          totalQuestions: attempt.totalQuestions,
        },
        /**
         * No score. This is the whole difference between the official exam and a mock
         * test: a mock may show a mark immediately, whereas an official result is an
         * announcement the organisers make once everybody has sat the paper.
         */
        resultsPending: true,
        message: 'Your paper has been submitted. Results will be published by the organisers.',
      });
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err.statusCode, err.message);
        return;
      }
      logger.error({ err }, 'Failed to submit an exam attempt');
      sendError(res, 500, 'Could not submit that paper. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// The student's own results
// ---------------------------------------------------------------------------

/**
 * The caller's published results. Unpublished ones are invisible, however long ago the
 * paper was sat — `isPublished` is in the query rather than filtered afterwards.
 */
router.get('/me/exam-results', requirePermission('exam:take'), ensureDb, async (req: Request, res: Response) => {
  try {
    const results = await Result.find({ student: req.user!.sub, isPublished: true })
      .sort({ publishedAt: -1 })
      .populate<{ exam: { title: string; examCode: string } }>('exam', 'title examCode');

    sendSuccess(res, 200, {
      results: results.map((result) => ({
        id: String(result._id),
        examTitle: result.exam?.title ?? '',
        examCode: result.exam?.examCode ?? '',
        score: result.score,
        maxMarks: result.maxMarks,
        percentage: result.percentage,
        accuracy: result.accuracy,
        rank: result.rank,
        totalCandidates: result.totalCandidates,
        percentile: result.percentile,
        publishedAt: result.publishedAt ?? null,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load exam results');
    sendError(res, 500, 'Could not load your results right now.');
  }
});

export default router;
