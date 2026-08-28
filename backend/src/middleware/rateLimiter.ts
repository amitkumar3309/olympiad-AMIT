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

/**
 * Starting and submitting a mock-test attempt.
 *
 * Starting snapshots a paper of up to 100 questions; submitting grades all of them.
 * Saving an individual answer is deliberately **not** behind this, for the same reason
 * as practice and more so here: a student working through a timed paper saves an answer
 * every few seconds, and throttling that would cost them work they cannot get back
 * because the clock does not stop.
 *
 * Tighter than the practice limiter because a mock test is a bounded thing — a handful
 * of tests exist, each allowing a small number of attempts — so nobody legitimately
 * starts dozens in an hour.
 */
export const mockTestLimiter = limiter({
  windowMs: HOUR,
  limit: 60,
  message: 'Too many test attempts. Please wait a little before trying again.',
});

/**
 * Answering the daily challenge.
 *
 * One submission per student per day is all that can *succeed*, so this is not really
 * abuse protection for the reward — the unique index is that. It bounds how fast a
 * client can hammer the grading path, which reads a question and writes an attempt.
 * Generous enough that a student retrying after a dropped connection never notices.
 */
export const challengeLimiter = limiter({
  windowMs: HOUR,
  limit: 30,
  message: 'Too many attempts at today’s challenge. Please wait a little before trying again.',
});

/**
 * Creating and reconciling a payment order.
 *
 * Neither route takes money, but each one spends a **Razorpay API call** and the first
 * writes a row, so an authenticated student could otherwise loop either of them for
 * free at the platform's expense — the one place in this product where a request has a
 * direct third-party cost. Generous enough that a student retrying a failed checkout,
 * or a payment page reconciling on every load, never notices.
 */
export const paymentLimiter = limiter({
  windowMs: HOUR,
  limit: 30,
  message: 'Too many payment attempts. Please wait a little before trying again.',
});

/**
 * Asking a language model for questions.
 *
 * The one route in the product where a single request costs **provider quota** — the same
 * argument that put `paymentLimiter` in front of the Razorpay call, and stronger here,
 * because generation is the expensive end of a metered free tier and a held-open review
 * screen can fire a regeneration per question. Without this it sat behind the general
 * `/api` limiter alone, which allows 300 requests in fifteen minutes: enough for one
 * examiner leaning on the button to exhaust a day's quota before lunch.
 *
 * Configurable (`GENERATION_RATE_LIMIT_PER_HOUR`) rather than fixed, because the right
 * number is a property of the deployment's quota rather than of the code. Generous by
 * default: sixty covers a genuine authoring session of a dozen batches with individual
 * regenerations, and still bounds the damage.
 *
 * Deliberately **not** applied to the status or model-list routes: the first makes no
 * network call and runs on every page load, and the second is a cheap metadata read whose
 * failure only costs the model picker.
 */
export const generationLimiter = limiter({
  windowMs: HOUR,
  limit: config.ai.generationsPerHour,
  message: 'Too many generation requests. Please wait a while before asking for more questions.',
});

/**
 * Uploading a file to the bulk question importer.
 *
 * The most expensive route in the product on two separate counts, which is why it is not left
 * to the general `/api` limiter. Every call **decompresses an archive** and validates up to five
 * hundred rows — more CPU than anything else here spends — and the image path additionally
 * **spends provider quota per file**, so one request carrying ten photographs is ten model calls.
 * That second property is the one `generationLimiter` exists for, and it is why this limiter is
 * mounted **ahead of the permission check**: the cheapest possible rejection is the right one
 * when a request costs money, and an unauthenticated flood should never reach the database read
 * that authorization performs.
 *
 * Configurable (`IMPORT_RATE_LIMIT_PER_HOUR`) because the right number is a property of the
 * deployment quota and plan rather than of the code. Generous enough by default that a real
 * afternoon of importing — twenty uploads — never notices.
 */
export const importLimiter = limiter({
  windowMs: HOUR,
  limit: config.imports.importsPerHour,
  message: 'Too many imports. Please wait a while before uploading more files.',
});

/**
 * Administrative acts on somebody else's account.
 *
 * These sat behind the general `/api` limiter alone, which was recorded as an open gap
 * in SECURITY.md and closed by the security audit. The one that matters most is the
 * staff password reset: it **mints a working credential** for another account, so a
 * stolen admin session looping it is how a whole cohort's accounts get taken at once.
 * Deletion and session revocation are here for the same reason — they are the acts
 * whose damage scales with how many times they can be repeated.
 *
 * Deliberately not applied to the read-only listings: an administrator legitimately
 * pages through hundreds of accounts, and throttling that would only teach staff that
 * the console is broken.
 */
export const adminActionLimiter = limiter({
  windowMs: HOUR,
  limit: 60,
  message: 'Too many account administration actions. Please wait a little before trying again.',
});

/**
 * The unauthenticated result and certificate lookups.
 *
 * `AMIT_0000`–`AMIT_9999` is only ten thousand identifiers, so these two routes can be
 * walked to harvest the roll. The durable fix is that they publish a masked name (see
 * `services/resultService.ts`); this bounds the walk as well, because a public portal
 * has no reason to be read hundreds of times an hour from one address.
 */
export const publicLookupLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 60,
  message: 'Too many lookups. Please wait a few minutes before trying again.',
});

/** Refresh is called routinely by every active client, so this is generous. */
export const refreshLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 60,
  message: 'Too many refresh attempts. Please sign in again.',
});
