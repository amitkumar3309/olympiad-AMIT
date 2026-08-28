import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * The answer shapes the bank supports. Each type uses **exactly one** answer
 * representation, and the validation layer rejects the fields belonging to the
 * other types — so a `numeric` question cannot carry a smuggled option list, and
 * an MCQ cannot carry a `numericAnswer` that nothing would ever read.
 */
export const QUESTION_TYPES = [
  /** One correct option out of several. The default olympiad format. */
  'single_choice',
  /** Two or more correct options; a response must match the full set. */
  'multiple_choice',
  /** Answered by `booleanAnswer`; carries no options. */
  'true_false',
  /** Answered by `numericAnswer`, optionally within `tolerance`. No options. */
  'numeric',
  /**
   * Fill in the blank: answered by free text, marked against `acceptedAnswers`
   * (Milestone 18). No options.
   *
   * It is auto-gradable, which is why it exists and why **short answer does not**.
   * Comparison is a normalised string match through the one grader — every accepted
   * spelling has to be listed by the author, so what counts as right is data a human
   * can read and correct rather than a judgement made at marking time.
   */
  'fill_blank',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * The editorial lifecycle. `draft` → `in_review` → `published`, with `archived` as
 * the terminal state that replaces deletion for anything that has ever been
 * published (see the Milestone 4 ADR in DECISIONS.md).
 */
export const QUESTION_STATUSES = ['draft', 'in_review', 'published', 'archived'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/** Statuses a student may ever see. Kept here so no route has to remember it. */
export const STUDENT_VISIBLE_STATUSES: readonly QuestionStatus[] = ['published'];

/**
 * How a question came to exist.
 *
 * `human` is the default and covers every question created before Milestone 20 as well as
 * every one typed into the editor, so the absence of a provenance block never has to be
 * interpreted.
 *
 * The three `*_import` values arrived with the bulk importer in Milestone 21. They record
 * the **route into the bank**, which is a different fact from whether a model was involved:
 * an image import is `image_import` *and* carries `generatorKind: 'model'` and a
 * `modelName`, because a model really did read the photograph, while an Excel import is
 * deterministic and carries neither. Collapsing the two facts into one field would mean
 * either losing "a model produced this text" or losing "this came from a spreadsheet", and
 * both are things somebody will eventually need to ask about machine-read exam content.
 *
 * Lowercase snake_case to match the values already stored. The product spec named these in
 * upper case (`EXCEL_IMPORT`); renaming the two existing values to match would have been a
 * data migration on every question in the bank for a cosmetic gain.
 */
export const QUESTION_SOURCES = [
  'human',
  'ai_assisted',
  'excel_import',
  'docx_import',
  'image_import',
] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

/**
 * How an AI-drafted question came to exist (Milestone 20).
 *
 * ## Why this is stored on the question and not left to the logs
 *
 * `GenerationLog` records that a *batch* was asked for and `AuditLog` records that an
 * approval happened, but neither can answer the question somebody will eventually ask
 * about a specific row: **"was this one written by a model, which model, and who signed
 * off on it?"** Answering that by joining a log against a timestamp is guesswork, and the
 * question is not hypothetical for machine-written exam content.
 *
 * ## And why it is displayed
 *
 * A stored field nothing reads is the shape of thing Milestone 15 deleted. This one is
 * read: the admin question view returns it and the question bank shows a badge naming the
 * model and the reviewer, which is the point — the record exists so a human can see it,
 * not so we can say we kept it.
 *
 * It holds **no credential** and no prompt text. The examiner's instruction is not stored
 * here (`GenerationLog.hadInstructions` records only that there was one); a model name and
 * a reviewer are facts about the row, and a prompt is a draft artefact.
 */
export interface QuestionProvenance {
  source: QuestionSource;
  /** The registered generator id, e.g. `gemini`. Null for a hand-written question. */
  generatorId?: string | null;
  /** `model` only when a real language model produced the text. A statement of fact. */
  generatorKind?: string | null;
  /** The exact model that wrote it, not the deployment's current default. */
  modelName?: string | null;
  /** The `GenerationLog` row this came from, so the batch is traceable. */
  generationLog?: Types.ObjectId | null;
  generatedAt?: Date | null;
  /** Whether the reviewer changed the text before approving it. */
  editedByReviewer?: boolean;
  /**
   * Who approved it. Distinct from `createdBy` in intent even when they are the same
   * account: `createdBy` says who caused the row to exist, this says who took
   * responsibility for its correctness.
   */
  reviewedBy?: Types.ObjectId | null;
  reviewedByLabel?: string | null;
  reviewedAt?: Date | null;
}

export interface QuestionOption {
  /**
   * Stable per-question identifier (`a`, `b`, `c`, ...). An answer is recorded
   * against this rather than against the option *text*, which fixes the fragility
   * called out in DATABASE_SCHEMA.md: the old model stored `correctAnswer` as the
   * literal option string, so editing a typo in an option silently invalidated
   * every recorded answer.
   */
  key: string;
  text: string;
  isCorrect: boolean;
}

export interface QuestionDocument extends Document {
  questionText: string;
  type: QuestionType;
  /** Populated for `single_choice` / `multiple_choice` only; empty otherwise. */
  options: QuestionOption[];
  /** `true_false` only. */
  booleanAnswer?: boolean | null;
  /** `numeric` only. */
  numericAnswer?: number | null;
  /** `numeric` only: absolute tolerance. 0 means an exact match is required. */
  tolerance?: number | null;
  /**
   * `fill_blank` only: every spelling that counts as correct, first one canonical.
   *
   * A list rather than a single string because "12 cm", "12cm" and "twelve cm" are the
   * same answer to a human and three different strings to a computer. Matching is
   * normalised (see `normalizeAnswerText` in `services/grading.ts`), so an author lists
   * *meaningfully* different answers rather than every capitalisation.
   */
  acceptedAnswers: string[];
  /** Worked explanation. Required before a question may be published. */
  solution?: string | null;
  subject: Types.ObjectId;
  topic: Types.ObjectId;
  subtopic?: Types.ObjectId | null;
  classLevel: ClassLevel;
  difficulty: Difficulty;
  /** Awarded for a correct response. */
  marks: number;
  /** Magnitude **deducted** for a wrong response; 0 disables negative marking. */
  negativeMarks: number;
  status: QuestionStatus;
  /** Lowercased, de-duplicated free-text labels for cross-cutting search. */
  tags: string[];
  /**
   * Bumped on every content edit. An exam attempt can record the revision it
   * showed, so a later correction cannot silently rewrite history.
   */
  revision: number;
  createdBy?: Types.ObjectId | null;
  createdByLabel?: string | null;
  updatedBy?: Types.ObjectId | null;
  updatedByLabel?: string | null;
  /**
   * Who wrote it. Always present — `{ source: 'human' }` for anything typed in — so a
   * reader never has to decide what a missing field means.
   */
  provenance: QuestionProvenance;
  /**
   * When the question was last published. A **historical** record, not a
   * description of the current state — it is deliberately retained if the question
   * later returns to `draft`, because "this was visible to students at some point"
   * is what the hard-delete guard in `services/questionService.ts` tests. `status`
   * is the authority on current visibility.
   */
  publishedAt?: Date | null;
  /** When it was archived; cleared on restore, since it is then no longer archived. */
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const optionSchema = new Schema<QuestionOption>(
  {
    key: { type: String, required: true, trim: true, maxlength: 4 },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    isCorrect: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const provenanceSchema = new Schema<QuestionProvenance>(
  {
    source: { type: String, enum: QUESTION_SOURCES, required: true, default: 'human' },
    generatorId: { type: String, default: null },
    generatorKind: { type: String, default: null },
    modelName: { type: String, default: null },
    generationLog: { type: Schema.Types.ObjectId, ref: 'GenerationLog', default: null },
    generatedAt: { type: Date, default: null },
    editedByReviewer: { type: Boolean, default: false },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    reviewedByLabel: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { _id: false },
);

const questionSchema = new Schema<QuestionDocument>(
  {
    questionText: { type: String, required: true, trim: true, maxlength: 5000 },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    options: { type: [optionSchema], default: [] },
    booleanAnswer: { type: Boolean, default: null },
    numericAnswer: { type: Number, default: null },
    tolerance: { type: Number, default: null, min: 0 },
    acceptedAnswers: { type: [String], default: [] },
    solution: { type: String, default: null, trim: true, maxlength: 8000 },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
    topic: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, index: true },
    subtopic: { type: Schema.Types.ObjectId, ref: 'Topic', default: null },
    classLevel: { type: String, enum: CLASS_LEVELS, required: true, index: true },
    difficulty: { type: String, enum: DIFFICULTIES, default: 'Medium', index: true },
    marks: { type: Number, required: true, min: 0.25, max: 100 },
    negativeMarks: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, enum: QUESTION_STATUSES, default: 'draft', index: true },
    tags: { type: [String], default: [] },
    revision: { type: Number, default: 1, min: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    createdByLabel: { type: String, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    updatedByLabel: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    provenance: { type: provenanceSchema, default: () => ({ source: 'human' }) },
  },
  { timestamps: true },
);

// The admin listing's default order, and the shape of its commonest filters. A
// compound index rather than four single-field ones because the listing almost
// always filters on status and then sorts by recency.
questionSchema.index({ status: 1, createdAt: -1 });
questionSchema.index({ subject: 1, topic: 1, status: 1 });
questionSchema.index({ classLevel: 1, difficulty: 1, status: 1 });
questionSchema.index({ tags: 1 });
// "Show me everything a model drafted" is the question the provenance block exists to
// answer, and the admin listing offers it as a filter.
questionSchema.index({ 'provenance.source': 1, createdAt: -1 });

export const Question = mongoose.model<QuestionDocument>('Question', questionSchema);
