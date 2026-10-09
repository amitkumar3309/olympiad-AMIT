/**
 * What a stored picture really is: its dimensions, read from the file, and its bytes with the
 * metadata taken out (Milestone 30 Phase 7b — picture questions).
 *
 * Pure and dependency-free: a byte-level walk of the three formats the upload validator admits
 * (`validation/imageSchemas.ts` has already checked each file's signature).
 *
 * ## Why strip
 *
 * A photograph from a phone carries EXIF, and EXIF carries where it was taken. A Daily Quiz
 * picture becomes **public** once its answer is revealed (the archive), so whatever rides inside
 * the file would be published with it. The browser's re-encoding before upload drops metadata
 * too, but the server does not trust that it ran.
 *
 * What is kept is what decoding needs: a JPEG's JFIF header, its colour profile and Adobe's
 * colour-transform marker (CMYK files decode wrongly without it); a PNG's every chunk but its
 * text, EXIF and timestamp chunks; a WebP's every chunk but `EXIF` and `XMP `.
 *
 * ## Why the dimensions come from here
 *
 * They are stored with the picture so every `<img>` can reserve its space before it loads — no
 * layout shift — and a browser could claim anything. A file that declares an absurd size is
 * refused rather than handed to a phone to decode.
 */

export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface InspectedImage {
  /** The bytes to store: the original, minus its metadata. */
  data: Buffer;
  width: number;
  height: number;
}

/** No side may exceed this, and a picture may not exceed `MAX_IMAGE_PIXELS` in all. */
export const MAX_IMAGE_SIDE = 10_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

/**
 * The picture's real size and its bytes without metadata, or `null` when the file cannot be
 * read as the format it claims (truncated, or a signature over something else).
 */
export function inspectImage(bytes: Buffer, contentType: ImageContentType): InspectedImage | null {
  try {
    const result =
      contentType === 'image/jpeg' ? inspectJpeg(bytes) : contentType === 'image/png' ? inspectPng(bytes) : inspectWebp(bytes);
    if (!result || result.width < 1 || result.height < 1) return null;
    return result;
  } catch {
    // A walk that ran off the end of a buffer is a file we cannot read, not a server error.
    return null;
  }
}

/** Whether a picture of this size may be stored at all. */
export function isAcceptableSize(width: number, height: number): boolean {
  return width <= MAX_IMAGE_SIDE && height <= MAX_IMAGE_SIDE && width * height <= MAX_IMAGE_PIXELS;
}

// ---------------------------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------------------------

/** The start-of-frame markers, which carry the size: C0–CF except DHT (C4), JPG (C8) and DAC (CC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** An application segment kept for decoding — everything else in APP1–APP15, and comments, goes. */
function keepJpegSegment(marker: number, payload: Buffer): boolean {
  if (marker === 0xfe) return false; // COM — free text
  if (marker < 0xe0 || marker > 0xef) return true; // not an application segment: tables, frame, …
  if (marker === 0xe0) return true; // APP0 — JFIF / JFXX
  if (marker === 0xe2) return payload.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0';
  if (marker === 0xee) return payload.subarray(0, 5).toString('latin1') === 'Adobe';
  return false; // APP1 (EXIF, XMP), APP13 (IPTC), and the rest
}

function inspectJpeg(bytes: Buffer): InspectedImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let at = 2;

  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    // Fill bytes: any number of 0xFF may precede a marker.
    let markerAt = at + 1;
    while (bytes[markerAt] === 0xff) markerAt += 1;
    const marker = bytes[markerAt];
    if (marker === undefined) return null;

    if (marker === 0xd9) {
      kept.push(bytes.subarray(at));
      break; // EOI — nothing after the picture matters
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(at, markerAt + 1)); // a marker with no length
      at = markerAt + 1;
      continue;
    }

    const length = bytes.readUInt16BE(markerAt + 1);
    if (length < 2) return null;
    const segmentEnd = markerAt + 1 + length;
    if (segmentEnd > bytes.length) return null;
    const payload = bytes.subarray(markerAt + 3, segmentEnd);

    if (isStartOfFrame(marker)) {
      height = payload.readUInt16BE(1);
      width = payload.readUInt16BE(3);
    }
    if (marker === 0xda) {
      // Start of scan: the compressed picture follows, and everything from here is kept as it is.
      kept.push(bytes.subarray(at));
      break;
    }
    if (keepJpegSegment(marker, payload)) kept.push(bytes.subarray(at, segmentEnd));
    at = segmentEnd;
  }

  if (!width || !height) return null;
  return { data: Buffer.concat(kept), width, height };
}

// ---------------------------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------------------------

const PNG_SIGNATURE_LENGTH = 8;
/** Text, EXIF and the modification time — none is needed to draw the picture. */
const PNG_DROPPED_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function inspectPng(bytes: Buffer): InspectedImage | null {
  const kept: Buffer[] = [bytes.subarray(0, PNG_SIGNATURE_LENGTH)];
  let width = 0;
  let height = 0;
  let at = PNG_SIGNATURE_LENGTH;
  let ended = false;

  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    const chunkEnd = at + 12 + length; // length + type + data + CRC
    if (chunkEnd > bytes.length) return null;
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(at + 8);
      height = bytes.readUInt32BE(at + 12);
    }
    if (!PNG_DROPPED_CHUNKS.has(type)) kept.push(bytes.subarray(at, chunkEnd));
    at = chunkEnd;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }

  if (!ended || !width || !height) return null;
  return { data: Buffer.concat(kept), width, height };
}

// ---------------------------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------------------------

const WEBP_FLAG_EXIF = 0x08;
const WEBP_FLAG_XMP = 0x04;

function inspectWebp(bytes: Buffer): InspectedImage | null {
  if (bytes.length < 20) return null;
  const chunks: Buffer[] = [];
  let width = 0;
  let height = 0;
  let extendedFlagsAt = -1;
  let at = 12;

  while (at + 8 <= bytes.length) {
    const fourCc = bytes.subarray(at, at + 4).toString('latin1');
    const size = bytes.readUInt32LE(at + 4);
    const padded = size + (size % 2); // a chunk with an odd size carries one pad byte
    const chunkEnd = at + 8 + padded;
    if (at + 8 + size > bytes.length) return null;
    const payload = bytes.subarray(at + 8, at + 8 + size);

    if (fourCc === 'VP8X') {
      width = payload.readUIntLE(4, 3) + 1;
      height = payload.readUIntLE(7, 3) + 1;
    } else if (fourCc === 'VP8 ' && !width) {
      if (payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) return null;
      width = payload.readUInt16LE(6) & 0x3fff;
      height = payload.readUInt16LE(8) & 0x3fff;
    } else if (fourCc === 'VP8L' && !width) {
      if (payload[0] !== 0x2f) return null;
      const bits = payload.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }

    if (fourCc !== 'EXIF' && fourCc !== 'XMP ') {
      const chunk = Buffer.from(bytes.subarray(at, Math.min(chunkEnd, bytes.length)));
      if (fourCc === 'VP8X') extendedFlagsAt = chunks.reduce((n, c) => n + c.length, 0) + 8;
      chunks.push(chunk);
    }
    at = chunkEnd;
  }

  if (!width || !height || chunks.length === 0) return null;
  const body = Buffer.concat(chunks);
  // The extended header announces EXIF and XMP; with both gone it must stop announcing them.
  if (extendedFlagsAt >= 0) body[extendedFlagsAt] = body[extendedFlagsAt]! & ~(WEBP_FLAG_EXIF | WEBP_FLAG_XMP);

  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { data: Buffer.concat([header, body]), width, height };
}
