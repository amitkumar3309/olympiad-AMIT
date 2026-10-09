import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Icon,
  SkeletonCards,
} from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import { formatNumber } from '../../lib/format'
import { api } from '../../api/client'
import type { Pagination, PracticeHistoryEntry, PracticeOptionsResponse } from '../../api/types'
import styles from './Practice.module.css'

/**
 * The Practice Zone (Milestone 6) — starting a practice test.
 *
 * A practice test is a **random mix of the questions published for the student's class**
 * (owner, 2026-10-09). The one choice is how many, from the sizes `GET /practice/options`
 * publishes (10, 20, 30 or 40), so the page cannot offer a size the server refuses. There is
 * no chapter or difficulty to pick, and nothing in the product links to one.
 *
 * Every figure is a real count of published questions for the student's own class. The
 * server decides the class from their account — this page never asks which class to use,
 * and could not override it. An empty bank produces an explicit empty state.
 */

interface StartResponse {
  session: { id: string }
}

interface HistoryResponse {
  sessions: PracticeHistoryEntry[]
  pagination: Pagination
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The sizes that draw different tests. A size is open while the one below it is smaller than
 * what the class has — with 25 questions published that is 10, 20 and 30 (which gives all 25),
 * never two buttons that draw the same paper. The smallest is always open.
 */
function openSizes(sizes: number[], available: number): number[] {
  return sizes.filter((_, index) => index === 0 || sizes[index - 1] < available)
}

export default function Practice() {
  const navigate = useNavigate()
  const noteId = useId()

  const [options, setOptions] = useState<PracticeOptionsResponse | null>(null)
  const [history, setHistory] = useState<PracticeHistoryEntry[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)

  const [size, setSize] = useState<number | null>(null)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [opts, hist] = await Promise.all([
        api.get<PracticeOptionsResponse>('/practice/options'),
        api.get<HistoryResponse>('/practice/sessions?limit=5'),
      ])
      setOptions(opts)
      setHistory(hist.sessions)
    } catch (err) {
      setLoadError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const available = options?.available ?? 0
  const sizes = options?.sizes ?? []
  const open = openSizes(sizes, available)
  // The student's choice while it is still open, else the smallest size — derived rather than
  // stored, so a reload that finds fewer questions can never leave a closed size chosen.
  const chosen = size !== null && open.includes(size) ? size : (open[0] ?? null)
  const served = chosen === null ? 0 : Math.min(chosen, available)

  async function start() {
    if (chosen === null) return
    setStarting(true)
    setStartError(null)
    try {
      const res = await api.post<StartResponse>('/practice/sessions', { questionCount: chosen })
      navigate(`/practice/${res.session.id}`)
    } catch (err) {
      setStartError(humanizeError(err, { fallback: 'Could not start the test. Please try again.' }))
      setStarting(false)
    }
  }

  const openSession = history?.find((entry) => entry.status === 'in_progress') ?? null

  return (
    <StudentShell
      title="Practice Zone"
      subtitle={options?.classLevel ? `Random tests from the questions published for ${options.classLevel}` : undefined}
    >
      {loadError !== null && <ErrorState error={loadError} titleAs="h2" onRetry={() => void load()} />}

      {!options && loadError === null && <SkeletonCards count={2} label="Loading what you can practise" />}

      {options && loadError === null && (
        <div className={styles.page}>
          {/* An unfinished session is the most useful thing to offer first. */}
          {openSession && (
            <Alert
              tone="info"
              icon="ph-play-circle"
              title="You have an unfinished test"
              actions={
                <ButtonLink to={`/practice/${openSession.id}`} size="sm" icon="ph-arrow-right">
                  Resume it
                </ButtonLink>
              }
            >
              {openSession.totalQuestions} questions, started {formatWhen(openSession.startedAt)}. Your answers were
              saved as you went.
            </Alert>
          )}

          {available === 0 ? (
            <Card>
              <EmptyState
                titleAs="h2"
                icon="ph-books"
                title="Nothing to practise yet"
                description={
                  options.reason === 'no-class'
                    ? 'Add your class to your profile and the questions published for it will appear here.'
                    : `No questions have been published for ${options.classLevel} yet. Practice tests open here as soon as your class has some.`
                }
                action={
                  options.reason === 'no-class' ? (
                    <ButtonLink to="/profile" variant="secondary" icon="ph-user-circle">
                      Go to my profile
                    </ButtonLink>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <Card>
              <CardHeader
                title="Start a practice test"
                description="A random mix of the questions published for your class, from every chapter. A new mix every time."
              />

              <fieldset className={styles.sizes} aria-describedby={noteId}>
                <legend className={styles.sizesLegend}>How many questions?</legend>
                <div className={styles.sizeRow}>
                  {sizes.map((value) => {
                    const isOpen = open.includes(value)
                    const isChosen = value === chosen
                    return (
                      <label
                        key={value}
                        className={[styles.size, isChosen ? styles.sizeChosen : '', isOpen ? '' : styles.sizeClosed]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <input
                          type="radio"
                          name="practice-size"
                          className={styles.sizeInput}
                          value={value}
                          checked={isChosen}
                          disabled={!isOpen || starting}
                          onChange={() => setSize(value)}
                        />
                        {isChosen && <Icon name="ph-check-circle" weight="bold" className={styles.sizeTick} />}
                        <span className={`${styles.sizeNumber} tnum`}>{value}</span>
                        <span className={styles.sizeWord}>questions</span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              <p id={noteId} className={styles.availability}>
                <Badge tone="primary">{formatNumber(available)} published</Badge>
                {served < available ? (
                  <span>
                    You will get <strong>{served}</strong>, drawn at random from the {formatNumber(available)} for{' '}
                    {options.classLevel}.
                  </span>
                ) : (
                  <span>
                    You will get all <strong>{formatNumber(available)}</strong> for {options.classLevel}, in a random order.
                  </span>
                )}
                {open.length < sizes.length && <span>Longer tests open as more questions are published.</span>}
              </p>

              {startError && <Alert tone="danger">{startError}</Alert>}

              <Button size="lg" fullWidth icon="ph-play" loading={starting} onClick={() => void start()}>
                {starting ? 'Preparing your questions' : `Start a ${served}-question test`}
              </Button>
            </Card>
          )}

          {/* Real history only. A student who has never practised gets an empty state. */}
          <Card>
            <CardHeader title="Recent practice" size="sm" as="h2" />
            {history === null ? (
              <SkeletonCards count={2} label="Loading your practice history" />
            ) : history.length === 0 ? (
              <EmptyState
                size="sm"
                icon="ph-clock-counter-clockwise"
                title="No tests yet"
                description="Once you finish a test it appears here with its score, so you can go back over what you got wrong."
              />
            ) : (
              <ul className={styles.history}>
                {history.map((entry) => (
                  <li key={entry.id}>
                    <div className={styles.historyMain}>
                      <span className={styles.historyTitle}>
                        {/*
                          "Practice test" — or, for a session from before 2026-10-09, the chapter it
                          was drawn from, which is what that student chose at the time.
                        */}
                        {entry.filters.topic?.name ?? 'Practice test'}
                        {entry.filters.difficulty ? ` · ${entry.filters.difficulty}` : ''}
                      </span>
                      <span className={styles.historyMeta}>
                        {formatWhen(entry.startedAt)} · {entry.totalQuestions} questions
                        {entry.timeTakenSeconds !== null ? ` · ${formatDuration(entry.timeTakenSeconds)}` : ''}
                      </span>
                    </div>
                    {entry.status === 'submitted' ? (
                      <>
                        <Badge tone="success">
                          {entry.score}/{entry.maxMarks}
                        </Badge>
                        <ButtonLink to={`/practice/${entry.id}`} size="sm" variant="secondary">
                          Review
                        </ButtonLink>
                      </>
                    ) : (
                      <>
                        <Badge tone="warning" icon="ph-clock">
                          Unfinished
                        </Badge>
                        <ButtonLink to={`/practice/${entry.id}`} size="sm">
                          Resume
                        </ButtonLink>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </StudentShell>
  )
}
