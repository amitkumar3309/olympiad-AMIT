import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { ELIGIBILITY_LABELS, type ComputeMonthlyResponse, type MonthlyWinnersView, type QuizWinnerRow } from '../../api/types'
import { Alert, Button, Card, CardHeader, ErrorState, Field, Select, SkeletonText, useToast } from '../../components/ui'
import { formatDateTime, formatDayKey, formatSolveTime } from '../../lib/format'
import { humanizeError } from '../../lib/errors'
import WinnerTable from './DailyQuizWinners'
import styles from './DailyQuiz.module.css'

/**
 * The monthly winners (owner, 2026-10-09 — PLAN.md Q24): one winner a month in each class band,
 * the student with the most Daily Quizzes answered correctly, the lower total solve time
 * breaking a tie.
 *
 * The steps are the server's: work out a band's candidates only once the month is over (the
 * button says why it waits rather than failing), confirm one, announce them — the same table and
 * the same checks as the prize desk. Nothing here is public until a winner is announced.
 */
export default function MonthlyWinners({ initialMonth, onChanged }: { initialMonth: string | null; onChanged: () => void }) {
  const toast = useToast()
  const [month, setMonth] = useState<string | null>(initialMonth)
  const [data, setData] = useState<MonthlyWinnersView | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ComputeMonthlyResponse>>({})
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await api.get<{ monthly: MonthlyWinnersView }>(`/admin/daily-quiz/monthly${month ? `?month=${month}` : ''}`)
      setData(res.monthly)
    } catch (err) {
      setError(err)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  function setBandWinners(band: string, winners: QuizWinnerRow[]) {
    setData((current) =>
      current ? { ...current, bands: current.bands.map((entry) => (entry.id === band ? { ...entry, winners } : entry)) } : current,
    )
  }

  async function compute(band: string) {
    if (!data) return
    setBusy(band)
    setActionError(null)
    try {
      const res = await api.post<ComputeMonthlyResponse>(`/admin/daily-quiz/monthly/${data.month}/${band}/compute`)
      setResults((current) => ({ ...current, [band]: res }))
      setBandWinners(band, res.winners)
      toast.success(res.correctAnswers === 0 ? 'Nobody in this band answered correctly that month.' : 'Candidates worked out. Nothing is public until you announce a winner.')
    } catch (err) {
      setActionError(humanizeError(err, { fallback: 'The candidates could not be worked out.' }))
    } finally {
      setBusy(null)
    }
  }

  function replace(updated: QuizWinnerRow) {
    setData((current) =>
      current
        ? {
            ...current,
            bands: current.bands.map((band) => ({ ...band, winners: band.winners.map((row) => (row.id === updated.id ? updated : row)) })),
          }
        : current,
    )
    onChanged()
  }

  if (error !== null) return <ErrorState titleAs="h2" title="Could not load the monthly winners" error={error} onRetry={() => void load()} />
  if (!data) {
    return (
      <Card>
        <SkeletonText lines={6} label="Loading the monthly winners" />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={`Monthly winners — ${data.label}`}
        as="h2"
        size="sm"
        description="One winner a month in each class band: the most Daily Quizzes answered correctly that month, the lower total solve time breaking a tie. Work out each band’s candidates once the month is over, confirm one, then announce them."
      />
      <div className={styles.stack}>
        <Field label="Month">
          <Select value={data.month} onChange={(event) => setMonth(event.target.value)}>
            {data.months.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </Select>
        </Field>
        {!data.closed && (
          <Alert tone="info" title={`${data.label} is not over yet`}>
            Its candidates can be worked out from {formatDateTime(data.endsAt)}, when its last quiz has closed — until then the
            field is not complete.
          </Alert>
        )}
        {data.countsFrom !== `${data.month}-01` && (
          <p className={styles.muted}>Answers count from {formatDayKey(data.countsFrom)}, the launch.</p>
        )}
        {actionError && <Alert tone="danger">{actionError}</Alert>}

        {data.bands.map((band) => {
          const result = results[band.id]
          return (
            <section key={band.id} className={styles.band} aria-labelledby={`band-${band.id}`}>
              <div className={styles.bandHead}>
                <h3 id={`band-${band.id}`} className={styles.bandTitle}>
                  {band.label}
                </h3>
                {data.closed && (
                  <Button size="sm" icon="ph-calculator" loading={busy === band.id} onClick={() => void compute(band.id)}>
                    {band.winners.length > 0 ? 'Work out again' : 'Work out candidates'}
                  </Button>
                )}
              </div>
              {result && (
                <p className={styles.muted}>
                  {result.correctAnswers} correct {result.correctAnswers === 1 ? 'answer' : 'answers'} from {result.students}{' '}
                  {result.students === 1 ? 'student' : 'students'}.
                </p>
              )}
              {result && result.ineligible.length > 0 && (
                <Alert tone="info" title="High scores, and not yet eligible">
                  <ul className={styles.problemList}>
                    {result.ineligible.map((row, index) => (
                      <li key={`${row.studentId ?? 'unknown'}-${index}`}>
                        {row.name ?? 'An account'} ({row.studentId ?? '—'}), {row.correctCount} correct
                        {row.totalSolveMs !== null ? ` in ${formatSolveTime(row.totalSolveMs)}` : ''} — missing{' '}
                        {row.missing.map((key) => ELIGIBILITY_LABELS[key]).join(', ')}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
              {band.winners.length === 0 ? (
                <p className={styles.muted}>
                  {data.closed
                    ? result
                      ? 'Nobody eligible answered correctly in this band that month.'
                      : 'No candidates yet — work them out.'
                    : 'Candidates come once the month is over.'}
                </p>
              ) : (
                <WinnerTable rows={band.winners} onChanged={replace} label={`${band.label} — candidates and winner for ${data.label}`} />
              )}
            </section>
          )
        })}
      </div>
    </Card>
  )
}
