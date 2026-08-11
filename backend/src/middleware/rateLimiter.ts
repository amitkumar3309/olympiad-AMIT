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

/**
 * Self-service account changes: password change and photo replacement.
 *
 * Tighter than ordinary API traffic for two different reasons. The password route
 * takes the *current* password, which makes it a second place an attacker with a
 * stolen session could guess it; and the photo route is the only other endpoint
 * allowed a multi-megabyte body, so it needs a limit of its own rather than sitting
 * behind the general one.
 */
export const accountUpdateLimiter = limiter({
  windowMs: HOUR,
  limit: 20,
  message: 'Too many account changes. Please wait a while before trying again.',
});

/**
 * Starting and submitting a practice session.
 *
 * Both are the expensive end of the Practice Zone: starting runs an aggregation and
 * writes a document holding up to 50 questions, and submitting grades all of them.
 * Saving an individual answer is deliberately **not** behind this — a student working
 * through a 50-question paper legitimately saves dozens of answers in a few minutes,
 * and rate-limiting that would lose their work.
 *
 * Generous enough for genuine repeated practice (a session every ~30 seconds for an
 * hour) while still bounding how fast the collection can be grown.
 */
export const practiceLimiter = limiter({
  windowMs: HOUR,
  limit: 120,
  message: 'Too many practice sessions started. Please wait a little before starting another.',
});

/** Refresh is called routinely by every active client, so this is generous. */
export const refreshLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 60,
  message: 'Too many refresh attempts. Please sign in again.',
});
