import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';

/**
 * `student` was added in Milestone 14 and is the one audience a *person* cannot be
 * given by the staff composer — it exists because a system notification is usually
 * about one student ("your results are out", "your password was changed"), and
 * broadcasting that to a class would be a data leak, not a notification.
 *
 * The staff schemas accept only `all` and `class`; see `STAFF_AUDIENCES`.
 */
export const NOTIFICATION_AUDIENCES = ['all', 'class', 'student'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/** What staff may address. Deliberately a subset — see above. */
export const STAFF_AUDIENCES = ['all', 'class'] as const;
export type StaffAudience = (typeof STAFF_AUDIENCES)[number];

export const NOTIFICATION_KINDS = ['announcement', 'alert'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Who wrote it. `system` rows are generated from real events and are **not
 * editable** — see the refusal in `notifications.routes.ts`. Editing the text of a
 * record of something that happened would turn it into a claim about something that
 * did not.
 */
export const NOTIFICATION_SOURCES = ['staff', 'system'] as const;
export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];

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
 * ## The delivery channel (changed in Milestone 14)
 *
 * Milestone 12 shipped this in-app only, on the reasoning that emailing the whole
 * roll is a deliverability and provider-limit problem on a free tier and that the
 * entrants are schoolchildren whose addresses are often their parents'. That
 * reasoning was right and still holds — which is why email did not simply get turned
 * on. It arrived under three constraints, and the note above predicted the shape:
 * email lives *behind* this model rather than beside it, so there is one record of
 * what was said.
 *
 *  - **In-app is the channel; email is an escalation.** Every notification is
 *    written here. Email is an extra copy of some of them, never an alternative, so
 *    a student who never opens their inbox and a student who never reads email both
 *    still have one place where everything is.
 *  - **A broadcast is emailed only when staff deliberately ask**, per announcement,
 *    and is capped. It is never the default.
 *  - **A student can switch the optional streams off**, and cannot switch off the
 *    security ones.
 *
 * Nothing about email is stored on this document. Delivery state belongs to
 * `EmailOutbox`, because "what we told them" and "whether the SMTP handshake worked"
 * are different facts with different lifetimes.
 */
export interface NotificationDocument extends Document {
  title: string;
  body: string;
  kind: NotificationKind;
  audience: NotificationAudience;
  /** Set only when `audience` is `class`; null otherwise. */
  classLevel?: ClassLevel | null;
  /** Set only when `audience` is `student`; null otherwise. */
  student?: Types.ObjectId | null;
  source: NotificationSource;
  /**
   * Which real event produced this, for a `system` row — a code from
   * `lib/systemNotifications.ts`. Null for anything a human wrote.
   */
  event?: string | null;
  /**
   * A **relative** in-app path (`/result`, `/my-certificates`), so the inbox and the
   * email can both offer "take me to it".
   *
   * Relative on purpose: an absolute URL stored on thousands of rows would still
   * point at the old host after a domain change, and a notification that links
   * somewhere dead is worse than one that links nowhere.
   */
  link?: string | null;
  /**
   * Application-level idempotency for system rows, e.g. `results:<examId>:<student>`.
   * Partial-unique, so re-running an administrative action cannot post the same
   * notice twice. Null for staff announcements, which may legitimately repeat.
   */
  dedupeKey?: string | null;
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
  student: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  source: { type: String, enum: NOTIFICATION_SOURCES, default: 'staff', index: true },
  event: { type: String, default: null },
  link: { type: String, default: null },
  dedupeKey: { type: String, default: null },
  isPublished: { type: Boolean, default: false, index: true },
  publishedAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  createdByLabel: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: null },
});

// A student's inbox is "published, addressed to me, newest first".
notificationSchema.index({ isPublished: 1, publishedAt: -1 });

/** The personal half of an inbox: everything addressed to one student. */
notificationSchema.index({ student: 1, publishedAt: -1 });

/**
 * What makes "post this notice once" true in the database rather than intended by
 * the caller. Partial, so the many rows with no key do not all collide on `null`.
 *
 * This is the same idiom as `StudentActivity`'s once-per-day index and
 * `ExamAttempt`'s one-attempt index, and it is here for the same reason: releasing
 * an exam's results is an idempotent administrative action that a nervous
 * administrator will click twice, and the second click must not tell every student
 * their results are out for a second time.
 */
notificationSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

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
