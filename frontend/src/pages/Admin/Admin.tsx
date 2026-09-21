import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  Icon,
  SkeletonCards,
  StatTile,
  Table,
  TableScroll,
} from '../../components/ui'
import ChartCard from '../../components/ChartCard'
import { useAuth } from '../../context/AuthContext'
import { humanizeError } from '../../lib/errors'
import { api } from '../../api/client'
import type { AdminStats, ManagedAccount, Pagination, Permission } from '../../api/types'
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

/**
 * The tasks an administrator actually arrives to do.
 *
 * Permission-filtered like the navigation, from the same array the backend sent — a
 * shortcut to a page somebody may not open is worse than no shortcut. Deliberately
 * short: this is the top of the page, not a second copy of the menu.
 */
const QUICK_ACTIONS: Array<{ to: string; label: string; description: string; icon: string; permission: Permission }> = [
  {
    to: '/admin/questions/new',
    label: 'Add a question',
    description: 'Write one by hand',
    icon: 'ph-plus-circle',
    permission: 'questions:write',
  },
  {
    to: '/admin/questions/import',
    label: 'Bulk import',
    description: 'Excel, Word or a photograph',
    icon: 'ph-upload-simple',
    permission: 'questions:write',
  },
  {
    to: '/admin/users',
    label: 'Students',
    description: 'Search, filter and export',
    icon: 'ph-users-three',
    permission: 'students:read',
  },
  {
    to: '/admin/mock-tests',
    label: 'Mock tests',
    description: 'Author and publish papers',
    icon: 'ph-exam',
    permission: 'mocktests:write',
  },
]

interface Overview {
  total: number
  admins: number
  suspended: number
  recent: ManagedAccount[]
}

export default function Admin() {
  const { can } = useAuth()

  /*
   * Always true now that the route is gated on this very permission, and kept as the
   * effect's guard rather than deleted: it is what stops the three admin queries being
   * fired by a render that should not have happened, and it costs one boolean.
   */
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
        setOverviewError(humanizeError(err, { fallback: 'Could not load the overview.' }))
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

  /*
   * There is no sign-in form here any more (Milestone 28).
   *
   * This page used to render an "Administrator sign in" card for a guest, which is why
   * the route was left ungated and why `RequirePermission` defaulted its `signInPath`
   * to `/admin`. That made the product advertise where its admin door was, and it told
   * a *promoted* admin — an ordinary student account with a role — that they were at
   * the wrong one. `88d41fb` merged the two forms; this removes the form that was left
   * behind, and the route is gated on `students:read` in `App.tsx` instead.
   *
   * So the three states this used to handle are all handled before the page renders:
   * loading and guest by the guard, and "signed in without permission" by the
   * `Unauthorized` it renders. Keeping copies here would be dead code that looks live.
   */

  return (
    <AdminShell title="Dashboard" subtitle="Every figure here is counted from a collection">
      {overviewError && <Alert tone="danger">{overviewError}</Alert>}

      {/*
        The operational shortcuts, first. An administrator arrives with a task — a
        question to add, a paper to publish, an import to review — and the figures
        below are context for it rather than the reason they opened the page.
      */}
      <nav className={styles.quickGrid} aria-label="Common tasks">
        {QUICK_ACTIONS.filter((action) => can(action.permission)).map((action) => (
          <Link key={action.to} to={action.to} className={styles.quickCard}>
            <span className={styles.quickIcon}>
              <Icon name={action.icon} weight="bold" size="md" />
            </span>
            <span className={styles.quickText}>
              <span className={styles.quickTitle}>{action.label}</span>
              <span className={styles.quickMeta}>{action.description}</span>
            </span>
            <Icon name="ph-caret-right" size="sm" className={styles.quickChevron} />
          </Link>
        ))}
      </nav>

      {loadingOverview ? (
        <SkeletonCards count={3} label="Loading account figures" />
      ) : (
        overview && (
          <>
            <div className={styles.statRow}>
              <StatTile icon="ph-users" value={overview.total} label="Accounts registered" />
              <StatTile icon="ph-shield-check" value={overview.admins} label="Administrator accounts" />
              <StatTile
                icon="ph-prohibit"
                tone={overview.suspended > 0 ? 'warning' : 'neutral'}
                value={overview.suspended}
                label="Suspended accounts"
              />
            </div>

            <Card className={styles.tableCard}>
              <CardHeader
                title="Recently registered"
                size="sm"
                as="h2"
                actions={
                  <ButtonLink to="/admin/users" size="sm" variant="secondary" iconAfter="ph-arrow-right">
                    Manage all accounts
                  </ButtonLink>
                }
              />
              {overview.recent.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon="ph-users"
                  title="No accounts yet"
                  description="Registrations appear here as students sign up. The figures above are counted from the same collection."
                />
              ) : (
                <TableScroll label="Recent registrations">
                  <Table density="compact">
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
                          <td>
                            <Badge tone={account.role === 'student' ? 'neutral' : 'primary'} size="sm">
                              {account.role}
                            </Badge>
                          </td>
                          <td>
                            <Badge
                              tone={
                                account.status === 'active'
                                  ? 'success'
                                  : account.status === 'suspended' || account.status === 'blocked'
                                    ? 'danger'
                                    : 'neutral'
                              }
                              size="sm"
                            >
                              {account.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableScroll>
              )}
            </Card>
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
            tone="primary"
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
