import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * One document per issued refresh token.
 *
 * The raw token is NEVER stored — only its SHA-256 hash, so a database leak
 * does not hand out usable sessions. Tokens are rotated on every refresh:
 * the old document is marked revoked and points at its replacement, which
 * lets us detect reuse of an already-rotated token (a strong signal the token
 * was stolen) and revoke the entire family. See SECURITY.md.
 */
export interface RefreshTokenDocument extends Document {
  tokenHash: string;
  student: Types.ObjectId;
  /** Shared by every token descended from one login, so a whole lineage can be killed at once. */
  familyId: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  /** Hash of the token that replaced this one during rotation. */
  replacedByHash?: string | null;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>({
  tokenHash: { type: String, required: true, unique: true },
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  familyId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  replacedByHash: { type: String, default: null },
  userAgent: { type: String },
  ip: { type: String },
  createdAt: { type: Date, default: Date.now },
});

// TTL index: MongoDB removes expired tokens automatically, so the collection
// doesn't grow without bound and we don't need a cleanup job.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema);
