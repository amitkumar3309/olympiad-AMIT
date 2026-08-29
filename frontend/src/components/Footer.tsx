import { Link } from 'react-router-dom'
import DeveloperCredit from './DeveloperCredit'
import { Icon } from './ui'
import { AMIT_SHORT } from '../lib/brand'
import styles from './Footer.module.css'

/**
 * The footer, on every public page.
 *
 * It carries the four-letter name and nothing more. The **full form appears once, in
 * the landing page hero, and nowhere else on screen** — the owner's instruction on
 * 2026-08-28, after a revision that also put it here and in an About section was
 * rejected as repetitive. It remains in the page metadata, where it is read by search
 * engines rather than by people.
 *
 * Milestone 23 Phase B gave it the job of holding what the header stopped holding: the
 * result and certificate lookups, and the administrator's door. They are utilities —
 * things a visitor comes looking for, rather than places to browse — and a footer is
 * where a utility is conventionally found. Nothing became unreachable; the header
 * simply stopped giving eight destinations equal weight.
 *
 * The helpline and support address are real and are now actual `tel:` and `mailto:`
 * links, which on a phone is the difference between a number and a phone call.
 */

const HELPLINE = '+91 9782870716'
const SUPPORT_EMAIL = 'support@amitolympiad.com'

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.brandCol}>
          <p className={styles.brand}>{AMIT_SHORT} Olympiad</p>
          <p className={styles.tagline}>
            A national mathematics olympiad for Class 3 to Class 12, open to every school board.
            Practice, mock tests and the daily challenge are free.
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
          <Link to="/certificate">Certificate</Link>
          <Link to="/verify">Verify a certificate</Link>
        </nav>

        <nav className={styles.col} aria-label="Account">
          <h2 className={styles.colTitle}>Account</h2>
          <Link to="/#login">Sign in</Link>
          <Link to="/#register">Register</Link>
          {/* Moved out of the public header in Phase B: still one click from every
              page, without a marketing site advertising its own admin door. */}
          <Link to="/admin">Administrator</Link>
        </nav>

        <div className={styles.col}>
          <h2 className={styles.colTitle}>Help</h2>
          <a href={`tel:${HELPLINE.replace(/\s/g, '')}`} className={styles.contact}>
            <Icon name="ph-phone" size="sm" />
            <span>{HELPLINE}</span>
          </a>
          <a href={`mailto:${SUPPORT_EMAIL}`} className={styles.contact}>
            <Icon name="ph-envelope-simple" size="sm" />
            <span>{SUPPORT_EMAIL}</span>
          </a>
        </div>
      </div>

      <div className={`container ${styles.legal}`}>
        <p>
          © {new Date().getFullYear()} {AMIT_SHORT}. Olympiad. All Rights Reserved.
        </p>
        <DeveloperCredit />
      </div>
    </footer>
  )
}
