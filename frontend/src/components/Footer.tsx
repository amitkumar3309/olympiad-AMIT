import { Link } from 'react-router-dom'
import DeveloperCredit from './DeveloperCredit'
import { Icon } from './ui'
import logoMark from '../assets/logo-mark.webp'
import { AMIT_OLYMPIAD, AMIT_TAGLINE, SUPPORT, SUPPORT_TEL_HREF } from '../lib/brand'
import styles from './Footer.module.css'

/**
 * The footer, on every public page (Legal column added in Milestone 30, Phase 3 — brief
 * §7.1 #12).
 *
 * It carries the name and the tagline and nothing more. The **full form appears once, in
 * the landing page hero, and nowhere else on screen** — the owner's instruction on
 * 2026-08-28, after a revision that also put it here was rejected as repetitive.
 *
 * It holds what the header does not: the result and certificate lookups, Hall of Fame,
 * the help line and — new — the Legal column. Every link goes to a page that exists; the
 * brief's rule is that a footer link to a page not yet built is hidden, not dead.
 *
 * The helpline and support address are real `tel:` and `mailto:` links, owner-confirmed
 * on 2026-10-04 (`lib/brand.ts`); on a phone that is the difference between a number and
 * a phone call.
 */

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.brandCol}>
          <Link to="/" className={styles.brandLink}>
            <img src={logoMark} alt="" aria-hidden="true" className={styles.mark} width={44} height={44} />
            <span className={styles.brandText}>
              <span className={styles.brand}>{AMIT_OLYMPIAD}</span>
              <span className={styles.brandTagline}>{AMIT_TAGLINE}</span>
            </span>
          </Link>
          <p className={styles.tagline}>
            A national mathematics olympiad for Class 3 to Class 12, open to every school board. Practice, mock tests
            and the Daily Quiz are free.
          </p>
        </div>

        <nav className={styles.col} aria-label="Explore">
          <h2 className={styles.colTitle}>Explore</h2>
          <Link to="/leaderboard">Leaderboard</Link>
          <Link to="/hall-of-fame">Hall of Fame</Link>
          <Link to="/gallery">Event gallery</Link>
        </nav>

        <nav className={styles.col} aria-label="Results and certificates">
          <h2 className={styles.colTitle}>Results</h2>
          <Link to="/result">Check a result</Link>
          <Link to="/my-certificates">Certificates</Link>
          <Link to="/verify">Verify a certificate</Link>
        </nav>

        <nav className={styles.col} aria-label="Account">
          <h2 className={styles.colTitle}>Account</h2>
          <Link to="/#login">Sign in</Link>
          <Link to="/register">Register</Link>
          {/*
            **There is no Administrator link here, and there must not be one** (Milestone
            28): exactly one sign-in entry point for everybody; staff use "Sign in" and the
            server's role sends them to `/admin`. A footer is on every public page, so an
            admin link here would advertise the door on the most public surface there is.
          */}
        </nav>

        <nav className={styles.col} aria-label="Legal">
          <h2 className={styles.colTitle}>Legal</h2>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Use</Link>
          <Link to="/rewards/rules">Daily Quiz &amp; Rewards Rules</Link>
          <Link to="/refunds">Refund &amp; Cancellation</Link>
          <Link to="/contact">Contact us</Link>
        </nav>

        <div className={styles.col}>
          <h2 className={styles.colTitle}>Help</h2>
          <a href={SUPPORT_TEL_HREF} className={styles.contact}>
            <Icon name="ph-phone" size="sm" />
            <span>{SUPPORT.phone}</span>
          </a>
          <a href={`mailto:${SUPPORT.email}`} className={styles.contact}>
            <Icon name="ph-envelope-simple" size="sm" />
            <span>{SUPPORT.email}</span>
          </a>
        </div>
      </div>

      <div className={`container ${styles.legal}`}>
        <p>
          © {new Date().getFullYear()} {AMIT_OLYMPIAD}. All rights reserved.
        </p>
        <DeveloperCredit />
      </div>
    </footer>
  )
}
