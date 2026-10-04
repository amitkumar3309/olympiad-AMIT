import { Fragment, type ReactNode } from 'react'
import styles from './LeaderboardTable.module.css'

/**
 * A ranked table — the mockups' "4 … 8" beside the podium, and the dashboard's
 * "Today's top 5" with the reader's own row highlighted (Milestone 30).
 *
 * ## It renders rows in the order given
 *
 * Ranking is the server's job (`leaderboardService` — one ranking, so a rank cannot
 * disagree with itself on two screens). This component never sorts, never computes a
 * rank, and prints `rank` exactly as it arrived, which is how equal XP shows as an
 * equal rank.
 *
 * ## "You", and the gap above you
 *
 * `highlight` marks the reader's own row (tinted, and "(You)" in words — a tint alone
 * is not information). `gapBefore` draws a "…" row, for a reader ranked below the
 * rows shown, so the jump from rank 5 to rank 48 is visible rather than implied.
 */

export interface LeaderboardRow {
  key: string
  rank: number
  /** Already masked by the server for anyone but the reader. */
  name: ReactNode
  avatar?: ReactNode
  /** Extra columns, in the order of `columns`. */
  cells: ReactNode[]
  /** The reader's own row. */
  highlight?: boolean
  /** Draw a "…" row above this one — the reader is outside the rows shown. */
  gapBefore?: boolean
  /** A marker beside the rank — a crown for the top three. Decorative. */
  rankMarker?: ReactNode
}

export interface LeaderboardTableProps {
  /** Read by a screen reader as the table's name; visually hidden. */
  caption: string
  /** Headers for `cells`, after "#" and "Name". */
  columns: string[]
  /** Alignment of each extra column. Figures are `end`. */
  align?: Array<'start' | 'center' | 'end'>
  rows: LeaderboardRow[]
  className?: string
}

export default function LeaderboardTable({ caption, columns, align = [], rows, className }: LeaderboardTableProps) {
  const totalColumns = columns.length + 2
  return (
    <table className={[styles.table, className].filter(Boolean).join(' ')}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.rankCol}>
            #
          </th>
          <th scope="col">Name</th>
          {columns.map((column, i) => (
            <th key={column} scope="col" className={styles[align[i] ?? 'end']}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Fragment key={row.key}>
            {row.gapBefore && (
              <tr className={styles.gap} aria-hidden="true">
                <td colSpan={totalColumns}>…</td>
              </tr>
            )}
            <tr className={row.highlight ? styles.highlight : undefined}>
              <td className={styles.rankCol}>
                <span className={styles.rank}>
                  {row.rankMarker}
                  <span>{row.rank}</span>
                </span>
              </td>
              <th scope="row" className={styles.nameCell}>
                <span className={styles.person}>
                  {row.avatar}
                  <span className={styles.name}>
                    {row.name}
                    {row.highlight && <span className={styles.you}> (You)</span>}
                  </span>
                </span>
              </th>
              {row.cells.map((cell, i) => (
                <td key={i} className={styles[align[i] ?? 'end']}>
                  {cell}
                </td>
              ))}
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
