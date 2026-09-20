import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import styles from './Menu.module.css'

/**
 * A dropdown of actions, for the end of a table row.
 *
 * ## Why this exists
 *
 * Every administrative table in this product ended its rows with three to five small
 * buttons — Edit, Publish, Duplicate, Results, Delete. That is a lot of visual weight
 * for controls almost nobody presses, it is what forces a table to scroll sideways on
 * a laptop, and on a phone it is five 29px targets in a row. One trigger and a menu
 * gives the row back to its data.
 *
 * **It is not for primary actions.** A menu hides what it contains; the action a page
 * exists to offer belongs in the header as a button. This is for the long tail.
 *
 * ## Positioning: fixed, and closed by scroll
 *
 * The panel is portalled to `document.body` and positioned from the trigger's
 * rectangle at open time. Absolute positioning inside the row would be clipped by
 * `TableScroll`'s `overflow`, which is the usual way this component is got wrong.
 *
 * A fixed panel goes stale the moment anything scrolls, so **scrolling closes it**
 * rather than leaving it floating beside nothing. That is deliberate and is what
 * every native menu does; the alternative is re-measuring on every scroll event,
 * which is both more code and a worse answer.
 *
 * ## What it does not depend on
 *
 * No `requestAnimationFrame`, no `ResizeObserver`. The panel is **mounted** when it
 * opens, so focus can move into it synchronously — the same reason the navigation
 * drawer is mounted rather than hidden. Both of those APIs stop in a tab that is not
 * compositing, and neither may be the only path to a correctness-relevant effect.
 */

export interface MenuAction {
  label: string
  /** Phosphor glyph. Decorative — the label is the accessible name. */
  icon?: string
  /** Route to navigate to. Mutually exclusive with `onSelect`. */
  to?: string
  onSelect?: () => void
  /** `danger` for anything that destroys or revokes. */
  tone?: 'default' | 'danger'
  disabled?: boolean
  /**
   * Why the item is disabled. Rendered as visible text under the label, **not** as a
   * `title`: a tooltip attribute never appears on a touch screen, so a disabled item
   * explained that way is simply dead on a phone.
   */
  disabledReason?: string
}

export interface MenuSeparator {
  separator: true
}

export type MenuItem = MenuAction | MenuSeparator

function isSeparator(item: MenuItem): item is MenuSeparator {
  return 'separator' in item
}

export interface MenuProps {
  /**
   * The trigger's accessible name. Required, and it should identify the *subject* —
   * "Actions for Priya Sharma", not "Actions" — because a screen-reader user listing
   * the buttons on a table of fifty rows otherwise hears "Actions" fifty times.
   */
  label: string
  items: MenuItem[]
  /** A visible label on the trigger. Without it the trigger is icon-only. */
  triggerLabel?: string
  triggerIcon?: string
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end'
  className?: string
}

/** Roughly how tall the panel may be, used to decide whether it opens up or down. */
const ESTIMATED_PANEL_HEIGHT = 240
const GAP = 8

export default function Menu({
  label,
  items,
  triggerLabel,
  triggerIcon = 'ph-dots-three-vertical',
  align = 'end',
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false)
  /**
   * Either a `top` or a `bottom`, never both.
   *
   * A panel that flips above the trigger has to be anchored by its **bottom** edge:
   * anchoring by `top` and subtracting a guessed height is how a menu ends up
   * overlapping the button that opened it, and the height is not known until it has
   * rendered. `bottom` lets the browser do that arithmetic from the real height.
   */
  const [position, setPosition] = useState<{
    top?: number
    bottom?: number
    left: number
  } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  /**
   * Measure at open time.
   *
   * `getBoundingClientRect` is a synchronous read of the layout that already exists —
   * unlike a frame or an observation, it cannot fail to arrive in a hidden tab.
   */
  function toggle() {
    if (open) {
      close()
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    const below = window.innerHeight - rect.bottom
    // Flip above the trigger when there is not room below — a row near the bottom of
    // a long table is the normal case, not the exception.
    const openUpwards = below < ESTIMATED_PANEL_HEIGHT && rect.top > below

    setPosition({
      ...(openUpwards
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP }),
      left: align === 'end' ? rect.right : rect.left,
    })
    setOpen(true)
  }

  /* Focus the first enabled item as soon as the panel exists. Synchronous: the panel
     was mounted in the same commit, so there is nothing to wait for. */
  useEffect(() => {
    if (!open) return
    const first = panelRef.current?.querySelector<HTMLElement>('[data-menu-item]:not([aria-disabled="true"])')
    first?.focus()
  }, [open])

  /* Escape, arrow keys, Home/End. */
  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        return
      }

      const root = panelRef.current
      if (!root) return
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>('[data-menu-item]:not([aria-disabled="true"])'),
      )
      if (focusable.length === 0) return

      const index = focusable.indexOf(document.activeElement as HTMLElement)

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusable[(index + 1) % focusable.length]?.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusable[(index - 1 + focusable.length) % focusable.length]?.focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        focusable[0]?.focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        focusable[focusable.length - 1]?.focus()
      } else if (event.key === 'Tab') {
        // Tabbing out of a menu closes it, which is what a native menu does. Focus is
        // left where Tab put it rather than being dragged back to the trigger.
        close(false)
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, close])

  /**
   * Outside press closes; so does any scroll or resize.
   *
   * `pointerdown` rather than `click`, so the menu is gone before whatever was under
   * the pointer reacts. Scroll is listened for in the **capture** phase with
   * `true`, because the scroll that matters is usually a container's, not the
   * window's, and a container scroll does not bubble.
   */
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }

    const dismiss = () => close(false)

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open, close])

  const triggerClasses = [
    styles.trigger,
    triggerLabel ? styles.triggerLabelled : styles.triggerIconOnly,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClasses}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel ? undefined : label}
        title={triggerLabel ? undefined : label}
      >
        <Icon name={triggerIcon} weight="bold" size="sm" />
        {triggerLabel}
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            aria-label={label}
            className={styles.panel}
            style={{
              top: position.top,
              bottom: position.bottom,
              // `end` alignment anchors the panel's right edge to the trigger's right
              // edge, which is what keeps a row-action menu inside the viewport. The
              // `max` is the guard for a trigger close to the right edge on a phone.
              ...(align === 'end'
                ? { right: Math.max(GAP, window.innerWidth - position.left) }
                : { left: Math.max(GAP, position.left) }),
            }}
          >
            {items.map((item, index) => {
              if (isSeparator(item)) {
                // Presentational: a separator is a visual grouping cue, and announcing
                // it as a separator in a five-item menu is noise.
                return <hr key={`sep-${index}`} className={styles.separator} aria-hidden="true" />
              }

              const tone = item.tone === 'danger' ? styles.danger : ''
              const classes = [styles.item, tone].filter(Boolean).join(' ')
              const content = (
                <>
                  {item.icon && <Icon name={item.icon} weight="bold" size="sm" />}
                  <span className={styles.itemText}>
                    {item.label}
                    {item.disabled && item.disabledReason && (
                      <span className={styles.itemReason}>{item.disabledReason}</span>
                    )}
                  </span>
                </>
              )

              if (item.to && !item.disabled) {
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    role="menuitem"
                    data-menu-item=""
                    className={classes}
                    onClick={() => close(false)}
                  >
                    {content}
                  </Link>
                )
              }

              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  data-menu-item=""
                  className={classes}
                  // `aria-disabled` rather than `disabled`: a disabled button is
                  // removed from the tab order *and* from most screen readers'
                  // announcements, so a reader is never told the action exists or why
                  // it is unavailable. This keeps it announced and unusable.
                  aria-disabled={item.disabled || undefined}
                  onClick={() => {
                    if (item.disabled) return
                    item.onSelect?.()
                    close(false)
                  }}
                >
                  {content}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
