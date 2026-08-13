import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { ExamAttemptInProgress, ExamPaperQuestion } from '../../api/types'
import MathText from '../../components/MathText'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import styles from './ExamAttempt.module.css'

/**
 * Sitting the official exam.
 *
 * The countdown here is a **display** of the server's `secondsRemaining`, never a
 * source of truth. It is re-synchronised from every save, and when it reaches zero the
 * page asks the server to close the paper rather than deciding by itself — the backend
 * refuses answers past the deadline regardless of what this component believes.
 */
export default function ExamAttempt() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const navigate = useNavigate()

  const [attempt, setAttempt] = useState<ExamAttemptInProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const submittingRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ attempt: ExamAttemptInProgress; resultsPending?: boolean }>(
        `/exams/attempts/${attemptId}`,
      )
      if (res.attempt.status === 'submitted') {
        setSubmitted(true)
        return
      }
      setAttempt(res.attempt)
      setSeconds(res.attempt.secondsRemaining)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your paper.')
    } finally {
      setLoading(false)
    }
  }, [attemptId])

  useEffect(() => {
    void load()
  }, [load])

  const submit = useCallback(async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      await api.post(`/exams/attempts/${attemptId}/submit`, {})
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your paper.')
    } finally {
      submittingRef.current = false
    }
  }, [attemptId])

  // The tick is cosmetic. When it hits zero the server is asked to close the paper;
  // the server had already stopped accepting answers at that moment regardless.
  useEffect(() => {
    if (submitted || !attempt) return
    if (seconds <= 0) {
      void submit()
      return
    }
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds, submitted, attempt, submit])

  async function saveAnswer(entry: ExamPaperQuestion, payload: Record<string, unknown>) {
    if (!entry.question) return
    setSaving(true)
    setError('')
    try {
      const res = await api.patch<{ secondsRemaining: number; answer: ExamPaperQuestion }>(
        `/exams/attempts/${attemptId}/questions/${entry.question.id}`,
        payload,
      )
      // Re-synchronise the clock from the server on every save.
      setSeconds(res.secondsRemaining)
      setAttempt((prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map((q) =>
                q.question?.id === entry.question?.id ? { ...q, ...res.answer } : q,
              ),
            }
          : prev,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That answer was not saved.')
      // A refusal usually means the deadline passed, so re-read the real state.
      void load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner label="Loading your paper..." />

  if (submitted) {
    return (
      <div className={styles.wrap}>
        <div className={`card ${styles.doneCard}`}>
          <h2>Your paper has been submitted</h2>
          <p>
            Results are released by the organisers once everybody has sat the exam. You will see your score, your rank
            and your certificate here as soon as they are published.
          </p>
          <Button onClick={() => navigate('/exam')}>Back to the exam page</Button>
        </div>
      </div>
    )
  }

  if (!attempt) {
    return (
      <div className={styles.wrap}>
        <p className="error-text">{error || 'That paper could not be loaded.'}</p>
      </div>
    )
  }

  const entry = attempt.questions[current]!
  const answeredCount = attempt.questions.filter((q) => q.answered).length
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  const lowTime = seconds <= 300

  return (
    <div className={styles.wrap}>
      <header className={styles.bar}>
        <div>
          <strong>Official Olympiad</strong>
          <span className={styles.progress}>
            {answeredCount} of {attempt.totalQuestions} answered
          </span>
        </div>
        <div className={`${styles.clock} ${lowTime ? styles.clockLow : ''}`}>
          {String(minutes).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </div>
      </header>

      {error && <p className="error-text">{error}</p>}

      <div className={styles.palette}>
        {attempt.questions.map((q, index) => (
          <button
            key={q.position}
            className={`${styles.paletteItem} ${index === current ? styles.paletteCurrent : ''} ${
              q.answered ? styles.paletteAnswered : ''
            }`}
            onClick={() => setCurrent(index)}
            aria-label={`Question ${q.position}${q.answered ? ', answered' : ''}`}
          >
            {q.position}
          </button>
        ))}
      </div>

      <div className={`card ${styles.questionCard}`}>
        <div className={styles.questionHead}>
          <span>
            Question {entry.position} of {attempt.totalQuestions}
          </span>
          <span className={styles.marks}>
            +{entry.marks}
            {entry.negativeMarks > 0 ? ` / −${entry.negativeMarks}` : ''}
          </span>
        </div>

        {entry.question ? (
          <>
            <MathText block className={styles.questionText}>{entry.question.questionText}</MathText>

            {(entry.question.type === 'single_choice' || entry.question.type === 'multiple_choice') && (
              <ul className={styles.options}>
                {entry.question.options.map((option) => {
                  const selected = entry.selectedOptionKeys.includes(option.key)
                  return (
                    <li key={option.key}>
                      <button
                        className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
                        disabled={saving}
                        onClick={() => {
                          const keys =
                            entry.question!.type === 'single_choice'
                              ? [option.key]
                              : selected
                                ? entry.selectedOptionKeys.filter((k) => k !== option.key)
                                : [...entry.selectedOptionKeys, option.key]
                          void saveAnswer(entry, { selectedOptionKeys: keys })
                        }}
                      >
                        <span className={styles.optionKey}>{option.key}</span>
                        <MathText>{option.text}</MathText>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {entry.question.type === 'true_false' && (
              <div className={styles.trueFalse}>
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    className={`${styles.option} ${entry.booleanResponse === value ? styles.optionSelected : ''}`}
                    disabled={saving}
                    onClick={() => void saveAnswer(entry, { booleanResponse: value })}
                  >
                    {value ? 'True' : 'False'}
                  </button>
                ))}
              </div>
            )}

            {entry.question.type === 'numeric' && (
              <input
                className="form-control"
                type="number"
                step="any"
                defaultValue={entry.numericResponse ?? ''}
                disabled={saving}
                onBlur={(e) =>
                  void saveAnswer(entry, {
                    numericResponse: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                aria-label="Your numeric answer"
              />
            )}
          </>
        ) : (
          <p className="error-text">This question could not be loaded. Tell your invigilator.</p>
        )}
      </div>

      <div className={styles.nav}>
        <button disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>
          Previous
        </button>
        <button disabled={current >= attempt.questions.length - 1} onClick={() => setCurrent((c) => c + 1)}>
          Next
        </button>
        <Button
          onClick={() => {
            if (window.confirm('Submit your paper? You cannot return to it, and there is only one attempt.')) {
              void submit()
            }
          }}
        >
          Submit paper
        </Button>
      </div>
    </div>
  )
}
