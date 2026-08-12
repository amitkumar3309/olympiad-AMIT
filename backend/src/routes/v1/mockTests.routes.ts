import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { mockTestLimiter } from '../../middleware/rateLimiter';
import { MockTest, MockTestAttempt, Student, STUDENT_VISIBLE_TEST_STATUSES, type MockTestDocument, type StudentDocument } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { isClassLevel } from '../../lib/classLevels';
import { respondToServiceError } from '../../lib/serviceError';
import { recordActivity } from '../../services/activityService';
import {
  applyAttemptAnswer,
  attemptHistoryView,
  attemptInProgressView,
  attemptResultView,
  attemptReviewView,
  disclosureFor,
  finalizeAttempt,
  finalizeIfExpired,
  findMockTestById,
  findOwnAttempt,
  loadAttemptQuestions,
  startAttempt,
  studentTestDetailView,
  studentTestSummaryView,
} from '../../services/mockTestService';
import {
  attemptIdParamSchema,
  listAttemptsQuerySchema,
  mockTestIdParamSchema,
  saveAttemptAnswerSchema,
  type ListAttemptsQuery,
  type SaveAttemptAnswerInput,
} from '../../validation/mockTestSchemas';

/**
 * Sitting a mock test (Milestone 7).
 *
 * ## The three rules this file holds
 *
 * **1. The clock is the server's.** Every route that touches an open attempt begins by
 * asking whether its deadline has passed, and finalises it if so. An answer that
 * arrives late is refused and not stored; a submission that arrives late is graded as
 * at the deadline. The client is *told* `secondsRemaining` so it can show a countdown
 * and submit when it reaches zero — a courtesy, not an authority. Nothing here reads a
 * time from a request body, because there is no time in any request body.
 *
 * **2. An attempt is graded once.** `finalizeAttempt` closes it with a write
 * conditional on it still being open and reports whether that write won, so a
 * duplicate submission — a double-clicked button, a retry, the countdown firing at the
 * same moment as the button — returns the existing result and cannot award XP twice or
 * re-mark anything.
 *
 * **3. An attempt is addressable only by its owner.** Every handler loads through
 * `findOwnAttempt`, which puts `student` in the query rather than checking it
 * afterwards, so another student's attempt is indistinguishable from one that does not
 * exist and an id cannot be used to probe for other people's papers.
 *
 * The gate is `requirePermission('exam:take')` — the capability that already exists for
 * "sit an exam / attempt questions". It is a student-level permission, so it stays
 * stateless and costs no database read, and no route here accepts a student id: the
 * account always comes from the token's `sub`.
 */
const router = Router();

/**
 * The caller's own account. The environment-configured root administrator has no
 * `Student` document, so it has no class to be offered tests for — answered as a clear
 * 404 rather than a null dereference, exactly as `practice.routes.ts` does.
 */
async function loadSelf(req: Request, res: Response): Promise<StudentDocument | null> {
  const sub = req.user?.sub;
  if (!sub) {
    sendError(res, 404, 'The root administrator cannot sit a mock test. Sign in with a student account.');
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

/** The test an attempt belongs to. Needed for its title and its disclosure settings. */
async function testFor(testId: Types.ObjectId): Promise<MockTestDocument | null> {
  return MockTest.findById(testId);
}

// ---------------------------------------------------------------------------
// Browsing what is on offer
// ---------------------------------------------------------------------------

/**
 * The published tests for the caller's own class, with their own attempt state on each.
 *
 * A test that has not opened yet is listed — with its opening time and no questions —
 * because "there is a test on Saturday" is exactly what a student needs to know. What
 * they cannot get is the paper: no route serves a question until an attempt exists, and
 * an attempt cannot be created outside the window.
 *
 * Archived and draft tests are absent entirely; `STUDENT_VISIBLE_TEST_STATUSES` is the
 * one place that list is written down.
 */
router.get('/mock-tests', requirePermission('exam:take'), ensureDb, async (req: Request, res: Response) => {
  try {
    const student = await loadSelf(req, res);
    if (!student) return;

    if (!isClassLevel(student.classLevel)) {
      // An account from before the class field existed. Honest empty rather than a crash.
      sendSuccess(res, 200, { classLevel: null, tests: [], reason: 'no-class' });
      return;
    }

    const tests = await MockTest.find({
      classLevel: student.classLevel,
      status: { $in: [...STUDENT_VISIBLE_TEST_STATUSES] },
    }).sort({ availableFrom: 1, createdAt: -1 });

    const found = await MockTestAttempt.find({
      student: studentId(student),
      test: { $in: tests.map((test) => test._id) },
    }).sort({ startedAt: -1 });

    // Any attempt of the caller's whose time has quietly run out is finalised here, so
    // the listing cannot offer to "resume" a paper that expired days ago.
    //
    // The *returned* document is what gets rendered, not the one passed in: grading is
    // a conditional `findOneAndUpdate`, so the copy in hand still reads `in_progress`
    // afterwards. Rendering that would show a paper as unfinished in the very response
    // that finished it, and correct itself only on the next reload.
    const fresh = await Promise.all(found.map(async (attempt) => (await finalizeIfExpired(attempt)).attempt));

    const byTest = new Map<string, typeof fresh>();
    for (const attempt of fresh) {
      const key = String(attempt.test);
      byTest.set(key, [...(byTest.get(key) ?? []), attempt]);
    }

    sendSuccess(res, 200, {
      classLevel: student.classLevel,
      tests: tests.map((test) => studentTestSummaryView(test, byTest.get(String(test._id)) ?? [])),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list mock tests for a student');
    sendError(res, 500, 'Could not load the mock tests. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// Attempt routes
//
// These are declared **before** `/mock-tests/:id`, because Express matches in
// declaration order and `/mock-tests/attempts` would otherwise be read as a test id.
// The id parameter is validated as an ObjectId, so the mistake would surface as a
// confusing 400 rather than as a wrong route — but ordering it correctly is what makes
// it impossible rather than merely detectable.
// ---------------------------------------------------------------------------

/** The caller's own attempts across every test, newest first. */
router.get(
  '/mock-tests/attempts',
  requirePermission('exam:take'),
  validate({ query: listAttemptsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { page, limit } = req.query as unknown as ListAttemptsQuery;
      const filter = { student: studentId(student) };

      const [found, total] = await Promise.all([
        MockTestAttempt.find(filter)
          .sort({ startedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        MockTestAttempt.countDocuments(filter),
      ]);

      // Finalise anything expired before reporting it, so a history row cannot say
      // "in progress" for a paper whose clock stopped last week — and render the
      // document the grading returned, not the stale one it was given.
      const attempts = await Promise.all(found.map(async (attempt) => (await finalizeIfExpired(attempt)).attempt));

      const tests = await MockTest.find({ _id: { $in: attempts.map((attempt) => attempt.test) } });
      const testById = new Map(tests.map((test) => [String(test._id), test]));

      sendSuccess(res, 200, {
        attempts: attempts.map((attempt) => attemptHistoryView(attempt, testById.get(String(attempt.test)) ?? null)),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list mock test attempts');
      sendError(res, 500, 'Could not load your test history. Please try again.');
    }
  },
);

/**
 * Reads one attempt.
 *
 * Serves whichever of the three views the attempt and the test's settings permit, so a
 * single URL works for resuming a paper, for looking at a score, and for reading a
 * review once answers are released:
 *
 *  - still open → the answer-stripped paper plus the remaining time;
 *  - submitted, review released → the marked paper with answers and explanations;
 *  - submitted, results released but not answers → the score and summary only;
 *  - submitted, nothing released → the fact that it was submitted, and why not.
 *
 * An open attempt whose deadline has passed is finalised on the way in, which is what
 * makes automatic submission work for the student who closes their laptop and comes
 * back: they arrive at their marked paper, graded as at the moment their time ran out.
 */
router.get(
  '/mock-tests/attempts/:attemptId',
  requirePermission('exam:take'),
  validate({ params: attemptIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { attemptId } = req.params as unknown as { attemptId: string };
      const found = await findOwnAttempt(attemptId, studentId(student));
      if (!found) {
        sendError(res, 404, 'No attempt found.');
        return;
      }

      const { attempt } = await finalizeIfExpired(found);
      const test = await testFor(attempt.test);
      if (!test) {
        // The test was hard-deleted, which the service only permits for one that has
        // never been sat — so this should be unreachable.
        logger.error({ attemptId, testId: String(attempt.test) }, 'Attempt references a missing mock test');
        sendError(res, 404, 'The test for this attempt no longer exists.');
        return;
      }

      if (attempt.status === 'in_progress') {
        const questions = await loadAttemptQuestions(attempt);
        sendSuccess(res, 200, { attempt: attemptInProgressView(attempt, questions, test) });
        return;
      }

      const disclosure = disclosureFor(test, attempt);

      if (disclosure.showReview) {
        const questions = await loadAttemptQuestions(attempt);
        sendSuccess(res, 200, {
          attempt: attemptReviewView(attempt, questions, test),
          disclosure,
        });
        return;
      }

      if (disclosure.showResult) {
        sendSuccess(res, 200, { attempt: attemptResultView(attempt, test), disclosure });
        return;
      }

      // Submitted, but the test releases neither the score nor the answers yet. The
      // student is told that plainly — and told nothing else.
      sendSuccess(res, 200, {
        attempt: {
          id: String(attempt._id),
          testId: String(attempt.test),
          testTitle: test.title,
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          totalQuestions: attempt.totalQuestions,
          maxMarks: attempt.maxMarks,
          startedAt: attempt.startedAt,
          submittedAt: attempt.submittedAt ?? null,
          autoSubmitted: attempt.submissionReason === 'time_expired',
        },
        disclosure,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to load a mock test attempt',
        fallback: 'Could not load that attempt. Please try again.',
      });
    }
  },
);

/**
 * Saves a single answer.
 *
 * Per-answer rather than one bulk submit at the end, so a closed browser, a flat
 * battery or a lost connection costs at most the answer being typed — "answer
 * persistence" has to mean the answers survive, not just the final submission.
 *
 * The response carries no correctness, deliberately: telling the client whether an
 * answer was right would hand over the key one question at a time. It reports the
 * remaining time instead, which is also how a client that has drifted resynchronises
 * with the server's clock.
 *
 * A save arriving after the deadline is refused with 409 and `expired: true`, and the
 * attempt is finalised in the same request — so the answer is not stored, and the
 * client learns that the paper is now marked.
 */
router.put(
  '/mock-tests/attempts/:attemptId/answers',
  requirePermission('exam:take'),
  validate({ params: attemptIdParamSchema, body: saveAttemptAnswerSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { attemptId } = req.params as unknown as { attemptId: string };
      const found = await findOwnAttempt(attemptId, studentId(student));
      if (!found) {
        sendError(res, 404, 'No attempt found.');
        return;
      }

      // Enforce the deadline before writing anything. If it has passed, the attempt is
      // graded now and this answer is not part of it.
      const { attempt, graded } = await finalizeIfExpired(found);
      if (attempt.status !== 'in_progress') {
        sendError(res, 409, graded
          ? 'Your time for this test is up. Your answers have been submitted for marking.'
          : 'This attempt has already been submitted.');
        return;
      }

      const body = req.body as SaveAttemptAnswerInput;
      const questions = await loadAttemptQuestions(attempt);
      const served = questions.get(body.questionId);

      applyAttemptAnswer(
        attempt,
        body.questionId,
        {
          selectedOptionKeys: body.selectedOptionKeys,
          numericResponse: body.numericResponse,
          booleanResponse: body.booleanResponse,
        },
        // The option keys as actually served, so an invented key is refused.
        served ? served.options.map((option) => option.key) : [],
      );
      await attempt.save();

      const answered = attempt.questions.filter((entry) => entry.answeredAt !== null).length;
      sendSuccess(res, 200, {
        saved: true,
        answeredCount: answered,
        totalQuestions: attempt.totalQuestions,
        secondsRemaining: Math.max(0, Math.floor((attempt.expiresAt.getTime() - Date.now()) / 1000)),
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to save a mock test answer',
        fallback: 'Could not save that answer. Please try again.',
      });
    }
  },
);

/**
 * Submits an attempt for marking.
 *
 * Grading is entirely server-side against the snapshot taken when the paper was
 * served, so editing or re-pricing a question afterwards cannot change a mark already
 * awarded. Submission is also where XP is earned — `mock_test_completed`, once per
 * competition day, and only for an attempt with real work in it, so an empty paper
 * submitted in a loop earns nothing.
 *
 * A second submission is not an error the student needs to see: it returns the result
 * that already exists. `graded` is what distinguishes the two internally, and it is
 * what gates the XP award and the audit-free path — the score cannot be re-rolled and
 * the XP cannot be doubled.
 */
router.post(
  '/mock-tests/attempts/:attemptId/submit',
  requirePermission('exam:take'),
  mockTestLimiter,
  validate({ params: attemptIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { attemptId } = req.params as unknown as { attemptId: string };
      const found = await findOwnAttempt(attemptId, studentId(student));
      if (!found) {
        sendError(res, 404, 'No attempt found.');
        return;
      }

      const test = await testFor(found.test);
      if (!test) {
        logger.error({ attemptId, testId: String(found.test) }, 'Attempt references a missing mock test');
        sendError(res, 404, 'The test for this attempt no longer exists.');
        return;
      }

      // A submission that arrives after the deadline is still graded — as at the
      // deadline, and recorded as having run out of time rather than as handed in.
      const expired = new Date() >= found.expiresAt;
      const { attempt, graded } = await finalizeAttempt(
        found,
        expired ? 'time_expired' : 'manual',
        expired ? found.expiresAt : new Date(),
      );

      let xpAwarded = 0;
      if (graded && attempt.correctCount + attempt.incorrectCount > 0) {
        const outcome = await recordActivity({
          student: studentId(student),
          type: 'mock_test_completed',
          detail: `${test.title}: ${attempt.correctCount}/${attempt.totalQuestions} correct`,
        });
        xpAwarded = outcome.xpAwarded;
      }

      const disclosure = disclosureFor(test, attempt);

      if (disclosure.showReview) {
        const questions = await loadAttemptQuestions(attempt);
        sendSuccess(res, 200, {
          attempt: attemptReviewView(attempt, questions, test),
          disclosure,
          xpAwarded,
          submitted: true,
          alreadySubmitted: !graded,
        });
        return;
      }

      sendSuccess(res, 200, {
        attempt: disclosure.showResult
          ? attemptResultView(attempt, test)
          : {
              id: String(attempt._id),
              testId: String(attempt.test),
              testTitle: test.title,
              attemptNumber: attempt.attemptNumber,
              status: attempt.status,
              totalQuestions: attempt.totalQuestions,
              maxMarks: attempt.maxMarks,
              startedAt: attempt.startedAt,
              submittedAt: attempt.submittedAt ?? null,
              autoSubmitted: attempt.submissionReason === 'time_expired',
            },
        disclosure,
        xpAwarded,
        submitted: true,
        alreadySubmitted: !graded,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to submit a mock test attempt',
        fallback: 'Could not submit your attempt. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// One test: the briefing, and starting it
// ---------------------------------------------------------------------------

/**
 * The pre-start briefing: instructions, duration, marks, window, attempts left, and
 * the disclosure settings so the student knows in advance whether they will see their
 * score. Carries **no questions** — the paper only ever arrives inside an attempt.
 */
router.get(
  '/mock-tests/:id',
  requirePermission('exam:take'),
  validate({ params: mockTestIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      const { id } = req.params as unknown as { id: string };
      const test = await findMockTestById(id);

      // A draft or archived test is not merely unavailable to a student, it is not
      // theirs to know about; same for another class's paper. Both answer 404 so the
      // endpoint cannot be used to enumerate unpublished tests.
      if (!STUDENT_VISIBLE_TEST_STATUSES.includes(test.status) || test.classLevel !== student.classLevel) {
        sendError(res, 404, 'No mock test found.');
        return;
      }

      const found = await MockTestAttempt.find({ test: test._id, student: studentId(student) }).sort({
        startedAt: -1,
      });
      const attempts = await Promise.all(found.map(async (attempt) => (await finalizeIfExpired(attempt)).attempt));

      sendSuccess(res, 200, { test: studentTestDetailView(test, attempts) });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to load a mock test for a student',
        fallback: 'Could not load that test. Please try again.',
      });
    }
  },
);

/**
 * Starts the test, or resumes an attempt already under way.
 *
 * Resuming is not a special case the client asks for: the service checks for an open
 * attempt first and returns it, with its original deadline. That is what makes a
 * reload safe, and it is also what stops "start again" from being a way to buy a fresh
 * clock.
 *
 * The window, the class and the attempt limit are all enforced here, in the service.
 * The response is the answer-stripped paper — the first and only point at which the
 * questions are served.
 */
router.post(
  '/mock-tests/:id/attempts',
  requirePermission('exam:take'),
  mockTestLimiter,
  validate({ params: mockTestIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const student = await loadSelf(req, res);
      if (!student) return;

      if (!isClassLevel(student.classLevel)) {
        sendError(res, 409, 'Add your class to your profile before sitting a mock test.');
        return;
      }

      const { id } = req.params as unknown as { id: string };
      const test = await findMockTestById(id);
      if (!STUDENT_VISIBLE_TEST_STATUSES.includes(test.status)) {
        sendError(res, 404, 'No mock test found.');
        return;
      }

      const { attempt, created } = await startAttempt({
        test,
        student: studentId(student),
        studentClassLevel: student.classLevel,
      });

      // An attempt resumed after its deadline has passed is finalised rather than
      // reopened, so a stale session cannot be written to.
      const { attempt: current } = await finalizeIfExpired(attempt);
      if (current.status !== 'in_progress') {
        sendError(res, 409, 'Your time for this test is up. Your answers have been submitted for marking.');
        return;
      }

      const questions = await loadAttemptQuestions(current);
      sendSuccess(res, created ? 201 : 200, {
        attempt: attemptInProgressView(current, questions, test),
        resumed: !created,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to start a mock test attempt',
        fallback: 'Could not start that test. Please try again.',
      });
    }
  },
);

export default router;
