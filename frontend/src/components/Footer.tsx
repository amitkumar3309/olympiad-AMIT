import { Link } from 'react-router-dom'
import DeveloperCredit from './DeveloperCredit'
import { Icon } from './ui'
import { AMIT_SHORT, SUPPORT } from '../lib/brand'
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

// Moved to `lib/brand.ts` in Milestone 25 Phase C: the verification screens need the
// same address, and a second copy of "how to reach us" is a second thing to keep right.
const HELPLINE = SUPPORT.phone
const SUPPORT_EMAIL = SUPPORT.email

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
          <Link to="/register">Register</Link>
          {/*
            **There is no Administrator link here, and there must not be one.**

            Phase B moved it out of the public *header* into this footer, reasoning that
            it was then one click from every page without the header advertising it. The
            footer is still the public UI on every page, so that only made it quieter,
            not absent — and Milestone 28's rule is that there is exactly **one** sign-in
            entry point for everybody. Staff use the same "Sign in" above; the server
            returns their role and `roleHome()` sends them to `/admin`.

            Two reasons it stays gone. It advertises where the admin door is on the most
            public surface in the product; and it tells a *promoted* admin — an ordinary
            student account carrying a role — that there is a separate door they should
            be using, when there is not.
          */}
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
