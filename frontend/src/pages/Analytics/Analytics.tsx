import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Spinner from '../../components/Spinner'
import StatTile from '../../components/StatTile'
import ChartCard from '../../components/ChartCard'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import type { AnalyticsResponse } from '../../api/types'
import styles from './Analytics.module.css'

/**
 * Performance analytics.
 *
 * **This page used to show every student invented figures** — 88% accuracy over 450
 * questions, a rising learning curve, four topic breakdowns and "you are in the top
 * 5% of all national Olympiad participants" — because the API returned a hardcoded
 * fallback whenever no analytics document existed, which is always. That is gone.
 *
 * It now shows the two things separately:
 *  - what is genuinely measured (XP earned per day, from the real activity log),
 *  - and an explicit empty state for everything that needs answered questions,
 *    which nothing records yet.
 */
export default function Analytics() {
  const { state } = useAuth()
  const [result, setResult] = useState<AnalyticsResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (state.status !== 'student') return
    api
      .get<AnalyticsResponse>(`/analytics/${state.student.studentId}`)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load analytics.'))
  }, [state])

  const data = result?.data ?? null
  const xpByDay = result?.xpByDay ?? []
  const totalXp = xpByDay.reduce((sum, point) => sum + point.xp, 0)

  /** `2026-08-10` → `10 Aug`, for a readable axis. */
  function shortDay(day: string): string {
    const parsed = new Date(`${day}T00:00:00Z`)
    return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }

  return (
    <StudentShell title="Performance Analysis" subtitle="What is measured, and what still needs a scored exam">
      <div className={styles.wrap}>
        {error && <p className="error-text">{error}</p>}
        {!result && !error && <Spinner label="Loading your performance data..." />}

        {result && (
          <>
            {/* --------------------------------------------------------------
                Real, measured today: activity and XP
            -------------------------------------------------------------- */}
            {xpByDay.length > 0 ? (
              <>
                <div className={styles.statRow}>
                  <StatTile icon="ph-star" value={totalXp} label="XP earned (last 30 days)" />
                  <StatTile icon="ph-calendar-check" value={xpByDay.length} label="Active days (last 30)" />
                  <StatTile
                    icon="ph-trend-up"
                    value={Math.max(...xpByDay.map((p) => p.xp))}
                    label="Best day (XP)"
                  />
                </div>

                <div className={styles.chartRow}>
                  <ChartCard
                    title="XP earned per day"
                    type="line"
                    label="XP"
                    labels={xpByDay.map((p) => shortDay(p.day))}
                    data={xpByDay.map((p) => p.xp)}
                  />
                </div>
              </>
            ) : (
              <div className="card">
                <h3>No activity recorded yet</h3>
                <p>
                  Your XP and active days will be charted here once you start using the platform. Visit your{' '}
                  <Link to="/dashboard">dashboard</Link> to get going.
                </p>
              </div>
            )}

            {/* --------------------------------------------------------------
                Not measurable yet: everything derived from answered questions
            -------------------------------------------------------------- */}
            {data ? (
              <>
                <div className={styles.statRow}>
                  <StatTile icon="ph-target" value={`${data.overallAccuracy}%`} label="Overall Accuracy" />
                  <StatTile icon="ph-timer" value={`${data.averageSpeedPerQuestion}s`} label="Avg Speed / Question" />
                  <StatTile icon="ph-list-checks" value={data.totalQuestionsAttempted} label="Questions Attempted" />
                </div>

                <div className={styles.chartRow}>
                  <ChartCard
                    title="Learning Curve"
                    type="line"
                    label="Accuracy %"
                    labels={data.learningCurve.map((p) => p.date)}
                    data={data.learningCurve.map((p) => p.accuracy)}
                  />
                  <ChartCard
                    title="Accuracy by Topic"
                    type="bar"
                    label="Correct"
                    color="#4f46e5"
                    labels={data.topicMetrics.map((t) => t.topicName)}
                    data={data.topicMetrics.map((t) => Math.round((t.correct / t.attempted) * 100))}
                  />
                </div>

                {data.aiInsights.length > 0 && (
                  <div className="card">
                    <h3>Insights</h3>
                    <ul className={styles.insightList}>
                      {data.aiInsights.map((insight, i) => (
                        <li key={i}>{insight}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className={`card ${styles.pending}`}>
                <i className="ph-bold ph-chart-line" />
                <h3>Accuracy and topic analysis aren’t available yet</h3>
                <p>
                  Accuracy, speed per question and your strongest and weakest topics are all worked out from questions
                  you have answered. Scored exams aren’t running yet, so there is nothing measured to report — and we
                  would rather show you nothing than a made-up number.
                </p>
                <p className={styles.pendingNote}>
                  This section will fill in by itself after you sit your first scored exam.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </StudentShell>
  )
}
