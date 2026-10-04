import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { api } from '../../../api/client'
import type { LeaderboardRow } from '../../../api/types'
import { Avatar, ButtonLink, EmptyState, LeaderboardTable, Podium, Section, SkeletonTable } from '../../../components/ui'
import { formatNumber } from '../../../lib/format'
import { TOP_SCHOLARS } from '../../../lib/siteConfig'
import styles from '../Landing.module.css'

/**
 * Top Scholars (brief §7.1 #10) — the top of the real all-time leaderboard, from the one
 * ranking service, so it can never disagree with `/leaderboard`.
 *
 * Children are shown the way every public list shows them: first name and last initial,
 * class, and city or school; **initials avatars, never photos**; and a student who opted
 * out of public lists appears only as "A Class 7 student" (the server decides that).
 *
 * ## The podium is only drawn when it is true
 *
 * Equal XP shares a rank, and at launch many students hold the same few XP — so the top
 * three may well be 1, 1, 1. Steps labelled 1, 2 and 3 would then rank children who are
 * level. The podium appears only when the first three ranks really are 1, 2 and 3;
 * otherwise everybody is in the table with their real, shared rank.
 */

function placeOf(row: LeaderboardRow): string {
  return [row.classLevel, row.city ?? row.schoolName].filter(Boolean).join(' · ')
}

export default function TopScholars() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ leaderboard: LeaderboardRow[] }>(`/leaderboard?limit=${TOP_SCHOLARS}`)
      .then((res) => {
        if (!cancelled) setRows(res.leaderboard)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const podium = rows !== null && rows.length >= 3 && rows[0]!.rank === 1 && rows[1]!.rank === 2 && rows[2]!.rank === 3
  const tableRows = rows ? (podium ? rows.slice(3) : rows) : []

  return (
    <Section
      className={`container ${styles.section}`}
      eyebrow="Standings"
      title="Top Scholars"
      lead="The highest XP earned so far, straight from the leaderboard."
      actions={
        <ButtonLink to="/leaderboard" variant="secondary" size="sm" iconAfter={<ArrowRight size={16} aria-hidden="true" />}>
          View full leaderboard
        </ButtonLink>
      }
    >
      {rows === null ? (
        <SkeletonTable rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="ph-trophy"
          title="Nobody is on the leaderboard yet"
          description="XP is earned by practising, sitting mock tests and answering the Daily Quiz. Register and you could be the first name here."
        />
      ) : (
        <div className={podium ? styles.scholars : styles.scholarsTableOnly}>
          {podium && (
            <Podium
              label="The top three on the leaderboard"
              entries={rows.slice(0, 3).map((row) => ({
                rank: row.rank as 1 | 2 | 3,
                name: row.displayName,
                value: `${formatNumber(row.xp)} XP`,
                meta: placeOf(row) || undefined,
                avatar: <Avatar name={row.displayName} size="lg" decorative />,
              }))}
            />
          )}
          {tableRows.length > 0 && (
            <div className={styles.scholarTable}>
              <LeaderboardTable
                caption={podium ? 'Ranks four to eight on the leaderboard' : 'The top of the leaderboard'}
                columns={['Class', 'XP']}
                align={['start', 'end']}
                rows={tableRows.map((row) => ({
                  key: `${row.studentId}-${row.rank}`,
                  rank: row.rank,
                  name: row.displayName,
                  avatar: <Avatar name={row.displayName} size="xs" decorative />,
                  cells: [row.classLevel?.replace('Class ', '') ?? '—', formatNumber(row.xp)],
                }))}
              />
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
