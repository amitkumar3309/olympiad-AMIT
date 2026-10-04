import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DailyQuizHistoryResponse, QuizHistoryRow } from '../api/types'
import MathText from './MathText'
import { Badge, Card, CardHeader, EmptyState, ErrorState, Pagination, SkeletonText, StatTile } from './ui'
import { formatDayKey, formatSolveTime } from '../lib/format'
import styles from './DailyQuizHistory.module.css'

/**
 * My Profile → Daily Quiz history (Milestone 30, Phase 2 — brief §6.4, R5).
 *
 * Every day the student played, newest first: the question, their answer, right or wrong,
 * solve time and XP — and, once the day's answer has unlocked, the correct option and the
 * worked solution. Before that the row says when it unlocks; the server sends nothing to
 * unlock early, so there is nothing here to hide.
 */

const PAGE_SIZE = 10

function verdict(row: QuizHistoryRow) {
  if (row.status === 'not-submitted') return <Badge tone="neutral" size="sm">Not submitted</Badge>
  if (row.status === 'in-progress') return <Badge tone="info" size="sm">In progress</Badge>
  if (row.isCorrect === true) return <Badge tone="success" size="sm" icon="ph-check-circle">Correct</Badge>
  if (row.isCorrect === false) return <Badge tone="danger" size="sm" icon="ph-x-circle">Incorrect</Badge>
  return <Badge tone="neutral" size="sm">Result at unlock</Badge>
}

export default function DailyQuizHistory() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<DailyQuizHistoryResponse | null>(null)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.get<DailyQuizHistoryResponse>(`/me/daily-quiz/history?page=${page}&limit=${PAGE_SIZE}`))
    } catch (err) {
      setError(err)
    }
  }, [page])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card as="section" aria-labelledby="daily-quiz-history-title" id="daily-quiz-history" className={styles.card}>
      <CardHeader title={<span id="daily-quiz-history-title">Daily Quiz history</span>} as="h2" size="sm" description="Answers and solutions unlock the day after each quiz." />
      {error !== null ? (
        <ErrorState title="Could not load your quiz history" error={error} onRetry={() => void load()} />
      ) : !data ? (
        <SkeletonText lines={5} label="Loading your quiz history" />
      ) : (
        <>
          <div className={styles.summary}>
            <StatTile icon="ph-list-checks" label="Played" value={data.summary.attempted} />
            <StatTile icon="ph-check-circle" tone="success" label="Correct" value={data.summary.correct} />
            <StatTile icon="ph-target" label="Accuracy" value={data.summary.accuracy === null ? null : `${data.summary.accuracy}%`} />
            <StatTile icon="ph-flame" tone="warning" label="Current streak" value={data.summary.currentStreak} />
            <StatTile icon="ph-medal" label="Best streak" value={data.summary.longestStreak} />
            <StatTile icon="ph-trophy" label="Wins" value={data.summary.wins} />
          </div>
          {data.attempts.length === 0 ? (
            <EmptyState
              size="sm"
              icon="ph-lightning"
              title="No quizzes yet"
              description="Every Daily Quiz you play is listed here — right or wrong — and its solution unlocks the next day."
            />
          ) : (
            <ol className={styles.list}>
              {data.attempts.map((row) => (
                <li key={row.day} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.day}>
                      {row.won && (
                        <span role="img" aria-label="Winner">
                          🏆
                        </span>
                      )}{' '}
                      {formatDayKey(row.day)}
                    </span>
                    {row.topic && <span className={styles.topic}>{row.topic}</span>}
                    {verdict(row)}
                  </div>
                  <dl className={styles.facts}>
                    <div>
                      <dt>Your answer</dt>
                      <dd>{row.selectedOptionText ? <MathText>{row.selectedOptionText}</MathText> : '—'}</dd>
                    </div>
                    <div>
                      <dt>Solve time</dt>
                      <dd>{row.solveTimeMs !== null ? formatSolveTime(row.solveTimeMs) : '—'}</dd>
                    </div>
                    <div>
                      <dt>XP</dt>
                      <dd>{row.xpPending ? 'At unlock' : row.xpAwarded > 0 ? `+${row.xpAwarded}` : '0'}</dd>
                    </div>
                  </dl>
                  {row.questionText && (
                    <details className={styles.details}>
                      <summary>The question</summary>
                      <MathText block>{row.questionText}</MathText>
                    </details>
                  )}
                  {row.revealed && row.reveal ? (
                    <details className={styles.details}>
                      <summary>View solution</summary>
                      {row.reveal.correctOptionText && (
                        <p className={styles.correct}>
                          Correct answer: <MathText>{row.reveal.correctOptionText}</MathText>
                        </p>
                      )}
                      {row.reveal.solution && <MathText block>{row.reveal.solution}</MathText>}
                    </details>
                  ) : (
                    <p className={styles.locked}>Answer and solution unlock tomorrow at 12:00 AM.</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {data.pagination.totalPages > 1 && (
            <Pagination page={page} pageCount={data.pagination.totalPages} total={data.pagination.total} pageSize={PAGE_SIZE} onChange={setPage} label="Quiz history pages" />
          )}
        </>
      )}
    </Card>
  )
}
