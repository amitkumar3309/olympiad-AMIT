import type { ReactElement, ReactNode } from 'react'
import Icon from './Icon'
import styles from './StatTile.module.css'

/**
 * One counted figure.
 *
 * Replaces the original `components/StatTile.tsx` (which re-exports this) and the
 * several private `.total` / `.totalValue` / `.tile` blocks that had grown across the
 * admin pages — the payments console, the referral console and the rewards overview
 * each had their own.
 *
 * ## `null` is not zero
 *
 * `value` accepts `null`, and it renders an em dash rather than a `0`. This is the
 * product's oldest data rule, and it holds on the frontend too: "nothing has been sat"
 * and "everybody scored zero" are different facts about a child, and the backend
 * returns `null` for the first precisely so a screen cannot claim the second. Pass the
 * API's `null` straight through.
 */

export interface StatTileProps {
  /** Phosphor glyph name, with or without the `ph-` prefix. */
  /**
   * A Phosphor glyph name, or an already rendered element — the landing page passes
   * a Lucide icon (Milestone 28; see the ADR). A string is the normal case and this
   * component sizes it; an element is passed through, so the caller owns its size.
   */
  icon: string | ReactElement
  /** `null` for "no data", which is rendered as an em dash and never as zero. */
  value: ReactNode | null
  label: string
  /** A short qualifier under the figure — "this week", "programme total". */
  hint?: ReactNode
  tone?: 'primary' | 'neutral' | 'success' | 'warning' | 'danger'
  className?: string
}

export default function StatTile({
  icon,
  value,
  label,
  hint,
  tone = 'primary',
  className,
}: StatTileProps) {
  return (
    <div className={[styles.tile, className].filter(Boolean).join(' ')}>
      <span className={`${styles.iconWrap} ${styles[tone]}`}>
        {typeof icon === 'string' ? <Icon name={icon} weight="bold" size="md" /> : icon}
      </span>
      <div className={styles.text}>
        <p className={styles.label}>{label}</p>
        <p className={styles.value}>
          {value === null || value === undefined ? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">No data</span>
            </>
          ) : (
            value
          )}
        </p>
        {hint && <p className={styles.hint}>{hint}</p>}
      </div>
    </div>
  )
}
