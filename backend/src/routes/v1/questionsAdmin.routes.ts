import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import type { QuestionDocument } from '../../models';
import {
  listQuestions,
  findQuestionById,
  createQuestion,
  updateQuestion,
  changeQuestionStatus,
  deleteQuestion,
  toQuestionContent,
} from '../../services/questionService';
import { actorFrom } from '../../services/taxonomyService';
import {
  createQuestionSchema,
  updateQuestionSchema,
  questionStatusSchema,
  questionIdParamSchema,
  listQuestionsAdminQuerySchema,
  type CreateQuestionInput,
  type QuestionStatusInput,
  type ListQuestionsAdminQuery,
} from '../../validation/questionSchemas';

const router = Router();

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
 * The **author's** view: the full question including the answer key and solution.
 *
 * Deliberately a separate function from `studentQuestionView` in `questions.routes.ts`
 * rather than one function with a `includeAnswers` flag. A boolean parameter is one
 * mistaken argument away from serving the answer key to students; two functions
 * cannot be confused at the call site, and each route's gate is visible next to the
 * view it uses.
 */
function adminQuestionView(question: QuestionDocument) {
  return {
    id: String(question._id),
    questionText: question.questionText,
    type: question.type,
    options: question.options.map((option) => ({ key: option.key, text: option.text, isCorrect: option.isCorrect })),
    booleanAnswer: question.booleanAnswer ?? null,
    numericAnswer: question.numericAnswer ?? null,
    tolerance: question.tolerance ?? null,
    acceptedAnswers: question.acceptedAnswers ?? [],
    solution: question.solution ?? null,
    subject: refView(question.subject),
    topic: refView(question.topic),
    subtopic: refView(question.subtopic),
    classLevel: question.classLevel,
    difficulty: question.difficulty,
    marks: question.marks,
    negativeMarks: question.negativeMarks,
    status: question.status,
    tags: question.tags,
    revision: question.revision,
    createdByLabel: question.createdByLabel ?? null,
    updatedByLabel: question.updatedByLabel ?? null,
    /**
     * Who wrote it — a person, or a model somebody approved.
     *
     * Served because a stored field nothing reads is the shape of thing Milestone 15
     * deleted. The bank prints a badge from this, which is the reason the provenance block
     * exists: so a human can see that a question was machine-drafted, by which model, and
     * who signed it off. It carries no credential and no prompt text.
     */
    provenance: {
      source: question.provenance?.source ?? 'human',
      generatorId: question.provenance?.generatorId ?? null,
      generatorKind: question.provenance?.generatorKind ?? null,
      modelName: question.provenance?.modelName ?? null,
      editedByReviewer: question.provenance?.editedByReviewer ?? false,
      reviewedByLabel: question.provenance?.reviewedByLabel ?? null,
      reviewedAt: question.provenance?.reviewedAt ?? null,
      generatedAt: question.provenance?.generatedAt ?? null,
    },
    publishedAt: question.publishedAt ?? null,
    archivedAt: question.archivedAt ?? null,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}

/**
 * `withOptionKeys` and `toQuestionContent` moved into `services/questionService.ts` in
 * Milestone 17, when the question generator became a second producer of question
 * content. Two implementations of "the server owns option keys" would be one too many —
 * an answer is recorded against the key, so the two could silently disagree about what
 * "option b" means.
 */
const toContentInput = toQuestionContent;

// ---------------------------------------------------------------------------
// Listing — search, filter, sort, paginate
// ---------------------------------------------------------------------------

router.get(
  '/admin/questions',
  requirePermission('questions:write'),
  validate({ query: listQuestionsAdminQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const query = req.query as unknown as ListQuestionsAdminQuery;
      const { questions, total } = await listQuestions(query);

      sendSuccess(res, 200, {
        questions: questions.map(adminQuestionView),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to list questions (admin)', fallback: 'Could not load the question bank. Please try again.' });
    }
  },
);

router.get(
  '/admin/questions/:id',
  requirePermission('questions:write'),
  validate({ params: questionIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as unknown as { id: string };
      const question = await findQuestionById(id);
      sendSuccess(res, 200, { question: adminQuestionView(question) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to load question (admin)', fallback: 'Could not load that question. Please try again.' });
    }
  },
);

// ---------------------------------------------------------------------------
// Create, update
// ---------------------------------------------------------------------------

router.post(
  '/admin/questions',
  requirePermission('questions:write'),
  validate({ body: createQuestionSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const question = await createQuestion(toContentInput(req.body as CreateQuestionInput), actorFrom(req));

      await recordAudit(req, {
        action: 'question.created',
        targetType: 'question',
        targetId: String(question._id),
        targetLabel: question.questionText.slice(0, 80),
        metadata: { type: question.type, classLevel: question.classLevel, difficulty: question.difficulty },
      });

      sendSuccess(res, 201, { question: adminQuestionView(question) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to create question', fallback: 'Could not create that question. Please try again.' });
    }
  },
);

router.put(
  '/admin/questions/:id',
  requirePermission('questions:write'),
  validate({ params: questionIdParamSchema, body: updateQuestionSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as unknown as { id: string };
      const question = await updateQuestion(id, toContentInput(req.body as CreateQuestionInput), actorFrom(req));

      await recordAudit(req, {
        action: 'question.updated',
        targetType: 'question',
        targetId: String(question._id),
        targetLabel: question.questionText.slice(0, 80),
        metadata: { revision: question.revision, status: question.status },
      });

      sendSuccess(res, 200, { question: adminQuestionView(question) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to update question', fallback: 'Could not update that question. Please try again.' });
    }
  },
);

// ---------------------------------------------------------------------------
// Editorial workflow
// ---------------------------------------------------------------------------

router.patch(
  '/admin/questions/:id/status',
  requirePermission('questions:write'),
  validate({ params: questionIdParamSchema, body: questionStatusSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { status, reason } = req.body as QuestionStatusInput;
      const { id } = req.params as unknown as { id: string };
      const question = await changeQuestionStatus(id, status, actorFrom(req));

      await recordAudit(req, {
        action: 'question.status.changed',
        targetType: 'question',
        targetId: String(question._id),
        targetLabel: question.questionText.slice(0, 80),
        metadata: { to: status, reason: reason ?? null },
      });

      sendSuccess(res, 200, { question: adminQuestionView(question) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to change question status', fallback: 'Could not update that question. Please try again.' });
    }
  },
);

// ---------------------------------------------------------------------------
// Deletion — archiving is the normal path; this is only for unpublished drafts
// ---------------------------------------------------------------------------

router.delete(
  '/admin/questions/:id',
  requirePermission('questions:delete'),
  validate({ params: questionIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      // Read it first so the audit entry can describe what was destroyed — after
      // the delete there is nothing left to name.
      const { id } = req.params as unknown as { id: string };
      const question = await findQuestionById(id);
      const label = question.questionText.slice(0, 80);

      await deleteQuestion(id);

      await recordAudit(req, {
        action: 'question.deleted',
        targetType: 'question',
        targetId: id,
        targetLabel: label,
        metadata: { hardDelete: true },
      });

      sendSuccess(res, 200, { deleted: true });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to delete question', fallback: 'Could not delete that question. Please try again.' });
    }
  },
);

export default router;
