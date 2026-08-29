import { Icon } from './ui'
import { DEVELOPER } from '../lib/brand'
import styles from './DeveloperCredit.module.css'

/**
 * Who built this, and where to find them.
 *
 * The developer's credit, in the two places a credit conventionally lives: the public
 * footer's legal strip, and the foot of the signed-in navigation panel. Not an overlay
 * and not a floating badge — the design direction for this product is "minimal, not
 * visually noisy", and a watermark that sits on top of a child's exam paper is the
 * opposite of that. A line in the footer is where a reader looks for authorship, and it
 * is the placement that survives somebody redesigning the page around it.
 *
 * ## The link
 *
 * It goes to an external site, so it carries `rel="noopener noreferrer"` — `noopener`
 * because a `target="_blank"` link otherwise hands the opened page a live
 * `window.opener` reference back into this one, and `noreferrer` so the destination is
 * not told which page of a children's competition platform the reader came from.
 *
 * The "opens in a new tab" fact is in the accessible name rather than in an icon alone:
 * an arrow glyph is the sort of thing a screen reader either skips or reads as
 * punctuation, and the rule in this product is that no icon is the only carrier of
 * meaning.
 */

export interface DeveloperCreditProps {
  /** `compact` drops the prefix, for the narrow navigation panel. */
  variant?: 'full' | 'compact'
  className?: string
}

export default function DeveloperCredit({ variant = 'full', className }: DeveloperCreditProps) {
  return (
    <p className={[styles.credit, styles[variant], className].filter(Boolean).join(' ')}>
      {variant === 'full' ? 'Designed and developed by ' : 'Built by '}
      <a
        className={styles.link}
        href={DEVELOPER.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${DEVELOPER.name} — portfolio, opens in a new tab`}
      >
        {DEVELOPER.name}
        <Icon name="ph-arrow-up-right" weight="bold" size="xs" className={styles.icon} />
      </a>
    </p>
  )
}
