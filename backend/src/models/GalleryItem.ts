import mongoose, { Schema, type Document, type Types } from 'mongoose';

export const GALLERY_STATUSES = ['published', 'archived'] as const;
export type GalleryStatus = (typeof GALLERY_STATUSES)[number];

/**
 * A photograph from a real olympiad event, shown on the public gallery page.
 *
 * ## Why the bytes live here, and what that costs
 *
 * The image is stored in MongoDB as a `Buffer`, the same pattern `StudentPhoto`
 * already uses — there is no object store, and adding one would mean a paid
 * service against a ₹0 budget (see CLAUDE.md, "Cost Constraint").
 *
 * That decision has a hard, countable ceiling and it is worth writing down rather
 * than discovering. Atlas's free tier is **512 MB total**, and registration photos
 * are already the biggest tenant at up to 2 MB each (~250 students fills it).
 * Gallery images are therefore capped at **1 MB** and validated by magic bytes like
 * every other upload in this codebase. At 1 MB a photo, a hundred gallery images is
 * ~100 MB — a fifth of the entire free tier for decoration. `PROJECT_STATE.md`
 * records this as the second thing that will force a paid tier or an image CDN.
 *
 * ## Why `data` is `select: false`
 *
 * The admin listing pages through these ten at a time. Without the exclusion every
 * page load would drag ten megabytes of image bytes into memory to render a table
 * of titles. The bytes are served only by the dedicated image route, one at a time.
 */
export interface GalleryItemDocument extends Document {
  title: string;
  caption?: string | null;
  /** When the event happened — not when the row was created. Nullable: not every photo has one. */
  eventDate?: Date | null;
  contentType: string;
  size: number;
  data: Buffer;
  status: GalleryStatus;
  /**
   * Manual ordering for the public page, ascending. Staff decide what leads,
   * because "most recently uploaded" is not the same as "best photo of the event".
   */
  displayOrder: number;
  uploadedBy?: Types.ObjectId | null;
  /** Denormalised so the row still reads if the uploader's account is later removed. */
  uploadedByLabel?: string | null;
  createdAt: Date;
  updatedAt?: Date | null;
}

const galleryItemSchema = new Schema<GalleryItemDocument>({
  title: { type: String, required: true, trim: true, maxlength: 150 },
  caption: { type: String, default: null, trim: true, maxlength: 500 },
  eventDate: { type: Date, default: null },
  contentType: { type: String, required: true },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true },
  status: { type: String, enum: GALLERY_STATUSES, default: 'published', index: true },
  displayOrder: { type: Number, default: 0 },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  uploadedByLabel: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: null },
});

// The public page reads published items in display order, newest first within it.
galleryItemSchema.index({ status: 1, displayOrder: 1, createdAt: -1 });

/** See the note above: never loaded unless a caller explicitly asks for it. */
galleryItemSchema.path('data').select(false);

export const GalleryItem = mongoose.model<GalleryItemDocument>('GalleryItem', galleryItemSchema);
