import type { ReactNode } from 'react'
import Icon from './Icon'
import styles from './EmptyState.module.css'

/**
 * Nothing here — said usefully.
 *
 * An empty state has to answer three questions, and the props are shaped so that two
 * of them cannot be skipped:
 *
 *  1. **What is empty?** — `title`. "No mock tests yet".
 *  2. **Why might it be empty?** — `description`. This is the one that is always
 *     left out, and it is the one that decides whether the reader thinks the product
 *     is broken. "Your teacher has not published one for Class 8 yet" and "No mock
 *     test matches these filters" are the same empty table and completely different
 *     situations.
 *  3. **What can I do next?** — `action`. Optional, because sometimes the honest
 *     answer is "wait", and a button that does nothing useful is worse than none.
 *
 * A modern icon, never an emoji, and `aria-hidden` — the title already says it.
 */

export interface EmptyStateProps {
  /** Phosphor glyph. Something specific to what is missing, not a generic tray. */
  icon?: string
  title: ReactNode
  description: ReactNode
  action?: ReactNode
  /** A second, quieter action — "clear filters" beside "create one". */
  secondaryAction?: ReactNode
  size?: 'sm' | 'md'
  className?: string
}

export default function EmptyState({
  icon = 'ph-tray',
  title,
  description,
  action,
  secondaryAction,
  size = 'md',
  className,
}: EmptyStateProps) {
  return (
    <div className={[styles.empty, styles[size], className].filter(Boolean).join(' ')}>
      <span className={styles.iconWrap}>
        <Icon name={icon} size={size === 'sm' ? 'lg' : 'xl'} />
      </span>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      {(action || secondaryAction) && (
        <div className={styles.actions}>
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
