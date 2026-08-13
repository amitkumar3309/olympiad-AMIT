import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { ExamResult, StudentExam } from '../../api/types'
import StudentShell from '../../components/StudentShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import styles from './Exams.module.css'

/**
 * The official Olympiad, as a student sees it.
 *
 * Distinct from Mock Tests on purpose, and the page says so: a mock is a rehearsal
 * that can be sat more than once and marked immediately, whereas this happens once, in
 * a window the organisers announce, and its result is released by them rather than
 * shown on submission.
 */
export default function Exams() {
  const navigate = useNavigate()
  const [exams, setExams] = useState<StudentExam[]>([])
  const [results, setResults] = useState<ExamResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState('')

  useEffect(() => {
    let cancelled = false

    Promise.all([
      api.get<{ exams: StudentExam[] }>('/exams'),
      api.get<{ results: ExamResult[] }>('/me/exam-results'),
    ])
      .then(([examRes, resultRes]) => {
        if (cancelled) return
        setExams(examRes.exams)
        setResults(resultRes.results)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your exams.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function start(exam: StudentExam) {
    setStarting(exam.id)
    setError('')
    try {
      const res = await api.post<{ attempt: { id: string } }>(`/exams/${exam.id}/attempt`, {})
      navigate(`/exam/${res.attempt.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start that exam.')
    } finally {
      setStarting('')
    }
  }

  function windowLabel(exam: StudentExam): string {
    const opens = new Date(exam.opensAt).toLocaleString()
    const closes = new Date(exam.closesAt).toLocaleString()
    if (exam.windowState === 'not-open-yet') return `Opens ${opens}`
    if (exam.windowState === 'closed') return `Closed ${closes}`
    return `Open until ${closes}`
  }

  return (
    <StudentShell title="Official Olympiad">
      <div className={`card ${styles.intro}`}>
        <h3>The official examination</h3>
        <p>
          This is the national sitting. It runs only in the window the organisers announce, you get{' '}
          <strong>one attempt</strong>, and your result — with your rank and your certificate — is released by the
          organisers afterwards. It is not the same as a mock test, and nothing here is scored on the spot.
        </p>
      </div>

      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <Spinner label="Loading your exams..." />
      ) : exams.length === 0 ? (
        <div className={`card ${styles.empty}`}>
          <p>No official exam has been scheduled for your class yet. You will be notified when one is.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {exams.map((exam) => (
            <div key={exam.id} className={`card ${styles.examCard}`}>
              <div className={styles.examHead}>
                <div>
                  <h3>{exam.title}</h3>
                  <span className={styles.code}>{exam.examCode}</span>
                </div>
                <span className={styles[`state_${exam.windowState.replace(/-/g, '_')}`]}>{windowLabel(exam)}</span>
              </div>

              {exam.description && <p className={styles.description}>{exam.description}</p>}

              <ul className={styles.facts}>
                <li>
                  <strong>{exam.questionCount}</strong> questions
                </li>
                <li>
                  <strong>{exam.totalMarks}</strong> marks
                </li>
                <li>
                  <strong>{exam.durationMinutes}</strong> minutes
                </li>
              </ul>

              <div className={styles.actions}>
                {exam.attempt?.status === 'submitted' ? (
                  <span className={styles.done}>
                    Submitted {exam.attempt.submittedAt ? new Date(exam.attempt.submittedAt).toLocaleString() : ''} ·
                    {exam.resultsPublished ? ' results released' : ' awaiting results'}
                  </span>
                ) : exam.attempt?.status === 'in_progress' ? (
                  <Button onClick={() => navigate(`/exam/${exam.attempt!.id}`)}>Resume your paper</Button>
                ) : exam.isOpen ? (
                  <Button disabled={starting === exam.id} onClick={() => void start(exam)}>
                    {starting === exam.id ? 'Starting...' : 'Start the exam'}
                  </Button>
                ) : (
                  <span className={styles.muted}>
                    {exam.windowState === 'not-open-yet' ? 'Not open yet' : 'This exam has closed'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className={`card ${styles.results}`}>
          <h3>Your released results</h3>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>Score</th>
                  <th>Percentage</th>
                  <th>Rank</th>
                  <th>Percentile</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id}>
                    <td>
                      {result.examTitle}
                      <span className={styles.code}>{result.examCode}</span>
                    </td>
                    <td>
                      {result.score} / {result.maxMarks}
                    </td>
                    <td>{result.percentage}%</td>
                    <td>
                      <strong>
                        {result.rank} of {result.totalCandidates}
                      </strong>
                    </td>
                    <td className={styles.muted}>{result.percentile}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </StudentShell>
  )
}
