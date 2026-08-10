import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { STUDENT_VISIBLE_STATUSES } from '../../models';
import { listQuestions, findQuestionById } from '../../services/questionService';
import { studentQuestionView } from '../../services/questionView';
import {
  listQuestionsPublicQuerySchema,
  questionIdParamSchema,
  type ListQuestionsPublicQuery,
} from '../../validation/questionSchemas';
import { ApiError } from '../../lib/ApiError';

const router = Router();

/**
 * The answer-stripped `studentQuestionView` this file used to define now lives in
 * `services/questionView.ts`, because the daily challenge needs the same projection
 * and a second hand-written stripper is how an answer key eventually leaks. It is
 * still deliberately separate from the author view in `questionsAdmin.routes.ts`.
 */

/**
 * Lists questions for a student.
 *
 * Two properties are pinned here rather than left to the caller:
 *  - `requirePermission('questions:read')` — the endpoint is no longer anonymous.
 *  - `restrictToStatuses` — only `published` questions are considered, and the
 *    query schema has no `status` parameter at all, so drafts and archived
 *    questions are unreachable by construction rather than by filtering.
 */
router.get(
  '/questions',
  requirePermission('questions:read'),
  validate({ query: listQuestionsPublicQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const query = req.query as unknown as ListQuestionsPublicQuery;
      const { questions, total } = await listQuestions({
        ...query,
        restrictToStatuses: STUDENT_VISIBLE_STATUSES,
      });

      sendSuccess(res, 200, {
        questions: questions.map(studentQuestionView),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to list questions', fallback: 'Could not load questions. Please try again.' });
    }
  },
);

router.get(
  '/questions/:id',
  requirePermission('questions:read'),
  validate({ params: questionIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      // `validate({ params })` has already parsed and replaced these, so the cast is
      // a narrowing of an established fact — the same pattern used for req.query.
      const { id } = req.params as unknown as { id: string };
      const question = await findQuestionById(id);

      // An unpublished question must be indistinguishable from one that does not
      // exist. Answering 403 would confirm that a draft with this id is being
      // prepared, which is information a student should not have.
      if (!STUDENT_VISIBLE_STATUSES.includes(question.status)) {
        throw ApiError.notFound('No question exists with that id.');
      }

      sendSuccess(res, 200, { question: studentQuestionView(question) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to load question', fallback: 'Could not load that question. Please try again.' });
    }
  },
);

export default router;
