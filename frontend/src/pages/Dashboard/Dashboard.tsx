import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { ACTIVITY_LABELS, type DashboardData } from '../../api/types'
import styles from './Dashboard.module.css'

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

const NAV_ITEMS = [
  { to: '/dashboard', icon: 'ph-squares-four', label: 'Dashboard' },
  { to: '/profile', icon: 'ph-user-circle', label: 'My Profile' },
  { to: '/exam', icon: 'ph-pencil-line', label: 'Live Exam' },
  { to: '/analytics', icon: 'ph-chart-line-up', label: 'Analytics' },
  { to: '/report', icon: 'ph-file-text', label: 'Report' },
  { to: '/certificate', icon: 'ph-medal', label: 'Certificate' },
]

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
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<DashboardResponse>('/me/dashboard')
      setData(res.dashboard)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <div className={`theme-dark ${styles.shell}`}>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brand}>A.M.I.T Hub</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={item.to === '/dashboard' ? styles.menuItemActive : styles.menuItem}
              onClick={() => setSidebarOpen(false)}
            >
              <i className={`ph-bold ${item.icon}`} /> {item.label}
            </Link>
          ))}
        </nav>
        <button className={styles.logoutBtn} onClick={() => void handleLogout()}>
          <i className="ph-bold ph-sign-out" /> Logout
        </button>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.burger} onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle menu">
            <i className="ph ph-list" />
          </button>
          <div>
            <h1>Welcome back, {data?.student.firstName ?? data?.student.fullName ?? 'Champion'} 👋</h1>
            <p className={styles.studentId}>
              {data ? (
                <>
                  Student ID: {data.student.studentId}
                  {data.student.classLevel ? ` · ${data.student.classLevel}` : ''}
                </>
              ) : (
                'Loading your details…'
              )}
            </p>
          </div>
        </header>

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
                  <ul className={styles.feed}>
                    {data.activity.map((entry) => {
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
                          <span className={styles.challengeName}>{challenge.subjectName}</span>
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
                  <Link to="/exam" className={styles.actionCard}>
                    <i className="ph-bold ph-pencil-line" />
                    Take Live Exam
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
      </div>
    </div>
  )
}
