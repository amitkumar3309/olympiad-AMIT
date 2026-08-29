import Icon from './Icon'
import styles from './Pagination.module.css'

/**
 * Pagination.
 *
 * ## Mobile
 *
 * A row of numbered page buttons does not fit on a 320px screen, and shrinking them
 * until it does produces nine 28px targets in a row — the exact thing this milestone
 * is removing. So below 560px the numbers are replaced by "Page 3 of 12" between two
 * full-size arrows, and the numbers return when there is room for them.
 *
 * ## Accessibility
 *
 * A `<nav>` with a name, so it is listed as a landmark; `aria-current="page"` on the
 * current number, which is how a screen reader knows where it is without reading the
 * styling; and the arrows are labelled ("Previous page"), because a chevron has no
 * accessible name of its own.
 */

export interface PaginationProps {
  /** 1-based. */
  page: number
  pageCount: number
  onChange: (page: number) => void
  /** Total row count, for the "Showing 1–20 of 138" line. Omit to hide the line. */
  total?: number
  pageSize?: number
  /** Names the nav landmark: "Student pages". */
  label?: string
  className?: string
}

/**
 * Window of page numbers around the current page, with `null` marking a gap.
 *
 * Always the same width (seven slots at most) so the control does not change size as
 * you page through it — a control that resizes under the cursor moves the button you
 * were about to press again.
 */
function windowFor(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }
  if (page <= 4) {
    return [1, 2, 3, 4, 5, null, pageCount]
  }
  if (page >= pageCount - 3) {
    return [1, null, pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
  }
  return [1, null, page - 1, page, page + 1, null, pageCount]
}

export default function Pagination({
  page,
  pageCount,
  onChange,
  total,
  pageSize,
  label = 'Pages',
  className,
}: PaginationProps) {
  if (pageCount <= 1 && total === undefined) return null

  const first = total !== undefined && pageSize ? (page - 1) * pageSize + 1 : null
  const last = total !== undefined && pageSize ? Math.min(page * pageSize, total) : null

  return (
    <nav className={[styles.wrap, className].filter(Boolean).join(' ')} aria-label={label}>
      {total !== undefined && (
        <p className={styles.summary}>
          {total === 0 ? (
            'No results'
          ) : first !== null && last !== null ? (
            <>
              Showing <strong>{first.toLocaleString('en-IN')}</strong>–
              <strong>{last.toLocaleString('en-IN')}</strong> of{' '}
              <strong>{total.toLocaleString('en-IN')}</strong>
            </>
          ) : (
            <>
              <strong>{total.toLocaleString('en-IN')}</strong> results
            </>
          )}
        </p>
      )}

      {pageCount > 1 && (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.arrow}
            onClick={() => onChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <Icon name="ph-caret-left" weight="bold" size="sm" />
          </button>

          <p className={styles.compact} aria-hidden="true">
            Page {page} of {pageCount}
          </p>

          <ol className={styles.numbers}>
            {windowFor(page, pageCount).map((entry, index) =>
              entry === null ? (
                <li key={`gap-${index}`} className={styles.gap} aria-hidden="true">
                  …
                </li>
              ) : (
                <li key={entry}>
                  <button
                    type="button"
                    className={entry === page ? styles.pageActive : styles.page}
                    onClick={() => onChange(entry)}
                    aria-current={entry === page ? 'page' : undefined}
                    aria-label={`Page ${entry}`}
                  >
                    {entry}
                  </button>
                </li>
              ),
            )}
          </ol>

          <button
            type="button"
            className={styles.arrow}
            onClick={() => onChange(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
          >
            <Icon name="ph-caret-right" weight="bold" size="sm" />
          </button>
        </div>
      )}
    </nav>
  )
}
