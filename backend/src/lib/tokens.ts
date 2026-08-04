import crypto from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { config } from '../config';
import { logger } from './logger';
import { RefreshToken, VerificationToken, type VerificationTokenType } from '../models';

/** Claims carried by an access token. Kept small — it travels on every request. */
export interface AccessTokenClaims {
  role: 'student' | 'admin';
  /** Mongo `_id` of the student (absent for admin, which has no DB record). */
  sub?: string;
  studentId?: string;
  email?: string;
  /** Student's `tokenVersion` at issue time; a mismatch means the token was revoked. */
  tv?: number;
}

/**
 * Hash used for every persisted token. SHA-256 (not bcrypt) is correct here:
 * these are 256 bits of cryptographic randomness, not low-entropy human
 * passwords, so there is nothing to brute-force and we want lookups to be fast
 * and deterministic. Passwords still use bcrypt — see `lib/password.ts`.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// Access tokens (stateless JWT)
// ---------------------------------------------------------------------------

export function signAccessToken(claims: AccessTokenClaims): string {
  const ttl = claims.role === 'admin' ? config.admin.tokenTtl : config.auth.accessTokenTtl;
  return jwt.sign(claims, config.jwtSecret, { expiresIn: ttl } as SignOptions);
}

/** Returns the claims, or null if the token is missing, malformed, tampered with, or expired. */
export function verifyAccessToken(token: string | undefined): AccessTokenClaims | null {
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret) as AccessTokenClaims;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Refresh tokens (opaque, stored hashed, rotated on use)
// ---------------------------------------------------------------------------

export interface IssuedRefreshToken {
  /** The raw value — returned once, sent to the client, never persisted. */
  token: string;
  expiresAt: Date;
  familyId: string;
}

export async function issueRefreshToken(
  studentId: Types.ObjectId,
  options: { familyId?: string; userAgent?: string; ip?: string } = {},
): Promise<IssuedRefreshToken> {
  const token = randomToken();
  const familyId = options.familyId ?? crypto.randomUUID();
  const expiresAt = new Date(Date.now() + config.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    tokenHash: hashToken(token),
    student: studentId,
    familyId,
    expiresAt,
    userAgent: options.userAgent,
    ip: options.ip,
  });

  return { token, expiresAt, familyId };
}

export type RefreshOutcome =
  | { ok: true; studentId: Types.ObjectId; next: IssuedRefreshToken }
  | { ok: false; reason: 'missing' | 'unknown' | 'expired' | 'reused' };

/**
 * Validates a presented refresh token and rotates it.
 *
 * Reuse detection: a token that was already rotated away (`replacedByHash` set)
 * being presented again means two parties hold the same token — almost always
 * theft or a replayed request. We revoke the entire family rather than trust
 * either party, forcing a fresh login.
 */
export async function rotateRefreshToken(
  rawToken: string | undefined,
  context: { userAgent?: string; ip?: string } = {},
): Promise<RefreshOutcome> {
  if (!rawToken) return { ok: false, reason: 'missing' };

  const existing = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
  if (!existing) return { ok: false, reason: 'unknown' };

  if (existing.revokedAt || existing.replacedByHash) {
    logger.warn(
      { student: String(existing.student), familyId: existing.familyId },
      'Refresh token reuse detected — revoking the whole token family',
    );
    await revokeTokenFamily(existing.familyId);
    return { ok: false, reason: 'reused' };
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  const next = await issueRefreshToken(existing.student, {
    familyId: existing.familyId,
    userAgent: context.userAgent,
    ip: context.ip,
  });

  existing.revokedAt = new Date();
  existing.replacedByHash = hashToken(next.token);
  await existing.save();

  return { ok: true, studentId: existing.student, next };
}

/** Revokes a single presented token (normal logout). Safe if it doesn't exist. */
export async function revokeRefreshToken(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await RefreshToken.updateOne(
    { tokenHash: hashToken(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeTokenFamily(familyId: string): Promise<void> {
  await RefreshToken.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/** Revokes every active session for a student (logout-everywhere, password reset). */
export async function revokeAllRefreshTokens(studentId: Types.ObjectId): Promise<void> {
  await RefreshToken.updateMany({ student: studentId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Verification / password-reset tokens (single-use, stored hashed)
// ---------------------------------------------------------------------------

export async function issueVerificationToken(
  studentId: Types.ObjectId,
  type: VerificationTokenType,
): Promise<{ token: string; expiresAt: Date }> {
  const ttlMs =
    type === 'email_verify'
      ? config.auth.emailVerifyTtlHours * 60 * 60 * 1000
      : config.auth.passwordResetTtlMinutes * 60 * 1000;

  // Invalidate any outstanding token of the same type so only the newest link
  // works — otherwise "resend" would leave several valid links in inboxes.
  await VerificationToken.updateMany(
    { student: studentId, type, usedAt: null },
    { $set: { usedAt: new Date() } },
  );

  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await VerificationToken.create({ tokenHash: hashToken(token), student: studentId, type, expiresAt });
  return { token, expiresAt };
}

export type VerificationOutcome =
  | { ok: true; studentId: Types.ObjectId }
  | { ok: false; reason: 'invalid' | 'used' | 'expired' };

/** Consumes a token atomically, so a link cannot be redeemed twice concurrently. */
export async function consumeVerificationToken(
  rawToken: string,
  type: VerificationTokenType,
): Promise<VerificationOutcome> {
  const tokenHash = hashToken(rawToken);
  const record = await VerificationToken.findOne({ tokenHash, type });
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.usedAt) return { ok: false, reason: 'used' };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  // findOneAndUpdate with `usedAt: null` in the filter makes the consume atomic:
  // if two requests race, exactly one updates the document.
  const claimed = await VerificationToken.findOneAndUpdate(
    { _id: record._id, usedAt: null },
    { $set: { usedAt: new Date() } },
  );
  if (!claimed) return { ok: false, reason: 'used' };

  return { ok: true, studentId: record.student };
}
