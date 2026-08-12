import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import MathText from '../../components/MathText'
import { api, ApiError } from '../../api/client'
import {
  isMockAttemptOpen,
  isMockAttemptReviewed,
  isMockAttemptScored,
  type MockAttemptQuestion,
  type MockAttemptView,
  type MockDisclosure,
  type MockReviewQuestion,
} from '../../api/types'
import styles from './MockTest.module.css'

/**
 * Sitting a mock test, and seeing whatever the test lets you see afterwards.
 *
 * One route serves every state, because the server decides which one it is: an open
 * attempt arrives answer-stripped with a deadline, a finished one arrives as a full
 * review, as a score without answers, or as nothing but the fact that it was submitted
 * — according to the test's own disclosure settings. The narrowing helpers in
 * `api/types.ts` are what pick between them, so the review-only fields are *unreachable*
 * rather than merely unrendered while the paper is open.
 *
 * ## The countdown is a display, not a rule
 *
 * The clock on screen exists so a student can pace themselves. It is derived from the
 * server's `secondsRemaining`, and when it reaches zero this page submits — but that
 * submission is a convenience, not the enforcement. The server refuses a late answer
 * and grades the paper as at its own stored deadline whatever this page does, so a
 * tampered countdown, a paused tab or a wrong system clock changes nothing about the
 * mark. That is also why the deadline is computed as *now + secondsRemaining* rather
 * than from the absolute `expiresAt`: a client whose clock is minutes out would
 * otherwise show a wildly wrong timer, when what it needs to show is how much time is
 * left.
 *
 * Nothing here marks anything. There is no answer key in the browser to mark with until
 * the server has decided the student may have one.
 *
 * **Lazily loaded** by `App.tsx` — it pulls in KaTeX through `MathText`, which must stay
 * out of the main bundle.
 */

interface AttemptResponse {
  attempt: MockAttemptView
  disclosure?: MockDisclosure
}

interface SubmitResponse extends AttemptResponse {
  xpAwarded: number
  submitted: boolean
  alreadySubmitted: boolean
}

function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

/** Under this much time left, the clock starts warning rather than just reporting. */
const WARN_AT_SECONDS = 120

export default function MockTestAttempt() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const navigate = useNavigate()

  const [attempt, setAttempt] = useState<MockAttemptView | null>(null)
  const [disclosure, setDisclosure] = useState<MockDisclosure | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [xpAwarded, setXpAwarded] = useState<number | null>(null)
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)

  /**
   * When the paper is due, as a local timestamp. Set only from a server response, so it
   * cannot drift with optimistic answer updates, and derived from `secondsRemaining`
   * rather than `expiresAt` for the clock-skew reason in the module comment.
   */
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  /** Guards the automatic submission so a stalled request cannot fire it twice. */
  const autoSubmittedRef = useRef(false)

  const applyResponse = useCallback((res: AttemptResponse) => {
    setAttempt(res.attempt)
    setDisclosure(res.disclosure ?? null)
    if (isMockAttemptOpen(res.attempt)) {
      setDeadlineAt(Date.now() + res.attempt.secondsRemaining * 1000)
      setRemaining(res.attempt.secondsRemaining)
    } else {
      setDeadlineAt(null)
      setRemaining(null)
    }
  }, [])

  const load = useCallback(async () => {
    if (!attemptId) return
    setLoadError(null)
    try {
      applyResponse(await api.get<AttemptResponse>(`/mock-tests/attempts/${attemptId}`))
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load that attempt.')
    }
  }, [attemptId, applyResponse])

  useEffect(() => {
    void load()
  }, [load])

  const submit = useCallback(
    async (automatic = false) => {
      if (!attemptId) return
      setSubmitting(true)
      setSaveError(null)
      try {
        const res = await api.post<SubmitResponse>(`/mock-tests/attempts/${attemptId}/submit`, {})
        applyResponse(res)
        setXpAwarded(res.xpAwarded)
        setCurrent(0)
        setConfirmingSubmit(false)
      } catch (err) {
        setSaveError(
          err instanceof ApiError
            ? err.message
            : automatic
              ? 'Your time is up, but the paper could not be submitted. Reload the page.'
              : 'Could not submit your attempt.',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [attemptId, applyResponse],
  )

  // The countdown. Reads the deadline set from the last server response, so it survives
  // every optimistic answer update without restarting.
  useEffect(() => {
    if (deadlineAt === null) return

    const tick = () => {
      const left = Math.max(0, Math.round((deadlineAt - Date.now()) / 1000))
      setRemaining(left)
      if (left === 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true
        // The server would grade this paper at its deadline regardless; submitting here
        // simply means the student sees the outcome without having to reload.
        void submit(true)
      }
    }

    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [deadlineAt, submit])

  const open = attempt !== null && isMockAttemptOpen(attempt)
  // Stable across renders so the count below memoises usefully.
  const questions = useMemo(
    () => (attempt && isMockAttemptOpen(attempt) ? attempt.questions : []),
    [attempt],
  )
  const question = questions[current]
  const answeredCount = useMemo(() => questions.filter((entry) => entry.response.answered).length, [questions])

  /**
   * Saves one answer.
   *
   * Optimistic, so the UI never lags a click behind, and a failed save leaves the choice
   * visible with an error beside it. The response carries no correctness — there is
   * nothing to reveal yet — but it does carry the server's remaining time, which is how
   * a drifted countdown resynchronises. A 409 means time ran out: the server has marked
   * the paper, so this reloads to show the outcome.
   */
  const saveAnswer = useCallback(
    async (target: MockAttemptQuestion, patch: Partial<MockAttemptQuestion['response']>) => {
      if (!attemptId || !attempt || !isMockAttemptOpen(attempt)) return

      const nextResponse = { ...target.response, ...patch }
      const answered =
        nextResponse.selectedOptionKeys.length > 0 ||
        nextResponse.numericResponse !== null ||
        nextResponse.booleanResponse !== null

      setAttempt({
        ...attempt,
        questions: attempt.questions.map((entry) =>
          entry.id === target.id ? { ...entry, response: { ...nextResponse, answered } } : entry,
        ),
      })

      setSaving(true)
      setSaveError(null)
      try {
        const res = await api.put<{ secondsRemaining: number }>(`/mock-tests/attempts/${attemptId}/answers`, {
          questionId: target.id,
          selectedOptionKeys: nextResponse.selectedOptionKeys,
          numericResponse: nextResponse.numericResponse,
          booleanResponse: nextResponse.booleanResponse,
        })
        // Trust the server's clock over the local one.
        setDeadlineAt(Date.now() + res.secondsRemaining * 1000)
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setSaveError(err.message)
          await load()
          return
        }
        setSaveError(err instanceof ApiError ? err.message : 'Could not save that answer.')
      } finally {
        setSaving(false)
      }
    },
    [attempt, attemptId, load],
  )

  function chooseOption(target: MockAttemptQuestion, key: string) {
    if (target.type === 'multiple_choice') {
      const keys = target.response.selectedOptionKeys.includes(key)
        ? target.response.selectedOptionKeys.filter((existing) => existing !== key)
        : [...target.response.selectedOptionKeys, key]
      void saveAnswer(target, { selectedOptionKeys: keys })
    } else {
      // Clicking the chosen option again clears it, which is how a student un-answers.
      const keys = target.response.selectedOptionKeys[0] === key ? [] : [key]
      void saveAnswer(target, { selectedOptionKeys: keys })
    }
  }

  // -------------------------------------------------------------------------
  // Loading / error
  // -------------------------------------------------------------------------

  if (loadError) {
    return (
      <StudentShell title="Mock test">
        <div className={`card ${styles.centered}`}>
          <h3>Could not load that attempt</h3>
          <p className="error-text">{loadError}</p>
          <Button onClick={() => navigate('/mock-tests')}>Back to mock tests</Button>
        </div>
      </StudentShell>
    )
  }

  if (!attempt) {
    return (
      <StudentShell title="Mock test">
        <div className={styles.centered}>
          <Spinner />
          <p>Loading your test…</p>
        </div>
      </StudentShell>
    )
  }

  const title = attempt.testTitle ?? 'Mock test'

  // -------------------------------------------------------------------------
  // Finished: review, score-only, or withheld
  // -------------------------------------------------------------------------

  if (!open) {
    const scored = isMockAttemptScored(attempt)
    const reviewed = isMockAttemptReviewed(attempt)
    const percent =
      scored && attempt.maxMarks > 0 ? Math.round((Math.max(0, attempt.score) / attempt.maxMarks) * 100) : 0

    return (
      <StudentShell title={title} subtitle={`Attempt ${attempt.attemptNumber} · submitted`}>
        {attempt.autoSubmitted && (
          <p className={styles.autoNote}>
            <i className="ph-bold ph-timer" /> Your time ran out, so the answers you had saved were submitted
            automatically and marked.
          </p>
        )}

        {scored ? (
          <section className={styles.summaryRow}>
            <div className={`card ${styles.summaryCard}`}>
              <div className={styles.summaryScore}>
                {attempt.score}
                <span>/{attempt.maxMarks}</span>
              </div>
              <div className={styles.summaryLabel}>Score ({percent}%)</div>
            </div>
            <div className="card">
              <div className={styles.tileValue}>{attempt.correctCount}</div>
              <div className={styles.tileLabel}>Correct</div>
            </div>
            <div className="card">
              <div className={styles.tileValue}>{attempt.incorrectCount}</div>
              <div className={styles.tileLabel}>Incorrect</div>
            </div>
            <div className="card">
              <div className={styles.tileValue}>{attempt.unansweredCount}</div>
              <div className={styles.tileLabel}>Unanswered</div>
            </div>
            <div className="card">
              <div className={styles.tileValue}>{attempt.accuracy}%</div>
              <div className={styles.tileLabel}>Accuracy (of answered)</div>
            </div>
            <div className="card">
              <div className={styles.tileValue}>{formatDuration(attempt.timeTakenSeconds)}</div>
              <div className={styles.tileLabel}>Time taken</div>
            </div>
          </section>
        ) : (
          /* The test withholds the score for now. Said plainly, rather than shown as a
             zero that would read as a result. */
          <div className={`card ${styles.withheld}`}>
            <i className="ph-bold ph-lock-key" />
            <h3>Your answers are in</h3>
            <p>
              {disclosure?.reason === 'awaiting-close'
                ? 'This test releases results after it closes. Come back once the window has ended and your score will be here.'
                : 'This test does not publish scores to students. Your answers have been recorded and marked.'}
            </p>
          </div>
        )}

        {xpAwarded !== null && xpAwarded > 0 && (
          <p className={styles.xpNote}>
            <i className="ph-bold ph-star" /> +{xpAwarded} XP earned for completing a mock test today.
          </p>
        )}

        <div className={styles.reviewActions}>
          <Link to="/mock-tests">
            <Button>Back to mock tests</Button>
          </Link>
          <Link to="/dashboard">
            <Button variant="outline">Back to dashboard</Button>
          </Link>
        </div>

        {reviewed ? (
          <ol className={styles.reviewList}>
            {attempt.questions.map((entry) => (
              <ReviewQuestion key={entry.id} entry={entry} />
            ))}
          </ol>
        ) : (
          scored && (
            <p className={styles.reviewPending}>
              {disclosure?.reason === 'awaiting-close'
                ? 'The correct answers and explanations will be released when this test closes.'
                : 'The correct answers for this test are not released to students.'}
            </p>
          )
        )}
      </StudentShell>
    )
  }

  // -------------------------------------------------------------------------
  // Working
  // -------------------------------------------------------------------------

  if (!question) {
    return (
      <StudentShell title={title}>
        <div className={`card ${styles.centered}`}>
          <h3>This paper has no questions</h3>
          <p>Please tell your administrator. Nothing you do here will be marked against you.</p>
          <Button onClick={() => navigate('/mock-tests')}>Back to mock tests</Button>
        </div>
      </StudentShell>
    )
  }

  const low = remaining !== null && remaining <= WARN_AT_SECONDS

  return (
    <StudentShell title={title} subtitle={`Attempt ${attempt.attemptNumber} · ${attempt.maxMarks} marks`}>
      <div className={styles.runnerHead}>
        <span className={styles.progressText}>
          Question {current + 1} of {attempt.totalQuestions} · {answeredCount} answered
        </span>
        <span
          className={`${styles.timer} ${low ? styles.timerLow : ''}`}
          role="timer"
          aria-live={low ? 'polite' : 'off'}
        >
          <i className="ph-bold ph-timer" /> {remaining === null ? '—' : formatClock(remaining)}
        </span>
      </div>

      {low && (
        <p className={styles.timeWarning}>
          Less than {Math.ceil(WARN_AT_SECONDS / 60)} minutes left. Your paper is submitted automatically when the
          time runs out — everything you have answered is already saved.
        </p>
      )}

      <div className={styles.runner}>
        <div className="card">
          <p className={styles.qMeta}>
            {[question.subject?.name, question.topic?.name].filter(Boolean).join(' › ')} · {question.marks}{' '}
            {question.marks === 1 ? 'mark' : 'marks'}
            {question.negativeMarks > 0 ? ` · −${question.negativeMarks} if wrong` : ''}
          </p>

          <div className={styles.qText}>
            <MathText>{question.questionText}</MathText>
          </div>

          {question.type === 'multiple_choice' && (
            <p className={styles.hint}>Select every correct option — all of them must be right.</p>
          )}

          {/* --- Choice questions --- */}
          {question.options.length > 0 && (
            <div className={styles.options}>
              {question.options.map((option) => {
                const chosen = question.response.selectedOptionKeys.includes(option.key)
                return (
                  <button
                    type="button"
                    key={option.key}
                    className={`${styles.option} ${chosen ? styles.optionChosen : ''}`}
                    onClick={() => chooseOption(question, option.key)}
                    aria-pressed={chosen}
                  >
                    <span className={styles.optionKey}>{option.key.toUpperCase()}</span>
                    <MathText>{option.text}</MathText>
                  </button>
                )
              })}
            </div>
          )}

          {/* --- True / false --- */}
          {question.type === 'true_false' && (
            <div className={styles.options}>
              {[true, false].map((value) => (
                <button
                  type="button"
                  key={String(value)}
                  className={`${styles.option} ${
                    question.response.booleanResponse === value ? styles.optionChosen : ''
                  }`}
                  onClick={() =>
                    void saveAnswer(question, {
                      booleanResponse: question.response.booleanResponse === value ? null : value,
                    })
                  }
                  aria-pressed={question.response.booleanResponse === value}
                >
                  <span className={styles.optionKey}>{value ? 'T' : 'F'}</span>
                  {value ? 'True' : 'False'}
                </button>
              ))}
            </div>
          )}

          {/* --- Numeric --- */}
          {question.type === 'numeric' && (
            <div className={styles.numericRow}>
              <label htmlFor="numeric-answer">Your answer</label>
              <input
                id="numeric-answer"
                className="form-control"
                type="number"
                step="any"
                inputMode="decimal"
                value={question.response.numericResponse ?? ''}
                onChange={(e) => {
                  const raw = e.target.value
                  void saveAnswer(question, { numericResponse: raw === '' ? null : Number(raw) })
                }}
              />
            </div>
          )}

          {saveError && <p className="error-text">{saveError}</p>}

          <div className={styles.navRow}>
            <Button variant="outline" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
              ← Previous
            </Button>
            <span className={styles.savingNote}>{saving ? 'Saving…' : 'Answers save as you go'}</span>
            <Button
              onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}
              disabled={current >= questions.length - 1}
            >
              Next →
            </Button>
          </div>
        </div>

        {/* Palette: jump to any question, see which are answered. */}
        <aside className="card">
          <h4>Questions</h4>
          <div className={styles.palette}>
            {questions.map((entry, index) => (
              <button
                type="button"
                key={entry.id}
                className={`${styles.paletteBtn} ${index === current ? styles.paletteCurrent : ''} ${
                  entry.response.answered ? styles.paletteAnswered : ''
                }`}
                onClick={() => setCurrent(index)}
                aria-label={`Question ${index + 1}${entry.response.answered ? ', answered' : ''}`}
              >
                {index + 1}
              </button>
            ))}
          </div>
          <p className={styles.paletteNote}>
            {answeredCount} of {attempt.totalQuestions} answered. Unanswered questions score zero and are never
            penalised.
          </p>

          {/* Submitting ends the attempt, and a mock test usually allows only one — so
              it asks first, unlike practice. */}
          {confirmingSubmit ? (
            <div className={styles.confirm}>
              <p>
                Submit for marking? {attempt.totalQuestions - answeredCount > 0
                  ? `${attempt.totalQuestions - answeredCount} question(s) are still unanswered, and you cannot come back to this attempt.`
                  : 'You cannot come back to this attempt.'}
              </p>
              <Button variant="danger" fullWidth onClick={() => void submit()} disabled={submitting}>
                {submitting ? 'Marking…' : 'Yes, submit now'}
              </Button>
              <Button variant="outline" fullWidth onClick={() => setConfirmingSubmit(false)} disabled={submitting}>
                Keep working
              </Button>
            </div>
          ) : (
            <Button variant="danger" fullWidth onClick={() => setConfirmingSubmit(true)} disabled={submitting}>
              Submit for marking
            </Button>
          )}
        </aside>
      </div>
    </StudentShell>
  )
}

/**
 * One reviewed question: what the student chose, what was correct, and why.
 *
 * Split out so the review list stays readable, and because every field it touches
 * exists only on the graded-and-released shape — a component that cannot be handed an
 * in-progress question cannot leak an answer from one.
 */
function ReviewQuestion({ entry }: { entry: MockReviewQuestion }) {
  const state = !entry.response.answered ? 'skipped' : entry.outcome.isCorrect ? 'correct' : 'incorrect'
  const label = state === 'skipped' ? 'Not answered' : state === 'correct' ? 'Correct' : 'Incorrect'

  function correctAnswerText(): string {
    if (entry.type === 'true_false') return entry.correctAnswer.booleanAnswer ? 'True' : 'False'
    if (entry.type === 'numeric') {
      const tolerance = entry.correctAnswer.tolerance
      const value = String(entry.correctAnswer.numericAnswer ?? '—')
      return tolerance && tolerance > 0 ? `${value} (± ${tolerance})` : value
    }
    return entry.correctAnswer.optionKeys.map((key) => key.toUpperCase()).join(', ')
  }

  function yourAnswerText(): string {
    if (!entry.response.answered) return '—'
    if (entry.type === 'true_false') return entry.response.booleanResponse ? 'True' : 'False'
    if (entry.type === 'numeric') return String(entry.response.numericResponse)
    return entry.response.selectedOptionKeys.map((key) => key.toUpperCase()).join(', ')
  }

  return (
    <li className={`card ${styles.reviewItem} ${styles[state]}`}>
      <div className={styles.reviewHead}>
        <span className={styles.reviewOrder}>Q{entry.order}</span>
        <span className={`${styles.verdict} ${styles[`verdict_${state}`]}`}>{label}</span>
        <span className={styles.reviewMarks}>
          {entry.outcome.awardedMarks > 0 ? `+${entry.outcome.awardedMarks}` : entry.outcome.awardedMarks} /{' '}
          {entry.outcome.marks}
        </span>
      </div>

      <div className={styles.qText}>
        <MathText>{entry.questionText}</MathText>
      </div>

      {entry.options.length > 0 && (
        <ul className={styles.reviewOptions}>
          {entry.options.map((option) => {
            const chosen = entry.response.selectedOptionKeys.includes(option.key)
            const correct = entry.correctAnswer.optionKeys.includes(option.key)
            return (
              <li
                key={option.key}
                className={`${correct ? styles.optCorrect : ''} ${chosen && !correct ? styles.optWrong : ''}`}
              >
                <span className={styles.optionKey}>{option.key.toUpperCase()}</span>
                <MathText>{option.text}</MathText>
                {correct && <i className={`ph-bold ph-check ${styles.optIcon}`} aria-label="correct answer" />}
                {chosen && !correct && <i className={`ph-bold ph-x ${styles.optIcon}`} aria-label="your answer" />}
              </li>
            )
          })}
        </ul>
      )}

      <dl className={styles.answerPair}>
        <div>
          <dt>Your answer</dt>
          <dd>{yourAnswerText()}</dd>
        </div>
        <div>
          <dt>Correct answer</dt>
          <dd>{correctAnswerText()}</dd>
        </div>
      </dl>

      {entry.explanation && (
        <div className={styles.explanation}>
          <h5>Explanation</h5>
          <MathText>{entry.explanation}</MathText>
        </div>
      )}

      {entry.revisionChanged && (
        <p className={styles.revisionNote}>
          This question has been edited since you answered it, so the wording above may differ from what you saw. Your
          mark was calculated against the version you were served.
        </p>
      )}
    </li>
  )
}
