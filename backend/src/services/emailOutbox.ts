import type { Types } from 'mongoose';
import { EmailOutbox, type EmailCategory, type EmailOutboxDocument } from '../models';
import { openMailSession, type MailSession, type OutboundEmail } from '../lib/email';
import { logger } from '../lib/logger';
import { keepAlive } from '../lib/serverlessLifecycle';
import { config } from '../config';
import { isConnected } from '../db/connection';

/**
 * THE email queue. Nothing in this codebase may call `openMailSession()` directly.
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
 * is flushed. So there are three drivers, and the queue is correct with any of them:
 *
 *  1. **An opportunistic kick, held open by the platform.** `enqueueEmail()` starts a
 *     drain through `keepAlive()` (`lib/serverlessLifecycle.ts`), which registers it
 *     with the runtime's `waitUntil` so the environment stays alive until it settles.
 *     The mail goes out within milliseconds of the response.
 *  2. **A lazy sweep on later requests** — `middleware/outboxSweep.ts`. If the kick was
 *     never protected (no platform context) or its container died anyway, the row is
 *     still `pending` and due, and the *next request of any kind* picks it up. This is
 *     the same pattern the codebase already uses for expired mock-test and exam
 *     attempts, and for the same reason.
 *  3. **An explicit "send now"**, `POST /admin/email-deliveries/drain`.
 *
 * ## The Milestone 25 regression this section used to describe but not implement
 *
 * Driver 2 was documented here from the beginning and **was never written**. Until
 * Milestone 25 the only callers of `drainOutbox()` were this file and the two admin
 * routes, so a verification email whose kick was frozen waited until *the next person
 * registered*. On a quiet site that is hours. Both halves — protecting the kick, and
 * building the sweep that was already promised — landed together, because either alone
 * leaves a case uncovered: the platform lookup can stop resolving, and a container can
 * die mid-drain however well it was registered.
 *
 * None of the three is a deadline. A queue that only drains when the site is used
 * cannot promise a delivery time on a completely idle site, which is why the staff
 * action stays visible rather than hidden.
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

/**
 * How long one drain may keep *claiming new rows*. A message already in flight is
 * never cut short.
 *
 * A serverless invocation has a wall-clock ceiling, and work registered with
 * `waitUntil` counts against it. Without this, ten messages against a provider that is
 * timing out would be killed by the platform mid-batch — which is survivable (the rows
 * simply become due again) but wastes the whole invocation on one bad provider. Stopping
 * early leaves the remainder due immediately for the next sweep.
 */
const DRAIN_BUDGET_MS = 20_000;

/**
 * What is recorded against a row that was claimed more times than its budget allows
 * without ever reporting an outcome.
 *
 * `giveUp` is only evaluated in the `catch`, so an attempt that neither succeeds nor
 * throws — a frozen container, a killed function — increments `attempts` and leaves the
 * row `pending` for ever. It would then be marked `failed` by its *first* genuine error
 * rather than its fourth. Naming the state is the honest alternative to both.
 */
const ABANDONED_REASON =
  'Abandoned: the attempt budget was spent by attempts that never reported an outcome (the container was most likely stopped mid-send).';

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
 * Everywhere else it is deliberately **not awaited**, which is the entire point — but
 * it is no longer a *bare* floating promise. `keepAlive()` registers it with the
 * platform so the container is held open until the send finishes, instead of the work
 * being suspended the instant the response is flushed. See `lib/serverlessLifecycle.ts`
 * for why that distinction was the whole bug.
 *
 * Called synchronously from `enqueueEmail()`, which is called synchronously from the
 * handler, so the per-invocation context `keepAlive()` reads is still live.
 */
async function dispatch(): Promise<void> {
  if (config.isTest) {
    await drainOutbox();
    return;
  }
  keepAlive(drainOutbox(), 'email-outbox-drain');
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

  const drainStartedAt = Date.now();

  /**
   * Opened once for the whole batch and closed in the `finally`, so ten queued
   * messages cost one handshake rather than ten. See `MailSession` in `lib/email.ts`.
   *
   * Lazily, because the overwhelmingly common drain is the sweep finding nothing to
   * do. A sweep that has to build and tear down a transport to discover the queue is
   * empty would be paying for the exception on every request.
   *
   * Opened inline below rather than behind a `mailSession()` helper: TypeScript ignores
   * assignments made inside a nested function when narrowing the variable in the
   * enclosing scope, so the `finally` saw `session` as `null` and refused `.close()`.
   */
  let session: MailSession | null = null;

  try {
    for (let i = 0; i < DRAIN_BATCH; i += 1) {
      // Checked before claiming, never mid-message: a claimed row must reach an
      // outcome, or it is exactly the stuck row this budget exists to avoid creating.
      if (Date.now() - drainStartedAt > DRAIN_BUDGET_MS) break;

      const claimed = await claimNext(now);
      if (!claimed) break;
      outcome.claimed += 1;

      // Claimed more times than its budget allows without ever reporting an outcome.
      // See `ABANDONED_REASON` — this is the case that used to sit `pending` for ever.
      if (claimed.attempts > claimed.maxAttempts) {
        await EmailOutbox.updateOne(
          { _id: claimed._id },
          { $set: { status: 'failed', lastError: ABANDONED_REASON } },
        );
        outcome.failed += 1;
        logger.error(
          { to: claimed.to, category: claimed.category, attempts: claimed.attempts },
          'Abandoning an email whose attempts never reported an outcome',
        );
        continue;
      }

      try {
        if (!session) session = openMailSession();

        const receipt = await session.deliver({
          to: claimed.to,
          subject: claimed.subject,
          text: claimed.text,
          html: claimed.html,
        });

        const sentAt = new Date();
        /**
         * The two halves of "why was that email slow?", stored separately on purpose.
         *
         * `providerMs` is what the provider took. `queuedForMs` is everything else —
         * how long the row waited to be picked up. A support question that used to
         * need a server log now reads off the delivery console: a large `queuedForMs`
         * with a small `providerMs` is ours, and the reverse is theirs.
         */
        await EmailOutbox.updateOne(
          { _id: claimed._id },
          {
            $set: {
              status: 'sent',
              sentAt,
              lastError: null,
              providerMs: receipt.providerMs,
              queuedForMs: sentAt.getTime() - claimed.createdAt.getTime(),
            },
          },
        );
        outcome.sent += 1;

        logger.info(
          {
            to: claimed.to,
            category: claimed.category,
            attempts: claimed.attempts,
            transport: receipt.transport,
            providerMs: receipt.providerMs,
            queuedForMs: sentAt.getTime() - claimed.createdAt.getTime(),
          },
          'Email delivered',
        );
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
  } finally {
    // Never allowed to mask the outcome: a transport that will not close cleanly has
    // no bearing on whether the messages went.
    if (session) {
      await session.close().catch((err: unknown) => logger.warn({ err }, 'Closing the mail transport failed'));
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
    /**
     * Published so the delivery console can say *where* a slow email was slow.
     * Null on anything not yet delivered — an em dash, never a zero, by the rule
     * the student-facing figures follow.
     */
    providerMs: doc.providerMs ?? null,
    queuedForMs: doc.queuedForMs ?? null,
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
