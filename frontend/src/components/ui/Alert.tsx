import type { ReactNode } from 'react'
import Icon from './Icon'
import styles from './Alert.module.css'

/**
 * An inline message attached to the thing it is about — a form that failed, a page
 * with a caveat, a destructive area with a warning.
 *
 * It replaces the sixteen separately-declared `.notice` classes, and it is
 * deliberately **not** the toast: a toast is transient and interruptive, an alert
 * stays on the page and is part of it. If the message must survive being read, it is
 * an alert.
 *
 * ## The live-region decision
 *
 * `role` is chosen from the tone by default, and the distinction is not cosmetic.
 * `role="alert"` is an assertive live region: a screen reader interrupts whatever it
 * is saying to read it. That is right for "your answer was not saved" appearing after
 * a click, and wrong for a static caveat that is simply part of the page — on mount it
 * would talk over the page's own heading. So: danger and warning are assertive,
 * information and success are polite, and `live={false}` opts out entirely for
 * decorative or long-lived copy.
 */

export type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const DEFAULT_ICON: Record<AlertTone, string> = {
  info: 'ph-info',
  success: 'ph-check-circle',
  warning: 'ph-warning',
  danger: 'ph-warning-circle',
  neutral: 'ph-info',
}

export interface AlertProps {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  /** Override the tone's glyph, or pass `false` for no icon. */
  icon?: string | false
  /** Buttons or links — a retry, a "go to payment", a "how to fix this". */
  actions?: ReactNode
  onDismiss?: () => void
  /** `true`/`false` force the live-region behaviour; omit to derive it from `tone`. */
  live?: boolean
  className?: string
}

export default function Alert({
  tone = 'info',
  title,
  children,
  icon,
  actions,
  onDismiss,
  live,
  className,
}: AlertProps) {
  const assertive = tone === 'danger' || tone === 'warning'
  const isLive = live ?? true
  const glyph = icon === false ? null : icon || DEFAULT_ICON[tone]

  return (
    <div
      className={[styles.alert, styles[tone], className].filter(Boolean).join(' ')}
      role={isLive ? (assertive ? 'alert' : 'status') : undefined}
      aria-live={isLive ? (assertive ? 'assertive' : 'polite') : undefined}
    >
      {glyph && <Icon name={glyph} weight="bold" size="md" className={styles.icon} />}
      <div className={styles.content}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div className={styles.body}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {onDismiss && (
        <button type="button" className={styles.close} onClick={onDismiss} aria-label="Dismiss message">
          <Icon name="ph-x" weight="bold" size="sm" />
        </button>
      )}
    </div>
  )
}
