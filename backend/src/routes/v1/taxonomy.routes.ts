import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { ApiError } from '../../lib/ApiError';
import type { SubjectDocument, TopicDocument } from '../../models';
import {
  createSubject,
  updateSubject,
  listSubjects,
  createTopic,
  updateTopic,
  listTopics,
  requireImplicitSubject,
  actorFrom,
} from '../../services/taxonomyService';
import {
  createSubjectSchema,
  updateSubjectSchema,
  createTopicSchema,
  createChaptersSchema,
  updateTopicSchema,
  taxonomyIdParamSchema,
  listSubjectsQuerySchema,
  listTopicsQuerySchema,
  type CreateSubjectInput,
  type UpdateSubjectInput,
  type CreateTopicInput,
  type CreateChaptersInput,
  type UpdateTopicInput,
  type ListSubjectsQuery,
  type ListTopicsQuery,
} from '../../validation/taxonomySchemas';

const router = Router();

// ---------------------------------------------------------------------------
// Views — explicit allow-lists, as everywhere else in this API
// ---------------------------------------------------------------------------

function subjectView(subject: SubjectDocument) {
  return {
    id: String(subject._id),
    name: subject.name,
    slug: subject.slug,
    description: subject.description ?? null,
    status: subject.status,
    displayOrder: subject.displayOrder,
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
  };
}

function topicView(topic: TopicDocument) {
  return {
    id: String(topic._id),
    subject: String(topic.subject),
    parent: topic.parent ? String(topic.parent) : null,
    depth: topic.depth,
    name: topic.name,
    slug: topic.slug,
    description: topic.description ?? null,
    status: topic.status,
    displayOrder: topic.displayOrder,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

/**
 * Reading the taxonomy needs only `questions:read`, which every student holds: the
 * subject and topic lists are what a practice or exam filter is built from, and they
 * carry no answer data. Writing needs `taxonomy:write`, which no student has.
 */
router.get(
  '/subjects',
  requirePermission('questions:read'),
  validate({ query: listSubjectsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { status } = req.query as unknown as ListSubjectsQuery;
      const subjects = await listSubjects(status);
      sendSuccess(res, 200, { subjects: subjects.map(subjectView) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to list subjects', fallback: 'Could not load subjects. Please try again.' });
    }
  },
);

router.post(
  '/admin/subjects',
  requirePermission('taxonomy:write'),
  validate({ body: createSubjectSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as CreateSubjectInput;
      const subject = await createSubject(input, actorFrom(req));

      await recordAudit(req, {
        action: 'subject.changed',
        targetType: 'subject',
        targetId: String(subject._id),
        targetLabel: subject.name,
        metadata: { operation: 'created' },
      });

      sendSuccess(res, 201, { subject: subjectView(subject) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to create subject', fallback: 'Could not create that subject. Please try again.' });
    }
  },
);

router.patch(
  '/admin/subjects/:id',
  requirePermission('taxonomy:write'),
  validate({ params: taxonomyIdParamSchema, body: updateSubjectSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as UpdateSubjectInput;
      const { id } = req.params as unknown as { id: string };
      const subject = await updateSubject(id, input);

      await recordAudit(req, {
        action: 'subject.changed',
        targetType: 'subject',
        targetId: String(subject._id),
        targetLabel: subject.name,
        metadata: { operation: 'updated', fields: Object.keys(input) },
      });

      sendSuccess(res, 200, { subject: subjectView(subject) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to update subject', fallback: 'Could not update that subject. Please try again.' });
    }
  },
);

// ---------------------------------------------------------------------------
// Topics and subtopics — one collection, distinguished by `parent`
// ---------------------------------------------------------------------------

router.get(
  '/topics',
  requirePermission('questions:read'),
  validate({ query: listTopicsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { subject, parent, status } = req.query as unknown as ListTopicsQuery;
      const topics = await listTopics({
        subject,
        // `root` is the sentinel for "top-level only"; see listTopicsQuerySchema.
        parent: parent === undefined ? undefined : parent === 'root' ? null : parent,
        status,
      });
      sendSuccess(res, 200, { topics: topics.map(topicView) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to list topics', fallback: 'Could not load topics. Please try again.' });
    }
  },
);

router.post(
  '/admin/topics',
  requirePermission('taxonomy:write'),
  validate({ body: createTopicSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as CreateTopicInput;
      const topic = await createTopic(
        {
          subject: input.subject,
          parent: input.parent ?? null,
          name: input.name,
          description: input.description,
          displayOrder: input.displayOrder,
        },
        actorFrom(req),
      );

      await recordAudit(req, {
        action: 'topic.changed',
        targetType: 'topic',
        targetId: String(topic._id),
        targetLabel: topic.name,
        metadata: { operation: 'created', depth: topic.depth, subject: String(topic.subject) },
      });

      sendSuccess(res, 201, { topic: topicView(topic) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to create topic', fallback: 'Could not create that topic. Please try again.' });
    }
  },
);

/**
 * Several chapters at once, by name, under the implicit subject.
 *
 * ## Why this exists
 *
 * A bulk import refuses any row naming a chapter the bank does not have, and that refusal is
 * correct and stays — an importer never creates taxonomy, because one bad spreadsheet must not be
 * able to reshape the syllabus. But the advice it gave ("create it under Chapters first") was a
 * dead end for a real file: an NCERT Class 9 paper names ten chapters a Class-12-seeded bank has
 * never heard of, and the examiner was being asked to retype all ten by hand, spelled exactly,
 * into a one-field form — with the rejected rows unreachable from the review screen.
 *
 * The safety property was never "typing is hard enough to be a control". It was **the examiner
 * reads an explicit list of what will be created before anything is**. This keeps that: the import
 * preview writes nothing, shows the distinct names it could not resolve, and this route is only
 * reached by a deliberate action on that list. Reading "Polynomails" in a list of ten is what
 * catches it; retyping it does not.
 *
 * ## Partial success is the normal outcome
 *
 * Per-name results and **200**, never a 400 — the same shape and the same reasoning as
 * `changeQuestionStatusBulk()`. A name that already exists is reported as `existing` rather than
 * failed, because two examiners importing overlapping papers is ordinary and the caller's intent
 * ("make sure these chapters exist") is satisfied either way.
 */
router.post(
  '/admin/chapters/bulk',
  requirePermission('taxonomy:write'),
  validate({ body: createChaptersSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { names } = req.body as CreateChaptersInput;

      // Insisting rather than tolerating: this is a write, and a chapter filed under a guessed
      // subject is invisible to every filter a user can construct.
      const subject = await requireImplicitSubject();

      const existingRows = await listTopics({ subject: String(subject), parent: null });
      const existing = new Map(existingRows.map((row) => [row.name.trim().toLowerCase(), row]));

      const created: Array<{ name: string; id: string }> = [];
      const alreadyThere: string[] = [];
      const failed: Array<{ name: string; reason: string }> = [];

      /**
       * A loop, deliberately, not an `insertMany`.
       *
       * `createTopic()` owns the rules — the subject must exist and not be archived, the name must
       * be unique within it — and a bulk insert would skip all of them. One bad name must fail
       * alone rather than taking the other nine with it, which is exactly what the examiner needs
       * when one of ten is a typo.
       */
      for (const name of names) {
        const key = name.trim().toLowerCase();
        const found = existing.get(key);
        if (found) {
          alreadyThere.push(found.name);
          continue;
        }

        try {
          const topic = await createTopic({ subject: String(subject), parent: null, name }, actorFrom(req));
          created.push({ name: topic.name, id: String(topic._id) });
          existing.set(key, topic);

          await recordAudit(req, {
            action: 'topic.changed',
            targetType: 'topic',
            targetId: String(topic._id),
            targetLabel: topic.name,
            metadata: { operation: 'created', depth: 0, subject: String(topic.subject), bulk: true },
          });
        } catch (err) {
          failed.push({
            name,
            reason: err instanceof ApiError ? err.message : 'Could not create that chapter.',
          });
        }
      }

      sendSuccess(res, 200, { created, existing: alreadyThere, failed });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to create chapters in bulk',
        fallback: 'Could not create those chapters. Please try again.',
      });
    }
  },
);

router.patch(
  '/admin/topics/:id',
  requirePermission('taxonomy:write'),
  validate({ params: taxonomyIdParamSchema, body: updateTopicSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as UpdateTopicInput;
      const { id } = req.params as unknown as { id: string };
      const topic = await updateTopic(id, input);

      await recordAudit(req, {
        action: 'topic.changed',
        targetType: 'topic',
        targetId: String(topic._id),
        targetLabel: topic.name,
        metadata: { operation: 'updated', fields: Object.keys(input) },
      });

      sendSuccess(res, 200, { topic: topicView(topic) });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to update topic', fallback: 'Could not update that topic. Please try again.' });
    }
  },
);

export default router;
