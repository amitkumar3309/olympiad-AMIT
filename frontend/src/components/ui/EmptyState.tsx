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
  /**
   * The heading level for `title`.
   *
   * Defaults to `h3`, which is right inside a card that already sits under a section
   * heading. When this state IS the page — a whole route that failed or has nothing in
   * it yet — pass `'h2'`, or the document skips from the page's `h1` straight to an
   * `h3`. The Phase G audit found that on three routes.
   *
   * `'h1'` is for the case where the state is the *entire* page and there is no page
   * heading above it at all: the 404. A document with no `h1` has no top level, which
   * is what that audit found there.
   */
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4'
  /** A second, quieter action — "clear filters" beside "create one". */
  secondaryAction?: ReactNode
  size?: 'sm' | 'md'
  className?: string
}

export default function EmptyState({
  icon = 'ph-tray',
  title,
  titleAs: TitleTag = 'h3',
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
      <TitleTag className={styles.title}>{title}</TitleTag>
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
