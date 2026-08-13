import { z } from 'zod';
import { CLASS_LEVELS } from '../lib/classLevels';
import { GALLERY_STATUSES, NOTIFICATION_AUDIENCES, NOTIFICATION_KINDS } from '../models';
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
    audience: z.enum(NOTIFICATION_AUDIENCES).optional(),
    classLevel: z.enum(CLASS_LEVELS).nullable().optional(),
    isPublished: z.boolean().optional(),
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
    audience: z.enum(NOTIFICATION_AUDIENCES).optional(),
    classLevel: z.enum(CLASS_LEVELS).nullable().optional(),
    isPublished: z.boolean().optional(),
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
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

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
