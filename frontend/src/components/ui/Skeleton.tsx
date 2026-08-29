import type { CSSProperties, ReactNode } from 'react'
import styles from './Skeleton.module.css'

/**
 * Skeleton loaders.
 *
 * ## Why these exist rather than more spinners
 *
 * A spinner says "something is happening". A skeleton says "a table with five rows is
 * about to appear here", which stops the page reflowing under the reader when the data
 * lands — the jump that makes a fast page feel unreliable.
 *
 * ## Announcing a load honestly
 *
 * Every skeleton group is one polite live region with a real sentence in it
 * ("Loading students"), and the shapes themselves are `aria-hidden`. Without that, a
 * screen reader is read a dozen empty boxes; with the shapes exposed *and* a label, it
 * is read twice.
 *
 * **There are no percentages here.** A skeleton is indeterminate by definition — the
 * product does not know how far through a request it is, and a progress bar that
 * animates to 90% and waits is a fiction. `Progress` exists for the genuinely
 * measurable cases.
 */

export interface SkeletonProps {
  width?: string | number
  height?: string | number
  radius?: 'xs' | 'sm' | 'md' | 'pill' | 'circle'
  className?: string
}

/** One shape. Composed by the helpers below; also fine to use directly. */
export default function Skeleton({ width, height = 14, radius = 'xs', className }: SkeletonProps) {
  return (
    <span
      className={[styles.shape, styles[radius], className].filter(Boolean).join(' ')}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
      aria-hidden="true"
    />
  )
}

/**
 * The wrapper that carries the announcement. Wrap any group of shapes in it, or use
 * one of the presets below, which include it.
 */
export function SkeletonGroup({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** Lines of text. The last line is short, which is what a paragraph looks like. */
export function SkeletonText({
  lines = 3,
  label = 'Loading',
  className,
}: {
  lines?: number
  label?: string
  className?: string
}) {
  return (
    <SkeletonGroup label={label} className={[styles.text, className].filter(Boolean).join(' ')}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} height={12} width={index === lines - 1 ? '55%' : '100%'} />
      ))}
    </SkeletonGroup>
  )
}

/** A table's shape while it loads: the header row, then body rows. */
export function SkeletonTable({
  rows = 5,
  columns = 4,
  label = 'Loading table',
  className,
}: {
  rows?: number
  columns?: number
  label?: string
  className?: string
}) {
  return (
    <SkeletonGroup label={label} className={[styles.table, className].filter(Boolean).join(' ')}>
      <div className={styles.row} style={{ '--cols': columns } as CSSProperties}>
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} height={10} width="60%" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className={styles.row} style={{ '--cols': columns } as CSSProperties}>
          {Array.from({ length: columns }, (_, index) => (
            <Skeleton key={index} height={13} width={index === 0 ? '85%' : '65%'} />
          ))}
        </div>
      ))}
    </SkeletonGroup>
  )
}

/** A grid of cards — a dashboard's tiles, a list of mock tests. */
export function SkeletonCards({
  count = 3,
  label = 'Loading',
  className,
}: {
  count?: number
  label?: string
  className?: string
}) {
  return (
    <SkeletonGroup label={label} className={[styles.cards, className].filter(Boolean).join(' ')}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.card}>
          <Skeleton height={12} width="45%" />
          <Skeleton height={24} width="70%" />
          <Skeleton height={10} width="90%" />
        </div>
      ))}
    </SkeletonGroup>
  )
}
