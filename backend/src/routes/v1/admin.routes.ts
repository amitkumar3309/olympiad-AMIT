import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { generationLimiter } from '../../middleware/rateLimiter';
import {
  generateQuestionsSchema,
  approveQuestionsSchema,
  validateQuestionsSchema,
  rejectQuestionsSchema,
  type GenerateQuestionsInput,
  type ApproveQuestionsInput,
  type ValidateQuestionsInput,
  type RejectQuestionsInput,
} from '../../validation/questionSchemas';
import {
  proposeQuestions,
  approveQuestions,
  validateProposals,
  recordReviewerRejections,
  listQuestionGenerators,
  resolveQuestionGenerator,
} from '../../services/questionGeneratorService';
import { changeQuestionStatus } from '../../services/questionService';
import { actorFrom } from '../../services/taxonomyService';
import { BLOOM_LEVELS, GENERATION_LANGUAGES } from '../../lib/questionGeneratorTypes';
import { listAvailableModels } from '../../services/geminiQuestionGenerator';
import { config } from '../../config';

const router = Router();

/**
 * AI question generation — proposing, and then approving (Milestone 18).
 *
 * ## Two routes, because nothing may be saved without approval
 *
 * `POST /admin/generate-questions` asks the model and returns candidates. **It writes no
 * questions.** The only thing it persists is a generation log row, which records counts
 * and parameters so a bad prompt can be diagnosed later.
 *
 * `POST /admin/generate-questions/approve` is the only path that writes to the bank. It
 * re-validates everything it is sent, because what arrives is whatever the review screen
 * submitted — the examiner's edits included — and an edited candidate is untrusted input
 * exactly as the model's original was.
 *
 * Two more routes exist and neither of them writes a question. `/validate` is a **dry run**
 * over the reviewer's edited batch, answering "would this save?" through the same screening
 * function approval uses — so the answer is not an approximation of the save, it is the
 * save's own verdict. `/reject` records that candidates were thrown away, which is the one
 * fact about a run nothing else could recover: without it the log shows twenty proposed and
 * is silent about the examiner having kept two.
 *
 * ## Regenerating one question is this same route
 *
 * There is deliberately no `/regenerate` endpoint. Asking for a replacement is asking for
 * one question with the batch's own constraints and the texts already on screen in
 * `exclude` — which is `POST /admin/generate-questions` with `count: 1`. A second endpoint
 * would be a second copy of the generation path, and it would be the copy that quietly
 * missed a validation step.
 *
 * Milestone 17 saved generated questions immediately as drafts. That was defensible (a
 * draft is not student-visible) but it filled the bank with machine output nobody had
 * read, and made "delete the bad ones" the reviewer's job rather than "keep the good
 * ones". The template generator went with it: a blank placeholder was only ever useful
 * as something to type into.
 *
 * ## Why this is safe to point a model at
 *
 * All four properties live in `services/questionGeneratorService.ts` rather than here,
 * so a second caller could not skip them: the **taxonomy comes from this request**, not
 * from the model; every candidate passes **`createQuestionSchema`**, the same schema and
 * the same `validateMathContent()` a hand-authored question passes; near-duplicates are
 * **refused**; and a failure is **reported, never repaired**.
 */

/**
 * What the generator can be asked for, before it is asked.
 *
 * Serves the review screen's form: the enums live in one place on the backend, so the
 * page cannot offer a Bloom's level or a language the prompt does not understand.
 */
router.get(
  '/admin/question-generator',
  requirePermission('questions:write'),
  ensureDb,
  (_req: Request, res: Response) => {
    const generator = resolveQuestionGenerator();
    sendSuccess(res, 200, {
      generator: generator.descriptor,
      available: generator.isAvailable(),
      bloomLevels: BLOOM_LEVELS,
      languages: GENERATION_LANGUAGES,
      providers: listQuestionGenerators().map((entry) => ({ ...entry.descriptor, available: entry.isAvailable() })),
    });
  },
);

/**
 * Which models this API key can actually use.
 *
 * A separate route from the status one because it makes a real network call, and the
 * status endpoint runs on every page load. It exists because model names are retired on
 * the provider's schedule — the original default stopped existing mid-deployment — and
 * the only authoritative answer to "what should I put in `GEMINI_MODEL`?" is the key's
 * own. A table in a doc goes stale; this cannot.
 */
router.get(
  '/admin/question-generator/models',
  requirePermission('questions:write'),
  ensureDb,
  async (_req: Request, res: Response) => {
    try {
      sendSuccess(res, 200, { configured: config.ai.geminiModel, models: await listAvailableModels() });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to list Gemini models',
        fallback: 'Could not ask Google which models your key can use.',
      });
    }
  },
);

/**
 * `generationLimiter` sits ahead of the permission check on purpose — it is the only route
 * in the product whose every call spends **provider quota**, so the cheapest possible
 * rejection is the right one, and an unauthenticated flood should never reach the database
 * read that authorization performs.
 */
router.post(
  '/admin/generate-questions',
  generationLimiter,
  requirePermission('questions:write'),
  validate({ body: generateQuestionsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as GenerateQuestionsInput;

      const outcome = await proposeQuestions(
        {
          subject: input.subject,
          chapters: input.chapters,
          subtopic: input.subtopic,
          classLevel: input.classLevel,
          difficulty: input.difficulty,
          questionType: input.questionType,
          language: input.language,
          bloomLevel: input.bloomLevel ?? null,
          count: input.count,
          marks: input.marks,
          negativeMarks: input.negativeMarks,
          optionCount: input.optionCount,
          instructions: input.instructions,
          model: input.model,
          exclude: input.exclude,
        },
        actorFrom(req),
      );

      // No audit entry here, deliberately: nothing was changed. Proposing is a read of
      // a model, and the generation log already records that it happened. The audit
      // trail records the *approval*, which is the act that alters the bank.
      sendSuccess(res, 200, {
        generator: outcome.generator,
        model: outcome.model,
        questions: outcome.questions,
        rejected: outcome.rejected,
        duplicates: outcome.duplicates,
        batchWarnings: outcome.batchWarnings,
        requested: outcome.requested,
        logId: outcome.logId,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to generate questions',
        fallback: 'Could not generate questions. Please try again.',
      });
    }
  },
);

router.post(
  '/admin/generate-questions/approve',
  requirePermission('questions:write'),
  validate({ body: approveQuestionsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as ApproveQuestionsInput;
      const actor = actorFrom(req);

      const outcome = await approveQuestions(
        {
          subject: input.subject,
          topic: input.topic,
          subtopic: input.subtopic,
          classLevel: input.classLevel,
          difficulty: input.difficulty,
          publish: input.publish,
          questions: input.questions.map((question) => ({
            ...question,
            booleanAnswer: question.booleanAnswer ?? null,
            numericAnswer: question.numericAnswer ?? null,
            tolerance: question.tolerance ?? null,
            solution: question.solution ?? null,
          })),
          logId: input.logId,
        },
        actor,
      );

      /**
       * Publishing is a **second** deliberate act even here, and it goes through
       * `changeQuestionStatus()` rather than writing the field: that service is where
       * the rule "a question needs a solution before it may be published" lives, and
       * bypassing it would let approval publish something the editor would refuse.
       */
      let published = 0;
      const publishFailures: Array<{ id: string; reason: string }> = [];
      // Keyed by id and read back below, because `outcome.created` holds the documents
      // as they were *before* publishing — reporting those would tell the examiner
      // "draft" about a question that is live, which is the one thing this response
      // must not get wrong.
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
        action: 'questions.generated',
        targetType: 'question',
        targetLabel: `${outcome.created.length} AI-generated question${outcome.created.length === 1 ? '' : 's'} approved`,
        metadata: {
          subject: input.subject,
          topic: input.topic,
          subtopic: input.subtopic ?? null,
          classLevel: input.classLevel,
          difficulty: input.difficulty,
          // `count` keeps its historical name: the audit trail is append-only and has
          // no TTL, so renaming a key splits every query over it into before and after.
          count: input.questions.length,
          created: outcome.created.length,
          rejected: outcome.rejected.length,
          published,
          generator: 'gemini',
          generatorKind: 'model',
        },
      });

      sendSuccess(res, 201, {
        message: messageFor(outcome.created.length, outcome.rejected.length, published, input.publish),
        questions: outcome.created.map((question) => ({
          id: String(question._id),
          questionText: question.questionText,
          type: question.type,
          status: statusById.get(String(question._id)) ?? question.status,
        })),
        rejected: outcome.rejected,
        published,
        publishFailures,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to approve generated questions',
        fallback: 'Could not save those questions. Please try again.',
      });
    }
  },
);

/**
 * The dry run: would this batch save?
 *
 * Not rate-limited, and that is the point of it existing — it makes **no provider call**,
 * only a schema pass and one indexed read of the bank. An examiner should be able to check
 * their edits as often as they like, precisely so they are not pressing Approve to find
 * out.
 *
 * It writes nothing, so there is no audit entry: nothing happened.
 */
router.post(
  '/admin/generate-questions/validate',
  requirePermission('questions:write'),
  validate({ body: validateQuestionsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as ValidateQuestionsInput;
      const outcome = await validateProposals({
        subject: input.subject,
        topic: input.topic,
        subtopic: input.subtopic,
        classLevel: input.classLevel,
        difficulty: input.difficulty,
        questions: input.questions.map((question) => ({
          ...question,
          booleanAnswer: question.booleanAnswer ?? null,
          numericAnswer: question.numericAnswer ?? null,
          tolerance: question.tolerance ?? null,
          solution: question.solution ?? null,
        })),
      });

      sendSuccess(res, 200, {
        verdicts: outcome.verdicts,
        batchWarnings: outcome.batchWarnings,
        wouldSave: outcome.wouldSave,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to validate generated questions',
        fallback: 'Could not check those questions. Please try again.',
      });
    }
  },
);

/**
 * Discarding candidates.
 *
 * There is nothing to delete — nothing was ever stored — so this records a count against
 * the generation log and returns. It exists because "the examiner threw eighteen of twenty
 * away" is the only honest measure of whether a prompt configuration works, and it is
 * invisible everywhere else in the system.
 *
 * No audit entry, for the same reason as generating: the bank did not change.
 */
router.post(
  '/admin/generate-questions/reject',
  requirePermission('questions:write'),
  validate({ body: rejectQuestionsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as RejectQuestionsInput;
      await recordReviewerRejections(input.logId, input.count);
      sendSuccess(res, 200, { recorded: input.count });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to record rejected questions',
        fallback: 'Could not record that. The questions were discarded either way — nothing was saved.',
      });
    }
  },
);

/**
 * What really happened, including the parts nobody wants to report.
 *
 * A reviewer who sees fewer questions than they approved, with no explanation, will
 * conclude the feature is broken and try again — the same reasoning behind the
 * "60 queued, 12 skipped" wording on an email broadcast.
 */
function messageFor(created: number, rejected: number, published: number, wantedPublish: boolean): string {
  const parts = [`${created} question${created === 1 ? '' : 's'} saved.`];

  if (rejected > 0) {
    parts.push(`${rejected} could not be saved and ${rejected === 1 ? 'is' : 'are'} listed below.`);
  }

  if (wantedPublish) {
    parts.push(
      published === created
        ? 'They are published and visible to students now.'
        : `${published} published; the rest stayed as drafts and need a solution before they can go live.`,
    );
  } else {
    parts.push('They are drafts — publish each one from the question bank when you are ready.');
  }

  return parts.join(' ');
}

export default router;
