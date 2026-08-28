import { AMIT_SHORT } from '../lib/brand'
import styles from './Footer.module.css'

/**
 * The footer, on every public page.
 *
 * It carries the four-letter name and nothing more. The **full form appears once, in the
 * landing page hero, and nowhere else on screen** — the owner's instruction on 2026-08-28,
 * after a revision that also put it here and in an About section was rejected as
 * repetitive. It remains in the page metadata, where it is read by search engines rather
 * than by people.
 */
export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className="container">
        <p>
          © {new Date().getFullYear()} {AMIT_SHORT}. Olympiad. All Rights Reserved.
        </p>
        <p className={styles.contact}>Helpline: +91 9782870716 · support@amitolympiad.com</p>
      </div>
    </footer>
  )
}
