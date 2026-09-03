import crypto from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { config } from '../config';
import { logger } from './logger';
import { isRole, type Role } from './permissions';
import { RefreshToken, VerificationToken, type VerificationTokenType } from '../models';

/** Claims carried by an access token. Kept small — it travels on every request. */
export interface AccessTokenClaims {
  /**
   * Role at issue time. Treated as a *hint*, not the final word: any privileged
   * request re-reads the role from the database (see `middleware/authorize.ts`), so
   * a demotion cannot be outlived by an already-issued token.
   */
  role: Role;
  /**
   * Mongo `_id` of the account. Optional only because tokens issued before
   * Milestone 11 (when the root administrator had no document) lack it — such a
   * token now resolves to no account and is refused, which is the intended
   * migration path rather than an oversight.
   */
  sub?: string;
  studentId?: string;
  email?: string;
  /** Account's `tokenVersion` at issue time; a mismatch means the token was revoked. */
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
  // One TTL for everybody since Milestone 11. The root administrator used to get a
  // longer one because it had no refresh token to renew a short access token with;
  // now that it has an account, it renews like anything else — and its elevated
  // privileges are re-derived from the database that much more often as a result.
  return jwt.sign(claims, config.jwtSecret, { expiresIn: config.auth.accessTokenTtl } as SignOptions);
}

/** Returns the claims, or null if the token is missing, malformed, tampered with, or expired. */
export function verifyAccessToken(token: string | undefined): AccessTokenClaims | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    // A valid signature is not enough: reject anything whose `role` is not one we
    // recognise, so an unknown or missing role can never reach a permission lookup
    // and be silently treated as authorized.
    if (typeof decoded !== 'object' || decoded === null || !isRole((decoded as { role?: unknown }).role)) {
      return null;
    }
    return decoded as AccessTokenClaims;
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

  /**
   * Invalidate any outstanding token of the same type so only the newest link works —
   * otherwise "resend" would leave several valid links in inboxes.
   *
   * `supersededAt` is set alongside `usedAt` so the two reasons a token is no longer
   * live stay distinguishable. Every existing query still treats `usedAt: null` as
   * "live"; what this adds is the ability to answer a stale link with "your newest email
   * has the working one" instead of "already used", and to *not* send yet another link
   * in that case. See the comment on the field, and TROUBLESHOOTING.md.
   */
  const now = new Date();
  await VerificationToken.updateMany(
    { student: studentId, type, usedAt: null },
    { $set: { usedAt: now, supersededAt: now } },
  );

  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await VerificationToken.create({ tokenHash: hashToken(token), student: studentId, type, expiresAt });
  return { token, expiresAt };
}

/**
 * A refusal carries the account it was *about* wherever one is known.
 *
 * Without that, a caller cannot tell the difference between the two things a spent
 * token means: "this link already did its job" and "this link was burned and the job
 * never happened". Those need opposite answers — the first is a success, the second is
 * a dead end — and a bare reason string cannot distinguish them.
 */
export type VerificationOutcome =
  | { ok: true; studentId: Types.ObjectId }
  | { ok: false; reason: 'invalid' }
  /**
   * `superseded` is a *stale* link, not a spent one: a newer token was issued, so the
   * working link is the most recent email. It is separate from `used` because the two
   * need opposite handling — a caller must not "help" by sending another link, which is
   * what supersedes the live one and loops.
   */
  | { ok: false; reason: 'used' | 'expired' | 'superseded'; studentId: Types.ObjectId };

/** Consumes a token atomically, so a link cannot be redeemed twice concurrently. */
export async function consumeVerificationToken(
  rawToken: string,
  type: VerificationTokenType,
): Promise<VerificationOutcome> {
  const tokenHash = hashToken(rawToken);
  const record = await VerificationToken.findOne({ tokenHash, type });
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.usedAt) {
    return {
      ok: false,
      reason: record.supersededAt ? 'superseded' : 'used',
      studentId: record.student,
    };
  }
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired', studentId: record.student };

  // findOneAndUpdate with `usedAt: null` in the filter makes the consume atomic:
  // if two requests race, exactly one updates the document.
  const claimed = await VerificationToken.findOneAndUpdate(
    { _id: record._id, usedAt: null },
    { $set: { usedAt: new Date() } },
  );
  if (!claimed) return { ok: false, reason: 'used', studentId: record.student };

  return { ok: true, studentId: record.student };
}

/**
 * Whether a live (unused, unexpired) link of this type is already in the account's
 * inbox.
 *
 * This is what makes "send them a fresh link" safe. Issuing a token invalidates the
 * outstanding one, so resending on *every* stale click destroys the very link the error
 * message tells the reader to open — and each further click destroys the next one. Asking
 * first turns that loop into a single honest answer: the working link has already been
 * sent, go and open it.
 */
export async function hasLiveVerificationToken(
  studentId: Types.ObjectId,
  type: VerificationTokenType,
): Promise<boolean> {
  const live = await VerificationToken.exists({
    student: studentId,
    type,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  return live !== null;
}

/**
 * The newest live token of this type, or null.
 *
 * Used for the resend cooldown: the age of this row is how long ago a link was actually
 * emailed, which is the only honest basis for "you may ask for another in 4:12". A
 * counter kept anywhere else would drift from what is in the inbox.
 */
export async function newestLiveVerificationToken(
  studentId: Types.ObjectId,
  type: VerificationTokenType,
): Promise<{ createdAt: Date } | null> {
  const row = await VerificationToken.findOne({
    student: studentId,
    type,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .select('createdAt')
    .lean();
  return row ? { createdAt: row.createdAt } : null;
}

/**
 * Gives a consumed token back, so the link in somebody's inbox still works.
 *
 * Consumption happens *before* the work the token authorises, which is what stops two
 * concurrent redemptions both proceeding. The cost of that ordering is that a failure
 * afterwards — a save that throws, a cold start that times out, a dropped connection —
 * leaves the link permanently spent and the work never done. For email verification
 * that is unrecoverable from the student's side: every later click reports "already
 * used" while the account stays unverified, so they cannot sign in either.
 *
 * Releasing on failure keeps the atomicity (only one redemption is ever in flight) and
 * removes the dead end. It is deliberately best-effort: if this itself fails there is
 * nothing further to do, and the caller's own error is the one worth reporting.
 */
export async function releaseVerificationToken(rawToken: string, type: VerificationTokenType): Promise<void> {
  try {
    await VerificationToken.updateOne({ tokenHash: hashToken(rawToken), type }, { $set: { usedAt: null } });
  } catch (err) {
    logger.error({ err }, 'Could not release a verification token after a failed redemption');
  }
}
