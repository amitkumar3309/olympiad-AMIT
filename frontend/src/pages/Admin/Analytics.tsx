import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { PlatformAnalytics } from '../../api/types'
import AdminShell from './AdminShell'
import ChartCard from '../../components/ChartCard'
import StatTile from '../../components/StatTile'
import Spinner from '../../components/Spinner'
import {
  Alert,
  Table,
  TableScroll,
} from '../../components/ui'
import styles from './Analytics.module.css'

/** `2026-08-10` → `10 Aug`, for a readable chart axis. */
function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * Platform analytics.
 *
 * Every figure on this page is counted from a collection. Where nothing has
 * happened it shows a zero, or an explicit "no data yet" for an average — because
 * "no papers have been sat" and "everybody scored zero" are different facts, and a
 * 0% would read as the second. Nothing here is estimated or projected.
 */
export default function Analytics() {
  const [days, setDays] = useState(30)
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    api
      .get<{ analytics: PlatformAnalytics }>(`/admin/analytics?days=${days}`)
      .then((res) => {
        if (!cancelled) setAnalytics(res.analytics)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load analytics.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [days])

  if (loading) return <AdminShell title="Analytics"><Spinner label="Counting..." /></AdminShell>
  if (error)
    return (
      <AdminShell title="Analytics">
        <Alert tone="danger">{error}</Alert>
      </AdminShell>
    )
  if (!analytics) return null

  const { accounts, engagement, content, assessment, xp, byClass } = analytics
  const maxClassStudents = Math.max(1, ...byClass.map((row) => row.students))

  return (
    <AdminShell title="Analytics">
      <div className={styles.toolbar}>
        <label htmlFor="a-days">Window</label>
        <select id="a-days" className="form-control" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <span className={styles.stamp}>Counted {new Date(analytics.generatedAt).toLocaleString()}</span>
      </div>

      <h3 className={styles.heading}>Accounts</h3>
      <div className={styles.statRow}>
        <StatTile icon="ph-users" value={String(accounts.total)} label="Entrants Registered" />
        <StatTile icon="ph-seal-check" value={String(accounts.verified)} label="Email Verified" />
        <StatTile icon="ph-hourglass" value={String(accounts.unverified)} label="Awaiting Verification" />
        <StatTile icon="ph-shield-check" value={String(accounts.admins)} label="Administrators" />
      </div>
      <div className={styles.statRow}>
        <StatTile icon="ph-check-circle" value={String(accounts.active)} label="Active" />
        <StatTile icon="ph-pause-circle" value={String(accounts.suspended)} label="Suspended" />
        <StatTile icon="ph-prohibit" value={String(accounts.blocked)} label="Blocked" />
        <StatTile icon="ph-archive" value={String(accounts.deactivated)} label="Deactivated" />
      </div>

      <h3 className={styles.heading}>Engagement</h3>
      <div className={styles.statRow}>
        <StatTile icon="ph-pulse" value={String(engagement.everActive)} label="Ever Active" />
        <StatTile icon="ph-calendar-check" value={String(engagement.activeLast7)} label="Active (7 days)" />
        <StatTile icon="ph-calendar" value={String(engagement.activeLast30)} label="Active (30 days)" />
      </div>
      <div className={styles.chartRow}>
        <ChartCard
          title={`New registrations per day (last ${days} days)`}
          type="bar"
          label="Registrations"
          labels={engagement.registrationsByDay.map((p) => shortDay(p.day))}
          data={engagement.registrationsByDay.map((p) => p.count)}
        />
        <ChartCard
          title={`Active students per day (last ${days} days)`}
          type="line"
          label="Active students"
          labels={engagement.activeStudentsByDay.map((p) => shortDay(p.day))}
          data={engagement.activeStudentsByDay.map((p) => p.count)}
        />
      </div>

      <h3 className={styles.heading}>Content</h3>
      <div className={styles.statRow}>
        <StatTile icon="ph-list-checks" value={`${content.questionsPublished}/${content.questionsTotal}`} label="Questions Published" />
        <StatTile icon="ph-exam" value={`${content.mockTestsPublished}/${content.mockTestsTotal}`} label="Mock Tests Published" />
        <StatTile icon="ph-images" value={String(content.galleryPublished)} label="Gallery Photos" />
        <StatTile icon="ph-megaphone" value={String(content.announcementsPublished)} label="Announcements Live" />
      </div>

      <h3 className={styles.heading}>Assessment</h3>
      <div className={styles.statRow}>
        <StatTile icon="ph-notebook" value={String(assessment.practiceSessionsSubmitted)} label="Practice Sessions Submitted" />
        <StatTile icon="ph-exam" value={String(assessment.mockAttemptsSubmitted)} label="Mock Papers Sat" />
        <StatTile
          icon="ph-percent"
          // `null` is rendered as a dash, not as 0% — the figure does not exist yet.
          value={assessment.mockAveragePercent === null ? '—' : `${assessment.mockAveragePercent}%`}
          label="Mean Mock Score"
        />
        <StatTile
          icon="ph-dice-five"
          value={`${assessment.dailyChallengeCorrect}/${assessment.dailyChallengeAttempts}`}
          label="Daily Challenges Correct"
        />
      </div>
      {assessment.mockAveragePercent === null && (
        <p className={styles.note}>
          No mock paper has been submitted yet, so there is no mean score to report. This shows a dash rather than 0%,
          which would read as “everybody scored nothing”.
        </p>
      )}
      <p className={styles.note}>
        The <strong>official exam</strong> is not built, and nothing writes to its collections — so there are
        deliberately no official results, ranks or certificates counted here. The assessment figures above come from
        mock tests, practice sessions and daily challenges, which are real.
      </p>

      <h3 className={styles.heading}>XP</h3>
      <div className={styles.statRow}>
        <StatTile icon="ph-lightning" value={String(xp.awardedTotal)} label="Total XP Awarded" />
        <StatTile icon="ph-user-focus" value={String(xp.earners)} label="Students With XP" />
        <StatTile icon="ph-chart-line" value={xp.averagePerEarner === null ? '—' : String(xp.averagePerEarner)} label="Average XP Per Earner" />
      </div>

      <h3 className={styles.heading}>By class</h3>
      <div className={`card ${styles.classCard}`}>
        {/* The one table in the product with no scroll wrapper at all, so it pushed a
            375px screen sideways — found in the Phase B browser pass, fixed here. */}
        <TableScroll label="Registrations and activity by class">
          <Table density="compact">
          <thead>
            <tr>
              <th>Class</th>
              <th>Registered</th>
              <th>Active</th>
              <th>XP earned</th>
              <th aria-label="Share of registrations" />
            </tr>
          </thead>
          <tbody>
            {byClass.map((row) => (
              <tr key={row.classLevel}>
                <td>{row.classLevel}</td>
                <td>{row.students}</td>
                <td className={styles.muted}>{row.activeStudents}</td>
                <td className={styles.muted}>{row.xp}</td>
                <td className={styles.barCell}>
                  <span className={styles.bar} style={{ width: `${(row.students / maxClassStudents) * 100}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
          </Table>
        </TableScroll>
        <p className={styles.note}>
          Every offered class is listed, including those with nobody in them — a missing row would read as missing data,
          whereas a zero is a fact about the cohort.
        </p>
      </div>
    </AdminShell>
  )
}
