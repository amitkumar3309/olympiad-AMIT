import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { config } from '../../config';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import {
  EmailOutbox,
  Notification,
  NotificationRead,
  Student,
  type EmailCategory,
  type EmailStatus,
  type NotificationAudience,
  type NotificationDocument,
  type NotificationSource,
} from '../../models';
import type { ClassLevel } from '../../lib/classLevels';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { recordAudit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import {
  broadcastAnnouncementEmail,
  isVisibleTo,
  listInbox,
  readCountsFor,
  resolvePrefs,
  unreadCount,
} from '../../services/notificationService';
import { drainOutbox, outboxRowView, outboxStats, retryFailed } from '../../services/emailOutbox';
import {
  createNotificationSchema,
  updateNotificationSchema,
  listNotificationsQuerySchema,
  listDeliveriesQuerySchema,
  inboxQuerySchema,
  idParamSchema,
  updateNotificationPrefsSchema,
  type CreateNotificationInput,
  type UpdateNotificationInput,
  type ListNotificationsQuery,
  type ListDeliveriesQuery,
  type InboxQuery,
  type UpdateNotificationPrefsInput,
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

      // Composed from `inboxFilter()` via `isVisibleTo()` rather than re-deriving the
      // audience cases here. This route used to hand-write the comparison, which was
      // correct for the two audiences that existed — and would have silently refused
      // every per-student notification Milestone 14 added, because a third case was
      // added in one place and not the other. One definition, three readers.
      const notification = await isVisibleTo(req.params.id as string, caller.id, caller.classLevel);
      if (!notification) {
        sendError(res, 404, 'No notification with that id.');
        return;
      }

      await NotificationRead.updateOne(
        { student: caller.id, notification: notification._id },
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
// Notification preferences (Milestone 14)
// ---------------------------------------------------------------------------

/**
 * The student's own email preferences.
 *
 * An identity gate, like the rest of `/me` — these are yours because they are yours.
 * The response states which streams are **not** switchable and why, rather than
 * silently offering only two toggles: a settings page that quietly omits security
 * email invites the question "does it email me about my password or not?", and the
 * honest answer is worth a line of JSON.
 */
router.get('/me/notification-preferences', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const account = await Student.findById(req.user!.sub).select('notificationPrefs');
    if (!account) {
      sendError(res, 404, 'Your account could not be found.');
      return;
    }

    sendSuccess(res, 200, {
      preferences: resolvePrefs(account),
      always: [
        { category: 'transactional', reason: 'Email verification and password reset links — the account cannot be used without them.' },
        { category: 'security', reason: 'Password changes and account status changes — these are how you would notice a problem.' },
      ],
      /** In-app is never suppressed, and the UI should say so plainly. */
      inAppAlwaysOn: true,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load notification preferences');
    sendError(res, 500, 'Could not load your notification preferences right now.');
  }
});

router.patch(
  '/me/notification-preferences',
  requireAuth(),
  validate({ body: updateNotificationPrefsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const updates = req.body as UpdateNotificationPrefsInput;
      const account = await Student.findById(req.user!.sub);
      if (!account) {
        sendError(res, 404, 'Your account could not be found.');
        return;
      }

      // Read through `resolvePrefs()` before writing, so an account that has never set
      // preferences gets an explicit object with the defaults it was already getting,
      // rather than a half-populated one.
      const current = resolvePrefs(account);
      account.notificationPrefs = {
        announcements: updates.announcements ?? current.announcements,
        results: updates.results ?? current.results,
      };
      await account.save();

      // Recorded like the other self-service changes: the audit trail names the fields
      // that changed and never their values beyond the switch itself.
      await recordAudit(req, {
        action: 'student.profile.updated',
        targetType: 'student',
        targetId: account.studentId,
        targetLabel: account.email,
        metadata: { self: true, fields: Object.keys(updates), area: 'notification-preferences' },
      });

      sendSuccess(res, 200, { preferences: resolvePrefs(account) });
    } catch (err) {
      logger.error({ err }, 'Failed to update notification preferences');
      sendError(res, 500, 'Could not save your notification preferences. Please try again.');
    }
  },
);

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
    source: doc.source,
    event: doc.event ?? null,
    link: doc.link ?? null,
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
  source?: NotificationSource;
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
      const { page, limit, audience, classLevel, published, source, search } =
        req.query as unknown as ListNotificationsQuery;

      const filter: NotificationFilter = {};
      if (audience) filter.audience = audience;
      if (classLevel) filter.classLevel = classLevel;
      if (published) filter.isPublished = published === 'true';
      // Defaults to the staff stream — see `listNotificationsQuerySchema` for why the
      // composer must not be buried under per-student system rows.
      if (source !== 'all') filter.source = source ?? 'staff';
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
        source: 'staff',
        createdBy: req.user?.sub ?? null,
        createdByLabel: req.user?.studentId ?? req.user?.email ?? null,
      });

      // Email only when published *and* explicitly asked for. A draft reaches nobody,
      // which is the whole point of a draft.
      const broadcast =
        isPublished && input.emailBroadcast === true ? await broadcastAnnouncementEmail(doc) : null;

      await recordAudit(req, {
        action: 'notification.changed',
        targetType: 'notification',
        targetId: String(doc._id),
        targetLabel: doc.title,
        metadata: {
          operation: isPublished ? 'published' : 'drafted',
          audience: doc.audience,
          classLevel: doc.classLevel,
          emailBroadcast: broadcast !== null,
          emailsQueued: broadcast?.queued ?? 0,
        },
      });

      sendSuccess(res, 201, { notification: adminNotificationView(doc, 0), broadcast });
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

      if (doc.source === 'system') {
        // A system notification is a record of something that happened. Editing its
        // text would turn it into a claim about something that did not — and the
        // in-app copy would then disagree with the email already delivered from it.
        // Deleting one is still allowed, because housekeeping is not falsification.
        sendError(res, 409, 'This notification was generated by the system and cannot be edited.');
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

      // Emailing on an update is what makes "write a draft, then publish it" work as
      // the normal path. It is safe to repeat: `broadcastAnnouncementEmail()` keys each
      // message on `{announcement, student}`, so publishing, withdrawing and
      // re-publishing does not email anybody twice.
      const broadcast =
        doc.isPublished && updates.emailBroadcast === true ? await broadcastAnnouncementEmail(doc) : null;

      await recordAudit(req, {
        action: 'notification.changed',
        targetType: 'notification',
        targetId: String(doc._id),
        targetLabel: doc.title,
        metadata: {
          operation,
          audience: doc.audience,
          classLevel: doc.classLevel,
          emailBroadcast: broadcast !== null,
          emailsQueued: broadcast?.queued ?? 0,
        },
      });

      const counts = await readCountsFor([doc._id as Types.ObjectId]);
      sendSuccess(res, 200, {
        notification: adminNotificationView(doc, counts.get(String(doc._id)) ?? 0),
        broadcast,
      });
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

// ---------------------------------------------------------------------------
// Email delivery (Milestone 14)
// ---------------------------------------------------------------------------

/**
 * The delivery log, gated on `notifications:write`.
 *
 * This exists because **a queue nobody can see is a queue nobody trusts**. Before
 * Milestone 14 a failed email left one line in a log file that only somebody with
 * server access could read, so "did the student get their verification link?" was
 * genuinely unanswerable from inside the product. Now it is a row with an attempt
 * count and the provider's own error message.
 *
 * The subject is listed; the body is not. A delivery record does not need to
 * reproduce the contents of somebody's password-reset email for staff to read.
 */
router.get(
  '/admin/email-deliveries',
  requirePermission('notifications:write'),
  validate({ query: listDeliveriesQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, status, category } = req.query as unknown as ListDeliveriesQuery;

      const filter: { status?: EmailStatus; category?: EmailCategory } = {};
      if (status) filter.status = status;
      if (category) filter.category = category;

      const [docs, total, stats] = await Promise.all([
        EmailOutbox.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        EmailOutbox.countDocuments(filter),
        outboxStats(),
      ]);

      sendSuccess(res, 200, {
        deliveries: docs.map(outboxRowView),
        stats,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        /**
         * Where the links in these emails point.
         *
         * Reported because a delivery console that only says "sent" answers the wrong
         * half of "did that student get their link?". A message can be delivered
         * perfectly and still be useless if `FRONTEND_URL` is unset, because then every
         * link is built against `http://localhost:5173` — dead for every recipient, and
         * invisible here until somebody thinks to read a server log.
         */
        linkBase: {
          url: config.publicAppUrl,
          /** False when a production deployment is emailing localhost links. */
          configured: !config.isProd || config.publicAppUrl !== 'http://localhost:5173',
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list email deliveries');
      sendError(res, 500, 'Could not load the delivery log. Please try again.');
    }
  },
);

/**
 * Flushes the queue now.
 *
 * Necessary rather than convenient: the free tier has no scheduler, so delivery is
 * driven by an opportunistic kick plus a sweep on later requests. On a quiet site
 * neither may happen soon, and "the mail goes out when somebody visits" is not a
 * promise an organiser can make to a parent. This makes the drain an explicit act.
 *
 * Bounded per call by `DRAIN_BATCH`, so the response reports what it moved and staff
 * can press it again. Safe to press twice — the claim is a conditional write, so two
 * concurrent drains cannot pick up the same row.
 */
router.post(
  '/admin/email-deliveries/drain',
  requirePermission('notifications:write'),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const outcome = await drainOutbox();
      logger.info({ ...outcome, actor: req.user?.email ?? req.user?.studentId }, 'Email outbox drained manually');
      sendSuccess(res, 200, { drain: outcome, stats: await outboxStats() });
    } catch (err) {
      logger.error({ err }, 'Manual outbox drain failed');
      sendError(res, 500, 'Could not send the queued email. Please try again.');
    }
  },
);

/**
 * Puts permanently-failed messages back in the queue.
 *
 * The counterpart to giving up after `maxAttempts`: that terminal state has to exist
 * or a dead address would be retried for ever, but somebody who has just corrected
 * their SMTP settings needs a way to say "try again" that is not editing the database
 * by hand.
 */
router.post(
  '/admin/email-deliveries/retry',
  requirePermission('notifications:write'),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const requeued = await retryFailed();
      await recordAudit(req, {
        action: 'notification.changed',
        targetType: 'notification',
        targetId: 'email-outbox',
        targetLabel: 'Failed email deliveries',
        metadata: { operation: 'retry-failed', requeued },
      });

      const drain = await drainOutbox();
      sendSuccess(res, 200, { requeued, drain, stats: await outboxStats() });
    } catch (err) {
      logger.error({ err }, 'Failed to requeue failed email');
      sendError(res, 500, 'Could not requeue those messages. Please try again.');
    }
  },
);

export default router;
