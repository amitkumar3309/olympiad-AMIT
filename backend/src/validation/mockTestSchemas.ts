import { z } from 'zod';
import mongoose from 'mongoose';
import { CLASS_LEVELS } from '../lib/classLevels';
import { MOCK_TEST_STATUSES, RESULT_DISPLAY_MODES, REVIEW_POLICIES } from '../models/MockTest';

/**
 * Mock-test request validation (Milestone 7).
 *
 * The property everything here leans on is the one `practiceSchemas.ts` documents:
 * `validate` **replaces** `req.body` with the parse result, so a field absent from a
 * schema cannot reach a handler at all. That is what makes it safe for the attempt
 * routes to accept an answer without also having to strip a `score`, an `isCorrect`
 * or an `expiresAt` that a client might have posted alongside it. Grading and timing
 * are the server's, and nothing a student sends is trusted as either.
 *
 * Two cross-field rules are enforced here rather than in the service, because they
 * are properties of a *request* and a clear 400 is the right answer to both:
 *
 *  - a closing time must be after the opening time, and
 *  - a disclosure setting of `after_close` requires a closing time to exist, since
 *    otherwise it would silently mean "never" and an author would believe they had
 *    scheduled a release that can never happen.
 */

const objectId = z
  .string()
  .trim()
  .refine((value) => mongoose.isValidObjectId(value), { message: 'That is not a valid identifier.' });

/** A date/time as a client sends it: an ISO 8601 string, or null for "unset". */
const dateTimeInput = z
  .string()
  .trim()
  .datetime({ offset: true, message: 'Use an ISO date and time, e.g. 2026-09-01T10:00:00Z.' })
  .nullable();

/**
 * One question on the paper.
 *
 * `marks` and `negativeMarks` are per-test values, so they are accepted here rather
 * than read from the bank: the same question may be worth more on a harder paper. The
 * bounds match `Question`'s own, so a test cannot price a question outside the range
 * the bank considers valid. `negativeMarks` is checked against `marks` in the service,
 * where the question's own limits are also known.
 */
const testQuestionInput = z.object({
  question: objectId,
  marks: z.number().min(0.25, 'A question must be worth at least 0.25 marks').max(100),
  negativeMarks: z.number().min(0, 'Negative marking is a magnitude, so it cannot be below 0').max(100).default(0),
});

const mockTestBody = z.object({
  title: z.string().trim().min(4, 'Give the test a title of at least 4 characters').max(200),
  description: z.string().trim().max(2000).nullable().default(null),
  /**
   * Free text shown before the student starts. Allowed to contain LaTeX islands like a
   * question, because instructions legitimately mention formulas — and it is rendered
   * through `MathText`, never through an HTML sink.
   */
  instructions: z.string().trim().max(5000).nullable().default(null),
  classLevel: z.enum(CLASS_LEVELS),
  /**
   * Bounded at both ends. At least one question, because an empty paper is not a
   * test; at most 100, which is what stops one document from snapshotting an
   * unbounded slice of the bank into every attempt of it.
   */
  questions: z
    .array(testQuestionInput)
    .min(1, 'A test needs at least one question')
    .max(100, 'A test can hold at most 100 questions')
    .refine(
      (list) => new Set(list.map((entry) => entry.question)).size === list.length,
      'The same question cannot appear twice on one test.',
    ),
  durationMinutes: z
    .number()
    .int('The duration must be a whole number of minutes')
    .min(1, 'The duration must be at least 1 minute')
    .max(600, 'The duration cannot exceed 600 minutes'),
  availableFrom: dateTimeInput.default(null),
  availableTo: dateTimeInput.default(null),
  maxAttempts: z
    .number()
    .int()
    .min(1, 'A test must allow at least one attempt')
    .max(10, 'A test can allow at most 10 attempts')
    .default(1),
  resultDisplay: z.enum(RESULT_DISPLAY_MODES).default('immediate'),
  /**
   * Defaults to `immediate` — not because it is the better policy (for a scheduled
   * assessment it is not; `after_close` is, since revealing the key while the window
   * is open lets the first student to sit the paper hand the answers to everyone who
   * has not) but because it is the only value that cannot be invalid on its own. The
   * refinements below require a closing time whenever a disclosure setting is
   * `after_close`, so defaulting to `after_close` would make an otherwise complete
   * request fail on a field the author never sent.
   */
  reviewPolicy: z.enum(REVIEW_POLICIES).default('immediate'),
});

/** The body plus the two cross-field rules. Used for both create and update. */
const mockTestBodyChecked = mockTestBody
  .refine(
    (value) =>
      !value.availableFrom || !value.availableTo || new Date(value.availableTo) > new Date(value.availableFrom),
    { path: ['availableTo'], message: 'The closing time must be after the opening time.' },
  )
  .refine((value) => value.resultDisplay !== 'after_close' || value.availableTo !== null, {
    path: ['resultDisplay'],
    message: 'Showing results after the test closes requires a closing time.',
  })
  .refine((value) => value.reviewPolicy !== 'after_close' || value.availableTo !== null, {
    path: ['reviewPolicy'],
    message: 'Releasing answers after the test closes requires a closing time.',
  });

export const createMockTestSchema = mockTestBodyChecked;
export type CreateMockTestInput = z.infer<typeof createMockTestSchema>;

/**
 * An update sends the whole test, like a question edit does. A patch-style partial
 * would make "remove every question but one" and "do not touch the questions"
 * indistinguishable on the wire.
 */
export const updateMockTestSchema = mockTestBodyChecked;

export const mockTestStatusSchema = z.object({
  status: z.enum(MOCK_TEST_STATUSES),
  /** Optional note recorded in the audit trail — e.g. why a live test was pulled. */
  reason: z.string().trim().max(300).optional(),
});
export type MockTestStatusInput = z.infer<typeof mockTestStatusSchema>;

export const mockTestIdParamSchema = z.object({ id: objectId });
export const attemptIdParamSchema = z.object({ attemptId: objectId });

export const listMockTestsAdminQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(MOCK_TEST_STATUSES).optional(),
  classLevel: z.enum(CLASS_LEVELS).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type ListMockTestsAdminQuery = z.infer<typeof listMockTestsAdminQuerySchema>;

export const listAttemptsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ListAttemptsQuery = z.infer<typeof listAttemptsQuerySchema>;

/**
 * Saving one answer. Identical in shape to the practice equivalent, deliberately:
 * the four answer shapes are the bank's, not the surface's, and all three response
 * fields are optional because clearing an answer is a legitimate act.
 */
export const saveAttemptAnswerSchema = z.object({
  questionId: objectId,
  selectedOptionKeys: z.array(z.string().trim().min(1).max(4)).max(10).optional(),
  numericResponse: z.number().finite().nullable().optional(),
  // Bounded: it is a blank to fill, not an essay box.
  textResponse: z.string().trim().max(200).nullable().optional(),
  booleanResponse: z.boolean().nullable().optional(),
});
export type SaveAttemptAnswerInput = z.infer<typeof saveAttemptAnswerSchema>;
