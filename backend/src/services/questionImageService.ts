import { randomBytes } from 'node:crypto';
import { ApiError } from '../lib/ApiError';
import { inspectImage, isAcceptableSize, MAX_IMAGE_SIDE } from '../lib/imageFile';
import { logger } from '../lib/logger';
import { DailyChallenge, Question, QuestionImage, type QuestionImageDocument, type QuestionPicture } from '../models';
import type { DecodedImage } from '../validation/imageSchemas';

/**
 * THE path to and from a question's pictures (Milestone 30 Phase 7b — picture questions).
 *
 * Every picture is stored by `storeQuestionImage()`, which is where a file stops being whatever
 * the browser sent: it is read as the format it claims, measured, stripped of its metadata
 * (`lib/imageFile.ts`) and given an unguessable key. Nothing else writes a `QuestionImage`.
 *
 * Kept behind this one service so that moving the bytes to an object store later — when the
 * free database's 512 MB is the constraint — touches this file and the serving route, not the
 * question, the quiz or the views that refer to a picture by its key.
 */

/** What a browser is told about a picture it may show. */
export interface QuestionImageView {
  key: string;
  url: string;
  width: number;
  height: number;
  size: number;
  contentType: string;
}

/** Where a picture is served. Relative: the site proxies `/api` to this API (frontend/vercel.json). */
export function questionImageUrl(key: string): string {
  return `/api/v1/question-images/${key}`;
}

function viewOf(image: Pick<QuestionImageDocument, 'key' | 'width' | 'height' | 'size' | 'contentType'>): QuestionImageView {
  return {
    key: image.key,
    url: questionImageUrl(image.key),
    width: image.width,
    height: image.height,
    size: image.size,
    contentType: image.contentType,
  };
}

/**
 * Stores one picture and returns how to refer to it. Refuses a file that cannot be read as the
 * format it claims, and one too large to ask a phone to decode.
 */
export async function storeQuestionImage(upload: DecodedImage, uploadedBy: string | null): Promise<QuestionImageView> {
  const inspected = inspectImage(upload.data, upload.contentType);
  if (!inspected) {
    throw ApiError.badRequest('That picture could not be read. Save it again as a JPEG, PNG or WebP and upload that.');
  }
  if (!isAcceptableSize(inspected.width, inspected.height)) {
    throw ApiError.badRequest(
      `That picture is ${inspected.width} × ${inspected.height} pixels — too large to show on a phone. ` +
        `Make it smaller than ${MAX_IMAGE_SIDE.toLocaleString('en-IN')} pixels a side and upload it again.`,
    );
  }

  const image = await QuestionImage.create({
    key: randomBytes(16).toString('hex'),
    contentType: upload.contentType,
    size: inspected.data.length,
    width: inspected.width,
    height: inspected.height,
    data: inspected.data,
    uploadedBy,
  });
  return viewOf(image);
}

/** A picture's bytes and type, for the serving route; `null` when there is no such picture. */
export async function readQuestionImage(key: string) {
  return QuestionImage.findOne({ key }).select('+data contentType size');
}

/**
 * The stored size of each picture named, for a question being saved — refused with a message
 * when one is missing (an upload that was swept away before the question was saved).
 */
export async function requireQuestionImages(keys: string[]): Promise<Map<string, { width: number; height: number }>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Map();
  const found = await QuestionImage.find({ key: { $in: unique } }).select('key width height').lean();
  const sizes = new Map(found.map((image) => [image.key, { width: image.width, height: image.height }]));
  if (sizes.size !== unique.length) {
    throw ApiError.badRequest('A picture on this question is no longer available. Upload it again, then save.');
  }
  return sizes;
}

/** A picture as a request names it: which stored picture, and what it shows. */
export interface PictureRef {
  key: string;
  alt?: string | null;
}

/**
 * A question's two picture references with their stored sizes attached — what `Question.image`
 * and `Question.solutionImage` hold. The size always comes from the picture, never the request.
 */
export async function resolvePictures(input: {
  image?: PictureRef | null;
  solutionImage?: PictureRef | null;
}): Promise<{ image: QuestionPicture | null; solutionImage: QuestionPicture | null }> {
  const refs = [input.image, input.solutionImage].filter((ref): ref is PictureRef => Boolean(ref?.key));
  const sizes = await requireQuestionImages(refs.map((ref) => ref.key));
  const withSize = (ref: PictureRef | null | undefined): QuestionPicture | null => {
    const size = ref?.key ? sizes.get(ref.key) : undefined;
    return ref && size ? { key: ref.key, alt: ref.alt?.trim() ?? '', width: size.width, height: size.height } : null;
  };
  return { image: withSize(input.image), solutionImage: withSize(input.solutionImage) };
}

/** A picture as a student's view carries it: where it is, what it shows, and how big it is. */
export interface PictureView {
  url: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * A stored picture reference as a view shows it — or `null`. The key travels only inside the
 * address; a view that may not show a picture must not call this for it (the solution picture
 * is shown only where the text solution is).
 */
export function pictureView(picture: QuestionPicture | null | undefined): PictureView | null {
  if (!picture?.key) return null;
  return { url: questionImageUrl(picture.key), alt: picture.alt ?? '', width: picture.width, height: picture.height };
}

/** The author's view adds the key itself, which the editor sends back to keep the picture on save. */
export function authorPictureView(picture: QuestionPicture | null | undefined): (PictureView & { key: string }) | null {
  const view = pictureView(picture);
  return view && picture ? { key: picture.key, ...view } : null;
}

// ---------------------------------------------------------------------------------------------
// Removing pictures nothing uses
// ---------------------------------------------------------------------------------------------

/**
 * How long a picture nothing refers to is kept: long enough for the form that uploaded it to be
 * saved. A picture is uploaded before its question exists, so "unreferenced" is the normal state
 * of a new one for a few minutes.
 */
export const UNUSED_PICTURE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Every picture key something still shows: a question's, and a Daily Quiz's own copy — a quiz
 * keeps the picture it was scheduled with even after its bank question changes or goes.
 */
async function picturesInUse(): Promise<string[]> {
  const lists = await Promise.all([
    Question.distinct('image.key'),
    Question.distinct('solutionImage.key'),
    DailyChallenge.distinct('content.image.key'),
    DailyChallenge.distinct('content.solutionImage.key'),
  ]);
  return lists.flat().filter((key): key is string => typeof key === 'string');
}

/**
 * Deletes the pictures older than the grace period that no question or Daily Quiz refers to —
 * those of a deleted question, those replaced by an edit, and uploads whose form was never saved.
 * Returns how many went. Never deletes a picture something shows, however old.
 */
export async function sweepUnusedQuestionImages(at = new Date()): Promise<number> {
  const cutoff = new Date(at.getTime() - UNUSED_PICTURE_GRACE_MS);
  if (!(await QuestionImage.exists({ createdAt: { $lt: cutoff } }))) return 0;
  const inUse = await picturesInUse();
  const { deletedCount } = await QuestionImage.deleteMany({ createdAt: { $lt: cutoff }, key: { $nin: inUse } });
  return deletedCount ?? 0;
}

let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The sweep, at most once an hour per instance and never a reason for the request that triggers
 * it to fail. Called after every upload, so the pictures nothing uses are cleared by the work that
 * makes them, with no scheduler.
 */
export async function sweepUnusedQuestionImagesNowAndThen(at = new Date()): Promise<void> {
  if (at.getTime() - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = at.getTime();
  try {
    const removed = await sweepUnusedQuestionImages(at);
    if (removed > 0) logger.info({ removed }, 'Removed question pictures nothing refers to');
  } catch (err) {
    logger.warn({ err }, 'Could not remove unused question pictures; the next upload will try again');
  }
}
