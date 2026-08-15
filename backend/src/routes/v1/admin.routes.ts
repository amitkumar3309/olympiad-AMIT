import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { generateQuestionsSchema, type GenerateQuestionsInput } from '../../validation/questionSchemas';
import {
  generateQuestionDrafts,
  listQuestionGenerators,
  resolveQuestionGenerator,
  type GenerationOutcome,
} from '../../services/questionGeneratorService';
import { actorFrom } from '../../services/taxonomyService';

const router = Router();

/**
 * The admin "generate questions" button.
 *
 * ## What changed in Milestone 17
 *
 * It used to fill a template string, and the page said so, because calling that AI
 * would have been a lie. It can now be backed by a real language model (Google Gemini),
 * and the honesty rule is unchanged rather than relaxed: the response names the
 * generator that actually ran and its `kind` (`template` or `model`), the page prints
 * it, and the audit entry records it — so "was this question written by a machine?"
 * stays answerable years from now.
 *
 * ## Why this is safe to point a model at
 *
 * Four properties, all enforced in `services/questionGeneratorService.ts` rather than
 * here, so a second caller could not skip them:
 *
 *  - **The taxonomy comes from this request, not from the model.** A generated
 *    candidate has no subject/topic/class/difficulty field to carry, so nothing can be
 *    filed under a topic nobody asked for — the Milestone 4 property, kept.
 *  - **Every candidate passes `createQuestionSchema`** — the same schema a hand-authored
 *    question passes, including `validateMathContent()`. There is no model-specific
 *    validator to be the weaker of two.
 *  - **A failure is reported, never repaired.** Rejected candidates come back with their
 *    reasons; silently fixing a model's output is how a plausible-looking wrong answer
 *    key gets stored.
 *  - **Everything is a draft.** `createQuestion()` has no other mode, so nothing a
 *    generator writes can reach a student without a human publishing it.
 *
 * With no `GEMINI_API_KEY` configured the template generator runs, which is the
 * supported default and needs no credential, no network and no paid service.
 */
router.post(
  '/admin/generate-questions',
  requirePermission('questions:write'),
  validate({ body: generateQuestionsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { subject, topic, classLevel, difficulty, count, instructions } = req.body as GenerateQuestionsInput;

      const outcome = await generateQuestionDrafts(
        { subject, topic, classLevel, difficulty, count, instructions },
        actorFrom(req),
      );

      await recordAudit(req, {
        action: 'questions.generated',
        targetType: 'question',
        targetLabel: `${outcome.created.length} draft${outcome.created.length === 1 ? '' : 's'} via ${outcome.generator.id}`,
        // `generator` and `generatorKind` are recorded deliberately: whether a question
        // was machine-drafted is exactly the sort of thing nobody thinks to record
        // until somebody asks.
        metadata: {
          subject,
          topic,
          classLevel,
          difficulty,
          // `count` keeps its original name and meaning (how many were asked for).
          // The audit trail is append-only history and has no TTL, so renaming a key
          // would split every query over it into "before" and "after" — rows written
          // by earlier milestones carry `count`, and they are the same fact.
          count,
          created: outcome.created.length,
          rejected: outcome.rejected.length,
          generator: outcome.generator.id,
          generatorKind: outcome.generator.kind,
        },
      });

      sendSuccess(res, 201, {
        message: messageFor(outcome),
        generator: outcome.generator,
        requested: outcome.requested,
        rejected: outcome.rejected,
        notes: outcome.notes,
        questions: outcome.created.map((question) => ({
          id: String(question._id),
          questionText: question.questionText,
          type: question.type,
          status: question.status,
        })),
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to generate question drafts',
        fallback: 'Could not create the drafts. Please try again.',
      });
    }
  },
);

/**
 * Which generator the button will use, before it is pressed.
 *
 * Exists so the page can state plainly whether AI drafting is configured rather than
 * leaving an administrator to infer it from the results. "Is this on?" should not be a
 * question you answer by trying it — especially when the answer depends on an
 * environment variable they set on a different website.
 */
router.get(
  '/admin/question-generator',
  requirePermission('questions:write'),
  ensureDb,
  (_req: Request, res: Response) => {
    const generator = resolveQuestionGenerator();
    sendSuccess(res, 200, {
      generator: generator.descriptor,
      // Resolution happens per request, so a key added and redeployed takes effect
      // without anything here being restarted or invalidated.
      available: generator.isAvailable(),
      alternatives: listQuestionGenerators().map((entry) => ({
        ...entry.descriptor,
        available: entry.isAvailable(),
      })),
    });
  },
);

/**
 * One sentence covering what really happened — including the parts nobody wants to
 * report: a fallback, and discarded candidates.
 *
 * Staff who see a smaller number than they asked for with no explanation will conclude
 * the feature is broken and press the button again. Same reasoning as the "60 queued,
 * 12 skipped" wording on an email broadcast.
 */
function messageFor(outcome: GenerationOutcome): string {
  const made = outcome.created.length;
  const parts = [`${made} draft${made === 1 ? '' : 's'} created by ${outcome.generator.label}.`];

  if (outcome.rejected.length > 0) {
    parts.push(
      `${outcome.rejected.length} of the ${outcome.requested} requested ` +
        `${outcome.rejected.length === 1 ? 'was' : 'were'} discarded for not meeting the question rules.`,
    );
  }

  const failure = outcome.notes.find((note) => note.startsWith('generator-failed:'));
  if (failure) {
    parts.push(
      `The configured generator failed, so blank templates were used instead — ${failure.slice('generator-failed:'.length)}`,
    );
  }

  if (made > 0) parts.push('Nothing is visible to students until you review and publish each one.');

  return parts.join(' ');
}

export default router;
