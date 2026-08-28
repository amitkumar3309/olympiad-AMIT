import { z } from 'zod';
import { IMPORT_FILE_KINDS, type ImportFileKind } from '../lib/importTypes';

/**
 * File validation for the bulk question importer (Milestone 21).
 *
 * ## Why this is not `imageSchemas.ts`, and why it does not replace it
 *
 * `validation/imageSchemas.ts` validates **one image against a fixed set of three formats**
 * and returns a `PhotoContentType` — a type that means "something we will store in Mongo and
 * serve back with that content type". That is a different job from this one, which decides
 * which *parser* may read a spreadsheet, and the two must not be merged: the registration
 * photo's allow-list is about what we are willing to serve, and this one is about what we are
 * willing to parse.
 *
 * What *is* shared is the principle, and it is the important part: **the declared MIME type
 * is not evidence.** A browser — or a script posting directly — controls the string in the
 * data URL, so the bytes are checked against the real file signature. That check is what
 * stops `data:application/vnd…sheet;base64,<anything at all>` reaching a parser.
 *
 * ## Three signals, in order of how much they are trusted
 *
 * 1. **The bytes.** An `.xlsx` and a `.docx` are both ZIP archives, so both must begin with
 *    the local-file-header signature `50 4B 03 04`. Images are checked against their own
 *    signatures. This is the only signal a client cannot forge without actually supplying a
 *    file of that shape.
 * 2. **The extension**, from an allow-list, which is what selects the parser. It cannot be a
 *    path — the pattern below permits no separator, no `..` and no NUL — and it is never
 *    joined onto a directory, because nothing here writes to disk.
 * 3. **The declared MIME type**, checked against a permissive allow-list and trusted least.
 *    It is permissive on purpose: real browsers on real machines send
 *    `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for an `.xlsx` when
 *    the OS knows the type and `application/octet-stream` when it does not, and refusing the
 *    second would reject genuine files for a signal that proves nothing anyway.
 *
 * The **authoritative** check is none of these three: it is that the parser finds the OOXML
 * part it needs (`xl/workbook.xml` for a workbook, `word/document.xml` for a document). A
 * ZIP that is neither is refused there, with a message saying so. These three exist to
 * refuse the obvious cases cheaply, before any decompression happens.
 *
 * ## What is deliberately not attempted
 *
 * No malware scanning and no re-encoding — the same open gap `SECURITY.md` records for the
 * registration photo. And **no protection against a decompression bomb beyond a size cap**:
 * a small ZIP can expand enormously, and neither `exceljs` nor `mammoth` exposes a limit on
 * what it will inflate. The mitigations are that the input is capped well below anything
 * dangerous, that the number of rows a parser may return is bounded independently, and that
 * a serverless invocation has a hard memory ceiling of its own. Recorded in `SECURITY.md` as
 * a residual risk rather than treated as solved.
 */

// ---------------------------------------------------------------------------
// Size ceilings
// ---------------------------------------------------------------------------

/**
 * Per-file ceilings, in bytes.
 *
 * A workbook of a thousand questions is a few hundred kilobytes, so 5 MB is generous for a
 * spreadsheet or a Word file and still far below what could exhaust an invocation. A
 * photographed exam page off a modern phone is routinely 3–4 MB before any compression, so
 * images get more headroom than the 2 MB registration photo — an examiner should not have to
 * resize a picture to import from it.
 */
export const MAX_IMPORT_FILE_BYTES: Record<ImportFileKind, number> = {
  excel: 5 * 1024 * 1024,
  docx: 5 * 1024 * 1024,
  image: 6 * 1024 * 1024,
};

/**
 * The most bytes one import request may carry in total, across every file.
 *
 * A per-file limit alone is not a limit: twenty images at 6 MB is 120 MB, which no serverless
 * invocation survives. This is the number `app.ts` sizes the body parser from, so a request
 * over it is refused by the parser before a handler is reached.
 */
export const MAX_IMPORT_REQUEST_BYTES = 24 * 1024 * 1024;

/** The most files one request may carry. Bounded so a batch stays reviewable by one human. */
export const MAX_IMPORT_FILES = 20;

// ---------------------------------------------------------------------------
// What each kind may claim to be
// ---------------------------------------------------------------------------

/**
 * Extensions per kind, which is what actually selects a parser.
 *
 * `.xls` is **absent** deliberately: the legacy binary format is not OOXML, `exceljs` cannot
 * read it, and accepting it would produce a confusing parse failure rather than the clear
 * "save it as .xlsx" the examiner needs.
 */
const EXTENSIONS: Record<ImportFileKind, readonly string[]> = {
  excel: ['xlsx'],
  docx: ['docx'],
  image: ['jpg', 'jpeg', 'png', 'webp'],
};

/** MIME types accepted per kind. Trusted least of the three signals — see the note above. */
const CONTENT_TYPES: Record<ImportFileKind, readonly string[]> = {
  excel: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream',
  ],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream',
  ],
  image: ['image/jpeg', 'image/png', 'image/webp'],
};

/**
 * The leading bytes each kind really begins with.
 *
 * OOXML is a ZIP, so both office kinds share the local-file-header signature. `PK\x05\x06`
 * (an empty archive) and `PK\x07\x08` (a spanned one) are **not** accepted: neither can be a
 * valid workbook or document, and letting them through would only move the failure into the
 * decompressor.
 */
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const SIGNATURES: Record<ImportFileKind, (buf: Buffer) => boolean> = {
  excel: (b) => b.length > 4 && b.subarray(0, 4).equals(ZIP_LOCAL_HEADER),
  docx: (b) => b.length > 4 && b.subarray(0, 4).equals(ZIP_LOCAL_HEADER),
  image: (b) =>
    (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (b.length > 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP'),
};

/**
 * What to call each kind when telling an examiner what went wrong.
 *
 * Two forms, because English needs both: "Each Excel workbook must be 5 MB or smaller" and
 * "that is not **an** Excel workbook". Carrying the article rather than writing `a ${label}`
 * at each call site — which produced "a Excel workbook" and "a image".
 */
const LABELS: Record<ImportFileKind, { bare: string; withArticle: string }> = {
  excel: { bare: 'Excel workbook (.xlsx)', withArticle: 'an Excel workbook (.xlsx)' },
  docx: { bare: 'Word document (.docx)', withArticle: 'a Word document (.docx)' },
  image: { bare: 'image (.jpg, .png or .webp)', withArticle: 'an image (.jpg, .png or .webp)' },
};

// ---------------------------------------------------------------------------
// The filename
// ---------------------------------------------------------------------------

/**
 * A filename as a **label**, with every character that could make it a path refused.
 *
 * Nothing in this feature opens a file, so this is not what stops path traversal — not
 * writing to disk is. It is refused anyway for two narrower reasons: the name is echoed back
 * into an error report and written to `ImportBatch`, and a name containing a separator or a
 * NUL is either a bug in the client or an attempt at something, neither of which should be
 * stored and shown to staff.
 */
const FILENAME = new RegExp(String.raw`^[^/\\:*?"<>|]{1,200}$`, 'u');

const filename = z
  .string({ error: 'Each file needs a name' })
  .trim()
  .min(1, 'Each file needs a name')
  .max(200, 'That filename is too long')
  // Spaces, hyphens and brackets are all perfectly ordinary in a filename an examiner
  // chose ("Class 8 paper (2025).xlsx"); what is refused is the path separators and the
  // Windows-reserved characters, plus every control character including NUL.
  .refine((value) => FILENAME.test(value), 'That filename contains characters that are not allowed')
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  .refine((value) => !/[\u0000-\u001f]/u.test(value), 'That filename contains characters that are not allowed')
  // `.` and `..` are directory references rather than names. They cannot traverse anywhere
  // here — nothing opens a file, and a separator is already refused above — but they are
  // not filenames either, and one arriving means the client is confused about what it sent.
  .refine((value) => value !== '.' && value !== '..', 'That filename is not valid');

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

const DATA_URL = /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+);base64,(.+)$/;

/** A validated upload: the bytes, plus the kind that decides which parser reads them. */
export interface DecodedUpload {
  name: string;
  kind: ImportFileKind;
  declaredType: string;
  data: Buffer;
}

/**
 * One uploaded file for a given kind, as a base64 data URL, decoded to bytes.
 *
 * The `kind` is a parameter rather than sniffed from the payload because the *route* knows
 * it: an examiner uploading a spreadsheet is on the Excel path, and a `.docx` arriving there
 * is a mistake worth naming ("that is a Word document — use the Word import") rather than
 * something to silently redirect.
 */
export function importFileSchema(kind: ImportFileKind) {
  const maxBytes = MAX_IMPORT_FILE_BYTES[kind];
  const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  const label = LABELS[kind].bare;
  const aLabel = LABELS[kind].withArticle;

  return z
    .object({
      name: filename,
      /** The base64 data URL. Bounded before decoding so a huge string is refused cheaply. */
      content: z
        .string({ error: 'That file could not be read' })
        .min(1, 'That file is empty')
        // base64 inflates by 4/3, plus the data-URL prefix. A generous ceiling whose only
        // job is to refuse an absurd string before it is decoded into memory.
        .max(Math.ceil(maxBytes * 1.4) + 128, `Each ${label} must be ${maxMb} MB or smaller`),
    })
    .superRefine((value, ctx) => {
      const at = (message: string, path: 'name' | 'content' = 'content') =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

      const extension = extensionOf(value.name);
      if (!EXTENSIONS[kind].includes(extension)) {
        at(`"${value.name}" is not ${aLabel}.`, 'name');
        return;
      }

      const match = DATA_URL.exec(value.content);
      if (!match?.[1] || !match[2]) {
        at(`"${value.name}" must be sent as a base64 data URL.`);
        return;
      }

      const declaredType = match[1].toLowerCase();
      if (!CONTENT_TYPES[kind].includes(declaredType)) {
        at(`"${value.name}" claims to be ${declaredType}, which is not ${aLabel}.`);
        return;
      }

      const data = Buffer.from(match[2], 'base64');
      if (data.length === 0) {
        at(`"${value.name}" could not be read. Please choose the file again.`);
        return;
      }
      if (data.length > maxBytes) {
        at(`"${value.name}" is larger than ${maxMb} MB.`);
        return;
      }
      if (!SIGNATURES[kind](data)) {
        // The message says what was actually wrong rather than repeating the size or the
        // MIME type: a file that passes those two and fails this one is nearly always
        // something renamed, and saying so is what lets the examiner fix it.
        at(
          kind === 'image'
            ? `"${value.name}" is not a valid JPEG, PNG or WebP image.`
            : `"${value.name}" is not a valid ${label}. If you renamed another file, save it from Office instead.`,
          // NB: "a valid Excel workbook" is correct here — the article attaches to "valid".
        );
      }
    })
    .transform((value): DecodedUpload => {
      // Safe to assert: superRefine has already rejected anything that does not match.
      const match = DATA_URL.exec(value.content)!;
      return {
        name: value.name,
        kind,
        declaredType: match[1]!.toLowerCase(),
        data: Buffer.from(match[2]!, 'base64'),
      };
    });
}

/**
 * A list of uploads of one kind, bounded in count and in total size.
 *
 * The **total** matters as much as the per-file limit: twenty 6 MB images is 120 MB, which no
 * serverless invocation survives, so the sum is checked here as well as being the number
 * `app.ts` sizes the body parser from. Checked after decoding rather than on the base64
 * length, because the base64 length overstates the payload by a third and an examiner told
 * their 18 MB of photographs is 24 MB would reasonably think the limit was a lie.
 */
export function importFilesSchema(kind: ImportFileKind) {
  const maxMb = Math.round(MAX_IMPORT_REQUEST_BYTES / (1024 * 1024));

  return z
    .array(importFileSchema(kind))
    .min(1, 'Choose at least one file')
    .max(MAX_IMPORT_FILES, `Upload at most ${MAX_IMPORT_FILES} files at a time`)
    .superRefine((files, ctx) => {
      /**
       * Bail out if any element failed its own validation.
       *
       * In zod 4 a check on the *array* still runs when a child failed, and the failed child
       * arrives as `undefined`. Reading `.data` off it threw a `TypeError`, which the error
       * handler turned into a **500** — so every rejected file (bad signature, wrong extension,
       * oversized) answered "internal server error" instead of saying what was wrong with it.
       * Each of those elements has already reported its own issue, so there is nothing to add.
       */
      const decoded = files.filter((file): file is DecodedUpload => Boolean(file) && 'data' in file);
      if (decoded.length !== files.length) return;

      const total = decoded.reduce((sum, file) => sum + file.data.length, 0);
      if (total > MAX_IMPORT_REQUEST_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Those files come to more than ${maxMb} MB in total. Upload them in smaller batches.`,
        });
      }
      const names = decoded.map((file) => file.name.toLowerCase());
      if (new Set(names).size !== names.length) {
        // Two files of the same name make every per-file message ambiguous, and it is
        // almost always the same file chosen twice.
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Two of those files have the same name.' });
      }
    });
}

/** Exported for the tests and for `app.ts`, so the ceiling is stated in exactly one place. */
export { IMPORT_FILE_KINDS };
