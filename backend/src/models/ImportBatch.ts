import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { IMPORT_FILE_KINDS, type ImportFileKind } from '../lib/importTypes';

/**
 * One record of a bulk import: what was uploaded, what came out of it, and what the
 * reviewer then did with it (Milestone 21).
 *
 * ## Why this exists, and why it is not `GenerationLog`
 *
 * It is the same *kind* of record `GenerationLog` is — "why did the extractor behave like
 * that?" rather than "who changed the bank", which is `AuditLog`'s job — but it is not the
 * same record. `GenerationLog` is thoroughly model-shaped: it carries a model name, a
 * language, a Bloom's level, a requested count and a prompt-instruction flag, none of which
 * mean anything for a spreadsheet. Reusing it would have meant a row of nulls whose reader
 * could not tell an absent field from an inapplicable one.
 *
 * ## Why it has to exist at all, rather than the request carrying the facts
 *
 * `Question.provenance` must be able to say **how a question entered the bank**, and
 * `source` is the one field there worth lying about: a client that could set it could file
 * machine-read questions as hand-written ones. So approval reads the provenance facts back
 * from **this row**, using the batch id we ourselves issued, exactly as `approveQuestions()`
 * reads them from `GenerationLog`. The browser supplies only the id it was given.
 *
 * ## What it does not store
 *
 * **Not the uploaded bytes, and not the question text.** The files are parsed in memory and
 * discarded — nothing in this feature ever touches the filesystem — and keeping a copy would
 * turn a diagnostic row into an unbounded blob store on a 512 MB free tier. Extracted
 * questions are either approved (and then live in `Question`, with their own history) or
 * discarded, and keeping unreviewed machine-read text indefinitely would have no reader.
 *
 * ## No TTL, deliberately
 *
 * The same reasoning as `AuditLog`, `StudentActivity` and `GenerationLog`: this is the
 * evidence for "this question was read off a photograph on this date, by this model, and
 * this person signed it off". A question may be traced back to its import years later, which
 * is exactly the question somebody will eventually ask about exam content nobody typed.
 */

export const IMPORT_OUTCOMES = ['succeeded', 'failed'] as const;
export type ImportOutcomeStatus = (typeof IMPORT_OUTCOMES)[number];

/**
 * How one file in the upload fared.
 *
 * Per-file rather than only in aggregate, because the spec's requirement that "a failure for
 * one image must not corrupt or incorrectly discard the remaining valid imports" is only
 * demonstrable if the record can say which file failed. Ten photographs where the third is
 * unreadable must read as nine successes and one named failure, not as "10 uploaded, 9
 * extracted".
 */
export interface ImportFileOutcome {
  /** The examiner's own filename, kept as a label so a report can name it. Never a path. */
  name: string;
  /** Bytes received, so an oversized or truncated upload is diagnosable after the fact. */
  size: number;
  /** Items the file appeared to contain — rows, question blocks, images. */
  examined: number;
  /** Candidates extracted, before validation and de-duplication. */
  extracted: number;
  /** Items the parser could not turn into a candidate at all. */
  failed: number;
  /** Why the file as a whole could not be read, when that is what happened. */
  error?: string | null;
}

export interface ImportBatchDocument extends Document {
  /** Who uploaded. Null only if the account was deleted afterwards. */
  actor: Types.ObjectId | null;
  actorLabel: string;

  // --- What was uploaded, and what read it ---
  kind: ImportFileKind;
  parserId: string;
  /**
   * `'deterministic'` or `'model'`. A statement of fact that the UI prints and provenance
   * inherits — never a label chosen for how it sounds. Only the image path is `'model'`.
   */
  extraction: string;
  /** The exact model that read the files, for the image path only. Null otherwise. */
  modelName: string | null;
  files: ImportFileOutcome[];

  // --- What the examiner asked to assume for rows that did not say ---
  defaultClassLevel: string;
  defaultDifficulty: string;
  /**
   * The fallback chapter, when the examiner chose one. **Null is normal** since the chapter
   * became optional: a row's own `Topic` column, or `lib/chapterDetection.ts` reading the
   * question, may supply it instead.
   */
  defaultTopic: Types.ObjectId | null;
  /**
   * The subject the whole import was filed into.
   *
   * Stored rather than derived from `defaultTopic`, because that is now nullable and approval
   * needs a subject regardless. Deriving it from a chapter that may not exist would make an
   * import unapprovable for a reason the examiner could not act on. There is exactly one subject
   * in this product, but recording *which* keeps the row self-describing.
   */
  subject: Types.ObjectId | null;

  // --- What came out ---
  status: ImportOutcomeStatus;
  /** Total items examined across every file. */
  examined: number;
  /** Candidates that survived validation and de-duplication, i.e. offered for review. */
  accepted: number;
  /** Candidates refused by `createQuestionSchema`. */
  rejected: number;
  /** Candidates refused as near-duplicates of the batch or the bank. */
  duplicates: number;
  /** The first few rejection reasons, so a bad template is diagnosable without the file. */
  rejectionReasons: string[];
  /** How many the reviewer went on to save. Incremented by the approval path. */
  approved: number;
  /**
   * How many the reviewer discarded.
   *
   * The one fact about an import that nothing else could ever recover, and the one that says
   * whether a template or a photograph quality is actually usable — without it the row shows
   * forty accepted and is silent about the examiner having kept three.
   */
  rejectedByReviewer: number;
  durationMs: number;
  /** The failure, when the whole import failed. Carries no credential. */
  error: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const fileOutcomeSchema = new Schema<ImportFileOutcome>(
  {
    name: { type: String, required: true, trim: true, maxlength: 260 },
    size: { type: Number, required: true, min: 0 },
    examined: { type: Number, default: 0, min: 0 },
    extracted: { type: Number, default: 0, min: 0 },
    failed: { type: Number, default: 0, min: 0 },
    error: { type: String, default: null, maxlength: 600 },
  },
  { _id: false },
);

const importBatchSchema = new Schema<ImportBatchDocument>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    actorLabel: { type: String, required: true, trim: true, maxlength: 200 },

    kind: { type: String, enum: IMPORT_FILE_KINDS, required: true, index: true },
    parserId: { type: String, required: true, trim: true, maxlength: 60 },
    extraction: { type: String, required: true, trim: true, maxlength: 40 },
    modelName: { type: String, default: null, trim: true, maxlength: 120 },
    files: { type: [fileOutcomeSchema], default: [] },

    defaultClassLevel: { type: String, required: true },
    defaultDifficulty: { type: String, required: true },
    defaultTopic: { type: Schema.Types.ObjectId, ref: 'Topic', default: null },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },

    status: { type: String, enum: IMPORT_OUTCOMES, required: true, index: true },
    examined: { type: Number, default: 0, min: 0 },
    accepted: { type: Number, default: 0, min: 0 },
    rejected: { type: Number, default: 0, min: 0 },
    duplicates: { type: Number, default: 0, min: 0 },
    rejectionReasons: { type: [String], default: [] },
    approved: { type: Number, default: 0, min: 0 },
    rejectedByReviewer: { type: Number, default: 0, min: 0 },
    durationMs: { type: Number, default: 0, min: 0 },
    error: { type: String, default: null, maxlength: 600 },
  },
  { timestamps: true },
);

// "What did we import lately, and did it work?" — the shape of the only listing over this
// collection, and of the cost question an owner asks about the image path.
importBatchSchema.index({ createdAt: -1 });
importBatchSchema.index({ actor: 1, createdAt: -1 });

export const ImportBatch = mongoose.model<ImportBatchDocument>('ImportBatch', importBatchSchema);
