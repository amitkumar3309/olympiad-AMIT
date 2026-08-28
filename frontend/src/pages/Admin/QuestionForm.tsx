import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import {
  CLASS_LEVELS,
  DIFFICULTIES,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type AdminQuestion,
  type ClassLevel,
  type Difficulty,
  type QuestionInput,
  type QuestionType,
  type ChapterDetection,
  type Topic,
} from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import MathText from '../../components/MathText'
import styles from './QuestionForm.module.css'

/** A blank option row. Keys are assigned by the server, so none is held here. */
interface OptionDraft {
  text: string
  isCorrect: boolean
}

interface FormState {
  questionText: string
  type: QuestionType
  options: OptionDraft[]
  booleanAnswer: boolean
  numericAnswer: string
  tolerance: string
  solution: string
  topic: string
  subtopic: string
  classLevel: ClassLevel
  difficulty: Difficulty
  marks: string
  negativeMarks: string
  tags: string
}

const EMPTY_STATE: FormState = {
  questionText: '',
  type: 'single_choice',
  options: [
    { text: '', isCorrect: true },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
  ],
  booleanAnswer: true,
  numericAnswer: '',
  tolerance: '',
  solution: '',
  topic: '',
  subtopic: '',
  classLevel: 'Class 9',
  difficulty: 'Medium',
  marks: '4',
  negativeMarks: '1',
  tags: '',
}

function Required() {
  return (
    <span className={styles.required} aria-hidden="true">
      *
    </span>
  )
}

const usesOptions = (type: QuestionType) => type === 'single_choice' || type === 'multiple_choice'

export default function QuestionForm() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState>(EMPTY_STATE)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [topics, setTopics] = useState<Topic[]>([])
  const [subtopics, setSubtopics] = useState<Topic[]>([])

  /**
   * The chapter suggestion, for an author who has typed a question and not chosen one.
   *
   * A **suggestion**, never an automatic set. The same deterministic detector the importer uses on a
   * file with no Topic column, from the same pure function, so the editor and the importer cannot
   * disagree about what a question looks like — and no model is called (see
   * `backend/src/lib/chapterDetection.ts` for why).
   */
  const [detected, setDetected] = useState<ChapterDetection | null>(null)
  const [detecting, setDetecting] = useState(false)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((c) => ({ ...c, [key]: value }))

  /**
   * Asks which chapter this question looks like it belongs to.
   *
   * Explicit rather than fired on every keystroke: a suggestion that changes under the author's
   * hands while they type is noise, and this is a request per press rather than per character.
   */
  async function detectTopic() {
    setDetecting(true)
    setDetected(null)
    try {
      setDetected(
        await api.get<ChapterDetection>(
          `/admin/questions/detect-chapter?text=${encodeURIComponent(form.questionText)}`,
        ),
      )
    } catch {
      // A failed suggestion is not worth an error banner: the author can still pick a chapter.
      setDetected({ outcome: 'none', match: null, between: [] })
    } finally {
      setDetecting(false)
    }
  }

  /**
   * Every chapter, loaded once.
   *
   * There is **no subject picker** (Milestone 21, Phase J): AMIT is a mathematics olympiad, so the
   * subject is implicit and the chapter already records it. The API derives it — `subject` is
   * optional on `createQuestionSchema` and `resolveTaxonomy()` reads it off the chosen chapter — so
   * the old subject → topic cascade is gone with the dropdown that drove it.
   */
  useEffect(() => {
    api
      .get<{ topics: Topic[] }>('/topics?parent=root&status=active')
      .then((res) => setTopics(res.topics))
      .catch(() => setTopics([]))
  }, [])

  useEffect(() => {
    if (!form.topic) {
      setSubtopics([])
      return
    }
    api
      .get<{ topics: Topic[] }>(`/topics?parent=${form.topic}&status=active`)
      .then((res) => setSubtopics(res.topics))
      .catch(() => setSubtopics([]))
  }, [form.topic])

  // --- Load the question being edited ---------------------------------------
  const loadQuestion = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError('')
    try {
      const res = await api.get<{ question: AdminQuestion }>(`/admin/questions/${id}`)
      const q = res.question
      setForm({
        questionText: q.questionText,
        type: q.type,
        options: q.options.length > 0 ? q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })) : EMPTY_STATE.options,
        booleanAnswer: q.booleanAnswer ?? true,
        numericAnswer: q.numericAnswer === null ? '' : String(q.numericAnswer),
        tolerance: q.tolerance === null ? '' : String(q.tolerance),
        solution: q.solution ?? '',
        topic: q.topic?.id ?? '',
        subtopic: q.subtopic?.id ?? '',
        classLevel: q.classLevel,
        difficulty: q.difficulty,
        marks: String(q.marks),
        negativeMarks: String(q.negativeMarks),
        tags: q.tags.join(', '),
      })
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load that question.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadQuestion()
  }, [loadQuestion])

  // --- Submit ---------------------------------------------------------------
  function buildPayload(): QuestionInput {
    const trimmedOptions = form.options.map((o) => ({ text: o.text.trim(), isCorrect: o.isCorrect })).filter((o) => o.text.length > 0)

    return {
      questionText: form.questionText.trim(),
      type: form.type,
      options: usesOptions(form.type) ? trimmedOptions : [],
      booleanAnswer: form.type === 'true_false' ? form.booleanAnswer : null,
      numericAnswer: form.type === 'numeric' && form.numericAnswer !== '' ? Number(form.numericAnswer) : null,
      tolerance: form.type === 'numeric' && form.tolerance !== '' ? Number(form.tolerance) : null,
      solution: form.solution.trim() === '' ? null : form.solution.trim(),
      topic: form.topic,
      subtopic: form.subtopic === '' ? null : form.subtopic,
      classLevel: form.classLevel,
      difficulty: form.difficulty,
      marks: Number(form.marks),
      negativeMarks: form.negativeMarks === '' ? 0 : Number(form.negativeMarks),
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    // Only the checks the server cannot phrase better are done here; everything
    // else is left to the API so there is one authority on validity and the
    // messages the author sees are the real ones.
    if (!form.topic) {
      setError('Choose a chapter.')
      return
    }

    setSaving(true)
    try {
      const payload = buildPayload()
      if (isEdit) {
        await api.put<{ question: AdminQuestion }>(`/admin/questions/${id}`, payload)
      } else {
        await api.post<{ question: AdminQuestion }>('/admin/questions', payload)
      }
      navigate('/admin/questions')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that question.')
    } finally {
      setSaving(false)
    }
  }

  function setOption(index: number, patch: Partial<OptionDraft>) {
    setForm((c) => ({
      ...c,
      options: c.options.map((option, i) => (i === index ? { ...option, ...patch } : option)),
    }))
  }

  /** Single choice means exactly one correct option, so selecting clears the rest. */
  function selectSingleCorrect(index: number) {
    setForm((c) => ({ ...c, options: c.options.map((option, i) => ({ ...option, isCorrect: i === index })) }))
  }

  const correctCount = useMemo(() => form.options.filter((o) => o.isCorrect && o.text.trim()).length, [form.options])

  if (loading) {
    return (
      <AdminShell title={isEdit ? 'Edit question' : 'New question'}>
        <div className={styles.centered}>
          <Spinner />
          <p>Loading question…</p>
        </div>
      </AdminShell>
    )
  }

  if (loadError) {
    return (
      <AdminShell title="Edit question">
        <div className={styles.centered}>
          <p className="error-text">{loadError}</p>
          <div className={styles.centeredActions}>
            <Button variant="outline" onClick={() => void loadQuestion()}>
              Try again
            </Button>
            <Link to="/admin/questions">
              <Button variant="ghost">Back to the question bank</Button>
            </Link>
          </div>
        </div>
      </AdminShell>
    )
  }

  return (
    <AdminShell title={isEdit ? 'Edit question' : 'New question'}>
      <div className={styles.layout}>
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <p className={styles.legend}>
            Fields marked <Required /> are required. Write mathematics as LaTeX between dollar signs — <code>$x^2$</code> for
            inline, <code>$$…$$</code> for a centred block. The preview updates as you type.
          </p>

          {error && <p className="error-text">{error}</p>}

          <h3 className={styles.sectionTitle}>Classification</h3>
          <div className={styles.grid}>
            <div className="form-group">
              <label htmlFor="q-topic">
                Chapter <Required />
              </label>
              <select id="q-topic" className="form-control" value={form.topic} onChange={(e) => setForm((c) => ({ ...c, topic: e.target.value, subtopic: '' }))} required>
                <option value="">Select a chapter</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>

              {/*
                Chapter detection, offered once there is enough question text to read. It suggests
                and the author accepts — an automatic set would be a decision made on their behalf
                about where a question is filed, and a question in the wrong chapter is served to
                students practising something else.
              */}
              {form.questionText.trim().length >= 10 && (
                <div className={styles.detectRow}>
                  <button type="button" className={styles.detectButton} disabled={detecting} onClick={() => void detectTopic()}>
                    {detecting ? 'Reading…' : 'Suggest a chapter from the question'}
                  </button>

                  {detected?.outcome === 'matched' && detected.match && (
                    <span className={styles.detectResult}>
                      Looks like <strong>{detected.match.topicName}</strong> (matched{' '}
                      {detected.match.matchedWords.join(', ')}).{' '}
                      {form.topic === detected.match.topicId ? (
                        <em>Already selected.</em>
                      ) : (
                        <button
                          type="button"
                          className={styles.detectAccept}
                          onClick={() => {
                            const chosen = detected.match!
                            setForm((current) => ({ ...current, topic: chosen.topicId, subtopic: '' }))
                          }}
                        >
                          Use it
                        </button>
                      )}
                    </span>
                  )}

                  {/* Named rather than resolved: choosing between equal fits would be a coin toss. */}
                  {detected?.outcome === 'ambiguous' && (
                    <span className={styles.detectResult}>
                      Could be {detected.between.join(' or ')} — pick the right one.
                    </span>
                  )}

                  {detected?.outcome === 'none' && (
                    <span className={styles.detectResult}>
                      Nothing in the question named a chapter. Choose one above.
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="q-subtopic">Subtopic</label>
              <select id="q-subtopic" className="form-control" value={form.subtopic} onChange={(e) => set('subtopic', e.target.value)} disabled={!form.topic}>
                <option value="">{form.topic ? 'None' : 'Choose a topic first'}</option>
                {subtopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
              <p className={styles.hint}>Optional.</p>
            </div>
            <div className="form-group">
              <label htmlFor="q-class">
                Class <Required />
              </label>
              <select id="q-class" className="form-control" value={form.classLevel} onChange={(e) => set('classLevel', e.target.value as ClassLevel)} required>
                {CLASS_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="q-difficulty">
                Difficulty <Required />
              </label>
              <select id="q-difficulty" className="form-control" value={form.difficulty} onChange={(e) => set('difficulty', e.target.value as Difficulty)}>
                {DIFFICULTIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="q-tags">Tags</label>
              <input id="q-tags" className="form-control" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="quadratic, roots" />
              <p className={styles.hint}>Comma-separated. Lowercased automatically.</p>
            </div>
          </div>

          <h3 className={styles.sectionTitle}>Question</h3>
          <div className="form-group">
            <label htmlFor="q-type">
              Type <Required />
            </label>
            <select id="q-type" className="form-control" value={form.type} onChange={(e) => set('type', e.target.value as QuestionType)}>
              {QUESTION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {QUESTION_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="q-text">
              Question text <Required />
            </label>
            <textarea id="q-text" className="form-control" rows={4} value={form.questionText} onChange={(e) => set('questionText', e.target.value)} required />
          </div>

          {usesOptions(form.type) && (
            <div className="form-group">
              <label>
                Options <Required />
              </label>
              <p className={styles.hint}>
                {form.type === 'single_choice'
                  ? 'Mark exactly one option correct.'
                  : `Mark at least two options correct (currently ${correctCount}).`}
              </p>
              {form.options.map((option, index) => (
                <div key={index} className={styles.optionRow}>
                  <input
                    type={form.type === 'single_choice' ? 'radio' : 'checkbox'}
                    name="correctOption"
                    checked={option.isCorrect}
                    onChange={(e) => (form.type === 'single_choice' ? selectSingleCorrect(index) : setOption(index, { isCorrect: e.target.checked }))}
                    aria-label={`Option ${index + 1} is correct`}
                  />
                  <input
                    className="form-control"
                    value={option.text}
                    onChange={(e) => setOption(index, { text: e.target.value })}
                    placeholder={`Option ${String.fromCharCode(97 + index)}`}
                    aria-label={`Option ${index + 1} text`}
                  />
                  {form.options.length > 2 && (
                    <button
                      type="button"
                      className={styles.removeOption}
                      onClick={() => setForm((c) => ({ ...c, options: c.options.filter((_, i) => i !== index) }))}
                      aria-label={`Remove option ${index + 1}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {form.options.length < 8 && (
                <Button type="button" variant="ghost" onClick={() => setForm((c) => ({ ...c, options: [...c.options, { text: '', isCorrect: false }] }))}>
                  + Add option
                </Button>
              )}
            </div>
          )}

          {form.type === 'true_false' && (
            <div className="form-group">
              <label htmlFor="q-boolean">
                Answer <Required />
              </label>
              <select id="q-boolean" className="form-control" value={form.booleanAnswer ? 'true' : 'false'} onChange={(e) => set('booleanAnswer', e.target.value === 'true')}>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </div>
          )}

          {form.type === 'numeric' && (
            <div className={styles.grid}>
              <div className="form-group">
                <label htmlFor="q-numeric">
                  Numeric answer <Required />
                </label>
                <input id="q-numeric" type="number" step="any" className="form-control" value={form.numericAnswer} onChange={(e) => set('numericAnswer', e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="q-tolerance">Tolerance</label>
                <input id="q-tolerance" type="number" step="any" min="0" className="form-control" value={form.tolerance} onChange={(e) => set('tolerance', e.target.value)} />
                <p className={styles.hint}>Leave blank to require an exact match.</p>
              </div>
            </div>
          )}

          <h3 className={styles.sectionTitle}>Marking</h3>
          <div className={styles.grid}>
            <div className="form-group">
              <label htmlFor="q-marks">
                Marks <Required />
              </label>
              <input id="q-marks" type="number" step="0.25" min="0.25" className="form-control" value={form.marks} onChange={(e) => set('marks', e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="q-negative">Negative marks</label>
              <input id="q-negative" type="number" step="0.25" min="0" className="form-control" value={form.negativeMarks} onChange={(e) => set('negativeMarks', e.target.value)} />
              <p className={styles.hint}>Amount deducted for a wrong answer. 0 disables negative marking.</p>
            </div>
          </div>

          <h3 className={styles.sectionTitle}>Solution</h3>
          <div className="form-group">
            <label htmlFor="q-solution">Worked solution</label>
            <textarea id="q-solution" className="form-control" rows={4} value={form.solution} onChange={(e) => set('solution', e.target.value)} />
            <p className={styles.hint}>Optional while drafting, but required before the question can be published.</p>
          </div>

          <div className={styles.formActions}>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create draft'}
            </Button>
            <Link to="/admin/questions">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
          </div>
          {!isEdit && <p className={styles.hint}>New questions are saved as drafts. Publish from the question bank when ready.</p>}
        </form>

        {/* Live preview: exactly the renderer the student-facing pages will use, so
            what an author sees here is what gets rendered. */}
        <aside className={styles.preview}>
          <h3 className={styles.previewTitle}>Preview</h3>
          <div className={styles.previewCard}>
            {form.questionText.trim() === '' ? (
              <p className={styles.previewEmpty}>Start typing the question to see it rendered here.</p>
            ) : (
              <MathText block className={styles.previewStem}>
                {form.questionText}
              </MathText>
            )}

            {usesOptions(form.type) && form.options.some((o) => o.text.trim()) && (
              <ol className={styles.previewOptions}>
                {form.options
                  .filter((o) => o.text.trim())
                  .map((option, index) => (
                    <li key={index} className={option.isCorrect ? styles.previewCorrect : undefined}>
                      <span className={styles.previewKey}>{String.fromCharCode(97 + index)}</span>
                      <MathText>{option.text}</MathText>
                    </li>
                  ))}
              </ol>
            )}

            {form.type === 'true_false' && (
              <p className={styles.previewAnswer}>
                Answer: <strong>{form.booleanAnswer ? 'True' : 'False'}</strong>
              </p>
            )}
            {form.type === 'numeric' && form.numericAnswer !== '' && (
              <p className={styles.previewAnswer}>
                Answer: <strong>{form.numericAnswer}</strong>
                {form.tolerance !== '' ? ` (± ${form.tolerance})` : ' (exact)'}
              </p>
            )}

            {form.solution.trim() !== '' && (
              <div className={styles.previewSolution}>
                <strong>Solution</strong>
                <MathText block>{form.solution}</MathText>
              </div>
            )}
          </div>
          <p className={styles.previewNote}>
            An expression shown in red could not be parsed — check the LaTeX. Unbalanced <code>$</code> signs render as plain
            text here but are refused on save.
          </p>
        </aside>
      </div>
    </AdminShell>
  )
}
