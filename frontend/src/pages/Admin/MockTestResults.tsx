import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { MockTestResults as Results } from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import MathText from '../../components/MathText'
import { Icon, Table, TableScroll } from '../../components/ui'
import styles from './MockTests.module.css'

/**
 * Results for one mock test (Milestone 7).
 *
 * Every figure is a real aggregate over real attempts. A test nobody has sat shows an
 * explicit empty state rather than a table of zeros, and a statistic with nothing behind
 * it is printed as “—” rather than as 0 — an average of zero and no average at all are
 * different facts, and the second one must not be able to read as the first.
 *
 * Reading this page is also what **finalises abandoned attempts**: the backend sweeps
 * every attempt whose deadline has passed before it aggregates, so a paper a student
 * walked away from is reported as the graded thing it is rather than as "in progress"
 * indefinitely. (There is no scheduler on the free tier to do it in the background — see
 * DECISIONS.md.)
 */

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function formatDateTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'
}

export default function MockTestResults() {
  const { id } = useParams<{ id: string }>()
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      setResults(await api.get<Results>(`/admin/mock-tests/${id}/results`))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the results for that test.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <AdminShell title="Mock test results">
        <div className={styles.centered}>
          <Spinner />
        </div>
      </AdminShell>
    )
  }

  if (error || !results) {
    return (
      <AdminShell title="Mock test results">
        <div className={`card ${styles.centered}`}>
          <p className="error-text">{error || 'Could not load those results.'}</p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      </AdminShell>
    )
  }

  const { test, stats, rows, questionStats } = results

  return (
    <AdminShell title={`Results: ${test.title}`}>
      <div className={styles.headerRow}>
        <p className={styles.intro}>
          {test.classLevel} · {test.totalQuestions} question{test.totalQuestions === 1 ? '' : 's'} ·{' '}
          {test.totalMarks} marks · {test.durationMinutes} min · opens {formatDateTime(test.availableFrom)}, closes{' '}
          {formatDateTime(test.availableTo)}
        </p>
        <div className={styles.headerActions}>
          <Button variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
          <Link to="/admin/mock-tests">
            <Button variant="outline">All tests</Button>
          </Link>
        </div>
      </div>

      {stats.attemptsStarted === 0 ? (
        <div className={`card ${styles.empty}`}>
          <Icon name="ph-users-three" weight="bold" />
          <h3>Nobody has sat this test yet</h3>
          <p>
            {test.status === 'published'
              ? 'It is published, so results will appear here as students submit.'
              : 'It is not published, so no student can see it yet.'}
          </p>
        </div>
      ) : (
        <>
          <section className={styles.statRow}>
            <div className="card">
              <div className={styles.statValue}>{stats.attemptsSubmitted}</div>
              <div className={styles.statLabel}>Submitted</div>
            </div>
            <div className="card">
              <div className={styles.statValue}>{stats.distinctStudents}</div>
              <div className={styles.statLabel}>Students</div>
            </div>
            <div className="card">
              <div className={styles.statValue}>
                {stats.averageScore ?? '—'}
                {stats.averageScore !== null && <span>/{test.totalMarks}</span>}
              </div>
              <div className={styles.statLabel}>Average score</div>
            </div>
            <div className="card">
              <div className={styles.statValue}>{stats.highestScore ?? '—'}</div>
              <div className={styles.statLabel}>Highest</div>
            </div>
            <div className="card">
              <div className={styles.statValue}>{stats.lowestScore ?? '—'}</div>
              <div className={styles.statLabel}>Lowest</div>
            </div>
            <div className="card">
              <div className={styles.statValue}>
                {stats.averageAccuracy === null ? '—' : `${stats.averageAccuracy}%`}
              </div>
              <div className={styles.statLabel}>Avg accuracy</div>
            </div>
            <div className="card">
              <div className={styles.statValue}>{formatDuration(stats.averageTimeSeconds)}</div>
              <div className={styles.statLabel}>Avg time</div>
            </div>
            <div className="card">
              <div className={styles.statValue}>{stats.autoSubmittedCount}</div>
              <div className={styles.statLabel}>Ran out of time</div>
            </div>
          </section>

          {stats.attemptsInProgress > 0 && (
            <p className={styles.warn}>
              {stats.attemptsInProgress} attempt{stats.attemptsInProgress === 1 ? ' is' : 's are'} still in progress —
              still inside their own time. They will be marked when their time runs out or the student submits.
            </p>
          )}

          <div className="card">
            <h3>Attempts</h3>
            <TableScroll label="Attempts">
              <Table density="compact">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Student</th>
                    <th>School</th>
                    <th>Score</th>
                    <th>Accuracy</th>
                    <th>Right / wrong / blank</th>
                    <th>Time</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.rank ?? '—'}</td>
                      <td>
                        <span className={styles.studentName}>{row.student.fullName ?? '—'}</span>
                        <span className={styles.studentId}>{row.student.studentId ?? '—'}</span>
                        {row.attemptNumber > 1 && (
                          <span className={styles.attemptTag}>attempt {row.attemptNumber}</span>
                        )}
                      </td>
                      <td>{row.student.schoolName ?? '—'}</td>
                      <td className={styles.mono}>
                        {row.status === 'in_progress' ? 'In progress' : `${row.score}/${row.maxMarks}`}
                      </td>
                      <td className={styles.mono}>{row.accuracy === null ? '—' : `${row.accuracy}%`}</td>
                      <td className={styles.mono}>
                        {row.correctCount} / {row.incorrectCount} / {row.unansweredCount}
                      </td>
                      <td className={styles.mono}>{formatDuration(row.timeTakenSeconds)}</td>
                      <td>
                        {formatDateTime(row.submittedAt)}
                        {row.autoSubmitted && <span className={styles.attemptTag}>auto</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </div>

          <div className="card">
            <h3>Question by question</h3>
            <p className={styles.help}>
              Percentages are of the students who <em>answered</em> each question, so a question everybody skipped shows
              “—” rather than 0% — which would read as everyone getting it wrong.
            </p>
            <ol className={styles.questionStats}>
              {questionStats.map((entry) => (
                <li key={entry.id}>
                  <div className={styles.qsStem}>
                    <MathText>{(entry.questionText ?? '(question unavailable)').slice(0, 160)}</MathText>
                  </div>
                  <div className={styles.qsFigures}>
                    <span className={styles.mono}>
                      {entry.correct}/{entry.answered} correct
                    </span>
                    <span
                      className={`${styles.qsBadge} ${
                        entry.correctPercent === null
                          ? ''
                          : entry.correctPercent >= 70
                            ? styles.qsGood
                            : entry.correctPercent >= 40
                              ? styles.qsMid
                              : styles.qsPoor
                      }`}
                    >
                      {entry.correctPercent === null ? '—' : `${entry.correctPercent}%`}
                    </span>
                    <span className={styles.qsSkipped}>{entry.served - entry.answered} skipped</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </AdminShell>
  )
}
