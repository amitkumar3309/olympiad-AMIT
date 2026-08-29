import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import { api, ApiError } from '../../api/client'
import {
  CLASS_LEVELS,
  LEADERBOARD_PERIODS,
  LEADERBOARD_PERIOD_LABELS,
  type ClassLevel,
  type LeaderboardPeriod,
  type LeaderboardResponse,
  type LeaderboardScope,
} from '../../api/types'
import { Icon } from '../../components/ui'
import styles from './Leaderboard.module.css'

/**
 * The full leaderboard: overall or one class, over all time or a recent window.
 *
 * **This page does no ranking.** It sends a scope, a period and a page, and renders the
 * rows exactly as they arrive — in the order they arrive, with the rank the server put
 * on each one. It deliberately does not sort, re-number or filter anything: the backend
 * is the only place that decides a standing, and a page that re-sorted its own copy
 * would be a second implementation waiting to disagree with the first. The same rule the
 * rewards page follows, for the same reason.
 *
 * The medals are the one piece of presentation the page adds, and they follow the
 * server's `rank` rather than the row's position — so two students sharing rank 1 both
 * get a gold medal, which is what sharing a rank means.
 */


const PAGE_SIZE = 20

/**
 * The top three get a medal *icon* beside their rank, not an emoji in place of it.
 *
 * The number is what a reader needs — "#4" and "#3" have to be comparable — so the rank
 * is always printed, and the icon is `aria-hidden` decoration on top of it. Emoji
 * medals rendered differently on every platform, replaced the rank rather than
 * decorating it, and were read out mid-name by a screen reader.
 */
function RankMark({ rank }: { rank: number }) {
  const medal = rank <= 3
  return (
    <span className={styles.rank}>
      {medal && <Icon name="ph-medal" weight="bold" size="sm" className={styles[`medal${rank}`]} />}
      <span>#{rank}</span>
    </span>
  )
}

export default function Leaderboard() {
  const { state } = useAuth()
  const ownClass = state.status === 'student' ? state.student.classLevel : null
  const ownStudentId = state.status === 'student' ? state.student.studentId : null

  const [scope, setScope] = useState<LeaderboardScope>('overall')
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time')
  const [classLevel, setClassLevel] = useState<ClassLevel>(ownClass ?? 'Class 9')
  const [page, setPage] = useState(1)

  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // A student's own class is the sensible default for a class board, but it is only
  // known once the session has finished restoring — hence the effect rather than a
  // lazy initial value.
  useEffect(() => {
    if (ownClass) setClassLevel(ownClass)
  }, [ownClass])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        scope,
        period,
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      if (scope === 'class') params.set('classLevel', classLevel)
      setData(await api.get<LeaderboardResponse>(`/leaderboard?${params.toString()}`))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the leaderboard.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [scope, period, page, classLevel])

  useEffect(() => {
    void load()
  }, [load])

  /** Any change of what is being ranked starts again at the top of that board. */
  function changeScope(next: LeaderboardScope) {
    setScope(next)
    setPage(1)
  }

  function changePeriod(next: LeaderboardPeriod) {
    setPeriod(next)
    setPage(1)
  }

  function changeClass(next: ClassLevel) {
    setClassLevel(next)
    setPage(1)
  }

  // How far this caller may page. A signed-out visitor is capped, so the pager stops
  // where the API stops rather than offering a page that would be refused.
  const reachableRows =
    data?.maxRankedDepth != null
      ? Math.min(data.pagination.total, data.maxRankedDepth)
      : (data?.pagination.total ?? 0)
  const lastPage = Math.max(1, Math.ceil(reachableRows / PAGE_SIZE))

  return (
    <StudentShell
      title="Leaderboard"
      subtitle="Every position here is earned — XP comes only from things students actually did."
    >
      {/* --- What is being ranked ---------------------------------------- */}
      <section className={`card ${styles.controls}`}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Board</span>
          <div className={styles.tabs} role="group" aria-label="Leaderboard scope">
            <button
              type="button"
              className={scope === 'overall' ? styles.tabActive : styles.tab}
              aria-pressed={scope === 'overall'}
              onClick={() => changeScope('overall')}
            >
              Overall
            </button>
            <button
              type="button"
              className={scope === 'class' ? styles.tabActive : styles.tab}
              aria-pressed={scope === 'class'}
              onClick={() => changeScope('class')}
            >
              By class
            </button>
          </div>
        </div>

        {scope === 'class' && (
          <div className={styles.controlGroup}>
            <label className={styles.controlLabel} htmlFor="lb-class">
              Class
            </label>
            <select
              id="lb-class"
              className={styles.select}
              value={classLevel}
              onChange={(e) => changeClass(e.target.value as ClassLevel)}
            >
              {CLASS_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                  {level === ownClass ? ' (yours)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Period</span>
          <div className={styles.tabs} role="group" aria-label="Leaderboard period">
            {LEADERBOARD_PERIODS.map((option) => (
              <button
                key={option}
                type="button"
                className={period === option ? styles.tabActive : styles.tab}
                aria-pressed={period === option}
                onClick={() => changePeriod(option)}
              >
                {LEADERBOARD_PERIOD_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* --- Your own standing ------------------------------------------- */}
      {data?.me && (
        <section className={`card ${styles.meCard}`}>
          <div>
            <div className={styles.meRank}>{data.me.rank !== null ? `#${data.me.rank}` : 'Unranked'}</div>
            <div className={styles.meLabel}>
              {data.me.rank !== null ? (
                <>
                  Your position of {data.me.totalRanked.toLocaleString('en-IN')} ranked
                  {scope === 'class' ? ` in ${classLevel}` : ''}
                </>
              ) : (
                // Three different situations reach this line, and the honest summary of
                // all of them is the same: you are not on *this* board.
                <>You are not on this board yet — {LEADERBOARD_PERIOD_LABELS[period].toLowerCase()}</>
              )}
            </div>
          </div>
          <div className={styles.meXp}>
            {data.me.xp.toLocaleString('en-IN')}
            <span> XP</span>
          </div>
        </section>
      )}

      {/* --- The board ---------------------------------------------------- */}
      <section className="card">
        <div className={styles.boardHead}>
          {/* h2: the board is the page's top-level content and there is no section
              heading above it. */}
          <h2>
            {scope === 'class' ? classLevel : 'All students'} · {LEADERBOARD_PERIOD_LABELS[period]}
          </h2>
          {data && data.window.from && (
            <p className={styles.windowNote}>
              Counting XP earned from {data.window.from} to {data.window.to}.
            </p>
          )}
        </div>

        {loading ? (
          <div className={styles.centered}>
            <Spinner />
            <p>Loading the standing…</p>
          </div>
        ) : error ? (
          <div className={styles.centered}>
            <p className="error-text">{error}</p>
            <Button onClick={() => void load()}>Try again</Button>
          </div>
        ) : !data || data.leaderboard.length === 0 ? (
          <div className={styles.centered}>
            <Icon name="ph-trophy" weight="bold" className={styles.emptyIcon} />
            <p>
              {period === 'all_time'
                ? 'Nobody has earned XP here yet.'
                : `No XP has been earned here ${LEADERBOARD_PERIOD_LABELS[period].toLowerCase()}.`}
            </p>
            <p className={styles.emptyNote}>
              XP comes from real activity — practice sessions, mock tests and the daily challenge.
            </p>
          </div>
        ) : (
          <>
            <ol className={styles.board}>
              {data.leaderboard.map((row) => (
                <li
                  key={row.studentId}
                  className={row.studentId === ownStudentId ? styles.rowMine : styles.row}
                  aria-current={row.studentId === ownStudentId ? 'true' : undefined}
                >
                  <RankMark rank={row.rank} />
                  <span className={styles.who}>
                    <span className={styles.name}>
                      {row.displayName}
                      {row.studentId === ownStudentId && <em className={styles.youTag}>You</em>}
                    </span>
                    <span className={styles.meta}>
                      {[row.classLevel, row.schoolName].filter(Boolean).join(' · ') || 'No class recorded'}
                    </span>
                  </span>
                  <span className={styles.xp}>{row.xp.toLocaleString('en-IN')} XP</span>
                </li>
              ))}
            </ol>

            <div className={styles.pager}>
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span className={styles.pagerLabel}>
                Page {data.pagination.page} of {lastPage} · {data.pagination.total.toLocaleString('en-IN')} ranked
              </span>
              <Button variant="outline" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>

            {data.maxRankedDepth != null && data.pagination.total > data.maxRankedDepth && (
              <p className={styles.depthNote}>
                Showing the top {data.maxRankedDepth}. <Link to="/dashboard">Sign in</Link> to see the whole board and
                find yourself in it.
              </p>
            )}
          </>
        )}
      </section>

      <p className={styles.footNote}>
        Equal XP shares a rank, so a board can read 1, 2, 2, 4. Where two students are level, the one who reached the
        total first is listed above. Accounts that are suspended or deactivated do not appear.{' '}
        <Link to="/hall-of-fame" className="link">
          See the Hall of Fame
        </Link>
      </p>
    </StudentShell>
  )
}
