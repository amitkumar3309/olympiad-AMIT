import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Applied to every /api route. Deliberately excludes /health and /ready
 * (mounted before this in app.ts) so monitoring probes are never throttled.
 */
export const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.generalMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
});

/**
 * Applied additionally to the three auth routes (register/login/admin-login)
 * to reduce brute-force risk — see SECURITY.md.
 */
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});
