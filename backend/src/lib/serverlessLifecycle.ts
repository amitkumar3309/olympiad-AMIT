import { logger } from './logger';

/**
 * THE one way to run work that must outlive the response that started it.
 *
 * ## The problem this exists to solve
 *
 * `services/emailOutbox.ts` sends mail *after* the request it belongs to has been
 * answered — that is the whole point of the outbox, and it is right. What was wrong
 * is how the work was started: a bare floating promise.
 *
 * On a serverless platform the execution environment is **frozen the moment the
 * response is flushed**. A floating promise is not cancelled, it is *suspended*: it
 * resumes only when that same container is next thawed by an unrelated request, which
 * may be minutes or hours later, or never if the container is recycled first. Since
 * the first `await` inside the drain is a round trip to Atlas, the freeze won that race
 * essentially every time — so a verification email sat in the queue until the next
 * person happened to register. That is the Milestone 25 bottleneck.
 *
 * ## How it is fixed
 *
 * Vercel publishes a per-request context carrying a `waitUntil`, which tells the
 * platform to keep the environment alive until the promise settles. Registering the
 * drain with it turns "sent whenever the container next wakes" into "sent now".
 *
 * ## Why the symbol rather than the `@vercel/functions` package
 *
 * `waitUntil()` from `@vercel/functions` is a wrapper around exactly this lookup, and
 * the lookup is the stable part — the package is a convenience over a global the
 * platform sets. Reading it directly keeps the backend's dependency list unchanged,
 * which matters for a project whose deployment story is "`@vercel/node` compiles
 * `api/index.ts` and its imports, with no build step".
 *
 * The cost of that choice is that a platform change could stop the lookup resolving.
 * It **degrades to exactly the old behaviour** rather than breaking — the promise is
 * still started, it is just no longer protected — and `middleware/outboxSweep.ts` is
 * the independent second path that covers it. The mode is logged once per process so
 * the degradation is visible rather than silent.
 */

type WaitUntil = (promise: Promise<unknown>) => void;

/** The global Vercel's Node runtime sets per invocation. */
const VERCEL_REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

interface RequestContextHolder {
  get?: () => { waitUntil?: WaitUntil } | undefined;
}

function platformWaitUntil(): WaitUntil | null {
  const holder = (globalThis as unknown as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT] as
    | RequestContextHolder
    | undefined;

  const context = holder?.get?.();
  if (context && typeof context.waitUntil === 'function') {
    return context.waitUntil.bind(context);
  }
  return null;
}

/**
 * `platform` — the runtime has promised to stay alive until this settles.
 * `detached` — nothing is holding the process open; the work is best-effort.
 */
export type KeepAliveMode = 'platform' | 'detached';

let modeLogged = false;

/**
 * Starts background work and, where the platform allows it, keeps the environment
 * alive until it finishes.
 *
 * **Never throws and never rejects.** It is called from request handlers that have
 * already succeeded, and an unhandled rejection here would take the process down for
 * something as minor as one undeliverable email — the same rule `drainOutbox()` and
 * `recordAudit()` follow.
 *
 * Must be called **from within the request's async context**. The lookup is backed by
 * an `AsyncLocalStorage`, so it survives any number of `await`s inside the handler —
 * what it does not survive is being called from work that was scheduled outside that
 * context, such as a `setInterval` or a `.then()` on a promise created at module load.
 * In that case it finds nothing and silently degrades to `detached`, which is why the
 * sweep exists as an independent second path.
 */
export function keepAlive(work: Promise<unknown>, label: string): KeepAliveMode {
  const guarded = work.catch((err: unknown) => {
    logger.error({ err, label }, 'Background work failed');
  });

  const waitUntil = platformWaitUntil();
  const mode: KeepAliveMode = waitUntil ? 'platform' : 'detached';

  if (!modeLogged) {
    modeLogged = true;
    // Once per container, at info, because "is background work protected here?" is the
    // first question to ask when mail is slow and the second is unanswerable without it.
    logger.info(
      { mode, label },
      mode === 'platform'
        ? 'Background work is registered with the platform and will complete after the response'
        : 'No platform keep-alive found — background work is best-effort and may be suspended with the container',
    );
  }

  if (waitUntil) {
    waitUntil(guarded);
  } else {
    void guarded;
  }

  return mode;
}

/** Test-only: lets a suite assert both branches without a real platform context. */
export function resetKeepAliveLoggingForTests(): void {
  modeLogged = false;
}
