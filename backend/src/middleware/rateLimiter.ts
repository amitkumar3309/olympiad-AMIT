import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { config } from '../config';

/**
 * Rate limiting is disabled under test: the suite deliberately hammers the same
 * endpoints from one IP, and throttling would make results order-dependent.
 * Limits are exercised in production code paths, not asserted in tests.
 *
 * `keyGenerator` is optional: by default a limit is per client address, and a limiter
 * mounted **after** the auth gate may instead key on the account (see
 * `dailyQuizLimiter`), which is what a school's shared address needs.
 */
function limiter(
  options: Pick<Options, 'windowMs' | 'limit'> & { message: string; keyGenerator?: Options['keyGenerator'] },
) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: config.isTest ? 0 : options.limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { success: false, error: options.message },
    ...(options.keyGenerator ? { keyGenerator: options.keyGenerator } : {}),
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

/**
 * Login + admin login. Pairs with per-account lockout, which is the control that
 * actually stops somebody guessing a password.
 *
 * **Fifty, not ten, because an IP is not a person here.** This product's normal case is a
 * cohort sitting in a school computer room, where forty children share one public NAT
 * address. At ten per fifteen minutes, ten of them sign in and the other thirty are told
 * to try again later — on exam morning. (Ten was not wrong when it was written: until
 * Milestone 29 `trust proxy` was unset, so this limit was one bucket for the entire
 * platform and the number was never reached by a single school in the first place. Once
 * the key became a real client address, the number had to be re-chosen for one.)
 *
 * **This does not weaken brute-force protection, because this limiter was never what
 * provided it.** `MAX_FAILED_LOGINS` (5) locks an account for `ACCOUNT_LOCK_MINUTES` (15),
 * per *account*, so an attacker gets five guesses at a given child's password however many
 * addresses they spread across — this limit is irrelevant to that attack either way.
 *
 * What it does bound is **credential stuffing**: one password tried against many accounts
 * from one address, which no per-account counter can see. Fifty per fifteen minutes caps
 * that at 200 accounts an hour from a single address, which is slow enough to be worth
 * more to an attacker to distribute than to continue — and distributing it is what the
 * shared store (see the `MemoryStore` note in SECURITY.md) is for. If that trade ever
 * looks wrong, the better fix is to key this limiter on the submitted identifier rather
 * than the address, so it follows the account being guessed at instead of punishing
 * everyone who shares a school's internet connection.
 */
export const loginLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 50,
  message: 'Too many login attempts. Please try again in a few minutes.',
});

/**
 * Registration: limits automated account creation from one address.
 *
 * **Fifty, not ten, for the same reason as `loginLimiter`** — a school registering a class
 * of forty from one computer room shares one public NAT address, and at ten per hour thirty
 * of those children were turned away. Ten was a reasonable number for one household and was
 * never reached by a school while `trust proxy` was unset, because the limit was then one
 * bucket for the whole platform rather than one per address.
 *
 * **What actually bounds registration abuse is not this number, and it is worth being
 * honest about that.** Every registration sends a verification email, and a transactional
 * mail tier is measured in hundreds *per day* — so the mail provider's quota is the binding
 * constraint long before this limiter is, at any value either side of fifty. An account that
 * is never verified also cannot sign in, so a flood of them costs mail allowance and rows,
 * not access. Size the mail plan for the cohort; see the standing note in SCALE_READINESS.md.
 *
 * The matching resend path is `emailActionLimiter`, which is deliberately much tighter
 * because a resend is a *repeat* send to an address that already has one in flight.
 */
export const registerLimiter = limiter({
  windowMs: HOUR,
  limit: 50,
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
 * Starting and submitting the Daily Quiz (Milestone 30; it replaced the daily challenge's
 * per-address `challengeLimiter`).
 *
 * One start and one submission per student per day are all that can *succeed* — the
 * unique indexes are the real guard — so this bounds how fast one client can hammer the
 * two write paths. **Keyed on the account, not the address**, because it is mounted after
 * the auth gate: forty children in one school computer room share a public address, and a
 * per-address limit of thirty would refuse the last ten on the very morning a prize is
 * on offer. Thirty requests per student per ten minutes is far beyond a real student's
 * start, submit and a few retries after a dropped connection.
 */
export const dailyQuizLimiter = limiter({
  windowMs: 10 * MINUTE,
  limit: 30,
  message: 'Too many attempts at today’s quiz. Please wait a few minutes before trying again.',
  keyGenerator: (req) => (req.user?.sub ? `student:${req.user.sub}` : ipKeyGenerator(req.ip ?? '')),
});

/**
 * Creating and reconciling a payment order.
 *
 * Neither route takes money, but each one spends a **Razorpay API call** and the first
 * writes a row, so an authenticated student could otherwise loop either of them for
 * free at the platform's expense — the one place in this product where a request has a
 * direct third-party cost.
 *
 * **Three hundred, not thirty, and the arithmetic matters because this one is about
 * revenue.** A single checkout is not a single request: `/payments/reconcile` fires on
 * every load of `/payment`, again when the Razorpay modal is dismissed, and again after a
 * successful payment, while `/payments/orders` fires per attempt. A student who looks at
 * the page, closes the dialog once and then pays spends about **six** of this budget. So
 * thirty per hour per address was not "thirty students" — it was roughly **five**, and the
 * sixth child in a school computer room reaching for their parent's card was told "too
 * many payment attempts". Nobody tries that twice, which makes this the only limiter in
 * the file whose refusal costs money rather than patience. Three hundred covers a class of
 * forty at six calls each with headroom.
 *
 * Raising it is safe in the way that matters: `/payments/orders` takes **no body at all**
 * (the amount comes from `PaymentSettings` and the student from the token), capture is
 * idempotent by conditional write, and Razorpay bills per *transaction*, not per API call
 * — so the cost of a loop here is request volume, not money, and 300 an hour from one
 * address is well inside any provider ceiling.
 */
export const paymentLimiter = limiter({
  windowMs: HOUR,
  limit: 300,
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
 * Downloading a bulk export (Milestone 22).
 *
 * The read-only admin *listings* are deliberately not limited, and this is the exception
 * that proves why: a listing reads twenty rows, and an export reads the entire result set
 * and builds a whole workbook in memory inside a serverless function. That is the same
 * argument `importLimiter` rests on — the most expensive thing a request can ask this
 * platform to do belongs behind its own bound, even when the caller is trusted, because
 * the cost is paid whether the repetition was malicious or a stuck button.
 *
 * Generous enough that a real afternoon of slicing the roll by class never notices.
 */
export const exportLimiter = limiter({
  windowMs: HOUR,
  limit: 30,
  message: 'Too many exports. Please wait a little before downloading another file.',
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
