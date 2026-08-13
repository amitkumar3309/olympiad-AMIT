import { z } from 'zod';
import { CLASS_LEVELS } from '../lib/classLevels';
import {
  DIFFICULTIES,
  EMAIL_CATEGORIES,
  EMAIL_STATUSES,
  GALLERY_STATUSES,
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_KINDS,
  NOTIFICATION_SOURCES,
  STAFF_AUDIENCES,
} from '../models';
import { imageDataUrl } from './imageSchemas';

/**
 * Query params arrive as strings, and a repeated key still yields an array — the
 * same type-confusion hazard documented in `questionSchemas.ts`. Everything that
 * reaches a Mongoose filter is parsed here first, so no operator object from
 * `req.query` can get through. See SECURITY.md.
 */
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const objectIdParam = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-f\d]{24}$/i, 'That is not a valid id'),
});

export const idParamSchema = objectIdParam;

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

/**
 * 1 MB, a quarter of what a registration photo may be.
 *
 * Registration photos are bounded by the number of entrants; gallery images are
 * bounded by nothing but staff enthusiasm, and both share a 512 MB free tier. See
 * the note in `models/GalleryItem.ts`.
 */
export const MAX_GALLERY_IMAGE_BYTES = 1024 * 1024;

const galleryTitle = z.string().trim().min(2, 'Give the photo a title').max(150);
const galleryCaption = z.string().trim().max(500).optional();
/** `YYYY-MM-DD`, or explicitly cleared. Not every photo has a known event date. */
const eventDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the event date as YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Enter a valid event date')
  .nullable()
  .optional();

export const listGalleryQuerySchema = z.object({
  ...pagination,
  status: z.enum(GALLERY_STATUSES).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListGalleryQuery = z.infer<typeof listGalleryQuerySchema>;

export const createGalleryItemSchema = z.object({
  title: galleryTitle,
  caption: galleryCaption,
  eventDate,
  displayOrder: z.coerce.number().int().min(0).max(9999).optional(),
  status: z.enum(GALLERY_STATUSES).optional(),
  image: imageDataUrl(MAX_GALLERY_IMAGE_BYTES, 'image'),
});
export type CreateGalleryItemInput = z.infer<typeof createGalleryItemSchema>;

/**
 * Editing deliberately does **not** accept a new image: replacing the bytes under
 * an existing id would leave the public page's cached URL pointing at a different
 * photograph. Upload a new item and archive the old one.
 */
export const updateGalleryItemSchema = z
  .object({
    title: galleryTitle.optional(),
    caption: galleryCaption,
    eventDate,
    displayOrder: z.coerce.number().int().min(0).max(9999).optional(),
    status: z.enum(GALLERY_STATUSES).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');
export type UpdateGalleryItemInput = z.infer<typeof updateGalleryItemSchema>;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const notificationBody = z
  .object({
    title: z.string().trim().min(2, 'Give the announcement a title').max(150),
    body: z.string().trim().min(2, 'Write the announcement').max(2000),
    kind: z.enum(NOTIFICATION_KINDS).optional(),
    // `STAFF_AUDIENCES`, not `NOTIFICATION_AUDIENCES`: `student` exists for system
    // notices about one person, and must not be reachable from the composer. Absent
    // from the schema rather than rejected in the handler, which is the same
    // discipline the leaderboard uses for ranked values.
    audience: z.enum(STAFF_AUDIENCES).optional(),
    classLevel: z.enum(CLASS_LEVELS).nullable().optional(),
    isPublished: z.boolean().optional(),
    /**
     * Opt in to emailing this announcement as well as posting it (Milestone 14).
     *
     * Default **false**, and that default is the decision: Milestone 12 declined to
     * email broadcasts at all because doing it from a free tier is a deliverability
     * problem, and the compromise is that staff may choose it per announcement rather
     * than having it happen by default. Only meaningful together with publication —
     * a draft emails nobody.
     */
    emailBroadcast: z.boolean().optional(),
  })
  /**
   * A class-targeted announcement without a class would reach nobody and look
   * sent. Cross-field checks belong here rather than in the handler, so the two
   * fields cannot disagree by the time anything is written.
   */
  .refine((b) => b.audience !== 'class' || Boolean(b.classLevel), {
    message: 'Choose which class this announcement is for',
    path: ['classLevel'],
  });

export const createNotificationSchema = notificationBody;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

export const updateNotificationSchema = z
  .object({
    title: z.string().trim().min(2).max(150).optional(),
    body: z.string().trim().min(2).max(2000).optional(),
    kind: z.enum(NOTIFICATION_KINDS).optional(),
    audience: z.enum(STAFF_AUDIENCES).optional(),
    classLevel: z.enum(CLASS_LEVELS).nullable().optional(),
    isPublished: z.boolean().optional(),
    emailBroadcast: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update')
  .refine((b) => b.audience !== 'class' || b.classLevel !== null, {
    message: 'Choose which class this announcement is for',
    path: ['classLevel'],
  });
export type UpdateNotificationInput = z.infer<typeof updateNotificationSchema>;

export const listNotificationsQuerySchema = z.object({
  ...pagination,
  audience: z.enum(NOTIFICATION_AUDIENCES).optional(),
  classLevel: z.enum(CLASS_LEVELS).optional(),
  published: z.enum(['true', 'false']).optional(),
  /**
   * Which stream to list. **Omitted means `staff`**, not "everything".
   *
   * That default is deliberate and load-bearing. This endpoint backs the *composer*,
   * and system notifications are per-student: releasing one national exam's results
   * writes one row per candidate, so a few hundred of them would bury the handful of
   * announcements staff actually wrote and make the page useless for its job. `all`
   * is available for anybody who genuinely wants the combined view.
   */
  source: z.enum([...NOTIFICATION_SOURCES, 'all']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/**
 * Notification preferences (Milestone 14).
 *
 * Both fields optional so a caller may change one switch without restating the
 * other, but at least one is required — an empty PATCH is a mistake, not a no-op.
 * There is deliberately no field for the security or transactional streams: they are
 * absent from the schema rather than ignored by the handler, so "I turned it off and
 * it kept sending" is not a state the API can be asked to produce.
 */
export const updateNotificationPrefsSchema = z
  .object({
    announcements: z.boolean().optional(),
    results: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Choose at least one preference to change');
export type UpdateNotificationPrefsInput = z.infer<typeof updateNotificationPrefsSchema>;

/**
 * Question performance (Milestone 15).
 *
 * Note what is **absent**: there is no way to ask for a particular accuracy, or to
 * order by anything but the four named sorts. Every figure on the response is counted
 * from stored attempts, and letting a caller supply or filter one would be the first
 * step toward a number the database was never asked for — the same discipline the
 * leaderboard schema follows for ranked values.
 */
export const questionPerformanceQuerySchema = z.object({
  ...pagination,
  classLevel: z.enum(CLASS_LEVELS).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  subject: z
    .string()
    .trim()
    .regex(/^[a-f\d]{24}$/i, 'That is not a valid subject id')
    .optional(),
  sort: z.enum(['hardest', 'easiest', 'most-served', 'most-skipped']).optional(),
  /**
   * The floor on answers before a question is judged at all. Capped at 100 because a
   * higher floor would silently empty the table on any realistic cohort, which reads
   * as a broken page rather than as a strict filter.
   */
  minAnswered: z.coerce.number().int().min(1).max(100).optional(),
});
export type QuestionPerformanceQuery = z.infer<typeof questionPerformanceQuerySchema>;

/** The admin delivery log. */
export const listDeliveriesQuerySchema = z.object({
  ...pagination,
  status: z.enum(EMAIL_STATUSES).optional(),
  category: z.enum(EMAIL_CATEGORIES).optional(),
});
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;

export const inboxQuerySchema = z.object({
  ...pagination,
  unreadOnly: z.enum(['true', 'false']).optional(),
});
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

// ---------------------------------------------------------------------------
// Platform analytics / admin leaderboard
// ---------------------------------------------------------------------------

export const platformAnalyticsQuerySchema = z.object({
  /** Length of the daily series. Bounded so a caller cannot ask for five years. */
  days: z.coerce.number().int().min(7).max(90).default(30),
});
export type PlatformAnalyticsQuery = z.infer<typeof platformAnalyticsQuerySchema>;

export const adminLeaderboardQuerySchema = z.object({
  ...pagination,
  classLevel: z.enum(CLASS_LEVELS).optional(),
  period: z.enum(['all', 'month', 'week', 'today']).default('all'),
});
export type AdminLeaderboardQuery = z.infer<typeof adminLeaderboardQuerySchema>;
