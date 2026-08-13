import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import {
  Notification,
  NotificationRead,
  Student,
  type NotificationAudience,
  type NotificationDocument,
} from '../../models';
import type { ClassLevel } from '../../lib/classLevels';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { recordAudit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { listInbox, unreadCount, readCountsFor } from '../../services/notificationService';
import {
  createNotificationSchema,
  updateNotificationSchema,
  listNotificationsQuerySchema,
  inboxQuerySchema,
  idParamSchema,
  type CreateNotificationInput,
  type UpdateNotificationInput,
  type ListNotificationsQuery,
  type InboxQuery,
} from '../../validation/contentSchemas';

/**
 * In-app announcements (Milestone 12).
 *
 * Staff write one document; every matching student's inbox is a query against its
 * audience rule at read time. See `services/notificationService.ts` for why nothing
 * is fanned out per recipient.
 *
 * The student half is an **identity** gate (`requireAuth()`), like the rest of
 * `/me`: an inbox is yours because it is yours, not because of a capability. The
 * staff half is `notifications:write`.
 */
const router = Router();

// ---------------------------------------------------------------------------
// The student's inbox
// ---------------------------------------------------------------------------

/** The caller's own account, for the class their inbox is filtered by. */
async function callerClassLevel(req: Request): Promise<{ id: Types.ObjectId; classLevel: ClassLevel | null } | null> {
  const account = await Student.findById(req.user!.sub).select('classLevel');
  if (!account) return null;
  return { id: account._id as Types.ObjectId, classLevel: account.classLevel ?? null };
}

router.get(
  '/me/notifications',
  requireAuth(),
  validate({ query: inboxQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, unreadOnly } = req.query as unknown as InboxQuery;
      const caller = await callerClassLevel(req);
      if (!caller) {
        sendError(res, 404, 'Your account could not be found.');
        return;
      }

      const { items, total } = await listInbox(caller.id, caller.classLevel, {
        page,
        limit,
        unreadOnly: unreadOnly === 'true',
      });

      sendSuccess(res, 200, {
        notifications: items,
        unread: await unreadCount(caller.id, caller.classLevel),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to load the inbox');
      sendError(res, 500, 'Could not load your notifications right now.');
    }
  },
);

/** Just the badge number, for the bell. Cheap enough to poll. */
router.get('/me/notifications/unread-count', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const caller = await callerClassLevel(req);
    if (!caller) {
      sendError(res, 404, 'Your account could not be found.');
      return;
    }
    sendSuccess(res, 200, { unread: await unreadCount(caller.id, caller.classLevel) });
  } catch (err) {
    logger.error({ err }, 'Failed to count unread notifications');
    sendError(res, 500, 'Could not load your notifications right now.');
  }
});

/**
 * Marks one announcement read.
 *
 * An upsert, not an insert: the unique index on `{student, notification}` is what
 * makes this idempotent, so a double-tapped button, a replayed request or two open
 * tabs cannot create two rows or return an error the user did nothing to cause.
 *
 * Only a notification the caller can actually see may be marked — otherwise the
 * route would be a way to probe which ids exist.
 */
router.post(
  '/me/notifications/:id/read',
  requireAuth(),
  validate({ params: idParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const caller = await callerClassLevel(req);
      if (!caller) {
        sendError(res, 404, 'Your account could not be found.');
        return;
      }

      const notification = await Notification.findById(req.params.id);
      const visible =
        notification?.isPublished &&
        (notification.audience === 'all' ||
          (notification.audience === 'class' && notification.classLevel === caller.classLevel));

      if (!visible) {
        sendError(res, 404, 'No notification with that id.');
        return;
      }

      await NotificationRead.updateOne(
        { student: caller.id, notification: notification!._id },
        { $setOnInsert: { readAt: new Date() } },
        { upsert: true },
      );

      sendSuccess(res, 200, { read: true, unread: await unreadCount(caller.id, caller.classLevel) });
    } catch (err) {
      logger.error({ err }, 'Failed to mark a notification read');
      sendError(res, 500, 'Could not update that notification.');
    }
  },
);

/** Marks everything currently in the inbox read. One write per unread item. */
router.post('/me/notifications/read-all', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const caller = await callerClassLevel(req);
    if (!caller) {
      sendError(res, 404, 'Your account could not be found.');
      return;
    }

    const { items } = await listInbox(caller.id, caller.classLevel, { page: 1, limit: 100, unreadOnly: true });
    if (items.length > 0) {
      await NotificationRead.bulkWrite(
        items.map((item) => ({
          updateOne: {
            filter: { student: caller.id, notification: item.id },
            update: { $setOnInsert: { readAt: new Date() } },
            upsert: true,
          },
        })),
      );
    }

    sendSuccess(res, 200, { marked: items.length, unread: await unreadCount(caller.id, caller.classLevel) });
  } catch (err) {
    logger.error({ err }, 'Failed to mark all notifications read');
    sendError(res, 500, 'Could not update your notifications.');
  }
});

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

function adminNotificationView(doc: NotificationDocument, readCount: number) {
  return {
    id: String(doc._id),
    title: doc.title,
    body: doc.body,
    kind: doc.kind,
    audience: doc.audience,
    classLevel: doc.classLevel ?? null,
    isPublished: doc.isPublished,
    publishedAt: doc.publishedAt ?? null,
    createdByLabel: doc.createdByLabel ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? null,
    /** How many students have actually opened it — the only honest reach figure. */
    readCount,
  };
}

interface NotificationFilter {
  audience?: NotificationAudience;
  classLevel?: ClassLevel;
  isPublished?: boolean;
  $or?: Array<{ title?: RegExp } | { body?: RegExp }>;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get(
  '/admin/notifications',
  requirePermission('notifications:write'),
  validate({ query: listNotificationsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, audience, classLevel, published, search } = req.query as unknown as ListNotificationsQuery;

      const filter: NotificationFilter = {};
      if (audience) filter.audience = audience;
      if (classLevel) filter.classLevel = classLevel;
      if (published) filter.isPublished = published === 'true';
      if (search) {
        const pattern = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ title: pattern }, { body: pattern }];
      }

      const [docs, total] = await Promise.all([
        Notification.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Notification.countDocuments(filter),
      ]);

      const counts = await readCountsFor(docs.map((doc) => doc._id as Types.ObjectId));

      sendSuccess(res, 200, {
        notifications: docs.map((doc) => adminNotificationView(doc, counts.get(String(doc._id)) ?? 0)),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list notifications');
      sendError(res, 500, 'Could not load announcements. Please try again.');
    }
  },
);

router.post(
  '/admin/notifications',
  requirePermission('notifications:write'),
  validate({ body: createNotificationSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as CreateNotificationInput;
      const isPublished = input.isPublished ?? false;

      const doc = await Notification.create({
        title: input.title,
        body: input.body,
        kind: input.kind ?? 'announcement',
        audience: input.audience ?? 'all',
        classLevel: input.audience === 'class' ? (input.classLevel ?? null) : null,
        isPublished,
        // Set at the moment of publication, not creation: a draft written last week
        // and published today should sort as today's news.
        publishedAt: isPublished ? new Date() : null,
        createdBy: req.user?.sub ?? null,
        createdByLabel: req.user?.studentId ?? req.user?.email ?? null,
      });

      await recordAudit(req, {
        action: 'notification.changed',
        targetType: 'notification',
        targetId: String(doc._id),
        targetLabel: doc.title,
        metadata: { operation: isPublished ? 'published' : 'drafted', audience: doc.audience, classLevel: doc.classLevel },
      });

      sendSuccess(res, 201, { notification: adminNotificationView(doc, 0) });
    } catch (err) {
      logger.error({ err }, 'Failed to create a notification');
      sendError(res, 500, 'Could not save that announcement. Please try again.');
    }
  },
);

router.patch(
  '/admin/notifications/:id',
  requirePermission('notifications:write'),
  validate({ params: idParamSchema, body: updateNotificationSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const updates = req.body as UpdateNotificationInput;
      const doc = await Notification.findById(req.params.id);
      if (!doc) {
        sendError(res, 404, 'No announcement with that id.');
        return;
      }

      const wasPublished = doc.isPublished;

      if (updates.title !== undefined) doc.title = updates.title;
      if (updates.body !== undefined) doc.body = updates.body;
      if (updates.kind !== undefined) doc.kind = updates.kind;
      if (updates.audience !== undefined) doc.audience = updates.audience;
      if (updates.classLevel !== undefined) doc.classLevel = updates.classLevel;
      // Keep the two fields consistent however they were edited: an announcement
      // switched back to `all` must not keep a stale class on it.
      if (doc.audience === 'all') doc.classLevel = null;

      if (updates.isPublished !== undefined) {
        doc.isPublished = updates.isPublished;
        // First publication stamps the date; withdrawing and republishing keeps the
        // original, because it is the same announcement.
        if (updates.isPublished && !doc.publishedAt) doc.publishedAt = new Date();
      }
      doc.updatedAt = new Date();
      await doc.save();

      const operation = !wasPublished && doc.isPublished ? 'published' : wasPublished && !doc.isPublished ? 'withdrawn' : 'updated';

      await recordAudit(req, {
        action: 'notification.changed',
        targetType: 'notification',
        targetId: String(doc._id),
        targetLabel: doc.title,
        metadata: { operation, audience: doc.audience, classLevel: doc.classLevel },
      });

      const counts = await readCountsFor([doc._id as Types.ObjectId]);
      sendSuccess(res, 200, { notification: adminNotificationView(doc, counts.get(String(doc._id)) ?? 0) });
    } catch (err) {
      logger.error({ err }, 'Failed to update a notification');
      sendError(res, 500, 'Could not update that announcement. Please try again.');
    }
  },
);

/**
 * Deletes an announcement and every read receipt for it.
 *
 * The receipts go too because they are meaningless without the notification they
 * point at — and leaving them would make the unread count wrong for anybody who had
 * read it, since the anti-join would exclude an id that no longer exists.
 */
router.delete(
  '/admin/notifications/:id',
  requirePermission('notifications:write'),
  validate({ params: idParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const doc = await Notification.findById(req.params.id);
      if (!doc) {
        sendError(res, 404, 'No announcement with that id.');
        return;
      }

      const snapshot = { id: String(doc._id), title: doc.title, wasPublished: doc.isPublished };
      await NotificationRead.deleteMany({ notification: doc._id });
      await Notification.deleteOne({ _id: doc._id });

      await recordAudit(req, {
        action: 'notification.changed',
        targetType: 'notification',
        targetId: snapshot.id,
        targetLabel: snapshot.title,
        metadata: { operation: 'deleted', wasPublished: snapshot.wasPublished },
      });

      sendSuccess(res, 200, { deleted: true, notification: snapshot });
    } catch (err) {
      logger.error({ err }, 'Failed to delete a notification');
      sendError(res, 500, 'Could not delete that announcement. Please try again.');
    }
  },
);

export default router;
