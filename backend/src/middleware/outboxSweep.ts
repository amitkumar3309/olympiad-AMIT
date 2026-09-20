import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { isConnected } from '../db/connection';
import { logger } from '../lib/logger';
import { keepAlive } from '../lib/serverlessLifecycle';
import { drainOutbox } from '../services/emailOutbox';

/**
 * The lazy sweep `services/emailOutbox.ts` has described since Milestone 14 and which,
 * until Milestone 25, **did not exist**.
 *
 * ## What it is for
 *
 * The queue's primary driver is the kick `enqueueEmail()` starts, now held open by
 * `keepAlive()`. That covers the ordinary case. It does not cover two real ones: a
 * platform with no `waitUntil` context to find, and a container that dies mid-drain
 * however well the work was registered. In both, the row is left `pending` and due —
 * and with no sweep, nothing looked at it until *somebody else enqueued an email*. On a
 * quiet site that is hours, which is exactly how a verification email came to take a
 * long time to arrive.
 *
 * So: any request at all now gives the queue a nudge. Registrations, sign-ins, a
 * student loading their dashboard, an uptime probe against a warm container — every one
 * of them is a chance to notice a stuck row.
 *
 * ## Why this costs nothing worth measuring
 *
 * - **It never delays the request.** `next()` is called on the same tick; the drain is
 *   started beside it, not in front of it.
 * - **It is throttled per container**, so a burst of traffic produces one sweep rather
 *   than one per request.
 * - **It does nothing when there is nothing to do.** `claimNext()` is a single indexed
 *   query against `{status, nextAttemptAt}`; with an empty queue it returns null and the
 *   drain stops. That is the whole cost of a sweep on a healthy system.
 * - **It skips a container with no database connection**, which is every cold start
 *   before `ensureDb` has run, so it cannot turn a health probe into a connection.
 *
 * ## Why it is a middleware rather than a scheduler
 *
 * There isn't one. The free tier has no cron and no worker, and buying either for this
 * is exactly the paid infrastructure the project's cost constraint rules out. The
 * codebase already resolves this shape the same way for expired mock-test and exam
 * attempts: the work happens on the next request that has reason to care.
 */

/**
 * Minimum gap between sweeps on one container.
 *
 * Short enough that a stuck row is picked up by the next page load rather than the next
 * registration, long enough that a burst of requests does not become a burst of
 * queries. A constant rather than an environment variable: it is a property of how the
 * queue recovers, not a deployment preference, and there is no value an operator would
 * sensibly want that the throttle below does not already give them.
 */
const SWEEP_INTERVAL_MS = 15_000;

/**
 * After this long, an "in flight" sweep is assumed never to have finished.
 *
 * `sweepInFlight` is cleared in a `finally`, which does not run if the container was
 * frozen or killed while the drain was suspended — the exact failure this whole
 * milestone is about. Without an escape, one such sweep would wedge the flag on that
 * container permanently and silence the very path meant to recover from it. Same
 * shape, and the same reasoning, as the visibility timeout on an outbox row: a claim
 * that never reports back simply expires.
 */
const SWEEP_STUCK_AFTER_MS = 60_000;

let lastSweepAt = 0;
let sweepStartedAt = 0;
let sweepInFlight = false;

/** Test-only: the throttle is module state, so a suite has to be able to clear it. */
export function resetOutboxSweepForTests(): void {
  lastSweepAt = 0;
  sweepStartedAt = 0;
  sweepInFlight = false;
}

/**
 * Whether a sweep should start now. Separate from the middleware so the decision can
 * be tested without fabricating a request.
 */
export function shouldSweep(now = Date.now()): boolean {
  if (config.isTest) return false;
  if (sweepInFlight && now - sweepStartedAt < SWEEP_STUCK_AFTER_MS) return false;
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return false;
  // A cold container has not connected yet. `drainOutbox()` checks this too; checking
  // here as well is what keeps the common no-op genuinely free.
  return isConnected();
}

export function outboxSweep(_req: Request, _res: Response, next: NextFunction): void {
  /**
   * Scheduled **before** `next()`, deliberately.
   *
   * Calling `next()` first would run the rest of the chain up to its first `await`, and
   * on a route that answers without one the response would already be flushed — so the
   * work would be registered with a platform that had finished with the request. That is
   * precisely the bug this change exists to fix, reintroduced inside the fix.
   *
   * Nothing is awaited, so the ordering costs the request nothing.
   */
  if (shouldSweep()) {
    lastSweepAt = Date.now();
    sweepStartedAt = lastSweepAt;
    sweepInFlight = true;

    keepAlive(
      drainOutbox()
        .then((outcome) => {
          // Silent on the overwhelmingly common empty sweep: logging "nothing to do"
          // every fifteen seconds buries the lines that mean something.
          if (outcome.claimed > 0) {
            logger.info({ ...outcome, driver: 'sweep' }, 'Outbox swept on an unrelated request');
          }
        })
        .finally(() => {
          sweepInFlight = false;
        }),
      'email-outbox-sweep',
    );
  }

  next();
}
