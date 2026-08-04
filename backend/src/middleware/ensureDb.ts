import type { NextFunction, Request, Response } from 'express';
import { connectDB, isConnected } from '../db/connection';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';

/**
 * Guarantees a MongoDB connection before any data route runs.
 *
 * This exists because the Vercel serverless entry (backend/api/index.ts) imports
 * the Express app directly and never runs the local bootstrap in server.ts — so
 * without this, no connection would ever be opened in production. connectDB()
 * caches and de-duplicates in-flight connects, making this cheap to call on
 * every request (a warm serverless container hits the already-connected path).
 */
export async function ensureDb(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (isConnected()) {
    next();
    return;
  }
  try {
    await connectDB();
    next();
  } catch (err) {
    logger.error({ err }, 'Request rejected: database unavailable');
    next(new ApiError(503, 'Database unavailable. Please try again shortly.'));
  }
}
