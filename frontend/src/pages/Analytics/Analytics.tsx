import { useEffect, useState } from 'react'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Spinner from '../../components/Spinner'
import StatTile from '../../components/StatTile'
import ChartCard from '../../components/ChartCard'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import type { AnalyticsData } from '../../api/types'
import styles from './Analytics.module.css'

export default function Analytics() {
  const { state } = useAuth()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (state.status !== 'student') return
    api
      .get<{ data: AnalyticsData }>(`/analytics/${state.student.studentId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load analytics.'))
  }, [state])

  return (
    <div>
      <Navbar />
      <div className={`container ${styles.wrap}`}>
        <h1>AI Performance Analysis</h1>
        {error && <p className="error-text">{error}</p>}
        {!data && !error && <Spinner label="Crunching your performance data..." />}

        {data && (
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

            <div className="card">
              <h3>🤖 AI Insights</h3>
              <ul className={styles.insightList}>
                {data.aiInsights.map((insight, i) => (
                  <li key={i}>{insight}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
      <Footer />
    </div>
  )
}
