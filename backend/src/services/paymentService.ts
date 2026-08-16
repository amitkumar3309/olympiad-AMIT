import crypto from 'node:crypto';
import type { Types } from 'mongoose';
import { config } from '../config';
import { logger } from '../lib/logger';
import { ApiError } from '../lib/ApiError';
import {
  Payment,
  PaymentSettings,
  DEFAULT_ENTRY_FEE_PAISE,
  type PaymentDocument,
  type PaymentPurpose,
  type PaymentSource,
} from '../models';

/**
 * THE payment path (Milestone 19). Razorpay orders, signature verification, webhooks,
 * and the entitlement they grant.
 *
 * ## The one rule everything here serves
 *
 * **The browser is never believed about money.** It cannot say a payment succeeded, how
 * much was paid, or what was bought. Every state change is either the result of a
 * signature this server computed with a secret only it holds, or of a webhook whose body
 * this server verified the same way. The frontend's only job is to open a modal and
 * report back an id — and even that id is worthless without a matching signature.
 *
 * This is the same shape as the answer-key rule: the client is given nothing it could
 * forge an outcome with.
 *
 * ## No SDK
 *
 * `fetch` and `node:crypto`, following the Milestone 17 precedent set for Gemini. The
 * Razorpay REST API is Basic auth over HTTPS and the signature is one HMAC — an SDK
 * would add a dependency and a version to chase to save about thirty lines, and its
 * automatic retries are actively unwanted on an endpoint that creates orders.
 *
 * ## Two paths to `captured`, both idempotent
 *
 * A payment can be confirmed twice: once when the browser returns from the modal, and
 * again (or first, or only) by webhook. Both call `capturePayment()`, which moves the
 * row with a **conditional update** that matches only a not-yet-captured document. The
 * second caller changes nothing and is told so. Duplicate webhooks — which Razorpay
 * sends by design on retry — are therefore free rather than dangerous.
 */

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const REQUEST_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Transport, and the test seam
// ---------------------------------------------------------------------------

export type PaymentTransport = (url: string, init: RequestInit) => Promise<Response>;

const realTransport: PaymentTransport = (url, init) => fetch(url, init);

let transport: PaymentTransport = realTransport;

/**
 * Test-only. Throws outside the test environment.
 *
 * Payments are the clearest case for this pattern in the whole codebase: the paths that
 * matter are a declined card, a duplicate webhook, a forged signature and a provider
 * outage, and none of them can be produced on demand against a real gateway — least of
 * all in a suite that must run offline.
 */
export function setPaymentTransport(next: PaymentTransport | null): void {
  if (!config.isTest) {
    throw new Error('setPaymentTransport() is a test-only hook and must not be called at runtime.');
  }
  transport = next ?? realTransport;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface EffectivePaymentSettings {
  olympiadEntryFee: number;
  currency: string;
  entryFeeEnabled: boolean;
}

/** The saved settings, or the code defaults when nobody has saved any. */
export async function getPaymentSettings(): Promise<EffectivePaymentSettings> {
  const saved = await PaymentSettings.findOne({ key: 'default' }).lean();
  return {
    olympiadEntryFee: saved?.olympiadEntryFee ?? DEFAULT_ENTRY_FEE_PAISE,
    currency: saved?.currency ?? 'INR',
    // Opt-in — see the note on the model field. A missing settings document means
    // the gate is off, not on.
    entryFeeEnabled: saved?.entryFeeEnabled ?? false,
  };
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on a signature leaks, through timing, how many leading characters an attacker
 * guessed right, which turns forging one into a character-at-a-time search rather than
 * a brute force over the whole space. `timingSafeEqual` throws on a length mismatch, so
 * that is checked first — the length of a digest is not a secret.
 */
function signaturesMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * The signature Razorpay's checkout returns: `HMAC-SHA256(order_id|payment_id, secret)`.
 *
 * Exported so the test suite can produce a *genuine* signature rather than asserting
 * against a hardcoded string — a test that only ever checks a forged one passes just as
 * well against an implementation that accepts everything.
 */
export function checkoutSignature(orderId: string, paymentId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

/** The webhook signature: HMAC-SHA256 over the **raw request body**. */
export function webhookSignature(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Verifies a webhook body against the `x-razorpay-signature` header.
 *
 * The raw body matters and is why `app.ts` keeps a copy: `JSON.parse` followed by
 * `JSON.stringify` does not reproduce the bytes Razorpay signed — key order, whitespace
 * and unicode escaping all differ — so verifying against a re-serialised object fails
 * for legitimate webhooks and would inevitably be "fixed" by not verifying at all.
 */
export function verifyWebhookSignature(rawBody: string, provided: string | undefined): boolean {
  const secret = config.payments.webhookSecret;
  if (!secret) {
    // Refusing every webhook is correct: an unverifiable webhook is an unauthenticated
    // request that grants entitlements, and accepting one would be worse than the
    // feature not working.
    logger.error('RAZORPAY_WEBHOOK_SECRET is not set — refusing the webhook rather than trusting it');
    return false;
  }
  if (!provided) return false;
  return signaturesMatch(webhookSignature(rawBody, secret), provided);
}

// ---------------------------------------------------------------------------
// Order creation
// ---------------------------------------------------------------------------

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

interface RazorpayError {
  error?: { description?: string; code?: string };
}

function requireConfigured(): { keyId: string; keySecret: string } {
  const { keyId, keySecret } = config.payments;
  if (!keyId || !keySecret) {
    throw ApiError.serviceUnavailable(
      'Payments are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the backend environment — see ENVIRONMENT_VARIABLES.md.',
    );
  }
  return { keyId, keySecret };
}

export interface CreateOrderResult {
  payment: PaymentDocument;
  /** Public key id, handed to the browser so the checkout can open. */
  keyId: string;
}

/**
 * Creates a Razorpay order and the local record of it, in that order.
 *
 * The remote order is created **first** on purpose: if Razorpay refuses, there is no
 * local row to clean up. The reverse order would leave a `created` payment that can
 * never be paid, and those are indistinguishable from ones a student simply abandoned.
 */
export async function createEntryOrder(student: Types.ObjectId, studentId: string): Promise<CreateOrderResult> {
  const { keyId, keySecret } = requireConfigured();
  const settings = await getPaymentSettings();

  if (!settings.entryFeeEnabled) {
    throw ApiError.conflict('The entry fee is currently switched off — no payment is needed to enter.');
  }

  // Already paid? Say so rather than taking the money twice. This is a courtesy check,
  // not the guarantee — `hasEntryEntitlement()` is what actually gates the exam, and a
  // race here costs a refundable duplicate rather than a wrong entitlement.
  if (await hasEntryEntitlement(student)) {
    throw ApiError.conflict('You have already paid the entry fee.');
  }

  // Razorpay caps `receipt` at 40 characters. The student id plus a timestamp is unique,
  // traceable back to a person, and carries nothing sensitive.
  const receipt = `amit_${studentId}_${Date.now().toString(36)}`.slice(0, 40);

  let response: Response;
  try {
    response = await transport(`${RAZORPAY_API}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Basic auth, per Razorpay's API. The secret never leaves this process.
        authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        amount: settings.olympiadEntryFee,
        currency: settings.currency,
        receipt,
        // Notes come back on the webhook, which is a useful second way to attribute a
        // payment — but it is Razorpay-supplied data, so it is never *trusted*: the
        // order id and our own row are the authority.
        notes: { studentId, purpose: 'olympiad_entry' },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    logger.error({ err }, 'Razorpay order creation failed at the transport');
    throw ApiError.badGateway(`The payment provider ${reason}. No money has been taken — please try again.`);
  }

  const body = (await response.json().catch(() => ({}))) as RazorpayOrder & RazorpayError;

  if (!response.ok || !body.id) {
    const detail = body.error?.description ?? `HTTP ${response.status}`;
    logger.error({ status: response.status, detail }, 'Razorpay refused the order');
    // 401 from Razorpay means our credentials are wrong — an operator problem, not the
    // student's, so it must not be reported to them as a payment failure.
    if (response.status === 401) {
      throw ApiError.serviceUnavailable('Payments are misconfigured. Please contact support — no money has been taken.');
    }
    throw ApiError.badGateway(`The payment provider refused the order: ${detail}`);
  }

  const payment = await Payment.create({
    student,
    purpose: 'olympiad_entry' satisfies PaymentPurpose,
    amount: body.amount,
    currency: body.currency,
    razorpayOrderId: body.id,
    status: 'created',
  });

  return { payment, keyId };
}

// ---------------------------------------------------------------------------
// Capture — the one place a payment becomes real
// ---------------------------------------------------------------------------

export interface CaptureInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  /** Present on the checkout path, absent on the webhook path (which verifies the body). */
  razorpaySignature?: string | null;
  source: PaymentSource;
  method?: string | null;
}

export interface CaptureResult {
  payment: PaymentDocument;
  /** False when it was already captured — a duplicate webhook or a second verify call. */
  changed: boolean;
}

/**
 * Marks a payment captured, idempotently.
 *
 * The update is **conditional on the payment not already being captured**, and reports
 * whether it won. That is what makes the two confirmation paths safe to race: the
 * browser returning from the modal and Razorpay's webhook routinely arrive within the
 * same second, and on serverless they land in different invocations. A read-then-write
 * would let both believe they were first — and anything hung off "was this the moment it
 * was paid?" (a receipt email, an entitlement notification) would fire twice.
 */
export async function capturePayment(input: CaptureInput): Promise<CaptureResult> {
  const existing = await Payment.findOne({ razorpayOrderId: input.razorpayOrderId });
  if (!existing) {
    // An order this server never created. Either a forged call or a webhook for another
    // environment sharing the same Razorpay account — both are refused, and neither is
    // allowed to create a row, because a payment with no student entitles nobody.
    throw ApiError.notFound('No payment exists for that order.');
  }

  const updated = await Payment.findOneAndUpdate(
    { razorpayOrderId: input.razorpayOrderId, status: { $ne: 'captured' } },
    {
      $set: {
        status: 'captured',
        razorpayPaymentId: input.razorpayPaymentId,
        razorpaySignature: input.razorpaySignature ?? null,
        statusSource: input.source,
        method: input.method ?? null,
        capturedAt: new Date(),
        failureReason: null,
      },
    },
    { new: true },
  );

  if (!updated) {
    // Already captured. Not an error — it is the expected outcome of the second of two
    // legitimate confirmations, and the caller is told nothing changed.
    return { payment: existing, changed: false };
  }

  logger.info(
    { orderId: input.razorpayOrderId, source: input.source, student: String(updated.student) },
    'Payment captured',
  );
  return { payment: updated, changed: true };
}

/**
 * Records a failure without ever overwriting a capture.
 *
 * The guard matters: Razorpay can deliver `payment.failed` for one attempt *after* a
 * later attempt on the same order succeeded, and letting that land would revoke a
 * student's entitlement for a card they had already worked around.
 */
export async function failPayment(orderId: string, reason: string, source: PaymentSource): Promise<void> {
  await Payment.findOneAndUpdate(
    { razorpayOrderId: orderId, status: { $nin: ['captured', 'refunded'] } },
    { $set: { status: 'failed', failureReason: reason.slice(0, 300), statusSource: source } },
  );
}

/** Records that checkout was opened, so an abandoned attempt is distinguishable. */
export async function markAttempted(orderId: string): Promise<void> {
  await Payment.updateOne({ razorpayOrderId: orderId, status: 'created' }, { $set: { status: 'attempted' } });
}

// ---------------------------------------------------------------------------
// Verification from the browser's return journey
// ---------------------------------------------------------------------------

export interface VerifyInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * Verifies what the checkout handed back, then captures.
 *
 * The signature is the whole point of this function. Without it the three ids are just
 * strings the browser typed, and "I paid" would be a claim rather than a fact. A
 * mismatch is recorded as a failure and refused — it means either a bug or an attempt
 * to forge a payment, and both need to be visible.
 */
export async function verifyAndCapture(input: VerifyInput): Promise<CaptureResult> {
  const { keySecret } = requireConfigured();

  const expected = checkoutSignature(input.razorpayOrderId, input.razorpayPaymentId, keySecret);
  if (!signaturesMatch(expected, input.razorpaySignature)) {
    logger.error({ orderId: input.razorpayOrderId }, 'Payment signature did not verify — refusing');
    await failPayment(input.razorpayOrderId, 'Signature verification failed', 'checkout_verify');
    throw ApiError.badRequest('That payment could not be verified. If money was taken it will be refunded automatically.');
  }

  return capturePayment({
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    razorpaySignature: input.razorpaySignature,
    source: 'checkout_verify',
  });
}

// ---------------------------------------------------------------------------
// Entitlement
// ---------------------------------------------------------------------------

/**
 * **THE entitlement check.** May this student sit the official exam?
 *
 * Derived from the payment record rather than a flag on `Student`, for the reason given
 * at the top of `models/Payment.ts`: a stored boolean is a second source of truth about
 * money, and when it drifts somebody is wrongly refused or wrongly admitted.
 *
 * Returns true when the fee is switched off, so "we are running this Olympiad free" is
 * expressed once, in settings, rather than by every caller remembering to check.
 */
export async function hasEntryEntitlement(student: Types.ObjectId): Promise<boolean> {
  const settings = await getPaymentSettings();
  if (!settings.entryFeeEnabled) return true;

  const paid = await Payment.exists({ student, purpose: 'olympiad_entry', status: 'captured' });
  return paid !== null;
}

/** The student's own transaction history, newest first. */
export async function listPaymentsFor(student: Types.ObjectId): Promise<PaymentDocument[]> {
  return Payment.find({ student }).sort({ createdAt: -1 }).limit(50);
}

/** What a student may see about their own payment. Never the signature. */
export function paymentView(payment: PaymentDocument) {
  return {
    id: String(payment._id),
    purpose: payment.purpose,
    // Rupees are derived at the edge; the stored value stays integer paise.
    amount: payment.amount,
    amountDisplay: `₹${(payment.amount / 100).toFixed(2)}`,
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
    // The order id is safe to show and is what support will ask for. The signature is
    // never returned: it is derived from the secret, and publishing it would leak an
    // oracle for whether a given order/payment pair is genuine.
    razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId: payment.razorpayPaymentId,
    failureReason: payment.failureReason,
    capturedAt: payment.capturedAt,
    createdAt: payment.createdAt,
  };
}
