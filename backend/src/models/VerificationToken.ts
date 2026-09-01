import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type VerificationTokenType = 'email_verify' | 'password_reset';

/**
 * Single-use, expiring tokens emailed to a student.
 *
 * As with refresh tokens, only the SHA-256 hash is stored: the raw value exists
 * only in the email that was sent. `usedAt` makes each token strictly one-shot,
 * so a reset link cannot be replayed after it has been consumed.
 */
export interface VerificationTokenDocument extends Document {
  tokenHash: string;
  student: Types.ObjectId;
  type: VerificationTokenType;
  expiresAt: Date;
  usedAt?: Date | null;
  /**
   * Set when this token stopped being live because a **newer one was issued**, rather
   * than because somebody redeemed it.
   *
   * `usedAt` is set in both cases, so that field alone cannot tell them apart -- and the
   * difference decides what a reader is told and, worse, what the server does next. A
   * *redeemed* link means the job may already be done; a *superseded* link means the
   * reader is holding an older email and the live link is still sitting in their inbox.
   * Answering the second case with "already used, so we have emailed you a new one"
   * sent another link, which superseded the live one, so the next click was stale again:
   * a loop that burned 24 tokens and left two real accounts unable to verify at all.
   */
  supersededAt?: Date | null;
  createdAt: Date;
}

const verificationTokenSchema = new Schema<VerificationTokenDocument>({
  tokenHash: { type: String, required: true, unique: true },
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  type: { type: String, enum: ['email_verify', 'password_reset'], required: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  supersededAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationToken = mongoose.model<VerificationTokenDocument>('VerificationToken', verificationTokenSchema);
