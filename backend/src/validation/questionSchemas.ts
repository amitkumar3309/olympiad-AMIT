import { z } from 'zod';
import mongoose from 'mongoose';
import { CLASS_LEVELS } from '../lib/classLevels';
import { DIFFICULTIES, QUESTION_SOURCES, QUESTION_STATUSES, QUESTION_TYPES } from '../models/Question';
import { validateMathContent } from '../lib/mathContent';
import { QUESTION_SORT_KEYS } from '../services/questionService';
// The grader's own normalisation, so an author is warned about exactly the collisions
// the marking will actually produce — not a second, drifting definition of "the same".
import { normalizeAnswerText } from '../services/grading';
import { BLOOM_LEVELS, GENERATION_LANGUAGES } from '../lib/questionGeneratorTypes';
import { config } from '../config';

/**
 * The most questions one reviewed batch may contain, whatever the environment says.
 *
 * `GENERATION_MAX_QUESTIONS` can lower how many may be *asked for* — a quota decision that
 * belongs to a deployment — but the ceiling on a batch is a product rule: twenty questions
 * is about as many as one examiner can genuinely read, and a limit meant to keep review
 * real must not be raisable by an environment variable.
 */
const GENERATION_HARD_MAX = 20;

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
  /**
   * **Optional**, and normally absent (Milestone 21, Phase J).
   *
   * There is no user-facing subject in this product, so the question editor no longer asks for one:
   * the chapter already records which subject it belongs to, and `resolveTaxonomy()` derives it. The
   * field survives because the AI-approval and import paths still pass it explicitly — and when they
   * do, it is still checked against the chapter, so a mismatched pair is refused rather than
   * silently preferred one way or the other.
   */
  subject: objectId('Subject').nullish().default(null),
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
 * The most questions one bulk status change may carry.
 *
 * Bounded because each id is processed **individually** through `changeQuestionStatus()` — that is
 * the point of the route, not a limitation of it — so the request cost is linear and an unbounded
 * list would be an unbounded request. A hundred is more than a staff member selects in one sitting
 * and still finishes inside a serverless invocation.
 */
export const BULK_STATUS_MAX = 100;

/**
 * Moving several questions through the editorial workflow at once.
 *
 * Deliberately the **same `status` enum** a single change takes, rather than a narrower
 * "publish these" body. A bulk action that could only publish would grow a second endpoint the
 * first time somebody wanted to archive a batch, and the transition rules are identical either way.
 */
export const bulkQuestionStatusSchema = z.object({
  ids: z
    .array(objectId('Question id'))
    .min(1, 'Choose at least one question')
    .max(BULK_STATUS_MAX, `Change at most ${BULK_STATUS_MAX} questions at a time`)
    .refine((list) => new Set(list).size === list.length, 'The same question was listed twice.'),
  status: z.enum(QUESTION_STATUSES, { message: 'Choose a valid status' }),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type BulkQuestionStatusInput = z.infer<typeof bulkQuestionStatusSchema>;

/**
 * Which class to preview practice availability for.
 *
 * A query parameter rather than the caller's own class, because this is the staff view: an
 * administrator publishing Class 5 questions needs to see the Class 5 picker, and they are not a
 * Class 5 student. The student route takes no class at all for exactly the opposite reason.
 */
export const practiceAvailabilityQuerySchema = z.object({
  classLevel: z.enum(CLASS_LEVELS, { message: 'Choose a class' }),
});
export type PracticeAvailabilityQuery = z.infer<typeof practiceAvailabilityQuerySchema>;

/**
 * Asking for a suggested paper — chapter-wise, or the whole syllabus.
 *
 * One schema for both, because the only difference is whether `topic` is present. Capped at the
 * same 100 a mock test may hold, so a suggestion can never propose a paper the API would refuse.
 */
export const paperSuggestionQuerySchema = z.object({
  classLevel: z.enum(CLASS_LEVELS, { message: 'Choose a class' }),
  /** Omit for a whole-syllabus paper spread across every chapter that has questions. */
  topic: objectId('Chapter').optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  count: z.coerce.number().int().min(1, 'Ask for at least one question').max(100, 'A paper holds at most 100').default(20),
});
export type PaperSuggestionQuery = z.infer<typeof paperSuggestionQuerySchema>;

/**
 * Asking which chapter a question looks like it belongs to, for the manual editor.
 *
 * The text is bounded like question text itself and is **not** validated as math content: it is a
 * lookup key, nothing is stored, and a half-typed question with an unbalanced `$` should still get
 * a suggestion rather than a validation error.
 */
export const detectChapterQuerySchema = z.object({
  text: z.string().trim().min(3, 'Type a little more of the question first').max(5000),
});
export type DetectChapterQuery = z.infer<typeof detectChapterQuerySchema>;

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
  /**
   * Who drafted it. Present on the admin listing only: it is an editorial question about
   * the bank, and a student has no business filtering by it.
   */
  source: z.enum(QUESTION_SOURCES).optional(),
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
/**
 * One candidate as the review screen sends it back.
 *
 * Note what it does **not** carry: the taxonomy, the status, and any provenance. The
 * taxonomy arrives once for the whole batch (a reviewer approves a set filed in one place,
 * and letting each row name its own subject would let the client scatter them), and
 * provenance is recovered server-side from the generation log — see `approveQuestions()`.
 */
const reviewedCandidateSchema = z.object({
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
  /** The screen's own report that the examiner changed this one. Recorded, never trusted. */
  edited: z.boolean().default(false),
});

/**
 * The taxonomy a reviewed batch is filed under. Shared by approval and by the dry run so
 * the two cannot drift into checking against different places.
 */
const reviewedBatchTaxonomy = {
  /** Optional: derived from `topic` when absent, like every other write path since Phase J. */
  subject: objectId('Subject').nullish().default(null),
  topic: objectId('Topic'),
  /** Optional second level, checked against `topic` at write time. */
  subtopic: objectId('Subtopic').nullish().default(null),
  classLevel: z.enum(CLASS_LEVELS, { message: 'Choose a class' }),
  difficulty: z.enum(DIFFICULTIES).default('Medium'),
};

export const approveQuestionsSchema = z.object({
  ...reviewedBatchTaxonomy,
  /** Publish straight away, or keep as a draft for a second pass. The reviewer decides. */
  publish: z.boolean().default(false),
  logId: z.string().nullish().default(null),
  questions: z
    .array(reviewedCandidateSchema)
    .min(1, 'Approve at least one question')
    .max(GENERATION_HARD_MAX, `Approve at most ${GENERATION_HARD_MAX} questions at a time`),
});
export type ApproveQuestionsInput = z.infer<typeof approveQuestionsSchema>;

/**
 * A dry run: the same batch, asking only whether it *would* save.
 *
 * Deliberately the same candidate schema as approval rather than a looser one — the whole
 * value of the answer is that it is the answer approval will give, and a check that passes
 * where the save would fail is worse than no check.
 */
export const validateQuestionsSchema = z.object({
  ...reviewedBatchTaxonomy,
  questions: z
    .array(reviewedCandidateSchema)
    .min(1, 'Send at least one question to check')
    .max(GENERATION_HARD_MAX, `Check at most ${GENERATION_HARD_MAX} questions at a time`),
});
export type ValidateQuestionsInput = z.infer<typeof validateQuestionsSchema>;

/**
 * Discarding candidates. Nothing was stored, so this reports a count against the
 * generation log and nothing else — see `recordReviewerRejections()` for why the count is
 * worth recording at all.
 */
export const rejectQuestionsSchema = z.object({
  logId: objectId('Generation log'),
  count: z.coerce.number().int().min(1, 'Nothing to reject').max(GENERATION_HARD_MAX),
});
export type RejectQuestionsInput = z.infer<typeof rejectQuestionsSchema>;

export const generateQuestionsSchema = z.object({
  /**
   * **Optional** since Milestone 21 Phase J.
   *
   * The generator page no longer asks for a subject — there is no user-facing subject in this
   * product — so it is derived from the first chapter, which already records it. The prompt still
   * *names* the subject, because "write me a Mathematics question" is information the model needs;
   * what changed is only that nobody has to choose it.
   */
  subject: objectId('Subject').nullish().default(null),
  /**
   * One or more chapters. The first is the one questions are filed under — a question
   * belongs to exactly one topic in this bank, however many the prompt drew on.
   */
  chapters: z.array(objectId('Chapter')).min(1, 'Choose at least one chapter').max(6, 'Choose at most 6 chapters'),
  /**
   * An optional subtopic of the **first** chapter, narrowing what is asked for.
   *
   * Only one, and only of the primary chapter, because a question is filed under exactly
   * one place in the taxonomy: a subtopic of a chapter the questions are not filed under
   * would describe a row that cannot exist.
   */
  subtopic: objectId('Subtopic').nullish().default(null),
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
  /**
   * How many to write. Capped by `GENERATION_MAX_QUESTIONS` (a deployment's quota decision)
   * under a hard ceiling in code, because a batch has to stay reviewable by one human in
   * one sitting — which is a product rule, not a cost one, and so is not configurable.
   */
  count: z.coerce
    .number()
    .int('count must be a whole number')
    .min(1, 'count must be at least 1')
    .max(config.ai.maxQuestionsPerRequest, `count cannot exceed ${config.ai.maxQuestionsPerRequest}`),
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
    .max(
      config.ai.maxInstructionChars,
      `Instructions must be at most ${config.ai.maxInstructionChars} characters`,
    )
    .nullish()
    .transform((value) => value ?? null),
});
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;
