import { z } from 'zod';
import mongoose from 'mongoose';
import { TAXONOMY_STATUSES } from '../models/Subject';

const objectId = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .refine((v) => mongoose.isValidObjectId(v), `${label} must be a valid id`);

/**
 * A taxonomy label. Plain text only — a subject or topic name is rendered as a
 * label in dropdowns and table cells, never through the math renderer, so LaTeX
 * here would show as literal `$...$`. Rejecting the delimiters outright is clearer
 * than silently displaying something the author did not intend.
 */
const taxonomyName = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(max, `${label} must be at most ${max} characters`)
    .refine((v) => !/[$<>]/.test(v), `${label} cannot contain $, < or >. Names are plain text, not formulas.`);

/**
 * Base validators carry **no defaults**.
 *
 * That matters for the patch schemas below, which reject an empty body by counting
 * the parsed keys: a `.default()` is applied during parsing, so `{}` would come out
 * as `{ description: null, displayOrder: 0 }` and the emptiness check would never
 * fire — it would also silently reset both fields on every partial update. Defaults
 * are therefore attached only where a value really is being created.
 */
const descriptionInput = z.string().trim().max(500, 'The description must be at most 500 characters').nullable();

const displayOrderInput = z
  .number()
  .int('Display order must be a whole number')
  .min(0, 'Display order cannot be negative')
  .max(9999);

export const createSubjectSchema = z.object({
  name: taxonomyName('Subject name', 80),
  description: descriptionInput.optional().default(null),
  displayOrder: displayOrderInput.optional().default(0),
});
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;

/**
 * Update is a genuine patch here (unlike a question, where the answer shape makes
 * partial validation unsound): every taxonomy field is independent, so sending only
 * `status` is well-defined. `.refine` rejects an empty body so a no-op PATCH does
 * not silently report success.
 */
export const updateSubjectSchema = z
  .object({
    name: taxonomyName('Subject name', 80).optional(),
    description: descriptionInput.optional(),
    displayOrder: displayOrderInput.optional(),
    status: z.enum(TAXONOMY_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update.');
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;

export const createTopicSchema = z.object({
  subject: objectId('Subject'),
  /** Present makes this a subtopic; absent or null makes it a top-level topic. */
  parent: objectId('Parent topic').nullish().default(null),
  name: taxonomyName('Topic name', 120),
  description: descriptionInput.optional().default(null),
  displayOrder: displayOrderInput.optional().default(0),
});
export type CreateTopicInput = z.infer<typeof createTopicSchema>;

/**
 * Several chapters at once, by name, under the one implicit subject.
 *
 * The subject is **not** accepted: there is no user-facing subject in this product, and the server
 * resolves the implicit one. Names only — a bulk create is for a flat list of chapters, never
 * subtopics, because a subtopic needs a parent chosen deliberately per item.
 *
 * `BULK_CHAPTER_MAX` is a real syllabus's worth. It is a ceiling in code, not only in configuration,
 * because the whole safety story here is that an examiner *reads the list first* — and a list nobody
 * can read is not a review.
 */
export const BULK_CHAPTER_MAX = 60;

export const createChaptersSchema = z.object({
  names: z
    .array(taxonomyName('Chapter name', 120))
    .min(1, 'Name at least one chapter')
    .max(BULK_CHAPTER_MAX, `Create at most ${BULK_CHAPTER_MAX} chapters at a time`),
});
export type CreateChaptersInput = z.infer<typeof createChaptersSchema>;

export const updateTopicSchema = z
  .object({
    name: taxonomyName('Topic name', 120).optional(),
    description: descriptionInput.optional(),
    displayOrder: displayOrderInput.optional(),
    status: z.enum(TAXONOMY_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update.');
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;

export const taxonomyIdParamSchema = z.object({
  id: objectId('Id'),
});

export const listSubjectsQuerySchema = z.object({
  status: z.enum(TAXONOMY_STATUSES).optional(),
});
export type ListSubjectsQuery = z.infer<typeof listSubjectsQuerySchema>;

export const listTopicsQuerySchema = z.object({
  subject: objectId('Subject').optional(),
  /**
   * `parent=root` asks for top-level topics only; a parent id asks for that
   * parent's subtopics; omitting it returns every level. A literal `root` sentinel
   * rather than an empty string, because an empty query value is indistinguishable
   * from the parameter being absent.
   */
  parent: z.union([z.literal('root'), objectId('Parent topic')]).optional(),
  status: z.enum(TAXONOMY_STATUSES).optional(),
});
export type ListTopicsQuery = z.infer<typeof listTopicsQuerySchema>;
