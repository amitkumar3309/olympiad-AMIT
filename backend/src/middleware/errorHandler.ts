import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import { config } from '../config';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, error: `No route found for ${req.method} ${req.originalUrl}` });
}

/**
 * Global safety net. Existing routes keep their own try/catch (see
 * CLAUDE.md "Backend Conventions") — this exists for anything that isn't
 * already caught: validation errors, 404s, and any future route that
 * forgets a try/catch (Express 5 forwards rejected async handlers here
 * automatically).
 */
/** The fields body-parser's errors carry (they are `http-errors`). */
interface BodyParserError {
  type?: unknown;
  status?: unknown;
  expose?: unknown;
  limit?: unknown;
}

function describeBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * What body-parser refuses before any route runs (Milestone 30 Phase 7b). Each is an http-error
 * with a 4xx status; they used to fall through to the 500 below, so a photograph over a form's
 * limit read as a crash. A too-large body is described in the size a person thinks in — the
 * file, not its base64, which is about a third larger (every allowance in `app.ts` is ×1.4).
 */
export function bodyParserFailure(err: unknown): { status: number; message: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const { type, status, expose, limit } = err as BodyParserError;
  if (type === 'entity.too.large') {
    const accepted = typeof limit === 'number' ? ` — it accepts about ${describeBytes(limit / 1.4)}` : '';
    return { status: 413, message: `That is larger than this form can take${accepted}. Choose a smaller file.` };
  }
  if (type === 'entity.parse.failed') {
    return { status: 400, message: 'The request could not be read: its body is not valid JSON.' };
  }
  if (typeof status === 'number' && status >= 400 && status < 500 && expose === true) {
    return { status, message: 'The request could not be read.' };
  }
  return null;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const refused = bodyParserFailure(err);
  if (refused) {
    logger.warn({ path: req.originalUrl, statusCode: refused.status }, refused.message);
    res.status(refused.status).json({ success: false, error: refused.message });
    return;
  }

  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.originalUrl }, err.message);
    } else {
      logger.warn({ path: req.originalUrl, statusCode: err.statusCode }, err.message);
    }
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  logger.error({ err, path: req.originalUrl }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: config.isProd ? 'Internal server error' : message,
  });
}
