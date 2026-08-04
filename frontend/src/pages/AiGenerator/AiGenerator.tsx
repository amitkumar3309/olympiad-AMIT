import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/Button'
import { api, ApiError } from '../../api/client'
import styles from './AiGenerator.module.css'

interface GeneratedQuestion {
  questionText: string
  options: string[]
  correctAnswer: string
  classLevel: string
  subject: string
  difficulty: string
}

export default function AiGenerator() {
  const [classLevel, setClassLevel] = useState('Class 8')
  const [subject, setSubject] = useState('Mathematics')
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState('Medium')
  const [count, setCount] = useState(5)
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!topic.trim()) {
      setError('Please enter a topic.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ data: GeneratedQuestion[] }>('/admin/generate-questions', {
        classLevel,
        subject,
        topic: topic.trim(),
        difficulty,
        count,
      })
      setQuestions(res.data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate questions.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className="container">
        <Link to="/admin" className={styles.back}>
          ← Back to Admin
        </Link>
        <h1>AI Question Generator</h1>
        <p>Generate a fresh batch of Olympiad questions for any class, subject, and difficulty.</p>

        <form className={`card ${styles.form}`} onSubmit={handleSubmit}>
          {error && <p className="error-text">{error}</p>}
          <div className={styles.grid}>
            <div className="form-group">
              <label>Class Level</label>
              <select className="form-control" value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
                {['Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Subject</label>
              <input className="form-control" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Topic</label>
              <input
                className="form-control"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Quadratic Equations"
              />
            </div>
            <div className="form-group">
              <label>Difficulty</label>
              <select className="form-control" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option>Easy</option>
                <option>Medium</option>
                <option>Hard</option>
              </select>
            </div>
            <div className="form-group">
              <label>Number of Questions</label>
              <input
                type="number"
                min={1}
                max={20}
                className="form-control"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? 'Generating...' : '✨ Generate Questions'}
          </Button>
        </form>

        {questions.length > 0 && (
          <div className={styles.results}>
            {questions.map((q, i) => (
              <div className="card" key={i}>
                <p className={styles.qText}>
                  {i + 1}. {q.questionText}
                </p>
                <ul className={styles.options}>
                  {q.options.map((opt) => (
                    <li key={opt} className={opt === q.correctAnswer ? styles.correct : ''}>
                      {opt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
