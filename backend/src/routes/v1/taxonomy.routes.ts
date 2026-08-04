import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import type { SubjectDocument, TopicDocument } from '../../models';
import {
  createSubject,
  updateSubject,
  listSubjects,
  createTopic,
  updateTopic,
  listTopics,
  actorFrom,
} from '../../services/taxonomyService';
import {
  createSubjectSchema,
  updateSubjectSchema,
  createTopicSchema,
  updateTopicSchema,
  taxonomyIdParamSchema,
  listSubjectsQuerySchema,
  listTopicsQuerySchema,
  type CreateSubjectInput,
  type UpdateSubjectInput,
  type CreateTopicInput,
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
