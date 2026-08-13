import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { Exam, ExamAttempt, Question, Student, type ExamDocument, type ExamStatus } from '../../models';
import type { ClassLevel } from '../../lib/classLevels';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { recordAudit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { ApiError } from '../../lib/ApiError';
import { availabilityOf, publishResults, sweepExpiredExamAttempts } from '../../services/examService';
import { issueForExam } from '../../services/certificateService';
import {
  createExamSchema,
  updateExamSchema,
  examStatusSchema,
  listExamsQuerySchema,
  examIdParamSchema,
  publishResultsSchema,
  type CreateExamInput,
  type UpdateExamInput,
  type ExamStatusInput,
  type ListExamsQuery,
  type PublishResultsInput,
} from '../../validation/examSchemas';

/**
 * Authoring and running the **official Olympiad** (Milestone 13).
 *
 * Gated on `exam:write`, which is deliberately separate from `mocktests:write`: a mock
 * test is a rehearsal that can be republished at will, whereas releasing an official
 * result fixes a national rank and mints certificates.
 */
const router = Router();

function adminExamView(exam: ExamDocument, now = new Date()) {
  const availability = availabilityOf(exam, now);
  return {
    id: String(exam._id),
    examCode: exam.examCode,
    title: exam.title,
    description: exam.description ?? null,
    instructions: exam.instructions ?? null,
    classLevel: exam.classLevel,
    durationMinutes: exam.durationMinutes,
    totalMarks: exam.totalMarks,
    questionCount: exam.questions.length,
    questions: [...exam.questions]
      .sort((a, b) => a.order - b.order)
      .map((ref) => ({
        question: String(ref.question),
        order: ref.order,
        marks: ref.marks,
        negativeMarks: ref.negativeMarks,
      })),
    opensAt: exam.opensAt,
    closesAt: exam.closesAt,
    windowState: availability.reason,
    status: exam.status,
    meritThresholdPercent: exam.meritThresholdPercent,
    distinctionThresholdPercent: exam.distinctionThresholdPercent,
    resultsPublishedAt: exam.resultsPublishedAt ?? null,
    resultsPublishedBy: exam.resultsPublishedBy ?? null,
    createdByLabel: exam.createdByLabel ?? null,
    createdAt: exam.createdAt,
    updatedAt: exam.updatedAt,
  };
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates the question set and returns the total.
 *
 * Every question must exist and be **published**: an official paper made partly of
 * drafts would either serve a question the author never finished or refuse to start
 * once somebody sat down, and the second is a far worse place to find out.
 */
async function priceQuestions(refs: CreateExamInput['questions']): Promise<number> {
  if (refs.length === 0) return 0;

  const ids = refs.map((ref) => ref.question);
  const found = await Question.find({ _id: { $in: ids } }).select('_id status');
  const byId = new Map(found.map((doc) => [String(doc._id), doc]));

  for (const ref of refs) {
    const question = byId.get(ref.question);
    if (!question) throw ApiError.badRequest('One of those questions does not exist.');
    if (question.status !== 'published') {
      throw ApiError.badRequest('An official exam may only use published questions.');
    }
  }

  const orders = new Set(refs.map((ref) => ref.order));
  if (orders.size !== refs.length) throw ApiError.badRequest('Two questions have the same position.');

  const unique = new Set(refs.map((ref) => ref.question));
  if (unique.size !== refs.length) throw ApiError.badRequest('The same question appears twice on this paper.');

  return refs.reduce((sum, ref) => sum + ref.marks, 0);
}

// ---------------------------------------------------------------------------
// Listing and authoring
// ---------------------------------------------------------------------------

router.get(
  '/admin/exams',
  requirePermission('exam:write'),
  validate({ query: listExamsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, status, classLevel, search } = req.query as unknown as ListExamsQuery;

      const filter: { status?: ExamStatus; classLevel?: ClassLevel; $or?: Array<Record<string, RegExp>> } = {};
      if (status) filter.status = status;
      if (classLevel) filter.classLevel = classLevel;
      if (search) {
        const pattern = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ title: pattern }, { examCode: pattern }];
      }

      const [exams, total] = await Promise.all([
        Exam.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Exam.countDocuments(filter),
      ]);

      sendSuccess(res, 200, {
        exams: exams.map((exam) => adminExamView(exam)),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list exams');
      sendError(res, 500, 'Could not load the exams. Please try again.');
    }
  },
);

router.get(
  '/admin/exams/:id',
  requirePermission('exam:write'),
  validate({ params: examIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const exam = await Exam.findById(req.params.id);
      if (!exam) {
        sendError(res, 404, 'No exam with that id.');
        return;
      }
      sendSuccess(res, 200, { exam: adminExamView(exam) });
    } catch (err) {
      logger.error({ err }, 'Failed to load an exam');
      sendError(res, 500, 'Could not load that exam. Please try again.');
    }
  },
);

router.post(
  '/admin/exams',
  requirePermission('exam:write'),
  validate({ body: createExamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as CreateExamInput;
      const totalMarks = await priceQuestions(input.questions);

      const exam = await Exam.create({
        ...input,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        totalMarks,
        status: 'draft',
        createdBy: req.user?.sub ?? null,
        createdByLabel: req.user?.studentId ?? req.user?.email ?? null,
      });

      await recordAudit(req, {
        action: 'exam.changed',
        targetType: 'exam',
        targetId: exam.examCode,
        targetLabel: exam.title,
        metadata: { operation: 'created', classLevel: exam.classLevel, questionCount: exam.questions.length },
      });

      sendSuccess(res, 201, { exam: adminExamView(exam) });
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err.statusCode, err.message);
        return;
      }
      if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
        sendError(res, 409, 'An exam with that code already exists.');
        return;
      }
      logger.error({ err }, 'Failed to create an exam');
      sendError(res, 500, 'Could not create that exam. Please try again.');
    }
  },
);

router.patch(
  '/admin/exams/:id',
  requirePermission('exam:write'),
  validate({ params: examIdParamSchema, body: updateExamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const updates = req.body as UpdateExamInput;
      const exam = await Exam.findById(req.params.id);
      if (!exam) {
        sendError(res, 404, 'No exam with that id.');
        return;
      }

      /**
       * The paper is frozen once anybody has sat it. Changing the questions, the marks
       * or the duration underneath a submitted attempt would mean the exam no longer
       * describes the paper that was actually served — and the attempt's own snapshot
       * would silently disagree with it. The window and the thresholds stay editable,
       * because releasing results late or re-deciding a grade boundary are legitimate
       * acts that do not rewrite what anyone sat.
       */
      const sat = await ExamAttempt.countDocuments({ exam: exam._id });
      const touchesPaper =
        updates.questions !== undefined || updates.durationMinutes !== undefined || updates.classLevel !== undefined;
      if (sat > 0 && touchesPaper) {
        sendError(res, 409, 'Students have already sat this exam, so its paper, duration and class cannot change.');
        return;
      }

      if (updates.questions !== undefined) {
        exam.totalMarks = await priceQuestions(updates.questions);
        exam.questions = updates.questions.map((ref) => ({
          question: ref.question as unknown as Types.ObjectId,
          order: ref.order,
          marks: ref.marks,
          negativeMarks: ref.negativeMarks,
        }));
      }
      if (updates.title !== undefined) exam.title = updates.title;
      if (updates.examCode !== undefined) exam.examCode = updates.examCode;
      if (updates.description !== undefined) exam.description = updates.description ?? null;
      if (updates.instructions !== undefined) exam.instructions = updates.instructions ?? null;
      if (updates.classLevel !== undefined) exam.classLevel = updates.classLevel;
      if (updates.durationMinutes !== undefined) exam.durationMinutes = updates.durationMinutes;
      if (updates.opensAt !== undefined) exam.opensAt = updates.opensAt;
      if (updates.closesAt !== undefined) exam.closesAt = updates.closesAt;
      if (updates.meritThresholdPercent !== undefined) exam.meritThresholdPercent = updates.meritThresholdPercent;
      if (updates.distinctionThresholdPercent !== undefined) {
        exam.distinctionThresholdPercent = updates.distinctionThresholdPercent;
      }

      if (exam.closesAt <= exam.opensAt) {
        sendError(res, 400, 'The exam must close after it opens.');
        return;
      }
      if (exam.distinctionThresholdPercent < exam.meritThresholdPercent) {
        sendError(res, 400, 'Distinction must be at least as high as merit.');
        return;
      }

      exam.updatedBy = (req.user?.sub ?? null) as unknown as Types.ObjectId | null;
      exam.updatedByLabel = req.user?.studentId ?? req.user?.email ?? null;
      await exam.save();

      await recordAudit(req, {
        action: 'exam.changed',
        targetType: 'exam',
        targetId: exam.examCode,
        targetLabel: exam.title,
        metadata: { operation: 'updated', fields: Object.keys(updates) },
      });

      sendSuccess(res, 200, { exam: adminExamView(exam) });
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err.statusCode, err.message);
        return;
      }
      if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
        sendError(res, 409, 'An exam with that code already exists.');
        return;
      }
      logger.error({ err }, 'Failed to update an exam');
      sendError(res, 500, 'Could not update that exam. Please try again.');
    }
  },
);

router.patch(
  '/admin/exams/:id/status',
  requirePermission('exam:write'),
  validate({ params: examIdParamSchema, body: examStatusSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { status, reason } = req.body as ExamStatusInput;
      const exam = await Exam.findById(req.params.id);
      if (!exam) {
        sendError(res, 404, 'No exam with that id.');
        return;
      }

      if (status === 'published' && exam.questions.length === 0) {
        sendError(res, 409, 'An exam with no questions cannot be published.');
        return;
      }

      const previous = exam.status;
      exam.status = status;
      if (status === 'published' && !exam.publishedAt) exam.publishedAt = new Date();
      if (status === 'archived') exam.archivedAt = new Date();
      await exam.save();

      await recordAudit(req, {
        action: 'exam.changed',
        targetType: 'exam',
        targetId: exam.examCode,
        targetLabel: exam.title,
        metadata: { operation: 'status', from: previous, to: status, reason: reason ?? null },
      });

      sendSuccess(res, 200, { exam: adminExamView(exam) });
    } catch (err) {
      logger.error({ err }, 'Failed to change exam status');
      sendError(res, 500, 'Could not update that exam. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Attempts and publication
// ---------------------------------------------------------------------------

router.get(
  '/admin/exams/:id/attempts',
  requirePermission('exam:write'),
  validate({ params: examIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const exam = await Exam.findById(req.params.id);
      if (!exam) {
        sendError(res, 404, 'No exam with that id.');
        return;
      }

      // Sweep first, so a paper cannot show as "in progress" hours after it could
      // possibly have been written.
      await sweepExpiredExamAttempts(exam._id as Types.ObjectId);

      const attempts = await ExamAttempt.find({ exam: exam._id }).sort({ score: -1, submittedAt: 1 });
      const students = await Student.find({ _id: { $in: attempts.map((a) => a.student) } }).select(
        'studentId fullName classLevel schoolName',
      );
      const byId = new Map(students.map((s) => [String(s._id), s]));

      sendSuccess(res, 200, {
        exam: adminExamView(exam),
        attempts: attempts.map((attempt) => {
          const student = byId.get(String(attempt.student));
          return {
            id: String(attempt._id),
            studentId: student?.studentId ?? null,
            fullName: student?.fullName ?? null,
            schoolName: student?.schoolName ?? null,
            status: attempt.status,
            score: attempt.score,
            maxMarks: attempt.maxMarks,
            percentage: attempt.maxMarks > 0 ? Math.round((attempt.score / attempt.maxMarks) * 1000) / 10 : 0,
            accuracy: attempt.accuracy,
            correctCount: attempt.correctCount,
            incorrectCount: attempt.incorrectCount,
            unansweredCount: attempt.unansweredCount,
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt ?? null,
            submissionReason: attempt.submissionReason ?? null,
            timeTakenSeconds: attempt.timeTakenSeconds,
          };
        }),
      });
    } catch (err) {
      logger.error({ err }, 'Failed to load exam attempts');
      sendError(res, 500, 'Could not load the attempts. Please try again.');
    }
  },
);

/**
 * Releases the results for one exam, and mints every certificate for that sitting.
 *
 * The single most consequential administrative act in the product: it fixes a national
 * rank and issues certificates. Both happen in **one** operation on purpose — a result
 * without a certificate, or a certificate without a published result, would be a state
 * nothing in the product knows how to describe.
 *
 * Idempotent. Re-running recomputes ranks (so a late-swept attempt is included) and
 * updates the same `Result` rows, while the unique index on `{student, exam}` means no
 * student gets a second certificate.
 */
router.post(
  '/admin/exams/:id/publish-results',
  requirePermission('exam:write'),
  validate({ params: examIdParamSchema, body: publishResultsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { reason } = req.body as PublishResultsInput;
      const exam = await Exam.findById(req.params.id);
      if (!exam) {
        sendError(res, 404, 'No exam with that id.');
        return;
      }

      const now = new Date();
      if (now < exam.closesAt) {
        // Ranks are a cohort fact. Publishing while the window is open would rank a
        // student against whoever happened to have finished first.
        sendError(res, 409, 'This exam has not closed yet, so results cannot be released.');
        return;
      }

      const publishedBy = req.user?.studentId ?? req.user?.email ?? 'unknown';
      const publication = await publishResults(exam, publishedBy, now);
      const certificates = await issueForExam(exam, publishedBy, now);

      await recordAudit(req, {
        action: 'exam.results.published',
        targetType: 'exam',
        targetId: exam.examCode,
        targetLabel: exam.title,
        metadata: {
          candidates: publication.candidates,
          resultsWritten: publication.resultsWritten,
          certificatesIssued: certificates.issued,
          certificatesSkipped: certificates.skipped,
          reason: reason ?? null,
        },
      });

      logger.warn(
        { examCode: exam.examCode, ...publication, ...certificates, actor: publishedBy },
        'Official exam results published',
      );

      sendSuccess(res, 200, {
        exam: adminExamView(exam),
        publication,
        certificates,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err.statusCode, err.message);
        return;
      }
      logger.error({ err }, 'Failed to publish exam results');
      sendError(res, 500, 'Could not publish those results. Please try again.');
    }
  },
);

export default router;
