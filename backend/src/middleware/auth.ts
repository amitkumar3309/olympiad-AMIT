import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { ApiError } from '../lib/ApiError';

export interface AuthPayload {
  role: 'student' | 'admin';
  sub?: string;
  studentId?: string;
  email?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * The only auth gate in this backend — reuse it, don't hand-roll JWT
 * verification in a new route (see CLAUDE.md "Backend Conventions").
 */
export function requireAuth(...roles: Array<'student' | 'admin'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = req.cookies?.[config.auth.cookieName];
    if (!token) {
      next(ApiError.unauthorized('Not authenticated'));
      return;
    }
    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
      if (roles.length > 0 && !roles.includes(payload.role)) {
        next(ApiError.forbidden('Not authorized'));
        return;
      }
      req.user = payload;
      next();
    } catch {
      next(ApiError.unauthorized('Invalid or expired session'));
    }
  };
}
