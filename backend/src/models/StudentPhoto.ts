import mongoose, { Schema, type Document } from 'mongoose';

/** The image types a registration photo may be uploaded as. */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

/** Hard ceiling on a stored photo, in bytes (2 MB, as specified by the owner). */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export interface StudentPhotoDocument extends Document {
  student: mongoose.Types.ObjectId;
  contentType: PhotoContentType;
  /** Size of `data` in bytes. Stored so a listing can report it without loading the image. */
  size: number;
  data: Buffer;
  uploadedAt: Date;
}

/**
 * Registration photos live in their own collection rather than as a field on
 * `Student`, for two reasons:
 *
 * 1. Every student query — the admin list, the login lookup, the freshness check
 *    on each privileged request — would otherwise drag a 2 MB binary along with
 *    it. Mongoose has no way to make that cheap short of `select: false` on
 *    every path, and one forgotten projection would be a very expensive mistake.
 * 2. The image is the only part of an account we might later want to move to
 *    external object storage; keeping it separate makes that a change to one
 *    collection instead of a field migration on every student.
 *
 * Storage is MongoDB rather than a CDN because the project targets ₹0 spend and
 * no external account (see the Milestone 4 ADR in DECISIONS.md). At 2 MB a
 * photo, the Atlas free tier's 512 MB holds roughly 250 of them — enough for the
 * first cohort, and a known limit to revisit before scaling.
 */
const studentPhotoSchema = new Schema<StudentPhotoDocument>({
  // Unique: one photo per account. Re-uploading replaces the document rather
  // than accumulating copies.
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true, unique: true },
  contentType: { type: String, enum: PHOTO_CONTENT_TYPES, required: true },
  size: { type: Number, required: true, max: MAX_PHOTO_BYTES },
  data: { type: Buffer, required: true },
  uploadedAt: { type: Date, default: Date.now },
});

export const StudentPhoto = mongoose.model<StudentPhotoDocument>('StudentPhoto', studentPhotoSchema);
