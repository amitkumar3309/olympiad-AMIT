import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { generateQuestionsSchema, type GenerateQuestionsInput } from '../../validation/questionSchemas';
import { createQuestion } from '../../services/questionService';
import { actorFrom } from '../../services/taxonomyService';

const router = Router();

/**
 * The "AI Question Generator".
 *
 * It is **not** AI: it fills a template string, and no LLM or AI provider is
 * integrated anywhere in this backend (see FEATURE_STATUS.md). It predates the real
 * question bank and is kept so the existing admin page keeps working, but Milestone 4
 * constrains it in two ways that matter:
 *
 *  - It must name a **real** subject and topic by id. The bank no longer accepts a
 *    free-text subject, so the generator cannot invent taxonomy that nothing else
 *    knows about.
 *  - Everything it writes is a **draft**, like any other created question. Template
 *    placeholder text can therefore never reach a student — publishing is a separate,
 *    deliberate act on each question.
 *
 * It goes through `createQuestion` rather than `insertMany` so it cannot bypass the
 * taxonomy consistency checks that hand-authored questions are held to.
 */
router.post(
  '/admin/generate-questions',
  requirePermission('questions:write'),
  validate({ body: generateQuestionsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { subject, topic, classLevel, difficulty, count } = req.body as GenerateQuestionsInput;
      const actor = actorFrom(req);

      const created = [];
      for (let index = 0; index < count; index += 1) {
        created.push(
          // Sequential rather than Promise.all: each call validates the taxonomy and
          // the count is capped at 20, so the clarity is worth more than the latency.
          await createQuestion(
            {
              questionText: `[Template draft ${index + 1}] Replace this text with a real question. Example expression: $x^2 + ${index + 1}x + 1 = 0$`,
              type: 'single_choice',
              options: [
                { key: 'a', text: 'Replace with option A', isCorrect: true },
                { key: 'b', text: 'Replace with option B', isCorrect: false },
                { key: 'c', text: 'Replace with option C', isCorrect: false },
                { key: 'd', text: 'Replace with option D', isCorrect: false },
              ],
              booleanAnswer: null,
              numericAnswer: null,
              tolerance: null,
              solution: null,
              subject,
              topic,
              subtopic: null,
              classLevel,
              difficulty,
              marks: 4,
              negativeMarks: 1,
              tags: ['template-draft'],
            },
            actor,
          ),
        );
      }

      await recordAudit(req, {
        action: 'questions.generated',
        targetType: 'question',
        targetLabel: `${count} template draft${count === 1 ? '' : 's'}`,
        metadata: { subject, topic, classLevel, difficulty, count },
      });

      sendSuccess(res, 201, {
        message: `${count} template draft${count === 1 ? '' : 's'} created. Edit each one and publish it when it is ready — nothing is visible to students yet.`,
        questions: created.map((question) => ({ id: String(question._id), questionText: question.questionText, status: question.status })),
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to generate template questions',
        fallback: 'Could not create the template drafts. Please try again.',
      });
    }
  },
);

export default router;
