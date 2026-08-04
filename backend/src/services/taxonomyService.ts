import type { Request } from 'express';
import mongoose from 'mongoose';
import { Subject, Topic, Question, MAX_TOPIC_DEPTH, type SubjectDocument, type TopicDocument, type TaxonomyStatus } from '../models';
import { slugify } from '../lib/slug';
import { ApiError } from '../lib/ApiError';

/**
 * Taxonomy business rules, kept out of the route handlers.
 *
 * The routes above this layer do HTTP: parse, authorize, shape a response. This
 * module owns the rules that would otherwise be duplicated across them — that a
 * subtopic's parent must belong to the same subject, that archiving is refused
 * while published questions still point at the entry, that a slug is derived
 * rather than supplied. Two routes already need each of those (create and update),
 * which is what makes the layer worth having rather than inlining.
 */

/**
 * The two ways a taxonomy entry can be referenced by a question. Spelled out rather
 * than using a generic filter type — Mongoose 9 no longer exports `FilterQuery`, and
 * being explicit is the same choice `users.routes.ts` made for the same reason: a
 * narrow type is what guarantees only these shapes can reach Mongo.
 */
type PublishedQuestionMatch =
  | { subject: mongoose.Types.ObjectId }
  | { $or: Array<{ topic: mongoose.Types.ObjectId } | { subtopic: mongoose.Types.ObjectId }> };

/** How the caller is recorded on a taxonomy entry. */
export interface Actor {
  id: mongoose.Types.ObjectId | null;
  label: string;
}

export function actorFrom(req: Request): Actor {
  const user = req.user;
  return {
    id: user?.sub && mongoose.isValidObjectId(user.sub) ? new mongoose.Types.ObjectId(user.sub) : null,
    label: user?.studentId ?? user?.email ?? 'unknown',
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export interface CreateSubjectInput {
  name: string;
  description?: string | null;
  displayOrder?: number;
}

export async function createSubject(input: CreateSubjectInput, actor: Actor): Promise<SubjectDocument> {
  try {
    return await Subject.create({
      name: input.name,
      slug: slugify(input.name),
      description: input.description ?? null,
      displayOrder: input.displayOrder ?? 0,
      createdBy: actor.id,
      createdByLabel: actor.label,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict(`A subject named "${input.name}" already exists.`);
    }
    throw err;
  }
}

export interface UpdateSubjectInput {
  name?: string;
  description?: string | null;
  displayOrder?: number;
  status?: TaxonomyStatus;
}

export async function updateSubject(id: string, input: UpdateSubjectInput): Promise<SubjectDocument> {
  const subject = await Subject.findById(id);
  if (!subject) throw ApiError.notFound('No subject exists with that id.');

  if (input.status === 'archived' && subject.status !== 'archived') {
    await assertNoPublishedQuestions({ subject: subject._id as mongoose.Types.ObjectId }, 'subject');
  }

  if (input.name !== undefined) {
    subject.name = input.name;
    // The slug follows the name so the handle never contradicts the label. It is
    // not an authorization key and nothing external links to it yet, so changing
    // it is safe; if that stops being true, freeze it here rather than at the route.
    subject.slug = slugify(input.name);
  }
  if (input.description !== undefined) subject.description = input.description;
  if (input.displayOrder !== undefined) subject.displayOrder = input.displayOrder;
  if (input.status !== undefined) subject.status = input.status;

  try {
    return await subject.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict(`A subject named "${input.name}" already exists.`);
    }
    throw err;
  }
}

export async function listSubjects(status?: TaxonomyStatus): Promise<SubjectDocument[]> {
  const filter = status ? { status } : {};
  return Subject.find(filter).sort({ displayOrder: 1, name: 1 });
}

// ---------------------------------------------------------------------------
// Topics and subtopics
// ---------------------------------------------------------------------------

export interface CreateTopicInput {
  subject: string;
  parent?: string | null;
  name: string;
  description?: string | null;
  displayOrder?: number;
}

/**
 * Creates a topic, or a subtopic when `parent` is given.
 *
 * The parent checks are the reason this is not a bare `Topic.create`: a subtopic
 * whose parent sits under a different subject would be reachable from two places
 * in the tree and filterable from neither, and Mongoose cannot express that
 * constraint.
 */
export async function createTopic(input: CreateTopicInput, actor: Actor): Promise<TopicDocument> {
  const subject = await Subject.findById(input.subject);
  if (!subject) throw ApiError.badRequest('That subject does not exist.');
  if (subject.status === 'archived') {
    throw ApiError.conflict('That subject is archived. Reactivate it before adding topics to it.');
  }

  let depth = 0;
  let parentId: mongoose.Types.ObjectId | null = null;

  if (input.parent) {
    const parent = await Topic.findById(input.parent);
    if (!parent) throw ApiError.badRequest('That parent topic does not exist.');
    if (String(parent.subject) !== String(subject._id)) {
      throw ApiError.badRequest('The parent topic belongs to a different subject.');
    }
    if (parent.depth >= MAX_TOPIC_DEPTH) {
      throw ApiError.badRequest(
        `Topics may only nest ${MAX_TOPIC_DEPTH + 1} levels deep (topic → subtopic). Pick a top-level topic as the parent.`,
      );
    }
    depth = parent.depth + 1;
    parentId = parent._id as mongoose.Types.ObjectId;
  }

  try {
    return await Topic.create({
      subject: subject._id,
      parent: parentId,
      depth,
      name: input.name,
      slug: slugify(input.name),
      description: input.description ?? null,
      displayOrder: input.displayOrder ?? 0,
      createdBy: actor.id,
      createdByLabel: actor.label,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict(
        parentId
          ? `A subtopic named "${input.name}" already exists under that topic.`
          : `A topic named "${input.name}" already exists in that subject.`,
      );
    }
    throw err;
  }
}

export interface UpdateTopicInput {
  name?: string;
  description?: string | null;
  displayOrder?: number;
  status?: TaxonomyStatus;
}

export async function updateTopic(id: string, input: UpdateTopicInput): Promise<TopicDocument> {
  const topic = await Topic.findById(id);
  if (!topic) throw ApiError.notFound('No topic exists with that id.');

  if (input.status === 'archived' && topic.status !== 'archived') {
    const topicId = topic._id as mongoose.Types.ObjectId;
    // A question may reference this entry as either its topic or its subtopic.
    await assertNoPublishedQuestions({ $or: [{ topic: topicId }, { subtopic: topicId }] }, 'topic');
  }

  if (input.name !== undefined) {
    topic.name = input.name;
    topic.slug = slugify(input.name);
  }
  if (input.description !== undefined) topic.description = input.description;
  if (input.displayOrder !== undefined) topic.displayOrder = input.displayOrder;
  if (input.status !== undefined) topic.status = input.status;

  try {
    return await topic.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict(`A topic named "${input.name}" already exists at that level.`);
    }
    throw err;
  }
}

export interface ListTopicsFilter {
  subject?: string;
  parent?: string | null;
  status?: TaxonomyStatus;
}

export async function listTopics(filter: ListTopicsFilter): Promise<TopicDocument[]> {
  const query: Record<string, unknown> = {};
  if (filter.subject) query.subject = filter.subject;
  // `parent: null` is a meaningful filter (top-level topics only), so it is
  // distinguished from `parent` being absent (any level).
  if (filter.parent !== undefined) query.parent = filter.parent;
  if (filter.status) query.status = filter.status;
  return Topic.find(query).sort({ displayOrder: 1, name: 1 });
}

/**
 * Refuses to archive a taxonomy entry that published questions still point at.
 *
 * Archiving a subject out from under live questions would leave the student-facing
 * filters offering a subject that resolves to nothing, or hiding questions that are
 * still in an exam. Draft and archived questions do not block it — they are not
 * visible to anyone, so the editor can tidy the tree freely.
 */
async function assertNoPublishedQuestions(match: PublishedQuestionMatch, label: string): Promise<void> {
  const count = await Question.countDocuments({ ...match, status: 'published' });
  if (count > 0) {
    throw ApiError.conflict(
      `This ${label} still has ${count} published question${count === 1 ? '' : 's'}. Archive or move ${
        count === 1 ? 'it' : 'them'
      } first.`,
    );
  }
}
