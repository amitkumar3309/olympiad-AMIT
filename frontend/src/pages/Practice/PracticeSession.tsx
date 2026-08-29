import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import { Alert, Badge, Button, ButtonLink, Card, ErrorState, Icon, Progress, SkeletonText, StatTile } from '../../components/ui'
import MathText from '../../components/MathText'
import { api, ApiError } from '../../api/client'
import {
  isReviewed,
  type PracticeQuestion,
  type PracticeReviewQuestion,
  type PracticeSessionView,
} from '../../api/types'
import styles from './Practice.module.css'

/**
 * Working through a practice session, and reviewing it afterwards.
 *
 * One route serves both states, because the server decides which it is: an
 * in-progress session comes back answer-stripped, and a submitted one comes back
 * marked. `isReviewed()` narrows between them, so the review-only fields are
 * unreachable — not merely unrendered — while the session is still open. Reloading
 * mid-session resumes exactly where the student left off, because every answer was
 * already saved on the server.
 *
 * Nothing here marks anything. There is no answer key in the browser to mark with,
 * which is the whole point of the design: `outcome` and `correctAnswer` only exist on
 * the payload once the session has been submitted.
 *
 * This module is **lazily loaded** by `App.tsx` — it pulls in KaTeX through
 * `MathText`, which is ~260 KB and must stay out of the main bundle.
 */

interface SessionResponse {
  session: PracticeSessionView
}

interface SubmitResponse {
  session: PracticeSessionView
  xpAwarded: number
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

export default function PracticeSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<PracticeSessionView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)

  /** Answers held locally for instant feedback, then saved to the server. */
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [xpAwarded, setXpAwarded] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const load = useCallback(async () => {
    if (!sessionId) return
    setLoadError(null)
    try {
      const res = await api.get<SessionResponse>(`/practice/sessions/${sessionId}`)
      setSession(res.session)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load that practice session.')
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  // A running clock while the session is open, so the student can see the time that
  // will be recorded. The authoritative figure is the server's start-to-submit span.
  useEffect(() => {
    if (!session || isReviewed(session)) return
    const started = new Date(session.startedAt).getTime()
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [session])

  const reviewed = session !== null && isReviewed(session)
  // Stable across renders, so the count below memoises usefully (see Practice.tsx).
  const questions = useMemo(() => session?.questions ?? [], [session])
  const question = questions[current]

  const answeredCount = useMemo(() => questions.filter((entry) => entry.response.answered).length, [questions])

  /**
   * Saves one answer.
   *
   * Optimistic: the local copy updates first so the UI never lags a click behind. The
   * response deliberately carries no correctness — there is nothing to reveal yet.
   *
   * **A failed save is rolled back.** It used to leave the optimistic answer in place
   * with an error beside it, so "N answered" counted work the server did not have; the
   * Phase H regression run reproduced that on the mock-test runner, which shares this
   * shape, and got a paper reading "3 answered" that scored 0. The counter has to mean
   * what the server holds.
   */
  const saveAnswer = useCallback(
    async (target: PracticeQuestion, patch: Partial<PracticeQuestion['response']>) => {
      if (!sessionId || !session || isReviewed(session)) return

      const previousResponse = target.response
      const nextResponse = { ...target.response, ...patch }
      const answered =
        nextResponse.selectedOptionKeys.length > 0 ||
        nextResponse.numericResponse !== null ||
        nextResponse.booleanResponse !== null

      const applyResponse = (response: PracticeQuestion['response']) =>
        setSession((current) =>
          current && !isReviewed(current)
            ? ({
                ...current,
                questions: current.questions.map((entry) =>
                  entry.id === target.id ? { ...entry, response } : entry,
                ),
              } as PracticeSessionView)
            : current,
        )

      applyResponse({ ...nextResponse, answered })

      setSaving(true)
      setSaveError(null)
      try {
        await api.put(`/practice/sessions/${sessionId}/answers`, {
          questionId: target.id,
          selectedOptionKeys: nextResponse.selectedOptionKeys,
          numericResponse: nextResponse.numericResponse,
          booleanResponse: nextResponse.booleanResponse,
        })
      } catch (err) {
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
    [session, sessionId],
  )

  function chooseOption(target: PracticeQuestion, key: string) {
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

  async function submitSession() {
    if (!sessionId) return
    setSubmitting(true)
    setSaveError(null)
    try {
      const res = await api.post<SubmitResponse>(`/practice/sessions/${sessionId}/submit`, {})
      setSession(res.session)
      setXpAwarded(res.xpAwarded)
      setCurrent(0)
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not submit your session.')
    } finally {
      setSubmitting(false)
    }
  }

  // -------------------------------------------------------------------------
  // Loading / error
  // -------------------------------------------------------------------------

  if (loadError) {
    return (
      <StudentShell title="Practice">
        <ErrorState
          error={loadError}
          titleAs="h2"
          title="Could not load that session"
          onRetry={() => navigate('/practice')}
        />
      </StudentShell>
    )
  }

  if (!session || !question) {
    return (
      <StudentShell title="Practice">
        <Card>
          <SkeletonText lines={5} label="Loading your session" />
        </Card>
      </StudentShell>
    )
  }

  const scope =
    session.filters.topic?.name ?? `Mixed practice · ${session.filters.classLevel}`

  // -------------------------------------------------------------------------
  // Review
  // -------------------------------------------------------------------------

  if (reviewed && isReviewed(session)) {
    const percent = session.maxMarks > 0 ? Math.round((Math.max(0, session.score) / session.maxMarks) * 100) : 0

    return (
      <StudentShell title="Practice review" subtitle={scope}>
        {/* Performance summary — every figure computed by the server. */}
        <Card className={styles.summaryCard}>
          <p className={styles.summaryScore}>
            {session.score}
            <span>/{session.maxMarks}</span>
          </p>
          <Progress
            value={Math.max(0, session.score)}
            max={session.maxMarks}
            aria-label="Score"
            valueText={`${percent}%`}
            tone={percent >= 60 ? 'success' : percent >= 35 ? 'warning' : 'danger'}
          />
        </Card>

        <section className={styles.summaryRow}>
          <StatTile icon="ph-check-circle" tone="success" label="Correct" value={session.correctCount} />
          <StatTile icon="ph-x-circle" tone="danger" label="Incorrect" value={session.incorrectCount} />
          <StatTile icon="ph-minus-circle" tone="neutral" label="Unanswered" value={session.unansweredCount} />
          <StatTile
            icon="ph-target"
            label="Accuracy"
            value={`${session.accuracy}%`}
            hint="Of the questions you answered"
          />
          <StatTile
            icon="ph-clock"
            tone="neutral"
            label="Time taken"
            value={formatDuration(session.timeTakenSeconds)}
          />
        </section>

        {xpAwarded !== null && xpAwarded > 0 && (
          <Alert tone="success" icon="ph-star" className={styles.xpNote}>
            +{xpAwarded} XP earned for practising today.
          </Alert>
        )}
        {xpAwarded === 0 && session.correctCount + session.incorrectCount > 0 && (
          <Alert tone="info" className={styles.xpNote}>
            You have already earned today’s practice XP — extra sessions still count towards your history.
          </Alert>
        )}

        <div className={styles.reviewActions}>
          <ButtonLink to="/practice" icon="ph-arrow-clockwise">
            Practise again
          </ButtonLink>
          <ButtonLink to="/dashboard" variant="secondary" icon="ph-squares-four">
            Back to dashboard
          </ButtonLink>
        </div>

        {/* Per-question review with the correct answer and the explanation. */}
        <ol className={styles.reviewList}>
          {session.questions.map((entry) => (
            <ReviewQuestion key={entry.id} entry={entry} />
          ))}
        </ol>
      </StudentShell>
    )
  }

  // -------------------------------------------------------------------------
  // Working
  // -------------------------------------------------------------------------

  return (
    // `focus`: no bottom bar while a paper is open — it sits where the answer
    // buttons are. The menu stays reachable from the burger at every width.
    <StudentShell title="Practice" subtitle={scope} focus>
      <div className={styles.runnerHead}>
        <div className={styles.runnerProgress}>
          {/*
            A real count out of a real total — questions answered, not a fiction that
            eases towards the end of the paper.
          */}
          <Progress
            value={answeredCount}
            max={session.totalQuestions}
            size="sm"
            aria-label="Questions answered"
          />
          <span className={styles.progressText}>
            Question {current + 1} of {session.totalQuestions} · {answeredCount} answered
          </span>
        </div>
        <span className={styles.timer}>
          <Icon name="ph-clock" weight="bold" size="sm" />
          {formatDuration(elapsed)}
        </span>
      </div>

      <div className={styles.runner}>
        <div className="card">
          <div className={styles.qMeta}>
            {question.topic?.name && <Badge tone="neutral">{question.topic.name}</Badge>}
            <Badge tone="neutral" uppercase size="sm">
              {question.difficulty}
            </Badge>
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
                  className={`${styles.option} ${question.response.booleanResponse === value ? styles.optionChosen : ''}`}
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

          {/* --- Fill in the blank (Milestone 18) --- */}
          {question.type === 'fill_blank' && (
            <div className={styles.numericRow}>
              <label htmlFor="text-answer">Your answer</label>
              <input
                id="text-answer"
                className="form-control"
                type="text"
                maxLength={200}
                autoComplete="off"
                placeholder="Type your answer"
                value={question.response.textResponse ?? ''}
                onChange={(e) => {
                  const raw = e.target.value
                  void saveAnswer(question, { textResponse: raw === '' ? null : raw })
                }}
              />
            </div>
          )}

          {saveError && <Alert tone="danger">{saveError}</Alert>}

          <div className={styles.navRow}>
            <Button
              variant="secondary"
              icon="ph-arrow-left"
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              disabled={current === 0}
            >
              Previous
            </Button>
            <span className={styles.savingNote}>{saving ? 'Saving…' : 'Answers save automatically'}</span>
            {current < questions.length - 1 ? (
              <Button iconAfter="ph-arrow-right" onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}>
                Next
              </Button>
            ) : (
              <Button variant="danger" icon="ph-check" loading={submitting} onClick={() => void submitSession()}>
                {submitting ? 'Marking' : 'Submit for marking'}
              </Button>
            )}
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
            {answeredCount} of {session.totalQuestions} answered. Unanswered questions score zero and are never
            penalised.
          </p>
          <Button
            variant="danger"
            fullWidth
            icon="ph-check"
            loading={submitting}
            onClick={() => void submitSession()}
          >
            {submitting ? 'Marking' : 'Submit for marking'}
          </Button>
        </aside>
      </div>
    </StudentShell>
  )
}

/**
 * One reviewed question: what the student chose, what was correct, and why.
 *
 * Split out so the review list stays readable, and because every field it touches
 * exists only on the graded shape — a component that cannot be handed an in-progress
 * question cannot leak an answer from one.
 */
function ReviewQuestion({ entry }: { entry: PracticeReviewQuestion }) {
  const state = !entry.response.answered ? 'skipped' : entry.outcome.isCorrect ? 'correct' : 'incorrect'
  const label = state === 'skipped' ? 'Not answered' : state === 'correct' ? 'Correct' : 'Incorrect'

  /** How the correct answer reads for this question type. */
  function correctAnswerText(): string {
    if (entry.type === 'true_false') return entry.correctAnswer.booleanAnswer ? 'True' : 'False'
    if (entry.type === 'numeric') {
      const tolerance = entry.correctAnswer.tolerance
      const value = String(entry.correctAnswer.numericAnswer ?? '—')
      return tolerance && tolerance > 0 ? `${value} (± ${tolerance})` : value
    }
    // Every accepted spelling, so a student marked wrong can see what would have counted.
    if (entry.type === 'fill_blank') return (entry.correctAnswer.acceptedAnswers ?? []).join(' or ')
    return entry.correctAnswer.optionKeys.map((key) => key.toUpperCase()).join(', ')
  }

  function yourAnswerText(): string {
    if (!entry.response.answered) return '—'
    if (entry.type === 'true_false') return entry.response.booleanResponse ? 'True' : 'False'
    if (entry.type === 'numeric') return String(entry.response.numericResponse)
    if (entry.type === 'fill_blank') return entry.response.textResponse ?? '—'
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

      {/* Options, marked up with what was chosen and what was right. */}
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
