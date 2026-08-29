import type { ReactNode } from 'react'
import Icon from './Icon'
import styles from './Badge.module.css'

/**
 * A status badge.
 *
 * There were fifty-two separately-declared `.status` classes across the CSS modules
 * before this milestone, plus `.pill`, `.chip`, `.tag`, `.levelBadge` and a dozen
 * one-off variants. They mostly agreed, which is worse than disagreeing: nobody could
 * tell whether a difference was a decision.
 *
 * ## The accessibility rule this component enforces
 *
 * **A badge always carries words.** `children` is required, so a payment state can
 * never be rendered as a bare coloured dot — colour is not information for a
 * colour-blind reader, a monochrome print of an invoice, or a screen reader. The
 * `icon` prop adds a third, redundant channel, which is what the guidance means by
 * "not colour alone".
 *
 * `tone` is the meaning, `variant` is the weight. Soft is the default because a table
 * of thirty solid badges is a table nobody can read.
 */

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent'

export interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  variant?: 'soft' | 'solid' | 'outline'
  size?: 'sm' | 'md'
  /** Phosphor glyph name, drawn before the label and hidden from screen readers —
      the label already says it. */
  icon?: string
  /** A leading dot, for a live/scheduled/closed style state. */
  dot?: boolean
  /** Uppercase micro-label treatment, for a dense table column. */
  uppercase?: boolean
  className?: string
  title?: string
}

export default function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  icon,
  dot,
  uppercase,
  className,
  title,
}: BadgeProps) {
  const classes = [
    styles.badge,
    styles[tone],
    styles[variant],
    styles[size],
    uppercase ? styles.uppercase : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={classes} title={title}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {icon && <Icon name={icon} weight="bold" size={size === 'sm' ? 'xs' : 'sm'} />}
      {children}
    </span>
  )
}
