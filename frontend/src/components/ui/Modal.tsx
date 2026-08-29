import { useCallback, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { lockScroll, unlockScroll } from './scrollLock'
import styles from './Modal.module.css'

/**
 * A modal dialog — and on a phone, a bottom sheet.
 *
 * The product had eight independently-built `.modal` implementations before this
 * milestone. None of them trapped focus, none restored it on close, and several could
 * grow taller than the viewport with their buttons off the bottom of the screen,
 * which on a phone is an unresolvable dialog.
 *
 * ## Focus management, which is the whole point
 *
 * Four things have to happen, and all four are easy to omit:
 *
 *  1. **Focus moves in.** On open, focus goes to `initialFocus` if given, otherwise to
 *     the dialog itself — deliberately *not* to the first button, which for a
 *     destructive confirmation would put focus on "Delete".
 *  2. **Focus cannot leave.** Tab and Shift-Tab cycle within the dialog. Without this
 *     a keyboard user tabs into the page behind, which is still rendered, and has no
 *     way of knowing where they are.
 *  3. **Focus comes back.** On close it returns to the element that opened the dialog,
 *     so a keyboard or screen-reader user resumes where they were rather than at the
 *     top of the document.
 *  4. **The page behind is inert to scroll.** Body scroll is locked, with the
 *     scrollbar's width added as padding so the page does not jump sideways as it
 *     disappears.
 *
 * ## `dismissible`
 *
 * Default `true`: Escape and a backdrop press close the dialog. Pass `false` for a
 * dialog whose whole purpose is a deliberate decision — the typed-phrase content
 * reset, an exam submission — where an accidental tap outside must not count as an
 * answer. That is why the mobile sheet has no drag-to-dismiss either.
 */

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** A line under the title. Wired to `aria-describedby`, so it is announced with it. */
  description?: ReactNode
  children?: ReactNode
  /** Actions. Put the primary last on desktop — the CSS reverses the mobile order so
      the primary sits on top, where a thumb reaches it first. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Tints the header glyph. `danger` for anything that destroys data. */
  tone?: 'default' | 'danger'
  icon?: string
  dismissible?: boolean
  initialFocus?: RefObject<HTMLElement | null>
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  tone = 'default',
  icon,
  dismissible = true,
  initialFocus,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)
  const base = useId()
  const titleId = `${base}-title`
  const descId = `${base}-desc`

  const requestClose = useCallback(() => {
    if (dismissible) onClose()
  }, [dismissible, onClose])

  /* Scroll lock — counted in `ui/scrollLock.ts`, which the navigation drawer shares,
     so whichever closes first cannot release the other's lock. */
  useEffect(() => {
    if (!open) return
    lockScroll()
    return unlockScroll
  }, [open])

  /* Focus in on open, and back out on close. */
  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    /*
      Focused synchronously, not inside `requestAnimationFrame`.

      The ref is attached before this effect runs, so the node exists and is focusable
      (it carries `tabIndex={-1}` from the same commit) — the frame buys nothing. It
      costs something, though: `requestAnimationFrame` never fires while a tab is not
      compositing, so the version of this that waited a frame left focus on the page
      behind whenever the dialog opened in a background or hidden tab, and could not be
      verified in one either. Synchronous works in both.
    */
    const target = initialFocus?.current ?? dialogRef.current
    target?.focus()

    return () => {
      restoreTo.current?.focus()
    }
  }, [open, initialFocus])

  /* Escape, and the Tab cycle. */
  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return

      const root = dialogRef.current
      if (!root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (items.length === 0) {
        // Nothing focusable inside: keep focus on the dialog rather than letting it
        // escape to the page behind.
        event.preventDefault()
        root.focus()
        return
      }

      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement

      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, requestClose])

  if (!open) return null

  return createPortal(
    <div className={styles.overlay}>
      {/*
        The backdrop is its own element rather than a click handler on the overlay: a
        handler on the overlay fires for any click that bubbles out of the dialog (a
        select's option list, a drag that ends outside), which closed dialogs people
        were still using.

        A `div`, and `aria-hidden`, because it is a pointer convenience that duplicates
        the header's close button — a keyboard user has Escape and that button, so an
        extra focus stop here would be one more thing to tab past with no new
        capability behind it.
      */}
      <div className={styles.backdrop} onClick={requestClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={[styles.dialog, styles[size]].filter(Boolean).join(' ')}
      >
        <header className={styles.header}>
          {icon && (
            <span className={[styles.iconWrap, tone === 'danger' ? styles.iconDanger : ''].join(' ')}>
              <Icon name={icon} weight="bold" size="md" />
            </span>
          )}
          <div className={styles.headerText}>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {description && (
              <p className={styles.description} id={descId}>
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close dialog">
              <Icon name="ph-x" weight="bold" size="sm" />
            </button>
          )}
        </header>

        {children != null && <div className={styles.body}>{children}</div>}

        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
