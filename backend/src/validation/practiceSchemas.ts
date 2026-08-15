import { z } from 'zod';
import { DIFFICULTIES } from '../models/Question';

/**
 * Practice Zone request validation.
 *
 * The important property here is the same one `profileSchemas.ts` relies on: `validate`
 * replaces `req.body` with the parse result, so a field absent from a schema cannot
 * reach a handler. That is what stops a client from posting, say, `isCorrect` or
 * `score` alongside its answer and having it stored — grading is the server's job and
 * nothing a student sends is trusted as an outcome.
 */

/** A Mongo ObjectId as it appears in a URL or a filter. */
const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { message: 'That is not a valid identifier.' });

export const practiceOptionsQuerySchema = z.object({});

/**
 * Starting a session.
 *
 * `subjectId` / `topicId` / `difficulty` are all optional: "everything for my class" is
 * a legitimate choice, and difficulty only narrows further. `classLevel` is **not**
 * accepted — the paper is always drawn for the student's own class, read from their
 * account, so a Class 6 student cannot request the Class 12 paper.
 */
export const startPracticeSchema = z.object({
  subjectId: objectId.optional(),
  topicId: objectId.optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  /**
   * Bounded at both ends. The upper bound is what stops a single request from
   * snapshotting the entire question bank into one document; the lower bound keeps a
   * "session" meaningful.
   */
  questionCount: z.coerce.number().int().min(1).max(50).default(10),
});
export type StartPracticeInputBody = z.infer<typeof startPracticeSchema>;

export const practiceSessionParamSchema = z.object({ sessionId: objectId });

/**
 * Saving one answer.
 *
 * All three response shapes are optional because the handler stores only the one
 * belonging to the question's own type, and because clearing an answer — sending
 * nothing, or an empty option list — is a legitimate act a student may perform.
 */
export const saveAnswerSchema = z.object({
  questionId: objectId,
  selectedOptionKeys: z.array(z.string().trim().min(1).max(4)).max(10).optional(),
  numericResponse: z.number().finite().nullable().optional(),
  // Bounded: it is a blank to fill, not an essay box.
  textResponse: z.string().trim().max(200).nullable().optional(),
  booleanResponse: z.boolean().nullable().optional(),
});
export type SaveAnswerInput = z.infer<typeof saveAnswerSchema>;

export const listPracticeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ListPracticeQuery = z.infer<typeof listPracticeQuerySchema>;
