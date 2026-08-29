import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  Field,
  Select,
  SkeletonCards,
} from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import { api } from '../../api/client'
import {
  DIFFICULTIES,
  type Difficulty,
  type Pagination,
  type PracticeHistoryEntry,
  type PracticeOptionsResponse,
  type PracticeSubjectOption,
} from '../../api/types'
import styles from './Practice.module.css'

/**
 * The Practice Zone (Milestone 6) — choosing what to practise.
 *
 * Everything the pickers offer is a **real count of real published questions** for the
 * student's own class, from `GET /practice/options`. Nothing is hardcoded, and a
 * combination with no questions behind it is never offered, so pressing Start cannot
 * fail with "nothing matches". An empty bank produces an explicit empty state.
 *
 * The paper is always drawn for the student's own class. The server decides that from
 * their account — this page never asks which class to use, and could not override it.
 *
 * ## Preselection from the URL (Milestone 16)
 *
 * `?topic=&difficulty=` lets a recommendation hand the student straight to the
 * thing it suggested. The values are **validated against the loaded options** before
 * anything is selected, and silently ignored otherwise: a link kept in a bookmark after
 * a topic was archived then degrades to the ordinary picker rather than to a selection
 * the bank cannot serve. That check is also why this cannot be used to widen what a
 * student may practise — the ids have to already be on offer for their own class.
 */

interface StartResponse {
  session: { id: string }
}

interface HistoryResponse {
  sessions: PracticeHistoryEntry[]
  pagination: Pagination
}

const QUESTION_COUNTS = [5, 10, 20] as const

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Practice() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [options, setOptions] = useState<PracticeOptionsResponse | null>(null)
  const [history, setHistory] = useState<PracticeHistoryEntry[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)

  const [topicId, setTopicId] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('')
  const [questionCount, setQuestionCount] = useState<number>(10)

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

  /**
   * Every chapter on offer, flattened out of the response's subject grouping.
   *
   * **There is no subject picker.** AMIT is a mathematics olympiad, so the subject is implicit and
   * showing a one-item dropdown would be a decision the student cannot get wrong and should not have
   * to make (see the Milestone 21 ADR on the Mathematics-only scope). The API still groups by
   * subject — `Question.subject` is real and the taxonomy needs it — so the grouping is flattened
   * here rather than removed from the response.
   */
  // Memoised so the derivations below have a stable dependency: `options?.subjects ??
  // []` would be a fresh array on every render, which makes any `useMemo` over it
  // recompute every time and defeats the point.
  const subjects: PracticeSubjectOption[] = useMemo(() => options?.subjects ?? [], [options])

  /** Every chapter that has published questions for this student's class. */
  const topics = useMemo(
    () => subjects.flatMap((entry) => entry.topics),
    [subjects],
  )

  const selectedTopic = topics.find((entry) => entry.topicId === topicId) ?? null

  /**
   * Applies `?topic=&difficulty=` once the real options have loaded.
   *
   * Runs when `subjects` first becomes non-empty and never fights the student for the
   * controls afterwards: every branch is guarded on the current selection still being
   * empty, so a later re-render cannot undo a choice they made by hand.
   */
  useEffect(() => {
    if (subjects.length === 0) return

    const wantedTopic = searchParams.get('topic')

    const wantedDifficulty = searchParams.get('difficulty')

    // A chapter is all a recommendation ever needs to hand over now.
    const owner = wantedTopic
      ? subjects.find((entry) => entry.topics.some((topic) => topic.topicId === wantedTopic))
      : undefined

    if (owner && wantedTopic) {
      setTopicId((current) => current || wantedTopic)
    }

    // Only offered where it really exists, matching what the select itself would allow.
    const scope = owner?.topics.find((topic) => topic.topicId === wantedTopic) ?? owner
    if (wantedDifficulty && scope?.difficulties.includes(wantedDifficulty as Difficulty)) {
      setDifficulty((current) => current || (wantedDifficulty as Difficulty))
    }
  }, [subjects, searchParams])

  /**
   * Only the difficulties that exist in the narrowest chosen scope. Offering `Hard`
   * when the topic has none would let a student pick a combination with nothing
   * behind it and then be refused.
   */
  const availableDifficulties: Difficulty[] = selectedTopic
    ? selectedTopic.difficulties
    : DIFFICULTIES.filter((level) => subjects.some((entry) => entry.difficulties.includes(level)))

  /** How many questions the current selection really has behind it. */
  const availableCount = selectedTopic
    ? selectedTopic.questionCount
    : subjects.reduce((sum, entry) => sum + entry.questionCount, 0)

  function chooseTopic(nextTopicId: string) {
    setTopicId(nextTopicId)
    setDifficulty('')

  }

  async function start() {
    setStarting(true)
    setStartError(null)
    try {
      const body: Record<string, unknown> = { questionCount }
      if (topicId) body.topicId = topicId
      if (difficulty) body.difficulty = difficulty

      const res = await api.post<StartResponse>('/practice/sessions', body)
      navigate(`/practice/${res.session.id}`)
    } catch (err) {
      setStartError(humanizeError(err, { fallback: 'Could not start practice. Please try again.' }))
      setStarting(false)
    }
  }

  const openSession = history?.find((entry) => entry.status === 'in_progress') ?? null

  return (
    <StudentShell
      title="Practice Zone"
      subtitle={options?.classLevel ? `Published questions for ${options.classLevel}` : undefined}
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
              title="You have an unfinished session"
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

          {subjects.length === 0 ? (
            <Card>
              <EmptyState
                titleAs="h2"
                icon="ph-books"
                title="Nothing to practise yet"
                description={
                  options.reason === 'no-class'
                    ? 'Add your class to your profile and the questions published for it will appear here.'
                    : `No questions have been published for ${options.classLevel} yet. This page fills in as soon as the question bank has content for your class.`
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
                title="Start a practice session"
                description="Every option below is a real count of published questions for your class."
              />

              <div className={styles.pickers}>
                <Field label="Chapter" hint="All chapters, or one to focus on.">
                  <Select value={topicId} onChange={(e) => chooseTopic(e.target.value)}>
                    <option value="">All chapters</option>
                    {topics.map((entry) => (
                      <option key={entry.topicId} value={entry.topicId}>
                        {entry.topicName} ({entry.questionCount})
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Difficulty">
                  <Select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}
                    disabled={availableDifficulties.length === 0}
                  >
                    <option value="">Any difficulty</option>
                    {availableDifficulties.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Questions">
                  <Select value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
                    {QUESTION_COUNTS.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <p className={styles.availability}>
                {availableCount === 0 ? (
                  'No questions match that selection.'
                ) : (
                  <>
                    <Badge tone="primary">{availableCount} available</Badge> You will be served{' '}
                    <strong>{Math.min(questionCount, availableCount)}</strong>, drawn at random.
                  </>
                )}
              </p>

              {startError && <Alert tone="danger">{startError}</Alert>}

              <Button
                size="lg"
                fullWidth
                icon="ph-play"
                loading={starting}
                disabled={availableCount === 0}
                onClick={() => void start()}
              >
                {starting ? 'Preparing your questions' : 'Start practice'}
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
                title="No sessions yet"
                description="Once you finish a session it appears here with its score, so you can go back over what you got wrong."
              />
            ) : (
              <ul className={styles.history}>
                {history.map((entry) => (
                  <li key={entry.id}>
                    <div className={styles.historyMain}>
                      <span className={styles.historyTitle}>
                        {/*
                          The chapter, or "Mixed practice". It used to fall back to the *subject*
                          name, which now just prints "Mathematics" on every unfiltered session —
                          true, and no use at all to a student scanning their history.
                        */}
                        {entry.filters.topic?.name ?? 'Mixed practice'}
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
