import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import MathText from '../../components/MathText'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import type { StudentQuestion } from '../../api/types'
import styles from './Exam.module.css'

/**
 * Practice paper.
 *
 * **This page used to be five hardcoded questions with their answers in the client
 * bundle.** Beyond being placeholder content ("What is the value of √144?"), each
 * question carried a `correct` field, so the answer key for the whole paper shipped to
 * every browser and could be read out of the JavaScript — a smaller version of the very
 * hole Milestone 4 closed on the questions API.
 *
 * It now loads **real published questions** for the signed-in student's own class from
 * `GET /questions`, which is answer-stripped by construction: `isCorrect`, `solution`
 * and the numeric/boolean answers are never sent. Consequently this page cannot mark
 * anything, and does not pretend to — there is no score screen, because a score would
 * have to be invented. Answers are held locally so a student can work through the paper
 * and review their choices.
 *
 * Real submission and marking need `ExamAttempt` writes and server-side scoring, which
 * is the next milestone. The page states that plainly rather than showing a fake result.
 */

const PRACTICE_MINUTES = 10
const QUESTION_LIMIT = 20

interface QuestionsResponse {
  questions: StudentQuestion[]
}

export default function Exam() {
  const navigate = useNavigate()
  const { state } = useAuth()
  const classLevel = state.status === 'student' ? state.student.classLevel : null

  const [questions, setQuestions] = useState<StudentQuestion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const [showWarning, setShowWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(PRACTICE_MINUTES * 60)
  const [finished, setFinished] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      // `/questions` serves published questions only — that part is enforced server
      // side and is not a parameter. The class *is* a caller-supplied filter, so it is
      // passed from the signed-in account here to get an age-appropriate paper. It is
      // not a security boundary and is not pretending to be one: by design, any
      // authenticated student may read any published question (see the Milestone 4
      // notes in API_DOCUMENTATION.md). Omitting it would simply mix all years
      // together.
      const params = new URLSearchParams({ limit: String(QUESTION_LIMIT) })
      if (classLevel) params.set('classLevel', classLevel)
      const res = await api.get<QuestionsResponse>(`/questions?${params.toString()}`)
      setQuestions(res.questions)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load the practice paper.')
    }
  }, [classLevel])

  useEffect(() => {
    void load()
  }, [load])

  // Kept from the original: leaving the tab is surfaced, and copying is discouraged.
  // Neither is enforcement — a real invigilated exam needs server-side attempt
  // tracking — but they are honest nudges rather than fabricated data.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setShowWarning(true)
    }
    const preventContextMenu = (e: MouseEvent) => e.preventDefault()
    const preventCopy = (e: ClipboardEvent) => e.preventDefault()
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('contextmenu', preventContextMenu)
    document.addEventListener('copy', preventCopy)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('contextmenu', preventContextMenu)
      document.removeEventListener('copy', preventCopy)
    }
  }, [])

  useEffect(() => {
    if (finished || !questions || questions.length === 0) return
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer)
          setFinished(true)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [finished, questions])

  if (loadError) {
    return (
      <div className={styles.wrap}>
        <div className={`card ${styles.summary}`}>
          <h1>Could not load the paper</h1>
          <p className="error-text">{loadError}</p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      </div>
    )
  }

  if (!questions) {
    return (
      <div className={styles.wrap}>
        <div className={`card ${styles.summary}`}>
          <Spinner label="Loading your practice paper..." />
        </div>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={`card ${styles.summary}`}>
          <h1>No questions published yet</h1>
          <p>
            There are no published questions for your class yet, so there is no paper to attempt. This page will fill in
            as soon as the question bank has content for you.
          </p>
          <Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>
        </div>
      </div>
    )
  }

  const question = questions[current]!
  const answeredCount = Object.keys(answers).length
  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const secs = String(secondsLeft % 60).padStart(2, '0')

  function selectOption(optionKey: string) {
    setAnswers((a) => ({ ...a, [question.id]: optionKey }))
  }

  function toggleMark() {
    setMarked((m) => {
      const next = new Set(m)
      if (next.has(current)) next.delete(current)
      else next.add(current)
      return next
    })
  }

  if (finished) {
    return (
      <div className={styles.wrap}>
        <div className={`card ${styles.summary}`}>
          <h1>Practice complete</h1>
          <p>
            You answered <strong>{answeredCount}</strong> of <strong>{questions.length}</strong> questions.
          </p>
          {/* Deliberately no score. Marking happens on the server against an answer
              key the browser is never given, and that does not exist yet — so a score
              here could only be made up. */}
          <p className={styles.pendingNote}>
            This was a practice run, so it has not been marked or recorded. Scored exams, with marks and XP, arrive with
            the exam milestone.
          </p>
          <div className={styles.summaryActions}>
            <Button
              variant="outline"
              onClick={() => {
                setFinished(false)
                setCurrent(0)
                setAnswers({})
                setMarked(new Set())
                setSecondsLeft(PRACTICE_MINUTES * 60)
              }}
            >
              Start again
            </Button>
            <Link to="/dashboard">
              <Button>Back to dashboard</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {showWarning && (
        <div className={styles.warningOverlay}>
          <h2>⚠️ Tab Switch Detected</h2>
          <p>Leaving the page is worth avoiding in a real exam. This is a practice run, so nothing was recorded.</p>
          <Button onClick={() => setShowWarning(false)}>Return to paper</Button>
        </div>
      )}

      <header className={styles.header}>
        <h2>Practice Paper</h2>
        <div className={styles.timer}>
          {mins}:{secs}
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.questionPanel}>
          <p className={styles.qCounter}>
            Question {current + 1} of {questions.length}
            {question.subject?.name ? ` · ${question.subject.name}` : ''}
            {question.marks ? ` · ${question.marks} ${question.marks === 1 ? 'mark' : 'marks'}` : ''}
          </p>
          {/* Real author content, so it must render through MathText — never raw. */}
          <h3 className={styles.questionText}>
            <MathText>{question.questionText}</MathText>
          </h3>
          <div className={styles.options}>
            {question.options.map((option) => (
              <label
                key={option.key}
                className={`${styles.optionLabel} ${answers[question.id] === option.key ? styles.optionSelected : ''}`}
                onClick={() => selectOption(option.key)}
              >
                <input type="radio" checked={answers[question.id] === option.key} readOnly />
                <span className={styles.optionKey}>{option.key.toUpperCase()}</span>
                <MathText>{option.text}</MathText>
              </label>
            ))}
          </div>
          <div className={styles.actionsRow}>
            <Button variant="outline" onClick={toggleMark}>
              {marked.has(current) ? 'Unmark' : 'Mark for Review'}
            </Button>
            {current < questions.length - 1 ? (
              <Button onClick={() => setCurrent((c) => c + 1)}>Save &amp; Next ➡</Button>
            ) : (
              <Button variant="danger" onClick={() => setFinished(true)}>
                Finish practice
              </Button>
            )}
          </div>
        </div>

        <aside className={styles.palette}>
          <h4>Question Palette</h4>
          <div className={styles.paletteGrid}>
            {questions.map((q, i) => {
              const state =
                i === current ? 'current' : marked.has(i) ? 'marked' : answers[q.id] ? 'answered' : 'unvisited'
              return (
                <button key={q.id} className={`${styles.paletteBtn} ${styles[state]}`} onClick={() => setCurrent(i)}>
                  {i + 1}
                </button>
              )
            })}
          </div>
          <Button variant="danger" fullWidth onClick={() => setFinished(true)}>
            Finish practice
          </Button>
        </aside>
      </div>
    </div>
  )
}
