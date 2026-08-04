import { Router } from 'express';
import { Question } from '../../models';
import { validate } from '../../middleware/validate';
import { listQuestionsQuerySchema, type ListQuestionsQuery } from '../../validation/questionSchemas';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { ensureDb } from '../../middleware/ensureDb';

const router = Router();

router.get('/questions', validate({ query: listQuestionsQuerySchema }), ensureDb, async (req, res) => {
  try {
    const { classLevel, subject, difficulty } = req.query as unknown as ListQuestionsQuery;
    const query: Partial<ListQuestionsQuery> = {};
    if (classLevel) query.classLevel = classLevel;
    if (subject) query.subject = subject;
    if (difficulty) query.difficulty = difficulty;

    const questions = await Question.find(query).limit(20);
    sendSuccess(res, 200, { count: questions.length, data: questions });
  } catch {
    sendError(res, 500, 'Failed to fetch questions.');
  }
});

export default router;
