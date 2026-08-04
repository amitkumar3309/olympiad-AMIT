import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * Taxonomy entries are archived, never deleted, once anything references them —
 * the same reasoning as accounts (see the Milestone 3 ADR): a hard delete would
 * leave questions pointing at nothing, and an archived subject still has to read
 * correctly on the questions already filed under it.
 */
export const TAXONOMY_STATUSES = ['active', 'archived'] as const;
export type TaxonomyStatus = (typeof TAXONOMY_STATUSES)[number];

export interface SubjectDocument extends Document {
  name: string;
  /** Stable handle derived from `name`; unique. Not an authorization key. */
  slug: string;
  description?: string | null;
  status: TaxonomyStatus;
  /** Ascending sort key for the admin UI, so subjects are not stuck alphabetical. */
  displayOrder: number;
  createdBy?: Types.ObjectId | null;
  /** Denormalised actor label, so history reads standalone (as in `AuditLog`). */
  createdByLabel?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const subjectSchema = new Schema<SubjectDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    status: { type: String, enum: TAXONOMY_STATUSES, default: 'active', index: true },
    displayOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    createdByLabel: { type: String, default: null },
  },
  // `timestamps` rather than a hand-rolled `createdAt`: this collection is edited
  // after creation, so `updatedAt` has to be maintained and Mongoose does it
  // correctly for updates issued through the model as well as through a document.
  { timestamps: true },
);

// Case-insensitive uniqueness on the display name as well as the slug. Two
// subjects called "Algebra" and "algebra" are a data-entry mistake, not two
// subjects, and the slug index alone would already reject them — this makes the
// intent explicit and the error message accurate.
subjectSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
subjectSchema.index({ status: 1, displayOrder: 1, name: 1 });

export const Subject = mongoose.model<SubjectDocument>('Subject', subjectSchema);
