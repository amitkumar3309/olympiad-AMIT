import { z } from 'zod';
import mongoose from 'mongoose';
import { CLASS_LEVELS } from '../lib/classLevels';
import { DIFFICULTIES, QUESTION_STATUSES, QUESTION_TYPES } from '../models/Question';
import { validateMathContent } from '../lib/mathContent';
import { QUESTION_SORT_KEYS } from '../services/questionService';
// The grader's own normalisation, so an author is warned about exactly the collisions
// the marking will actually produce — not a second, drifting definition of "the same".
import { normalizeAnswerText } from '../services/grading';
import { BLOOM_LEVELS, GENERATION_LANGUAGES } from '../lib/questionGeneratorTypes';

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
  /**
   * `fill_blank` only. Validated as math content like any other author-written text —
   * an accepted answer may legitimately be `$\\frac{1}{2}$`, and it is rendered to the
   * student on review, so it reaches the same sinks the question text does.
   */
  acceptedAnswers: z
    .array(mathText('Accepted answer', { max: 200 }))
    .max(8, 'A fill-in-the-blank question may have at most 8 accepted answers')
    .default([]),
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
  acceptedAnswers: string[];
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

  if (value.type === 'fill_blank') {
    if (value.acceptedAnswers.length === 0) {
      at('acceptedAnswers', 'Give at least one answer that counts as correct.');
    }
    if (value.options.length > 0) {
      at('options', 'A fill-in-the-blank question must not carry options.');
    }
    if (value.booleanAnswer !== null && value.booleanAnswer !== undefined) {
      at('booleanAnswer', 'A fill-in-the-blank question must not carry a true/false answer.');
    }
    if (value.numericAnswer !== null && value.numericAnswer !== undefined) {
      at('numericAnswer', 'A fill-in-the-blank question must not carry a numeric answer.');
    }
    /**
     * Two accepted answers that normalise to the same string are always an authoring
     * slip ("12 cm" and "12 cm."), and they matter because the list is what a reviewer
     * reads to understand what will be marked right. Checked with the **grader's own**
     * `normalizeAnswerText`, so what the author is warned about is exactly what the
     * marking will do.
     */
    const normalised = value.acceptedAnswers.map(normalizeAnswerText);
    if (new Set(normalised).size !== normalised.length) {
      at('acceptedAnswers', 'Two accepted answers are the same once spacing and capitalisation are ignored.');
    }
    if (normalised.some((answer) => answer.length === 0)) {
      at('acceptedAnswers', 'An accepted answer cannot be blank.');
    }
  } else if (value.acceptedAnswers.length > 0) {
    at('acceptedAnswers', 'Accepted answers only apply to a fill-in-the-blank question.');
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
/**
 * What the review screen sends back for approval.
 *
 * It is `createQuestionSchema` minus the taxonomy, which the approval request carries
 * once for the whole batch — a reviewer approves a set of questions filed in one place,
 * and letting each row name its own subject would let the client scatter them.
 */
export const approveQuestionsSchema = z.object({
  subject: objectId('Subject'),
  topic: objectId('Topic'),
  classLevel: z.enum(CLASS_LEVELS, { message: 'Choose a class' }),
  difficulty: z.enum(DIFFICULTIES).default('Medium'),
  /** Publish straight away, or keep as a draft for a second pass. The reviewer decides. */
  publish: z.boolean().default(false),
  logId: z.string().nullish().default(null),
  questions: z
    .array(
      z.object({
        questionText: mathText('Question text'),
        type: z.enum(QUESTION_TYPES),
        options: z.array(optionSchema).max(8).default([]),
        booleanAnswer: z.boolean().nullish().default(null),
        numericAnswer: z.number().finite().nullish().default(null),
        tolerance: z.number().min(0).finite().nullish().default(null),
        acceptedAnswers: z.array(mathText('Accepted answer', { max: 200 })).max(8).default([]),
        solution: mathText('Solution', { max: 8000 }).nullish().default(null),
        marks: z.number().min(0.25).max(100),
        negativeMarks: z.number().min(0).max(100).default(0),
        tags,
      }),
    )
    .min(1, 'Approve at least one question')
    .max(20, 'Approve at most 20 questions at a time'),
});
export type ApproveQuestionsInput = z.infer<typeof approveQuestionsSchema>;

export const generateQuestionsSchema = z.object({
  subject: objectId('Subject'),
  /**
   * One or more chapters. The first is the one questions are filed under — a question
   * belongs to exactly one topic in this bank, however many the prompt drew on.
   */
  chapters: z.array(objectId('Chapter')).min(1, 'Choose at least one chapter').max(6, 'Choose at most 6 chapters'),
  classLevel: z.enum(CLASS_LEVELS, { message: 'Choose a class' }),
  difficulty: z.enum(DIFFICULTIES).default('Medium'),
  questionType: z.enum(QUESTION_TYPES).default('single_choice'),
  language: z.enum(GENERATION_LANGUAGES).default('English'),
  bloomLevel: z.enum(BLOOM_LEVELS).nullish().default(null),
  marks: z.number().min(0.25).max(100).default(4),
  negativeMarks: z.number().min(0).max(100).default(1),
  optionCount: z.coerce.number().int().min(2, 'At least 2 options').max(8, 'At most 8 options').default(4),
  /**
   * Which model to use for this batch. Optional — omitted means the configured default.
   *
   * Deliberately **not** an enum: the valid names are Google's, they change on Google's
   * schedule, and a hardcoded list here would be the stale table this whole feature
   * exists to avoid. The charset is bounded so it cannot smuggle a path segment into
   * the endpoint URL, and Google is the authority on whether the name is real — its
   * refusal is surfaced verbatim.
   */
  model: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/u, 'That is not a valid model name')
    .nullish()
    .default(null),
  /** Question text already on the review screen, so a regenerate does not repeat it. */
  exclude: z.array(z.string().max(1000)).max(40).default([]),
  count: z.coerce.number().int('count must be a whole number').min(1, 'count must be at least 1').max(20, 'count cannot exceed 20'),
  /**
   * Optional steer for a model-backed generator ("focus on word problems").
   *
   * Bounded rather than free-form: it is pasted into a prompt, and an unbounded field
   * is both a cost and a nuisance. It is **not** validated as math content, because it
   * is an instruction rather than question text and never reaches a student — what the
   * model produces from it is validated by `createQuestionSchema` like everything else,
   * which is the check that actually matters.
   */
  instructions: z
    .string()
    .trim()
    .max(500, 'Instructions must be at most 500 characters')
    .nullish()
    .transform((value) => value ?? null),
});
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;
