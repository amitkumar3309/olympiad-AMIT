import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { STUDENT_VISIBLE_STATUSES, type QuestionDocument } from '../../models';
import { listQuestions, findQuestionById } from '../../services/questionService';
import {
  listQuestionsPublicQuerySchema,
  questionIdParamSchema,
  type ListQuestionsPublicQuery,
} from '../../validation/questionSchemas';
import { ApiError } from '../../lib/ApiError';

const router = Router();

/**
 * A populated `subject` / `topic` ref, once `.populate('subject', 'name slug')` has
 * run. Mongoose types the field as the id, so this narrows it without `any`.
 */
interface PopulatedRef {
  _id: unknown;
  name?: string;
  slug?: string;
}

function refView(value: unknown): { id: string; name: string | null } | null {
  if (!value) return null;
  if (typeof value === 'object' && 'name' in (value as PopulatedRef)) {
    const ref = value as PopulatedRef;
    return { id: String(ref._id), name: ref.name ?? null };
  }
  return { id: String(value), name: null };
}

/**
 * The **student** view of a question.
 *
 * This is the security-critical function in this file. Before Milestone 4 the
 * questions endpoint had no authentication at all and returned raw documents, so
 * `correctAnswer` — the entire answer key — was readable by anyone on the internet.
 * It is now an explicit allow-list, and the three things that would give the answer
 * away are omitted by construction rather than deleted afterwards:
 *
 *  - `isCorrect` on each option (options keep only `key` and `text`),
 *  - `booleanAnswer` / `numericAnswer` / `tolerance`,
 *  - `solution`.
 *
 * Adding a field here is therefore a deliberate act. A test asserts none of these
 * names appears in the response body.
 */
function studentQuestionView(question: QuestionDocument) {
  return {
    id: String(question._id),
    questionText: question.questionText,
    type: question.type,
    // Only the key and the text — never `isCorrect`.
    options: question.options.map((option) => ({ key: option.key, text: option.text })),
    subject: refView(question.subject),
    topic: refView(question.topic),
    subtopic: refView(question.subtopic),
    classLevel: question.classLevel,
    difficulty: question.difficulty,
    marks: question.marks,
    negativeMarks: question.negativeMarks,
    tags: question.tags,
    revision: question.revision,
  };
}

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
