import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { EmailOutbox } from '../src/models';
import {
  buildNotificationEmail,
  buildPasswordResetEmail,
  buildVerificationEmail,
  clearTestInbox as clearInbox,
  failNextDeliveries,
  getTestInbox,
} from '../src/lib/email';
import { config } from '../src/config';
import { drainOutbox } from '../src/services/emailOutbox';
import { keepAlive, resetKeepAliveLoggingForTests } from '../src/lib/serverlessLifecycle';
import { outboxSweep, shouldSweep, resetOutboxSweepForTests } from '../src/middleware/outboxSweep';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, validStudent, otherStudent, cookieHeader, createAdminSession } from './helpers/auth';

/**
 * Milestone 25 — why a verification email took a long time to arrive, and what now
 * stops it.
 *
 * The outbox architecture was already right: persist the intent, answer the request,
 * deliver afterwards. What was wrong was the *afterwards*. Delivery was started as a
 * bare floating promise and the serverless container is frozen the instant a response
 * is flushed, so the send was suspended before its first database round trip finished
 * — and the "lazy sweep on later requests" that was supposed to recover it had been
 * documented since Milestone 14 without ever being written. A queued email therefore
 * waited for the next person to register.
 *
 * This file covers the three things that changed, and it is weighted toward the ones
 * that cannot be seen from a passing happy path:
 *
 * 1. **Work is registered with the platform** rather than left floating, and degrades
 *    honestly when there is no platform to register with.
 * 2. **The sweep exists**, costs the request nothing, and is inert under test so the
 *    suite is never racing a background drain.
 * 3. **A delivery records where its time went**, separately, so "the email was slow"
 *    can be answered without reproducing it.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearInbox();
  resetOutboxSweepForTests();
  resetKeepAliveLoggingForTests();
});

// ===========================================================================
// Work that has to outlive the response
// ===========================================================================

describe('background work outliving its response', () => {
  const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

  function setPlatformContext(waitUntil: (promise: Promise<unknown>) => void): void {
    (globalThis as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT] = {
      get: () => ({ waitUntil }),
    };
  }

  afterEach(() => {
    Reflect.deleteProperty(globalThis, REQUEST_CONTEXT);
  });

  it('hands the work to the platform when a request context is present', async () => {
    const held: Promise<unknown>[] = [];
    setPlatformContext((promise) => held.push(promise));

    const mode = keepAlive(Promise.resolve('sent'), 'test');

    // This is the fix in one assertion. Without it the promise below is merely
    // *started*, and a frozen container suspends it mid-flight.
    expect(mode).toBe('platform');
    expect(held).toHaveLength(1);
    await Promise.all(held);
  });

  it('degrades to best-effort instead of throwing when there is no context', () => {
    // Local development, a test run, or a platform that stops publishing the global.
    // The queue is still correct here — the sweep is the path that covers it — so this
    // must never be an error.
    expect(keepAlive(Promise.resolve(), 'test')).toBe('detached');
  });

  it('never turns a failed background job into an unhandled rejection', async () => {
    // An unhandled rejection takes the process down. One undeliverable email must not
    // be able to do that, which is why `keepAlive` attaches its own catch before
    // handing the promise anywhere.
    expect(keepAlive(Promise.reject(new Error('provider exploded')), 'test')).toBe('detached');
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

// ===========================================================================
// The sweep that was documented for ten milestones and did not exist
// ===========================================================================

describe('the outbox sweep', () => {
  type SweepArgs = Parameters<typeof outboxSweep>;

  it('calls next() synchronously, so it can never delay the request it rides on', () => {
    let nextCalled = false;

    outboxSweep({} as unknown as SweepArgs[0], {} as unknown as SweepArgs[1], () => {
      nextCalled = true;
    });

    // Synchronously, not eventually: a sweep that awaited anything would put a
    // housekeeping query in front of every page load in the product.
    expect(nextCalled).toBe(true);
  });

  it('is inert under test, so no suite is racing a background drain', () => {
    // Delivery is awaited inline under test for determinism. A sweep firing on its own
    // schedule beside that would make assertions about `attempts` flaky — which is a
    // worse outcome than the sweep going untested, and is why `shouldSweep()` is
    // exported and asserted rather than left implicit.
    expect(shouldSweep()).toBe(false);
  });
});

// ===========================================================================
// Knowing where a delivery spent its time
// ===========================================================================

describe('delivery timing', () => {
  it('records both halves of the latency on a delivered row', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const row = await EmailOutbox.findOne({ category: 'transactional' });
    expect(row!.status).toBe('sent');

    // Separately, because they have different owners. A large `queuedForMs` with a
    // small `providerMs` is our bug; the reverse is the provider's.
    expect(typeof row!.providerMs).toBe('number');
    expect(row!.providerMs!).toBeGreaterThanOrEqual(0);
    expect(typeof row!.queuedForMs).toBe('number');
    expect(row!.queuedForMs!).toBeGreaterThanOrEqual(0);
  });

  it('leaves the timings null — never zero — on a row that has not been delivered', async () => {
    failNextDeliveries(Infinity);
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const row = await EmailOutbox.findOne({});
    expect(row!.status).toBe('pending');
    // "Never delivered" and "delivered instantly" are different facts. Same rule as
    // `StatTile` on a student-facing figure: an unknown value is not a zero.
    expect(row!.providerMs ?? null).toBeNull();
    expect(row!.queuedForMs ?? null).toBeNull();
  });

  it('publishes both figures on the delivery console', async () => {
    const admin = await createAdminSession(app, otherStudent);

    const res = await request(app)
      .get(`${API}/admin/email-deliveries?status=sent`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    const row = res.body.deliveries[0];
    expect(row).toBeTruthy();
    // Present as keys even when null, so the console can render an em dash rather
    // than having to guess whether the field exists.
    expect(row).toHaveProperty('providerMs');
    expect(row).toHaveProperty('queuedForMs');
  });
});

// ===========================================================================
// The message itself
// ===========================================================================

describe('the email template', () => {
  const verification = () => buildVerificationEmail('student@example.com', 'a'.repeat(64));

  it('carries a working link, the expiry and the single-use rule in both parts', () => {
    const mail = verification();
    const url = `${config.publicAppUrl}/verify-email?token=${'a'.repeat(64)}`;

    // Both parts, because a client that renders text-only must not be a dead end —
    // and because the plain part is what a cautious reader forwards to a parent.
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain(url);
      expect(part).toContain(String(config.auth.emailVerifyTtlHours));
      expect(part).toContain('once');
    }
  });

  it('tells the reader they cannot sign in until it is used', () => {
    // The single most useful sentence in the message: without it, an unverified
    // student reads a failed sign-in as a wrong password and resets it instead.
    expect(verification().html).toContain('not be able to sign in');
    expect(verification().text).toContain('not be able to sign in');
  });

  it('publishes a way to reach a human', () => {
    // The screens can tell somebody with a mistyped address to write in; the email is
    // the other place they might look, and it is the one they already have open.
    for (const part of [verification().html, verification().text]) {
      expect(part).toContain(config.support.email);
    }
  });

  it('loads nothing from anywhere — no image, no font, no tracker', () => {
    const html = verification().html;

    // An image is blocked by default in most clients, so a logo is a hole in the
    // layout; a tracking pixel in transactional mail to children is not acceptable
    // regardless. The only external reference permitted is the action link itself.
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/i);

    const urls = html.match(/https?:\/\/[^"'\s>]+/gi) ?? [];
    for (const url of urls) {
      expect(url.startsWith(config.publicAppUrl)).toBe(true);
    }
  });

  it('stays small enough to open instantly on a phone', () => {
    // Not an arbitrary ceiling: Gmail clips a message past ~102 KB and shows a "view
    // entire message" link, which on a one-button email can hide the one button.
    expect(verification().html.length).toBeLessThan(10_000);
  });

  it('escapes author-written content instead of letting it become markup', () => {
    /**
     * A staff announcement is interpolated into the HTML part. Before this was
     * escaped, "everyone scoring < 50 should revise" lost the rest of its sentence to
     * the browser as an unclosed tag — and the same hole would let an administrator
     * put a link of their own choosing into a message arriving under this platform's
     * name.
     */
    const mail = buildNotificationEmail({
      to: 'student@example.com',
      title: 'Scores < 50',
      body: 'Everyone scoring < 50 should revise. <a href="https://evil.example">Click</a>',
      manageable: true,
    });

    expect(mail.html).toContain('&lt; 50');
    expect(mail.html).not.toContain('<a href="https://evil.example">');
    // The text part is not markup and must keep the characters the author typed.
    expect(mail.text).toContain('< 50');
  });

  it('gives the reset email its own lifetime, in minutes', () => {
    const mail = buildPasswordResetEmail('student@example.com', 'b'.repeat(64));
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain(String(config.auth.passwordResetTtlMinutes));
      expect(part).toContain('will not change');
    }
  });
});

// ===========================================================================
// The attempt that reports nothing at all
// ===========================================================================

describe('an attempt that never reports an outcome', () => {
  it('is abandoned with a stated reason rather than left pending for ever', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const row = await EmailOutbox.findOne({});

    /**
     * A container frozen or killed mid-send neither succeeds nor throws, so neither
     * branch of the drain runs: `attempts` climbs on every claim and the row stays
     * `pending` for ever. It would then be marked `failed` by its *first* genuine
     * error rather than its fourth.
     *
     * Reproduced by writing the state directly, because the only way to produce it
     * naturally is to kill the process mid-request.
     */
    await EmailOutbox.updateOne(
      { _id: row!._id },
      {
        $set: {
          status: 'pending',
          attempts: row!.maxAttempts + 1,
          nextAttemptAt: new Date(0),
          sentAt: null,
          providerMs: null,
          queuedForMs: null,
        },
      },
    );
    clearInbox();

    const outcome = await drainOutbox();

    expect(outcome.claimed).toBe(1);
    expect(outcome.failed).toBe(1);
    // Nothing was handed to the transport: the budget was already spent.
    expect(getTestInbox()).toHaveLength(0);

    const abandoned = await EmailOutbox.findById(row!._id);
    expect(abandoned!.status).toBe('failed');
    // Terminal *and* explained, so the delivery console shows why rather than a blank
    // row that has silently stopped moving. Staff can requeue it from there.
    expect(abandoned!.lastError).toContain('Abandoned');
  });

  it('still gives up at the budget when attempts do report failures', async () => {
    // The pre-existing give-up path must be untouched by the abandonment branch above:
    // `attempts >= maxAttempts` on a real error is still the ordinary terminal state.
    failNextDeliveries(Infinity);
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const row = await EmailOutbox.findOne({});
    for (let i = 1; i < row!.maxAttempts; i += 1) {
      await drainOutbox(new Date(Date.now() + (i + 1) * 6 * 60 * 60 * 1000));
    }

    const finished = await EmailOutbox.findById(row!._id);
    expect(finished!.status).toBe('failed');
    expect(finished!.attempts).toBe(row!.maxAttempts);
    expect(finished!.lastError).toContain('Simulated SMTP failure');
  });
});
