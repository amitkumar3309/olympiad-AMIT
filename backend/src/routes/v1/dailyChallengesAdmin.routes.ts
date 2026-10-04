import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { adminActionLimiter, importLimiter } from '../../middleware/rateLimiter';
import { sendError, sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { now } from '../../lib/clock';
import { classRangeLabel } from '../../lib/dailyQuiz';
import { Student } from '../../models';
import { actorFrom } from '../../services/taxonomyService';
import { notifyDailyQuizWinner } from '../../services/systemNotifier';
import {
  approveQuizImport,
  previewQuizImport,
  QUIZ_IMPORT_KINDS,
  quizTemplateCsv,
  quizTemplateJson,
  type QuizImportKind,
} from '../../services/dailyQuizImportService';
import {
  adminQuizView,
  applyWinnerAction,
  bulkScheduleQuizzes,
  changeQuizQuestion,
  computeWinners,
  deleteQuiz,
  getQuizSettings,
  groupIdOf,
  listPrizeDesk,
  listQuizCandidates,
  listQuizGroups,
  loadGroup,
  quizCalendar,
  rangeOf,
  scheduleQuiz,
  statsForGroups,
  updateQuizSettings,
  winnerRow,
  winnerSummaries,
  winnersForGroup,
  type WinnerAction,
} from '../../services/dailyChallengeService';
import {
  bulkScheduleSchema,
  candidatesQuerySchema,
  changeQuizSchema,
  groupIdParamSchema,
  listQuizzesQuerySchema,
  prizeDeskQuerySchema,
  quizImportApproveSchema,
  quizImportPreviewSchema,
  quizSettingsSchema,
  quizTemplateQuerySchema,
  scheduleQuizSchema,
  winnerActionBodySchema,
  winnerActionParamSchema,
  type BulkScheduleBody,
  type CandidatesQuery,
  type ChangeQuizBody,
  type ListQuizzesQuery,
  type PrizeDeskQuery,
  type QuizImportApproveBody,
  type QuizImportPreviewBody,
  type QuizSettingsBody,
  type QuizTemplateQuery,
  type ScheduleQuizBody,
  type WinnerActionBody,
} from '../../validation/dailyChallengeSchemas';

/**
 * Running the Daily Quiz (Milestone 30, Phase 2) — the daily challenge's console,
 * upgraded: schedule by class range, load weeks at once, see how each quiz landed, choose
 * and publish the winners, and set the prize.
 *
 * Gated on `challenges:write`, which is elevated, so every request re-reads the caller's
 * role and a demoted administrator loses access at once. Every change is audited — the
 * winner steps especially, because each is a decision about who a child's prize goes to.
 *
 * **Literal paths are declared before `/:groupId`.** Express matches in order, and
 * `/admin/daily-quiz/candidates` placed after `/:groupId` would be answered as a quiz
 * whose id is "candidates" (CLAUDE.md, the same trap as the question bank's).
 */
const router = Router();
const GATE = requirePermission('challenges:write');
/** A quiz import also writes to the question bank, so it needs both capabilities. */
const IMPORT_GATE = requirePermission('challenges:write', 'questions:write');

// ---------------------------------------------------------------------------
// Listing and the calendar
// ---------------------------------------------------------------------------

router.get('/admin/daily-quiz', GATE, validate({ query: listQuizzesQuerySchema }), ensureDb, async (req: Request, res: Response) => {
  try {
    const at = now();
    const query = req.query as unknown as ListQuizzesQuery;
    const [{ groups, total }, calendar] = await Promise.all([listQuizGroups(query), quizCalendar(at)]);
    const ids = groups.map((group) => ({ id: String(group._id), docIds: group.docIds }));
    const [stats, winners] = await Promise.all([
      statsForGroups(ids),
      winnerSummaries(groups.map((group) => group._id)),
    ]);

    sendSuccess(res, 200, {
      quizzes: groups.map((group) =>
        adminQuizView(group, stats.get(String(group._id)), at, winners.get(String(group._id)) ?? null),
      ),
      calendar,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
    });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Failed to list Daily Quizzes', fallback: 'Could not load the Daily Quizzes. Please try again.' });
  }
});

/** Bank questions that can become a quiz for a class range — the scheduler's picker. */
router.get(
  '/admin/daily-quiz/candidates',
  GATE,
  validate({ query: candidatesQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const query = req.query as unknown as CandidatesQuery;
      const { candidates, total } = await listQuizCandidates(query);
      sendSuccess(res, 200, {
        candidates,
        pagination: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
      });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to list quiz candidates', fallback: 'Could not load the questions. Please try again.' });
    }
  },
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

router.get('/admin/daily-quiz/settings', GATE, ensureDb, async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, 200, { settings: await getQuizSettings() });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Failed to read Daily Quiz settings', fallback: 'Could not load the settings. Please try again.' });
  }
});

router.put(
  '/admin/daily-quiz/settings',
  GATE,
  validate({ body: quizSettingsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const before = await getQuizSettings();
      const body = req.body as QuizSettingsBody;
      const settings = await updateQuizSettings(body, actorFrom(req));
      await recordAudit(req, {
        action: 'dailyquiz.settings.updated',
        targetType: 'dailyquiz',
        targetId: 'settings',
        targetLabel: 'Daily Quiz settings',
        metadata: {
          before: { ...before, updatedAt: undefined, updatedByLabel: undefined },
          after: body,
        },
      });
      sendSuccess(res, 200, { settings });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to update Daily Quiz settings', fallback: 'Could not save the settings. Please try again.' });
    }
  },
);

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

router.post('/admin/daily-quiz', GATE, validate({ body: scheduleQuizSchema }), ensureDb, async (req: Request, res: Response) => {
  try {
    const at = now();
    const body = req.body as ScheduleQuizBody;
    const docs = await scheduleQuiz(body, actorFrom(req), at);
    const first = docs[0]!;
    const groupId = groupIdOf(first);

    await recordAudit(req, {
      action: 'dailyquiz.scheduled',
      targetType: 'dailyquiz',
      targetId: String(groupId),
      targetLabel: `${classRangeLabel(body.classMin, body.classMax)} · ${body.day}`,
      metadata: { day: body.day, classMin: body.classMin, classMax: body.classMax, question: body.questionId },
    });

    sendSuccess(res, 201, { groupId: String(groupId), day: first.day, classes: docs.map((doc) => doc.classLevel) });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Failed to schedule a Daily Quiz', fallback: 'Could not schedule that quiz. Please try again.' });
  }
});

/**
 * Loading weeks at once. `dryRun: true` (the default) returns the plan and writes nothing;
 * the confirming call re-checks every row and reports each one.
 */
router.post('/admin/daily-quiz/bulk', GATE, validate({ body: bulkScheduleSchema }), ensureDb, async (req: Request, res: Response) => {
  try {
    const body = req.body as BulkScheduleBody;
    const rows = await bulkScheduleQuizzes(body, actorFrom(req), now());
    const scheduled = rows.filter((row) => row.day && !row.error);

    if (!body.dryRun && scheduled.length > 0) {
      await recordAudit(req, {
        action: 'dailyquiz.scheduled',
        targetType: 'dailyquiz',
        targetId: 'bulk',
        targetLabel: `${classRangeLabel(body.classMin, body.classMax)} · ${scheduled.length} quizzes`,
        metadata: { bulk: true, days: scheduled.map((row) => row.day), questions: scheduled.map((row) => row.questionId) },
      });
    }

    sendSuccess(res, 200, { dryRun: body.dryRun, rows, scheduledCount: body.dryRun ? 0 : scheduled.length });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Failed to bulk-schedule Daily Quizzes', fallback: 'Could not schedule those quizzes. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Bulk import — a file of quizzes (services/dailyQuizImportService.ts)
// ---------------------------------------------------------------------------

/**
 * The template, as CSV or JSON, dated from tomorrow so it imports as it stands. Not the JSON
 * envelope: the body is the file, as with the question bank's Excel template.
 */
router.get(
  '/admin/daily-quiz/import/template',
  IMPORT_GATE,
  validate({ query: quizTemplateQuerySchema }),
  (req: Request, res: Response) => {
    const { format } = req.query as unknown as QuizTemplateQuery;
    const body = format === 'json' ? quizTemplateJson(now()) : quizTemplateCsv(now());
    res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="amit-daily-quiz-template.${format}"`);
    // Its example dates are relative to today, so a cached copy goes stale overnight.
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.send(body);
  },
);

/**
 * Reads a file and returns the plan, row by row. Writes no question and no quiz. The
 * import limiter sits ahead of the permission check, as on the question bank's upload
 * routes: a request decompresses and validates hundreds of rows.
 */
for (const kind of QUIZ_IMPORT_KINDS) {
  router.post(
    `/admin/daily-quiz/import/${kind}`,
    importLimiter,
    IMPORT_GATE,
    validate({ body: quizImportPreviewSchema(kind) }),
    ensureDb,
    async (req: Request, res: Response) => {
      try {
        const body = req.body as QuizImportPreviewBody;
        const preview = await previewQuizImport(
          {
            kind: kind satisfies QuizImportKind,
            file: { name: body.file.name, declaredType: body.file.declaredType, data: body.file.data },
            topic: body.topic,
            difficulty: body.difficulty,
          },
          actorFrom(req),
          now(),
        );
        sendSuccess(res, 200, {
          batchId: preview.batchId,
          rows: preview.rows,
          refused: preview.refused,
          duplicates: preview.duplicates,
          failures: preview.failures,
          unknownChapters: preview.unknownChapters,
          batchWarnings: preview.batchWarnings,
          files: preview.files,
          summary: preview.summary,
        });
      } catch (err) {
        respondToServiceError(res, err, { log: `Failed to read a ${kind} Daily Quiz file`, fallback: 'Could not read that file. Please try again.' });
      }
    },
  );
}

/** Saves the approved rows to the bank as drafts and schedules each. Reported per row. */
router.post(
  '/admin/daily-quiz/import/approve',
  IMPORT_GATE,
  validate({ body: quizImportApproveSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const body = req.body as QuizImportApproveBody;
      const outcome = await approveQuizImport({ batchId: body.batchId, rows: body.rows }, actorFrom(req), now());
      const scheduled = outcome.rows.filter((row) => row.status === 'scheduled');
      const saved = outcome.rows.filter((row) => row.status !== 'refused');

      if (saved.length > 0) {
        await recordAudit(req, {
          action: 'questions.imported',
          targetType: 'question',
          targetLabel: `${saved.length} Daily Quiz question${saved.length === 1 ? '' : 's'} imported`,
          metadata: { batchId: body.batchId, submitted: body.rows.length, created: saved.length, dailyQuiz: true },
        });
      }
      if (scheduled.length > 0) {
        await recordAudit(req, {
          action: 'dailyquiz.scheduled',
          targetType: 'dailyquiz',
          targetId: 'import',
          targetLabel: `${scheduled.length} quiz${scheduled.length === 1 ? '' : 'zes'} imported`,
          metadata: {
            bulk: true,
            import: true,
            batchId: body.batchId,
            days: scheduled.map((row) => ('day' in row ? row.day : null)),
          },
        });
      }

      sendSuccess(res, 200, { rows: outcome.rows, scheduled: outcome.scheduled });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to approve a Daily Quiz import', fallback: 'Could not schedule those quizzes. Please try again.' });
    }
  },
);

// ---------------------------------------------------------------------------
// Winners — literal paths, so before `/:groupId`
// ---------------------------------------------------------------------------

/**
 * The prize desk: decided winners across every quiz, `outstanding` first — so contacting
 * a parent and delivering a prize is tracked in one place rather than day by day.
 */
router.get(
  '/admin/daily-quiz/winners',
  GATE,
  validate({ query: prizeDeskQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const query = req.query as unknown as PrizeDeskQuery;
      const { winners, total, outstanding } = await listPrizeDesk(query);
      sendSuccess(res, 200, {
        winners,
        outstanding,
        pagination: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
      });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to list Daily Quiz winners', fallback: 'Could not load the winners. Please try again.' });
    }
  },
);

router.post(
  '/admin/daily-quiz/winners/:winnerId/:action',
  GATE,
  adminActionLimiter,
  validate({ params: winnerActionParamSchema, body: winnerActionBodySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { winnerId, action } = req.params as unknown as { winnerId: string; action: WinnerAction };
      const { reason } = req.body as WinnerActionBody;
      const row = await applyWinnerAction(winnerId, action, actorFrom(req), { reason, at: now() });

      const auditAction = {
        confirm: 'dailyquiz.winner.confirmed',
        disqualify: 'dailyquiz.winner.disqualified',
        publish: 'dailyquiz.winner.published',
        contacted: 'dailyquiz.winner.contacted',
        delivered: 'dailyquiz.winner.delivered',
      } as const;
      await recordAudit(req, {
        action: auditAction[action],
        targetType: 'dailyquiz',
        targetId: String(row.groupId),
        targetLabel: `${classRangeLabel(row.classMin, row.classMax)} · ${row.day}`,
        metadata: { winner: String(row._id), student: String(row.student), status: row.status, reason: row.reason ?? null },
      });

      // Published: tell the winner on their dashboard (and by email, per their preference).
      if (action === 'publish') {
        const student = await Student.findById(row.student);
        if (student) await notifyDailyQuizWinner(row, student);
      }

      sendSuccess(res, 200, { winner: await winnerRow(row), winners: await winnersForGroup(row.groupId) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to update a Daily Quiz winner', fallback: 'Could not update that winner. Please try again.' });
    }
  },
);

// ---------------------------------------------------------------------------
// One quiz
// ---------------------------------------------------------------------------

router.get('/admin/daily-quiz/:groupId', GATE, validate({ params: groupIdParamSchema }), ensureDb, async (req: Request, res: Response) => {
  try {
    const at = now();
    const { groupId } = req.params as unknown as { groupId: string };
    const docs = await loadGroup(new Types.ObjectId(groupId));
    if (docs.length === 0) {
      sendError(res, 404, 'No Daily Quiz exists with that id.');
      return;
    }
    const first = docs[0]!;
    const id = groupIdOf(first);
    const range = rangeOf(first);
    const group = {
      _id: id,
      day: first.day,
      classLevels: docs.map((doc) => doc.classLevel),
      docIds: docs.map((doc) => doc._id as Types.ObjectId),
      classMin: range.min,
      classMax: range.max,
      question: first.question,
      content: first.content ?? null,
      source: first.source,
      createdByLabel: first.createdByLabel ?? null,
      createdAt: first.createdAt,
    };
    const [stats, winners] = await Promise.all([
      statsForGroups([{ id: String(id), docIds: group.docIds }]),
      winnersForGroup(id),
    ]);
    const summary = winners.find((row) => row.status === 'published' || row.status === 'confirmed');

    sendSuccess(res, 200, {
      quiz: adminQuizView(group, stats.get(String(id)), at, summary?.student ? { name: summary.student.name, status: summary.status } : null),
      winners,
    });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Failed to load a Daily Quiz', fallback: 'Could not load that quiz. Please try again.' });
  }
});

router.put(
  '/admin/daily-quiz/:groupId',
  GATE,
  validate({ params: groupIdParamSchema, body: changeQuizSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params as unknown as { groupId: string };
      const { questionId } = req.body as ChangeQuizBody;
      const docs = await changeQuizQuestion(groupId, questionId, actorFrom(req), now());
      const first = docs[0]!;
      const range = rangeOf(first);

      await recordAudit(req, {
        action: 'dailyquiz.updated',
        targetType: 'dailyquiz',
        targetId: String(groupIdOf(first)),
        targetLabel: `${classRangeLabel(range.min, range.max)} · ${first.day}`,
        metadata: { day: first.day, question: questionId },
      });
      sendSuccess(res, 200, { groupId: String(groupIdOf(first)) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to change a Daily Quiz', fallback: 'Could not change that quiz. Please try again.' });
    }
  },
);

router.delete(
  '/admin/daily-quiz/:groupId',
  GATE,
  validate({ params: groupIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params as unknown as { groupId: string };
      const docs = await deleteQuiz(groupId);
      const first = docs[0]!;
      const range = rangeOf(first);

      await recordAudit(req, {
        action: 'dailyquiz.deleted',
        targetType: 'dailyquiz',
        targetId: groupId,
        targetLabel: `${classRangeLabel(range.min, range.max)} · ${first.day}`,
        metadata: { day: first.day, classes: docs.map((doc) => doc.classLevel) },
      });
      sendSuccess(res, 200, { deleted: true });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to remove a Daily Quiz', fallback: 'Could not remove that quiz. Please try again.' });
    }
  },
);

/** Ranks the closed quiz's correct answers and writes the leading few as provisional. */
router.post(
  '/admin/daily-quiz/:groupId/winners/compute',
  GATE,
  adminActionLimiter,
  validate({ params: groupIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params as unknown as { groupId: string };
      const outcome = await computeWinners(groupId, now());
      const docs = await loadGroup(new Types.ObjectId(groupId));
      const first = docs[0]!;
      const id = groupIdOf(first);
      const range = rangeOf(first);

      await recordAudit(req, {
        action: 'dailyquiz.winners.computed',
        targetType: 'dailyquiz',
        targetId: String(id),
        targetLabel: `${classRangeLabel(range.min, range.max)} · ${first.day}`,
        metadata: { correctAnswers: outcome.correctCount },
      });

      sendSuccess(res, 200, { ...outcome, winners: await winnersForGroup(id) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to compute Daily Quiz winners', fallback: 'Could not compute the winners. Please try again.' });
    }
  },
);

export default router;
