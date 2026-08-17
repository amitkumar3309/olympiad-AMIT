import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';

/**
 * THE cross-site request forgery defence (security audit, 2026-08-17).
 *
 * ## What was actually exposed
 *
 * Production cookies are `sameSite: 'none'`, because the frontend and backend are on
 * different Vercel domains, so a browser attaches a signed-in student's session to a
 * request issued by any other site. Two incidental defences narrowed that and were
 * relied on: only `express.json()` is mounted, so a cross-site HTML form's
 * `application/x-www-form-urlencoded` / `text/plain` body arrives unparsed and
 * validation returns 400; and a cross-origin `fetch` carrying
 * `Content-Type: application/json` is preflighted, so the CORS allow-list refuses it.
 *
 * Both are real, and neither covers the routes that **need no body at all**. A hidden
 * auto-submitting form reaches those with no preflight and no parsed body:
 * `POST /auth/logout`, `/auth/logout-all`, `/auth/refresh`, `/payments/orders`,
 * `/payments/reconcile`, `/me/notifications/read-all` and
 * `/me/notifications/:id/read`. That is not merely session nuisance any more — since
 * Milestone 19 it includes creating a payment order against a student's account.
 *
 * ## Why an origin check rather than a token
 *
 * A browser sends `Origin` on **every** request whose method is not GET or HEAD,
 * including a cross-site form post, and `Origin` is a forbidden header name so page
 * script cannot set or strip it. This backend already maintains an exact allow-list of
 * legitimate origins for CORS, so the question "did this come from our own front end?"
 * is already answerable — CORS simply never asked it about *simple* requests, because
 * CORS governs whether a response may be **read**, not whether a request may be
 * **sent**. Asking it here is what closes the gap.
 *
 * A double-submit cookie is the other standard answer and remains a reasonable second
 * layer. It is deliberately not added on top of this: it requires every client to read
 * a cookie and echo it in a header, which buys nothing over the check below for
 * browser-issued requests — and CSRF is, by definition, a browser-issued attack.
 *
 * ## Why a request with no `Origin` is allowed
 *
 * Because it cannot be a forgery. A browser omits `Origin` only on GET/HEAD, which
 * this middleware does not police. Everything else with no `Origin` and no `Referer`
 * is a non-browser client — `curl`, the test suite, or Razorpay's server-to-server
 * webhook, which is separately authenticated by an HMAC over its raw body. Refusing
 * those would break every API client while protecting nobody.
 *
 * ## Failure mode
 *
 * Fails **closed** on a recognised-but-wrong origin and open on no origin at all,
 * which is the correct pairing: the first is the attack, the second cannot be. The
 * request's own host is always allowed, so a same-origin deployment keeps working even
 * if `FRONTEND_URL` has not been set (which is itself logged as an error at startup).
 */

/** Methods that can change state. GET/HEAD/OPTIONS are not policed. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The `host:port` of a URL, or null if it is not one.
 *
 * Compared on host rather than full origin so the check is not defeated by a scheme
 * mismatch behind a TLS-terminating proxy — the platform decides the scheme this
 * process sees, and an attacker controls neither the host nor the port.
 *
 * `Origin: null` — what a sandboxed iframe or a `data:` document sends — is not a URL
 * and therefore does not resolve, which is the answer it deserves.
 */
function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

/** Built once from the same list CORS uses, so the two can never disagree. */
const allowedHosts = new Set(
  config.cors.origins.map((origin) => hostOf(origin)).filter((host): host is string => host !== null),
);

/** Exported for the test suite, which asserts the allow-list is derived and not copied. */
export function isAllowedRequestOrigin(source: string | undefined, requestHost: string | undefined): boolean {
  const host = hostOf(source);
  if (host === null) return false;
  if (allowedHosts.has(host)) return true;
  // Same-origin. Keeps a single-domain deployment working with no configuration, and
  // cannot be used by an attacker, who by definition is on a different host.
  return requestHost !== undefined && host === requestHost;
}

export function verifyRequestOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (!UNSAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // `Referer` only when `Origin` is absent: `Origin` is the narrower, purpose-built
  // header, and a page can suppress `Referer` with a referrer policy but not `Origin`.
  const source = req.get('origin') ?? req.get('referer');
  if (!source) {
    next();
    return;
  }

  if (isAllowedRequestOrigin(source, req.get('host'))) {
    next();
    return;
  }

  // Deliberately not an audit-trail entry: this runs before authentication, so there
  // is no actor to attribute it to, and an unauthenticated flood must not be able to
  // grow a collection. The structured log is where a burst of these shows up.
  logger.warn(
    { origin: req.get('origin') ?? null, referer: req.get('referer') ?? null, method: req.method, path: req.originalUrl },
    'Refused a state-changing request from an origin that is not allowed',
  );

  next(
    ApiError.forbidden(
      'This request did not come from the AMIT Olympiad website and was refused. If you were signed in, sign out and in again.',
    ),
  );
}
