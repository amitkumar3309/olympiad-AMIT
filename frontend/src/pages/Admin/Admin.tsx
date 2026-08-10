import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/Button'
import StatTile from '../../components/StatTile'
import ChartCard from '../../components/ChartCard'
import Spinner from '../../components/Spinner'
import Unauthorized from '../../components/Unauthorized'
import { useAuth, ApiError } from '../../context/AuthContext'
import { api } from '../../api/client'
import type { AdminStats, ManagedAccount, Pagination } from '../../api/types'
import AdminShell from './AdminShell'
import styles from './Admin.module.css'

interface StudentListResponse {
  students: ManagedAccount[]
  pagination: Pagination
}

/** `2026-08-10` → `10 Aug`, for a readable chart axis. */
function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

interface Overview {
  total: number
  admins: number
  suspended: number
  recent: ManagedAccount[]
}

export default function Admin() {
  const { state, can, adminLogin } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canReadStudents = can('students:read')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [stats, setStats] = useState<AdminStats | null>(null)

  useEffect(() => {
    if (!canReadStudents) return
    let cancelled = false

    async function loadOverview() {
      setLoadingOverview(true)
      setOverviewError('')
      try {
        // Three narrow queries rather than one wide one: each returns a real count
        // from the database, so no figure on this page is invented.
        const [all, admins, suspended] = await Promise.all([
          api.get<StudentListResponse>('/admin/students?limit=5'),
          api.get<StudentListResponse>('/admin/students?role=admin&limit=1'),
          api.get<StudentListResponse>('/admin/students?status=suspended&limit=1'),
        ])
        if (cancelled) return
        setOverview({
          total: all.pagination.total,
          admins: admins.pagination.total,
          suspended: suspended.pagination.total,
          recent: all.students,
        })
      } catch (err) {
        if (cancelled) return
        setOverviewError(err instanceof ApiError ? err.message : 'Could not load the overview.')
      } finally {
        if (!cancelled) setLoadingOverview(false)
      }
    }

    // The charts are secondary to the figures above them, so a failure here leaves
    // them simply absent rather than pushing an error banner over the whole page.
    void api
      .get<{ stats: AdminStats }>('/admin/stats')
      .then((res) => {
        if (!cancelled) setStats(res.stats)
      })
      .catch(() => {
        if (!cancelled) setStats(null)
      })

    void loadOverview()
    return () => {
      cancelled = true
    }
  }, [canReadStudents])

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await adminLogin(email.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (state.status === 'loading') return <Spinner label="Loading admin portal..." />

  if (state.status === 'guest') {
    return (
      // Follows the global theme rather than forcing dark, which used to make this
      // form dark while the navbar above it stayed light.
      <div className={styles.loginWrap}>
        <form className={`card ${styles.loginCard}`} onSubmit={handleLogin}>
          <h2>Enterprise Admin Portal</h2>
          <p>Sign in to manage students, questions, and analytics.</p>
          {error && <p className="error-text">{error}</p>}
          <div className="form-group">
            <label>Admin Email</label>
            <input className="form-control" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              className="form-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Signing in...' : 'Login'}
          </Button>
          <p className={styles.loginHint}>
            Administrators promoted from a student account sign in from the <Link to="/">home page</Link>.
          </p>
        </form>
      </div>
    )
  }

  // Signed in, but without administrative capability — a student who navigated here.
  if (!canReadStudents) {
    return (
      <Unauthorized
        title="This area is for administrators"
        detail="You are signed in, but your account does not have administrative permissions. Head back to your dashboard to see your own progress."
      />
    )
  }

  return (
    <AdminShell title="Dashboard Overview">
      {overviewError && <p className="error-text">{overviewError}</p>}

      {loadingOverview ? (
        <Spinner label="Loading account figures..." />
      ) : (
        overview && (
          <>
            <div className={styles.statRow}>
              <StatTile icon="ph-users" value={String(overview.total)} label="Accounts Registered" />
              <StatTile icon="ph-shield-check" value={String(overview.admins)} label="Administrator Accounts" />
              <StatTile icon="ph-prohibit" value={String(overview.suspended)} label="Suspended Accounts" />
            </div>

            <div className={`card ${styles.tableCard}`}>
              <div className={styles.tableHead}>
                <h3>Recently Registered</h3>
                <Link to="/admin/users" className={styles.tableLink}>
                  Manage all accounts →
                </Link>
              </div>
              {overview.recent.length === 0 ? (
                <p className={styles.emptyRow}>No accounts have registered yet.</p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Student ID</th>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.recent.map((account) => (
                        <tr key={account.id}>
                          <td>{account.studentId}</td>
                          <td>{account.fullName ?? '—'}</td>
                          <td>{account.role}</td>
                          <td>{account.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )
      )}

      {/* Replaced a hardcoded "Weekly Accuracy Trend" (72, 78, 75, 82, 88, 90, 92
          against Mon–Sun). It was labelled as sample data, but a labelled invention is
          still an invention — and an accuracy trend cannot exist while no answer has
          ever been scored. These two series are things the platform genuinely knows. */}
      {stats && (
        <div className={styles.chartRow}>
          <ChartCard
            title="New registrations per day (last 14 days)"
            type="bar"
            label="Registrations"
            labels={stats.registrationsByDay.map((point) => shortDay(point.day))}
            data={stats.registrationsByDay.map((point) => point.count)}
          />
          <ChartCard
            title="Active students per day (last 14 days)"
            type="line"
            label="Active students"
            labels={stats.activeStudentsByDay.map((point) => shortDay(point.day))}
            data={stats.activeStudentsByDay.map((point) => point.count)}
          />
        </div>
      )}
    </AdminShell>
  )
}
