import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import styles from './Exam.module.css'

interface Question {
  q: string
  options: string[]
  correct: string
}

const QUESTIONS: Question[] = [
  { q: 'What is the value of √144?', options: ['10', '11', '12', '13'], correct: '12' },
  { q: 'Solve: 3x + 7 = 22. Find x.', options: ['3', '4', '5', '6'], correct: '5' },
  { q: 'What is the next number: 2, 6, 12, 20, ?', options: ['28', '30', '32', '26'], correct: '30' },
  { q: 'The area of a circle with radius 7 is closest to?', options: ['154', '144', '132', '160'], correct: '154' },
  { q: 'If sin(θ) = 0.5, θ could be?', options: ['30°', '45°', '60°', '90°'], correct: '30°' },
]

const EXAM_SECONDS = 10 * 60

export default function Exam() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const [showWarning, setShowWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(EXAM_SECONDS)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setShowWarning(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    const preventContextMenu = (e: MouseEvent) => e.preventDefault()
    const preventCopy = (e: ClipboardEvent) => e.preventDefault()
    document.addEventListener('contextmenu', preventContextMenu)
    document.addEventListener('copy', preventCopy)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('contextmenu', preventContextMenu)
      document.removeEventListener('copy', preventCopy)
    }
  }, [])

  useEffect(() => {
    if (submitted) return
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer)
          setSubmitted(true)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [submitted])

  const question = QUESTIONS[current]
  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const secs = String(secondsLeft % 60).padStart(2, '0')

  function selectOption(opt: string) {
    setAnswers((a) => ({ ...a, [current]: opt }))
  }

  function toggleMark() {
    setMarked((m) => {
      const next = new Set(m)
      if (next.has(current)) next.delete(current)
      else next.add(current)
      return next
    })
  }

  function saveAndNext() {
    if (current < QUESTIONS.length - 1) setCurrent((c) => c + 1)
  }

  function submitExam() {
    setSubmitted(true)
  }

  if (submitted) {
    const score = QUESTIONS.reduce((acc, q, i) => (answers[i] === q.correct ? acc + 1 : acc), 0)
    return (
      <div className={styles.wrap}>
        <div className={`card ${styles.summary}`}>
          <h1>Exam Submitted ✅</h1>
          <p className={styles.score}>
            You scored <strong>{score}</strong> / {QUESTIONS.length}
          </p>
          <Button onClick={() => navigate('/result')}>View Full Result ➔</Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {showWarning && (
        <div className={styles.warningOverlay}>
          <h2>⚠️ Tab Switch Detected</h2>
          <p>Leaving the exam tab is recorded. Please stay on this page until you submit.</p>
          <Button onClick={() => setShowWarning(false)}>Return to Exam</Button>
        </div>
      )}

      <header className={styles.header}>
        <h2>Live Exam</h2>
        <div className={styles.timer}>{mins}:{secs}</div>
      </header>

      <div className={styles.body}>
        <div className={styles.questionPanel}>
          <p className={styles.qCounter}>
            Question {current + 1} of {QUESTIONS.length}
          </p>
          <h3>{question.q}</h3>
          <div className={styles.options}>
            {question.options.map((opt) => (
              <label
                key={opt}
                className={`${styles.optionLabel} ${answers[current] === opt ? styles.optionSelected : ''}`}
                onClick={() => selectOption(opt)}
              >
                <input type="radio" checked={answers[current] === opt} readOnly /> {opt}
              </label>
            ))}
          </div>
          <div className={styles.actionsRow}>
            <Button variant="outline" onClick={toggleMark}>
              {marked.has(current) ? 'Unmark' : 'Mark for Review'}
            </Button>
            {current < QUESTIONS.length - 1 ? (
              <Button onClick={saveAndNext}>Save &amp; Next ➡</Button>
            ) : (
              <Button variant="danger" onClick={submitExam}>
                Final Submit Exam
              </Button>
            )}
          </div>
        </div>

        <aside className={styles.palette}>
          <h4>Question Palette</h4>
          <div className={styles.paletteGrid}>
            {QUESTIONS.map((_, i) => {
              const state = i === current ? 'current' : marked.has(i) ? 'marked' : answers[i] ? 'answered' : 'unvisited'
              return (
                <button key={i} className={`${styles.paletteBtn} ${styles[state]}`} onClick={() => setCurrent(i)}>
                  {i + 1}
                </button>
              )
            })}
          </div>
          <Button variant="danger" fullWidth onClick={submitExam}>
            Final Submit Exam
          </Button>
        </aside>
      </div>
    </div>
  )
}
