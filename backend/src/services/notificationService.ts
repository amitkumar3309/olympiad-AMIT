import type { PipelineStage, Types } from 'mongoose';
import {
  Notification,
  NotificationRead,
  Student,
  type NotificationDocument,
  type NotificationSource,
  type EmailCategory,
  type StudentDocument,
} from '../models';
import type { ClassLevel } from '../lib/classLevels';
import { logger } from '../lib/logger';
import { enqueueEmail } from './emailOutbox';
import { buildNotificationEmail } from '../lib/email';
import {
  SYSTEM_EVENT_DEFINITIONS,
  isOptionalCategory,
  type SystemEvent,
  type NotificationCopy,
} from '../lib/systemNotifications';

/**
 * Who a published notification reaches, expressed as a query rather than a fan-out.
 *
 * This is the whole design in one function. A notification is one document with an
 * audience *rule*; a student's inbox is that rule evaluated at read time. Nothing
 * is written per recipient at publish time, which means:
 *
 *  - publishing to the whole roll writes one document, not one per student;
 *  - a student who registers tomorrow sees the announcement written today, the way
 *    a notice board works, rather than missing it because the fan-out already ran;
 *  - changing a student's class changes which announcements they see, correctly.
 *
 * A student with no `classLevel` (the bootstrap super admin, or a legacy account
 * from before Milestone 4) matches only `audience: 'all'` — `$in` with `undefined`
 * would be a type error waiting to happen, so the class clause is added only when
 * there is a class.
 *
 * **Milestone 14 added the third clause**, `audience: 'student'`, and it is the only
 * one keyed on identity. It has to be scoped by `student` and nothing else: a
 * per-student notice says things like a rank and a certificate tier, so a filter that
 * leaked one row across the class boundary would be a disclosure bug, not a display
 * bug. Note that this remains **one** definition of visibility, shared by the inbox,
 * the unread count and the mark-as-read check — three readers that must not be able
 * to disagree about what a student may see.
 */
export function inboxFilter(student: Types.ObjectId, classLevel: ClassLevel | null | undefined) {
  const audiences: Array<Record<string, unknown>> = [{ audience: 'all' }, { audience: 'student', student }];
  if (classLevel) audiences.push({ audience: 'class', classLevel });
  return { isPublished: true, $or: audiences };
}

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  kind: string;
  audience: string;
  classLevel: string | null;
  /** `staff` or `system` — the inbox badges them differently. */
  source: NotificationSource;
  /** Relative app path, or null. */
  link: string | null;
  publishedAt: Date | null;
  read: boolean;
  readAt: Date | null;
}

/**
 * One page of a student's inbox, with real read state.
 *
 * Read state is joined in a **second query over the page**, not a `$lookup` per
 * document and not a boolean stored on the notification. Twenty ids is a trivially
 * small `$in`, and keeping it out of the main query means the inbox query stays the
 * same shape as the unread count's — two things that must agree about what "unread"
 * means, and now cannot disagree because they share `inboxFilter()`.
 */
export async function listInbox(
  student: Types.ObjectId,
  classLevel: ClassLevel | null | undefined,
  options: { page: number; limit: number; unreadOnly: boolean },
): Promise<{ items: InboxItem[]; total: number }> {
  const filter = inboxFilter(student, classLevel);

  if (!options.unreadOnly) {
    const [docs, total] = await Promise.all([
      Notification.find(filter)
        .sort({ publishedAt: -1, _id: -1 })
        .skip((options.page - 1) * options.limit)
        .limit(options.limit),
      Notification.countDocuments(filter),
    ]);
    return { items: await withReadState(student, docs), total };
  }

  // "Unread only" cannot be a filter on the notification, because read state lives
  // in another collection — so it is an anti-join: every id this student has read,
  // excluded. Bounded by how many they have read, which is bounded by how many
  // exist, and the alternative (paging the full list and filtering in memory)
  // returns short pages.
  const readIds = await NotificationRead.find({ student }).distinct('notification');
  const unreadFilter = { ...filter, _id: { $nin: readIds } };

  const [docs, total] = await Promise.all([
    Notification.find(unreadFilter)
      .sort({ publishedAt: -1, _id: -1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit),
    Notification.countDocuments(unreadFilter),
  ]);

  return {
    items: docs.map((doc) => toInboxItem(doc, null)),
    total,
  };
}

async function withReadState(student: Types.ObjectId, docs: NotificationDocument[]): Promise<InboxItem[]> {
  if (docs.length === 0) return [];

  const reads = await NotificationRead.find({
    student,
    notification: { $in: docs.map((doc) => doc._id) },
  });
  const readAtById = new Map(reads.map((row) => [String(row.notification), row.readAt]));

  return docs.map((doc) => toInboxItem(doc, readAtById.get(String(doc._id)) ?? null));
}

function toInboxItem(doc: NotificationDocument, readAt: Date | null): InboxItem {
  return {
    id: String(doc._id),
    title: doc.title,
    body: doc.body,
    kind: doc.kind,
    audience: doc.audience,
    classLevel: doc.classLevel ?? null,
    source: doc.source,
    link: doc.link ?? null,
    publishedAt: doc.publishedAt ?? null,
    read: readAt !== null,
    readAt,
  };
}

/**
 * How many published announcements this student has not opened.
 *
 * Counted, not estimated: the number on the bell is the number of rows the inbox
 * will show under "unread", because both come from `inboxFilter()`.
 */
export async function unreadCount(
  student: Types.ObjectId,
  classLevel: ClassLevel | null | undefined,
): Promise<number> {
  const readIds = await NotificationRead.find({ student }).distinct('notification');
  return Notification.countDocuments({ ...inboxFilter(student, classLevel), _id: { $nin: readIds } });
}

/**
 * Whether one notification is visible to one student.
 *
 * Composed from `inboxFilter()` rather than re-deriving the three audience cases, so
 * "may I mark this read?" cannot drift from "is this in my inbox?". Before Milestone
 * 14 the mark-as-read route hand-wrote that comparison, which was correct for two
 * audiences and would have silently excluded the third.
 */
export async function isVisibleTo(
  notificationId: string,
  student: Types.ObjectId,
  classLevel: ClassLevel | null | undefined,
): Promise<NotificationDocument | null> {
  return Notification.findOne({ _id: notificationId, ...inboxFilter(student, classLevel) });
}

/**
 * How many students have opened each of a set of announcements.
 *
 * Feeds the admin list's "read by N" column, which is the only honest measure of
 * whether an announcement landed. One grouped aggregation for the whole page rather
 * than a count per row.
 */
export async function readCountsFor(notificationIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (notificationIds.length === 0) return new Map();

  const pipeline: PipelineStage[] = [
    { $match: { notification: { $in: notificationIds } } },
    { $group: { _id: '$notification', count: { $sum: 1 } } },
  ];
  const rows = await NotificationRead.aggregate<{ _id: Types.ObjectId; count: number }>(pipeline);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

// ---------------------------------------------------------------------------
// Preferences (Milestone 14)
// ---------------------------------------------------------------------------

export interface NotificationPrefs {
  announcements: boolean;
  results: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = { announcements: true, results: true };

/**
 * The stored preferences, or the defaults for an account that has never set them.
 *
 * Missing means "never chose", and the default is **on**: a student who registered
 * before Milestone 14 was already receiving everything the platform sent, so
 * defaulting to off would silently take something away from them. New accounts get
 * the schema defaults, which are the same values.
 */
export function resolvePrefs(student: Pick<StudentDocument, 'notificationPrefs'>): NotificationPrefs {
  return {
    announcements: student.notificationPrefs?.announcements ?? DEFAULT_PREFS.announcements,
    results: student.notificationPrefs?.results ?? DEFAULT_PREFS.results,
  };
}

/**
 * THE only place a preference is interpreted. Four rules, in order:
 *
 *  1. **A non-optional category always sends.** `transactional` is the mechanism of
 *     using the account; `security` is how somebody notices a compromise. Neither is
 *     a preference, and `isOptionalCategory()` is what says so.
 *  2. **There must be an address.** Guarded rather than assumed, because the
 *     bootstrap staff account and any pre-Milestone-2 document may have none.
 *  3. **The account must be in good standing.** A suspended or deactivated account
 *     stops receiving optional mail — it is not participating, and continuing to
 *     email it is how a platform ends up looking like a spammer to a free-tier
 *     provider whose reputation limits are the actual constraint here.
 *  4. **Then, and only then, the student's own choice.**
 *
 * Rule 1 sits before rule 3 deliberately: a *suspension notice* is the one message a
 * suspended account absolutely must still receive, and reordering these would swallow
 * exactly that.
 */
export function emailAllowedFor(
  student: Pick<StudentDocument, 'email' | 'status' | 'notificationPrefs'>,
  category: EmailCategory,
): boolean {
  if (!student.email) return false;
  if (!isOptionalCategory(category)) return true;
  if (student.status !== 'active') return false;

  const prefs = resolvePrefs(student);
  return category === 'announcement' ? prefs.announcements : prefs.results;
}

// ---------------------------------------------------------------------------
// System notifications (Milestone 14)
// ---------------------------------------------------------------------------

export interface PostSystemNotificationInput {
  event: SystemEvent;
  copy: NotificationCopy;
  /** Exactly one of these. A per-student notice must never be broadcast. */
  target:
    | { audience: 'student'; student: StudentDocument }
    | { audience: 'class'; classLevel: ClassLevel }
    | { audience: 'all' };
  /**
   * Idempotency key. Strongly recommended for anything an administrator can trigger
   * twice — without it, a second click posts a second identical notice.
   */
  dedupeKey?: string | null;
}

export interface PostOutcome {
  posted: boolean;
  emailQueued: boolean;
  reason?: 'duplicate' | 'error' | 'email-suppressed' | 'no-email-channel';
}

/**
 * THE only way the platform tells a student something on its own.
 *
 * Callers supply *facts about what happened* — the event, the wording, who it is for —
 * and this decides the rest: whether it may also be emailed, whether the recipient
 * wants that, and how to keep a repeated administrative action from saying it twice.
 * That is the same division of labour as `grantReward()`, and it exists for the same
 * reason: a seventh call site must not be able to invent a seventh policy.
 *
 * **Never throws.** A notification is a side effect of something that already
 * succeeded — results were published, a password was changed — and failing that
 * action because the notice could not be written would be a worse outcome than the
 * missing notice. Same rule as `recordAudit()`. The honest cost is that a lost
 * notification is invisible except in the log; the email half is *not* subject to
 * this, because the outbox keeps its own durable record.
 */
export async function postSystemNotification(input: PostSystemNotificationInput): Promise<PostOutcome> {
  const definition = SYSTEM_EVENT_DEFINITIONS[input.event];

  try {
    await Notification.create({
      title: input.copy.title,
      body: input.copy.body,
      kind: definition.kind,
      audience: input.target.audience,
      classLevel: input.target.audience === 'class' ? input.target.classLevel : null,
      student: input.target.audience === 'student' ? input.target.student._id : null,
      source: 'system' satisfies NotificationSource,
      event: input.event,
      link: definition.link,
      dedupeKey: input.dedupeKey ?? null,
      // A system notification is published the instant it is created. There is no
      // draft state for something that already happened.
      isPublished: true,
      publishedAt: new Date(),
      createdByLabel: 'System',
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // The event was already announced. This is the guard that makes re-releasing
      // an exam's results safe, and it is an index rather than a check because two
      // concurrent invocations would both pass a check.
      return { posted: false, emailQueued: false, reason: 'duplicate' };
    }
    logger.error({ err, event: input.event }, 'Could not post a system notification');
    return { posted: false, emailQueued: false, reason: 'error' };
  }

  if (!definition.emailCategory) return { posted: true, emailQueued: false, reason: 'no-email-channel' };
  if (input.target.audience !== 'student') {
    // A broadcast is never auto-emailed. Emailing a class or the whole roll is the
    // free-tier deliverability problem Milestone 12 declined to create, so it stays
    // an explicit, capped, staff-initiated act — see `broadcastAnnouncementEmail()`.
    return { posted: true, emailQueued: false, reason: 'no-email-channel' };
  }

  const recipient = input.target.student;
  if (!emailAllowedFor(recipient, definition.emailCategory)) {
    return { posted: true, emailQueued: false, reason: 'email-suppressed' };
  }

  const queued = await enqueueEmail({
    ...buildNotificationEmail({
      to: recipient.email,
      title: input.copy.title,
      body: input.copy.body,
      link: definition.link,
      actionLabel: definition.actionLabel,
      manageable: isOptionalCategory(definition.emailCategory),
    }),
    category: definition.emailCategory,
    student: recipient._id as Types.ObjectId,
    // Scoped to the event, so the notification and its email are deduped by the
    // same key and cannot end up one-without-the-other on a retry.
    dedupeKey: input.dedupeKey ? `email:${input.dedupeKey}` : null,
  });

  return { posted: true, emailQueued: queued.queued };
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Queues one email per recipient of a staff announcement.
 *
 * This is the only genuine fan-out in the notification system, and it is a fan-out of
 * *email rows* rather than of notifications — the announcement itself is still one
 * document with an audience rule. There is no way around it: SMTP has no broadcast,
 * so a hundred recipients is a hundred messages however they are stored.
 *
 * Which is exactly why it is **capped and opt-in**. Milestone 12's reasoning was that
 * emailing the whole roll from a free tier is a deliverability problem, and that has
 * not changed; what changed is that staff can now decide, per announcement, that a
 * particular notice is worth it. The cap makes the ceiling explicit instead of
 * discovering it as a provider suspension.
 *
 * Suppressed recipients are counted and reported rather than silently dropped, so the
 * composer can tell staff "60 queued, 12 have these emails switched off" — which is
 * the difference between a feature that looks broken and one that explains itself.
 */
export const EMAIL_BROADCAST_CAP = 500;

export interface BroadcastOutcome {
  recipients: number;
  queued: number;
  suppressed: number;
  cappedAt: number | null;
}

export async function broadcastAnnouncementEmail(
  notification: NotificationDocument,
): Promise<BroadcastOutcome> {
  // Only entrants, and only accounts that can actually act on the news.
  const filter: Record<string, unknown> = { role: 'student', status: 'active' };
  if (notification.audience === 'class') filter.classLevel = notification.classLevel;

  const recipients = await Student.find(filter)
    .select('email status notificationPrefs')
    .limit(EMAIL_BROADCAST_CAP + 1);

  const cappedAt = recipients.length > EMAIL_BROADCAST_CAP ? EMAIL_BROADCAST_CAP : null;
  const deliverTo = cappedAt === null ? recipients : recipients.slice(0, EMAIL_BROADCAST_CAP);

  let queued = 0;
  let suppressed = 0;

  for (const recipient of deliverTo) {
    if (!emailAllowedFor(recipient, 'announcement')) {
      suppressed += 1;
      continue;
    }

    const result = await enqueueEmail({
      ...buildNotificationEmail({
        to: recipient.email,
        title: notification.title,
        body: notification.body,
        link: notification.link ?? '/notifications',
        actionLabel: 'Open my inbox',
        manageable: true,
      }),
      category: 'announcement',
      student: recipient._id as Types.ObjectId,
      // One message per student per announcement, whatever staff click. Re-publishing
      // an announcement must not email the same person twice.
      dedupeKey: `announcement:${String(notification._id)}:${String(recipient._id)}`,
    });

    if (result.queued) queued += 1;
  }

  return { recipients: deliverTo.length, queued, suppressed, cappedAt };
}
