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
  changeQuestionStatusBulk,
  deleteQuestion,
  suggestPaper,
  toQuestionContent,
} from '../../services/questionService';
import { getPracticeAvailability } from '../../services/practiceService';
import { Subject, Topic } from '../../models';
import { detectChapter } from '../../lib/chapterDetection';
import { actorFrom } from '../../services/taxonomyService';
import {
  createQuestionSchema,
  updateQuestionSchema,
  questionStatusSchema,
  questionIdParamSchema,
  listQuestionsAdminQuerySchema,
  bulkQuestionStatusSchema,
  practiceAvailabilityQuerySchema,
  paperSuggestionQuerySchema,
  detectChapterQuerySchema,
  type CreateQuestionInput,
  type QuestionStatusInput,
  type ListQuestionsAdminQuery,
  type BulkQuestionStatusInput,
  type PracticeAvailabilityQuery,
  type PaperSuggestionQuery,
  type DetectChapterQuery,
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

// ---------------------------------------------------------------------------
// Bulk actions and the practice preview (Milestone 21, Phase G)
//
// Declared **before** `/admin/questions/:id` deliberately. Express matches in declaration
// order, so a literal path that looks like an id — `practice-availability` — is swallowed by
// `/:id` and answered 400 if it comes later. This is the same ordering trap CLAUDE.md records
// for mounting `questionsImport` ahead of `questionsAdmin`, and there is a test for it.
// ---------------------------------------------------------------------------

/**
 * The same editorial move, applied to a selection (Milestone 21, Phase G).
 *
 * This is what "select twenty questions and make them available for practice" is: publishing them.
 * There is no separate practice-assignment mechanism, because Practice has no admin-curated set to
 * assign to — a student picks a class, a chapter and a difficulty and the server samples what is
 * **published**. So a question becomes practice content by being published, and this route is the
 * bulk affordance for that rather than a second serving path (see the Milestone 21 Phase G ADR).
 *
 * It loops over `changeQuestionStatus()` rather than issuing one `updateMany`, and that is the
 * safety property: a bulk write would skip `assertPublishable()`, which is what refuses a question
 * with no solution or no resolvable answer key. A student is graded on a published question, so a
 * bulk publish that bypassed it would put ungradeable questions in front of children in batches.
 *
 * A **partial success is the normal outcome** and is reported as one: 200 with per-question results,
 * not 400. Nothing is rolled back — the questions that moved were each legitimately publishable, and
 * reverting them because a different one lacked a solution would help nobody.
 */
router.patch(
  '/admin/questions/bulk-status',
  requirePermission('questions:write'),
  validate({ body: bulkQuestionStatusSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { ids, status, reason } = req.body as BulkQuestionStatusInput;
      const outcomes = await changeQuestionStatusBulk(ids, status, actorFrom(req));
      const changed = outcomes.filter((entry) => entry.ok);

      /**
       * One audit entry for the batch, not one per question.
       *
       * The individual `question.status.changed` rows would be the same act recorded twenty times;
       * what an auditor wants to know is that somebody published a selection, how large it was, and
       * how much of it was refused. The ids are recorded so the batch can still be reconstructed.
       */
      if (changed.length > 0) {
        await recordAudit(req, {
          action: 'question.status.changed',
          targetType: 'question',
          targetId: changed.map((entry) => entry.id).join(','),
          targetLabel: `${changed.length} question${changed.length === 1 ? '' : 's'} → ${status}`,
          metadata: {
            to: status,
            reason: reason ?? null,
            requested: ids.length,
            changed: changed.length,
            refused: outcomes.length - changed.length,
            bulk: true,
          },
        });
      }

      sendSuccess(res, 200, {
        changed: changed.length,
        requested: ids.length,
        results: outcomes,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to change question statuses in bulk',
        fallback: 'Could not update those questions. Please try again.',
      });
    }
  },
);

/**
 * A suggested paper: **chapter-wise**, or the **whole syllabus**.
 *
 * `?classLevel=…&count=…` spreads across every chapter that has published questions for that class;
 * adding `&topic=…` draws from that chapter alone. One route for both, because the only difference
 * is whether a chapter is named.
 *
 * The spread is the reason this exists rather than the author using the ordinary listing with a
 * `limit`: forty questions off the top of the bank are the forty most recent, which in a bank filled
 * chapter by chapter means one or two chapters and none of the rest. That is not a syllabus paper.
 *
 * It **writes nothing** and returns the author's own view of each question — the caller holds
 * `questions:write` and can already read the whole bank, so this adds no disclosure surface. Every
 * question is published, because a mock test may only be published with published questions and
 * suggesting drafts would set the author up to fail at the last step.
 */
router.get(
  '/admin/questions/paper-suggestion',
  requirePermission('questions:write'),
  validate({ query: paperSuggestionQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const query = req.query as unknown as PaperSuggestionQuery;
      const questions = await suggestPaper({
        classLevel: query.classLevel,
        topic: query.topic ?? null,
        difficulty: query.difficulty,
        count: query.count,
      });

      /**
       * `$sample` returns plain documents rather than hydrated ones, so the populated `topic` the
       * admin view expects is not there. The chapter names are looked up in one read instead of
       * populating inside the aggregation — the author needs to see which chapter each question came
       * from, which is the whole point of a spread paper.
       */
      const topicIds = [...new Set(questions.map((question) => String(question.topic)))];
      const names = new Map(
        (await Topic.find({ _id: { $in: topicIds } }).select('name').lean()).map((row) => [
          String(row._id),
          row.name,
        ]),
      );

      sendSuccess(res, 200, {
        classLevel: query.classLevel,
        requested: query.count,
        // Fewer than asked for is not an error: the bank has what it has, and the page says so.
        questions: questions.map((question) => ({
          id: String(question._id),
          questionText: question.questionText,
          type: question.type,
          classLevel: question.classLevel,
          difficulty: question.difficulty,
          marks: question.marks,
          negativeMarks: question.negativeMarks,
          topicName: names.get(String(question.topic)) ?? null,
        })),
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to suggest a paper',
        fallback: 'Could not put a paper together. Please try again.',
      });
    }
  },
);

/**
 * Which chapter a question looks like it belongs to.
 *
 * Serves the manual question editor, so an author typing a question can accept a chapter rather than
 * hunting for it in a dropdown — the same detection the importer uses on a file with no `Topic`
 * column, from the same pure function, so the editor and the importer can never disagree about what
 * a question looks like.
 *
 * It **suggests**; it does not set. The response says what it matched on so the author can judge it,
 * and `ambiguous` names the candidates rather than picking one — the case where a guess is most
 * likely to be wrong and least likely to be questioned.
 *
 * No model is called. See `lib/chapterDetection.ts` for why.
 */
router.get(
  '/admin/questions/detect-chapter',
  requirePermission('questions:write'),
  validate({ query: detectChapterQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { text } = req.query as unknown as DetectChapterQuery;

      /**
       * The chapters of the one active subject.
       *
       * There is no user-facing subject in this product, so none is asked for. With more than one
       * subject in legacy data, every active chapter is offered to the detector — a wrong *subject*
       * cannot result, because the author still confirms the chapter and the write path checks that
       * the chapter belongs to the subject.
       */
      const subjects = await Subject.find({ status: 'active' }).select('_id').lean();
      const chapters = await Topic.find({
        subject: { $in: subjects.map((subject) => subject._id) },
        parent: null,
        status: 'active',
      })
        .select('name description')
        .lean();

      const outcome = detectChapter(
        text,
        chapters.map((chapter) => ({
          id: String(chapter._id),
          name: chapter.name,
          description: chapter.description ?? null,
        })),
      );

      sendSuccess(res, 200, {
        outcome: outcome.kind,
        match:
          outcome.kind === 'matched'
            ? {
                topicId: outcome.match.topicId,
                topicName: outcome.match.topicName,
                matchedWords: outcome.match.matchedWords,
              }
            : null,
        between: outcome.kind === 'ambiguous' ? outcome.between : [],
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to detect a chapter',
        fallback: 'Could not work out a chapter. Choose one yourself.',
      });
    }
  },
);

/**
 * What a student of one class would currently find in the practice picker.
 *
 * The staff-side answer to "did publishing those questions actually make them practisable?", and it
 * calls **`getPracticeAvailability()`** — the very function the student route uses — rather than
 * counting questions itself. A second count would eventually disagree with the picker, and then the
 * preview would be reassuring an administrator about something untrue.
 *
 * It takes a `classLevel` because this is the staff view: an administrator publishing Class 5
 * questions needs to see the Class 5 picker and is not a Class 5 student. The student route
 * deliberately takes no class at all, for the opposite reason.
 *
 * Returns **counts and names only** — no question text, and certainly no answer key — so it adds no
 * disclosure surface even though it is a staff route.
 */
router.get(
  '/admin/questions/practice-availability',
  requirePermission('questions:write'),
  validate({ query: practiceAvailabilityQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { classLevel } = req.query as unknown as PracticeAvailabilityQuery;
      const subjects = await getPracticeAvailability(classLevel);

      sendSuccess(res, 200, {
        classLevel,
        // Flattened to chapters, because there is no user-facing subject in this product and a
        // nested subject level would be a shape the page has to unwrap for nothing.
        topics: subjects.flatMap((subject) =>
          subject.topics.map((topic) => ({
            topicId: topic.topicId,
            topicName: topic.topicName,
            questionCount: topic.questionCount,
            difficulties: topic.difficulties,
          })),
        ),
        totalQuestions: subjects.reduce((sum, subject) => sum + subject.questionCount, 0),
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to read practice availability',
        fallback: 'Could not check what is available to practise. Please try again.',
      });
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
