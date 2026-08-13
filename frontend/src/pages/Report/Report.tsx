import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import ChartCard from '../../components/ChartCard'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import type { AnalyticsResponse } from '../../api/types'
import styles from './Report.module.css'

/**
 * The printable student report.
 *
 * Two things were wrong here. It read `data.totalQuestionsAttempted`, `overallAccuracy`
 * and `learningCurve` straight out of the analytics response — which used to be filled
 * with invented figures, so the report confidently stated an accuracy the student had
 * never been measured on. And when that fabrication was removed, `data` became null and
 * this page's `{!data && !error && <Spinner/>}` left it **spinning forever**.
 *
 * Both were fixed, and **Milestone 15 filled the gap the second fix left open**: the
 * accuracy and topic sections are no longer waiting on a scored exam that did not
 * exist, because analytics are now derived from every submitted practice session, mock
 * test, daily challenge and official exam. The page reads the same derived response the
 * Analytics page does and computes nothing of its own.
 */
export default function Report() {
  const { state } = useAuth()
  const [result, setResult] = useState<AnalyticsResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (state.status !== 'student') return
    let cancelled = false
    api
      .get<AnalyticsResponse>(`/analytics/${state.student.studentId}`)
      .then((res) => {
        if (!cancelled) setResult(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load report.')
      })
    return () => {
      cancelled = true
    }
  }, [state])

  const studentName = state.status === 'student' ? state.student.fullName : ''
  const analytics = result?.analytics ?? null
  const xpByDay = result?.xpByDay ?? []
  const totalXp = xpByDay.reduce((sum, point) => sum + point.xp, 0)

  function shortDay(day: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
  }

  return (
    <StudentShell title="Student Report" subtitle={`A summary of ${studentName}'s Olympiad journey so far.`}>
      <div className={styles.wrap}>
        <div className={styles.header}>
          <Button variant="outline" onClick={() => window.print()}>
            <i className="ph ph-printer" /> Download Report
          </Button>
        </div>

        {error && <p className="error-text">{error}</p>}
        {!result && !error && <Spinner label="Preparing your report..." />}

        {result && (
          <div className={styles.reportBody}>
            {/* ----------------------------------------------------------
                Recorded activity — real
            ---------------------------------------------------------- */}
            <div className="card">
              <h3>Activity summary</h3>
              {xpByDay.length > 0 ? (
                <p>
                  You have earned <strong>{totalXp} XP</strong> across{' '}
                  <strong>
                    {xpByDay.length} active {xpByDay.length === 1 ? 'day' : 'days'}
                  </strong>{' '}
                  in the last 30 days, with a best day of <strong>{Math.max(...xpByDay.map((p) => p.xp))} XP</strong>.
                </p>
              ) : (
                <p>
                  No activity has been recorded in the last 30 days yet. Your report fills in as you use the platform —
                  start from your <Link to="/dashboard">dashboard</Link>.
                </p>
              )}
            </div>

            {xpByDay.length > 0 && (
              <ChartCard
                title="XP earned per day"
                type="line"
                label="XP"
                labels={xpByDay.map((p) => shortDay(p.day))}
                data={xpByDay.map((p) => p.xp)}
              />
            )}

            {/* ----------------------------------------------------------
                Exam-derived sections — real when they exist, honest when not
            ---------------------------------------------------------- */}
            {analytics?.hasData ? (
              <>
                <div className="card">
                  <h3>Accuracy</h3>
                  <p>
                    Out of <strong>{analytics.overall.answered}</strong> questions answered across{' '}
                    <strong>{analytics.overall.attempts}</strong> submitted sittings, your overall accuracy is{' '}
                    <strong>{analytics.overall.accuracyPercent}%</strong>
                    {analytics.overall.averageSecondsPerQuestion !== null && (
                      <>
                        , at an average pace of <strong>{analytics.overall.averageSecondsPerQuestion}s</strong> per
                        question
                      </>
                    )}
                    .
                  </p>
                </div>

                {analytics.accuracyByDay.length > 1 && (
                  <ChartCard
                    title="Accuracy over time"
                    type="line"
                    label="Accuracy %"
                    labels={analytics.accuracyByDay.map((point) => shortDay(point.day))}
                    data={analytics.accuracyByDay.map((point) => point.accuracyPercent ?? 0)}
                  />
                )}

                <div className="card">
                  <h3>Topic breakdown</h3>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Topic</th>
                        <th>Subject</th>
                        <th>Answered</th>
                        <th>Correct</th>
                        <th>Accuracy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.byTopic.map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>{row.subjectName ?? '—'}</td>
                          <td>{row.answered}</td>
                          <td>{row.correct}</td>
                          {/* Never `0%` for an unmeasured row — see the API's null contract. */}
                          <td>{row.accuracyPercent === null ? '—' : `${row.accuracyPercent}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className={`card ${styles.pending}`}>
                <h3>Accuracy and topic breakdown</h3>
                <p>
                  These are worked out from questions you have actually answered, and you have not submitted anything
                  yet. Sit a practice session, a mock test or the daily challenge and this section fills in by itself —
                  it deliberately stays blank rather than estimating.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </StudentShell>
  )
}
