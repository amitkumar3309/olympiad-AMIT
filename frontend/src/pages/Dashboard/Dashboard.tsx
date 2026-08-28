import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import StudentShell from '../../components/StudentShell'
import EntryFeeBanner from '../../components/EntryFeeBanner'
import { api, ApiError } from '../../api/client'
import { ACTIVITY_LABELS, type ActivityEntry, type DashboardData, type Pagination } from '../../api/types'
import styles from './Dashboard.module.css'

/**
 * Code-split because it renders question content through KaTeX (~300 KB). Every
 * student opens this dashboard, so that cost is paid only when their class actually
 * has a published challenge to show. See `DailyChallengeCard.tsx`.
 */
const DailyChallengeCard = lazy(() => import('./DailyChallengeCard'))

/**
 * The student dashboard.
 *
 * **Every figure on this page comes from `GET /me/dashboard`.** The version this
 * replaced showed three hardcoded stat tiles ("1,280 challenges solved today",
 * "8.91s fastest solve", "450+ participating schools") and a three-name leaderboard
 * of invented students — none of it connected to anything. There is now no constant
 * on this page that a student could mistake for data.
 *
 * Where a panel has nothing to show, it renders an explicit empty state that says
 * *why* it is empty. That distinction matters: "you have not taken a test yet" and
 * "exams are not running yet" are different messages, and showing a zero would imply
 * the wrong one.
 */

interface DashboardResponse {
  dashboard: DashboardData
}

/** "today", "yesterday", or a short date — for the activity feed. */
function relativeDay(occurredOn: string, today: string): string {
  if (occurredOn === today) return 'Today'
  const day = Date.parse(`${occurredOn}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  const daysAgo = Math.round((now - day) / 86_400_000)
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return `${daysAgo} days ago`
  return new Date(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * Activity beyond the newest few the dashboard payload carries. Held separately so
   * a reload of the dashboard does not silently discard what the student has paged
   * through, and so the feed has one source of truth: `extraActivity` is appended to
   * `data.activity`, never merged into it.
   */
  const [extraActivity, setExtraActivity] = useState<ActivityEntry[]>([])
  const [activityPage, setActivityPage] = useState(1)
  const [activityTotal, setActivityTotal] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<DashboardResponse>('/me/dashboard')
      setData(res.dashboard)
      // A fresh dashboard resets the feed, otherwise a newly recorded event would
      // appear above rows the student had already paged past and read as a duplicate.
      setExtraActivity([])
      setActivityPage(1)
      setActivityTotal(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Pages the full feed from `GET /me/activity`. Asks for the page *after* what is
   * already on screen, using the dashboard's own page size so the offsets line up.
   */
  const loadMoreActivity = useCallback(async () => {
    if (!data) return
    setLoadingMore(true)
    try {
      const limit = data.activity.length || 8
      const next = activityPage + 1
      const res = await api.get<{ entries: ActivityEntry[]; pagination: Pagination }>(
        `/me/activity?page=${next}&limit=${limit}`,
      )
      setExtraActivity((current) => [...current, ...res.entries])
      setActivityPage(next)
      setActivityTotal(res.pagination.total)
    } catch {
      // A failed "load more" must not blank the feed already on screen, so the
      // error is swallowed and the button simply stays available to retry.
      setActivityTotal(null)
    } finally {
      setLoadingMore(false)
    }
  }, [data, activityPage])

  useEffect(() => {
    void load()
  }, [load])

  return (
    // The sidebar, topbar, theme toggle and sign-out all live in StudentShell now,
    // so they persist across every student page instead of existing only here.
    <StudentShell
      title={<>Welcome back, {data?.student.firstName ?? data?.student.fullName ?? 'Champion'} 👋</>}
      subtitle={
        data ? (
          <>
            Student ID: {data.student.studentId}
            {data.student.classLevel ? ` · ${data.student.classLevel}` : ''}
          </>
        ) : (
          'Loading your details…'
        )
      }
    >
      <>
        {loading && (
          <div className={styles.centered}>
            <Spinner />
            <p>Loading your progress…</p>
          </div>
        )}

        {!loading && error && (
          <div className={`card ${styles.centered}`}>
            <h3>Could not load your dashboard</h3>
            <p className="error-text">{error}</p>
            <Button onClick={() => void load()}>Try again</Button>
          </div>
        )}

        {/* Sits above everything and renders nothing once the fee is paid or switched
            off. Outside the `data` guard on purpose: whether the student has entered
            does not depend on their dashboard figures loading. */}
        <EntryFeeBanner />

        {!loading && !error && data && (
          <>
            {/* -----------------------------------------------------------
                Progress summary — XP, level, streak
            ----------------------------------------------------------- */}
            <section className={styles.statRow}>
              <div className={`card ${styles.progressCard}`}>
                <div className={styles.progressHead}>
                  <div>
                    <div className={styles.levelBadge}>Level {data.progress.level}</div>
                    <div className={styles.xpValue}>{data.progress.xp.toLocaleString()} XP</div>
                  </div>
                  <i className={`ph-bold ph-trend-up ${styles.progressIcon}`} />
                </div>
                <div className={styles.meter} role="img" aria-label={`${data.progress.percentToNextLevel}% to level ${data.progress.level + 1}`}>
                  <div className={styles.meterFill} style={{ width: `${data.progress.percentToNextLevel}%` }} />
                </div>
                <p className={styles.progressHint}>
                  {data.progress.xpForNextLevel - data.progress.xpIntoLevel} XP to level {data.progress.level + 1}
                </p>
              </div>

              <div className={`card ${styles.tile}`}>
                <i className={`ph-bold ph-flame ${styles.tileIcon}`} />
                <div>
                  <div className={styles.tileValue}>
                    {data.progress.streak.current} {data.progress.streak.current === 1 ? 'day' : 'days'}
                  </div>
                  <div className={styles.tileLabel}>
                    Current streak
                    {data.progress.streak.longest > data.progress.streak.current && ` · best ${data.progress.streak.longest}`}
                  </div>
                  {!data.progress.streak.countedToday && data.progress.streak.current > 0 && (
                    <p className={styles.tileNote}>Visit today to keep it going.</p>
                  )}
                </div>
              </div>

              <div className={`card ${styles.tile}`}>
                <i className={`ph-bold ph-trophy ${styles.tileIcon}`} />
                <div>
                  <div className={styles.tileValue}>
                    {data.leaderboard.me.rank !== null ? `#${data.leaderboard.me.rank}` : '—'}
                  </div>
                  <div className={styles.tileLabel}>
                    {data.leaderboard.me.rank !== null
                      ? `Rank of ${data.leaderboard.me.totalRanked} ranked`
                      : 'Not ranked yet'}
                  </div>
                  {data.leaderboard.me.rank === null && <p className={styles.tileNote}>Earn XP to join the leaderboard.</p>}
                </div>
              </div>

              <div className={`card ${styles.tile}`}>
                <i className={`ph-bold ph-medal ${styles.tileIcon}`} />
                <div>
                  <div className={styles.tileValue}>
                    {data.achievements.earnedCount}/{data.achievements.total}
                  </div>
                  <div className={styles.tileLabel}>Achievements earned</div>
                </div>
              </div>
            </section>

            <div className={styles.grid}>
              {/* ---------------------------------------------------------
                  Recent test performance
              --------------------------------------------------------- */}
              <div className="card">
                <h3>📄 Recent test performance</h3>
                {data.recentTests.length === 0 ? (
                  <div className={styles.empty}>
                    <i className="ph-bold ph-hourglass" />
                    <p>
                      <strong>No results yet.</strong> Scored exams are not running yet, so there is nothing to report
                      here — your marks and accuracy will appear as soon as you sit one.
                    </p>
                  </div>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Submitted</th>
                        <th>Score</th>
                        <th>Accuracy</th>
                        <th>Questions</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentTests.map((test) => (
                        <tr key={test.id}>
                          <td>{test.submittedAt ? new Date(test.submittedAt).toLocaleDateString() : '—'}</td>
                          <td className={styles.mono}>{test.totalScore}</td>
                          <td className={styles.mono}>{test.accuracy}%</td>
                          <td className={styles.mono}>{test.questionCount}</td>
                          <td className={styles.mono}>{formatDuration(test.timeTakenSeconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ---------------------------------------------------------
                  Recent activity
              --------------------------------------------------------- */}
              <div className="card">
                <h3>🕘 Recent activity</h3>
                {data.activity.length === 0 ? (
                  <div className={styles.empty}>
                    <i className="ph-bold ph-list-dashes" />
                    <p>Nothing recorded yet. Your activity will appear here as you use the platform.</p>
                  </div>
                ) : (
                  <>
                    <ul className={styles.feed}>
                      {[...data.activity, ...extraActivity].map((entry) => {
                        const meta = ACTIVITY_LABELS[entry.type]
                        return (
                          <li key={entry.id}>
                            <i className={`ph-bold ${meta?.icon ?? 'ph-dot'}`} />
                            <div className={styles.feedBody}>
                              <span className={styles.feedLabel}>{meta?.label ?? entry.type}</span>
                              {entry.detail && <span className={styles.feedDetail}>{entry.detail}</span>}
                            </div>
                            <span className={styles.feedDay}>{relativeDay(entry.occurredOn, data.today)}</span>
                            {entry.xpAwarded > 0 && <span className={styles.feedXp}>+{entry.xpAwarded}</span>}
                          </li>
                        )
                      })}
                    </ul>

                    {/* Offered whenever a full first page came back, since that is the
                        only signal that more may exist before we have asked. Once the
                        server has told us the total, that decides it. */}
                    {(activityTotal === null
                      ? data.activity.length >= 8
                      : data.activity.length + extraActivity.length < activityTotal) && (
                      <button
                        type="button"
                        className={styles.loadMore}
                        onClick={() => void loadMoreActivity()}
                        disabled={loadingMore}
                      >
                        {loadingMore ? 'Loading…' : 'Show earlier activity'}
                      </button>
                    )}
                    {activityTotal !== null && data.activity.length + extraActivity.length >= activityTotal && (
                      <p className={styles.feedEnd}>That’s your whole history — {activityTotal} events.</p>
                    )}
                  </>
                )}
              </div>

              {/* ---------------------------------------------------------
                  Available challenges
              --------------------------------------------------------- */}
              <div className="card">
                <h3>🎯 Available practice</h3>
                {data.challenges.length === 0 ? (
                  <div className={styles.empty}>
                    <i className="ph-bold ph-books" />
                    <p>
                      {data.student.classLevel
                        ? `No questions have been published for ${data.student.classLevel} yet. Check back soon.`
                        : 'Add your class to your profile to see the practice available to you.'}
                    </p>
                    {!data.student.classLevel && (
                      <Link to="/profile" className={styles.emptyAction}>
                        Update my profile
                      </Link>
                    )}
                  </div>
                ) : (
                  <ul className={styles.challenges}>
                    {data.challenges.map((challenge) => (
                      <li key={challenge.subjectId}>
                        <div>
                          {/*
                            The class, not the subject. This row is per-subject in the API and there
                            is exactly one, so printing its name told a student "Mathematics" on a
                            mathematics olympiad's dashboard. The class is the fact that actually
                            varies between two students looking at this tile.
                          */}
                          <span className={styles.challengeName}>{data.student.classLevel}</span>
                          <span className={styles.challengeMeta}>{challenge.difficulties.join(' · ')}</span>
                        </div>
                        <span className={styles.challengeCount}>
                          {challenge.questionCount} {challenge.questionCount === 1 ? 'question' : 'questions'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* ---------------------------------------------------------
                  Today's challenge — a real question from the published bank
              --------------------------------------------------------- */}
              <Suspense
                fallback={
                  <div className="card">
                    <h3>🎲 Today’s challenge</h3>
                    <p className={styles.challengeLoading}>Loading…</p>
                  </div>
                }
              >
                <DailyChallengeCard />
              </Suspense>

              {/* ---------------------------------------------------------
                  Achievements
              --------------------------------------------------------- */}
              <div className="card">
                <h3>🏅 Achievements</h3>
                {data.achievements.earned.length > 0 && (
                  <ul className={styles.badges}>
                    {data.achievements.earned.map((achievement) => (
                      <li key={achievement.code} title={achievement.description}>
                        <i className={`ph-bold ${achievement.icon}`} />
                        {achievement.name}
                      </li>
                    ))}
                  </ul>
                )}
                {data.achievements.next.length > 0 && (
                  <>
                    <p className={styles.subhead}>Closest to earning</p>
                    <ul className={styles.nextList}>
                      {data.achievements.next.map((achievement) => (
                        <li key={achievement.code}>
                          <div className={styles.nextHead}>
                            <span>{achievement.name}</span>
                            <span className={styles.mono}>
                              {achievement.progress}/{achievement.target}
                            </span>
                          </div>
                          <div className={styles.meterSmall}>
                            <div
                              className={styles.meterFill}
                              style={{ width: `${Math.round((achievement.progress / achievement.target) * 100)}%` }}
                            />
                          </div>
                          <p className={styles.nextDesc}>{achievement.description}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {data.achievements.earned.length === 0 && data.achievements.next.length === 0 && (
                  <div className={styles.empty}>
                    <i className="ph-bold ph-medal" />
                    <p>No achievements defined yet.</p>
                  </div>
                )}
              </div>

              {/* ---------------------------------------------------------
                  Leaderboard
              --------------------------------------------------------- */}
              <div className="card">
                <h3>🏆 Leaderboard</h3>
                {data.leaderboard.top.length === 0 ? (
                  <div className={styles.empty}>
                    <i className="ph-bold ph-trophy" />
                    <p>Nobody has earned XP yet. Be the first.</p>
                  </div>
                ) : (
                  <ul className={styles.leaderboard}>
                    {data.leaderboard.top.map((row) => (
                      <li key={row.studentId} className={row.studentId === data.student.studentId ? styles.meRow : undefined}>
                        <span className={styles.rank}>#{row.rank}</span>
                        <span className={styles.lbName}>
                          {row.studentId === data.student.studentId ? 'You' : row.displayName}
                        </span>
                        {row.schoolName && <span className={styles.lbSchool}>{row.schoolName}</span>}
                        <span className={styles.lbXp}>{row.xp.toLocaleString()} XP</span>
                      </li>
                    ))}
                  </ul>
                )}
                {data.leaderboard.me.rank !== null && data.leaderboard.me.rank > data.leaderboard.top.length && (
                  <p className={styles.subhead}>
                    You are #{data.leaderboard.me.rank} of {data.leaderboard.me.totalRanked} with{' '}
                    {data.leaderboard.me.xp.toLocaleString()} XP.
                  </p>
                )}
                {/* This card is the overall, all-time top five. The full board adds the
                    class and period views — and is the same ranking, from the same
                    service, so the two cannot disagree. */}
                <p className={styles.subhead}>
                  <Link to="/leaderboard">Full leaderboard</Link> · <Link to="/hall-of-fame">Hall of Fame</Link>
                </p>
              </div>

              {/* ---------------------------------------------------------
                  Quick actions
              --------------------------------------------------------- */}
              <div className="card">
                <h3>Quick actions</h3>
                <div className={styles.actions}>
                  <Link to="/profile" className={styles.actionCard}>
                    <i className="ph-bold ph-user-circle" />
                    My Profile
                  </Link>
                  <Link to="/practice" className={styles.actionCard}>
                    <i className="ph-bold ph-target" />
                    Practice Zone
                  </Link>
                  <Link to="/analytics" className={styles.actionCard}>
                    <i className="ph-bold ph-chart-line-up" />
                    View Analytics
                  </Link>
                  <Link to="/certificate" className={styles.actionCard}>
                    <i className="ph-bold ph-medal" />
                    My Certificate
                  </Link>
                </div>
              </div>
            </div>
          </>
        )}
      </>
    </StudentShell>
  )
}
