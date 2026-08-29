import styles from './Spinner.module.css'

/**
 * An indeterminate loading indicator.
 *
 * The pre-existing `components/Spinner.tsx` (imported by forty-five files) is now a
 * re-export of this one, so its `{ label }` prop still behaves identically.
 *
 * Prefer a `Skeleton` where the shape of what is coming is known — it is a better
 * experience and it does not reflow the page. A spinner is right for a whole-page load
 * before anything is known, and for `inline` use inside a control.
 *
 * `role="status"` with a real sentence rather than an animated `<div>` alone: a
 * screen reader is otherwise told nothing at all is happening, and the pause is
 * indistinguishable from a page that has finished loading empty.
 */

export interface SpinnerProps {
  /** Shown under the ring, and read out. Defaults to "Loading" for the reader only. */
  label?: string
  size?: 'sm' | 'md' | 'lg'
  /** No padding and no visible label — for use beside text or inside a control. */
  inline?: boolean
  className?: string
}

export default function Spinner({ label, size = 'md', inline, className }: SpinnerProps) {
  if (inline) {
    // No size class: the inline ring is sized in `em` from the surrounding text, so
    // it matches whatever it sits beside — `size` is meaningless here.
    return (
      <span className={[styles.inline, className].filter(Boolean).join(' ')} role="status">
        <span className={styles.ring} />
        <span className="sr-only">{label ?? 'Loading'}</span>
      </span>
    )
  }

  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
    >
      <span className={`${styles.ring} ${styles[size]}`} />
      {label ? <p className={styles.label}>{label}</p> : <span className="sr-only">Loading</span>}
    </div>
  )
}
