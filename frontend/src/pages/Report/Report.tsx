import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
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
 * Both are fixed: it now handles the real response shape, reports the progress that is
 * genuinely recorded, and states plainly which sections need exam results before they
 * can say anything.
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
  const data = result?.data ?? null
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
    <div>
      <Navbar />
      <div className={`container ${styles.wrap}`}>
        <div className={styles.header}>
          <div>
            <h1>Student Report</h1>
            <p>A summary of {studentName}'s Olympiad journey so far.</p>
          </div>
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
            {data ? (
              <>
                <div className="card">
                  <h3>Accuracy</h3>
                  <p>
                    Out of <strong>{data.totalQuestionsAttempted}</strong> questions attempted, you're maintaining an
                    overall accuracy of <strong>{data.overallAccuracy}%</strong> at an average pace of{' '}
                    <strong>{data.averageSpeedPerQuestion}s</strong> per question.
                  </p>
                </div>

                <ChartCard
                  title="Accuracy over time"
                  type="line"
                  label="Accuracy %"
                  labels={data.learningCurve.map((p) => p.date)}
                  data={data.learningCurve.map((p) => p.accuracy)}
                />

                <div className="card">
                  <h3>Topic Breakdown</h3>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Topic</th>
                        <th>Attempted</th>
                        <th>Correct</th>
                        <th>Accuracy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topicMetrics.map((t) => (
                        <tr key={t.topicName}>
                          <td>{t.topicName}</td>
                          <td>{t.attempted}</td>
                          <td>{t.correct}</td>
                          <td>{Math.round((t.correct / t.attempted) * 100)}%</td>
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
                  These are worked out from questions you have answered in a scored exam. No exam has been held yet, so
                  there is nothing measured to report — this report deliberately leaves them blank rather than
                  estimating.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}
