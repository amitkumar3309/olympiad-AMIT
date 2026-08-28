import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { importLimiter } from '../../middleware/rateLimiter';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { actorFrom } from '../../services/taxonomyService';
import { changeQuestionStatus } from '../../services/questionService';
import {
  approveImport,
  importCeiling,
  listImportParsers,
  previewImport,
  recordImportRejections,
  validateImport,
} from '../../services/questionImportService';
import {
  MAX_IMPORT_FILES,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_REQUEST_BYTES,
} from '../../validation/uploadSchemas';
import {
  approveImportSchema,
  previewImportSchema,
  rejectImportSchema,
  validateImportSchema,
  type ApproveImportBody,
  type PreviewImportBody,
  type ValidateImportBody,
  type RejectImportBody,
} from '../../validation/importSchemas';
import { IMPORT_FILE_KINDS, type ImportFileKind } from '../../lib/importTypes';
import { buildExcelTemplate, EXCEL_TEMPLATE_FILENAME } from '../../services/excelImportParser';

/**
 * Bulk question import (Milestone 21).
 *
 * Four routes, and the division between them is the safety property: **uploading writes
 * nothing, and only approval writes.** An examiner uploads a spreadsheet or a set of
 * photographs, reads what came out, corrects it, and then saves — the same two-phase shape the
 * AI generator uses, for the same reason. Candidates live in the browser between the two calls;
 * there is deliberately no staging collection, so the bank cannot fill with machine-read text
 * nobody looked at.
 *
 * Every route is gated on `questions:write` — the permission that already means "may author
 * questions" — rather than a new one. Importing is authoring: it produces exactly the rows the
 * editor produces, and a separate permission would suggest the two could be held apart when
 * anybody who can import can also simply type a question in.
 *
 * `importLimiter` sits **ahead of the permission check** on the upload routes, exactly as
 * `generationLimiter` does on generation, because these are the two most expensive routes in
 * the product: an upload decompresses an archive and validates hundreds of rows, and the image
 * path spends provider quota *per file*. The cheapest possible rejection is the right one when a
 * request costs money, and an unauthenticated flood should not reach the database read that
 * authorization performs. It is deliberately **not** on the status, approve or reject routes:
 * the first makes no network call and runs on every page load, and the other two are ordinary
 * database writes whose cost does not scale with a third party.
 */
const router = Router();

// ---------------------------------------------------------------------------
// What the importer can be asked for, before it is asked
// ---------------------------------------------------------------------------

/**
 * The formats this deployment can actually read, and the limits on one upload.
 *
 * Serves the upload form: the ceilings live in one place on the backend, so the page cannot
 * offer to accept a file the server will refuse. `available` is per format because they fail
 * independently — Excel and DOCX are deterministic and always work, while the image path needs
 * a model credential and reports itself unconfigured without one.
 */
router.get(
  '/admin/questions/import',
  requirePermission('questions:write'),
  (_req: Request, res: Response) => {
    sendSuccess(res, 200, {
      parsers: listImportParsers().map((parser) => ({
        ...parser.descriptor,
        available: parser.isAvailable(),
      })),
      /** Where the template lives, so the page does not hardcode a path. */
      templates: { excel: '/admin/questions/import/excel/template' },
      limits: {
        maxQuestions: importCeiling(),
        maxFiles: MAX_IMPORT_FILES,
        maxFileBytes: MAX_IMPORT_FILE_BYTES,
        maxRequestBytes: MAX_IMPORT_REQUEST_BYTES,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// The Excel template
// ---------------------------------------------------------------------------

/**
 * The downloadable `.xlsx` template.
 *
 * **Generated per request rather than served as a checked-in file**, because its `Class`,
 * `Type` and `Difficulty` dropdowns are built from `CLASS_LEVELS`, `QUESTION_TYPES` and
 * `DIFFICULTIES`. A static file would go stale the moment one of those lists changed — which the
 * class list is about to, in Phase J — and a template offering a value the API refuses is worse
 * than no template.
 *
 * One of the few routes in the product that does **not** answer with the `{ success, ... }`
 * envelope, for the same reason the certificate PDF does not: the response body is the file.
 * Building it is pure CPU with no network and no database read, so it is not rate limited and
 * needs no `ensureDb`.
 */
router.get(
  '/admin/questions/import/excel/template',
  requirePermission('questions:write'),
  async (_req: Request, res: Response) => {
    try {
      const workbook = await buildExcelTemplate();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${EXCEL_TEMPLATE_FILENAME}"`);
      res.setHeader('Content-Length', String(workbook.length));
      // Regenerated from the current enums every time, so a cached copy could advertise a class
      // that no longer exists.
      res.setHeader('Cache-Control', 'private, max-age=0, no-store');
      res.send(workbook);
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to build the Excel import template',
        fallback: 'Could not build the template. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Uploading — parses, validates, de-duplicates. Writes no questions.
// ---------------------------------------------------------------------------

/**
 * One handler, registered once per format.
 *
 * A route per kind rather than a `:kind` parameter, so each one carries the **file schema for
 * its own format** through the ordinary `validate({ body })` middleware. That is what lets a
 * `.docx` posted to the Excel endpoint be refused by name ("that is a Word document") instead of
 * reaching a parser that would fail on it obscurely.
 */
function previewHandler(kind: ImportFileKind) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as PreviewImportBody;
      const outcome = await previewImport(
        {
          kind,
          files: body.files.map((file) => ({
            name: file.name,
            declaredType: file.declaredType,
            data: file.data,
          })),
          topic: body.topic,
          subtopic: body.subtopic,
          classLevel: body.classLevel,
          difficulty: body.difficulty,
          marks: body.marks,
          negativeMarks: body.negativeMarks,
          questionType: body.questionType,
        },
        actorFrom(req),
      );

      // No audit entry: nothing about the bank changed. The `ImportBatch` row records what was
      // read and why it behaved as it did, which is a diagnostic fact rather than an
      // administrative one — the same division `GenerationLog` draws against `AuditLog`.
      //
      // Spread rather than passed whole because `sendSuccess` takes an index-signature payload
      // and `PreviewOutcome` is a closed interface. Listing the fields also means a field added
      // to the outcome is not silently published to the client without a thought.
      sendSuccess(res, 200, {
        batchId: outcome.batchId,
        kind: outcome.kind,
        parser: outcome.parser,
        questions: outcome.questions,
        rejected: outcome.rejected,
        duplicates: outcome.duplicates,
        failures: outcome.failures,
        batchWarnings: outcome.batchWarnings,
        files: outcome.files,
        examined: outcome.examined,
        truncated: outcome.truncated,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: `Failed to import ${kind} questions`,
        fallback: 'Could not read those files. Please try again.',
      });
    }
  };
}

for (const kind of IMPORT_FILE_KINDS) {
  router.post(
    `/admin/questions/import/${kind}`,
    importLimiter,
    requirePermission('questions:write'),
    validate({ body: previewImportSchema(kind) }),
    ensureDb,
    previewHandler(kind),
  );
}

// ---------------------------------------------------------------------------
// Approving — the only route here that writes a question
// ---------------------------------------------------------------------------

router.post(
  '/admin/questions/import/approve',
  requirePermission('questions:write'),
  validate({ body: approveImportSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as ApproveImportBody;
      const actor = actorFrom(req);

      const outcome = await approveImport(
        { batchId: input.batchId, questions: input.questions },
        actor,
      );

      /**
       * Publishing is a **second** deliberate act, and it goes through
       * `changeQuestionStatus()` rather than writing the field — that service is where the rule
       * "a question needs a solution before it may be published" lives, and bypassing it would
       * let an import publish something the editor itself would refuse. Identical to the
       * generator's approval route, deliberately: an imported question and a generated one must
       * not be able to reach `published` by two different standards.
       */
      let published = 0;
      const publishFailures: Array<{ id: string; reason: string }> = [];
      // Keyed by id and read back below, because `outcome.created` holds the documents as they
      // were *before* publishing — reporting those would tell the examiner "draft" about a
      // question that is live, which is the one thing this response must not get wrong.
      const statusById = new Map<string, string>();

      if (input.publish) {
        for (const question of outcome.created) {
          const id = String(question._id);
          try {
            const updated = await changeQuestionStatus(id, 'published', actor);
            statusById.set(id, updated.status);
            published += 1;
          } catch (err) {
            publishFailures.push({ id, reason: err instanceof Error ? err.message : 'Could not be published.' });
          }
        }
      }

      await recordAudit(req, {
        action: 'questions.imported',
        targetType: 'question',
        targetLabel: `${outcome.created.length} imported question${outcome.created.length === 1 ? '' : 's'} approved`,
        metadata: {
          batchId: input.batchId,
          submitted: input.questions.length,
          created: outcome.created.length,
          rejected: outcome.rejected.length,
          published,
        },
      });

      sendSuccess(res, 201, {
        questions: outcome.created.map((question) => ({
          id: String(question._id),
          questionText: question.questionText,
          type: question.type,
          classLevel: question.classLevel,
          status: statusById.get(String(question._id)) ?? question.status,
        })),
        rejected: outcome.rejected,
        published,
        publishFailures,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to approve imported questions',
        fallback: 'Could not save those questions. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Rejecting — records a count and nothing else
// ---------------------------------------------------------------------------

/**
 * Discarding candidates.
 *
 * **Deletes nothing, because nothing was stored.** It increments a counter on the import batch
 * and returns. It exists because "the examiner threw a hundred and eighty of two hundred away"
 * is the only honest measure of whether a template or a batch of photographs is usable, and it
 * is invisible everywhere else in the system.
 *
 * No audit entry, for the same reason as uploading: the bank did not change.
 */
/**
 * A dry run over the reviewer's corrections. **Writes nothing.**
 *
 * Calls the same `screenEach()` approval calls, which is the entire point: its answer *is* the
 * answer approval will give, and a check that passed where the save would fail would be worse than
 * no check at all.
 *
 * Deliberately **not** rate limited and carrying no `batchId`: it spends no provider quota, makes
 * no network call and writes not even a log row, so an examiner should be able to check their
 * corrections as often as they like — precisely so they are not pressing Approve to find out. Two
 * hundred imported questions is a lot of editing, and that is exactly when finding out late is
 * expensive.
 */
router.post(
  '/admin/questions/import/validate',
  requirePermission('questions:write'),
  validate({ body: validateImportSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const body = req.body as ValidateImportBody;
      const outcome = await validateImport({
        questions: body.questions.map((question) => ({
          questionText: question.questionText,
          type: question.type,
          options: question.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
          booleanAnswer: question.booleanAnswer ?? null,
          numericAnswer: question.numericAnswer ?? null,
          tolerance: question.tolerance ?? null,
          acceptedAnswers: question.acceptedAnswers,
          solution: question.solution ?? null,
          marks: question.marks,
          negativeMarks: question.negativeMarks,
          tags: question.tags,
          topic: question.topic,
          subtopic: question.subtopic ?? null,
          classLevel: question.classLevel,
          difficulty: question.difficulty,
        })),
      });

      // No audit entry, for the same reason as the generator's dry run: nothing happened.
      sendSuccess(res, 200, {
        verdicts: outcome.verdicts,
        batchWarnings: outcome.batchWarnings,
        wouldSave: outcome.wouldSave,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to validate an import batch',
        fallback: 'Could not check those questions. Please try again.',
      });
    }
  },
);

router.post(
  '/admin/questions/import/reject',
  requirePermission('questions:write'),
  validate({ body: rejectImportSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as RejectImportBody;
      await recordImportRejections(input.batchId, input.count);
      sendSuccess(res, 200, { recorded: input.count });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to record import rejections',
        fallback: 'Could not record that. Please try again.',
      });
    }
  },
);

export default router;
