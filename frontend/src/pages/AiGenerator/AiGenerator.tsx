import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import { api, ApiError } from '../../api/client'
import { CLASS_LEVELS, DIFFICULTIES, type ClassLevel, type Difficulty, type Subject, type Topic } from '../../api/types'
import MathText from '../../components/MathText'
import styles from './AiGenerator.module.css'

/**
 * The template draft generator.
 *
 * It is **not** AI — it fills a template string, and no AI provider is integrated
 * anywhere in this project. The name is inherited; the page now says so plainly
 * rather than implying otherwise.
 *
 * Since Milestone 4 it has to name a real subject and topic, and everything it
 * produces is a **draft** in the question bank, so placeholder text can never reach
 * a student. Its only real use is skipping the repetitive part of creating several
 * questions in the same topic; each one still has to be written and published by
 * hand.
 */
interface CreatedDraft {
  id: string
  questionText: string
  status: string
}

export default function AiGenerator() {
  const navigate = useNavigate()

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [subject, setSubject] = useState('')
  const [topic, setTopic] = useState('')
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 8')
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium')
  const [count, setCount] = useState(5)

  const [drafts, setDrafts] = useState<CreatedDraft[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<{ subjects: Subject[] }>('/subjects?status=active')
      .then((res) => setSubjects(res.subjects))
      .catch(() => setSubjects([]))
  }, [])

  useEffect(() => {
    if (!subject) {
      setTopics([])
      return
    }
    api
      .get<{ topics: Topic[] }>(`/topics?subject=${subject}&parent=root&status=active`)
      .then((res) => setTopics(res.topics))
      .catch(() => setTopics([]))
  }, [subject])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!subject || !topic) {
      setError('Choose a subject and a topic.')
      return
    }
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const res = await api.post<{ message: string; questions: CreatedDraft[] }>('/admin/generate-questions', {
        subject,
        topic,
        classLevel,
        difficulty,
        count,
      })
      setDrafts(res.questions)
      setMessage(res.message)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the template drafts.')
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
        <h1>Template Draft Generator</h1>
        <p>
          Creates a batch of blank <strong>draft</strong> questions in one subject and topic, so you do not have to repeat the
          classification for each. This is a template filler, <strong>not</strong> AI — no question content is generated for
          you, and nothing here is visible to students until you edit and publish it in the{' '}
          <Link to="/admin/questions">question bank</Link>.
        </p>

        <form className={`card ${styles.form}`} onSubmit={handleSubmit}>
          {error && <p className="error-text">{error}</p>}
          <div className={styles.grid}>
            <div className="form-group">
              <label htmlFor="gen-subject">Subject</label>
              <select
                id="gen-subject"
                className="form-control"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value)
                  setTopic('')
                }}
              >
                <option value="">Select a subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {subjects.length === 0 && (
                <p className={styles.hint}>
                  No subjects yet — <Link to="/admin/taxonomy">create one</Link> first.
                </p>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="gen-topic">Topic</label>
              <select id="gen-topic" className="form-control" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={!subject}>
                <option value="">{subject ? 'Select a topic' : 'Choose a subject first'}</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="gen-class">Class</label>
              <select id="gen-class" className="form-control" value={classLevel} onChange={(e) => setClassLevel(e.target.value as ClassLevel)}>
                {CLASS_LEVELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="gen-difficulty">Difficulty</label>
              <select id="gen-difficulty" className="form-control" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="gen-count">Number of drafts</label>
              <input
                id="gen-count"
                type="number"
                min={1}
                max={20}
                className="form-control"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
          </div>
          <Button type="submit" disabled={loading || !subject || !topic}>
            {loading ? 'Creating drafts…' : 'Create template drafts'}
          </Button>
        </form>

        {message && <p className={styles.notice}>{message}</p>}

        {drafts.length > 0 && (
          <div className={styles.results}>
            {drafts.map((draft, i) => (
              <div className="card" key={draft.id}>
                <p className={styles.qText}>
                  {i + 1}. <MathText>{draft.questionText}</MathText>
                </p>
                <p className={styles.draftMeta}>
                  Status: {draft.status} ·{' '}
                  <button type="button" className={styles.editLink} onClick={() => navigate(`/admin/questions/${draft.id}/edit`)}>
                    Edit this draft
                  </button>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
