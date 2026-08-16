import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { api, ApiError } from '../../api/client'
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

export default function Payment() {
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const next = await api.get<PaymentStatus>('/payments/status')
    setStatus(next)
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
        {!status && !error && <Spinner label="Checking your payment status..." />}
        {error && <p className="error-text">{error}</p>}
        {notice && <p className={styles.notice}>{notice}</p>}

        {status?.hasPaid && (
          <div className={`card ${styles.paid}`}>
            <i className="ph-bold ph-seal-check" />
            <h3>You are entered</h3>
            <p>
              {status.entryFeeEnabled
                ? 'Your entry fee is paid. You can sit the official Olympiad when it opens.'
                : 'No entry fee is being charged at the moment, so your place is confirmed.'}
            </p>
            <Link to="/exam">Go to the exam →</Link>
          </div>
        )}

        {status && !status.hasPaid && (
          <div className={`card ${styles.payBox}`}>
            <p className={styles.amountLabel}>Entry fee</p>
            <p className={styles.amount}>{status.amountDisplay}</p>
            <p className={styles.what}>
              A one-off payment that enters you into the official Olympiad. Practice, mock tests, the daily challenge and
              your analytics are free and stay free — this is only for the competition itself.
            </p>

            {!status.available ? (
              <p className="error-text">Online payment is not available right now. Please try again later.</p>
            ) : (
              <Button onClick={pay} disabled={busy} fullWidth>
                {busy ? 'Opening payment…' : `Pay ${status.amountDisplay}`}
              </Button>
            )}

            <p className={styles.secure}>
              <i className="ph-bold ph-lock-simple" /> Payments are handled by Razorpay. We never see your card details,
              and every payment is confirmed on our server before your entry is granted.
            </p>
          </div>
        )}

        <p className={styles.history}>
          <Link to="/dashboard">← Back to your dashboard</Link>
        </p>
      </div>
    </StudentShell>
  )
}
