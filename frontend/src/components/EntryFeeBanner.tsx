import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import type { PaymentStatusResponse } from '../api/types'
import styles from './EntryFeeBanner.module.css'

/**
 * The dashboard's "you have not entered yet" strip.
 *
 * Renders **nothing at all** for a student who has paid, or when no fee is being
 * charged — a banner that says "you're fine" is noise on a page somebody visits daily.
 *
 * ## Why it fetches
 *
 * `hasPaid` from the session decides *whether* to show it, and that is enough to gate
 * on. But the strip has to name a price, and the price is administrator-editable, so
 * hardcoding "₹100" here would be a second source of truth that goes stale the first
 * time it changes. It asks, and stays quiet if the request fails: an unreachable
 * payments endpoint should not put an error on somebody's dashboard.
 */
export default function EntryFeeBanner() {
  const { hasPaid, state } = useAuth()
  const [status, setStatus] = useState<PaymentStatusResponse | null>(null)

  const signedIn = state.status === 'student' || state.status === 'admin'

  useEffect(() => {
    if (!signedIn || hasPaid) return
    let cancelled = false
    api
      .get<PaymentStatusResponse>('/payments/status')
      .then((res) => {
        if (!cancelled) setStatus(res)
      })
      .catch(() => {
        /* Silent: the banner simply does not appear rather than shouting. */
      })
    return () => {
      cancelled = true
    }
  }, [signedIn, hasPaid])

  // `hasPaid` already covers "the fee is switched off" — the server reports an
  // unentitled student as entitled in that case, so there is nothing to sell.
  if (!signedIn || hasPaid || !status || !status.entryFeeEnabled) return null

  return (
    <section className={`card ${styles.banner}`}>
      <div className={styles.left}>
        <i className={`ph-bold ph-trophy ${styles.icon}`} />
        <div>
          <h3 className={styles.title}>Enter the Olympiad to unlock everything</h3>
          <p className={styles.body}>
            One payment of <strong>{status.amountDisplay}</strong> opens practice, mock tests, the daily challenge and
            your seat at the national competition.
          </p>
        </div>
      </div>

      {status.available ? (
        <Link to="/payment" className={styles.cta}>
          Pay {status.amountDisplay}
        </Link>
      ) : (
        // The credentials are missing. Saying so plainly beats a button that 503s.
        <span className={styles.unavailable}>Payment is temporarily unavailable</span>
      )}
    </section>
  )
}
