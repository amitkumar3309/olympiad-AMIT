import { useEffect, useState } from 'react'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import ChartCard from '../../components/ChartCard'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import type { AnalyticsData } from '../../api/types'
import styles from './Report.module.css'

export default function Report() {
  const { state } = useAuth()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (state.status !== 'student') return
    api
      .get<{ data: AnalyticsData }>(`/api/analytics/${state.student.studentId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load report.'))
  }, [state])

  const studentName = state.status === 'student' ? state.student.fullName : ''

  return (
    <div>
      <Navbar />
      <div className={`container ${styles.wrap}`}>
        <div className={styles.header}>
          <div>
            <h1>Smart Student Report</h1>
            <p>A summary of {studentName}'s Olympiad journey so far.</p>
          </div>
          <Button variant="outline" onClick={() => window.print()}>
            <i className="ph ph-printer" /> Download Report
          </Button>
        </div>

        {error && <p className="error-text">{error}</p>}
        {!data && !error && <Spinner label="Preparing your report..." />}

        {data && (
          <div className={styles.reportBody}>
            <div className="card">
              <h3>Summary</h3>
              <p>
                Out of <strong>{data.totalQuestionsAttempted}</strong> questions attempted, you're maintaining an
                overall accuracy of <strong>{data.overallAccuracy}%</strong> at an average pace of{' '}
                <strong>{data.averageSpeedPerQuestion}s</strong> per question.
              </p>
            </div>

            <ChartCard
              title="Progress Over Time"
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
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}
