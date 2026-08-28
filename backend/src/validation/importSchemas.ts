import { z } from 'zod';
import mongoose from 'mongoose';
import { CLASS_LEVELS } from '../lib/classLevels';
import { DIFFICULTIES, QUESTION_TYPES } from '../models/Question';
import { importFilesSchema } from './uploadSchemas';
import type { ImportFileKind } from '../lib/importTypes';
import { IMPORT_HARD_MAX } from '../services/questionImportService';
import { config } from '../config';
import { validateMathContent } from '../lib/mathContent';

/**
 * Request validation for the bulk question importer (Milestone 21).
 *
 * Two things are deliberately **absent** from every schema here, and their absence is the
 * point — `validate` replaces `req.body` with the parse result, so a field no schema mentions
 * cannot reach a handler:
 *
 *  - **`subject`.** There is no user-facing subject in this product (see the Milestone 21 ADR
 *    on the Mathematics-only scope), and the topic already records which subject it belongs to.
 *    Accepting both would admit a pair that disagrees; deriving it means there is nothing to
 *    remove later and nothing to get wrong now.
 *  - **`source` and every other provenance field.** How a question entered the bank is read
 *    back from the `ImportBatch` row we ourselves wrote, never from the body. It is the one
 *    field worth lying about: a client that could set it could file questions a model read off
 *    a photograph as hand-written ones.
 */

const objectId = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .refine((v) => mongoose.isValidObjectId(v), `${label} must be a valid id`);

/**
 * Author-supplied text that may contain LaTeX, validated exactly as the question editor's is.
 *
 * A local copy of the helper in `questionSchemas.ts` rather than an export from it, because the
 * two files would otherwise import each other — this module needs `IMPORT_HARD_MAX` from the
 * import service, which needs `createQuestionSchema`. The *rule* is not duplicated: both call
 * the same `validateMathContent()`, which is where the math grammar lives, and the real gate on
 * an approved question is `createQuestionSchema` itself, applied by the service.
 */
const mathText = (label: string, { min = 1, max = 5000 }: { min?: number; max?: number } = {}) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`)
    .superRefine((value, ctx) => {
      const problem = validateMathContent(value, label);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    });

/** The defaults an examiner sets once for the upload, for rows that do not say. */
const importDefaults = {
  /**
   * The chapter rows are filed under unless a row names its own. Required: a question must
   * belong somewhere, and there is no sensible default chapter to invent.
   */
  topic: objectId('Chapter'),
  subtopic: objectId('Subtopic').nullish().default(null),
  classLevel: z.enum(CLASS_LEVELS, { message: 'Choose a class' }),
  difficulty: z.enum(DIFFICULTIES).default('Medium'),
  /**
   * The answer shape to assume when a file does not label one.
   *
   * `null` means "work it out from the row" — a row with four option columns is a choice
   * question whatever the file calls it. A parser that cannot tell reports the row as needing
   * review rather than guessing.
   */
  questionType: z.enum(QUESTION_TYPES).nullish().default(null),
  marks: z.number().min(0.25).max(100).default(4),
  negativeMarks: z.number().min(0).max(100).default(0),
};

/** Uploading files of one kind for preview. Nothing is saved by this request. */
export function previewImportSchema(kind: ImportFileKind) {
  return z
    .object({
      ...importDefaults,
      files: importFilesSchema(kind),
    })
    .refine((value) => value.negativeMarks <= value.marks, {
      path: ['negativeMarks'],
      message: 'Negative marks cannot exceed the marks awarded.',
    });
}

export type PreviewImportBody = z.infer<ReturnType<typeof previewImportSchema>>;

/**
 * One reviewed question on its way to being saved.
 *
 * Carries its **own** placement, unlike the generator's approval schema where the taxonomy
 * arrives once for the batch. The reason the two differ is not a relaxed rule but a different
 * threat: there, the batch-wide taxonomy stops a *model* scattering questions across the
 * syllabus; here, a human reviewer picked each row's chapter on the review screen, and every id
 * is still checked by `resolveTaxonomy()` at write time — which refuses a topic outside the
 * subject, a subtopic outside the topic and an archived either. A client can choose an existing
 * placement; it cannot invent one.
 */
const reviewedImportQuestion = z.object({
  questionText: mathText('Question text'),
  type: z.enum(QUESTION_TYPES),
  options: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .regex(/^[a-z]$/, 'Option keys must be a single lowercase letter')
          .optional(),
        text: mathText('Option text', { max: 2000 }),
        isCorrect: z.boolean().default(false),
      }),
    )
    .max(8)
    .default([]),
  booleanAnswer: z.boolean().nullish().default(null),
  numericAnswer: z.number().finite().nullish().default(null),
  tolerance: z.number().min(0).finite().nullish().default(null),
  acceptedAnswers: z.array(mathText('Accepted answer', { max: 200 })).max(8).default([]),
  solution: mathText('Solution', { max: 8000 }).nullish().default(null),
  marks: z.number().min(0.25).max(100),
  negativeMarks: z.number().min(0).max(100).default(0),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),

  // --- Where this one goes ---
  topic: objectId('Chapter'),
  subtopic: objectId('Subtopic').nullish().default(null),
  classLevel: z.enum(CLASS_LEVELS, { message: 'Choose a class' }),
  difficulty: z.enum(DIFFICULTIES).default('Medium'),

  /** The screen's own report that the examiner changed this one. Recorded, never trusted. */
  edited: z.boolean().default(false),
});

/** The most questions one approval call may carry. Honours the deployment's lower limit. */
function approvalCeiling(): number {
  return Math.min(IMPORT_HARD_MAX, config.imports.maxQuestions);
}

export const approveImportSchema = z.object({
  /**
   * The batch this came from. Required, and the only thing the client tells us about
   * provenance — everything else is read back from the row.
   */
  batchId: objectId('Import'),
  /** Publish straight away, or keep as drafts for a second pass. The reviewer decides. */
  publish: z.boolean().default(false),
  questions: z
    .array(reviewedImportQuestion)
    .min(1, 'Approve at least one question')
    .max(approvalCeiling(), `Approve at most ${approvalCeiling()} questions at a time`),
});
export type ApproveImportBody = z.infer<typeof approveImportSchema>;

/**
 * A dry run: the same questions, asking only whether they *would* save.
 *
 * Deliberately the **same candidate schema as approval** rather than a looser one, and without a
 * `batchId` — nothing is written, so there is no batch to attribute it to. The whole value of the
 * answer is that it is the answer approval will give, so a schema that accepted something approval
 * would refuse would make the check worse than useless.
 */
export const validateImportSchema = z.object({
  questions: z
    .array(reviewedImportQuestion)
    .min(1, 'Send at least one question to check')
    .max(approvalCeiling(), `Check at most ${approvalCeiling()} questions at a time`),
});
export type ValidateImportBody = z.infer<typeof validateImportSchema>;

/**
 * Discarding candidates. Nothing was stored, so this records a count against the batch and
 * does nothing else — see `recordImportRejections()` for why the count is worth having.
 */
export const rejectImportSchema = z.object({
  batchId: objectId('Import'),
  count: z.coerce.number().int().min(1, 'Nothing to reject').max(IMPORT_HARD_MAX),
});
export type RejectImportBody = z.infer<typeof rejectImportSchema>;

