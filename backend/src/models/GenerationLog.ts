import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * One record of asking a model for questions — what was asked, what came back, and what
 * survived (Milestone 18).
 *
 * ## Why this exists separately from `AuditLog`
 *
 * The audit trail answers "who did what to the bank", and it already records an approval
 * as `questions.generated`. This answers a different question: **"why did the generator
 * behave like that?"** — how many candidates a model returned, how many failed
 * validation and for what reason, how many were near-duplicates of questions already in
 * the bank, how long it took, and the provider's own error when it failed.
 *
 * Those are debugging and cost facts, not administrative ones. Putting them in
 * `AuditLog` would bury genuine administrative history under machine chatter, and a
 * failed generation — which writes a row here — is not an administrative act at all.
 *
 * ## No TTL, deliberately
 *
 * The same reasoning as `AuditLog` and `StudentActivity`: this is the evidence for "the
 * model produced this, on this date, from this prompt configuration". A question in the
 * bank may be traced back to the run that proposed it years later, which is exactly the
 * question somebody will eventually ask about machine-written exam content.
 *
 * It stores **counts and parameters, never question text**. The candidates themselves
 * are either approved (and then live in `Question`, with their own history) or
 * discarded — and keeping rejected model output would be storing unreviewed machine
 * text indefinitely for no reader.
 */

export const GENERATION_OUTCOMES = ['succeeded', 'failed'] as const;
export type GenerationOutcomeStatus = (typeof GENERATION_OUTCOMES)[number];

export const GENERATION_PURPOSES = ['question_bank', 'mock_test', 'daily_challenge'] as const;
export type GenerationPurpose = (typeof GENERATION_PURPOSES)[number];

export interface GenerationLogDocument extends Document {
  /** Who asked. Null only if the account was deleted afterwards. */
  actor: Types.ObjectId | null;
  actorLabel: string;
  /** What the batch was for, so cost can be attributed to a feature. */
  purpose: GenerationPurpose;

  // --- Which model, and how it was configured ---
  generatorId: string;
  generatorKind: string;
  modelName: string;

  // --- What was asked for ---
  subject: Types.ObjectId | null;
  chapters: Types.ObjectId[];
  classLevel: string;
  difficulty: string;
  questionType: string;
  language: string;
  bloomLevel: string | null;
  requested: number;
  /** Whether the examiner typed a steer, not what they typed. */
  hadInstructions: boolean;

  // --- What happened ---
  status: GenerationOutcomeStatus;
  /** Candidates the model returned before any checking. */
  returned: number;
  /** Passed validation and survived duplicate detection. */
  accepted: number;
  /** Failed `createQuestionSchema`, with the reasons, so a bad prompt is diagnosable. */
  rejected: number;
  rejectionReasons: string[];
  /** Refused as too similar to an existing question or to another candidate. */
  duplicates: number;
  /** How many the examiner went on to approve. Written by the approval call. */
  approved: number;
  /**
   * How many the examiner threw away themselves, as opposed to how many our own validation
   * refused (`rejected`).
   *
   * The two counts together are the only honest measure of whether a prompt configuration
   * is any good: `rejected` catches candidates that broke a rule, and this catches the ones
   * that were valid and simply not worth keeping — which is the far commoner failure and
   * the one nothing else in the system would ever have noticed.
   */
  rejectedByReviewer: number;
  durationMs: number;
  /** The provider's own message when `status` is `failed`. Never a key. */
  error: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const generationLogSchema = new Schema<GenerationLogDocument>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    actorLabel: { type: String, required: true },
    purpose: { type: String, enum: GENERATION_PURPOSES, required: true },

    generatorId: { type: String, required: true },
    generatorKind: { type: String, required: true },
    modelName: { type: String, required: true },

    subject: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    chapters: { type: [{ type: Schema.Types.ObjectId, ref: 'Topic' }], default: [] },
    classLevel: { type: String, required: true },
    difficulty: { type: String, required: true },
    questionType: { type: String, required: true },
    language: { type: String, required: true },
    bloomLevel: { type: String, default: null },
    requested: { type: Number, required: true, min: 0 },
    hadInstructions: { type: Boolean, default: false },

    status: { type: String, enum: GENERATION_OUTCOMES, required: true },
    returned: { type: Number, default: 0, min: 0 },
    accepted: { type: Number, default: 0, min: 0 },
    rejected: { type: Number, default: 0, min: 0 },
    rejectionReasons: { type: [String], default: [] },
    duplicates: { type: Number, default: 0, min: 0 },
    approved: { type: Number, default: 0, min: 0 },
    rejectedByReviewer: { type: Number, default: 0, min: 0 },
    durationMs: { type: Number, default: 0, min: 0 },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

// The console reads newest-first, and filters by outcome when hunting a failure.
generationLogSchema.index({ createdAt: -1 });
generationLogSchema.index({ status: 1, createdAt: -1 });

export const GenerationLog = mongoose.model<GenerationLogDocument>('GenerationLog', generationLogSchema);
