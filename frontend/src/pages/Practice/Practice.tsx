import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { api, ApiError } from '../../api/client'
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

  const [options, setOptions] = useState<PracticeOptionsResponse | null>(null)
  const [history, setHistory] = useState<PracticeHistoryEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [subjectId, setSubjectId] = useState('')
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
      setLoadError(err instanceof ApiError ? err.message : 'Could not load the Practice Zone.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Memoised so the derivations below have a stable dependency: `options?.subjects ??
  // []` would be a fresh array on every render, which makes any `useMemo` over it
  // recompute every time and defeats the point.
  const subjects: PracticeSubjectOption[] = useMemo(() => options?.subjects ?? [], [options])
  const selectedSubject = useMemo(
    () => subjects.find((entry) => entry.subjectId === subjectId) ?? null,
    [subjects, subjectId],
  )

  /**
   * The topics on offer: those of the chosen subject, or every topic while no subject
   * is chosen. Derived rather than stored, so it can never disagree with the subject.
   */
  const topics = useMemo(
    () => (selectedSubject ? selectedSubject.topics : subjects.flatMap((entry) => entry.topics)),
    [subjects, selectedSubject],
  )

  const selectedTopic = topics.find((entry) => entry.topicId === topicId) ?? null

  /**
   * Only the difficulties that exist in the narrowest chosen scope. Offering `Hard`
   * when the topic has none would let a student pick a combination with nothing
   * behind it and then be refused.
   */
  const availableDifficulties: Difficulty[] = selectedTopic
    ? selectedTopic.difficulties
    : selectedSubject
      ? selectedSubject.difficulties
      : DIFFICULTIES.filter((level) => subjects.some((entry) => entry.difficulties.includes(level)))

  /** How many questions the current selection really has behind it. */
  const availableCount = selectedTopic
    ? selectedTopic.questionCount
    : selectedSubject
      ? selectedSubject.questionCount
      : subjects.reduce((sum, entry) => sum + entry.questionCount, 0)

  function chooseSubject(nextSubjectId: string) {
    setSubjectId(nextSubjectId)
    // A topic from the previous subject would be a contradiction, so it is cleared.
    setTopicId('')
    setDifficulty('')
  }

  function chooseTopic(nextTopicId: string) {
    setTopicId(nextTopicId)
    setDifficulty('')
    // Choosing a topic implies its subject, which keeps the two boxes consistent when
    // a topic is picked while "All subjects" is showing.
    if (nextTopicId && !subjectId) {
      const owner = subjects.find((entry) => entry.topics.some((topic) => topic.topicId === nextTopicId))
      if (owner) setSubjectId(owner.subjectId)
    }
  }

  async function start() {
    setStarting(true)
    setStartError(null)
    try {
      const body: Record<string, unknown> = { questionCount }
      if (subjectId) body.subjectId = subjectId
      if (topicId) body.topicId = topicId
      if (difficulty) body.difficulty = difficulty

      const res = await api.post<StartResponse>('/practice/sessions', body)
      navigate(`/practice/${res.session.id}`)
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : 'Could not start practice. Please try again.')
      setStarting(false)
    }
  }

  const openSession = history?.find((entry) => entry.status === 'in_progress') ?? null

  return (
    <StudentShell
      title="Practice Zone"
      subtitle={options?.classLevel ? `Published questions for ${options.classLevel}` : undefined}
    >
      {loadError && (
        <div className={`card ${styles.centered}`}>
          <h3>Could not load the Practice Zone</h3>
          <p className="error-text">{loadError}</p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      )}

      {!options && !loadError && (
        <div className={styles.centered}>
          <Spinner />
          <p>Loading what you can practise…</p>
        </div>
      )}

      {options && !loadError && (
        <>
          {/* An unfinished session is the most useful thing to offer first. */}
          {openSession && (
            <div className={`card ${styles.resume}`}>
              <div>
                <h3>You have an unfinished session</h3>
                <p>
                  {openSession.totalQuestions} questions, started {formatWhen(openSession.startedAt)}. Your answers were
                  saved as you went.
                </p>
              </div>
              <Link to={`/practice/${openSession.id}`}>
                <Button>Resume</Button>
              </Link>
            </div>
          )}

          {subjects.length === 0 ? (
            <div className={`card ${styles.empty}`}>
              <i className="ph-bold ph-books" />
              <h3>Nothing to practise yet</h3>
              <p>
                {options.reason === 'no-class'
                  ? 'Add your class to your profile and the questions published for it will appear here.'
                  : `No questions have been published for ${options.classLevel} yet. This page fills in as soon as the question bank has content for your class.`}
              </p>
              {options.reason === 'no-class' && (
                <Link to="/profile">
                  <Button variant="outline">Go to my profile</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="card">
              <h3>🎯 Start a practice session</h3>

              <div className={styles.pickers}>
                <div className="form-group">
                  <label htmlFor="practice-subject">Subject</label>
                  <select
                    id="practice-subject"
                    className="form-control"
                    value={subjectId}
                    onChange={(e) => chooseSubject(e.target.value)}
                  >
                    <option value="">All subjects ({subjects.reduce((sum, e) => sum + e.questionCount, 0)})</option>
                    {subjects.map((entry) => (
                      <option key={entry.subjectId} value={entry.subjectId}>
                        {entry.subjectName} ({entry.questionCount})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="practice-topic">Topic</label>
                  <select
                    id="practice-topic"
                    className="form-control"
                    value={topicId}
                    onChange={(e) => chooseTopic(e.target.value)}
                  >
                    <option value="">All topics</option>
                    {topics.map((entry) => (
                      <option key={entry.topicId} value={entry.topicId}>
                        {entry.topicName} ({entry.questionCount})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="practice-difficulty">Difficulty</label>
                  <select
                    id="practice-difficulty"
                    className="form-control"
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
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="practice-count">Questions</label>
                  <select
                    id="practice-count"
                    className="form-control"
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                  >
                    {QUESTION_COUNTS.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className={styles.availability}>
                {availableCount === 0
                  ? 'No questions match that selection.'
                  : `${availableCount} question${availableCount === 1 ? '' : 's'} available — you will be served ${Math.min(questionCount, availableCount)}.`}
              </p>

              {startError && <p className="error-text">{startError}</p>}

              <Button onClick={() => void start()} disabled={starting || availableCount === 0}>
                {starting ? 'Preparing your questions…' : 'Start practice'}
              </Button>
            </div>
          )}

          {/* Real history only. A student who has never practised gets an empty state. */}
          <div className="card">
            <h3>🕘 Recent practice</h3>
            {history === null ? (
              <Spinner />
            ) : history.length === 0 ? (
              <div className={styles.empty}>
                <i className="ph-bold ph-clock-counter-clockwise" />
                <p>You haven’t practised yet. Your sessions and scores will be listed here.</p>
              </div>
            ) : (
              <ul className={styles.history}>
                {history.map((entry) => (
                  <li key={entry.id}>
                    <div className={styles.historyMain}>
                      <span className={styles.historyTitle}>
                        {entry.filters.topic?.name ?? entry.filters.subject?.name ?? 'Mixed practice'}
                        {entry.filters.difficulty ? ` · ${entry.filters.difficulty}` : ''}
                      </span>
                      <span className={styles.historyMeta}>
                        {formatWhen(entry.startedAt)} · {entry.totalQuestions} questions
                        {entry.timeTakenSeconds !== null ? ` · ${formatDuration(entry.timeTakenSeconds)}` : ''}
                      </span>
                    </div>
                    {entry.status === 'submitted' ? (
                      <>
                        <span className={styles.historyScore}>
                          {entry.score}/{entry.maxMarks}
                        </span>
                        <Link to={`/practice/${entry.id}`} className={styles.historyLink}>
                          Review
                        </Link>
                      </>
                    ) : (
                      <>
                        <span className={styles.historyOpen}>Unfinished</span>
                        <Link to={`/practice/${entry.id}`} className={styles.historyLink}>
                          Resume
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </StudentShell>
  )
}
