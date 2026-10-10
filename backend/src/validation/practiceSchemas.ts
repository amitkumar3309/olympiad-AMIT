import { z } from 'zod';

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
 * How many questions a practice test may have — the owner's four sizes (2026-10-09).
 *
 * `GET /practice/options` publishes this list and the page offers exactly it, so the page
 * cannot offer a size the schema below refuses. The largest is also what stops one request
 * from snapshotting the whole question bank into a single session document.
 */
export const PRACTICE_TEST_SIZES = [10, 20, 30, 40] as const;
export type PracticeTestSize = (typeof PRACTICE_TEST_SIZES)[number];

const SIZES_IN_WORDS = `${PRACTICE_TEST_SIZES.slice(0, -1).join(', ')} or ${PRACTICE_TEST_SIZES[PRACTICE_TEST_SIZES.length - 1]}`;

/**
 * Starting a practice test.
 *
 * A practice test is a random mix of the questions published for the student's own class
 * (owner, 2026-10-09), so its size is the only thing a student chooses. There is no chapter,
 * difficulty or subject field: one sent by an older page is dropped by the parse like any other
 * unknown field, and the student gets a mixed test rather than an error. `classLevel` is not
 * accepted either — the paper is always drawn for the class on the student's account, so a
 * Class 6 student cannot request the Class 12 paper.
 */
export const startPracticeSchema = z.object({
  questionCount: z.coerce
    .number()
    .int()
    .refine((value) => (PRACTICE_TEST_SIZES as readonly number[]).includes(value), {
      message: `Choose ${SIZES_IN_WORDS} questions.`,
    })
    .default(PRACTICE_TEST_SIZES[0]),
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
