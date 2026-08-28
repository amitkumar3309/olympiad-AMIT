import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import app from '../src/app';
import { config } from '../src/config';
import { Payment, PaymentSettings } from '../src/models';
import { checkoutSignature, setPaymentTransport, webhookSignature } from '../src/services/paymentService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, cookieHeader, createAdminSession, registerVerifyLogin, otherStudent, clearTestInbox } from './helpers/auth';

/**
 * Milestone 19 — payments.
 *
 * The organising idea: **a payment test that only proves the happy path passes just as
 * well against a backend that believes whatever the browser says.** So most of this file
 * is about refusing things — a forged signature, somebody else's order, a duplicate
 * webhook, an unknown order, an amount the client tried to choose.
 *
 * Signatures here are **genuine**: computed with the same HMAC the product uses, from a
 * test secret. A suite that only ever sent a hardcoded fake signature would pass against
 * an implementation that accepted everything, which is precisely the bug that matters.
 *
 * Nothing touches Razorpay. `setPaymentTransport()` is a test-only hook that throws
 * outside the test environment.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const TEST_KEY_ID = 'rzp_test_fake_key_id';
const TEST_SECRET = 'test_secret_not_a_real_credential';
const TEST_WEBHOOK_SECRET = 'test_webhook_secret';

const ORIGINAL = { ...config.payments };

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
  setPaymentTransport(null);
  Object.assign(config.payments, ORIGINAL);
});

/**
 * Switches the paid gate on explicitly.
 *
 * On by default since 2026-08-16, so this is now mostly about pinning the *amount* —
 * but it is kept explicit rather than relying on the default, because a test that
 * depends on a default silently changes meaning when the default does.
 */
async function enableEntryFee(): Promise<void> {
  await PaymentSettings.findOneAndUpdate(
    { key: 'default' },
    { $set: { olympiadEntryFee: 49_900, entryFeeEnabled: true } },
    { upsert: true, setDefaultsOnInsert: true },
  );
}

function enablePayments(): void {
  Object.assign(config.payments, {
    configured: true,
    keyId: TEST_KEY_ID,
    keySecret: TEST_SECRET,
    webhookSecret: TEST_WEBHOOK_SECRET,
  });
}

/** Razorpay's order-creation response, as their API really shapes it. */
function razorpayCreates(orderId = 'order_TEST123', amount = 49_900): void {
  setPaymentTransport(() =>
    Promise.resolve(
      new Response(JSON.stringify({ id: orderId, amount, currency: 'INR', status: 'created' }), { status: 200 }),
    ),
  );
}

async function payingStudent() {
  const session = await registerVerifyLogin(app, {}, { paid: false });
  enablePayments();
  await enableEntryFee();
  razorpayCreates();
  const order = await request(app).post(`${API}/payments/orders`).set('Cookie', cookieHeader(session.cookies)).expect(201);
  return { ...session, order: order.body as { orderId: string; amount: number; keyId: string } };
}

/** A webhook exactly as Razorpay sends it, signed over the raw body it will transmit. */
async function sendWebhook(event: string, orderId: string, secret = TEST_WEBHOOK_SECRET, paymentId = 'pay_TEST1') {
  const body = JSON.stringify({
    event,
    payload: { payment: { entity: { id: paymentId, order_id: orderId, method: 'card', error_description: 'Card declined' } } },
  });
  return request(app)
    .post(`${API}/payments/webhook`)
    .set('x-razorpay-signature', webhookSignature(body, secret))
    .set('content-type', 'application/json')
    .send(body);
}

// ===========================================================================
// Order creation
// ===========================================================================

describe('creating an order', () => {
  it('never lets the client choose the amount', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    enablePayments();
    await enableEntryFee();

    let sentBody = '';
    setPaymentTransport((_url, init) => {
      sentBody = String(init.body);
      return Promise.resolve(new Response(JSON.stringify({ id: 'order_X', amount: 49_900, currency: 'INR' }), { status: 200 }));
    });

    // A client trying to pay ₹1 for a ₹499 fee. The route has no amount parameter at
    // all, so this is simply ignored.
    const res = await request(app)
      .post(`${API}/payments/orders`)
      .set('Cookie', cookieHeader(cookies))
      .send({ amount: 100 })
      .expect(201);

    expect(JSON.parse(sentBody).amount).toBe(49_900);
    expect(res.body.amount).toBe(49_900);
    // The secret is never in a response, ever.
    expect(JSON.stringify(res.body)).not.toContain(TEST_SECRET);
    expect(res.body.keyId).toBe(TEST_KEY_ID);
  });

  it('records the order against the student before any money moves', async () => {
    const { studentId, order } = await payingStudent();

    const stored = await Payment.findOne({ razorpayOrderId: order.orderId }).populate('student', 'studentId');
    expect(stored).not.toBeNull();
    // `attempted`, not `captured` — the order exists, nothing has been paid.
    expect(stored!.status).toBe('attempted');
    expect((stored!.student as unknown as { studentId: string }).studentId).toBe(studentId);
  });

  it('refuses when the provider is unconfigured, rather than half-working', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    await enableEntryFee();
    Object.assign(config.payments, { configured: false, keyId: undefined, keySecret: undefined });

    const res = await request(app).post(`${API}/payments/orders`).set('Cookie', cookieHeader(cookies));

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('RAZORPAY_KEY_ID');
    expect(await Payment.countDocuments()).toBe(0);
  });

  it('reports a provider refusal without creating a local row', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    enablePayments();
    await enableEntryFee();
    setPaymentTransport(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { description: 'Invalid amount' } }), { status: 400 })),
    );

    const res = await request(app).post(`${API}/payments/orders`).set('Cookie', cookieHeader(cookies));

    expect(res.status).toBe(502);
    // A local row with no remote order can never be paid, and is indistinguishable
    // from one the student simply abandoned.
    expect(await Payment.countDocuments()).toBe(0);
  });

  it('refuses a second order once the fee is paid', async () => {
    const { cookies, order } = await payingStudent();
    await sendWebhook('payment.captured', order.orderId);

    razorpayCreates('order_SECOND');
    const res = await request(app).post(`${API}/payments/orders`).set('Cookie', cookieHeader(cookies));

    expect(res.status).toBe(409);
  });
});

// ===========================================================================
// Verification — the part that must never trust the browser
// ===========================================================================

describe('verifying a payment', () => {
  it('captures on a genuine signature', async () => {
    const { cookies, order } = await payingStudent();
    const signature = checkoutSignature(order.orderId, 'pay_ABC', TEST_SECRET);

    const res = await request(app)
      .post(`${API}/payments/verify`)
      .set('Cookie', cookieHeader(cookies))
      .send({ razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_ABC', razorpay_signature: signature })
      .expect(200);

    expect(res.body.newlyCaptured).toBe(true);
    expect(res.body.hasPaid).toBe(true);
    const stored = await Payment.findOne({ razorpayOrderId: order.orderId });
    expect(stored!.status).toBe('captured');
    expect(stored!.capturedAt).not.toBeNull();
  });

  it('refuses a forged signature and does not mark it paid', async () => {
    const { cookies, order } = await payingStudent();

    const res = await request(app)
      .post(`${API}/payments/verify`)
      .set('Cookie', cookieHeader(cookies))
      .send({
        razorpay_order_id: order.orderId,
        razorpay_payment_id: 'pay_ABC',
        // Correctly shaped, entirely wrong — what an attacker would actually send.
        razorpay_signature: crypto.randomBytes(32).toString('hex'),
      });

    expect(res.status).toBe(400);
    const stored = await Payment.findOne({ razorpayOrderId: order.orderId });
    expect(stored!.status).toBe('failed');
    expect(stored!.status).not.toBe('captured');
  });

  it('refuses a signature computed with the wrong secret', async () => {
    const { cookies, order } = await payingStudent();
    // The shape an attacker who knew the algorithm but not the secret would produce.
    const signature = checkoutSignature(order.orderId, 'pay_ABC', 'not-the-real-secret');

    const res = await request(app)
      .post(`${API}/payments/verify`)
      .set('Cookie', cookieHeader(cookies))
      .send({ razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_ABC', razorpay_signature: signature });

    expect(res.status).toBe(400);
  });

  it('refuses to let one student verify another student’s order', async () => {
    const { order } = await payingStudent();
    const intruder = await registerVerifyLogin(app, otherStudent, { paid: false });
    // A genuine signature — the point is that authenticity is not ownership.
    const signature = checkoutSignature(order.orderId, 'pay_ABC', TEST_SECRET);

    const res = await request(app)
      .post(`${API}/payments/verify`)
      .set('Cookie', cookieHeader(intruder.cookies))
      .send({ razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_ABC', razorpay_signature: signature });

    expect(res.status).toBe(404);
    expect((await Payment.findOne({ razorpayOrderId: order.orderId }))!.status).not.toBe('captured');
  });

  it('is idempotent — a second verify captures nothing new', async () => {
    const { cookies, order } = await payingStudent();
    const signature = checkoutSignature(order.orderId, 'pay_ABC', TEST_SECRET);
    const body = { razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_ABC', razorpay_signature: signature };

    const first = await request(app).post(`${API}/payments/verify`).set('Cookie', cookieHeader(cookies)).send(body).expect(200);
    const second = await request(app).post(`${API}/payments/verify`).set('Cookie', cookieHeader(cookies)).send(body).expect(200);

    expect(first.body.newlyCaptured).toBe(true);
    expect(second.body.newlyCaptured).toBe(false);
    expect(second.body.hasPaid).toBe(true);
  });
});

// ===========================================================================
// Webhooks
// ===========================================================================

describe('the webhook', () => {
  it('captures on a correctly signed event', async () => {
    const { order } = await payingStudent();

    const res = await sendWebhook('payment.captured', order.orderId);

    expect(res.status).toBe(200);
    expect(res.body.captured).toBe(true);
    expect((await Payment.findOne({ razorpayOrderId: order.orderId }))!.status).toBe('captured');
  });

  it('refuses an unsigned or wrongly signed body', async () => {
    const { order } = await payingStudent();

    const unsigned = await request(app).post(`${API}/payments/webhook`).send({ event: 'payment.captured' });
    expect(unsigned.status).toBe(400);

    const wrong = await sendWebhook('payment.captured', order.orderId, 'the-wrong-webhook-secret');
    expect(wrong.status).toBe(400);

    expect((await Payment.findOne({ razorpayOrderId: order.orderId }))!.status).not.toBe('captured');
  });

  it('handles a duplicate delivery without double-capturing', async () => {
    const { order } = await payingStudent();

    const first = await sendWebhook('payment.captured', order.orderId);
    const second = await sendWebhook('payment.captured', order.orderId);

    // Razorpay retries by design. The second must be accepted and change nothing.
    expect(first.body.captured).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.captured).toBe(false);
    expect(await Payment.countDocuments({ status: 'captured' })).toBe(1);
  });

  it('never lets a late failure revoke a capture', async () => {
    const { order } = await payingStudent();
    await sendWebhook('payment.captured', order.orderId);

    // Razorpay can deliver a failure for an earlier attempt after a later one
    // succeeded. Acting on it would take entry away from a student who had paid.
    await sendWebhook('payment.failed', order.orderId);

    expect((await Payment.findOne({ razorpayOrderId: order.orderId }))!.status).toBe('captured');
  });

  it('acknowledges an unknown order without creating one', async () => {
    enablePayments();

    const res = await sendWebhook('payment.captured', 'order_NEVER_CREATED_HERE');

    // 200 so Razorpay stops retrying, but no row: a payment belonging to no student
    // would entitle nobody and could never be reconciled.
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe('unknown-order');
    expect(await Payment.countDocuments()).toBe(0);
  });

  it('records a failure with the provider’s own reason', async () => {
    const { order } = await payingStudent();

    await sendWebhook('payment.failed', order.orderId);

    const stored = await Payment.findOne({ razorpayOrderId: order.orderId });
    expect(stored!.status).toBe('failed');
    expect(stored!.failureReason).toContain('Card declined');
  });
});

// ===========================================================================
// Entitlement — what the money actually buys
// ===========================================================================

describe('entitlement', () => {
  it('reports an unpaid student as unpaid, and a paid one as paid', async () => {
    const { cookies, order } = await payingStudent();

    const before = await request(app).get(`${API}/payments/status`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(before.body.hasPaid).toBe(false);
    expect(before.body.amount).toBe(49_900);
    expect(before.body.amountDisplay).toBe('₹499.00');

    await sendWebhook('payment.captured', order.orderId);

    const after = await request(app).get(`${API}/payments/status`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(after.body.hasPaid).toBe(true);
  });

  it('grants entry to everyone when the fee is switched off', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    enablePayments();
    // Explicit rather than relying on the default, because the assertion is about the
    // switch rather than about what happens when nobody has configured anything.
    await PaymentSettings.findOneAndUpdate(
      { key: 'default' },
      { $set: { olympiadEntryFee: 49_900, entryFeeEnabled: false } },
      { upsert: true, setDefaultsOnInsert: true },
    );

    const res = await request(app).get(`${API}/payments/status`).set('Cookie', cookieHeader(cookies)).expect(200);

    // "We chose to run this free" is expressed once, in settings — not by every caller
    // remembering to check.
    expect(res.body.entryFeeEnabled).toBe(false);
    expect(res.body.hasPaid).toBe(true);
  });

  it('lists the student’s own transactions and never the signature', async () => {
    const { cookies, order } = await payingStudent();
    await sendWebhook('payment.captured', order.orderId);

    const res = await request(app).get(`${API}/payments/mine`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].status).toBe('captured');
    expect(res.body.payments[0].amountDisplay).toBe('₹499.00');
    // The signature is derived from the secret; publishing it would be an oracle.
    expect(JSON.stringify(res.body)).not.toContain('razorpaySignature');
  });
});

// ===========================================================================
// Authorization
// ===========================================================================

describe('authorization', () => {
  it('refuses a guest on every payment route except the webhook', async () => {
    for (const [method, path] of [
      ['post', '/payments/orders'],
      ['post', '/payments/verify'],
      ['get', '/payments/status'],
      ['get', '/payments/mine'],
    ] as const) {
      const res = await (method === 'post' ? request(app).post(`${API}${path}`) : request(app).get(`${API}${path}`));
      expect(res.status).toBe(401);
    }
  });

  it('keeps the admin payment console and the fee behind staff permissions', async () => {
    const { cookies: studentCookies } = await registerVerifyLogin(app, {}, { paid: false });

    for (const path of ['/admin/payments', '/admin/payment-settings']) {
      const guest = await request(app).get(`${API}${path}`);
      expect(guest.status).toBe(401);
      const student = await request(app).get(`${API}${path}`).set('Cookie', cookieHeader(studentCookies));
      expect(student.status).toBe(403);
    }
  });

  it('lets staff see every payment and the collected total', async () => {
    const { order } = await payingStudent();
    await sendWebhook('payment.captured', order.orderId);
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });

    const res = await request(app).get(`${API}/admin/payments`).set('Cookie', cookieHeader(adminCookies)).expect(200);

    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].student.studentId).toBeTruthy();
    // Counted from the collection, never estimated.
    expect(res.body.collectedPaise).toBe(49_900);
    expect(res.body.collectedDisplay).toBe('₹499.00');
  });

  it('lets staff change the fee, and never re-prices a captured payment', async () => {
    const { order } = await payingStudent();
    await sendWebhook('payment.captured', order.orderId);
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });

    await request(app)
      .put(`${API}/admin/payment-settings`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ olympiadEntryFee: 99_900, entryFeeEnabled: true })
      .expect(200);

    // The completed payment keeps what was actually charged — the same snapshot rule
    // `StudentActivity.xpAwarded` follows.
    expect((await Payment.findOne({ razorpayOrderId: order.orderId }))!.amount).toBe(49_900);
  });
});

// ===========================================================================
// The paywall — what the fee actually buys (owner decision, 2026-08-16)
// ===========================================================================

/**
 * The Olympiad entry gate.
 *
 * Scope, after the owner's decision of 2026-08-17: the fee buys **the official exam and
 * nothing else**. Practice, mock tests and the daily challenge are free, and the tests
 * below assert that in both directions — because a paywall that quietly widens is a
 * paywall that starts charging for things the owner said were free, and nothing else in
 * the codebase would catch it.
 *
 * (For one day this gated all four. The tests are written to fail loudly if that comes
 * back by accident.)
 */
describe('the Olympiad entry gate', () => {
  /** Syntactically valid, deliberately non-existent. Proves the gate runs *first*. */
  const ABSENT_ID = '507f1f77bcf86cd799439011';

  /** The three things a student may use without paying a penny. */
  async function freeRequests(cookies: Record<string, string>) {
    return {
      practice: await request(app)
        .post(`${API}/practice/sessions`)
        .set('Cookie', cookieHeader(cookies))
        .send({ subjectId: ABSENT_ID, topicId: ABSENT_ID, questionCount: 5 }),
      mockTest: await request(app)
        .post(`${API}/mock-tests/${ABSENT_ID}/attempts`)
        .set('Cookie', cookieHeader(cookies))
        .send({}),
      dailyChallenge: await request(app)
        .post(`${API}/me/daily-challenge/answer`)
        .set('Cookie', cookieHeader(cookies))
        .send({ selectedOptionKeys: ['A'] }),
    };
  }

  const examRequest = (cookies: Record<string, string>) =>
    request(app).post(`${API}/exams/${ABSENT_ID}/attempt`).set('Cookie', cookieHeader(cookies)).send({});

  it('refuses an unpaid student the official exam', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    await enableEntryFee();

    const res = await examRequest(cookies);

    // 402 rather than 403: "not yet, and here is the button" versus "never". The
    // frontend branches on exactly this to show a pay page instead of a dead end.
    expect(res.status).toBe(402);
    expect(res.status).not.toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('leaves practice, mock tests and the daily challenge free for an unpaid student', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    await enableEntryFee();

    const res = await freeRequests(cookies);

    // Each meets its ordinary handler and is refused on its own merits (the ids above
    // are absent). The assertion is that **payment** is never what stops them.
    for (const [surface, response] of Object.entries(res)) {
      expect(response.status, `${surface} must not be behind the entry fee`).not.toBe(402);
    }
  });

  it('refuses before the exam is looked up, so the gate cannot leak what exists', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    await enableEntryFee();

    // The id is absent. A 404 here would mean the handler ran before the gate, which
    // would let an unpaid caller probe which exams exist.
    const res = await examRequest(cookies);
    expect(res.status).toBe(402);
    expect(res.status).not.toBe(404);
  });

  it('holds on the unversioned /api alias too', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    await enableEntryFee();

    // The compatibility alias mounts the same router. A gate that held on one prefix
    // and not the other would be no gate at all.
    const res = await request(app)
      .post(`/api/exams/${ABSENT_ID}/attempt`)
      .set('Cookie', cookieHeader(cookies))
      .send({});

    expect(res.status).toBe(402);
  });

  it('lets a paid student through to the exam', async () => {
    const { cookies } = await registerVerifyLogin(app);
    await enableEntryFee();

    const res = await examRequest(cookies);
    expect(res.status).not.toBe(402);
  });

  it('lets everybody sit the exam when the fee is switched off', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    await PaymentSettings.findOneAndUpdate(
      { key: 'default' },
      { $set: { olympiadEntryFee: 10_000, entryFeeEnabled: false } },
      { upsert: true, setDefaultsOnInsert: true },
    );

    const res = await examRequest(cookies);
    expect(res.status).not.toBe(402);
  });

  it('charges the fee by default, without anybody having saved a settings document', async () => {
    // A paywall nobody remembered to switch on is not a paywall. With no
    // `PaymentSettings` row at all, the exam gate must still hold.
    expect(await PaymentSettings.findOne({ key: 'default' })).toBeNull();

    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });
    expect((await examRequest(cookies)).status).toBe(402);
  });

  it('reports the entitlement on every auth response, and never as true by omission', async () => {
    const unpaid = await registerVerifyLogin(app, {}, { paid: false });
    await enableEntryFee();

    const before = await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(unpaid.cookies)).expect(200);
    expect(before.body.entitlements.olympiadEntry).toBe(false);

    const paid = await registerVerifyLogin(app, otherStudent);
    const after = await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(paid.cookies)).expect(200);
    expect(after.body.entitlements.olympiadEntry).toBe(true);
  });

  /**
   * The code default, which applies only where no `PaymentSettings` document has been
   * saved — a fresh environment, or this suite. Asserted against the literal rather than
   * against `DEFAULT_ENTRY_FEE_PAISE` on purpose: a test written in terms of the constant
   * agrees with whatever the constant becomes, including a typo, and this is money.
   */
  it('defaults the fee to ₹199', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });

    const res = await request(app).get(`${API}/payments/status`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.amount).toBe(19_900);
    expect(res.body.amountDisplay).toBe('₹199.00');
    expect(res.body.entryFeeEnabled).toBe(true);
    expect(res.body.hasPaid).toBe(false);
  });
});
