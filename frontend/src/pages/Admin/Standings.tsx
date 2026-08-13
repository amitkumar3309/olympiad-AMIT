import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { CLASS_LEVELS, type AdminLeaderboardRow, type Pagination, type RewardsOverview } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import styles from './Standings.module.css'

interface BoardResponse {
  leaderboard: AdminLeaderboardRow[]
  period: string
  classLevel: string | null
  pagination: Pagination
}

/**
 * Standings as staff see them, plus how the reward catalogue is landing.
 *
 * The difference from the public leaderboard is deliberate and is the whole reason
 * this page exists: the public board shortens names to a first name and a last
 * initial, because the entrants are schoolchildren and that page is indexable.
 * Staff running the competition need the full name, the student ID and the
 * account's status, so a standing can be checked against a real person.
 */
export default function Standings() {
  const { can } = useAuth()
  const canReadRewards = can('rewards:write')

  const [rows, setRows] = useState<AdminLeaderboardRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [period, setPeriod] = useState('all')
  const [classLevel, setClassLevel] = useState('')

  const [overview, setOverview] = useState<RewardsOverview | null>(null)
  const [overviewError, setOverviewError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25', period })
      if (classLevel) params.set('classLevel', classLevel)

      const res = await api.get<BoardResponse>(`/admin/leaderboard?${params.toString()}`)
      setRows(res.leaderboard)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the leaderboard.')
      setRows([])
      setPagination(null)
    } finally {
      setLoading(false)
    }
  }, [page, period, classLevel])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!canReadRewards) return
    let cancelled = false

    api
      .get<{ overview: RewardsOverview }>('/admin/rewards/overview')
      .then((res) => {
        if (!cancelled) setOverview(res.overview)
      })
      .catch((err) => {
        if (!cancelled) setOverviewError(err instanceof ApiError ? err.message : 'Could not load the rewards overview.')
      })

    return () => {
      cancelled = true
    }
  }, [canReadRewards])

  return (
    <AdminShell title="Standings & Rewards">
      <div className={`card ${styles.panel}`}>
        <h3>Leaderboard</h3>
        <p className={styles.hint}>
          Full names and student IDs, unlike the public board — which masks them because the entrants are children and
          that page is indexable. Ranks are positions in the whole ordering, not in the page.
        </p>

        <div className={styles.filters}>
          <select
            className="form-control"
            value={period}
            onChange={(e) => {
              setPage(1)
              setPeriod(e.target.value)
            }}
            aria-label="Filter by period"
          >
            <option value="all">All time</option>
            <option value="month">Last 30 days</option>
            <option value="week">Last 7 days</option>
            <option value="today">Today</option>
          </select>
          <select
            className="form-control"
            value={classLevel}
            onChange={(e) => {
              setPage(1)
              setClassLevel(e.target.value)
            }}
            aria-label="Filter by class"
          >
            <option value="">All classes</option>
            {CLASS_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <Spinner label="Ranking..." />
        ) : rows.length === 0 ? (
          <p className={styles.empty}>
            Nobody has earned XP in this window yet. A board is an aggregation over the activity log, so it is empty
            rather than padded.
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Student ID</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>School</th>
                  <th>Status</th>
                  <th>Level</th>
                  <th>XP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.studentId}>
                    <td className={styles.rank}>{row.rank}</td>
                    <td className={styles.mono}>{row.studentId}</td>
                    <td>{row.fullName ?? '—'}</td>
                    <td className={styles.muted}>{row.classLevel ?? '—'}</td>
                    <td className={styles.muted}>{row.schoolName ?? '—'}</td>
                    <td className={row.status === 'active' ? styles.active : styles.inactive}>{row.status ?? '—'}</td>
                    <td className={styles.muted}>{row.level}</td>
                    <td className={styles.xp}>{row.xp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className={styles.pager}>
            <button disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} ranked
            </span>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>

      {canReadRewards && (
        <div className={`card ${styles.panel}`}>
          <h3>Badges & achievements</h3>
          <p className={styles.hint}>
            How the catalogue is actually landing — the evidence worth having before re-pricing the XP table.
          </p>

          {overviewError && <p className="error-text">{overviewError}</p>}
          {!overview && !overviewError ? (
            <Spinner label="Counting holders..." />
          ) : (
            overview && (
              <>
                <div className={styles.overviewRow}>
                  <div className={styles.overviewStat}>
                    <strong>{overview.totalStudents}</strong>
                    <span>Entrants</span>
                  </div>
                  <div className={styles.overviewStat}>
                    <strong>{overview.earners}</strong>
                    <span>Have earned XP</span>
                  </div>
                  <div className={styles.overviewStat}>
                    <strong>{overview.neverEarned}</strong>
                    <span>No activity recorded</span>
                  </div>
                </div>

                {overview.neverEarned > 0 && (
                  <p className={styles.note}>
                    Registration itself grants XP, so accounts with no activity at all predate the activity log. Those
                    are what <code>scripts/backfill-activity.ts</code> exists to repair.
                  </p>
                )}

                <h4 className={styles.subheading}>Students per level</h4>
                <div className={styles.levels}>
                  {overview.levels.map((row) => (
                    <span key={row.level} className={styles.levelPill}>
                      Level {row.level}: <strong>{row.students}</strong>
                    </span>
                  ))}
                </div>

                <h4 className={styles.subheading}>Achievement holders</h4>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Achievement</th>
                        <th>What it means</th>
                        <th>Holders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.achievements.map((a) => (
                        <tr key={a.code}>
                          <td>
                            <strong>{a.name}</strong>
                          </td>
                          <td className={styles.muted}>{a.description}</td>
                          <td>
                            {a.holders === null ? (
                              <span className={styles.notCounted} title="A consecutive-day streak cannot be counted by aggregation">
                                not counted
                              </span>
                            ) : (
                              a.holders
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={styles.note}>
                  “Not counted” means the condition is a <em>consecutive-day streak</em>, which an aggregation cannot
                  answer — “answered five challenges” and “answered on five consecutive days” are different facts. A
                  plausible-looking number would be the wrong one, so none is shown.
                </p>
              </>
            )
          )}
        </div>
      )}
    </AdminShell>
  )
}
