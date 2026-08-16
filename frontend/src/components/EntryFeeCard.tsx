import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import type { PaymentStatusResponse } from '../api/types'
import styles from './EntryFeeCard.module.css'

/**
 * The Olympiad entry fee, on the profile page.
 *
 * This exists because **paying later is the normal path, not the exception**. Nothing
 * about preparing requires payment — practice, mock tests, the daily challenge and
 * analytics are all free — so the realistic sequence is that a student uses the site for
 * a while and decides to compete at some point afterwards. When they do, the place they
 * will look is their own account, not a menu item they last saw on the day they signed
 * up.
 *
 * Renders **nothing** once the fee is paid, or when no fee is being charged. A settled
 * matter does not need a card, and a "you're all set" panel on a page somebody visits to
 * change their password is just noise.
 *
 * The price is fetched rather than hardcoded, because an administrator can change it.
 */
export default function EntryFeeCard() {
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
        /* Silent: a missing card is better than an error on somebody's profile. */
      })
    return () => {
      cancelled = true
    }
  }, [signedIn, hasPaid])

  if (!signedIn || hasPaid || !status || !status.entryFeeEnabled) return null

  return (
    <section className={`card ${styles.card}`}>
      <h2>Olympiad entry</h2>
      <p className={styles.body}>
        You have not entered the national Olympiad yet. It is a one-off <strong>{status.amountDisplay}</strong>, and it
        buys your seat in the official exam and the certificate that follows it.
      </p>
      <p className={styles.free}>
        Everything you use to prepare — practice, mock tests, the daily challenge and your analytics — is free and stays
        free whether or not you enter.
      </p>

      {status.available ? (
        <Link to="/payment" className={styles.cta}>
          Pay {status.amountDisplay} and enter
        </Link>
      ) : (
        <p className={styles.unavailable}>
          Online payment is not set up yet, so nobody can enter at the moment. Nothing is wrong with your account.
        </p>
      )}
    </section>
  )
}
