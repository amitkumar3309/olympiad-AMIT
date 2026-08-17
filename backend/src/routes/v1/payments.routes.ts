import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { paymentLimiter } from '../../middleware/rateLimiter';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { config } from '../../config';
import { Payment, PaymentSettings, Student, PAYMENT_STATUSES, type PaymentStatus } from '../../models';
import {
  createEntryOrder,
  verifyAndCapture,
  capturePayment,
  failPayment,
  markAttempted,
  getPaymentSettings,
  hasEntryEntitlement,
  listPaymentsFor,
  paymentView,
  verifyWebhookSignature,
  reconcileOrder,
} from '../../services/paymentService';
import {
  verifyPaymentSchema,
  paymentSettingsSchema,
  type VerifyPaymentInput,
  type PaymentSettingsInput,
} from '../../validation/paymentSchemas';

const router = Router();

/**
 * Payments (Milestone 19). Razorpay Standard Checkout, verified server-side.
 *
 * ## The rule
 *
 * **Nothing here believes the browser about money.** The client may ask for an order and
 * report back three ids; it can never assert that a payment succeeded. Both paths that
 * mark a payment captured — the return journey and the webhook — verify an HMAC
 * signature computed from a secret only this process holds.
 */

/** The student's own id, as an ObjectId. Every route here is owner-scoped by the token. */
function callerId(req: Request): Types.ObjectId {
  return new Types.ObjectId(req.user!.sub);
}

// ---------------------------------------------------------------------------
// What it costs, and whether you have already paid
// ---------------------------------------------------------------------------

router.get('/payments/status', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const student = callerId(req);
    const [settings, entitled] = await Promise.all([getPaymentSettings(), hasEntryEntitlement(student)]);

    sendSuccess(res, 200, {
      // `configured` is reported so the page can say "payments are unavailable" rather
      // than offering a button that will 503.
      available: config.payments.configured,
      entryFeeEnabled: settings.entryFeeEnabled,
      amount: settings.olympiadEntryFee,
      amountDisplay: `₹${(settings.olympiadEntryFee / 100).toFixed(2)}`,
      currency: settings.currency,
      /** The entitlement, derived from the payment record — never a stored flag. */
      hasPaid: entitled,
    });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Failed to read payment status', fallback: 'Could not load payment details.' });
  }
});

// ---------------------------------------------------------------------------
// Order creation
// ---------------------------------------------------------------------------

/**
 * Creates a Razorpay order for the caller's own entry fee.
 *
 * **The amount is never accepted from the request.** It comes from the settings
 * document, server-side — a client-supplied amount is how a ₹499 fee gets paid as ₹1.
 * There is deliberately no request body at all: the only thing a student can buy is
 * their own entry, and who they are comes from the token.
 */
router.post('/payments/orders', requireAuth(), paymentLimiter, ensureDb, async (req: Request, res: Response) => {
  try {
    const account = await Student.findById(req.user!.sub).select('studentId fullName email mobile');
    if (!account) {
      sendError(res, 404, 'No account found.');
      return;
    }

    const { payment, keyId } = await createEntryOrder(account._id as Types.ObjectId, account.studentId);
    await markAttempted(payment.razorpayOrderId);

    sendSuccess(res, 201, {
      // Everything the checkout modal needs — and nothing else. The key id is public by
      // design; the secret is not here and never will be.
      keyId,
      orderId: payment.razorpayOrderId,
      amount: payment.amount,
      currency: payment.currency,
      /** Prefill, so the student is not retyping what we already know. */
      prefill: { name: account.fullName ?? '', email: account.email, contact: account.mobile ?? '' },
    });
  } catch (err) {
    respondToServiceError(res, err, {
      log: 'Failed to create a payment order',
      fallback: 'Could not start the payment. No money has been taken.',
    });
  }
});

// ---------------------------------------------------------------------------
// Verification — the browser's return journey
// ---------------------------------------------------------------------------

/**
 * Verifies the checkout result and captures the payment.
 *
 * This is **not** the only path to capture: the webhook below reaches the same place,
 * and either may arrive first. Both are idempotent, so a student whose browser closed
 * before this call still gets their entitlement from the webhook, and one whose webhook
 * is delayed still gets it here.
 */
router.post(
  '/payments/verify',
  requireAuth(),
  validate({ body: verifyPaymentSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as VerifyPaymentInput;

      // Ownership: a signature proves the payment is genuine, not that it belongs to
      // the caller. Without this check a student could verify somebody else's order and
      // — since the entitlement is keyed on the row's `student` — hand *them* the entry
      // while appearing to have paid. It costs one indexed read.
      const owned = await Payment.findOne({ razorpayOrderId: input.razorpay_order_id }).select('student');
      if (!owned || String(owned.student) !== req.user!.sub) {
        sendError(res, 404, 'No payment exists for that order.');
        return;
      }

      const { payment, changed } = await verifyAndCapture({
        razorpayOrderId: input.razorpay_order_id,
        razorpayPaymentId: input.razorpay_payment_id,
        razorpaySignature: input.razorpay_signature,
      });

      sendSuccess(res, 200, {
        payment: paymentView(payment),
        /** False when a webhook got here first. The student is entitled either way. */
        newlyCaptured: changed,
        hasPaid: true,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Payment verification failed',
        fallback: 'Could not verify that payment.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Webhook — the only unauthenticated route here
// ---------------------------------------------------------------------------

interface WebhookBody {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; method?: string; error_description?: string } };
    order?: { entity?: { id?: string } };
  };
}

/**
 * Razorpay's server-to-server notification.
 *
 * Three things make this safe without a session:
 *
 * 1. **The body is verified** against `RAZORPAY_WEBHOOK_SECRET` before it is read as
 *    anything. An unverified webhook is an anonymous request that grants entitlements.
 * 2. **It is idempotent.** Razorpay retries on any non-2xx and may deliver the same
 *    event more than once by design; `capturePayment()` is conditional, so a repeat
 *    changes nothing.
 * 3. **It never creates a payment.** An order this server did not create belongs to
 *    nobody, so there is no student to entitle and the event is acknowledged and
 *    dropped rather than acted on.
 *
 * It returns 200 for anything it has understood, *including* events it ignores —
 * a non-2xx makes Razorpay retry, and retrying an event we will never care about just
 * fills their queue and our logs.
 */
router.post('/payments/webhook', ensureDb, async (req: Request, res: Response) => {
  const raw = (req as Request & { rawBody?: string }).rawBody ?? '';
  const signature = req.header('x-razorpay-signature');

  if (!verifyWebhookSignature(raw, signature)) {
    // 400, not 401: there is no identity to challenge here. Deliberately terse — a
    // detailed message would help somebody probing for the secret.
    logger.error('Rejected a webhook with an invalid signature');
    sendError(res, 400, 'Invalid signature.');
    return;
  }

  const body = req.body as WebhookBody;
  const entity = body.payload?.payment?.entity;
  const orderId = entity?.order_id ?? body.payload?.order?.entity?.id;

  try {
    if (!orderId) {
      sendSuccess(res, 200, { received: true, ignored: 'no-order-id' });
      return;
    }

    switch (body.event) {
      case 'payment.captured':
      case 'order.paid': {
        const known = await Payment.exists({ razorpayOrderId: orderId });
        if (!known) {
          // Another environment sharing this Razorpay account, most likely. Nothing to
          // do, and inventing a row would create a payment belonging to no student.
          logger.warn({ orderId }, 'Webhook for an unknown order — acknowledged and ignored');
          sendSuccess(res, 200, { received: true, ignored: 'unknown-order' });
          return;
        }
        const { changed } = await capturePayment({
          razorpayOrderId: orderId,
          razorpayPaymentId: entity?.id ?? 'unknown',
          source: 'webhook',
          method: entity?.method ?? null,
        });
        sendSuccess(res, 200, { received: true, captured: changed });
        return;
      }

      case 'payment.failed': {
        await failPayment(orderId, entity?.error_description ?? 'Payment failed', 'webhook');
        sendSuccess(res, 200, { received: true, failed: true });
        return;
      }

      default:
        sendSuccess(res, 200, { received: true, ignored: body.event ?? 'unknown-event' });
        return;
    }
  } catch (err) {
    // A 500 here makes Razorpay retry, which is exactly what we want when our own
    // database was briefly unavailable — the event is not lost.
    logger.error({ err, orderId, event: body.event }, 'Webhook processing failed');
    sendError(res, 500, 'Could not process that webhook.');
  }
});

/**
 * Settles the caller's outstanding order by asking Razorpay directly.
 *
 * Called by the payment page whenever it loads with an unsettled order, and by the
 * checkout handler when the modal is dismissed. With no webhook configured this is the
 * safety net for "the student paid but their tab closed before verify landed" — see
 * `reconcileOrder()`.
 */
router.post('/payments/reconcile', requireAuth(), paymentLimiter, ensureDb, async (req: Request, res: Response) => {
  try {
    const pending = await Payment.findOne({ student: callerId(req), status: { $in: ['created', 'attempted'] } }).sort({
      createdAt: -1,
    });

    if (!pending) {
      sendSuccess(res, 200, { reconciled: false, hasPaid: await hasEntryEntitlement(callerId(req)) });
      return;
    }

    const result = await reconcileOrder(pending.razorpayOrderId);
    sendSuccess(res, 200, {
      reconciled: result?.changed ?? false,
      payment: result ? paymentView(result.payment) : null,
      hasPaid: await hasEntryEntitlement(callerId(req)),
    });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Reconciliation failed', fallback: 'Could not check that payment.' });
  }
});

// ---------------------------------------------------------------------------
// History, and the administrative view
// ---------------------------------------------------------------------------

router.get('/payments/mine', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const payments = await listPaymentsFor(callerId(req));
    sendSuccess(res, 200, { payments: payments.map(paymentView) });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Failed to list payments', fallback: 'Could not load your payments.' });
  }
});

/**
 * Every payment, for staff.
 *
 * Gated on `students:read` rather than a new permission: it exposes who paid what, which
 * is student account data, and every role that may already read a student's record is
 * the same set that should see their transactions.
 */
router.get('/admin/payments', requirePermission('students:read'), ensureDb, async (req: Request, res: Response) => {
  try {
    // An allow-list narrowed to the literal union, not the raw query value: this
    // reaches a Mongo filter, and a widened `string` is how an operator object gets in.
    const raw = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status = PAYMENT_STATUSES.find((value) => value === raw);
    const filter: { status?: PaymentStatus } = status ? { status } : {};

    const [payments, totals] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).limit(100).populate('student', 'studentId fullName email'),
      Payment.aggregate<{ _id: string; count: number; amount: number }>([
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
    ]);

    const captured = totals.find((row) => row._id === 'captured');

    sendSuccess(res, 200, {
      payments: payments.map((payment) => {
        const owner = payment.student as unknown as { studentId?: string; fullName?: string; email?: string };
        return {
          ...paymentView(payment),
          student: { studentId: owner?.studentId ?? null, fullName: owner?.fullName ?? null, email: owner?.email ?? null },
        };
      }),
      // Counted from the collection, never estimated — the rule every admin figure in
      // this product follows.
      byStatus: totals.map((row) => ({ status: row._id, count: row.count, amount: row.amount })),
      collectedPaise: captured?.amount ?? 0,
      collectedDisplay: `₹${((captured?.amount ?? 0) / 100).toFixed(2)}`,
    });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Failed to list payments (admin)', fallback: 'Could not load payments.' });
  }
});

// ---------------------------------------------------------------------------
// The fee itself — administrator-editable, never an environment variable
// ---------------------------------------------------------------------------

router.get('/admin/payment-settings', requirePermission('students:read'), ensureDb, async (_req: Request, res: Response) => {
  try {
    const settings = await getPaymentSettings();
    sendSuccess(res, 200, {
      ...settings,
      amountDisplay: `₹${(settings.olympiadEntryFee / 100).toFixed(2)}`,
      /** Whether the credentials exist. Distinct from the fee being switched off. */
      providerConfigured: config.payments.configured,
    });
  } catch (err) {
    respondToServiceError(res, err, { log: 'Failed to read payment settings', fallback: 'Could not load the fee settings.' });
  }
});

/**
 * Changes the fee.
 *
 * Gated on `students:status:write` — the closest existing capability to "may change
 * something that affects every student's account", and deliberately *not* the read
 * permission the console above uses: seeing what the fee is and setting it are
 * different acts.
 *
 * **Changing the price never re-prices a captured payment.** `Payment.amount` is a
 * snapshot of what was actually charged, exactly as `StudentActivity.xpAwarded` is a
 * snapshot of what an event was worth. A rise applies to the next student only.
 */
router.put(
  '/admin/payment-settings',
  requirePermission('students:status:write'),
  validate({ body: paymentSettingsSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const input = req.body as PaymentSettingsInput;
      const before = await getPaymentSettings();

      const saved = await PaymentSettings.findOneAndUpdate(
        { key: 'default' },
        {
          $set: {
            olympiadEntryFee: input.olympiadEntryFee,
            entryFeeEnabled: input.entryFeeEnabled,
            updatedByLabel: req.user?.studentId ?? req.user?.email ?? 'unknown',
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      await recordAudit(req, {
        action: 'payment.settings.updated',
        targetType: 'system',
        targetLabel: `Entry fee ₹${(saved.olympiadEntryFee / 100).toFixed(2)}`,
        // Both sides recorded: "who changed the price, from what, to what" is the
        // question this entry exists to answer.
        metadata: {
          fromPaise: before.olympiadEntryFee,
          toPaise: saved.olympiadEntryFee,
          fromEnabled: before.entryFeeEnabled,
          toEnabled: saved.entryFeeEnabled,
        },
      });

      sendSuccess(res, 200, {
        olympiadEntryFee: saved.olympiadEntryFee,
        entryFeeEnabled: saved.entryFeeEnabled,
        currency: saved.currency,
        amountDisplay: `₹${(saved.olympiadEntryFee / 100).toFixed(2)}`,
      });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to update payment settings', fallback: 'Could not save the fee.' });
    }
  },
);

export default router;
