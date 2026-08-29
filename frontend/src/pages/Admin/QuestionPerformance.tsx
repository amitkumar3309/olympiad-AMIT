import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import {
  CLASS_LEVELS,
  DIFFICULTIES,
  type ClassLevel,
  type Difficulty,
  type Pagination,
  type QuestionPerformanceResponse,
  type QuestionPerformanceRow,
  type TestPerformanceResponse,
  type TestPerformanceRow,
} from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import {
  Alert,
  Table,
  TableScroll,
} from '../../components/ui'
import styles from './QuestionPerformance.module.css'

type Sort = 'hardest' | 'easiest' | 'most-served' | 'most-skipped'

const SORT_LABELS: Record<Sort, string> = {
  hardest: 'Hardest first',
  easiest: 'Easiest first',
  'most-served': 'Most served',
  'most-skipped': 'Most skipped',
}

/**
 * How the question bank and the papers are actually performing (Milestone 15).
 *
 * The view staff did not have. A question nobody gets right is usually **mis-keyed or
 * mis-tagged** rather than genuinely hard, and until now the only way to find one was
 * for a student to complain — so the default sort is hardest-first, which is the list
 * somebody would act on.
 *
 * Every figure is counted from submitted attempts across all four surfaces. Nothing on
 * this page is computed in the browser; a null accuracy renders as an em dash rather
 * than as `0%`, because "served but never answered" and "answered and always wrong" are
 * different problems with different fixes.
 */
export default function QuestionPerformance() {
  const [result, setResult] = useState<QuestionPerformanceResponse | null>(null)
  const [tests, setTests] = useState<TestPerformanceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<Sort>('hardest')
  const [classLevel, setClassLevel] = useState<ClassLevel | ''>('')
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('')
  const [minAnswered, setMinAnswered] = useState(3)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sort,
        minAnswered: String(minAnswered),
      })
      if (classLevel) params.set('classLevel', classLevel)
      if (difficulty) params.set('difficulty', difficulty)

      const [questions, testRows] = await Promise.all([
        api.get<QuestionPerformanceResponse>(`/admin/analytics/questions?${params.toString()}`),
        api.get<TestPerformanceResponse>('/admin/analytics/tests'),
      ])
      setResult(questions)
      setTests(testRows)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load performance analytics.')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [page, sort, classLevel, difficulty, minAnswered])

  useEffect(() => {
    void load()
  }, [load])

  function pct(value: number | null): string {
    return value === null ? '—' : `${value}%`
  }

  function AccuracyCell({ row }: { row: QuestionPerformanceRow }) {
    if (row.accuracyPercent === null) return <span className={styles.muted}>Never answered</span>
    return (
      <span className={styles.barWrap}>
        <span
          className={styles.bar}
          style={{ width: `${row.accuracyPercent}%` }}
          data-low={row.accuracyPercent < 40 ? 'true' : undefined}
        />
        <span className={styles.barLabel}>{row.accuracyPercent}%</span>
      </span>
    )
  }

  function TestRow({ row }: { row: TestPerformanceRow }) {
    return (
      <tr>
        <td>
          {row.title}
          <span className={row.kind === 'official_exam' ? styles.officialTag : styles.mockTag}>
            {row.kind === 'official_exam' ? 'Official exam' : 'Mock test'}
          </span>
        </td>
        <td className={styles.muted}>{row.classLevel}</td>
        <td>
          {row.attemptsSubmitted}
          <span className={styles.muted}> / {row.attemptsStarted}</span>
        </td>
        <td>{pct(row.completionPercent)}</td>
        <td>{pct(row.averageScorePercent)}</td>
        {/* The median sits beside the mean because on a cohort of a few dozen one
            blank submission moves the mean several points — exactly the case an
            invigilator wants to see rather than have smoothed away. */}
        <td>{pct(row.medianScorePercent)}</td>
        <td className={styles.muted}>
          {pct(row.lowestScorePercent)} – {pct(row.highestScorePercent)}
        </td>
        <td className={styles.muted}>
          {row.averageSecondsPerQuestion === null ? '—' : `${row.averageSecondsPerQuestion}s`}
        </td>
      </tr>
    )
  }

  return (
    <AdminShell title="Performance analytics">
      <div className={styles.wrap}>
        <p className={styles.intro}>
          Counted from every <strong>submitted</strong> attempt across practice, mock tests, the daily challenge and
          the official exam. An unfinished attempt contributes nothing — its blanks are not wrong answers.
        </p>

        {error && <Alert tone="danger">{error}</Alert>}

        {/* ------------------------------------------------------------
            Papers
        ------------------------------------------------------------ */}
        <div className={`card ${styles.panel}`}>
          <h3>Paper performance</h3>
          {!tests ? (
            <Spinner label="Loading papers..." />
          ) : tests.tests.length === 0 ? (
            <p className={styles.muted}>No paper has been attempted yet, so there is nothing to compare.</p>
          ) : (
            <TableScroll label="Question performance">
              <Table density="compact">
                <thead>
                  <tr>
                    <th>Paper</th>
                    <th>Class</th>
                    <th>Submitted</th>
                    <th>Completion</th>
                    <th>Mean</th>
                    <th>Median</th>
                    <th>Range</th>
                    <th>Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.tests.map((row) => (
                    <TestRow key={`${row.kind}:${row.id}`} row={row} />
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </div>

        {/* ------------------------------------------------------------
            Questions
        ------------------------------------------------------------ */}
        <div className={`card ${styles.panel}`}>
          <h3>Question performance</h3>

          <div className={styles.toolbar}>
            <select
              className="form-control"
              value={sort}
              onChange={(e) => {
                setPage(1)
                setSort(e.target.value as Sort)
              }}
              aria-label="Sort questions"
            >
              {(Object.keys(SORT_LABELS) as Sort[]).map((value) => (
                <option key={value} value={value}>
                  {SORT_LABELS[value]}
                </option>
              ))}
            </select>

            <select
              className="form-control"
              value={classLevel}
              onChange={(e) => {
                setPage(1)
                setClassLevel(e.target.value as ClassLevel | '')
              }}
              aria-label="Filter by class"
            >
              <option value="">Any class</option>
              {CLASS_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>

            <select
              className="form-control"
              value={difficulty}
              onChange={(e) => {
                setPage(1)
                setDifficulty(e.target.value as Difficulty | '')
              }}
              aria-label="Filter by difficulty"
            >
              <option value="">Any difficulty</option>
              {DIFFICULTIES.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>

            <label className={styles.minLabel}>
              Min answers
              <input
                type="number"
                className="form-control"
                min={1}
                max={100}
                value={minAnswered}
                onChange={(e) => {
                  setPage(1)
                  setMinAnswered(Math.max(1, Number(e.target.value) || 1))
                }}
              />
            </label>
          </div>

          <p className={styles.muted}>
            A question needs at least <strong>{result?.minAnswered ?? minAnswered}</strong> answers before it is judged:
            one wrong answer sits at 0% and would head the hardest list for ever, which is a real number and a useless
            diagnosis. Lower it deliberately if you want to see everything.
          </p>

          {loading ? (
            <Spinner label="Counting answers..." />
          ) : !result || result.questions.length === 0 ? (
            <p className={styles.empty}>
              {result?.notes.includes('no-question-has-been-answered-yet')
                ? 'No question has been answered yet. This fills in as students sit papers.'
                : `No question has at least ${result?.minAnswered ?? minAnswered} answers under these filters. ${
                    result?.questionsWithData ?? 0
                  } question(s) have been answered at least once.`}
            </p>
          ) : (
            <>
              <TableScroll label="Paper performance">
                <Table density="compact">
                  <thead>
                    <tr>
                      <th>Question</th>
                      <th>Topic</th>
                      <th>Difficulty</th>
                      <th>Served</th>
                      <th>Answered</th>
                      <th>Accuracy</th>
                      <th>Skipped</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {result.questions.map((row) => (
                      <tr key={row.id}>
                        <td className={styles.preview}>{row.preview}</td>
                        <td className={styles.muted}>
                          {/*
                            The chapter alone. The subject used to sit under it as a sub-label, which
                            with one implicit subject printed "Mathematics" on every row of the table.
                          */}
                          {row.topicName ?? '—'}
                        </td>
                        <td className={styles.muted}>{row.difficulty}</td>
                        <td>{row.served}</td>
                        <td>{row.answered}</td>
                        <td>
                          <AccuracyCell row={row} />
                        </td>
                        <td>{pct(row.skipRatePercent)}</td>
                        <td>
                          <Link className={styles.editLink} to={`/admin/questions/${row.id}/edit`}>
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>

              {result.pagination.totalPages > 1 && <Pager pagination={result.pagination} onChange={setPage} />}
            </>
          )}
        </div>
      </div>
    </AdminShell>
  )
}

function Pager({ pagination, onChange }: { pagination: Pagination; onChange: (page: number) => void }) {
  return (
    <div className={styles.pager}>
      <button disabled={pagination.page <= 1} onClick={() => onChange(pagination.page - 1)}>
        Previous
      </button>
      <span>
        Page {pagination.page} of {pagination.totalPages}
      </span>
      <button disabled={pagination.page >= pagination.totalPages} onClick={() => onChange(pagination.page + 1)}>
        Next
      </button>
    </div>
  )
}
