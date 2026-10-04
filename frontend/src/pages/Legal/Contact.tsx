import { Mail, Phone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AMIT_OLYMPIAD, SUPPORT, SUPPORT_TEL_HREF } from '../../lib/brand'
import LegalLayout from './LegalLayout'
import styles from './Contact.module.css'

/**
 * Contact us (Milestone 30, Phase 3 — brief §7.1 #12 and §10).
 *
 * The phone number and address are the owner's (2026-10-04, `lib/brand.ts`). No postal
 * address is shown: none has been supplied, and a placeholder would be a made-up one.
 * TODO(legal-review): add the organiser's registered address if the owner provides it.
 */
export default function Contact() {
  return (
    <LegalLayout title="Contact us" lead={`How to reach the ${AMIT_OLYMPIAD} team.`} updated="4 October 2026">
      <ul className={styles.ways}>
        <li>
          <a href={`mailto:${SUPPORT.email}`} className={styles.way}>
            <Mail aria-hidden="true" />
            <span>
              <span className={styles.kind}>Email</span>
              <span className={styles.value}>{SUPPORT.email}</span>
            </span>
          </a>
        </li>
        <li>
          <a href={SUPPORT_TEL_HREF} className={styles.way}>
            <Phone aria-hidden="true" />
            <span>
              <span className={styles.kind}>Phone</span>
              <span className={styles.value}>{SUPPORT.phone}</span>
            </span>
          </a>
        </li>
      </ul>

      <h2>Before you write</h2>
      <ul>
        <li>Include your student ID — it is on your dashboard and in your registration email.</li>
        <li>
          About a payment: add the payment reference from your bank or UPI app. See{' '}
          <Link to="/refunds">Refund &amp; Cancellation</Link>.
        </li>
        <li>
          About a Daily Quiz prize: see the <Link to="/rewards/rules">Daily Quiz &amp; Rewards Rules</Link>.
        </li>
        <li>
          Typed the wrong email address when you registered? It cannot be changed from the website, so write to us and we
          will correct it.
        </li>
      </ul>
    </LegalLayout>
  )
}
