import { ApiError } from '../api/client'

/**
 * Turns anything thrown by the API client into one sentence a student or an
 * administrator can act on.
 *
 * ## Why the backend's own message is usually the right one
 *
 * This product's 4xx messages are written for the reader: "This code is not valid",
 * "Only a captured payment has an invoice", "A published question must have a
 * solution". Replacing those with a generic "Bad request" would throw away the most
 * useful thing on the screen. So a 4xx message is passed through.
 *
 * ## Where it is not
 *
 * A **5xx** message is not written for anybody — it is whatever fell out of the
 * server, and it is the one place an internal detail could reach a user. Those are
 * replaced wholesale, never shown. So is a **network failure**, where there is no
 * message at all because the request never arrived.
 *
 * A handful of statuses get a better sentence than the API's, because the API is
 * answering a machine and the reader needs to know what to *do*: an expired session
 * has to be signed into again, a rate limit has to be waited out.
 */

/** What a failed `fetch` looks like: no status, because nothing answered. */
export function isNetworkError(error: unknown): boolean {
  return !(error instanceof ApiError) && error instanceof Error
}

export interface HumanizeOptions {
  /** Used when the error carries nothing usable. Make it specific to the action. */
  fallback?: string
}

export function humanizeError(error: unknown, options: HumanizeOptions = {}): string {
  const fallback = options.fallback ?? 'Something went wrong. Please try again.'

  if (error instanceof ApiError) {
    // Anything from 500 up: the message is not for a reader, so it is not shown.
    if (error.status >= 500) {
      return 'Something went wrong on our side. Please try again in a moment.'
    }

    switch (error.status) {
      case 401:
        return 'Your session has ended. Please sign in again.'
      case 403:
        return 'Your account does not have permission to do this.'
      case 429:
        return 'Too many attempts. Please wait a minute and try again.'
      default:
        return error.message || fallback
    }
  }

  if (error instanceof Error) {
    // A `fetch` rejection — offline, DNS, a blocked request. The browser's own
    // message ("Failed to fetch", "NetworkError when attempting to fetch resource")
    // is technical and, worse, indistinguishable from a bug in the page.
    return 'We could not reach the server. Check your connection and try again.'
  }

  return fallback
}

/**
 * The same, for a **sign-in form** — where the credentials are the question being
 * asked rather than something that expired underneath the reader.
 *
 * `humanizeError` rewrites a 401 as "your session has ended, please sign in again",
 * which is right for a page whose data request was refused and actively wrong on the
 * form they would be signing in *with*. It said exactly that to somebody who had just
 * typed the wrong password.
 *
 * So on these two forms:
 *
 *  - **401 and 423 pass their message through.** Both are written for the reader, and
 *    the 401 is deliberately identical for an unknown account and a wrong password —
 *    the backend will not say which, and neither may this.
 *  - **400 is replaced.** Unlike the rest of this product's 4xx copy, the sign-in 400
 *    is a zod aggregate (`identifier: Enter your mobile number or email; password: …`),
 *    which is a schema talking to a machine.
 *  - Everything else defers to `humanizeError`, so a 5xx still never reaches a screen.
 */
export function humanizeSignInError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) {
      return 'Check your mobile number or email and your password, then try again.'
    }
    // 423 is the lockout after repeated failures, and its message names the wait.
    if (error.status === 401 || error.status === 423) {
      return error.message || 'Those details did not match an account.'
    }
    /**
     * A 403 here is never "you lack permission", which is what the ordinary humanizer
     * rewrites it to. The sign-in route answers 403 for exactly two situations, and both
     * carry copy written for the reader: the address is **not verified** (with
     * `code: 'EMAIL_NOT_VERIFIED'`, which is what puts the resend link on the form), or
     * the account is suspended, blocked or deactivated.
     *
     * Printing "Your account does not have permission to do this" told a student whose
     * only problem was an unopened verification email that their account was not allowed
     * to sign in — beside a link offering to send them a new link, which made no sense
     * next to it. Found by walking the flow in a browser.
     */
    if (error.status === 403) {
      return error.message || 'That account cannot sign in yet.'
    }
  }
  return humanizeError(error, { fallback: 'Could not sign you in. Please try again.' })
}

/**
 * True when the failure means the session is gone, so a page can send the reader to
 * sign in rather than showing a retry button that will fail identically.
 *
 * The API client already refreshes a merely-expired access token once and replays the
 * request, so a 401 reaching here means the refresh failed too.
 */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

/** True for the paywall, which the frontend answers with a pay button rather than an
 *  error — the backend answers 402 specifically so this distinction is possible. */
export function isPaymentRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402
}
