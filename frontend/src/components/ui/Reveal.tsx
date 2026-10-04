import { useRef, type CSSProperties, type ElementType, type ReactNode } from 'react'
import { useInView, usePrefersReducedMotion } from './motion'
import styles from './Reveal.module.css'

/**
 * Brings content in **once**, the first time it is scrolled into view (Milestone 30).
 *
 * ## Use it sparingly
 *
 * The launch brief is explicit: motion must explain a change or point at the one thing
 * that matters, and "don't put the same fade-up on every section". This exists for the
 * few entrances that earn one — a podium rising, a journey track drawing itself — not
 * as a wrapper for every block on a page.
 *
 * ## It can never leave content hidden
 *
 * The hidden starting state exists only while motion is allowed, and `useInView`
 * falls back to "visible" if the observer is never serviced, so a reader with reduced
 * motion, a background tab and a crawler all get the content in place. The hidden
 * state is a `data-reveal` attribute the stylesheet reads, and `@media print`
 * ignores it.
 */

export interface RevealProps {
  children: ReactNode
  as?: ElementType
  /** `up` slides 16px up into place; `fade` only fades; `rise` grows from its base
      (a podium step, a bar). */
  variant?: 'up' | 'fade' | 'rise'
  /** Stagger, in milliseconds. */
  delay?: number
  className?: string
  style?: CSSProperties
}

export default function Reveal({ children, as: Tag = 'div', variant = 'up', delay = 0, className, style }: RevealProps) {
  const ref = useRef<HTMLElement>(null)
  const reduced = usePrefersReducedMotion()
  const inView = useInView(ref, { threshold: 0.2 })
  const state = reduced || inView ? 'shown' : 'pending'

  return (
    <Tag
      ref={ref}
      data-reveal={state}
      className={[styles.reveal, styles[variant], className].filter(Boolean).join(' ')}
      style={{ ...style, '--reveal-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  )
}
