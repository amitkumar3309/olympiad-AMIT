import styles from './Progress.module.css'

/**
 * A progress bar — for progress that is genuinely known.
 *
 * ## The honesty rule
 *
 * `value` is required for the determinate bar, and it must be a real count of real
 * work: questions answered out of questions served, rows validated out of rows in the
 * file, marks scored out of marks available. **No invented percentages.** A bar that
 * eases to 90% and waits there is a fiction, and once a reader has seen one they stop
 * believing the next.
 *
 * When the duration is unknown — an upload being parsed, a model being called — use
 * `indeterminate`, which says "working" and claims nothing about how far through it
 * is. That is the correct control for almost every request this product makes.
 *
 * ## Accessibility
 *
 * A real `role="progressbar"` with `aria-valuenow/min/max`, plus a text label. The
 * indeterminate bar deliberately omits `aria-valuenow`, which is how the ARIA spec
 * says "the value is unknown" — an assistive technology then announces it as busy
 * rather than reading out a number nobody computed.
 */

interface BaseProps {
  /** Visible label above the bar. */
  label?: string
  /** Accessible name when there is no visible label. One of the two is required. */
  'aria-label'?: string
  size?: 'sm' | 'md'
  tone?: 'primary' | 'success' | 'warning' | 'danger'
  className?: string
}

export type ProgressProps = BaseProps &
  (
    | {
        indeterminate: true
        value?: never
        max?: never
        valueText?: never
      }
    | {
        indeterminate?: false
        value: number
        max?: number
        /** What to print on the right — "12 of 20 answered". Falls back to a percentage. */
        valueText?: string
      }
  )

export default function Progress(props: ProgressProps) {
  const { label, size = 'md', tone = 'primary', className } = props
  const ariaLabel = props['aria-label'] ?? label

  if (props.indeterminate) {
    return (
      <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
        {label && (
          <div className={styles.head}>
            <span className={styles.label}>{label}</span>
          </div>
        )}
        <div
          className={[styles.track, styles[size], styles[tone]].join(' ')}
          role="progressbar"
          aria-label={ariaLabel}
          // No `aria-valuenow`: the value is genuinely unknown, and the spec's way of
          // saying so is to leave it out.
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={styles.indeterminate} />
        </div>
      </div>
    )
  }

  const max = props.max ?? 100
  const clamped = Math.max(0, Math.min(props.value, max))
  const percent = max === 0 ? 0 : Math.round((clamped / max) * 100)

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      {(label || props.valueText) && (
        <div className={styles.head}>
          {label && <span className={styles.label}>{label}</span>}
          <span className={styles.value}>{props.valueText ?? `${percent}%`}</span>
        </div>
      )}
      <div
        className={[styles.track, styles[size], styles[tone]].join(' ')}
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuetext={props.valueText}
      >
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
