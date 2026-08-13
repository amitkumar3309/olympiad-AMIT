import type { PipelineStage, Types } from 'mongoose';
import { Notification, NotificationRead, type NotificationDocument } from '../models';
import type { ClassLevel } from '../lib/classLevels';

/**
 * Who a published announcement reaches, expressed as a query rather than a fan-out.
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
 */
export function inboxFilter(classLevel: ClassLevel | null | undefined) {
  const audiences: Array<Record<string, unknown>> = [{ audience: 'all' }];
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
  const filter = inboxFilter(classLevel);

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
  return Notification.countDocuments({ ...inboxFilter(classLevel), _id: { $nin: readIds } });
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
