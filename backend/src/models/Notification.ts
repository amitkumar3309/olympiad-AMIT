import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';

export const NOTIFICATION_AUDIENCES = ['all', 'class'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_KINDS = ['announcement', 'alert'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * An in-app announcement written by staff.
 *
 * ## Why nothing is fanned out
 *
 * A notification is **one document**, not one per recipient. The alternative — a
 * row per student at publish time — would write thousands of documents for a single
 * announcement, and would silently miss anybody who registered afterwards. Instead
 * the audience is stored as a *rule* (`all`, or a single class) and each student's
 * inbox is a query against that rule at read time. A student who joins tomorrow
 * sees the announcement that was written today, which is what a notice board does.
 *
 * The cost is that "who has read this" cannot live here, because there is no row
 * per recipient to mark. That is what `NotificationRead` is for.
 *
 * ## Why there is no delivery channel
 *
 * In-app only, by the owner's decision. Email broadcast to the whole roll is a
 * deliverability and provider-limit problem on a free tier, and the entrants are
 * schoolchildren whose addresses are often their parents'. If email is ever added,
 * it belongs behind this same model rather than as a second way to say the thing.
 */
export interface NotificationDocument extends Document {
  title: string;
  body: string;
  kind: NotificationKind;
  audience: NotificationAudience;
  /** Set only when `audience` is `class`; null for `all`. */
  classLevel?: ClassLevel | null;
  /**
   * Unpublished notifications are drafts — invisible to students, editable by
   * staff. Publishing is the moment it appears on every matching inbox.
   */
  isPublished: boolean;
  publishedAt?: Date | null;
  createdBy?: Types.ObjectId | null;
  createdByLabel?: string | null;
  createdAt: Date;
  updatedAt?: Date | null;
}

const notificationSchema = new Schema<NotificationDocument>({
  title: { type: String, required: true, trim: true, maxlength: 150 },
  body: { type: String, required: true, trim: true, maxlength: 2000 },
  kind: { type: String, enum: NOTIFICATION_KINDS, default: 'announcement' },
  audience: { type: String, enum: NOTIFICATION_AUDIENCES, default: 'all', index: true },
  classLevel: { type: String, enum: CLASS_LEVELS, default: null },
  isPublished: { type: Boolean, default: false, index: true },
  publishedAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  createdByLabel: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: null },
});

// A student's inbox is "published, addressed to me, newest first".
notificationSchema.index({ isPublished: 1, publishedAt: -1 });

export const Notification = mongoose.model<NotificationDocument>('Notification', notificationSchema);

/**
 * That one student has read one notification.
 *
 * A separate collection rather than an array on the notification, for the reason
 * arrays always fail here: an announcement to every student would grow an unbounded
 * `readBy` array inside a single 16 MB document, and marking one read would rewrite
 * the whole thing. A row per (student, notification) is bounded, indexable, and
 * only exists for notifications somebody actually opened.
 *
 * The unique index is what makes "mark as read" idempotent — a double-tapped
 * button, a replayed request or two open tabs cannot create two rows.
 *
 * Deliberately **no TTL**: unlike the token collections, expiring a row would make
 * a notification the student has already read reappear as unread, which reads as a
 * bug rather than as tidying.
 */
export interface NotificationReadDocument extends Document {
  notification: Types.ObjectId;
  student: Types.ObjectId;
  readAt: Date;
}

const notificationReadSchema = new Schema<NotificationReadDocument>({
  notification: { type: Schema.Types.ObjectId, ref: 'Notification', required: true },
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  readAt: { type: Date, default: Date.now },
});

notificationReadSchema.index({ student: 1, notification: 1 }, { unique: true });

export const NotificationRead = mongoose.model<NotificationReadDocument>(
  'NotificationRead',
  notificationReadSchema,
);
