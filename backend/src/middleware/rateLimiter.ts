import rateLimit, { type Options } from 'express-rate-limit';
import { config } from '../config';

/**
 * Rate limiting is disabled under test: the suite deliberately hammers the same
 * endpoints from one IP, and throttling would make results order-dependent.
 * Limits are exercised in production code paths, not asserted in tests.
 */
function limiter(options: Pick<Options, 'windowMs' | 'limit'> & { message: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: config.isTest ? 0 : options.limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { success: false, error: options.message },
  });
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Applied to every /api route. /health and /ready are mounted before it. */
export const generalLimiter = limiter({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.generalMax,
  message: 'Too many requests. Please try again later.',
});

/** Login + admin login: the brute-force surface. Pairs with per-account lockout. */
export const loginLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  message: 'Too many login attempts. Please try again in a few minutes.',
});

/** Registration: limits automated account creation from one address. */
export const registerLimiter = limiter({
  windowMs: HOUR,
  limit: 10,
  message: 'Too many registration attempts. Please try again later.',
});

/**
 * Password reset requests and verification resends. Tighter than login because
 * each one sends an email — this is also abuse protection for the mail quota,
 * not just for the account.
 */
export const emailActionLimiter = limiter({
  windowMs: HOUR,
  limit: 5,
  message: 'Too many requests. Please wait a while before trying again.',
});

/** Consuming a token (verify / reset): limits brute-forcing token values. */
export const tokenSubmitLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 20,
  message: 'Too many attempts. Please request a new link.',
});

/** Refresh is called routinely by every active client, so this is generous. */
export const refreshLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 60,
  message: 'Too many refresh attempts. Please sign in again.',
});
