import { z } from 'zod';
import mongoose from 'mongoose';
import { CLASS_LEVELS } from '../lib/classLevels';
import { DIFFICULTIES, QUESTION_STATUSES, QUESTION_TYPES } from '../models/Question';
import { validateMathContent } from '../lib/mathContent';
import { QUESTION_SORT_KEYS } from '../services/questionService';

/** A Mongo ObjectId as it arrives over HTTP. */
const objectId = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .refine((v) => mongoose.isValidObjectId(v), `${label} must be a valid id`);

/**
 * Author-supplied text that may contain LaTeX. Every such field runs through
 * `validateMathContent`, so the math rules (balanced delimiters, no macro
 * definitions, no markup) are applied uniformly instead of per field — see
 * `lib/mathContent.ts` for why the checks live at the storage boundary.
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

const optionSchema = z.object({
  // Keys are assigned by the server on write, but accepted on update so an edit
  // can preserve which option was which (answers are recorded against the key).
  key: z
    .string()
    .trim()
    .regex(/^[a-z]$/, 'Option keys must be a single lowercase letter')
    .optional(),
  text: mathText('Option text', { max: 2000 }),
  isCorrect: z.boolean().default(false),
});

const tags = z
  .array(z.string().trim().max(40, 'A tag must be at most 40 characters'))
  .max(20, 'A question may have at most 20 tags')
  .default([]);

/**
 * The shared shape of a question's content. The per-type answer rules are applied
 * afterwards by `refineQuestionAnswers`, because they are cross-field: what makes
 * `options` required or forbidden is the value of `type`.
 */
const questionContentShape = {
  questionText: mathText('Question text'),
  type: z.enum(QUESTION_TYPES, { message: 'Choose a question type' }),
  options: z.array(optionSchema).max(8, 'A question may have at most 8 options').default([]),
  booleanAnswer: z.boolean().nullish().default(null),
  numericAnswer: z.number().finite('The numeric answer must be a finite number').nullish().default(null),
  tolerance: z.number().min(0, 'Tolerance cannot be negative').finite().nullish().default(null),
  solution: mathText('Solution', { max: 8000 }).nullish().default(null),
  subject: objectId('Subject'),
  topic: objectId('Topic'),
  subtopic: objectId('Subtopic').nullish().default(null),
  classLevel: z.enum(CLASS_LEVELS, { message: 'Choose a class' }),
  difficulty: z.enum(DIFFICULTIES, { message: 'Choose a difficulty' }).default('Medium'),
  marks: z
    .number({ error: 'Marks are required' })
    .min(0.25, 'Marks must be at least 0.25')
    .max(100, 'Marks cannot exceed 100'),
  negativeMarks: z
    .number()
    .min(0, 'Negative marks cannot be negative — enter the amount to deduct, e.g. 1')
    .max(100, 'Negative marks cannot exceed 100')
    .default(0),
  tags,
};

type QuestionContentShape = {
  type: (typeof QUESTION_TYPES)[number];
  options: Array<{ key?: string; text: string; isCorrect: boolean }>;
  booleanAnswer?: boolean | null;
  numericAnswer?: number | null;
  tolerance?: number | null;
  marks: number;
  negativeMarks: number;
};

/**
 * Enforces that each question type carries exactly its own answer representation.
 *
 * The *rejection* half matters as much as the requirement half: without it a
 * `numeric` question could be stored with an option list that nothing will ever
 * read, which later looks like a rendering bug rather than bad data. Every branch
 * therefore also forbids the fields belonging to the other types.
 */
function refineQuestionAnswers(value: QuestionContentShape, ctx: z.RefinementCtx): void {
  const at = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  const isChoice = value.type === 'single_choice' || value.type === 'multiple_choice';

  if (isChoice) {
    if (value.options.length < 2) {
      at('options', 'A choice question needs at least 2 options.');
    }
    const correct = value.options.filter((option) => option.isCorrect).length;
    if (value.type === 'single_choice' && correct !== 1) {
      at('options', `A single-choice question needs exactly one correct option (you marked ${correct}).`);
    }
    if (value.type === 'multiple_choice' && correct < 2) {
      at('options', `A multiple-choice question needs at least two correct options (you marked ${correct}).`);
    }
    if (value.options.length > 0 && correct === value.options.length) {
      at('options', 'Every option is marked correct, which makes the question unanswerable.');
    }
    // Duplicate option text is almost always a copy-paste slip, and it makes a
    // "which option did they pick" answer ambiguous to a human reviewer.
    const texts = value.options.map((option) => option.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) {
      at('options', 'Two options have the same text.');
    }
    if (value.booleanAnswer !== null && value.booleanAnswer !== undefined) {
      at('booleanAnswer', 'A choice question must not carry a true/false answer.');
    }
    if (value.numericAnswer !== null && value.numericAnswer !== undefined) {
      at('numericAnswer', 'A choice question must not carry a numeric answer.');
    }
  }

  if (value.type === 'true_false') {
    if (value.booleanAnswer === null || value.booleanAnswer === undefined) {
      at('booleanAnswer', 'Choose whether the statement is true or false.');
    }
    if (value.options.length > 0) {
      at('options', 'A true/false question must not carry options.');
    }
    if (value.numericAnswer !== null && value.numericAnswer !== undefined) {
      at('numericAnswer', 'A true/false question must not carry a numeric answer.');
    }
  }

  if (value.type === 'numeric') {
    if (value.numericAnswer === null || value.numericAnswer === undefined) {
      at('numericAnswer', 'Enter the numeric answer.');
    }
    if (value.options.length > 0) {
      at('options', 'A numeric question must not carry options.');
    }
    if (value.booleanAnswer !== null && value.booleanAnswer !== undefined) {
      at('booleanAnswer', 'A numeric question must not carry a true/false answer.');
    }
  }

  if (value.type !== 'numeric' && value.tolerance !== null && value.tolerance !== undefined) {
    at('tolerance', 'Tolerance only applies to a numeric question.');
  }

  // Deducting more than the question is worth is legal in some exam formats but is
  // far more often a typo, and it cannot be undone once students have sat the paper.
  if (value.negativeMarks > value.marks) {
    at('negativeMarks', `Negative marks (${value.negativeMarks}) cannot exceed the marks awarded (${value.marks}).`);
  }
}

export const createQuestionSchema = z.object(questionContentShape).superRefine(refineQuestionAnswers);
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

/**
 * Update takes the whole content, not a patch. A partial update of a question
 * cannot be validated: whether `options` is required depends on `type`, so a
 * request that changes only `type` would be checked against the old options and
 * could leave the document in a state no create request could have produced.
 */
export const updateQuestionSchema = createQuestionSchema;
export type UpdateQuestionInput = CreateQuestionInput;

export const questionStatusSchema = z.object({
  status: z.enum(QUESTION_STATUSES, { message: 'Choose a valid status' }),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type QuestionStatusInput = z.infer<typeof questionStatusSchema>;

export const questionIdParamSchema = z.object({
  id: objectId('Question id'),
});

/**
 * The admin listing's query. Every filter is optional; `sort` is constrained to an
 * allow-list so a caller cannot ask the database to sort by an unindexed field
 * (see `services/questionService.ts`).
 */
export const listQuestionsAdminQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(QUESTION_SORT_KEYS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(QUESTION_STATUSES).optional(),
  subject: objectId('Subject').optional(),
  topic: objectId('Topic').optional(),
  subtopic: objectId('Subtopic').optional(),
  classLevel: z.enum(CLASS_LEVELS).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
});
export type ListQuestionsAdminQuery = z.infer<typeof listQuestionsAdminQuerySchema>;

/**
 * The student-facing listing. Deliberately a *narrower* schema than the admin one:
 * there is no `status` filter, because the route pins the visible statuses and
 * accepting the parameter would imply it could be changed.
 */
export const listQuestionsPublicQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(QUESTION_SORT_KEYS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().min(1).max(200).optional(),
  subject: objectId('Subject').optional(),
  topic: objectId('Topic').optional(),
  subtopic: objectId('Subtopic').optional(),
  classLevel: z.enum(CLASS_LEVELS).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
});
export type ListQuestionsPublicQuery = z.infer<typeof listQuestionsPublicQuerySchema>;

/**
 * The pre-existing template generator's input. Kept because the route still exists,
 * but it now has to name a real subject and topic — the bank no longer accepts a
 * free-text subject string. It writes drafts only; see admin.routes.ts.
 */
export const generateQuestionsSchema = z.object({
  subject: objectId('Subject'),
  topic: objectId('Topic'),
  classLevel: z.enum(CLASS_LEVELS, { message: 'Choose a class' }),
  difficulty: z.enum(DIFFICULTIES).default('Medium'),
  count: z.coerce.number().int('count must be a whole number').min(1, 'count must be at least 1').max(20, 'count cannot exceed 20'),
});
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;
