import { useEffect, useState, type CSSProperties } from 'react'
import { usePrefersReducedMotion } from './motion'
import styles from './Confetti.module.css'

/**
 * A light confetti burst, **at most 1.5 seconds** (Milestone 30 — the brief's
 * correct-answer celebration).
 *
 * CSS only — no library, no canvas: thirty small pieces fanned out by per-piece custom
 * properties and one `@keyframes`. Each piece animates `transform` and `opacity` only.
 * It renders nothing under reduced motion, is `aria-hidden` (the result is announced in
 * words by whatever triggered it), and removes itself on a timer rather than waiting
 * for `animationend`, which never fires in a tab that is not compositing.
 *
 * Re-trigger by changing `burstKey`.
 */

const PIECES = 30
const DURATION_MS = 1400
/** Theme-invariant hues — confetti is decoration, and identical in both themes. */
const COLOURS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--accent-strong)',
]

export interface ConfettiProps {
  /** Change this to fire again. `null` fires nothing. */
  burstKey: number | string | null
  className?: string
}

export default function Confetti({ burstKey, className }: ConfettiProps) {
  const reduced = usePrefersReducedMotion()
  const [active, setActive] = useState<typeof burstKey>(null)

  useEffect(() => {
    if (burstKey === null || reduced) return
    setActive(burstKey)
    const timer = window.setTimeout(() => setActive(null), DURATION_MS + 100)
    return () => window.clearTimeout(timer)
  }, [burstKey, reduced])

  if (active === null) return null

  return (
    <div className={[styles.burst, className].filter(Boolean).join(' ')} aria-hidden="true" key={String(active)}>
      {Array.from({ length: PIECES }, (_, i) => {
        // Deterministic spread: an even fan of angles with a little variation, so the
        // burst looks organic without `Math.random()` (which would re-render differently).
        const angle = (i / PIECES) * 360 + ((i * 47) % 23)
        const distance = 70 + ((i * 37) % 60)
        const style = {
          '--angle': `${angle}deg`,
          '--distance': `${distance}px`,
          '--spin': `${(i % 2 ? 1 : -1) * (180 + ((i * 53) % 360))}deg`,
          '--delay': `${(i % 5) * 20}ms`,
          background: COLOURS[i % COLOURS.length],
        } as CSSProperties
        return <span key={i} className={i % 3 === 0 ? styles.dot : styles.piece} style={style} />
      })}
    </div>
  )
}
