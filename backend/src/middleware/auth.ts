import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ApiError } from '../lib/ApiError';
import { verifyAccessToken, type AccessTokenClaims } from '../lib/tokens';

export type AuthPayload = AccessTokenClaims;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * The only auth gate in this backend — reuse it, don't hand-roll token
 * verification in a new route (see CLAUDE.md "Backend Conventions").
 *
 * Verification is stateless: signature, expiry and role only, with no database
 * read, so it stays cheap on every request. Revocation is therefore bounded by
 * the access-token TTL (15 minutes by default): refresh tokens are revoked in
 * the database immediately, so a revoked session cannot outlive one access-token
 * lifetime. That trade-off is documented in SECURITY.md.
 */
export function requireAuth(...roles: Array<'student' | 'admin'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const claims = verifyAccessToken(req.cookies?.[config.auth.accessCookieName]);
    if (!claims) {
      next(ApiError.unauthorized('Not authenticated'));
      return;
    }
    if (roles.length > 0 && !roles.includes(claims.role)) {
      next(ApiError.forbidden('Not authorized'));
      return;
    }
    req.user = claims;
    next();
  };
}
