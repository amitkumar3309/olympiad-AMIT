import type { Request, Response } from 'express';
import type mongoose from 'mongoose';
import { config } from '../config';
import type { StudentDocument } from '../models';
import { issueRefreshToken, signAccessToken, type AccessTokenClaims } from './tokens';

/**
 * How a signed-in session is put on, and taken off, a response.
 *
 * Extracted from `auth.routes.ts` in Milestone 5 because a second route now
 * establishes a session: changing your password revokes every existing session and
 * then has to hand this device a fresh one. Two copies of "which cookies a session
 * is, and what claims go in the access token" is precisely the kind of duplication
 * that ends with one of them forgetting `httpOnly`.
 *
 * The cookie options themselves still come from `config` — this module decides
 * *what* is set, never *how* it is secured.
 */

export function studentObjectId(student: StudentDocument): mongoose.Types.ObjectId {
  return student._id as mongoose.Types.ObjectId;
}

export function studentClaims(student: StudentDocument): AccessTokenClaims {
  return {
    role: student.role,
    sub: String(student._id),
    studentId: student.studentId,
    email: student.email,
    tv: student.tokenVersion,
  };
}

export function setAccessCookie(res: Response, student: StudentDocument): void {
  res.cookie(config.auth.accessCookieName, signAccessToken(studentClaims(student)), config.auth.accessCookieOptions);
}

/** Issues both cookies: a fresh access token and a new refresh-token family member. */
export async function establishSession(res: Response, student: StudentDocument, req: Request): Promise<void> {
  setAccessCookie(res, student);
  const refresh = await issueRefreshToken(studentObjectId(student), {
    userAgent: req.get('user-agent') ?? undefined,
    ip: req.ip,
  });
  res.cookie(config.auth.refreshCookieName, refresh.token, config.auth.refreshCookieOptions);
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(config.auth.accessCookieName, config.auth.accessCookieOptions);
  res.clearCookie(config.auth.refreshCookieName, config.auth.refreshCookieOptions);
}
