import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { MockTestAttempt } from '../../models';
import { actorFrom } from '../../services/taxonomyService';
import {
  adminTestView,
  changeMockTestStatus,
  createMockTest,
  deleteMockTest,
  findMockTestById,
  listMockTests,
  loadTestQuestions,
  testResults,
  updateMockTest,
  type MockTestContentInput,
} from '../../services/mockTestService';
import {
  createMockTestSchema,
  listMockTestsAdminQuerySchema,
  mockTestIdParamSchema,
  mockTestStatusSchema,
  updateMockTestSchema,
  type CreateMockTestInput,
  type ListMockTestsAdminQuery,
  type MockTestStatusInput,
} from '../../validation/mockTestSchemas';

/**
 * Authoring mock tests (Milestone 7).
 *
 * Every route here is gated on `mocktests:write`, which is an elevated permission —
 * so each request re-reads the caller's role from the database and a demoted or
 * suspended administrator loses access at once rather than at token expiry. That
 * matters more here than on most admin routes, because this permission also carries
 * the right to read every student's marks.
 *
 * The rules about what makes a valid, publishable, editable test all live in
 * `services/mockTestService.ts`. This file does HTTP: parse, delegate, audit, respond.
 */
const router = Router();

/** The service takes the parsed body as-is; this names the conversion for the reader. */
function toContentInput(input: CreateMockTestInput): MockTestContentInput {
  return {
    title: input.title,
    description: input.description,
    instructions: input.instructions,
    classLevel: input.classLevel,
    questions: input.questions,
    durationMinutes: input.durationMinutes,
    availableFrom: input.availableFrom,
    availableTo: input.availableTo,
    maxAttempts: input.maxAttempts,
    resultDisplay: input.resultDisplay,
    reviewPolicy: input.reviewPolicy,
  };
}

// ---------------------------------------------------------------------------
// Listing and reading
// ---------------------------------------------------------------------------

router.get(
  '/admin/mock-tests',
  requirePermission('mocktests:write'),
  validate({ query: listMockTestsAdminQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const query = req.query as unknown as ListMockTestsAdminQuery;
      const { tests, total } = await listMockTests(query);

      sendSuccess(res, 200, {
        // No question text on the list: it would mean loading every paper's questions
        // to render a table of titles.
        tests: tests.map((test) => adminTestView(test)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to list mock tests',
        fallback: 'Could not load the mock tests. Please try again.',
      });
    }
  },
);

router.get(
  '/admin/mock-tests/:id',
  requirePermission('mocktests:write'),
  validate({ params: mockTestIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as unknown as { id: string };
      const test = await findMockTestById(id);
      // Loaded here so the editor can show which questions are on the paper without a
      // second round trip per question.
      const questions = await loadTestQuestions(test);
      // The editor needs this to know the paper is frozen: the service refuses a change
      // to the questions or the duration once anybody has sat the test, and an author
      // should be told that before they spend time rearranging it rather than after.
      const attemptsCount = await MockTestAttempt.countDocuments({ test: test._id });
      sendSuccess(res, 200, { test: adminTestView(test, questions), attemptsCount });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to load a mock test',
        fallback: 'Could not load that mock test. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------

router.post(
  '/admin/mock-tests',
  requirePermission('mocktests:write'),
  validate({ body: createMockTestSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const test = await createMockTest(toContentInput(req.body as CreateMockTestInput), actorFrom(req));

      await recordAudit(req, {
        action: 'mocktest.created',
        targetType: 'mocktest',
        targetId: String(test._id),
        targetLabel: test.title,
        metadata: {
          classLevel: test.classLevel,
          questions: test.questions.length,
          totalMarks: test.totalMarks,
          durationMinutes: test.durationMinutes,
        },
      });

      sendSuccess(res, 201, { test: adminTestView(test) });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to create a mock test',
        fallback: 'Could not create that mock test. Please try again.',
      });
    }
  },
);

router.put(
  '/admin/mock-tests/:id',
  requirePermission('mocktests:write'),
  validate({ params: mockTestIdParamSchema, body: updateMockTestSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as unknown as { id: string };
      const test = await updateMockTest(id, toContentInput(req.body as CreateMockTestInput), actorFrom(req));

      await recordAudit(req, {
        action: 'mocktest.updated',
        targetType: 'mocktest',
        targetId: String(test._id),
        targetLabel: test.title,
        metadata: {
          questions: test.questions.length,
          totalMarks: test.totalMarks,
          durationMinutes: test.durationMinutes,
          availableFrom: test.availableFrom,
          availableTo: test.availableTo,
          resultDisplay: test.resultDisplay,
          reviewPolicy: test.reviewPolicy,
        },
      });

      sendSuccess(res, 200, { test: adminTestView(test) });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to update a mock test',
        fallback: 'Could not update that mock test. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Publish / unpublish / archive
// ---------------------------------------------------------------------------

router.patch(
  '/admin/mock-tests/:id/status',
  requirePermission('mocktests:write'),
  validate({ params: mockTestIdParamSchema, body: mockTestStatusSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as unknown as { id: string };
      const { status, reason } = req.body as MockTestStatusInput;
      const test = await changeMockTestStatus(id, status, actorFrom(req));

      await recordAudit(req, {
        action: 'mocktest.status.changed',
        targetType: 'mocktest',
        targetId: String(test._id),
        targetLabel: test.title,
        metadata: { to: status, reason: reason ?? null },
      });

      sendSuccess(res, 200, { test: adminTestView(test) });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to change a mock test status',
        fallback: 'Could not update that mock test. Please try again.',
      });
    }
  },
);

router.delete(
  '/admin/mock-tests/:id',
  requirePermission('mocktests:write'),
  validate({ params: mockTestIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      // Read it first so the audit entry can name what was destroyed — afterwards
      // there is nothing left to read.
      const { id } = req.params as unknown as { id: string };
      const test = await findMockTestById(id);
      const label = test.title;

      await deleteMockTest(id);

      await recordAudit(req, {
        action: 'mocktest.deleted',
        targetType: 'mocktest',
        targetId: id,
        targetLabel: label,
        metadata: { hardDelete: true },
      });

      sendSuccess(res, 200, { deleted: true });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to delete a mock test',
        fallback: 'Could not delete that mock test. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Every attempt at one test, with cohort statistics, ranking and per-question
 * outcomes.
 *
 * This is the surface that finalises expired attempts (the service sweeps before it
 * reads), so a paper whose clock ran out is reported as the graded thing it is rather
 * than as "in progress" indefinitely. Staff see real marks regardless of the test's
 * student-facing `resultDisplay`: that setting decides what a *student* is told, not
 * whether the person who set the test may read their own cohort's results.
 */
router.get(
  '/admin/mock-tests/:id/results',
  requirePermission('mocktests:write'),
  validate({ params: mockTestIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as unknown as { id: string };
      const test = await findMockTestById(id);
      const results = await testResults(test);

      sendSuccess(res, 200, {
        test: {
          id: String(test._id),
          title: test.title,
          classLevel: test.classLevel,
          totalMarks: test.totalMarks,
          totalQuestions: test.questions.length,
          durationMinutes: test.durationMinutes,
          status: test.status,
          availableFrom: test.availableFrom ?? null,
          availableTo: test.availableTo ?? null,
        },
        ...results,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to load mock test results',
        fallback: 'Could not load the results for that test. Please try again.',
      });
    }
  },
);

export default router;
