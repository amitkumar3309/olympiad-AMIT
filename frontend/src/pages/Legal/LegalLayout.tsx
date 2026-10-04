import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import { SUPPORT, SUPPORT_TEL_HREF } from '../../lib/brand'
import styles from './Legal.module.css'

/**
 * The frame every legal page shares (Milestone 30, Phase 3 — brief §7.5 and §10).
 *
 * TODO(legal-review): every page in this folder is a **draft** written from what the
 * product actually does, and must be reviewed by the owner (and ideally a lawyer) before
 * launch — see `docs/launch/LEGAL_REVIEW.md` for the open questions on each. The drafts
 * deliberately make no promise the code does not keep and invent no business terms (a
 * refund window, a registered address, a governing law): where one is needed, the page
 * says to contact us.
 */

export interface LegalLayoutProps {
  title: string
  /** One line under the title. */
  lead?: ReactNode
  /** "4 October 2026" — when the text last changed. */
  updated: string
  children: ReactNode
}

const LEGAL_LINKS = [
  { to: '/rewards/rules', label: 'Daily Quiz & Rewards Rules' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/terms', label: 'Terms of Use' },
  { to: '/refunds', label: 'Refund & Cancellation' },
  { to: '/contact', label: 'Contact us' },
] as const

export default function LegalLayout({ title, lead, updated, children }: LegalLayoutProps) {
  return (
    <div className={styles.page}>
      <Navbar />
      <main id="main-content" className={`container ${styles.wrap}`}>
        <article className={styles.article}>
          <header className={styles.header}>
            <h1 className={styles.title}>{title}</h1>
            {lead && <p className={styles.lead}>{lead}</p>}
            <p className={styles.updated}>Last updated {updated}</p>
          </header>
          <div className={styles.body}>{children}</div>
          <aside className={styles.help} aria-label="Questions about this page">
            <p>
              Questions? Email <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a> or call{' '}
              <a href={SUPPORT_TEL_HREF}>{SUPPORT.phone}</a>.
            </p>
          </aside>
        </article>
        <nav className={styles.related} aria-label="Policies">
          <h2 className={styles.relatedTitle}>Policies</h2>
          <ul>
            {LEGAL_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <Footer />
    </div>
  )
}
