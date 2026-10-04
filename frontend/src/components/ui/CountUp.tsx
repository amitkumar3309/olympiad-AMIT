import { useRef } from 'react'
import { formatNumber } from '../../lib/format'
import { useCountUp, useInView } from './motion'

/**
 * A figure that counts up **once**, the first time it is on screen (Milestone 30).
 *
 * ## Two copies of the number, on purpose
 *
 * The animated digits are `aria-hidden`; the final, formatted value sits beside them
 * in an `sr-only` span. A screen reader therefore hears "1,08,320" once rather than a
 * stream of intermediate numbers, and the text a reader can copy, search or translate
 * is always the real figure — never "6,412" because the animation was mid-flight.
 *
 * Reduced motion shows the final value immediately. If the observer or the animation
 * frame never arrives (a background tab), the hooks fall back to the final value on a
 * timer — see `motion.ts`.
 */

export interface CountUpProps {
  value: number
  /** How the number is written. Defaults to Indian grouping (`1,08,320`). */
  format?: (n: number) => string
  durationMs?: number
  className?: string
}

export default function CountUp({ value, format = formatNumber, durationMs = 900, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { threshold: 0.4 })
  const shown = useCountUp(value, inView, durationMs)

  return (
    <span ref={ref} className={['tnum', className].filter(Boolean).join(' ')}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}
