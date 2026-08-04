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
  createdAt: Date;
}

const verificationTokenSchema = new Schema<VerificationTokenDocument>({
  tokenHash: { type: String, required: true, unique: true },
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  type: { type: String, enum: ['email_verify', 'password_reset'], required: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationToken = mongoose.model<VerificationTokenDocument>('VerificationToken', verificationTokenSchema);
