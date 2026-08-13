import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { api, ApiError } from '../../api/client'
import type { HallOfFameEntry, HallOfFameResponse } from '../../api/types'
import styles from './HallOfFame.module.css'

/**
 * The Hall of Fame: five boards of real, dated achievement.
 *
 * **Every board here is a query, and an empty one says so.** The page renders whatever
 * the backend sends, including boards with no entries — those show the server's own
 * `emptyReason`, which explains what would put somebody on them, rather than a
 * placeholder name or a "coming soon" panel. That is the same rule the rest of the
 * product follows: an empty state is a true statement, and a filled-in one that nobody
 * earned is not.
 *
 * The boards deliberately measure different things. XP champions is the standing
 * leaderboard; the other four are about how *well* somebody did — the best paper sat,
 * the longest run of days, the most correct daily challenges, the most practice
 * finished. A hall of fame that only re-ranked XP would be the leaderboard with a nicer
 * heading.
 */

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function formatDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Entry({ entry }: { entry: HallOfFameEntry }) {
  const achieved = formatDate(entry.achievedOn)
  const context = [entry.detail, achieved].filter(Boolean).join(' · ')

  return (
    <li className={styles.entry}>
      <span className={styles.rank}>{MEDALS[entry.rank] ?? `#${entry.rank}`}</span>
      <span className={styles.who}>
        <span className={styles.name}>{entry.displayName}</span>
        <span className={styles.meta}>
          {[entry.classLevel, entry.schoolName].filter(Boolean).join(' · ') || 'No class recorded'}
        </span>
        {context && <span className={styles.context}>{context}</span>}
      </span>
      <span className={styles.value}>{entry.valueLabel}</span>
    </li>
  )
}

export default function HallOfFame() {
  const [data, setData] = useState<HallOfFameResponse['hallOfFame'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<HallOfFameResponse>('/hall-of-fame?limit=5')
      setData(res.hallOfFame)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the Hall of Fame.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <StudentShell title="Hall of Fame">
        <div className={styles.centered}>
          <Spinner />
          <p>Loading the honours…</p>
        </div>
      </StudentShell>
    )
  }

  if (error || !data) {
    return (
      <StudentShell title="Hall of Fame">
        <div className={`card ${styles.centered}`}>
          <h3>Could not load the Hall of Fame</h3>
          <p className="error-text">{error ?? 'Something went wrong.'}</p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      </StudentShell>
    )
  }

  const { boards, totals } = data
  const nothingYet = boards.every((board) => board.entries.length === 0)

  return (
    <StudentShell
      title="Hall of Fame"
      subtitle="Everyone here earned their place. Nothing on this page is seeded or sampled."
    >
      {/* --- What the platform has actually recorded ---------------------- */}
      <section className={styles.totals}>
        <div className="card">
          <div className={styles.totalValue}>{totals.studentsRanked.toLocaleString('en-IN')}</div>
          <div className={styles.totalLabel}>Students ranked</div>
        </div>
        <div className="card">
          <div className={styles.totalValue}>{totals.xpAwarded.toLocaleString('en-IN')}</div>
          <div className={styles.totalLabel}>XP awarded</div>
        </div>
        <div className="card">
          <div className={styles.totalValue}>{totals.mockTestsGraded.toLocaleString('en-IN')}</div>
          <div className={styles.totalLabel}>Mock tests graded</div>
        </div>
        <div className="card">
          <div className={styles.totalValue}>{totals.challengesAnswered.toLocaleString('en-IN')}</div>
          <div className={styles.totalLabel}>Challenges answered</div>
        </div>
        <div className="card">
          <div className={styles.totalValue}>{totals.practiceSessionsCompleted.toLocaleString('en-IN')}</div>
          <div className={styles.totalLabel}>Practice sessions</div>
        </div>
      </section>

      {nothingYet && (
        <div className={`card ${styles.openNote}`}>
          <i className="ph-bold ph-confetti" />
          <div>
            <strong>Every board is still open.</strong>
            <p>
              Nothing here has been won yet, so nothing is shown. Practise, sit a mock test or answer the daily
              challenge and the first names on this page could be yours.
            </p>
          </div>
        </div>
      )}

      {/* --- The boards ---------------------------------------------------- */}
      <div className={styles.boards}>
        {boards.map((board) => (
          <section className="card" key={board.code}>
            <header className={styles.boardHead}>
              <i className={`ph-bold ${board.icon} ${styles.boardIcon}`} />
              <div>
                <h3>{board.title}</h3>
                <p className={styles.boardDescription}>{board.description}</p>
              </div>
            </header>

            {board.entries.length === 0 ? (
              <p className={styles.emptyReason}>{board.emptyReason}</p>
            ) : (
              <ol className={styles.entries}>
                {board.entries.map((entry) => (
                  <Entry key={`${board.code}-${entry.studentId}`} entry={entry} />
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>

      <p className={styles.footNote}>
        Names are shown as a first name and a last initial, because the entrants are children and this page is public.
        Equal achievements share a rank. Accounts that are suspended or deactivated do not appear.{' '}
        <Link to="/leaderboard">See the full leaderboard →</Link>
      </p>

      <p className={styles.footNote}>
        There is no board for the official Olympiad yet — that competition has not been run, and a board with nothing
        behind it would be an invention rather than an honour.
      </p>
    </StudentShell>
  )
}
