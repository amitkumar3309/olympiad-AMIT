import type { Response } from 'express';
import { ApiError } from './ApiError';
import { sendError } from './apiResponse';
import { logger } from './logger';

/**
 * Translates an error thrown by the service layer into the standard envelope.
 *
 * Services signal rule violations by throwing `ApiError` (`ApiError.conflict(...)`
 * and friends), which keeps each rule stated once, at the point it is enforced,
 * instead of threading a result type back through every caller. This is the single
 * place that maps those to a status code.
 *
 * The distinction it preserves matters: an `ApiError` is an *expected* refusal and
 * its message is written for the user, so it is passed through. Anything else is a
 * bug — it is logged with the stack and answered with a generic 500, never flattened
 * into a tidy 4xx that would hide it from both the user and the logs.
 */
export function respondToServiceError(res: Response, err: unknown, context: { log: string; fallback: string }): void {
  if (err instanceof ApiError) {
    sendError(res, err.statusCode, err.message);
    return;
  }
  logger.error({ err }, context.log);
  sendError(res, 500, context.fallback);
}
