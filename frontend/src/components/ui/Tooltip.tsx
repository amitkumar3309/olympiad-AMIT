import { useId, useState, type ReactNode } from 'react'
import styles from './Tooltip.module.css'

/**
 * A supplementary hint.
 *
 * ## What may go in one
 *
 * Only something the reader could do without. A tooltip is unreachable on a touch
 * screen without a deliberate tap, invisible in print, and gone the moment the pointer
 * moves — so anything *required* to understand a control belongs in a `Field` hint, a
 * label, or the copy itself. The rule from the brief is exact: no hover-only
 * information.
 *
 * Good: "XP is the sum of every activity you have been awarded for."
 * Not this: the only place a column's units are stated.
 *
 * ## How it behaves
 *
 * Shows on hover **and on keyboard focus** — a tooltip that only responds to a pointer
 * does not exist for a keyboard user. Escape dismisses it while the trigger keeps
 * focus, which is what the ARIA practice specifies and what stops a tooltip covering
 * the thing you are about to press.
 *
 * The hint is wired with `aria-describedby`, so it is read as a description of the
 * trigger rather than as a stray paragraph.
 */

export interface TooltipProps {
  /** The hint. Plain text — a tooltip is not a place for controls. */
  content: ReactNode
  /** The element the hint describes. Must be focusable for this to work by keyboard. */
  children: ReactNode
  placement?: 'top' | 'bottom'
  className?: string
}

export default function Tooltip({ content, children, placement = 'top', className }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)

  return (
    <span
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // `focus`/`blur` rather than the mouse pair only: this is the half that makes
      // the hint reachable without a pointer. They bubble from the trigger inside.
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // Dismiss without moving focus — the reader is still on the control.
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <span className={styles.trigger} aria-describedby={open ? id : undefined}>
        {children}
      </span>
      {open && (
        <span role="tooltip" id={id} className={`${styles.bubble} ${styles[placement]}`}>
          {content}
        </span>
      )}
    </span>
  )
}
