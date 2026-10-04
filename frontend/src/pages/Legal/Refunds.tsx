import { Link } from 'react-router-dom'
import { SUPPORT, SUPPORT_TEL_HREF } from '../../lib/brand'
import LegalLayout from './LegalLayout'

/**
 * Refund & Cancellation Policy (Milestone 30, Phase 3 — brief §10; Indian payment
 * gateways usually require one).
 *
 * TODO(legal-review): **this page states only what the product does.** Whether the entry
 * fee is refundable, within how long, and how quickly a refund is paid are business
 * decisions about money that the owner has not made — the brief's rule is to ask, not to
 * guess — so none of them is written here. `docs/launch/LEGAL_REVIEW.md` lists the
 * questions; replace the "Refund requests" section with the owner's policy.
 */
export default function Refunds() {
  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      lead="About the Olympiad entry fee — the only payment on this website."
      updated="4 October 2026"
    >
      <h2>1. What you pay for</h2>
      <p>
        Practice, mock tests and the Daily Quiz are free. The only payment is the entry fee for the official Olympiad,
        made through Razorpay. The amount is shown in full before you pay, and a receipt (invoice) is available from{' '}
        <Link to="/payment">your payment page</Link> once the payment has gone through.
      </p>

      <h2>2. If a payment does not go through</h2>
      <p>
        If money leaves your account but your entry does not show as paid, do not pay again. Write to us with your
        student ID and the payment reference from your bank or UPI app, and we will look into it.
      </p>

      <h2>3. If you paid twice</h2>
      <p>
        One entry fee is all any student needs. If you were charged more than once for the same entry, contact us with
        both payment references.
      </p>

      <h2>4. Refund requests</h2>
      <p>
        To ask about a refund, write to <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a> or call{' '}
        <a href={SUPPORT_TEL_HREF}>{SUPPORT.phone}</a> with your student ID and payment reference. We review every
        request.
      </p>

      <h2>5. Cancellation</h2>
      <p>
        If the organisers have to cancel or move an Olympiad sitting, every student who paid will be told by email, with
        what happens to their entry fee.
      </p>
    </LegalLayout>
  )
}
