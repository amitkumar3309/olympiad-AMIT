import { useEffect, useRef, useState, type ReactNode, type TableHTMLAttributes } from 'react'
import Icon from './Icon'
import styles from './Table.module.css'

/**
 * Tables, and the pattern that replaces them on a phone.
 *
 * There were sixty-six independently-declared `.table` classes and thirteen
 * `.tableScroll` wrappers in the product before this milestone, across twenty-one
 * pages. They were all the same table, described sixty-six times.
 *
 * ## The two responsive strategies, and when each is right
 *
 * **`TableScroll` + `Table`** — a real table in a contained horizontal scroller. Right
 * when the columns are a comparison: a results grid, a standings board, an audit log.
 * The scroll is *inside* the region, so the page itself never moves sideways, which is
 * the actual requirement — "no horizontal overflow" does not mean "no horizontal
 * scrolling anywhere", it means the page must not be draggable off its own edge.
 *
 * **`DataCardList` + `DataCard`** — one card per record, label above value. Right when
 * each row is an *entity* a reader acts on: a student, a referral, a payment. A
 * fourteen-column student row scrolled sideways on a 375px screen is technically
 * readable and practically unusable.
 *
 * Most listings in this product want both: cards below 768px, a table above it. That
 * is a page-level decision, so it belongs in each page's own module — these are the
 * two halves it switches between.
 *
 * ## Why the scroller measures itself
 *
 * A scrollable region has to be reachable by keyboard, or its overflowing columns are
 * unreachable without a mouse. But an unconditional `tabIndex={0}` puts a focus stop
 * on every table on the page whether or not it overflows, and a stop that does nothing
 * is a stop a keyboard user has to learn to ignore. So the region observes its own
 * size and takes the focus stop — and shows the fade telling you there is more —
 * only while it genuinely overflows.
 */

export interface TableScrollProps {
  /**
   * Accessible name for the scroll region, e.g. "Registered students". Required,
   * because "region" on its own is what a screen reader would otherwise announce.
   */
  label: string
  children: ReactNode
  className?: string
}

export function TableScroll({ label, children, className }: TableScrollProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [atEnd, setAtEnd] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const measure = () => {
      // 2px of tolerance: sub-pixel layout rounding otherwise reports a 1px overflow
      // on tables that fit, and the fade flickers on a resize.
      const overflows = node.scrollWidth - node.clientWidth > 2
      setOverflowing(overflows)
      setAtEnd(node.scrollLeft + node.clientWidth >= node.scrollWidth - 2)
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(node)
    // The table's own content changes size when data arrives, which does not resize
    // the region — so watch the first child too.
    if (node.firstElementChild) observer.observe(node.firstElementChild)

    /*
      `window.resize` as well as the observer, and not redundantly.

      A `ResizeObserver` is delivered as part of the browser's rendering steps, which
      do not run at all while a tab is not being rendered — so a table laid out wide
      and then resized narrow in a background tab keeps the stale measurement, and
      with it no keyboard access to its own overflow, until something paints.
      `resize` is an ordinary event and arrives either way. The observer still earns
      its place: it is the only one that catches the *content* changing size, which is
      what happens when the rows arrive.
    */
    window.addEventListener('resize', measure)
    node.addEventListener('scroll', measure, { passive: true })

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      node.removeEventListener('scroll', measure)
    }
  }, [])

  return (
    <div className={[styles.scrollOuter, className].filter(Boolean).join(' ')}>
      <div
        ref={ref}
        className={styles.scroll}
        // Both only while it overflows — see the header note.
        role={overflowing ? 'region' : undefined}
        aria-label={overflowing ? label : undefined}
        tabIndex={overflowing ? 0 : undefined}
      >
        {children}
      </div>
      {overflowing && !atEnd && <span className={styles.fade} aria-hidden="true" />}
      {overflowing && (
        <p className={styles.scrollHint}>
          <Icon name="ph-arrows-horizontal" size="xs" />
          <span>Scroll sideways to see every column</span>
        </p>
      )}
    </div>
  )
}

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** `compact` for an admin listing, `comfortable` when rows hold two lines. */
  density?: 'compact' | 'default' | 'comfortable'
  /** Keeps the header visible while the body scrolls vertically. */
  stickyHeader?: boolean
  children: ReactNode
}

export function Table({ density = 'default', stickyHeader, className, children, ...rest }: TableProps) {
  return (
    <table
      className={[styles.table, styles[density], stickyHeader ? styles.sticky : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </table>
  )
}

export function DataCardList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={[styles.cardList, className].filter(Boolean).join(' ')}>{children}</ul>
}

export interface DataCardProps {
  title: ReactNode
  subtitle?: ReactNode
  /** A badge or status, top right. */
  status?: ReactNode
  /** Row actions. Full width on a phone, so they are reachable rather than tucked. */
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

/**
 * One record as a card — the mobile form of a table row.
 *
 * The title is what the record *is* (a name, an id); `DataRow` children are its
 * fields. Nothing is dropped to save space: hiding a column on a phone means the
 * information only exists on a desktop, which is the opposite of mobile-first.
 */
export function DataCard({ title, subtitle, status, actions, children, className }: DataCardProps) {
  return (
    <li className={[styles.card, className].filter(Boolean).join(' ')}>
      <div className={styles.cardHead}>
        <div className={styles.cardHeadText}>
          <p className={styles.cardTitle}>{title}</p>
          {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
        </div>
        {status && <div className={styles.cardStatus}>{status}</div>}
      </div>
      {children && <dl className={styles.cardFields}>{children}</dl>}
      {actions && <div className={styles.cardActions}>{actions}</div>}
    </li>
  )
}

/**
 * A label/value pair inside a `DataCard`.
 *
 * A `<dl>` rather than two `<span>`s: the association between the label and the value
 * is then in the markup, so a screen reader reads "Class, Class 8" instead of two
 * unrelated strings.
 */
export function DataRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.cardField}>
      <dt className={styles.cardFieldLabel}>{label}</dt>
      <dd className={styles.cardFieldValue}>{children}</dd>
    </div>
  )
}
