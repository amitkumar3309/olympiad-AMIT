import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import Icon from './Icon'
import styles from './Tabs.module.css'

/**
 * Tabs.
 *
 * Controlled only — the selected tab is almost always something the page already
 * knows (a filter, a URL segment, a review stage), and an internal copy of it would
 * be a second source of truth.
 *
 * ## Keyboard behaviour, which is the part usually missing
 *
 * The tab list is one stop in the page's tab order, not one stop per tab (a "roving
 * tabindex"): Tab moves *into* the list and then *out* of it, and the arrow keys move
 * between tabs. That is what the ARIA tabs pattern specifies, and it is why a
 * seven-tab bar does not cost a keyboard user seven presses to walk past.
 *
 * Home and End jump to the ends. Selection follows focus, which is correct for tabs
 * whose panels are already rendered.
 *
 * ## Mobile
 *
 * The list scrolls horizontally *within itself* rather than wrapping. Wrapped tabs
 * change the height of the header as the selection moves, which shifts the content
 * under a thumb mid-tap. The scroll region is a contained one, so the page never
 * scrolls sideways.
 *
 * ## `mode` — and why a filter is not a tab
 *
 * Half the places this control is wanted are not tabs at all: "All / Draft /
 * Published" above a question list is a *filter*, and the list below it is not a
 * panel that belongs to the pressed button.
 *
 * That distinction is not pedantry, it is a defect if you get it wrong. `role="tab"`
 * obliges an `aria-controls` naming a `role="tabpanel"`, and a tablist used as a
 * filter points at an element that does not exist — which a screen reader announces
 * as a relationship the reader cannot follow. It is exactly what this component did
 * on its first outing.
 *
 * So: `mode="tabs"` (the default) is the ARIA tabs pattern and requires a `TabPanel`
 * per item. `mode="filter"` renders a labelled group of toggle buttons with
 * `aria-pressed`, which claims nothing about panels — and, being ordinary buttons,
 * each is its own tab stop with no arrow-key convention to learn.
 *
 * Neither mode ever emits an `aria-controls` pointing at an element that is not in the
 * document; see the note on the attribute below.
 */

export interface TabItem {
  id: string
  label: ReactNode
  /** Phosphor glyph, drawn before the label. */
  icon?: string
  /** A count beside the label — pending imports, unread notices. */
  count?: number
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  /** Accessible name for the tab list. Required: "Tabs" tells a reader nothing. */
  label: string
  /**
   * Prefix for the generated element ids, shared with each `TabPanel`.
   *
   * Explicit rather than a `useId()` hidden inside this component, because the
   * `aria-controls` here and the `id` on the panel have to agree, and a generated
   * value the panel cannot see would silently not match — which is worse than
   * verbose, since nothing visibly breaks and the relationship simply is not
   * announced. Any stable string unique on the page: `"import-review"`.
   */
  idPrefix: string
  variant?: 'underline' | 'pill'
  /**
   * `tabs` (default) for real tabs with a `TabPanel` each; `filter` for a set of
   * toggles above a list. See the note above — this changes the ARIA, not the look.
   */
  mode?: 'tabs' | 'filter'
  className?: string
}

export default function Tabs({
  items,
  value,
  onChange,
  label,
  idPrefix,
  variant = 'underline',
  mode = 'tabs',
  className,
}: TabsProps) {
  const base = idPrefix
  const listRef = useRef<HTMLDivElement>(null)

  function move(delta: number) {
    const enabled = items.filter((item) => !item.disabled)
    if (enabled.length === 0) return
    const currentIndex = enabled.findIndex((item) => item.id === value)
    // Wraps, which is what the pattern expects: right from the last tab returns to
    // the first rather than dead-ending.
    const nextIndex = (currentIndex + delta + enabled.length) % enabled.length
    const next = enabled[nextIndex]
    if (!next) return
    onChange(next.id)
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${base}-${next.id}`)}`)?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Arrow-key navigation belongs to the tabs pattern. In filter mode these are
    // ordinary buttons, each its own tab stop, and hijacking the arrows there would
    // break the scroll gesture a keyboard user expects from a scrollable row.
    if (mode === 'filter') return

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Home': {
        event.preventDefault()
        const first = items.find((item) => !item.disabled)
        if (first) onChange(first.id)
        break
      }
      case 'End': {
        event.preventDefault()
        const last = [...items].reverse().find((item) => !item.disabled)
        if (last) onChange(last.id)
        break
      }
      default:
        break
    }
  }

  return (
    <div
      ref={listRef}
      role={mode === 'tabs' ? 'tablist' : 'group'}
      aria-label={label}
      aria-orientation={mode === 'tabs' ? 'horizontal' : undefined}
      className={[styles.list, styles[variant], className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            id={`${base}-${item.id}`}
            type="button"
            role={mode === 'tabs' ? 'tab' : undefined}
            aria-selected={mode === 'tabs' ? selected : undefined}
            /*
              Only on the *selected* tab, because only the selected tab's panel is in
              the document — `TabPanel` unmounts when inactive so that a chart inside
              it is never measured at zero width.
              An `aria-controls` naming an element that does not exist is a dangling
              IDREF: the reader is told about a relationship it cannot follow. Omitting
              it where there is nothing to point at states the same truth and is valid.
            */
            aria-controls={mode === 'tabs' && selected ? `${base}-${item.id}-panel` : undefined}
            aria-pressed={mode === 'filter' ? selected : undefined}
            // The roving tabindex is part of the tabs pattern; a group of buttons
            // keeps the ordinary one stop each.
            tabIndex={mode === 'tabs' ? (selected ? 0 : -1) : undefined}
            disabled={item.disabled}
            className={selected ? styles.tabActive : styles.tab}
            onClick={() => onChange(item.id)}
          >
            {item.icon && <Icon name={item.icon} weight="bold" size="sm" />}
            <span className={styles.tabLabel}>{item.label}</span>
            {item.count !== undefined && <span className={styles.count}>{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export interface TabPanelProps {
  /** The `Tabs` `items[].id` this panel belongs to. */
  id: string
  /** The same `idPrefix` given to `Tabs`. */
  idPrefix: string
  active: boolean
  children: ReactNode
  className?: string
}

/**
 * A tab's panel.
 *
 * `tabIndex={0}` is deliberate and is part of the pattern: after activating a tab, the
 * next Tab press should land inside the panel that just appeared. Without it, focus
 * continues past the panel to whatever follows it, and a keyboard user never reaches
 * the content they just selected.
 *
 * Panels are unmounted when inactive rather than hidden, so an off-screen chart is not
 * measuring itself against a zero-width box — a real defect class with Chart.js.
 */
export function TabPanel({ id, idPrefix, active, children, className }: TabPanelProps) {
  if (!active) return null
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-${id}-panel`}
      aria-labelledby={`${idPrefix}-${id}`}
      tabIndex={0}
      className={[styles.panel, className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
