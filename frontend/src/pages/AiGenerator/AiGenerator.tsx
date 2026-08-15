import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import MathText from '../../components/MathText'
import { api, ApiError } from '../../api/client'
import {
  CLASS_LEVELS,
  DIFFICULTIES,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type ApproveQuestionsResponse,
  type AvailableModelsResponse,
  type BloomLevel,
  type ClassLevel,
  type Difficulty,
  type GenerateQuestionsResponse,
  type GenerationLanguage,
  type ProposedQuestion,
  type QuestionGeneratorStatus,
  type QuestionType,
  type Subject,
  type Topic,
} from '../../api/types'
import styles from './AiGenerator.module.css'

/**
 * AI question generation with review before approval (Milestone 18).
 *
 * ## The rule this page exists to enforce
 *
 * **Nothing generated is saved until the examiner approves it.** Candidates live in
 * this component's state and nowhere else — there is no draft row, no staging
 * collection, nothing to clean up if the tab is closed. The consequence a reviewer must
 * understand is stated on the page: leaving loses the batch. That is the honest trade
 * for "the bank never fills with machine output nobody read".
 *
 * ## What the reviewer can do, and what they cannot
 *
 * Edit any field, regenerate one question, regenerate the whole batch, delete
 * individual questions — then approve, as drafts or published. What they *cannot* do is
 * bypass validation: every approval is re-checked server-side against the same schema a
 * hand-written question passes, so an edit that breaks a rule is refused there rather
 * than trusted here. This page's own checks are a courtesy, not the gate.
 *
 * Questions approved here become practice material automatically — the Practice Zone
 * draws from the published bank, so there is no separate "practice question" to
 * generate.
 */

interface EditableQuestion extends ProposedQuestion {
  /** Set once the reviewer has changed something, so the UI can say so. */
  edited?: boolean
}

const DEFAULT_COUNT = 5

export default function AiGenerator() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [status, setStatus] = useState<QuestionGeneratorStatus | null>(null)

  // --- Configuration ---
  const [subject, setSubject] = useState('')
  const [chapters, setChapters] = useState<string[]>([])
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 9')
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium')
  const [questionType, setQuestionType] = useState<QuestionType>('single_choice')
  const [language, setLanguage] = useState<GenerationLanguage>('English')
  const [bloomLevel, setBloomLevel] = useState<BloomLevel | ''>('')
  const [count, setCount] = useState(DEFAULT_COUNT)
  const [marks, setMarks] = useState(4)
  const [negativeMarks, setNegativeMarks] = useState(1)
  const [optionCount, setOptionCount] = useState(4)
  const [instructions, setInstructions] = useState('')

  // --- Review state ---
  const [batch, setBatch] = useState<EditableQuestion[] | null>(null)
  const [result, setResult] = useState<GenerateQuestionsResponse | null>(null)
  const [saved, setSaved] = useState<ApproveQuestionsResponse | null>(null)
  const [busy, setBusy] = useState<'all' | 'approve' | string | null>(null)
  const [error, setError] = useState('')
  // Model names are retired on Google's schedule, so the page can ask the key itself
  // rather than making the examiner guess what to put in GEMINI_MODEL.
  const [models, setModels] = useState<AvailableModelsResponse | null>(null)
  const [modelsError, setModelsError] = useState('')

  useEffect(() => {
    api
      .get<{ subjects: Subject[] }>('/subjects?status=active')
      .then((res) => setSubjects(res.subjects))
      .catch(() => setSubjects([]))
    api
      .get<QuestionGeneratorStatus>('/admin/question-generator')
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    setChapters([])
    if (!subject) {
      setTopics([])
      return
    }
    api
      .get<{ topics: Topic[] }>(`/topics?subject=${subject}&parent=root&status=active`)
      .then((res) => setTopics(res.topics))
      .catch(() => setTopics([]))
  }, [subject])

  const ready = Boolean(status?.available)
  const takesOptions = questionType === 'single_choice' || questionType === 'multiple_choice'

  const config = useMemo(
    () => ({
      subject,
      chapters,
      classLevel,
      difficulty,
      questionType,
      language,
      bloomLevel: bloomLevel || null,
      marks,
      negativeMarks,
      optionCount,
      instructions: instructions.trim() || null,
    }),
    [subject, chapters, classLevel, difficulty, questionType, language, bloomLevel, marks, negativeMarks, optionCount, instructions],
  )

  /** Text already on screen, so a regenerate is told not to repeat itself. */
  function currentTexts(except?: string): string[] {
    return (batch ?? []).filter((entry) => entry.clientId !== except).map((entry) => entry.questionText)
  }

  async function generate(replace: boolean, howMany: number, replacing?: string) {
    setError('')
    setSaved(null)
    setBusy(replacing ?? 'all')
    try {
      const res = await api.post<GenerateQuestionsResponse>('/admin/generate-questions', {
        ...config,
        count: howMany,
        exclude: replace ? [] : currentTexts(replacing),
      })
      setResult(res)
      setBatch((current) => {
        if (replace || !current) return res.questions
        if (!replacing) return [...current, ...res.questions]
        // Swap the one being regenerated in place, so the reviewer's eye does not have
        // to find it again at the bottom of the list.
        const replacement = res.questions[0]
        if (!replacement) return current
        return current.map((entry) => (entry.clientId === replacing ? replacement : entry))
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate questions.')
    } finally {
      setBusy(null)
    }
  }

  function patch(clientId: string, changes: Partial<EditableQuestion>) {
    setBatch((current) =>
      (current ?? []).map((entry) => (entry.clientId === clientId ? { ...entry, ...changes, edited: true } : entry)),
    )
  }

  async function approve(publish: boolean) {
    if (!batch || batch.length === 0) return
    setError('')
    setBusy('approve')
    try {
      const res = await api.post<ApproveQuestionsResponse>('/admin/generate-questions/approve', {
        subject,
        topic: chapters[0],
        classLevel,
        difficulty,
        publish,
        logId: result?.logId ?? null,
        questions: batch.map(({ clientId: _clientId, topic: _topic, edited: _edited, ...question }) => question),
      })
      setSaved(res)
      // Only the ones that failed remain, so the reviewer can fix them rather than
      // hunting for which of twenty was refused.
      if (res.rejected.length === 0) setBatch(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save those questions.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className="container">
        <Link to="/admin" className={styles.back}>
          ← Back to Admin
        </Link>
        <h1>AI Question Generator</h1>

        {status && (
          <div className={`card ${styles.status}`} data-kind={ready ? 'model' : 'off'}>
            <span className={styles.statusBadge}>
              <i className={`ph-bold ${ready ? 'ph-sparkle' : 'ph-warning'}`} /> {status.generator.label}
            </span>
            <p>{status.generator.basis}</p>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setModelsError('')
                api
                  .get<AvailableModelsResponse>('/admin/question-generator/models')
                  .then(setModels)
                  .catch((err) => setModelsError(err instanceof ApiError ? err.message : 'Could not reach Google.'))
              }}
            >
              Which models can my key use?
            </button>
            {modelsError && <p className="error-text">{modelsError}</p>}
            {models && (
              <div className={styles.modelList}>
                <p className={styles.hint}>
                  Currently configured: <code>{models.configured}</code>. Set <code>GEMINI_MODEL</code> to any name below.
                </p>
                <ul>
                  {models.models.map((model) => (
                    <li key={model.id}>
                      <code>{model.id}</code> {model.inUse && <strong>· in use</strong>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!ready && (
              <p className={styles.hint}>
                <strong>Not configured.</strong> Set <code>GEMINI_API_KEY</code> in the backend environment and redeploy — see{' '}
                <code>ENVIRONMENT_VARIABLES.md</code>. Until then this page cannot generate anything.
              </p>
            )}
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        {/* ----------------------------------------------------------------
            Configuration
        ---------------------------------------------------------------- */}
        <form
          className={`card ${styles.form}`}
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void generate(true, count)
          }}
        >
          <div className={styles.grid}>
            <div className="form-group">
              <label htmlFor="gen-subject">Subject</label>
              <select id="gen-subject" className="form-control" value={subject} onChange={(e) => setSubject(e.target.value)}>
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
              <label htmlFor="gen-class">Class</label>
              <select id="gen-class" className="form-control" value={classLevel} onChange={(e) => setClassLevel(e.target.value as ClassLevel)}>
                {CLASS_LEVELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Multi-select, because a paper is usually drawn from more than one chapter. */}
          <div className="form-group">
            <label>Chapters {chapters.length > 0 && <span className={styles.hint}>({chapters.length} selected)</span>}</label>
            {topics.length === 0 ? (
              <p className={styles.hint}>{subject ? 'This subject has no chapters yet.' : 'Choose a subject first.'}</p>
            ) : (
              <div className={styles.chapterList}>
                {topics.map((t) => (
                  <label key={t.id} className={styles.chapter}>
                    <input
                      type="checkbox"
                      checked={chapters.includes(t.id)}
                      onChange={(e) =>
                        setChapters((current) => (e.target.checked ? [...current, t.id] : current.filter((id) => id !== t.id)))
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
            {chapters.length > 1 && (
              <p className={styles.hint}>
                Questions are spread across the chapters you tick, and all are filed under the first one — a question belongs to
                exactly one chapter in the bank.
              </p>
            )}
          </div>

          <div className={styles.grid}>
            <div className="form-group">
              <label htmlFor="gen-type">Question type</label>
              <select id="gen-type" className="form-control" value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType)}>
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {QUESTION_TYPE_LABELS[t]}
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
              <label htmlFor="gen-language">Language</label>
              <select id="gen-language" className="form-control" value={language} onChange={(e) => setLanguage(e.target.value as GenerationLanguage)}>
                {(status?.languages ?? ['English']).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="gen-bloom">Bloom&rsquo;s level</label>
              <select id="gen-bloom" className="form-control" value={bloomLevel} onChange={(e) => setBloomLevel(e.target.value as BloomLevel | '')}>
                <option value="">Not specified</option>
                {(status?.bloomLevels ?? []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="gen-count">How many</label>
              <input id="gen-count" type="number" min={1} max={20} className="form-control" value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>

            <div className="form-group">
              <label htmlFor="gen-marks">Marks each</label>
              <input id="gen-marks" type="number" min={0.25} max={100} step={0.25} className="form-control" value={marks} onChange={(e) => setMarks(Number(e.target.value))} />
            </div>

            <div className="form-group">
              <label htmlFor="gen-negative">Negative marks</label>
              <input id="gen-negative" type="number" min={0} max={marks} step={0.25} className="form-control" value={negativeMarks} onChange={(e) => setNegativeMarks(Number(e.target.value))} />
            </div>

            {takesOptions && (
              <div className="form-group">
                <label htmlFor="gen-options">Options per question</label>
                <input id="gen-options" type="number" min={2} max={8} className="form-control" value={optionCount} onChange={(e) => setOptionCount(Number(e.target.value))} />
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="gen-instructions">Extra instructions (optional)</label>
            <textarea
              id="gen-instructions"
              className="form-control"
              rows={2}
              maxLength={500}
              placeholder="e.g. Prefer word problems set in everyday Indian contexts. Avoid calculus notation."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
            <p className={styles.hint}>{500 - instructions.length} characters left.</p>
          </div>

          <Button type="submit" disabled={!ready || busy !== null || !subject || chapters.length === 0}>
            {busy === 'all' ? 'Writing questions…' : `Generate ${count} question${count === 1 ? '' : 's'}`}
          </Button>
        </form>

        {busy === 'all' && <Spinner label="Gemini is writing the questions — this usually takes a few seconds…" />}

        {/* ----------------------------------------------------------------
            What was discarded, and why
        ---------------------------------------------------------------- */}
        {result && (result.rejected.length > 0 || result.duplicates.length > 0) && (
          <div className={`card ${styles.rejected}`}>
            <h3>
              {result.rejected.length + result.duplicates.length} of {result.requested} discarded
            </h3>
            <ul>
              {result.rejected.map((entry) => (
                <li key={`r${entry.index}`}>
                  <strong>#{entry.index}</strong> {entry.reason}
                </li>
              ))}
              {result.duplicates.map((entry) => (
                <li key={`d${entry.index}`}>
                  <strong>#{entry.index}</strong> {entry.reason}
                </li>
              ))}
            </ul>
            <p className={styles.hint}>
              Nothing was corrected automatically — a repaired answer key that looks right is worse than a missing question.
            </p>
          </div>
        )}

        {/* ----------------------------------------------------------------
            Review
        ---------------------------------------------------------------- */}
        {batch && batch.length > 0 && (
          <>
            <div className={`card ${styles.reviewBar}`}>
              <div>
                <h3>Review {batch.length} question{batch.length === 1 ? '' : 's'}</h3>
                <p className={styles.hint}>
                  <strong>Nothing is saved yet.</strong> These exist only on this screen — leaving the page discards them.
                </p>
              </div>
              <div className={styles.reviewActions}>
                <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => void generate(true, batch.length)}>
                  Regenerate all
                </button>
                <Button type="button" disabled={busy !== null} onClick={() => void approve(false)}>
                  {busy === 'approve' ? 'Saving…' : 'Approve as drafts'}
                </Button>
                <Button type="button" disabled={busy !== null} onClick={() => void approve(true)}>
                  Approve &amp; publish
                </Button>
              </div>
            </div>

            {batch.map((question, index) => (
              <QuestionCard
                key={question.clientId}
                index={index + 1}
                question={question}
                busy={busy === question.clientId}
                disabled={busy !== null}
                onChange={(changes) => patch(question.clientId, changes)}
                onRegenerate={() => void generate(false, 1, question.clientId)}
                onDelete={() => setBatch((current) => (current ?? []).filter((entry) => entry.clientId !== question.clientId))}
              />
            ))}
          </>
        )}

        {/* ----------------------------------------------------------------
            Saved
        ---------------------------------------------------------------- */}
        {saved && (
          <div className={`card ${styles.savedBox}`}>
            <h3>{saved.message}</h3>
            {saved.rejected.length > 0 && (
              <ul className={styles.rejectedList}>
                {saved.rejected.map((entry) => (
                  <li key={entry.index}>
                    <strong>#{entry.index}</strong> {entry.reason}
                  </li>
                ))}
              </ul>
            )}
            <p>
              <Link to="/admin/questions">Open the question bank →</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One candidate, editable in place.
 *
 * Everything is a plain controlled input rather than a rich editor: the fields are the
 * same ones the question editor already exposes, and a second editing surface with its
 * own quirks would be a second thing to keep correct.
 */
function QuestionCard({
  index,
  question,
  busy,
  disabled,
  onChange,
  onRegenerate,
  onDelete,
}: {
  index: number
  question: EditableQuestion
  busy: boolean
  disabled: boolean
  onChange: (changes: Partial<EditableQuestion>) => void
  onRegenerate: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const takesOptions = question.type === 'single_choice' || question.type === 'multiple_choice'

  return (
    <div className={`card ${styles.qCard}`}>
      <div className={styles.qHead}>
        <span className={styles.qIndex}>#{index}</span>
        <span className={styles.qType}>{QUESTION_TYPE_LABELS[question.type]}</span>
        {question.edited && <span className={styles.editedTag}>edited</span>}
        <span className={styles.qMarks}>
          {question.marks} mark{question.marks === 1 ? '' : 's'}
        </span>
      </div>

      {open ? (
        <textarea className="form-control" rows={3} value={question.questionText} onChange={(e) => onChange({ questionText: e.target.value })} />
      ) : (
        <p className={styles.qText}>
          <MathText>{question.questionText}</MathText>
        </p>
      )}

      {takesOptions && (
        <ul className={styles.options}>
          {question.options.map((option, i) => (
            <li key={i} className={option.isCorrect ? styles.correct : undefined}>
              {open ? (
                <div className={styles.optionEdit}>
                  <input
                    type="checkbox"
                    checked={option.isCorrect}
                    aria-label="Correct"
                    onChange={(e) =>
                      onChange({
                        options: question.options.map((o, j) => (j === i ? { ...o, isCorrect: e.target.checked } : o)),
                      })
                    }
                  />
                  <input
                    className="form-control"
                    value={option.text}
                    onChange={(e) =>
                      onChange({ options: question.options.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)) })
                    }
                  />
                </div>
              ) : (
                <>
                  <MathText>{option.text}</MathText>
                  {option.isCorrect && <i className={`ph-bold ph-check ${styles.tick}`} />}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {question.type === 'true_false' && (
        <p className={styles.answerLine}>
          Answer:{' '}
          {open ? (
            <select
              className="form-control"
              value={String(question.booleanAnswer)}
              onChange={(e) => onChange({ booleanAnswer: e.target.value === 'true' })}
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          ) : (
            <strong>{question.booleanAnswer ? 'True' : 'False'}</strong>
          )}
        </p>
      )}

      {question.type === 'numeric' && (
        <p className={styles.answerLine}>
          Answer: <strong>{question.numericAnswer}</strong>
          {question.tolerance ? <span className={styles.hint}> (± {question.tolerance})</span> : null}
        </p>
      )}

      {question.type === 'fill_blank' && (
        <p className={styles.answerLine}>
          Accepted:{' '}
          {open ? (
            <input
              className="form-control"
              value={question.acceptedAnswers.join(' | ')}
              onChange={(e) => onChange({ acceptedAnswers: e.target.value.split('|').map((v) => v.trim()).filter(Boolean) })}
            />
          ) : (
            <strong>{question.acceptedAnswers.join(' · ')}</strong>
          )}
          {open && <span className={styles.hint}>Separate alternatives with a vertical bar.</span>}
        </p>
      )}

      {question.solution && (
        <details className={styles.solution}>
          <summary>Solution</summary>
          {open ? (
            <textarea className="form-control" rows={3} value={question.solution} onChange={(e) => onChange({ solution: e.target.value })} />
          ) : (
            <MathText>{question.solution}</MathText>
          )}
        </details>
      )}

      <div className={styles.qActions}>
        <button type="button" className={styles.secondary} onClick={() => setOpen((v) => !v)}>
          {open ? 'Done editing' : 'Edit'}
        </button>
        <button type="button" className={styles.secondary} disabled={disabled} onClick={onRegenerate}>
          {busy ? 'Regenerating…' : 'Regenerate this one'}
        </button>
        <button type="button" className={styles.danger} disabled={disabled} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
