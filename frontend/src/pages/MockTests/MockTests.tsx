import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { api, ApiError } from '../../api/client'
import type { MockAttemptSummary, MockTestListResponse, MockTestSummary, Pagination } from '../../api/types'
import styles from './MockTest.module.css'

/**
 * The mock tests available to a student (Milestone 7).
 *
 * Every test here is a real published paper for the student's own class, from
 * `GET /mock-tests`. A test whose window has not opened is listed with its opening
 * time — because "there is a test on Saturday" is exactly what a student needs to know
 * — but the paper itself is not in this payload at all: questions only ever arrive
 * inside an attempt, which cannot be created outside the window.
 *
 * Nothing on this page decides what a student may do. Availability, attempts remaining
 * and whether a result may be shown are all computed by the server and simply rendered
 * here; the Start button being disabled is a courtesy, and pressing it anyway would be
 * refused.
 */

interface HistoryResponse {
  attempts: MockAttemptSummary[]
  pagination: Pagination
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

/** Why a test cannot be started right now, in the student's terms. */
function unavailableText(test: MockTestSummary): string | null {
  if (test.attemptsLeft === 0 && !test.resumeAttemptId) {
    return test.maxAttempts === 1
      ? 'You have used your attempt at this test.'
      : `You have used all ${test.maxAttempts} attempts.`
  }
  if (test.available) return null
  switch (test.unavailableReason) {
    case 'not-open-yet':
      return test.opensAt ? `Opens ${formatDateTime(test.opensAt)}.` : 'Not open yet.'
    case 'closed':
      return test.closesAt ? `Closed ${formatDateTime(test.closesAt)}.` : 'This test has closed.'
    default:
      return 'Not available.'
  }
}

export default function MockTests() {
  const navigate = useNavigate()

  const [data, setData] = useState<MockTestListResponse | null>(null)
  const [history, setHistory] = useState<MockAttemptSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [tests, attempts] = await Promise.all([
        api.get<MockTestListResponse>('/mock-tests'),
        api.get<HistoryResponse>('/mock-tests/attempts?limit=5'),
      ])
      setData(tests)
      setHistory(attempts.attempts)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load your mock tests.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function start(test: MockTestSummary) {
    // An unfinished attempt is resumed rather than restarted — the server returns the
    // same attempt with its original deadline, so this is the same button either way.
    if (test.resumeAttemptId) {
      navigate(`/mock-tests/attempts/${test.resumeAttemptId}`)
      return
    }

    setStartingId(test.id)
    setStartError(null)
    try {
      const res = await api.post<{ attempt: { id: string } }>(`/mock-tests/${test.id}/attempts`, {})
      navigate(`/mock-tests/attempts/${res.attempt.id}`)
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : 'Could not start that test. Please try again.')
      setStartingId(null)
    }
  }

  return (
    <StudentShell
      title="Mock Tests"
      subtitle={data?.classLevel ? `Timed papers set for ${data.classLevel}` : undefined}
    >
      {loadError && (
        <div className={`card ${styles.centered}`}>
          <h3>Could not load your mock tests</h3>
          <p className="error-text">{loadError}</p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      )}

      {!data && !loadError && (
        <div className={styles.centered}>
          <Spinner />
          <p>Loading your mock tests…</p>
        </div>
      )}

      {data && !loadError && (
        <>
          {startError && <p className="error-text">{startError}</p>}

          {data.tests.length === 0 ? (
            <div className={`card ${styles.empty}`}>
              <i className="ph-bold ph-exam" />
              <h3>No mock tests yet</h3>
              <p>
                {data.reason === 'no-class'
                  ? 'Add your class to your profile and the tests set for it will appear here.'
                  : `No mock tests have been published for ${data.classLevel} yet. This page fills in as soon as one is.`}
              </p>
              {data.reason === 'no-class' ? (
                <Link to="/profile">
                  <Button variant="outline">Go to my profile</Button>
                </Link>
              ) : (
                <Link to="/practice">
                  <Button variant="outline">Practise in the meantime</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className={styles.testGrid}>
              {data.tests.map((test) => {
                const blocked = unavailableText(test)
                const canStart = (test.available && test.attemptsLeft > 0) || test.resumeAttemptId !== null

                return (
                  <article key={test.id} className={`card ${styles.testCard}`}>
                    <header className={styles.testHead}>
                      <h3>{test.title}</h3>
                      {test.resumeAttemptId && <span className={styles.badgeOpen}>In progress</span>}
                    </header>

                    {test.description && <p className={styles.testDescription}>{test.description}</p>}

                    <dl className={styles.testFacts}>
                      <div>
                        <dt>Questions</dt>
                        <dd>{test.totalQuestions}</dd>
                      </div>
                      <div>
                        <dt>Marks</dt>
                        <dd>{test.totalMarks}</dd>
                      </div>
                      <div>
                        <dt>Time</dt>
                        <dd>{test.durationMinutes} min</dd>
                      </div>
                      <div>
                        <dt>Attempts</dt>
                        <dd>
                          {test.attemptsUsed}/{test.maxAttempts}
                        </dd>
                      </div>
                    </dl>

                    {(test.opensAt || test.closesAt) && (
                      <p className={styles.window}>
                        <i className="ph-bold ph-calendar-blank" />{' '}
                        {test.opensAt && `Opens ${formatDateTime(test.opensAt)}`}
                        {test.opensAt && test.closesAt && ' · '}
                        {test.closesAt && `Closes ${formatDateTime(test.closesAt)}`}
                      </p>
                    )}

                    {blocked && <p className={styles.blocked}>{blocked}</p>}

                    <div className={styles.testActions}>
                      <Button onClick={() => void start(test)} disabled={!canStart || startingId === test.id}>
                        {startingId === test.id
                          ? 'Opening…'
                          : test.resumeAttemptId
                            ? 'Resume test'
                            : `Start test (${test.durationMinutes} min)`}
                      </Button>
                    </div>

                    {/* The student's own attempts at this test, with whatever the test's
                        settings allow them to see of each. */}
                    {test.attempts.length > 0 && (
                      <ul className={styles.attemptList}>
                        {test.attempts.map((attempt) => (
                          <li key={attempt.id}>
                            <span className={styles.attemptWhen}>
                              Attempt {attempt.attemptNumber} · {formatDateTime(attempt.startedAt)}
                              {attempt.autoSubmitted && ' · time ran out'}
                            </span>
                            <span className={styles.attemptScore}>
                              {attempt.status === 'in_progress'
                                ? 'Unfinished'
                                : attempt.resultAvailable
                                  ? `${attempt.score}/${attempt.maxMarks}`
                                  : attempt.disclosureReason === 'awaiting-close'
                                    ? 'Results after close'
                                    : 'Submitted'}
                            </span>
                            <Link to={`/mock-tests/attempts/${attempt.id}`} className={styles.attemptLink}>
                              {attempt.status === 'in_progress'
                                ? 'Resume'
                                : attempt.reviewAvailable
                                  ? 'Review'
                                  : 'View'}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                )
              })}
            </div>
          )}

          <div className="card">
            <h3>🕘 Recent attempts</h3>
            {history === null ? (
              <Spinner />
            ) : history.length === 0 ? (
              <div className={styles.empty}>
                <i className="ph-bold ph-clock-counter-clockwise" />
                <p>You haven’t sat a mock test yet. Your attempts and scores will be listed here.</p>
              </div>
            ) : (
              <ul className={styles.history}>
                {history.map((attempt) => (
                  <li key={attempt.id}>
                    <div className={styles.historyMain}>
                      <span className={styles.historyTitle}>{attempt.testTitle ?? 'Mock test'}</span>
                      <span className={styles.historyMeta}>
                        {formatDateTime(attempt.startedAt)}
                        {attempt.timeTakenSeconds !== null && ` · ${formatDuration(attempt.timeTakenSeconds)}`}
                        {attempt.autoSubmitted && ' · submitted automatically'}
                      </span>
                    </div>
                    <span className={styles.historyScore}>
                      {attempt.status === 'in_progress'
                        ? 'Unfinished'
                        : attempt.resultAvailable
                          ? `${attempt.score}/${attempt.maxMarks}`
                          : '—'}
                    </span>
                    <Link to={`/mock-tests/attempts/${attempt.id}`} className={styles.attemptLink}>
                      {attempt.status === 'in_progress' ? 'Resume' : 'View'}
                    </Link>
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
