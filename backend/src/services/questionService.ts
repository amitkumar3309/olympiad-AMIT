import mongoose from 'mongoose';
import {
  Question,
  Subject,
  Topic,
  type QuestionDocument,
  type QuestionStatus,
  type QuestionType,
  type QuestionSource,
  type QuestionProvenance,
  type Difficulty,
} from '../models';
import type { ClassLevel } from '../lib/classLevels';
import { ApiError } from '../lib/ApiError';
import { normalizeTags } from '../lib/mathContent';
import { findImplicitSubject, type Actor } from './taxonomyService';

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
  /** `human` or `ai_assisted` — who drafted it. See `Question.provenance`. */
  source?: QuestionSource;
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
  'provenance.source'?: QuestionSource;
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
  if (options.source) filter['provenance.source'] = options.source;

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
  acceptedAnswers: string[];
  solution: string | null;
  /** Optional: derived from the chapter when absent. See `resolveTaxonomy()`. */
  subject?: string | null;
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
  subject?: string | null;
  topic: string;
  subtopic: string | null;
}): Promise<{ subject: mongoose.Types.ObjectId; topic: mongoose.Types.ObjectId; subtopic: mongoose.Types.ObjectId | null }> {
  const topic = await Topic.findById(input.topic);
  if (!topic) throw ApiError.badRequest('That topic does not exist.');

  /**
   * The subject is **derived from the chapter** unless the caller named one.
   *
   * A chapter already records its subject, so asking for both admits a pair that can disagree —
   * and since Phase J there is no user-facing subject to ask for, so the editor sends none. The
   * check is kept for the callers that *do* send one (AI approval, import), because for them a
   * mismatch is a real client bug worth refusing rather than resolving silently.
   */
  const subject = await Subject.findById(input.subject ?? topic.subject);
  if (!subject) throw ApiError.badRequest('That subject does not exist.');
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

/**
 * Assigns the stable per-option keys (`a`, `b`, `c`, …).
 *
 * The **server** owns these rather than trusting whatever produced the options, because
 * an answer is recorded against the key: a caller that reordered or reused keys could
 * silently repoint what "option b" means on a question somebody has already answered.
 *
 * It lives here rather than in a route because there are now two producers of question
 * content — the admin editor and the Milestone 17 generator — and two implementations
 * of "the server owns option keys" would be one too many.
 */
export function withOptionKeys(
  options: Array<{ text: string; isCorrect: boolean }>,
): QuestionContentInput['options'] {
  return options.map((option, index) => ({
    key: String.fromCharCode(97 + index),
    text: option.text,
    isCorrect: option.isCorrect,
  }));
}

/**
 * Turns validated question content into the service's input shape.
 *
 * Shared by the admin editor and the generator so both normalise nullables and assign
 * option keys identically — a generated draft is stored exactly as a hand-authored one.
 */
export function toQuestionContent(input: ValidatedQuestionContent): QuestionContentInput {
  return {
    questionText: input.questionText,
    type: input.type,
    options: withOptionKeys(input.options),
    booleanAnswer: input.booleanAnswer ?? null,
    numericAnswer: input.numericAnswer ?? null,
    tolerance: input.tolerance ?? null,
    acceptedAnswers: input.acceptedAnswers ?? [],
    solution: input.solution ?? null,
    subject: input.subject ?? null,
    topic: input.topic,
    subtopic: input.subtopic ?? null,
    classLevel: input.classLevel,
    difficulty: input.difficulty,
    marks: input.marks,
    negativeMarks: input.negativeMarks,
    tags: input.tags,
  };
}

/**
 * What `createQuestionSchema` produces. Declared structurally rather than imported from
 * the validation module, so a service does not depend on a zod schema's inferred type.
 */
export interface ValidatedQuestionContent {
  questionText: string;
  type: QuestionType;
  options: Array<{ key?: string; text: string; isCorrect: boolean }>;
  booleanAnswer?: boolean | null;
  numericAnswer?: number | null;
  tolerance?: number | null;
  acceptedAnswers?: string[];
  solution?: string | null;
  subject?: string | null;
  topic: string;
  subtopic?: string | null;
  classLevel: ClassLevel;
  difficulty: Difficulty;
  marks: number;
  negativeMarks: number;
  tags: string[];
}

/**
 * Creates a question.
 *
 * `provenance` is supplied only by the AI approval path (`approveQuestions()`); the editor
 * omits it and the model's own default records a hand-written question. It is a parameter
 * rather than part of `QuestionContentInput` on purpose: content is what a reviewer may
 * edit, and provenance is a fact about how the row came to exist that no request body
 * should be able to set. Nothing reaching this function from an HTTP body can name itself
 * human-written or claim a model it did not use.
 */
export async function createQuestion(
  input: QuestionContentInput,
  actor: Actor,
  provenance?: QuestionProvenance,
): Promise<QuestionDocument> {
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
    acceptedAnswers: input.acceptedAnswers,
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
    provenance: provenance ?? { source: 'human' },
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
  question.acceptedAnswers = input.acceptedAnswers;
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
// Suggesting a paper
// ---------------------------------------------------------------------------

export interface PaperSuggestionInput {
  classLevel: ClassLevel;
  /**
   * One chapter for a **chapter-wise** paper, or `null` for a **whole-syllabus** one.
   *
   * The two are the same request with one field different rather than two endpoints, because the
   * only thing that actually changes is whether the sample is drawn from one chapter or spread
   * across all of them.
   */
  topic: string | null;
  difficulty?: Difficulty;
  count: number;
}

/**
 * Picks published questions for a paper an author is about to assemble.
 *
 * ## What this is not
 *
 * **Not a second question-serving path.** It returns candidates for an *author* to look at and
 * edit before saving a mock test; nothing here reaches a student, and the answer-key rules that
 * govern `studentQuestionView` do not apply because the caller already holds `questions:write`
 * and can read the whole bank anyway.
 *
 * ## Why the spread is a real feature and not a `limit`
 *
 * A whole-syllabus paper drawn with `find().limit(40)` is not a syllabus paper: it is the forty
 * most recent questions, which in a bank filled chapter by chapter means one or two chapters and
 * none of the rest. So a chapter-less request **round-robins across the chapters that have
 * published questions**, taking one from each in turn until the count is met. Every chapter with
 * anything to offer appears before any chapter appears twice.
 *
 * A chapter-wise request is the simple case: sample from that chapter alone.
 *
 * Sampling is random (`$sample`) rather than "the newest", so pressing the button twice gives two
 * different papers — an author generating a second mock test for the same class wants a different
 * one, exactly as the Practice Zone does.
 */
export async function suggestPaper(input: PaperSuggestionInput): Promise<QuestionDocument[]> {
  const match: Record<string, unknown> = {
    classLevel: input.classLevel,
    status: 'published',
  };
  if (input.difficulty) match.difficulty = input.difficulty;

  /**
   * Scoped to the implicit subject, and this is not cosmetic.
   *
   * A "whole syllabus" paper drawn on class alone pulled **Physics** chapters into a Class 12
   * mathematics paper — legacy seed data holds a second subject, and the spread across chapters
   * dutifully included every one of them. Scoping here rather than waiting for that data to be
   * deleted means the endpoint is right regardless of what is in the database.
   *
   * `null` (genuinely ambiguous) leaves it unscoped rather than failing: refusing to suggest a paper
   * because legacy data holds two subjects would break a working feature for a condition the
   * examiner cannot see.
   */
  const subject = await findImplicitSubject();
  if (subject) match.subject = subject;

  if (input.topic) {
    // `$match` inside an aggregation does **not** cast a hex string to an ObjectId the way
    // `find()` does — it compares raw BSON and silently matches nothing. The practice service
    // documents the same trap.
    match.topic = new mongoose.Types.ObjectId(input.topic);
    return Question.aggregate<QuestionDocument>([{ $match: match }, { $sample: { size: input.count } }]);
  }

  /**
   * Whole syllabus: sample generously per chapter, then interleave.
   *
   * Sampling `count` from *each* chapter and interleaving in memory is cheaper than it looks — the
   * count is bounded at 100 and the chapter list is small — and it is the only way to guarantee the
   * spread without one query per chapter per round.
   */
  const byChapter = await Question.aggregate<{ _id: unknown; questions: QuestionDocument[] }>([
    { $match: match },
    { $sample: { size: Math.min(1000, input.count * 20) } },
    { $group: { _id: '$topic', questions: { $push: '$$ROOT' } } },
  ]);

  const buckets = byChapter.map((row) => row.questions);
  const picked: QuestionDocument[] = [];
  let round = 0;

  while (picked.length < input.count) {
    let tookAny = false;
    for (const bucket of buckets) {
      if (picked.length >= input.count) break;
      const question = bucket[round];
      if (question) {
        picked.push(question);
        tookAny = true;
      }
    }
    // Every bucket exhausted: the bank simply has fewer questions than asked for, which is not an
    // error — the author is told how many were found and can add more by hand.
    if (!tookAny) break;
    round += 1;
  }

  return picked;
}

// ---------------------------------------------------------------------------
// Bulk status changes
// ---------------------------------------------------------------------------

/** What happened to one question in a bulk status change. */
export interface BulkStatusOutcome {
  id: string;
  /** A short label so a report can name the question rather than just its id. */
  label: string;
  ok: boolean;
  /** Why it did not move. `null` when it did. */
  reason: string | null;
}

/**
 * Moves several questions through the editorial workflow, **one at a time**.
 *
 * The one-at-a-time part is the whole design, not a missing optimisation. A bulk `updateMany`
 * would be a second path to a published question that skips every rule the single path enforces:
 * the transition table, and — far more importantly — `assertPublishable()`, which refuses a
 * question with no solution or no resolvable answer key. A student is *graded* on a published
 * question, so a bulk publish that bypassed that check would put ungradeable questions in front of
 * children, quietly, in batches.
 *
 * So this is a loop over `changeQuestionStatus()`, and its value is entirely in the **reporting**:
 * a partial success is normal, and each failure comes back with the reason that question was
 * refused. Nothing is rolled back — the ones that moved were each legitimately publishable, and
 * undoing them because a *different* question lacked a solution would help nobody.
 */
export async function changeQuestionStatusBulk(
  ids: readonly string[],
  next: QuestionStatus,
  actor: Actor,
): Promise<BulkStatusOutcome[]> {
  const outcomes: BulkStatusOutcome[] = [];

  for (const id of ids) {
    try {
      const question = await changeQuestionStatus(id, next, actor);
      outcomes.push({ id, label: question.questionText.slice(0, 80), ok: true, reason: null });
    } catch (err) {
      /**
       * The question is re-read for its label so a report can name what failed.
       *
       * Best-effort: if even that read fails there is nothing to name, and the id is still
       * reported. Losing the label must not turn a reportable refusal into a thrown request.
       */
      const label = await Question.findById(id)
        .select('questionText')
        .lean()
        .then((row) => (row ? row.questionText.slice(0, 80) : id))
        .catch(() => id);

      outcomes.push({
        id,
        label,
        ok: false,
        reason: err instanceof ApiError ? err.message : 'Could not be updated.',
      });
    }
  }

  return outcomes;
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
