import { z } from 'zod';
import { PHOTO_CONTENT_TYPES, type PhotoContentType } from '../models/StudentPhoto';

/**
 * The one image validator in this backend.
 *
 * Extracted from `authSchemas.ts` in Milestone 12, when the event gallery became a
 * second surface that accepts an upload. The magic-byte check below is the whole
 * reason a second copy would have been dangerous: it is what stops
 * `data:image/png;base64,<anything at all>` being stored and later served back with
 * an image content type, and a copy that drifted would reintroduce exactly that on
 * whichever surface was forgotten.
 *
 * Only the size limit differs between callers, so it is the only parameter.
 */

/**
 * The leading bytes every accepted format starts with. A browser — or a script
 * posting directly — controls the MIME type in the data URL, so it is checked
 * against the actual file signature rather than trusted.
 */
const MAGIC_BYTES: Record<PhotoContentType, (buf: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) =>
    b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

const DATA_URL = /^data:([a-z]+\/[a-z0-9+.-]+);base64,(.+)$/i;

export interface DecodedImage {
  contentType: PhotoContentType;
  data: Buffer;
}

/**
 * A base64 data URL carrying a JPEG, PNG or WebP, decoded to bytes.
 *
 * Images travel inside the JSON body rather than as multipart uploads: it keeps
 * each request atomic, needs no new dependency, and works with the existing
 * `validate` middleware and `{ success, ... }` envelope (see the Milestone 4 ADR).
 *
 * @param maxBytes hard ceiling — 2 MB for a registration photo, 1 MB for a gallery
 *                 image, because the gallery has no natural bound on how many there
 *                 are and the free tier is 512 MB in total.
 * @param label    what to call the file in error messages, so a student is told
 *                 about "the photo" and staff about "the image".
 */
export function imageDataUrl(maxBytes: number, label = 'photo') {
  const maxKb = Math.round(maxBytes / 1024);

  return z
    .string({ error: `A ${label} is required` })
    .min(1, `A ${label} is required`)
    .superRefine((value, ctx) => {
      const match = DATA_URL.exec(value);
      if (!match?.[1] || !match[2]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The ${label} must be a base64-encoded image` });
        return;
      }

      const [, declaredType, encoded] = match;
      if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(declaredType.toLowerCase())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The ${label} must be a JPEG, PNG or WebP image` });
        return;
      }

      const data = Buffer.from(encoded, 'base64');
      if (data.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `The ${label} could not be read. Please choose the file again.`,
        });
        return;
      }
      if (data.length > maxBytes) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The ${label} must be ${maxKb} KB or smaller` });
        return;
      }
      if (!MAGIC_BYTES[declaredType.toLowerCase() as PhotoContentType](data)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That file is not a valid JPEG, PNG or WebP image' });
      }
    })
    .transform((value): DecodedImage => {
      // Safe to assert: superRefine above has already rejected anything else.
      const match = DATA_URL.exec(value)!;
      return {
        contentType: match[1]!.toLowerCase() as PhotoContentType,
        data: Buffer.from(match[2]!, 'base64'),
      };
    });
}
