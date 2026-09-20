import { Link } from 'react-router-dom'
import Icon from './Icon'
import styles from './Breadcrumb.module.css'

/**
 * Where you are, and the way back up.
 *
 * ## Why it is not just a "← Back" link
 *
 * Several pages here sit two levels down — the question editor under the bank, the
 * mock-test results under the paper, the import review under the upload — and each
 * had grown its own `← Back to …` anchor. A back link answers "how do I leave",
 * which the browser's own button already answers. A breadcrumb answers "what is this
 * page *part of*", which nothing else on the screen does.
 *
 * ## The last item is not a link
 *
 * It is the page you are on: text, marked `aria-current="page"`. A link to the
 * current page is a control that appears to do something and does nothing, and it is
 * the most common way a breadcrumb is built wrong.
 *
 * The separators are `aria-hidden`: the `<ol>` already conveys the sequence, and a
 * screen reader announcing "slash" between every level is noise.
 */

export interface Crumb {
  label: string
  /** Omit on the final item — the page you are on is text, not a link. */
  to?: string
}

export interface BreadcrumbProps {
  items: Crumb[]
  className?: string
}

export default function Breadcrumb({ items, className }: BreadcrumbProps) {
  if (items.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className={[styles.nav, className].filter(Boolean).join(' ')}>
      <ol className={styles.list}>
        {items.map((crumb, index) => {
          const last = index === items.length - 1
          return (
            <li key={`${crumb.label}-${index}`} className={styles.item}>
              {index > 0 && <Icon name="ph-caret-right" size="xs" className={styles.separator} />}
              {crumb.to && !last ? (
                <Link to={crumb.to} className={styles.link}>
                  {crumb.label}
                </Link>
              ) : (
                <span className={styles.current} aria-current={last ? 'page' : undefined}>
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
