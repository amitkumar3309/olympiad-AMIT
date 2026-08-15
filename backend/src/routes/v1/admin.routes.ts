import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import {
  generateQuestionsSchema,
  approveQuestionsSchema,
  type GenerateQuestionsInput,
  type ApproveQuestionsInput,
} from '../../validation/questionSchemas';
import {
  proposeQuestions,
  approveQuestions,
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

router.post(
  '/admin/generate-questions',
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
          exclude: input.exclude,
        },
        actorFrom(req),
      );

      // No audit entry here, deliberately: nothing was changed. Proposing is a read of
      // a model, and the generation log already records that it happened. The audit
      // trail records the *approval*, which is the act that alters the bank.
      sendSuccess(res, 200, {
        generator: outcome.generator,
        questions: outcome.questions,
        rejected: outcome.rejected,
        duplicates: outcome.duplicates,
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
