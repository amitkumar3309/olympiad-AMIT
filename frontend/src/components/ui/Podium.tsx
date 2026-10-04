import type { ReactNode } from 'react'
import Reveal from './Reveal'
import styles from './Podium.module.css'

/**
 * The top three, on steps (Milestone 30 — the mockups' "Top Scholars").
 *
 * ## Reading order is not visual order
 *
 * A podium is drawn 2 – 1 – 3, but a screen reader and a keyboard must meet 1, 2, 3.
 * So the DOM is an ordered list in rank order and CSS grid places each item in its
 * column. Nothing about the order is decided by the caller.
 *
 * ## It is honest about how many there are
 *
 * Fewer than three entries renders fewer steps, never empty ones — an empty pedestal
 * reads as "nobody came third", which is a claim. The caller shows an empty state when
 * there is nobody at all.
 *
 * ## The steps are invariant fills
 *
 * `--podium-*` are the mockups' gold, silver and bronze, the same in both themes, so
 * the rank numeral on a step is pinned to ink — it is a leaf, which is the one case a
 * theme-invariant fill may carry text (see `tokens.css`). The names sit above the
 * steps, on the page, in themed text.
 */

export interface PodiumEntry {
  rank: 1 | 2 | 3
  /** Already masked by the server (first name + last initial) — never a full name. */
  name: string
  /** The figure — "195 XP". */
  value: ReactNode
  /** A second line — "Class 12 · Delhi". */
  meta?: ReactNode
  /** An `Avatar` (initials — other students' photos are never shown). */
  avatar?: ReactNode
}

export interface PodiumProps {
  entries: PodiumEntry[]
  /** Names the list for a screen reader — "Top three on the leaderboard". */
  label: string
  className?: string
}

const STAGGER: Record<1 | 2 | 3, number> = { 1: 120, 2: 0, 3: 240 }

export default function Podium({ entries, label, className }: PodiumProps) {
  const ordered = [...entries].sort((a, b) => a.rank - b.rank).slice(0, 3)

  return (
    <ol className={[styles.podium, className].filter(Boolean).join(' ')} aria-label={label}>
      {ordered.map((entry) => (
        <li key={entry.rank} className={[styles.place, styles[`rank${entry.rank}`]].join(' ')}>
          <div className={styles.person}>
            {entry.avatar && <div className={styles.avatar}>{entry.avatar}</div>}
            <p className={styles.name}>
              <span className="sr-only">Rank {entry.rank}: </span>
              {entry.name}
            </p>
            <p className={styles.value}>{entry.value}</p>
            {entry.meta && <p className={styles.meta}>{entry.meta}</p>}
          </div>
          <Reveal variant="rise" delay={STAGGER[entry.rank]} className={styles.step}>
            <span className={styles.numeral} aria-hidden="true">
              {entry.rank}
            </span>
          </Reveal>
        </li>
      ))}
    </ol>
  )
}
