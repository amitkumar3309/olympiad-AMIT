import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * An issued certificate for one student's official exam result.
 *
 * ## Everything printable is snapshotted, on purpose
 *
 * The fields below duplicate data that also lives on `Student`, `Exam` and `Result`.
 * That is not an oversight and must not be "normalised away".
 *
 * A certificate is a statement about a moment: *this person, this paper, this score,
 * this date*. If the PDF were rendered by joining live documents, then correcting a
 * spelling in a student's name would silently reissue every certificate they hold
 * with different text, and re-tuning an exam's merit threshold would change what a
 * two-year-old certificate claims the holder achieved. Worse, verification would then
 * confirm a document that no longer matches the one in somebody's hand.
 *
 * So the printable text is frozen at issuance, and the references are kept alongside
 * it for administration and joins — never for rendering.
 *
 * ## Two identifiers, deliberately
 *
 * `certificateId` is the human-facing serial (`AMIT-CERT-2026-000123`): short,
 * readable, printed prominently, and **guessable by design** — it is a reference, not
 * a secret.
 *
 * `verificationCode` is 16 characters of `crypto` randomness and is what the public
 * verification endpoint keys on. Keeping them separate is what stops verification
 * becoming an enumeration oracle: anybody who works out that certificates are
 * numbered sequentially could otherwise walk the serials and harvest the name, school
 * and rank of every entrant. Guessing a verification code is infeasible.
 *
 * ## Revocation, not deletion
 *
 * A certificate that should not have been issued is **revoked**, keeping the row so
 * verification can answer "this was issued and has since been withdrawn" rather than
 * the far more confusing "no such certificate". A printed copy exists in the world
 * regardless of what the database says; the honest answer is the useful one.
 */

export const CERTIFICATE_TIERS = ['participation', 'merit', 'distinction'] as const;
export type CertificateTier = (typeof CERTIFICATE_TIERS)[number];

/** What each tier is called in print. One definition, so the PDF and the UI agree. */
export const CERTIFICATE_TIER_TITLES: Record<CertificateTier, string> = {
  participation: 'Certificate of Participation',
  merit: 'Certificate of Merit',
  distinction: 'Certificate of Distinction',
};

export interface CertificateDocument extends Document {
  /** Human-facing serial, unique, printed on the certificate. */
  certificateId: string;
  /** High-entropy secret the public verification endpoint keys on. Unique. */
  verificationCode: string;

  // --- References, for administration and joins. Never for rendering. ---
  student: Types.ObjectId;
  exam: Types.ObjectId;
  result: Types.ObjectId;

  tier: CertificateTier;

  // --- Snapshot: the printable text, frozen at issuance. ---
  studentName: string;
  studentIdLabel: string;
  classLevel: string;
  schoolName?: string | null;
  examTitle: string;
  examCode: string;
  score: number;
  maxMarks: number;
  percentage: number;
  rank: number;
  totalCandidates: number;
  /** The thresholds in force when this was issued, so the tier stays explicable. */
  meritThresholdPercent: number;
  distinctionThresholdPercent: number;

  issuedAt: Date;
  issuedBy?: string | null;
  revokedAt?: Date | null;
  revokedBy?: string | null;
  revokedReason?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const certificateSchema = new Schema<CertificateDocument>(
  {
    certificateId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    verificationCode: { type: String, required: true, unique: true, uppercase: true, trim: true },

    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    exam: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    result: { type: Schema.Types.ObjectId, ref: 'Result', required: true },

    tier: { type: String, enum: CERTIFICATE_TIERS, required: true, index: true },

    studentName: { type: String, required: true },
    studentIdLabel: { type: String, required: true },
    classLevel: { type: String, required: true },
    schoolName: { type: String, default: null },
    examTitle: { type: String, required: true },
    examCode: { type: String, required: true },
    score: { type: Number, required: true },
    maxMarks: { type: Number, required: true },
    percentage: { type: Number, required: true },
    rank: { type: Number, required: true },
    totalCandidates: { type: Number, required: true },
    meritThresholdPercent: { type: Number, required: true },
    distinctionThresholdPercent: { type: Number, required: true },

    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: String, default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * One certificate per student per exam. This is what makes issuance **idempotent**:
 * republishing an exam's results re-runs issuance, and the second run is a
 * duplicate-key error rather than a second certificate for the same sitting.
 */
certificateSchema.index({ student: 1, exam: 1 }, { unique: true });

/** The admin listing is "newest first, optionally filtered by tier or exam". */
certificateSchema.index({ issuedAt: -1 });

export const Certificate = mongoose.model<CertificateDocument>('Certificate', certificateSchema);
