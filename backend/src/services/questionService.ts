import mongoose from 'mongoose';
import {
  Question,
  Subject,
  Topic,
  type QuestionDocument,
  type QuestionStatus,
  type QuestionType,
  type Difficulty,
} from '../models';
import type { ClassLevel } from '../lib/classLevels';
import { ApiError } from '../lib/ApiError';
import { normalizeTags } from '../lib/mathContent';
import type { Actor } from './taxonomyService';

/**
 * Question-bank business rules.
 *
 * Everything here is a rule that more than one route needs, or that would be a
 * silent data-integrity bug if a route forgot it: that a topic actually belongs to
 * the stated subject, that publishing requires a solution and a resolvable answer,
 * that an edit bumps the revision, that only a never-published draft may be hard
 * deleted. The route layer stays about HTTP.
 */

// ---------------------------------------------------------------------------
// Listing: filter, sort, paginate
// ---------------------------------------------------------------------------

/**
 * Sort keys a client may ask for, mapped to the actual Mongo sort.
 *
 * An allow-list rather than passing the parameter through: a raw `sort` value from
 * `req.query` reaching Mongo lets a caller sort by any field, including ones that
 * are not indexed (a cheap way to make the database do expensive work) — and with
 * an object-shaped value, worse. Compare the query-building rules in SECURITY.md.
 */
export const QUESTION_SORT_KEYS = ['createdAt', 'updatedAt', 'marks', 'difficulty', 'classLevel'] as const;
export type QuestionSortKey = (typeof QUESTION_SORT_KEYS)[number];

export interface ListQuestionsOptions {
  page: number;
  limit: number;
  sort: QuestionSortKey;
  order: 'asc' | 'desc';
  search?: string;
  status?: QuestionStatus;
  subject?: string;
  topic?: string;
  subtopic?: string;
  classLevel?: ClassLevel;
  difficulty?: Difficulty;
  type?: QuestionType;
  tag?: string;
  /** When set, only these statuses are considered regardless of `status`. */
  restrictToStatuses?: readonly QuestionStatus[];
}

/**
 * Escapes a user-supplied string so it is matched literally, never as a pattern.
 * Same reasoning as the admin student search: an unescaped `.*` would match the
 * entire bank rather than nothing.
 */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface QuestionFilter {
  status?: QuestionStatus | { $in: readonly QuestionStatus[] };
  subject?: string;
  topic?: string;
  subtopic?: string;
  classLevel?: ClassLevel;
  difficulty?: Difficulty;
  type?: QuestionType;
  tags?: string;
  $or?: Array<{ questionText?: RegExp } | { tags?: RegExp } | { solution?: RegExp }>;
}

export function buildQuestionFilter(options: ListQuestionsOptions): QuestionFilter {
  const filter: QuestionFilter = {};

  if (options.restrictToStatuses) {
    // The student-facing path pins the visible statuses; a `status` param cannot
    // widen it, only be ignored.
    filter.status = { $in: options.restrictToStatuses };
  } else if (options.status) {
    filter.status = options.status;
  }

  if (options.subject) filter.subject = options.subject;
  if (options.topic) filter.topic = options.topic;
  if (options.subtopic) filter.subtopic = options.subtopic;
  if (options.classLevel) filter.classLevel = options.classLevel;
  if (options.difficulty) filter.difficulty = options.difficulty;
  if (options.type) filter.type = options.type;
  if (options.tag) filter.tags = options.tag.trim().toLowerCase();

  if (options.search) {
    const pattern = new RegExp(escapeRegex(options.search), 'i');
    filter.$or = [{ questionText: pattern }, { tags: pattern }, { solution: pattern }];
  }

  return filter;
}

export interface ListQuestionsResult {
  questions: QuestionDocument[];
  total: number;
}

export async function listQuestions(options: ListQuestionsOptions): Promise<ListQuestionsResult> {
  const filter = buildQuestionFilter(options);
  const direction = options.order === 'asc' ? 1 : -1;

  // `_id` is appended as a tiebreaker so pagination is stable: without it, two
  // questions with the same `createdAt` can swap between pages and one is shown
  // twice while another is never shown at all.
  const sort: Record<string, 1 | -1> = { [options.sort]: direction, _id: -1 };

  const [questions, total] = await Promise.all([
    Question.find(filter)
      .sort(sort)
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .populate('subject', 'name slug')
      .populate('topic', 'name slug')
      .populate('subtopic', 'name slug'),
    Question.countDocuments(filter),
  ]);

  return { questions, total };
}

export async function findQuestionById(id: string): Promise<QuestionDocument> {
  const question = await Question.findById(id)
    .populate('subject', 'name slug')
    .populate('topic', 'name slug')
    .populate('subtopic', 'name slug');
  if (!question) throw ApiError.notFound('No question exists with that id.');
  return question;
}

// ---------------------------------------------------------------------------
// Create and update
// ---------------------------------------------------------------------------

export interface QuestionContentInput {
  questionText: string;
  type: QuestionType;
  options: Array<{ key: string; text: string; isCorrect: boolean }>;
  booleanAnswer: boolean | null;
  numericAnswer: number | null;
  tolerance: number | null;
  solution: string | null;
  subject: string;
  topic: string;
  subtopic: string | null;
  classLevel: ClassLevel;
  difficulty: Difficulty;
  marks: number;
  negativeMarks: number;
  tags: string[];
}

/**
 * Confirms the taxonomy triplet is internally consistent.
 *
 * Mongoose will happily store a `topic` from one subject alongside a `subject` from
 * another — refs are not foreign keys. That question would then be invisible to
 * every filter a user could construct, which is the sort of bug that looks like
 * data loss.
 */
async function resolveTaxonomy(input: {
  subject: string;
  topic: string;
  subtopic: string | null;
}): Promise<{ subject: mongoose.Types.ObjectId; topic: mongoose.Types.ObjectId; subtopic: mongoose.Types.ObjectId | null }> {
  const subject = await Subject.findById(input.subject);
  if (!subject) throw ApiError.badRequest('That subject does not exist.');

  const topic = await Topic.findById(input.topic);
  if (!topic) throw ApiError.badRequest('That topic does not exist.');
  if (String(topic.subject) !== String(subject._id)) {
    throw ApiError.badRequest('That topic does not belong to the selected subject.');
  }
  if (topic.depth !== 0) {
    throw ApiError.badRequest('The `topic` field must be a top-level topic. Put a subtopic in the `subtopic` field.');
  }

  let subtopicId: mongoose.Types.ObjectId | null = null;
  if (input.subtopic) {
    const subtopic = await Topic.findById(input.subtopic);
    if (!subtopic) throw ApiError.badRequest('That subtopic does not exist.');
    if (String(subtopic.parent) !== String(topic._id)) {
      throw ApiError.badRequest('That subtopic does not belong to the selected topic.');
    }
    subtopicId = subtopic._id as mongoose.Types.ObjectId;
  }

  return {
    subject: subject._id as mongoose.Types.ObjectId,
    topic: topic._id as mongoose.Types.ObjectId,
    subtopic: subtopicId,
  };
}

export async function createQuestion(input: QuestionContentInput, actor: Actor): Promise<QuestionDocument> {
  const taxonomy = await resolveTaxonomy(input);

  // Always created as a draft. Publishing is a separate, explicit act so that
  // "saved" and "visible to students" can never be the same keystroke.
  return Question.create({
    questionText: input.questionText,
    type: input.type,
    options: input.options,
    booleanAnswer: input.booleanAnswer,
    numericAnswer: input.numericAnswer,
    tolerance: input.tolerance,
    solution: input.solution,
    ...taxonomy,
    classLevel: input.classLevel,
    difficulty: input.difficulty,
    marks: input.marks,
    negativeMarks: input.negativeMarks,
    tags: normalizeTags(input.tags),
    status: 'draft',
    revision: 1,
    createdBy: actor.id,
    createdByLabel: actor.label,
    updatedBy: actor.id,
    updatedByLabel: actor.label,
  });
}

export async function updateQuestion(id: string, input: QuestionContentInput, actor: Actor): Promise<QuestionDocument> {
  const question = await Question.findById(id);
  if (!question) throw ApiError.notFound('No question exists with that id.');
  if (question.status === 'archived') {
    throw ApiError.conflict('This question is archived. Restore it to a draft before editing.');
  }

  const taxonomy = await resolveTaxonomy(input);

  question.questionText = input.questionText;
  question.type = input.type;
  question.options = input.options;
  question.booleanAnswer = input.booleanAnswer;
  question.numericAnswer = input.numericAnswer;
  question.tolerance = input.tolerance;
  question.solution = input.solution;
  question.subject = taxonomy.subject;
  question.topic = taxonomy.topic;
  question.subtopic = taxonomy.subtopic;
  question.classLevel = input.classLevel;
  question.difficulty = input.difficulty;
  question.marks = input.marks;
  question.negativeMarks = input.negativeMarks;
  question.tags = normalizeTags(input.tags);
  question.revision += 1;
  question.updatedBy = actor.id;
  question.updatedByLabel = actor.label;

  await question.save();
  return question;
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/**
 * The transitions the editorial workflow permits. Expressed as a table rather than
 * a chain of `if`s so the whole lifecycle is readable in one place, and so an
 * illegal transition is a data error rather than something a handler forgot.
 *
 * Note `archived → draft`: archiving is reversible, which is what makes it a safe
 * substitute for deletion.
 */
const ALLOWED_TRANSITIONS: Record<QuestionStatus, readonly QuestionStatus[]> = {
  draft: ['in_review', 'published', 'archived'],
  in_review: ['draft', 'published', 'archived'],
  published: ['archived', 'draft'],
  archived: ['draft'],
};

export async function changeQuestionStatus(id: string, next: QuestionStatus, actor: Actor): Promise<QuestionDocument> {
  const question = await Question.findById(id);
  if (!question) throw ApiError.notFound('No question exists with that id.');

  const current = question.status;
  if (current === next) {
    throw ApiError.conflict(`This question is already ${next.replace('_', ' ')}.`);
  }
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw ApiError.conflict(`A ${current.replace('_', ' ')} question cannot become ${next.replace('_', ' ')}.`);
  }

  if (next === 'published') {
    assertPublishable(question);
    question.publishedAt = new Date();
  }
  if (next === 'archived') {
    question.archivedAt = new Date();
  }
  if (next === 'draft') {
    // `archivedAt` is cleared because the question is no longer archived.
    //
    // `publishedAt` is deliberately NOT cleared. It is a historical record — "this
    // was live at some point" — not a description of the current state, which
    // `status` already carries. Keeping it is what stops the hard-delete guard
    // below from being sidestepped by unpublishing first and then deleting.
    question.archivedAt = null;
  }

  question.status = next;
  question.updatedBy = actor.id;
  question.updatedByLabel = actor.label;
  await question.save();
  return question;
}

/**
 * The editorial bar for publication.
 *
 * A published question is one a student is graded on, so the things that would make
 * grading wrong or unexplainable are blocked here rather than discovered later: no
 * answer key, or no worked solution to show afterwards.
 */
function assertPublishable(question: QuestionDocument): void {
  if (!question.solution || question.solution.trim().length === 0) {
    throw ApiError.conflict('Add a solution before publishing — a published question must be explainable to a student.');
  }

  switch (question.type) {
    case 'single_choice':
    case 'multiple_choice':
      if (question.options.filter((option) => option.isCorrect).length === 0) {
        throw ApiError.conflict('This question has no correct option marked, so it cannot be graded.');
      }
      break;
    case 'true_false':
      if (question.booleanAnswer === null || question.booleanAnswer === undefined) {
        throw ApiError.conflict('Set the true/false answer before publishing.');
      }
      break;
    case 'numeric':
      if (question.numericAnswer === null || question.numericAnswer === undefined) {
        throw ApiError.conflict('Set the numeric answer before publishing.');
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Hard delete, permitted **only** for a question that has never been published.
 *
 * Archiving is the normal removal path. A hard delete exists at all so a mistyped
 * draft does not have to be kept forever, but it stops at anything that has ever
 * been visible to a student: once a question could have been answered, deleting it
 * would orphan the attempt that references it, and no amount of care in this
 * function can reconstruct what the student saw. `publishedAt` is the witness —
 * it survives a later return to draft precisely so this check cannot be sidestepped
 * by unpublishing first.
 */
export async function deleteQuestion(id: string): Promise<{ deleted: true }> {
  const question = await Question.findById(id);
  if (!question) throw ApiError.notFound('No question exists with that id.');

  if (question.status === 'published') {
    throw ApiError.conflict('A published question cannot be deleted. Archive it instead.');
  }
  if (question.publishedAt) {
    throw ApiError.conflict(
      'This question has been published before, so it may have been answered. Archive it instead of deleting it.',
    );
  }

  await Question.deleteOne({ _id: question._id });
  return { deleted: true };
}
