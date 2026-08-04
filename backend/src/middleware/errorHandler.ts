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
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
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
