import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { PHOTO_CONTENT_TYPES, type PhotoContentType } from './StudentPhoto';

/** The largest picture stored, after the browser has shrunk it (see `MAX_QUESTION_IMAGE_SIDE`). */
export const MAX_QUESTION_IMAGE_BYTES = 1024 * 1024;

/** A key is 16 random bytes, written as 32 lowercase hex digits. */
export const QUESTION_IMAGE_KEY = /^[0-9a-f]{32}$/;

/**
 * A picture belonging to a question (Milestone 30 Phase 7b — picture questions, PLAN.md Q19):
 * the question itself, or its worked solution.
 *
 * ## Why its own collection, and why in MongoDB
 *
 * The bytes live in MongoDB like the registration photo and the gallery's — there is no object
 * store, and adding one would be a new service against the ₹0 budget. They live **beside** the
 * question rather than inside it, because several pipelines read whole `Question` documents
 * (`$sample`, `$$ROOT`), and a megabyte riding along with each would be read every time. The
 * budget is in the Phase 7b ADR: ~100 KB a picture after the browser shrinks it, 1 MB at most.
 *
 * ## Why a key, never the id
 *
 * A picture is served by a random 32-character `key`, and that key is the only permission
 * there is: it reaches a browser only inside a view allowed to show the picture — so a solution
 * picture's key appears only where its solution may (CLAUDE.md: the answer key never reaches the
 * client early). An ObjectId would not do: two minted in one request differ by a counter, so a
 * solution's id is a guess away from its question's.
 *
 * ## Why immutable
 *
 * A picture never changes; a different picture is a different document. So a Daily Quiz that
 * snapshotted one keeps showing exactly what its students saw, and every copy of it may be cached
 * for a year. Pictures nothing refers to any more are removed by
 * `sweepUnusedQuestionImages()`, never by an edit.
 */
export interface QuestionImageDocument extends Document {
  key: string;
  contentType: PhotoContentType;
  size: number;
  width: number;
  height: number;
  data: Buffer;
  uploadedBy?: Types.ObjectId | null;
  createdAt: Date;
}

const questionImageSchema = new Schema<QuestionImageDocument>({
  key: { type: String, required: true, unique: true, match: QUESTION_IMAGE_KEY },
  contentType: { type: String, enum: PHOTO_CONTENT_TYPES, required: true },
  size: { type: Number, required: true, min: 1, max: MAX_QUESTION_IMAGE_BYTES },
  width: { type: Number, required: true, min: 1 },
  height: { type: Number, required: true, min: 1 },
  data: { type: Buffer, required: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  createdAt: { type: Date, default: Date.now },
});

// The sweep reads the oldest pictures first.
questionImageSchema.index({ createdAt: 1 });

/** Never loaded unless a caller asks: only the serving route needs the bytes. */
questionImageSchema.path('data').select(false);

export const QuestionImage = mongoose.model<QuestionImageDocument>('QuestionImage', questionImageSchema);
