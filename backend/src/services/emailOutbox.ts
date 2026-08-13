import type { Types } from 'mongoose';
import { EmailOutbox, type EmailCategory, type EmailOutboxDocument } from '../models';
import { deliverEmail, type OutboundEmail } from '../lib/email';
import { logger } from '../lib/logger';
import { config } from '../config';
import { isConnected } from '../db/connection';

/**
 * THE email queue. Nothing in this codebase may call `deliverEmail()` directly.
 *
 * ## The property this file exists to guarantee
 *
 * **No user-facing request ever waits on SMTP.** `enqueueEmail()` does one indexed
 * insert and returns; delivery happens afterwards and is retried from the persisted
 * row. Before this, registration awaited a third-party SMTP handshake inline, so a
 * slow provider slowed down every new student and a dead one silently destroyed the
 * verification link they needed in order to log in at all.
 *
 * ## How delivery actually happens without a scheduler
 *
 * The Vercel free tier has no cron and no worker, and work started after a response
 * is not guaranteed to finish — the container can be frozen the moment the response
 * is flushed. So there are two drivers, and the queue is correct with either:
 *
 *  1. **An opportunistic kick.** `enqueueEmail()` starts a drain and does not await
 *     it. If the container survives, the mail goes out within milliseconds.
 *  2. **A lazy sweep on later requests.** If it did not survive, the row is still
 *     `pending` and due, and the next drain picks it up. This is the same pattern
 *     the codebase already uses for expired mock-test and exam attempts, and for the
 *     same reason.
 *
 * Neither is a deadline. A queue that only drains when the site is used cannot
 * promise a delivery time on an idle site, which is why `drainOutbox()` is also
 * exposed to staff as an explicit "send now" action rather than being hidden.
 */

/**
 * How long a claimed row is invisible to other claimants, and how long after a
 * failure before it is due again. Index = attempts already made.
 *
 * The first retry is deliberately quick (a provider blip is usually over in
 * seconds) and the last is slow enough to outlast a provider's daily quota reset
 * being the actual problem.
 */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

/** Bounded so one unlucky request never tries to push a whole cohort's mail. */
const DRAIN_BATCH = 10;

function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ?? 60_000;
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export interface EnqueueInput extends OutboundEmail {
  category: EmailCategory;
  student?: Types.ObjectId | null;
  /** Application-level idempotency; see `EmailOutbox.dedupeKey`. */
  dedupeKey?: string | null;
}

export interface EnqueueResult {
  queued: boolean;
  /** `duplicate` when a row with the same `dedupeKey` already exists. */
  reason?: 'duplicate' | 'error';
}

/**
 * Records the intent to send, then kicks a drain without waiting for it.
 *
 * Never throws. An email that cannot even be queued must not fail the registration,
 * password change or result release that occasioned it — the same rule
 * `recordAudit()` follows, and for the same reason: the user's action succeeded, and
 * reporting it as failed because of a side effect would be a worse lie than the
 * missing side effect.
 */
export async function enqueueEmail(input: EnqueueInput): Promise<EnqueueResult> {
  try {
    await EmailOutbox.create({
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      category: input.category,
      student: input.student ?? null,
      dedupeKey: input.dedupeKey ?? null,
      status: 'pending',
      nextAttemptAt: new Date(),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Not an error: the same event already has mail queued or sent. This is the
      // path that stops a re-published exam emailing its whole cohort twice.
      logger.info({ dedupeKey: input.dedupeKey, category: input.category }, 'Email already queued for this event');
      return { queued: false, reason: 'duplicate' };
    }
    logger.error({ err, category: input.category }, 'Could not queue an email');
    return { queued: false, reason: 'error' };
  }

  await dispatch();
  return { queued: true };
}

/**
 * Starts delivery in the way that suits the environment.
 *
 * Under test it is **awaited**, so a test can assert on the captured message
 * immediately after the request that caused it. That is not a weaker test of the
 * non-blocking property — the property lives in `enqueueEmail()` returning after a
 * single insert, and the request path is identical either way — it is what makes the
 * suite deterministic instead of racing a floating promise.
 *
 * Everywhere else it is deliberately **not awaited**, which is the entire point.
 */
async function dispatch(): Promise<void> {
  if (config.isTest) {
    await drainOutbox();
    return;
  }
  void drainOutbox().catch((err) => logger.error({ err }, 'Outbox drain failed'));
}

export interface DrainOutcome {
  claimed: number;
  sent: number;
  failed: number;
  /** Rows that failed but are due to be tried again. */
  retrying: number;
}

/**
 * Sends up to `DRAIN_BATCH` due messages. Safe to call concurrently and safe to
 * call when there is nothing to do.
 *
 * Never throws: it is called from a floating promise in production, and an unhandled
 * rejection there would take the process down for something as minor as one
 * undeliverable email.
 */
export async function drainOutbox(now = new Date()): Promise<DrainOutcome> {
  const outcome: DrainOutcome = { claimed: 0, sent: 0, failed: 0, retrying: 0 };

  // Authorization and validation have already run by the time anything enqueues,
  // but a drain can also be triggered by a request that never touched the database.
  if (!isConnected()) return outcome;

  for (let i = 0; i < DRAIN_BATCH; i += 1) {
    const claimed = await claimNext(now);
    if (!claimed) break;
    outcome.claimed += 1;

    try {
      await deliverEmail({ to: claimed.to, subject: claimed.subject, text: claimed.text, html: claimed.html });
      await EmailOutbox.updateOne(
        { _id: claimed._id },
        { $set: { status: 'sent', sentAt: new Date(), lastError: null } },
      );
      outcome.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // `attempts` was already incremented by the claim, so it reflects this try.
      const giveUp = claimed.attempts >= claimed.maxAttempts;

      await EmailOutbox.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: giveUp ? 'failed' : 'pending',
            lastError: message.slice(0, 500),
            // Already pushed forward by the claim; restate it against this
            // attempt's count so the backoff grows rather than staying flat.
            nextAttemptAt: new Date(now.getTime() + backoffFor(claimed.attempts)),
          },
        },
      );

      if (giveUp) {
        outcome.failed += 1;
        logger.error(
          { to: claimed.to, category: claimed.category, attempts: claimed.attempts, err: message },
          'Giving up on an email after the last attempt',
        );
      } else {
        outcome.retrying += 1;
        logger.warn(
          { to: claimed.to, category: claimed.category, attempts: claimed.attempts, err: message },
          'Email delivery failed; will retry',
        );
      }
    }
  }

  return outcome;
}

/**
 * Takes ownership of one due row, or returns null.
 *
 * The claim **is** the concurrency control: a single conditional write that both
 * selects and reserves. Two invocations racing for the same row cannot both win,
 * because the second no longer matches `nextAttemptAt: {$lte: now}` once the first
 * has pushed it forward. A read followed by a write would have a window between
 * them, and on a serverless platform those two halves can land in different
 * invocations — the same reasoning that makes exam submission a conditional write.
 */
async function claimNext(now: Date): Promise<EmailOutboxDocument | null> {
  return EmailOutbox.findOneAndUpdate(
    { status: 'pending', nextAttemptAt: { $lte: now } },
    {
      $inc: { attempts: 1 },
      $set: {
        lastAttemptAt: now,
        // The visibility timeout. If this attempt never finishes — a frozen
        // container, a killed function — the row simply becomes due again.
        nextAttemptAt: new Date(now.getTime() + backoffFor(0)),
      },
    },
    { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
  );
}

export interface OutboxStats {
  pending: number;
  sent: number;
  failed: number;
  /** Oldest still-unsent row, which is what "is the queue stuck?" really asks. */
  oldestPendingAt: Date | null;
}

/** Counted, never estimated — the same rule the rest of the admin figures follow. */
export async function outboxStats(): Promise<OutboxStats> {
  const [pending, sent, failed, oldest] = await Promise.all([
    EmailOutbox.countDocuments({ status: 'pending' }),
    EmailOutbox.countDocuments({ status: 'sent' }),
    EmailOutbox.countDocuments({ status: 'failed' }),
    EmailOutbox.findOne({ status: 'pending' }).sort({ createdAt: 1 }).select('createdAt'),
  ]);

  return { pending, sent, failed, oldestPendingAt: oldest?.createdAt ?? null };
}

export function outboxRowView(doc: EmailOutboxDocument) {
  return {
    id: String(doc._id),
    to: doc.to,
    subject: doc.subject,
    category: doc.category,
    status: doc.status,
    attempts: doc.attempts,
    maxAttempts: doc.maxAttempts,
    nextAttemptAt: doc.nextAttemptAt,
    lastAttemptAt: doc.lastAttemptAt ?? null,
    lastError: doc.lastError ?? null,
    sentAt: doc.sentAt ?? null,
    createdAt: doc.createdAt,
  };
}

/**
 * Puts a permanently-failed row back in the queue with a fresh attempt budget.
 *
 * The counterpart to giving up: `failed` has to be a real terminal state or the
 * queue would retry a genuinely dead address for ever, but somebody who has just
 * fixed their SMTP settings needs a way to say "try again now" that is not editing
 * the database by hand.
 */
export async function retryFailed(ids?: string[]): Promise<number> {
  const filter = ids && ids.length > 0 ? { status: 'failed' as const, _id: { $in: ids } } : { status: 'failed' as const };
  const result = await EmailOutbox.updateMany(filter, {
    $set: { status: 'pending', nextAttemptAt: new Date(), attempts: 0, lastError: null },
  });
  return result.modifiedCount;
}
