import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import MathText from '../../components/MathText'
import { api, ApiError } from '../../api/client'
import { loadChapters } from '../../api/implicitSubject'
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
  type QualityWarning,
  type QuestionGeneratorStatus,
  type QuestionType,
  type QuestionVerdict,
  type Topic,
  type ValidateQuestionsResponse,
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
 * Edit any field, regenerate one question, regenerate the whole batch, discard individual
 * questions, tick which ones to keep — then approve the selection, as drafts or published.
 * What they *cannot* do is bypass validation: every approval is re-checked server-side
 * against the same schema a hand-written question passes, so an edit that breaks a rule is
 * refused there rather than trusted here. This page's own checks are a courtesy, not the
 * gate.
 *
 * ## "Check before saving" is not a second opinion
 *
 * The Check button calls a dry-run endpoint that runs the **same** screening function
 * approval runs, and saves nothing. It exists because an edit can break a rule — most often
 * unticking the correct option and forgetting to tick another — and the alternative was
 * pressing Approve to find out, having already saved the rest of the batch.
 *
 * ## Warnings are advisory, and the page says so
 *
 * A card may carry warnings and still be perfectly approvable: they are the defects that are
 * decidable from the text but not always defects (a reference to a figure, a tolerance wide
 * enough to mark a wrong answer right, the correct option sitting in position (a) all the way
 * down). Nothing here claims the mathematics has been checked, because nothing has checked
 * it — that is what the reviewer is for.
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
  const [topics, setTopics] = useState<Topic[]>([])
  const [subtopics, setSubtopics] = useState<Topic[]>([])
  const [status, setStatus] = useState<QuestionGeneratorStatus | null>(null)

  // --- Configuration ---
  const [chapters, setChapters] = useState<string[]>([])
  // Of the *first* chapter only, since that is the one questions are filed under.
  const [subtopic, setSubtopic] = useState('')
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
  // Empty means "whatever the deployment is configured with", which is what the
  // examiner sees selected until they pick something else.
  const [model, setModel] = useState('')

  // --- Review state ---
  const [batch, setBatch] = useState<EditableQuestion[] | null>(null)
  const [result, setResult] = useState<GenerateQuestionsResponse | null>(null)
  const [saved, setSaved] = useState<ApproveQuestionsResponse | null>(null)
  const [busy, setBusy] = useState<'all' | 'approve' | 'check' | string | null>(null)
  const [error, setError] = useState('')
  // Which questions Approve will save. Everything starts ticked: the common case is keeping
  // the batch, and an examiner who has to tick twenty boxes will stop reading them.
  const [selected, setSelected] = useState<string[]>([])
  const [checked, setChecked] = useState<ValidateQuestionsResponse | null>(null)
  // Model names are retired on Google's schedule, so the page can ask the key itself
  // rather than making the examiner guess what to put in GEMINI_MODEL.
  const [models, setModels] = useState<AvailableModelsResponse | null>(null)
  const [modelsError, setModelsError] = useState('')

  useEffect(() => {
    /**
     * Every chapter, loaded once.
     *
     * There is **no subject picker** (Milestone 21, Phase K): AMIT is a mathematics olympiad, and
     * the API derives the subject from the first chapter — `subject` is optional on
     * `generateQuestionsSchema`. The prompt still *names* the subject, because "write me a
     * Mathematics question" is information the model needs; what changed is that nobody chooses it.
     */
    loadChapters()
      .then(setTopics)
      .catch(() => setTopics([]))
    api
      .get<QuestionGeneratorStatus>('/admin/question-generator')
      .then(setStatus)
      .catch(() => setStatus(null))
    // Asked for up front so the picker is usable immediately. A failure here costs the
    // picker, not the page: generation still runs on the configured default, which is
    // why `models` being null is a supported state rather than an error.
    api
      .get<AvailableModelsResponse>('/admin/question-generator/models')
      .then(setModels)
      .catch((err) => setModelsError(err instanceof ApiError ? err.message : 'Could not reach Google.'))
  }, [])

  /**
   * The subtopic list follows the **first** ticked chapter, and resets when it changes.
   *
   * Reset rather than kept: a subtopic of a chapter you are no longer generating for
   * describes a question that cannot exist, and the backend refuses it — better to lose the
   * selection than to send a request that is guaranteed to fail.
   */
  const primaryChapter = chapters[0] ?? ''
  useEffect(() => {
    setSubtopic('')
    if (!primaryChapter) {
      setSubtopics([])
      return
    }
    api
      .get<{ topics: Topic[] }>(`/topics?parent=${primaryChapter}&status=active`)
      .then((res) => setSubtopics(res.topics))
      .catch(() => setSubtopics([]))
  }, [primaryChapter])

  const ready = Boolean(status?.available)
  const takesOptions = questionType === 'single_choice' || questionType === 'multiple_choice'

  const config = useMemo(
    () => ({
      chapters,
      subtopic: subtopic || null,
      classLevel,
      difficulty,
      questionType,
      language,
      bloomLevel: bloomLevel || null,
      marks,
      negativeMarks,
      optionCount,
      instructions: instructions.trim() || null,
      model: model || null,
    }),
    [chapters, subtopic, classLevel, difficulty, questionType, language, bloomLevel, marks, negativeMarks, optionCount, instructions, model],
  )

  /** Text already on screen, so a regenerate is told not to repeat itself. */
  function currentTexts(except?: string): string[] {
    return (batch ?? []).filter((entry) => entry.clientId !== except).map((entry) => entry.questionText)
  }

  async function generate(replace: boolean, howMany: number, replacing?: string) {
    setError('')
    setSaved(null)
    // Any earlier verdict describes questions that no longer exist, and a stale tick beside a
    // replaced question is worse than no tick at all.
    setChecked(null)
    setBusy(replacing ?? 'all')
    try {
      const res = await api.post<GenerateQuestionsResponse>('/admin/generate-questions', {
        ...config,
        count: howMany,
        exclude: replace ? [] : currentTexts(replacing),
      })
      setResult(res)
      setBatch((current) => {
        if (replace || !current) {
          setSelected(res.questions.map((entry) => entry.clientId))
          return res.questions
        }
        if (!replacing) {
          setSelected((ids) => [...ids, ...res.questions.map((entry) => entry.clientId)])
          return [...current, ...res.questions]
        }
        // Swap the one being regenerated in place, so the reviewer's eye does not have
        // to find it again at the bottom of the list.
        const replacement = res.questions[0]
        if (!replacement) return current
        setSelected((ids) => ids.map((id) => (id === replacing ? replacement.clientId : id)))
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
    // The verdict was about the text as it was a keystroke ago.
    setChecked(null)
  }

  /**
   * What the server accepts for a reviewed question.
   *
   * `clientId`, `topic`, `subtopic` and `warnings` are dropped: the taxonomy travels once for
   * the whole batch, and a warning is something the server told *us*. `edited` is kept,
   * because whether the examiner changed the text is worth recording next to the model that
   * wrote it.
   */
  function payload(questions: EditableQuestion[]) {
    return questions.map(
      ({ clientId: _clientId, topic: _topic, subtopic: _subtopic, warnings: _warnings, edited, ...question }) => ({
        ...question,
        edited: edited === true,
      }),
    )
  }

  /**
   * Records that candidates were thrown away.
   *
   * Nothing was stored, so there is nothing to delete — but the count is the only measure of
   * whether a prompt configuration is producing usable questions, and it is invisible
   * everywhere else. Deliberately fire-and-forget: a failure here must not interrupt the
   * examiner, because the questions are discarded either way.
   */
  function recordDiscarded(count: number) {
    const logId = result?.logId
    if (!logId || count <= 0) return
    void api.post('/admin/generate-questions/reject', { logId, count }).catch(() => undefined)
  }

  function discard(clientId: string) {
    setBatch((current) => (current ?? []).filter((entry) => entry.clientId !== clientId))
    setSelected((ids) => ids.filter((id) => id !== clientId))
    setChecked(null)
    recordDiscarded(1)
  }

  function discardAll() {
    recordDiscarded(batch?.length ?? 0)
    setBatch(null)
    setSelected([])
    setChecked(null)
    setResult(null)
  }

  const chosen = (batch ?? []).filter((entry) => selected.includes(entry.clientId))

  /** The dry run: the same screening approval performs, with nothing written. */
  async function check() {
    if (chosen.length === 0) return
    setError('')
    setBusy('check')
    try {
      setChecked(
        await api.post<ValidateQuestionsResponse>('/admin/generate-questions/validate', {
          topic: chapters[0],
          subtopic: subtopic || null,
          classLevel,
          difficulty,
          questions: payload(chosen),
        }),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check those questions.')
    } finally {
      setBusy(null)
    }
  }

  async function approve(publish: boolean) {
    if (chosen.length === 0) return
    setError('')
    setBusy('approve')
    try {
      const res = await api.post<ApproveQuestionsResponse>('/admin/generate-questions/approve', {
        topic: chapters[0],
        subtopic: subtopic || null,
        classLevel,
        difficulty,
        publish,
        logId: result?.logId ?? null,
        questions: payload(chosen),
      })
      setSaved(res)
      setChecked(null)

      if (res.rejected.length === 0) {
        // Anything left unticked was reviewed and not wanted, which is a rejection.
        const leftBehind = (batch ?? []).filter((entry) => !selected.includes(entry.clientId))
        recordDiscarded(leftBehind.length)
        setBatch(leftBehind.length > 0 ? leftBehind : null)
        setSelected(leftBehind.map((entry) => entry.clientId))
      }
      // When something was refused the whole batch stays put, so the reviewer can fix the
      // one that failed rather than hunting for which of twenty it was.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save those questions.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Findings about the batch: whichever is more recent, the generation's or the check's.
   *
   * The check only looked at the ticked questions, so its answer supersedes the
   * generation's — a position bias across twenty candidates is not a position bias across the
   * three you kept.
   */
  const batchWarnings: QualityWarning[] = checked ? checked.batchWarnings : (result?.batchWarnings ?? [])

  /**
   * The verdict for one card.
   *
   * The check reports by *position within the ticked set*, which is what the server was sent,
   * so the position has to be mapped back to a card. Untick something after checking and the
   * verdicts stop lining up — which is exactly why `setSelected` does not clear `checked` but
   * this mapping is recomputed from the current selection on every render.
   */
  function verdictFor(clientId: string): QuestionVerdict | null {
    if (!checked) return null
    const position = chosen.findIndex((entry) => entry.clientId === clientId)
    if (position < 0) return null
    return checked.verdicts[position] ?? null
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
              <p className={styles.hint}>No chapters yet — create one under Chapters first.</p>
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

          {/* Only of the first chapter, because that is where the questions are filed. */}
          {subtopics.length > 0 && (
            <div className="form-group">
              <label htmlFor="gen-subtopic">Subtopic (optional)</label>
              <select
                id="gen-subtopic"
                className="form-control"
                value={subtopic}
                onChange={(e) => setSubtopic(e.target.value)}
              >
                <option value="">Whole chapter</option>
                {subtopics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className={styles.hint}>
                Narrows what is written to one part of <strong>{topics.find((t) => t.id === primaryChapter)?.name ?? 'the chapter'}</strong>,
                and files the questions under it.
              </p>
            </div>
          )}

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
              <label htmlFor="gen-model">Model</label>
              <select id="gen-model" className="form-control" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">
                  Default{models?.configured ? ` (${models.configured})` : ''}
                </option>
                {(models?.models ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.id}
                  </option>
                ))}
              </select>
              {modelsError ? (
                <p className={styles.hint}>
                  Could not load the list ({modelsError}) — the configured default will be used.
                </p>
              ) : (
                <p className={styles.hint}>
                  {models ? `${models.models.length} available to your key.` : 'Loading what your key can use…'}
                </p>
              )}
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

          <Button type="submit" disabled={!ready || busy !== null || chapters.length === 0}>
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
            Findings about the batch as a whole
        ---------------------------------------------------------------- */}
        {batchWarnings.length > 0 && (
          <div className={`card ${styles.warnBox}`}>
            <h3>
              <i className="ph-bold ph-warning-circle" /> Worth a look before you save
            </h3>
            <ul>
              {batchWarnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ----------------------------------------------------------------
            Review
        ---------------------------------------------------------------- */}
        {batch && batch.length > 0 && (
          <>
            <div className={`card ${styles.reviewBar}`}>
              <div>
                <h3>
                  Review {batch.length} question{batch.length === 1 ? '' : 's'}
                </h3>
                <p className={styles.hint}>
                  <strong>Nothing is saved yet.</strong> These exist only on this screen — leaving the page discards them.
                  {result?.model && <> Written by <code>{result.model}</code>.</>}
                </p>
                <div className={styles.selectRow}>
                  <span>
                    <strong>{chosen.length}</strong> of {batch.length} ticked to save
                  </span>
                  <button
                    type="button"
                    className={styles.linkAction}
                    onClick={() => setSelected(batch.map((entry) => entry.clientId))}
                  >
                    Select all
                  </button>
                  <button type="button" className={styles.linkAction} onClick={() => setSelected([])}>
                    Select none
                  </button>
                </div>
                {checked && (
                  <p className={checked.wouldSave === chosen.length ? styles.checkOk : styles.checkBad}>
                    {checked.wouldSave === chosen.length
                      ? `Checked: all ${chosen.length} would save.`
                      : `Checked: ${checked.wouldSave} of ${chosen.length} would save. The rest are marked below with the rule they break.`}
                  </p>
                )}
              </div>
              <div className={styles.reviewActions}>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy !== null}
                  onClick={() => void generate(true, batch.length)}
                >
                  Regenerate all
                </button>
                {/* No provider call, so an examiner may press this as often as they like. */}
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy !== null || chosen.length === 0}
                  onClick={() => void check()}
                >
                  {busy === 'check' ? 'Checking…' : 'Check before saving'}
                </button>
                <Button type="button" disabled={busy !== null || chosen.length === 0} onClick={() => void approve(false)}>
                  {busy === 'approve' ? 'Saving…' : `Approve ${chosen.length} as draft${chosen.length === 1 ? '' : 's'}`}
                </Button>
                <Button type="button" disabled={busy !== null || chosen.length === 0} onClick={() => void approve(true)}>
                  Approve &amp; publish
                </Button>
                <button type="button" className={styles.danger} disabled={busy !== null} onClick={discardAll}>
                  Discard all
                </button>
              </div>
            </div>

            {batch.map((question, index) => (
              <QuestionCard
                key={question.clientId}
                index={index + 1}
                question={question}
                busy={busy === question.clientId}
                disabled={busy !== null}
                picked={selected.includes(question.clientId)}
                verdict={verdictFor(question.clientId)}
                onPick={(next) =>
                  setSelected((ids) =>
                    next ? [...ids, question.clientId] : ids.filter((id) => id !== question.clientId),
                  )
                }
                onChange={(changes) => patch(question.clientId, changes)}
                onRegenerate={() => void generate(false, 1, question.clientId)}
                onDelete={() => discard(question.clientId)}
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
  picked,
  verdict,
  onPick,
  onChange,
  onRegenerate,
  onDelete,
}: {
  index: number
  question: EditableQuestion
  busy: boolean
  disabled: boolean
  picked: boolean
  /** The dry run's answer for this card, once the examiner has asked for one. */
  verdict: QuestionVerdict | null
  onPick: (next: boolean) => void
  onChange: (changes: Partial<EditableQuestion>) => void
  onRegenerate: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const takesOptions = question.type === 'single_choice' || question.type === 'multiple_choice'
  // The check's warnings describe the text as checked; the generation's describe it as
  // written. Prefer the newer of the two.
  const warnings = verdict ? verdict.warnings : question.warnings

  return (
    <div className={`card ${styles.qCard}`} data-picked={picked} data-refused={verdict?.ok === false}>
      <div className={styles.qHead}>
        <label className={styles.pick}>
          <input
            type="checkbox"
            checked={picked}
            disabled={disabled}
            onChange={(e) => onPick(e.target.checked)}
            aria-label={`Save question ${index}`}
          />
        </label>
        <span className={styles.qIndex}>#{index}</span>
        <span className={styles.qType}>{QUESTION_TYPE_LABELS[question.type]}</span>
        {question.edited && <span className={styles.editedTag}>edited</span>}
        <span className={styles.qMarks}>
          {question.marks} mark{question.marks === 1 ? '' : 's'}
        </span>
      </div>

      {/* The rule this question breaks, from the dry run. Approving would refuse it. */}
      {verdict?.ok === false && verdict.reason && (
        <p className={styles.refusedLine}>
          <i className="ph-bold ph-x-circle" /> Would not save: {verdict.reason}
        </p>
      )}

      {/*
        Advisory only. A card can carry these and still be exactly right — nothing here has
        checked the mathematics, which is what the reviewer is for.
      */}
      {warnings.length > 0 && (
        <ul className={styles.warnList}>
          {warnings.map((warning) => (
            <li key={warning.code}>
              <i className="ph-bold ph-warning" /> {warning.message}
            </li>
          ))}
        </ul>
      )}

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
          Discard
        </button>
      </div>
    </div>
  )
}
