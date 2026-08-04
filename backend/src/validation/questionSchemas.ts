import { z } from 'zod';

export const generateQuestionsSchema = z.object({
  classLevel: z.string().trim().min(1, 'classLevel is required'),
  subject: z.string().trim().min(1, 'subject is required'),
  topic: z.string().trim().min(1, 'topic is required'),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).default('Medium'),
  questionType: z.unknown().optional(),
  count: z.coerce.number().int('count must be a whole number').min(1, 'count must be at least 1').max(20, 'count cannot exceed 20'),
});
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;

/**
 * Query params arrive as strings under Express 5's default 'simple' parser, but
 * a repeated key (?difficulty=a&difficulty=b) still yields an array. Requiring
 * a plain string here rejects that type confusion before the value is ever used
 * to build a Mongoose filter — and keeps holding if the parser is later switched
 * to 'extended', which would reintroduce nested objects. See SECURITY.md.
 */
export const listQuestionsQuerySchema = z.object({
  classLevel: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).optional(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
});
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;
