import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Icon, Modal, Progress, SkeletonText, StatTile } from '../../components/ui'
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
   * Optimistic, so the UI never lags a click behind. The response carries no correctness
   * — there is nothing to reveal yet — but it does carry the server's remaining time,
   * which is how a drifted countdown resynchronises. A 409 means time ran out: the server
   * has marked the paper, so this reloads to show the outcome.
   *
   * **A failed save is rolled back**, and that is not a cosmetic choice. It used to leave
   * the optimistic answer in place with an error beside it — so the header said "3
   * answered", the palette showed three filled keys, the submission dialog said "All 3
   * questions are answered", and the paper came back 0/12 with every question marked NOT
   * ANSWERED. The Phase H regression run reproduced exactly that by tripping the rate
   * limiter mid-paper. On a timed paper a counter that overstates what the server holds
   * is worse than a slow one: the student's own record of what they have done is the
   * thing they use to decide whether to submit.
   */
  const saveAnswer = useCallback(
    async (target: MockAttemptQuestion, patch: Partial<MockAttemptQuestion['response']>) => {
      if (!attemptId || !attempt || !isMockAttemptOpen(attempt)) return

      const previousResponse = target.response
      const nextResponse = { ...target.response, ...patch }
      const answered =
        nextResponse.selectedOptionKeys.length > 0 ||
        nextResponse.numericResponse !== null ||
        nextResponse.booleanResponse !== null

      // Narrowed inside, because `setAttempt` hands back the whole union and only an
      // in-progress attempt has questions to patch.
      const applyResponse = (response: MockAttemptQuestion['response']) =>
        setAttempt((current) =>
          current && isMockAttemptOpen(current)
            ? {
                ...current,
                questions: current.questions.map((entry) =>
                  entry.id === target.id ? { ...entry, response } : entry,
                ),
              }
            : current,
        )

      applyResponse({ ...nextResponse, answered })

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
        // Back to what the server actually holds, so the counter cannot lie.
        applyResponse(previousResponse)
        setSaveError(
          err instanceof ApiError
            ? `${err.message} That answer was not saved — try again.`
            : 'Could not save that answer. It was not saved — try again.',
        )
      } finally {
        setSaving(false)
      }
    },
    [attemptId, attempt, load],
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
        <ErrorState
          error={loadError}
          titleAs="h2"
          title="Could not load that attempt"
          onRetry={() => navigate('/mock-tests')}
        />
      </StudentShell>
    )
  }

  if (!attempt) {
    return (
      <StudentShell title="Mock test">
        <Card>
          <SkeletonText lines={5} label="Loading your test" />
        </Card>
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
          <Alert tone="warning" icon="ph-timer" className={styles.autoNote}>
            Your time ran out, so the answers you had saved were submitted automatically and marked.
          </Alert>
        )}

        {scored ? (
          <>
            <Card className={styles.summaryCard}>
              <p className={styles.summaryScore}>
                {attempt.score}
                <span>/{attempt.maxMarks}</span>
              </p>
              <Progress
                value={Math.max(0, attempt.score)}
                max={attempt.maxMarks}
                aria-label="Score"
                valueText={`${percent}%`}
                tone={percent >= 60 ? 'success' : percent >= 35 ? 'warning' : 'danger'}
              />
            </Card>

            <section className={styles.summaryRow}>
              <StatTile icon="ph-check-circle" tone="success" label="Correct" value={attempt.correctCount} />
              <StatTile icon="ph-x-circle" tone="danger" label="Incorrect" value={attempt.incorrectCount} />
              <StatTile
                icon="ph-minus-circle"
                tone="neutral"
                label="Unanswered"
                value={attempt.unansweredCount}
              />
              <StatTile
                icon="ph-target"
                label="Accuracy"
                value={`${attempt.accuracy}%`}
                hint="Of the questions you answered"
              />
              <StatTile
                icon="ph-clock"
                tone="neutral"
                label="Time taken"
                value={formatDuration(attempt.timeTakenSeconds)}
              />
            </section>
          </>
        ) : (
          /* The test withholds the score for now. Said plainly, rather than shown as a
             zero that would read as a result. */
          <div className={`card ${styles.withheld}`}>
            <Icon name="ph-lock-key" weight="bold" size="xl" />
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
            <Icon name="ph-star" weight="bold" /> +{xpAwarded} XP earned for completing a mock test today.
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
        <Card>
          <EmptyState
            titleAs="h2"
            icon="ph-warning-circle"
            title="This paper has no questions"
            description="Please tell your administrator. Nothing you do here will be marked against you."
            action={
              <ButtonLink to="/mock-tests" variant="secondary" icon="ph-arrow-left">
                Back to mock tests
              </ButtonLink>
            }
          />
        </Card>
      </StudentShell>
    )
  }

  const low = remaining !== null && remaining <= WARN_AT_SECONDS

  return (
    <StudentShell title={title} subtitle={`Attempt ${attempt.attemptNumber} · ${attempt.maxMarks} marks`} focus>
      {/*
        The clock is the one thing that must never scroll out of reach on a phone, so
        this bar is sticky under the topbar. The countdown itself is a *display* of
        `secondsRemaining` from the server — the browser is never asked what time it is
        (see the backend note on who owns the clock).
      */}
      <div className={styles.runnerHead}>
        <div className={styles.runnerProgress}>
          <Progress
            value={answeredCount}
            max={attempt.totalQuestions}
            size="sm"
            aria-label="Questions answered"
          />
          <span className={styles.progressText}>
            Question {current + 1} of {attempt.totalQuestions} · {answeredCount} answered
          </span>
        </div>
        <span
          className={`${styles.timer} ${low ? styles.timerLow : ''}`}
          role="timer"
          aria-live={low ? 'polite' : 'off'}
        >
          <Icon name="ph-timer" weight="bold" size="sm" />
          {remaining === null ? '—' : formatClock(remaining)}
        </span>
      </div>

      {low && (
        <Alert tone="danger" icon="ph-timer" className={styles.timeWarning}>
          Less than {Math.ceil(WARN_AT_SECONDS / 60)} minutes left. Your paper is submitted automatically when the
          time runs out — everything you have answered is already saved.
        </Alert>
      )}

      <div className={styles.runner}>
        <div className="card">
          <div className={styles.qMeta}>
            {question.topic?.name && <Badge tone="neutral">{question.topic.name}</Badge>}
            <Badge tone="primary" size="sm">
              {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
            </Badge>
            {question.negativeMarks > 0 && (
              <Badge tone="danger" size="sm">
                −{question.negativeMarks} if wrong
              </Badge>
            )}
          </div>

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

          {saveError && <Alert tone="danger">{saveError}</Alert>}

          <div className={styles.navRow}>
            <Button variant="outline" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
              Previous
            </Button>
            <span className={styles.savingNote}>{saving ? 'Saving…' : 'Answers save as you go'}</span>
            <Button
              iconAfter="ph-arrow-right"
              onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}
              disabled={current >= questions.length - 1}
            >
              Next
            </Button>
          </div>
        </div>

        {/* Palette: jump to any question, see which are answered. */}
        <aside className={`card ${styles.paletteCard}`}>
          <h2 className={styles.paletteTitle}>Questions</h2>
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

          <Button variant="danger" fullWidth icon="ph-check" onClick={() => setConfirmingSubmit(true)}>
            Submit for marking
          </Button>
        </aside>
      </div>

      {/*
        Submitting ends the attempt, and a mock test usually allows only one — so it
        asks first, unlike practice. A dialog rather than a panel inside the palette:
        it takes focus, it cannot be scrolled past, and on a phone the palette sits
        below the paper where a confirmation would appear off-screen.
      */}
      <Modal
        open={confirmingSubmit}
        onClose={() => setConfirmingSubmit(false)}
        title="Submit for marking?"
        description="You cannot come back to this attempt."
        tone="danger"
        icon="ph-warning"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingSubmit(false)} disabled={submitting}>
              Keep working
            </Button>
            <Button variant="danger" icon="ph-check" loading={submitting} onClick={() => void submit()}>
              {submitting ? 'Marking' : 'Yes, submit now'}
            </Button>
          </>
        }
      >
        <p>
          {attempt.totalQuestions - answeredCount > 0
            ? `${attempt.totalQuestions - answeredCount} of ${attempt.totalQuestions} questions are still unanswered. Unanswered questions score zero and are never penalised.`
            : `All ${attempt.totalQuestions} questions are answered.`}
        </p>
      </Modal>
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
                {correct && <Icon name="ph-check" weight="bold" className={styles.optIcon} label="correct answer" />}
                {chosen && !correct && <Icon name="ph-x" weight="bold" className={styles.optIcon} label="your answer" />}
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
