import { useCallback, useEffect, useState } from 'react'
import StudentShell from '../../components/StudentShell'
import { Alert, Button, ButtonLink, Card, CardHeader, Icon, SkeletonCards } from '../../components/ui'
import { api, ApiError, API_BASE } from '../../api/client'
import type { StudentInvoice } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import styles from './Payment.module.css'

/**
 * The Olympiad entry fee — Razorpay Standard Checkout (Milestone 19).
 *
 * ## What this page can and cannot do
 *
 * It opens a modal and reports three ids back. **It cannot make a payment true.** The
 * server decides that, by verifying an HMAC signature it computes with a secret this
 * bundle has never seen. If this component lied — claimed success, posted a made-up
 * signature — the server would refuse and the student would remain unpaid. That is the
 * property the whole design is built on, and it is why none of the logic below is
 * security-relevant.
 *
 * ## Why it reconciles on load and on dismiss
 *
 * There is no webhook configured, so the return journey from the modal is the only
 * moment the browser can tell us anything — and a browser can be closed, refreshed or
 * killed by a dropped mobile connection in the second between the money moving and the
 * verify call landing. Every one of those leaves Razorpay holding a captured payment
 * this database knows nothing about.
 *
 * So on mount, and whenever the modal closes without success, the page asks the server
 * to settle the outstanding order **from Razorpay directly**. A student who paid and
 * lost their tab gets their entitlement the moment they come back to this page.
 */

interface PaymentStatus {
  available: boolean
  entryFeeEnabled: boolean
  amount: number
  amountDisplay: string
  currency: string
  hasPaid: boolean
}

interface OrderResponse {
  keyId: string
  orderId: string
  amount: number
  currency: string
  prefill: { name: string; email: string; contact: string }
}

/** What Razorpay's checkout hands back on success. Their field names, unchanged. */
interface CheckoutResult {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface RazorpayInstance {
  open: () => void
  on: (event: string, handler: (payload: { error?: { description?: string } }) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

/**
 * Loads Razorpay's script once, on demand.
 *
 * Deliberately not a `<script>` in `index.html`: it would be fetched on every page load
 * of the whole site, for a page almost nobody visits, from a third-party origin. Loading
 * it when the student actually reaches the payment page costs one round trip at the only
 * moment it matters.
 */
function loadCheckout(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true)

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)))
      existing.addEventListener('error', () => resolve(false))
      return
    }
    const script = document.createElement('script')
    script.src = CHECKOUT_SRC
    script.async = true
    script.onload = () => resolve(Boolean(window.Razorpay))
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

/**
 * The invoice, shown before it is downloaded.
 *
 * Rendered from the **same `InvoiceData` the PDF is built from**, fetched from the
 * server — not reconstructed here from a payment record. That is the point: if this
 * component assembled its own version, the figure a student reads on screen and the
 * figure in the file they keep could differ, and the one they would quote back to
 * support is whichever they saw last.
 *
 * Nothing on it is computed in the browser. The total, the amount in words, the invoice
 * number and the date all arrive as strings the server produced.
 */
function InvoicePreview({ invoice, onClose }: { invoice: StudentInvoice; onClose: () => void }) {
  return (
    <div className={styles.invoiceBackdrop} role="dialog" aria-modal="true" aria-labelledby="invoice-title">
      <div className={`card ${styles.invoiceModal}`}>
        <div className={styles.invoiceHead}>
          <div>
            <h3 id="invoice-title">{invoice.issuer.name}</h3>
            {invoice.issuer.addressLines.map((line) => (
              <p key={line} className={styles.invoiceMuted}>
                {line}
              </p>
            ))}
            <p className={styles.invoiceMuted}>
              {invoice.issuer.email} · {invoice.issuer.phone}
            </p>
            {/* Printed only when the deployment has configured one. Never invented. */}
            {invoice.issuer.gstin && <p className={styles.invoiceMuted}>GSTIN: {invoice.issuer.gstin}</p>}
          </div>
          <div className={styles.invoiceTitle}>{invoice.title.toUpperCase()}</div>
        </div>

        <div className={styles.invoiceMeta}>
          <div>
            <span className={styles.invoiceLabel}>Billed to</span>
            <p className={styles.invoiceStrong}>{invoice.buyer.name}</p>
            <p className={styles.invoiceMuted}>{invoice.buyer.studentId}</p>
            {invoice.buyer.classLevel && <p className={styles.invoiceMuted}>{invoice.buyer.classLevel}</p>}
            <p className={styles.invoiceMuted}>{invoice.buyer.email}</p>
            <p className={styles.invoiceMuted}>{invoice.buyer.mobile}</p>
          </div>
          <dl className={styles.invoiceFacts}>
            <dt>Invoice number</dt>
            <dd className={styles.invoiceMono}>{invoice.invoiceNumber}</dd>
            <dt>Invoice date</dt>
            <dd>{new Date(invoice.invoiceDate).toLocaleDateString()}</dd>
            <dt>Status</dt>
            <dd className={styles.invoicePaid}>PAID</dd>
          </dl>
        </div>

        <table className={styles.invoiceTable}>
          <thead>
            <tr>
              <th>Description</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{invoice.item.description}</td>
              <td className={styles.invoiceAmount}>{invoice.item.amountDisplay}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th>Total paid</th>
              <th className={styles.invoiceAmount}>{invoice.totalDisplay}</th>
            </tr>
          </tfoot>
        </table>

        <p className={styles.invoiceWords}>{invoice.totalInWords}</p>
        {invoice.issuer.taxNote && <p className={styles.invoiceMuted}>{invoice.issuer.taxNote}</p>}

        <dl className={styles.invoicePayment}>
          <dt>Payment method</dt>
          <dd>{invoice.payment.method ?? 'Razorpay'}</dd>
          <dt>Order ID</dt>
          <dd className={styles.invoiceMono}>{invoice.payment.razorpayOrderId}</dd>
          {invoice.payment.razorpayPaymentId && (
            <>
              <dt>Payment ID</dt>
              <dd className={styles.invoiceMono}>{invoice.payment.razorpayPaymentId}</dd>
            </>
          )}
          <dt>Received on</dt>
          <dd>{new Date(invoice.payment.capturedAt).toLocaleString()}</dd>
        </dl>

        <div className={styles.invoiceActions}>
          <button type="button" className={styles.invoiceClose} onClick={onClose}>
            Close
          </button>
          {/*
           * A plain link rather than a fetch: the response is a file, the request is
           * same-origin in both environments, and the browser's own download handling is
           * better than anything reimplemented here. The endpoint's authorization applies
           * either way — this link is a convenience, never the gate.
           */}
          <a
            className={styles.invoiceDownload}
            href={`${API_BASE}/me/invoices/${invoice.payment.id}/download`}
          >
            <Icon name="ph-download-simple" weight="bold" /> Download PDF
          </a>
        </div>
      </div>
    </div>
  )
}

export default function Payment() {
  const { can } = useAuth()
  // Staff see the operator-facing cause; a student never should.
  const isStaff = can('students:read')
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  /** The student's own receipts — one per captured payment, or none. */
  const [invoices, setInvoices] = useState<StudentInvoice[]>([])
  const [previewing, setPreviewing] = useState<StudentInvoice | null>(null)

  const refresh = useCallback(async () => {
    const next = await api.get<PaymentStatus>('/payments/status')
    setStatus(next)

    /**
     * Loaded alongside the status rather than behind a click, because the whole question
     * a paid student comes to this page with is "where is my receipt?" — and a section
     * that only appears after pressing something is a section they will not find.
     *
     * A failure is swallowed on purpose: a missing receipts list must never take down the
     * payment page around it, which is the surface a student needs when something has
     * gone wrong with their money.
     */
    try {
      const mine = await api.get<{ invoices: StudentInvoice[] }>('/me/invoices')
      setInvoices(mine.invoices)
    } catch {
      setInvoices([])
    }

    return next
  }, [])

  /**
   * Asks the server to settle any outstanding order against Razorpay.
   *
   * Silent on failure: it runs on page load, and a provider hiccup here should not
   * greet a student with an error about something they did not do.
   */
  const reconcile = useCallback(async () => {
    try {
      const res = await api.post<{ reconciled: boolean; hasPaid: boolean }>('/payments/reconcile', {})
      if (res.reconciled) setNotice('We found your payment and your entry is confirmed.')
      if (res.hasPaid) await refresh()
    } catch {
      /* Nothing to tell the student — the pay button still works. */
    }
  }, [refresh])

  useEffect(() => {
    refresh()
      .then(() => reconcile())
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load payment details.'))
  }, [refresh, reconcile])

  async function pay() {
    setError('')
    setNotice('')
    setBusy(true)

    try {
      const ready = await loadCheckout()
      if (!ready) {
        setError('Could not load the payment window. Check your connection, or disable any ad blocker, and try again.')
        return
      }

      const order = await api.post<OrderResponse>('/payments/orders', {})

      const checkout = new window.Razorpay!({
        // The public key id, from the server — never built into this bundle, so the two
        // cannot drift apart.
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'AMIT Maths Olympiad',
        description: 'Olympiad entry fee',
        prefill: order.prefill,
        theme: { color: '#0052ff' },

        handler: async (result: CheckoutResult) => {
          setBusy(true)
          try {
            // The server verifies the signature. Success here is a *claim* until it does.
            await api.post('/payments/verify', {
              razorpay_order_id: result.razorpay_order_id,
              razorpay_payment_id: result.razorpay_payment_id,
              razorpay_signature: result.razorpay_signature,
            })
            setNotice('Payment successful — your Olympiad entry is confirmed.')
            await refresh()
          } catch (err) {
            // The money may well have been taken even though this call failed, so the
            // wording must not tell the student it did not go through.
            setError(
              err instanceof ApiError
                ? `We could not confirm that payment: ${err.message}`
                : 'We could not confirm that payment.',
            )
            await reconcile()
          } finally {
            setBusy(false)
          }
        },

        modal: {
          // Dismissed without paying — usually a genuine cancel, but it is also what a
          // student sees if they paid in another tab or the callback was lost, so we
          // check with the server rather than assuming.
          ondismiss: () => {
            setBusy(false)
            setNotice('Payment window closed. If you completed the payment, give us a moment to confirm it.')
            void reconcile()
          },
        },
      })

      checkout.on('payment.failed', (payload) => {
        setBusy(false)
        setError(payload.error?.description ?? 'That payment did not go through. No money has been taken.')
        void reconcile()
      })

      checkout.open()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StudentShell title="Olympiad entry fee" subtitle="Pay once to enter the national competition">
      <div className={styles.wrap}>
        {!status && !error && <SkeletonCards count={2} label="Checking your payment status" />}
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {status?.hasPaid && (
          <Card className={styles.paid}>
            <span className={styles.paidIcon}>
              <Icon name="ph-seal-check" weight="bold" size="xl" />
            </span>
            <h2 className={styles.paidTitle}>You are entered</h2>
            <p className={styles.paidLead}>
              {status.entryFeeEnabled
                ? 'Your entry fee is paid, so your seat in the official Olympiad is booked. You can sit it when it opens.'
                : 'No entry fee is being charged at the moment, so your place is confirmed.'}
            </p>
            <div className={styles.unlockedLinks}>
              <ButtonLink to="/exam" icon="ph-graduation-cap">
                Go to the Olympiad
              </ButtonLink>
              <ButtonLink to="/practice" variant="secondary" icon="ph-target">
                Keep practising
              </ButtonLink>
            </div>
          </Card>
        )}

        {status && !status.hasPaid && (
          <Card className={styles.payBox}>
            <p className={styles.amountLabel}>Entry fee</p>
            <p className={styles.amount}>{status.amountDisplay}</p>
            <p className={styles.what}>
              A one-off payment for your seat in the national Olympiad.
            </p>
            <ul className={styles.unlocks}>
              <li>
                <Icon name="ph-check" weight="bold" size="sm" />
                <span>Your place in the official Olympiad exam</span>
              </li>
              <li>
                <Icon name="ph-check" weight="bold" size="sm" />
                <span>Your rank against the whole cohort when results are released</span>
              </li>
              <li>
                <Icon name="ph-check" weight="bold" size="sm" />
                <span>Your certificate</span>
              </li>
            </ul>
            <p className={styles.freeNote}>
              Everything you need to prepare is <strong>free</strong> — practice, mock tests, the daily challenge and
              your analytics. You only pay to compete, and you can do it whenever you are ready.
            </p>

            {!status.available ? (
              /**
               * Not a transient outage: it means the Razorpay credentials are absent
               * from the backend environment, and "try again later" is therefore
               * untrue — waiting fixes nothing. Students get an honest apology and a
               * way to reach a human; staff get the actual variable names, because the
               * person most likely to hit this while testing is the person who can fix
               * it, and telling them to wait sends them looking in the wrong place.
               */
              <div className={styles.unavailable}>
                <p className="error-text">Online payment is not set up yet, so nobody can pay right now.</p>
                <p className={styles.unavailableNote}>
                  Nothing is wrong with your account, and you have not been charged. Everything you need to prepare —
                  practice, mock tests and the daily challenge — is free and works as normal. Please check back, or
                  contact us if the Olympiad is close.
                </p>
                {isStaff && (
                  <p className={styles.staffNote}>
                    <strong>Staff:</strong> set <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> in the
                    backend environment and redeploy the backend. See <code>ENVIRONMENT_VARIABLES.md</code>.
                  </p>
                )}
              </div>
            ) : (
              <Button onClick={pay} disabled={busy} fullWidth>
                {busy ? 'Opening payment…' : `Pay ${status.amountDisplay}`}
              </Button>
            )}

            <p className={styles.secure}>
              <Icon name="ph-lock-simple" weight="bold" size="sm" />
              <span>
                Payments are handled by Razorpay. We never see your card details, and every payment is confirmed on
                our server before your entry is granted.
              </span>
            </p>
          </Card>
        )}

        {/*
         * Receipts. Shown whenever there is one, including when the fee has since been
         * switched off — a student who paid keeps their receipt regardless of what the
         * platform charges today.
         */}
        {invoices.length > 0 && (
          <Card className={styles.invoices}>
            <CardHeader
              title="Your receipts"
              size="sm"
              as="h2"
              description="An invoice for every payment we have received from you. The amount shown is what was actually charged at the time, so it does not change if the entry fee changes later."
            />
            <ul className={styles.invoiceList}>
              {invoices.map((invoice) => (
                <li key={invoice.invoiceNumber}>
                  <div className={styles.invoiceRowMain}>
                    <span className={styles.invoiceNumber}>{invoice.invoiceNumber}</span>
                    <span className={styles.invoiceRowMeta}>
                      {new Date(invoice.invoiceDate).toLocaleDateString('en-IN')} · {invoice.totalDisplay}
                      {invoice.payment.method ? ` · ${invoice.payment.method}` : ''}
                    </span>
                  </div>
                  <div className={styles.invoiceRowActions}>
                    <Button size="sm" variant="secondary" icon="ph-eye" onClick={() => setPreviewing(invoice)}>
                      View
                    </Button>
                    {/*
                      A plain anchor, not a fetch: the browser's own download is what
                      makes this work on a phone, and the endpoint is a pure read that
                      creates nothing (see the invoice ADR).
                    */}
                    <a
                      className={styles.invoiceDownload}
                      href={`${API_BASE}/me/invoices/${invoice.payment.id}/download`}
                    >
                      <Icon name="ph-download-simple" weight="bold" size="sm" />
                      <span>PDF</span>
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {previewing && <InvoicePreview invoice={previewing} onClose={() => setPreviewing(null)} />}

        <p className={styles.history}>
          <ButtonLink to="/dashboard" variant="ghost" icon="ph-arrow-left">
            Back to your dashboard
          </ButtonLink>
        </p>
      </div>
    </StudentShell>
  )
}
