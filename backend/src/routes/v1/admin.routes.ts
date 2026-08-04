import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { Question } from '../../models';
import { validate } from '../../middleware/validate';
import { generateQuestionsSchema, type GenerateQuestionsInput } from '../../validation/questionSchemas';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { ensureDb } from '../../middleware/ensureDb';

const router = Router();

/**
 * NOTE: this generates template-string placeholder questions, not real AI
 * output — no AI/LLM provider is integrated anywhere in this backend. See
 * FEATURE_STATUS.md. Kept as-is (not a "fake business API" introduced by
 * this milestone — it already existed; only moved + validated here).
 */
router.post('/admin/generate-questions', requireAuth('admin'), validate({ body: generateQuestionsSchema }), ensureDb, async (req, res) => {
  try {
    const { classLevel, subject, topic, difficulty, count } = req.body as GenerateQuestionsInput;

    const aiGeneratedQuestions = Array.from({ length: count }, (_, i) => ({
      questionText: `(${subject} - ${classLevel}) What is the advanced solution for ${topic}? [Sample ${i + 1}]`,
      options: [
        `Option A: Correct answer for ${topic}`,
        `Option B: Alternate derived method`,
        `Option C: Common calculation trap`,
        `Option D: None of the above`,
      ],
      correctAnswer: `Option A: Correct answer for ${topic}`,
      classLevel,
      subject,
      difficulty,
    }));

    const savedQuestions = await Question.insertMany(aiGeneratedQuestions);
    sendSuccess(res, 200, { message: `${count} questions successfully generated!`, data: savedQuestions });
  } catch {
    sendError(res, 500, 'Failed to generate AI questions.');
  }
});

export default router;
