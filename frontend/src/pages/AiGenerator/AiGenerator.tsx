import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import { api, ApiError } from '../../api/client'
import {
  CLASS_LEVELS,
  DIFFICULTIES,
  type ClassLevel,
  type Difficulty,
  type GenerateQuestionsResponse,
  type QuestionGeneratorStatus,
  type Subject,
  type Topic,
} from '../../api/types'
import MathText from '../../components/MathText'
import styles from './AiGenerator.module.css'

/**
 * The question generator (Milestone 17).
 *
 * Until Milestone 17 this page filled a template string, and it said so, because
 * calling that AI would have been a lie. It can now be backed by a real language model,
 * and the page's job is to be **exact about which one ran** rather than to imply the
 * better of the two.
 *
 * Three things it is careful about:
 *
 * - **It says up front whether AI is configured**, from `GET /admin/question-generator`,
 *   so "is this on?" is not a question you answer by pressing the button and guessing
 *   from the output.
 * - **It shows what was thrown away.** A model that writes eight usable questions out of
 *   ten is working normally; a page that quietly shows eight would read as broken. Each
 *   rejection comes with the rule it broke.
 * - **It never implies a draft is ready.** Everything generated is a draft, whoever
 *   wrote it, and the wording keeps saying so — a machine-written question is a first
 *   draft for a human examiner, not a question.
 */
export default function AiGenerator() {
  const navigate = useNavigate()

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [subject, setSubject] = useState('')
  const [topic, setTopic] = useState('')
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 8')
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium')
  const [count, setCount] = useState(5)
  const [instructions, setInstructions] = useState('')

  const [status, setStatus] = useState<QuestionGeneratorStatus | null>(null)
  const [result, setResult] = useState<GenerateQuestionsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<{ subjects: Subject[] }>('/subjects?status=active')
      .then((res) => setSubjects(res.subjects))
      .catch(() => setSubjects([]))

    api
      .get<QuestionGeneratorStatus>('/admin/question-generator')
      .then(setStatus)
      // A failure here costs the banner, not the page — the form still works.
      .catch(() => setStatus(null))
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

  const usingModel = status?.generator.kind === 'model'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!subject || !topic) {
      setError('Choose a subject and a topic.')
      return
    }
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const res = await api.post<GenerateQuestionsResponse>('/admin/generate-questions', {
        subject,
        topic,
        classLevel,
        difficulty,
        count,
        instructions: instructions.trim() || null,
      })
      setResult(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the drafts.')
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
        <h1>Question Generator</h1>

        {/* What will happen when the button is pressed, stated before it is pressed. */}
        {status && (
          <div className={`card ${styles.status}`} data-kind={status.generator.kind}>
            <span className={styles.statusBadge}>
              <i className={`ph-bold ${usingModel ? 'ph-sparkle' : 'ph-rows'}`} /> {status.generator.label}
            </span>
            <p>{status.generator.basis}</p>
            {!usingModel && (
              <p className={styles.hint}>
                AI drafting is off. To turn it on, set <code>GEMINI_API_KEY</code> in the backend environment and redeploy —
                see <code>ENVIRONMENT_VARIABLES.md</code>. Nothing else changes, and no student data is ever sent.
              </p>
            )}
          </div>
        )}

        <p>
          Creates <strong>draft</strong> questions in one subject and topic. Whatever writes them, nothing here is visible to
          students until you review and publish it in the <Link to="/admin/questions">question bank</Link>
          {usingModel && ' — a generated question is a first draft, and the answer key needs checking'}.
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

          {/* Only useful to a model, so it is only offered when one is configured. */}
          {usingModel && (
            <div className="form-group">
              <label htmlFor="gen-instructions">Extra instructions (optional)</label>
              <textarea
                id="gen-instructions"
                className="form-control"
                rows={2}
                maxLength={500}
                placeholder="e.g. Prefer word problems. Avoid calculus notation."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <p className={styles.hint}>{500 - instructions.length} characters left.</p>
            </div>
          )}

          <Button type="submit" disabled={loading || !subject || !topic}>
            {loading ? (usingModel ? 'Writing drafts…' : 'Creating drafts…') : `Create ${count} draft${count === 1 ? '' : 's'}`}
          </Button>
        </form>

        {result && (
          <>
            <p className={styles.notice}>{result.message}</p>

            {/*
              Rejections are shown, not swallowed. A model that writes eight usable
              questions out of ten is behaving normally; a page that quietly showed
              eight would look broken and invite a second press of the button.
            */}
            {result.rejected.length > 0 && (
              <div className={`card ${styles.rejected}`}>
                <h3>
                  {result.rejected.length} discarded — {result.generator.label} produced {result.requested}, and these did not
                  meet the question rules
                </h3>
                <ul>
                  {result.rejected.map((entry) => (
                    <li key={entry.index}>
                      <strong>#{entry.index}</strong> {entry.reason}
                    </li>
                  ))}
                </ul>
                <p className={styles.hint}>
                  Nothing was corrected automatically — a repaired answer key that looks right is worse than a missing
                  question. Generate again, or write these by hand.
                </p>
              </div>
            )}

            {result.questions.length > 0 && (
              <div className={styles.results}>
                {result.questions.map((draft, i) => (
                  <div className="card" key={draft.id}>
                    <p className={styles.qText}>
                      {i + 1}. <MathText>{draft.questionText}</MathText>
                    </p>
                    <p className={styles.draftMeta}>
                      {draft.type.replace('_', ' ')} · Status: {draft.status} ·{' '}
                      <button type="button" className={styles.editLink} onClick={() => navigate(`/admin/questions/${draft.id}/edit`)}>
                        Review and edit
                      </button>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
