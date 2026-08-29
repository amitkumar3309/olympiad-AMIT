import type { ReactNode } from 'react'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import { Icon } from '../../components/ui'
import styles from './AuthLayout.module.css'

/**
 * The frame for the four standalone authentication pages — forgot password, reset
 * password, verify email, and the resend form inside it.
 *
 * They are the pages a student reaches from an email, usually on a phone, usually
 * once, often anxious about being locked out. So the layout is deliberately narrow and
 * single-purpose: one card, one heading, one thing to do. What it replaces is the same
 * shape written three times with a `text-align: center` that also centred the form
 * labels.
 *
 * Sign-in and registration are **not** here — they live on the landing page, which is
 * a marketing surface with a form in it rather than a form with a page around it.
 */

export interface AuthLayoutProps {
  title: string
  /** One sentence under the heading, in the reader's terms. */
  lead?: ReactNode
  children: ReactNode
}

export default function AuthLayout({ title, lead, children }: AuthLayoutProps) {
  return (
    <div className={styles.page}>
      <Navbar />
      <main id="main-content" className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.title}>{title}</h1>
          {lead && <p className={styles.lead}>{lead}</p>}
          {children}
        </div>
      </main>
      <Footer />
    </div>
  )
}

export interface AuthStatusProps {
  tone: 'success' | 'warning' | 'danger'
  title: string
  description: ReactNode
  /** Buttons. The primary one first — this is not a dialog, so nothing reverses them. */
  actions?: ReactNode
  children?: ReactNode
}

/**
 * The outcome of an authentication step: verified, reset, expired, refused.
 *
 * The icon is a Phosphor glyph rather than the emoji these screens used, and it is
 * `aria-hidden` — the heading already says what happened, and a screen reader reading
 * "white heavy check mark" before it does not help. The tone is carried by the icon
 * *and* the words, never by colour alone.
 */
export function AuthStatus({ tone, title, description, actions, children }: AuthStatusProps) {
  const glyph = tone === 'success' ? 'ph-check-circle' : tone === 'warning' ? 'ph-warning' : 'ph-warning-circle'

  return (
    <div className={styles.status}>
      <span className={`${styles.statusIcon} ${styles[tone]}`}>
        <Icon name={glyph} weight="bold" size="lg" />
      </span>
      <h2 className={styles.statusTitle}>{title}</h2>
      <div className={styles.statusBody}>{description}</div>
      {actions && <div className={styles.statusActions}>{actions}</div>}
      {children}
    </div>
  )
}
