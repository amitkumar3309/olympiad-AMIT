import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import styles from './Menu.module.css'

/**
 * A dropdown of actions, for the end of a table row.
 *
 * ## Why this exists
 *
 * Every administrative table in this product ends its rows with three to five small
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
 * A fixed panel goes stale the moment its trigger moves, so **a scroll that moves the
 * trigger closes it** rather than leaving it floating beside nothing. That is what every
 * native menu does; the alternative is re-measuring on every scroll event, which is more
 * code and a worse answer. A scroll in some other container does not move the trigger
 * and leaves the menu open.
 *
 * Two measurements are easy to get wrong here and both were:
 *
 *  - **A flipped panel is anchored by its `bottom`**, not by a `top` with a guessed
 *    height subtracted — the height is not known until it has rendered.
 *  - **`documentElement.clientWidth`, not `window.innerWidth`.** A fixed element is
 *    laid out against the initial containing block, which *excludes* the classic
 *    scrollbar; `innerWidth` includes it. On a desktop the two differ by ~15px, which
 *    is enough to put a right-aligned panel's far edge off the screen.
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
  /**
   * A second, quieter line under the label — "2 hours ago", "Nothing new" (Milestone 30,
   * for the notification list). Muted, but at the text floor: it is information.
   */
  meta?: string
  /**
   * Sets the label heavier — an unread notification. Never the only signal: say it in
   * `meta` too ("Unread · 2 hours ago"), because weight alone is invisible to some readers.
   */
  emphasis?: boolean
  /** A stable React key, for a list whose labels can repeat (two "Results released"). */
  id?: string
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
  /**
   * Replaces the trigger's icon and label entirely — an account menu's avatar and first
   * name (Milestone 30). The button keeps `label` as its accessible name, so include the
   * visible text in it ("Account menu for Asha") — WCAG's label-in-name rule.
   */
  trigger?: ReactNode
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end'
  /**
   * Told when the panel opens and closes — so a caller can load what the menu lists only
   * when somebody looks (the notification list), rather than on every page.
   */
  onOpenChange?: (open: boolean) => void
  className?: string
}

/** Roughly how tall the panel may be, used to decide whether it opens up or down. */
const ESTIMATED_PANEL_HEIGHT = 240
/**
 * The panel's widest possible width. **Must match `max-width` in `Menu.module.css`.**
 *
 * Used to keep the panel inside the viewport without measuring it. Taking the widest
 * it could be is deliberately conservative: a narrower panel is nudged slightly
 * further from the edge than it needed to be, which is invisible, whereas guessing
 * low would put part of it off-screen — the defect this exists for.
 */
const PANEL_MAX_WIDTH = 280
const GAP = 8

/** Keeps `value` within `[min, max]`, tolerating an inverted range on a tiny viewport. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

export default function Menu({
  label,
  items,
  triggerLabel,
  triggerIcon = 'ph-dots-three-vertical',
  trigger,
  align = 'end',
  onOpenChange,
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false)
  /** Either a `top` or a `bottom`, never both — see the note above. */
  const [position, setPosition] = useState<{
    top?: number
    bottom?: number
    left?: number
    right?: number
  } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false)
      onOpenChange?.(false)
      if (returnFocus) triggerRef.current?.focus()
    },
    [onOpenChange],
  )

  function toggle() {
    if (open) {
      close()
      return
    }
    /* `getBoundingClientRect` is a synchronous read of layout that already exists —
       unlike a frame or an observation, it cannot fail to arrive in a hidden tab. */
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight

    const below = viewportHeight - rect.bottom
    // Flip above the trigger when there is not room below — a row near the bottom of
    // a long table is the normal case, not the exception.
    const openUpwards = below < ESTIMATED_PANEL_HEIGHT && rect.top > below

    const maxInset = Math.max(GAP, viewportWidth - PANEL_MAX_WIDTH - GAP)
    const horizontal =
      align === 'end'
        ? { right: clamp(viewportWidth - rect.right, GAP, maxInset) }
        : { left: clamp(rect.left, GAP, maxInset) }

    setPosition({
      ...(openUpwards ? { bottom: viewportHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
      ...horizontal,
    })
    setOpen(true)
    onOpenChange?.(true)
  }

  /* Focus the first enabled item as soon as the panel exists. Synchronous: the panel
     was mounted in the same commit, so there is nothing to wait for. */
  useEffect(() => {
    if (!open) return
    panelRef.current
      ?.querySelector<HTMLElement>('[data-menu-item]:not([aria-disabled="true"])')
      ?.focus()
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
        // left where Tab put it rather than dragged back to the trigger.
        close(false)
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, close])

  /**
   * Outside press closes; so does a scroll that moves the trigger, and a resize.
   *
   * `pointerdown` rather than `click`, so the menu is gone before whatever was under
   * the pointer reacts. Scroll is listened for in the **capture** phase, because the
   * scroll that matters is usually a container's, and a container scroll does not
   * bubble.
   *
   * **Only a scroll that can move the trigger** — the page's, or a container the trigger
   * sits in (Milestone 30, Phase 4). Any scroll at all used to close it, and an
   * unrelated scroller is not rare: the dashboard's journey track settles its scroll-snap
   * when its stages arrive, which shut the notification menu a second after it opened.
   * A scroll inside a sibling leaves the menu's anchor exactly where it was.
   */
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }

    function onScroll(event: Event) {
      const target = event.target
      const movesTrigger =
        target === document ||
        target === document.documentElement ||
        (target instanceof Node && triggerRef.current !== null && target.contains(triggerRef.current))
      if (movesTrigger) close(false)
    }

    const dismiss = () => close(false)

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open, close])

  const triggerClasses = [
    styles.trigger,
    trigger ? styles.triggerCustom : triggerLabel ? styles.triggerLabelled : styles.triggerIconOnly,
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
        aria-label={trigger || !triggerLabel ? label : undefined}
        title={trigger || triggerLabel ? undefined : label}
      >
        {trigger ?? (
          <>
            <Icon name={triggerIcon} weight="bold" size="sm" />
            {triggerLabel}
          </>
        )}
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
            // Already clamped to the viewport when the menu opened — see `toggle()`.
            style={{
              top: position.top,
              bottom: position.bottom,
              left: position.left,
              right: position.right,
            }}
          >
            {items.map((item, index) => {
              if (isSeparator(item)) {
                // Presentational: the separator is a visual grouping cue, and
                // announcing it in a five-item menu is noise.
                return <hr key={`sep-${index}`} className={styles.separator} aria-hidden="true" />
              }

              const classes = [styles.item, item.tone === 'danger' ? styles.danger : '']
                .filter(Boolean)
                .join(' ')
              const content = (
                <>
                  {item.icon && <Icon name={item.icon} weight="bold" size="sm" />}
                  <span className={styles.itemText}>
                    <span className={item.emphasis ? styles.itemEmphasis : undefined}>{item.label}</span>
                    {item.meta && <span className={styles.itemMeta}>{item.meta}</span>}
                    {item.disabled && item.disabledReason && (
                      <span className={styles.itemReason}>{item.disabledReason}</span>
                    )}
                  </span>
                </>
              )
              const key = item.id ?? item.label

              if (item.to && !item.disabled) {
                return (
                  <Link
                    key={key}
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
                  key={key}
                  type="button"
                  role="menuitem"
                  data-menu-item=""
                  className={classes}
                  // `aria-disabled` rather than `disabled`: a disabled button is
                  // removed from the tab order *and* from most screen readers'
                  // announcements, so a reader is never told the action exists or
                  // why it is unavailable. This keeps it announced and unusable.
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
