import type { Response } from 'express';

/**
 * Always sends { success: true, ...payload } — the envelope every route in
 * this backend must use (see CLAUDE.md "Backend Conventions").
 */
export function sendSuccess<T extends Record<string, unknown>>(res: Response, statusCode: number, payload?: T): Response {
  return res.status(statusCode).json({ success: true, ...(payload ?? {}) });
}

/**
 * Always sends { success: false, error, ...extra }.
 */
export function sendError(res: Response, statusCode: number, error: string, extra?: Record<string, unknown>): Response {
  return res.status(statusCode).json({ success: false, error, ...(extra ?? {}) });
}
