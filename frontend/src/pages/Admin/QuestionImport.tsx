import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AdminShell from './AdminShell'
import Button from '../../components/Button'
import MathText from '../../components/MathText'
import { api, ApiError, API_BASE } from '../../api/client'
import {
  CLASS_LEVELS,
  DIFFICULTIES,
  IMPORT_FILE_KINDS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type ClassLevel,
  type Difficulty,
  type ImportFileKind,
  type ImportPreview,
  type ImportStatus,
  type ImportValidation,
  type ImportVerdict,
  type ImportWarning,
  type ImportedQuestion,
  type QuestionType,
  type Subject,
  type Topic,
} from '../../api/types'
import styles from './QuestionImport.module.css'

/**
 * Bulk question import (Milestone 21, Phase F).
 *
 * This page is what makes the feature usable: Phases C–E built three parsers that were only
 * reachable with `curl`.
 *
 * ## The safety property it has to preserve
 *
 * **Uploading writes nothing, and only approval writes.** The candidates on this screen live *here*
 * — there is no staging collection on purpose, so the question bank cannot fill with machine-read
 * text nobody looked at. Leaving the page discards them, and the page says so rather than letting
 * an examiner assume their work is safe.
 *
 * ## Why it is one page and not three
 *
 * A tab per format, but **one review screen** underneath. Every parser normalises into the same
 * candidate shape, so a spreadsheet row, a Word paragraph and a photographed question are edited,
 * checked and approved by identical code here. Three review screens would be three places for the
 * approve payload to drift out of step with the backend.
 *
 * ## What is deliberately not hidden
 *
 * Failures, duplicates, rejected rows, per-file outcomes and the batch warnings all get their own
 * visible section. The spec's rule is "do not silently skip invalid rows" and the honest reading of
 * it is that an examiner should be able to see, without clicking anything, how many questions their
 * file *did not* produce and why. The counts strip at the top exists for exactly that.
 */

// ---------------------------------------------------------------------------
// Local shapes
// ---------------------------------------------------------------------------

/** A candidate plus the two facts only this screen knows: whether it is edited, and picked. */
interface EditableQuestion extends ImportedQuestion {
  edited: boolean
}

type Busy = 'upload' | 'check' | 'approve' | 'template' | null

const KIND_LABELS: Record<ImportFileKind, string> = {
  excel: 'Excel',
  docx: 'Word',
  image: 'Photographs',
}

const KIND_ACCEPT: Record<ImportFileKind, string> = {
  excel: '.xlsx',
  docx: '.docx',
  image: '.jpg,.jpeg,.png,.webp',
}

const KIND_ICONS: Record<ImportFileKind, string> = {
  excel: 'ph-file-xls',
  docx: 'ph-file-doc',
  image: 'ph-image',
}

/** A file the examiner has chosen, already encoded for the JSON body. */
interface ChosenFile {
  name: string
  /** A base64 data URL, exactly as `uploadSchemas.ts` expects. */
  content: string
  size: number
}

/**
 * Reads a file into a base64 data URL.
 *
 * Uploads travel inside the JSON body rather than as multipart — the same route the registration
 * photo and the event gallery take — which is why **nothing in this feature touches a filesystem**
 * at either end. `FileReader` gives us the data URL directly.
 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`))
    reader.readAsDataURL(file)
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export default function QuestionImport() {
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [kind, setKind] = useState<ImportFileKind>('excel')

  // --- The upload form ---
  const [topics, setTopics] = useState<Topic[]>([])
  const [subtopics, setSubtopics] = useState<Topic[]>([])
  const [topic, setTopic] = useState('')
  const [subtopic, setSubtopic] = useState('')
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 9')
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium')
  const [questionType, setQuestionType] = useState<QuestionType | ''>('')
  const [marks, setMarks] = useState(4)
  const [negativeMarks, setNegativeMarks] = useState(1)
  const [files, setFiles] = useState<ChosenFile[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  // --- The review ---
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [batch, setBatch] = useState<EditableQuestion[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  /**
   * The dry run's answer, **keyed by `clientId`** rather than kept as the positional array the
   * endpoint returns.
   *
   * The endpoint answers positionally over whatever was sent, so holding the raw array and indexing
   * it by a question's current position in the ticked set is wrong the moment the examiner ticks or
   * unticks anything — every verdict after the change shifts by one, and the screen would show one
   * question's rejection reason against a different question. In a screen whose whole job is
   * deciding what reaches children, a misattributed "would not save" is worse than no check.
   */
  const [checked, setChecked] = useState<{ byId: Map<string, ImportVerdict>; wouldSave: number; of: number } | null>(
    null,
  )
  const [saved, setSaved] = useState<{
    message: string
    rejected: ImportRejectionView[]
    publishFailures: string[]
  } | null>(null)

  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)

  /** What the deployment can actually read, and the ceilings. */
  useEffect(() => {
    api
      .get<ImportStatus>('/admin/questions/import')
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the importer.'))
  }, [])

  /**
   * The chapters to choose from.
   *
   * There is **no subject picker** — the platform is a mathematics olympiad, so the subject is
   * implicit and the chapter already records which one it belongs to (see the Milestone 21 ADR on
   * the Mathematics-only scope). The list is fetched via the one active subject rather than asking
   * the examiner to pick it.
   */
  useEffect(() => {
    api
      .get<{ subjects: Subject[] }>('/subjects?status=active')
      .then((res) => {
        const first = res.subjects[0]
        if (!first) {
          setTopics([])
          return
        }
        return api
          .get<{ topics: Topic[] }>(`/topics?subject=${first.id}&parent=root&status=active`)
          .then((r) => setTopics(r.topics))
      })
      .catch(() => setTopics([]))
  }, [])

  /** Subtopics of the chosen chapter, so the optional second level can be narrowed. */
  useEffect(() => {
    setSubtopic('')
    if (!topic) {
      setSubtopics([])
      return
    }
    api
      .get<{ topics: Topic[] }>(`/topics?parent=${topic}&status=active`)
      .then((r) => setSubtopics(r.topics))
      .catch(() => setSubtopics([]))
  }, [topic])

  const parser = useMemo(() => status?.parsers.find((p) => p.kind === kind) ?? null, [status, kind])
  const limit = status?.limits.maxFileBytes[kind] ?? 0
  const chosen = useMemo(() => (batch ?? []).filter((q) => selected.includes(q.clientId)), [batch, selected])

  const verdictFor = useCallback(
    (clientId: string): ImportVerdict | null => checked?.byId.get(clientId) ?? null,
    [checked],
  )

  // -------------------------------------------------------------------------
  // Choosing files
  // -------------------------------------------------------------------------

  async function onFilesChosen(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    if (picked.length === 0) return

    setError(null)
    const maxFiles = status?.limits.maxFiles ?? 20

    try {
      const encoded: ChosenFile[] = []
      for (const file of picked.slice(0, maxFiles)) {
        // Checked here as well as on the server so an examiner is told before spending a minute
        // encoding a 30 MB photograph. The server's limit is the one that counts.
        if (limit > 0 && file.size > limit) {
          throw new Error(`${file.name} is ${formatBytes(file.size)}, over the ${formatBytes(limit)} limit.`)
        }
        encoded.push({ name: file.name, content: await readAsDataUrl(file), size: file.size })
      }
      setFiles(encoded)
      if (picked.length > maxFiles) {
        setError(`Only the first ${maxFiles} files were taken — that is the most one import may carry.`)
      }
    } catch (err) {
      setFiles([])
      setError(err instanceof Error ? err.message : 'Those files could not be read.')
    }
  }

  function switchKind(next: ImportFileKind) {
    setKind(next)
    setFiles([])
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!topic || files.length === 0) return

    setBusy('upload')
    setError(null)
    setSaved(null)
    setChecked(null)

    try {
      const result = await api.post<ImportPreview>(`/admin/questions/import/${kind}`, {
        topic,
        subtopic: subtopic || null,
        classLevel,
        difficulty,
        questionType: questionType || null,
        marks,
        negativeMarks,
        files: files.map((f) => ({ name: f.name, content: f.content })),
      })

      setPreview(result)
      setBatch(result.questions.map((q) => ({ ...q, edited: false })))
      // Everything that passed the screener starts ticked: the common case is "these are fine,
      // save them", and an examiner who has to tick two hundred boxes will stop reading them.
      setSelected(result.questions.map((q) => q.clientId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That upload could not be read.')
      setPreview(null)
      setBatch(null)
    } finally {
      setBusy(null)
    }
  }

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  function patch(clientId: string, changes: Partial<EditableQuestion>) {
    setBatch((current) =>
      (current ?? []).map((q) => (q.clientId === clientId ? { ...q, ...changes, edited: true } : q)),
    )
    // Any edit invalidates the last dry run: its verdicts describe text that has changed.
    setChecked(null)
  }

  function discard(clientId: string) {
    setBatch((current) => (current ?? []).filter((q) => q.clientId !== clientId))
    setSelected((ids) => ids.filter((id) => id !== clientId))
    setChecked(null)
  }

  function discardAll() {
    setBatch(null)
    setPreview(null)
    setSelected([])
    setChecked(null)
    setSaved(null)
  }

  // -------------------------------------------------------------------------
  // The dry run
  // -------------------------------------------------------------------------

  /** Asks whether the ticked questions would save, using the same code approval uses. */
  async function check() {
    if (chosen.length === 0) return
    setBusy('check')
    setError(null)
    try {
      // The set sent is captured here, so the verdicts can be pinned to the questions they were
      // actually about rather than to whatever is ticked by the time they are rendered.
      const sent = chosen
      const result = await api.post<ImportValidation>('/admin/questions/import/validate', {
        questions: sent.map(payloadOf),
      })
      setChecked({
        byId: new Map(result.verdicts.map((verdict, position) => [sent[position]!.clientId, verdict])),
        wouldSave: result.wouldSave,
        of: sent.length,
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check those questions.')
    } finally {
      setBusy(null)
    }
  }

  // -------------------------------------------------------------------------
  // Approve and reject
  // -------------------------------------------------------------------------

  async function approve(publish: boolean) {
    if (!preview || chosen.length === 0) return
    setBusy('approve')
    setError(null)

    try {
      const result = await api.post<ApproveResponse>('/admin/questions/import/approve', {
        batchId: preview.batchId,
        publish,
        questions: chosen.map(payloadOf),
      })

      const kept = result.questions.length
      const publishedCount = result.published ?? 0
      const publishFailures = result.publishFailures ?? []

      /**
       * Saving and publishing are two outcomes, and conflating them would hide the common case:
       * a question with no solution **saves as a draft and cannot be published** (the editorial
       * bar is "a published question must be explainable to a student"). Reporting "published
       * them" when three of five actually stayed as drafts would be a lie the examiner only
       * discovers when a student never sees the question.
       */
      const headline =
        kept === 0
          ? 'Nothing was saved.'
          : publish
            ? publishedCount === kept
              ? `Saved and published ${kept} question${kept === 1 ? '' : 's'}.`
              : `Saved ${kept} question${kept === 1 ? '' : 's'}; ${publishedCount} of them published.`
            : `Saved ${kept} question${kept === 1 ? '' : 's'} as draft${kept === 1 ? '' : 's'}.`

      setSaved({
        message: headline,
        rejected: result.rejected ?? [],
        publishFailures,
      })

      /**
       * Only the questions that really saved leave the screen.
       *
       * Anything the server refused **stays**, still ticked, with its reason shown above — so the
       * examiner corrects it rather than having to find it again in the original file. `rejected`
       * is positional over what was sent, which is why the ids are resolved against `chosen`
       * rather than against the whole batch.
       */
      const refusedIds = (result.rejected ?? [])
        .map((entry) => chosen[entry.index - 1]?.clientId)
        .filter((id): id is string => Boolean(id))

      setBatch((current) =>
        (current ?? []).filter((q) => !selected.includes(q.clientId) || refusedIds.includes(q.clientId)),
      )
      setSelected(refusedIds)
      setChecked(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Those questions could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Records that the examiner threw the rest away.
   *
   * Nothing was stored, so this is genuinely just not approving — but the count is the one honest
   * measure of whether a template or a batch of photographs is producing usable questions, and it
   * is invisible everywhere else.
   */
  async function rejectRest() {
    if (!preview || !batch || batch.length === 0) return
    const count = batch.length
    try {
      await api.post('/admin/questions/import/reject', { batchId: preview.batchId, count })
    } catch {
      // Best-effort: a counter that will not update must not stop the examiner discarding.
    }
    discardAll()
  }

  // -------------------------------------------------------------------------
  // The template, and the error report
  // -------------------------------------------------------------------------

  /**
   * Downloads the generated `.xlsx` template.
   *
   * Fetched rather than linked, because the route needs the session cookie and returns the file
   * itself rather than the usual `{ success }` envelope — so it cannot go through `api.get`.
   */
  async function downloadTemplate() {
    setBusy('template')
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/admin/questions/import/excel/template`, { credentials: 'include' })
      if (!res.ok) throw new Error('The template could not be built.')
      triggerDownload(await res.blob(), 'amit-question-import-template.xlsx')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The template could not be downloaded.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * A CSV of everything that did not become a question.
   *
   * Built in the browser from the preview we already have rather than asking the server for it: the
   * data is here, and an examiner fixing a two-hundred-row spreadsheet wants it beside the file. It
   * is the spec's "downloadable error report where practical", and this is where it is practical.
   */
  function downloadErrors() {
    if (!preview) return
    const rows: Array<[string, string, string]> = [
      ['Where', 'Problem', 'Kind'],
      ...preview.failures.map((f): [string, string, string] => [f.sourceRef, f.reason, 'Could not be read']),
      ...preview.rejected.map((r): [string, string, string] => [`#${r.index}`, r.reason, 'Invalid question']),
      ...preview.duplicates.map((d): [string, string, string] => [`#${d.index}`, d.reason, 'Duplicate']),
      ...preview.files
        .filter((f) => f.error)
        .map((f): [string, string, string] => [f.name, f.error ?? '', 'File could not be read']),
    ]
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
    // A BOM so Excel opens it as UTF-8 rather than mangling any LaTeX or non-ASCII text.
    triggerDownload(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'import-problems.csv')
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const problemCount =
    (preview?.failures.length ?? 0) + (preview?.rejected.length ?? 0) + (preview?.duplicates.length ?? 0)
  const ready = Boolean(topic) && files.length > 0 && parser?.available === true

  return (
    <AdminShell title="Bulk import">
      <div className={styles.page}>
        {error && (
          <div className={`card ${styles.errorBox}`} role="alert">
            <i className="ph-bold ph-warning-circle" /> {error}
          </div>
        )}

        {/* ----------------------------------------------------------------
            Choose a format
        ---------------------------------------------------------------- */}
        <div className={`card ${styles.formats}`}>
          <h3>Where are the questions coming from?</h3>
          <div className={styles.tabs} role="tablist">
            {IMPORT_FILE_KINDS.map((option) => {
              const info = status?.parsers.find((p) => p.kind === option)
              return (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={kind === option}
                  className={styles.tab}
                  data-active={kind === option}
                  disabled={busy !== null}
                  onClick={() => switchKind(option)}
                >
                  <i className={`ph-bold ${KIND_ICONS[option]}`} />
                  <span>{KIND_LABELS[option]}</span>
                  {info && !info.available && <em className={styles.offTag}>unavailable</em>}
                </button>
              )
            })}
          </div>

          {parser && (
            <>
              {/* Printed verbatim. `extraction` is a statement of fact, not a label. */}
              <p className={styles.basis}>{parser.basis}</p>
              {parser.extraction === 'model' && (
                <p className={styles.modelTag}>
                  <i className="ph-bold ph-sparkle" /> This format is read by a language model. The other two are not.
                </p>
              )}
              {!parser.available && (
                <p className={styles.offNotice}>
                  <i className="ph-bold ph-plugs" /> Not available in this deployment. Photograph import needs{' '}
                  <code>GEMINI_API_KEY</code> set in the backend environment — the other formats work without it.
                </p>
              )}
            </>
          )}

          {kind === 'excel' && (
            <p className={styles.templateRow}>
              <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => void downloadTemplate()}>
                <i className="ph-bold ph-download-simple" /> {busy === 'template' ? 'Building…' : 'Download the Excel template'}
              </button>
              <span className={styles.hint}>
                Column order and heading capitalisation do not matter. The template explains every column.
              </span>
            </p>
          )}

          {kind === 'docx' && (
            <ul className={styles.conventions}>
              <li>Number each question — <code>Q1.</code>, <code>1.</code> or <code>Question 1:</code></li>
              <li>One option per line — <code>(a)</code>, <code>(b)</code>, <code>(c)</code></li>
              <li>Give the answer on its own line — <code>Answer: B</code></li>
              <li>Optionally add <code>Solution:</code>, <code>Class: 8</code>, <code>Topic: Algebra</code></li>
              <li>
                Type mathematics as <code>$…$</code>. Equations made with Word&rsquo;s equation editor cannot be read.
              </li>
            </ul>
          )}

          {kind === 'image' && (
            <ul className={styles.conventions}>
              <li>Photograph the page straight on, in focus, one page per image</li>
              <li>
                <strong>Include the answer key</strong> — a question with no printed answer cannot be imported
              </li>
              <li>Questions needing a diagram cannot be imported: the bank stores text and LaTeX only</li>
              <li>Each image is a separate model call, so ten photographs cost ten calls</li>
            </ul>
          )}
        </div>

        {/* ----------------------------------------------------------------
            Upload
        ---------------------------------------------------------------- */}
        <form className={`card ${styles.uploadCard}`} onSubmit={(e) => void upload(e)}>
          <h3>What should these questions be filed under?</h3>
          <p className={styles.hint}>
            Used for anything the file does not say itself. A spreadsheet or Word file that names its own class or
            chapter overrides these per question — and a value it names that does not exist is reported rather than
            quietly replaced.
          </p>

          <div className={styles.grid}>
            <div className="form-group">
              <label htmlFor="imp-topic">Chapter *</label>
              <select
                id="imp-topic"
                className="form-control"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              >
                <option value="">Choose a chapter</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {topics.length === 0 && (
                <p className={styles.hint}>
                  No chapters yet — <Link to="/admin/taxonomy">create one</Link> first.
                </p>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="imp-subtopic">Subtopic</label>
              <select
                id="imp-subtopic"
                className="form-control"
                value={subtopic}
                onChange={(e) => setSubtopic(e.target.value)}
                disabled={subtopics.length === 0}
              >
                <option value="">None</option>
                {subtopics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="imp-class">Class *</label>
              <select
                id="imp-class"
                className="form-control"
                value={classLevel}
                onChange={(e) => setClassLevel(e.target.value as ClassLevel)}
              >
                {CLASS_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="imp-difficulty">Difficulty</label>
              <select
                id="imp-difficulty"
                className="form-control"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              >
                {DIFFICULTIES.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="imp-type">Question type</label>
              <select
                id="imp-type"
                className="form-control"
                value={questionType}
                onChange={(e) => setQuestionType(e.target.value as QuestionType | '')}
              >
                <option value="">Work it out from each question</option>
                {QUESTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {QUESTION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="imp-marks">Marks</label>
              <input
                id="imp-marks"
                className="form-control"
                type="number"
                min={0.25}
                max={100}
                step={0.25}
                value={marks}
                onChange={(e) => setMarks(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label htmlFor="imp-negative">Negative marks</label>
              <input
                id="imp-negative"
                className="form-control"
                type="number"
                min={0}
                max={100}
                step={0.25}
                value={negativeMarks}
                onChange={(e) => setNegativeMarks(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="imp-files">
              {kind === 'image' ? 'Images' : `File`} * <span className={styles.hint}>({KIND_ACCEPT[kind]})</span>
            </label>
            <input
              id="imp-files"
              ref={fileInput}
              className="form-control"
              type="file"
              accept={KIND_ACCEPT[kind]}
              multiple={kind === 'image'}
              onChange={(e) => void onFilesChosen(e)}
            />
            {limit > 0 && (
              <p className={styles.hint}>
                Up to {formatBytes(limit)} each, {status?.limits.maxFiles} files, {status?.limits.maxQuestions} questions
                per import.
              </p>
            )}
            {files.length > 0 && (
              <ul className={styles.fileList}>
                {files.map((f) => (
                  <li key={f.name}>
                    <i className={`ph-bold ${KIND_ICONS[kind]}`} /> {f.name}{' '}
                    <span className={styles.hint}>{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button type="submit" disabled={!ready || busy !== null}>
            {busy === 'upload' ? 'Reading…' : 'Read the questions'}
          </Button>
          <p className={styles.hint}>
            <strong>Nothing is saved by this.</strong> You will see everything that was read, everything that could not
            be, and why — and you approve them afterwards.
          </p>
        </form>

        {/* ----------------------------------------------------------------
            What came back
        ---------------------------------------------------------------- */}
        {preview && (
          <div className={`card ${styles.counts}`}>
            <h3>What was read</h3>
            <div className={styles.countGrid}>
              <Count label="Examined" value={preview.examined} />
              <Count label="Usable" value={batch?.length ?? 0} tone="good" />
              <Count label="Invalid" value={preview.rejected.length} tone={preview.rejected.length ? 'bad' : undefined} />
              <Count
                label="Duplicates"
                value={preview.duplicates.length}
                tone={preview.duplicates.length ? 'warn' : undefined}
              />
              <Count
                label="Unreadable"
                value={preview.failures.length}
                tone={preview.failures.length ? 'bad' : undefined}
              />
            </div>

            {preview.truncated && (
              <p className={styles.truncated}>
                <i className="ph-bold ph-scissors" /> This import hit its limit of {status?.limits.maxQuestions}{' '}
                questions, so the rest of the upload was not read. Split the file and import the remainder separately.
              </p>
            )}

            {preview.files.length > 1 && (
              <table className={styles.fileTable}>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Examined</th>
                    <th>Read</th>
                    <th>Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.files.map((f) => (
                    <tr key={f.name} data-failed={Boolean(f.error)}>
                      <td>{f.name}</td>
                      <td>{f.examined}</td>
                      <td>{f.extracted}</td>
                      <td>{f.error ? <span className={styles.fileError}>{f.error}</span> : f.failed || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {problemCount > 0 && (
              <button type="button" className={styles.secondary} onClick={downloadErrors}>
                <i className="ph-bold ph-download-simple" /> Download the problem list ({problemCount})
              </button>
            )}
          </div>
        )}

        {/* ----------------------------------------------------------------
            Findings about the whole batch
        ---------------------------------------------------------------- */}
        {preview && preview.batchWarnings.length > 0 && (
          <div className={`card ${styles.warnBox}`}>
            <h3>
              <i className="ph-bold ph-warning-circle" /> Read this before approving
            </h3>
            <ul>
              {preview.batchWarnings.map((warning) => (
                <li key={warning.code + warning.message.slice(0, 24)}>{warning.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ----------------------------------------------------------------
            Everything that did not become a question
        ---------------------------------------------------------------- */}
        {preview && problemCount > 0 && (
          <details className={`card ${styles.problems}`} open={(batch?.length ?? 0) === 0}>
            <summary>
              {problemCount} item{problemCount === 1 ? '' : 's'} did not become a question
            </summary>
            {preview.failures.length > 0 && (
              <>
                <h4>Could not be read</h4>
                <ul>
                  {preview.failures.map((f, i) => (
                    <li key={`f${i}`}>
                      <strong>{f.sourceRef}</strong> {f.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {preview.rejected.length > 0 && (
              <>
                <h4>Read, but not a valid question</h4>
                <ul>
                  {preview.rejected.map((r) => (
                    <li key={`r${r.index}`}>
                      <strong>#{r.index}</strong> {r.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {preview.duplicates.length > 0 && (
              <>
                <h4>Already in the bank, or repeated in this upload</h4>
                <ul>
                  {preview.duplicates.map((d) => (
                    <li key={`d${d.index}`}>
                      <strong>#{d.index}</strong> {d.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className={styles.hint}>
              Nothing was corrected automatically. A repaired answer key that looks right is worse than a missing
              question.
            </p>
          </details>
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
                  <strong>Nothing is saved yet.</strong> These exist only on this screen — leaving the page discards
                  them. Imported questions are saved as <strong>drafts</strong>; publishing is a separate step.
                </p>
                <div className={styles.selectRow}>
                  <span>
                    <strong>{chosen.length}</strong> of {batch.length} ticked
                  </span>
                  <button type="button" className={styles.linkAction} onClick={() => setSelected(batch.map((q) => q.clientId))}>
                    Select all
                  </button>
                  <button type="button" className={styles.linkAction} onClick={() => setSelected([])}>
                    Select none
                  </button>
                </div>
                {/* Reported against the set that was actually checked, not against what is ticked
                    now — those can differ, and quoting the current count would be a lie. */}
                {checked && (
                  <p className={checked.wouldSave === checked.of ? styles.checkOk : styles.checkBad}>
                    {checked.wouldSave === checked.of
                      ? `Checked: all ${checked.of} would save.`
                      : `Checked: ${checked.wouldSave} of ${checked.of} would save. The rest are marked below with the rule they break.`}
                  </p>
                )}
              </div>
              <div className={styles.reviewActions}>
                {/* Writes nothing and spends no quota, so it may be pressed freely. */}
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
                <button type="button" className={styles.danger} disabled={busy !== null} onClick={() => void rejectRest()}>
                  Discard all
                </button>
              </div>
            </div>

            {batch.map((question, index) => (
              <ImportCard
                key={question.clientId}
                index={index + 1}
                question={question}
                topics={topics}
                disabled={busy !== null}
                picked={selected.includes(question.clientId)}
                verdict={verdictFor(question.clientId)}
                onPick={(next) =>
                  setSelected((ids) => (next ? [...ids, question.clientId] : ids.filter((id) => id !== question.clientId)))
                }
                onChange={(changes) => patch(question.clientId, changes)}
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
              <>
                <p>These were refused and are still on the screen so you can correct them:</p>
                <ul className={styles.rejectedList}>
                  {saved.rejected.map((entry) => (
                    <li key={entry.index}>
                      <strong>#{entry.index}</strong> {entry.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {/* Saved, but still a draft. Almost always a missing solution, which the editorial
                bar requires before a student may be graded on the question. */}
            {saved.publishFailures.length > 0 && (
              <>
                <p>
                  These saved as <strong>drafts</strong> but could not be published:
                </p>
                <ul className={styles.rejectedList}>
                  {saved.publishFailures.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
                <p className={styles.hint}>
                  Open them in the question bank, add what is missing, and publish from there.
                </p>
              </>
            )}
            <p>
              <Link to="/admin/questions?source=excel_import">Open the question bank →</Link>
            </p>
          </div>
        )}
      </div>
    </AdminShell>
  )
}

/** What the approve and validate endpoints take. Built once so the two cannot drift. */
function payloadOf(question: EditableQuestion) {
  return {
    questionText: question.questionText,
    type: question.type,
    options: question.options,
    booleanAnswer: question.booleanAnswer,
    numericAnswer: question.numericAnswer,
    tolerance: question.tolerance,
    acceptedAnswers: question.acceptedAnswers,
    solution: question.solution,
    marks: question.marks,
    negativeMarks: question.negativeMarks,
    tags: question.tags,
    topic: question.topic,
    subtopic: question.subtopic,
    classLevel: question.classLevel,
    difficulty: question.difficulty,
    edited: question.edited,
  }
}

interface ImportRejectionView {
  index: number
  reason: string
}

/**
 * What the approval endpoint really answers with.
 *
 * There is no `created` count — the first version of this page assumed one and printed "Saved
 * undefined questions", which is why this shape is written out rather than guessed at. `published`
 * and `publishFailures` are separate from `questions` because saving and publishing are separate
 * outcomes: a question with no solution saves as a draft and is refused publication.
 */
interface ApproveResponse {
  questions: Array<{ id: string; questionText: string; status: string }>
  rejected: ImportRejectionView[]
  published?: number
  publishFailures?: string[]
}

function Count({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={styles.count} data-tone={tone}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function csvCell(value: string): string {
  // Quote everything and double any internal quote: a reason legitimately contains commas.
  return `"${value.replace(/"/g, '""')}"`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// One candidate
// ---------------------------------------------------------------------------

/**
 * One imported question, editable in place.
 *
 * Plain controlled inputs rather than a rich editor, for the reason the AI generator's card gives:
 * these are the same fields the question editor already exposes, and a second editing surface with
 * its own quirks would be a second thing to keep correct.
 *
 * The one thing this card has that the generator's does not is **placement** — class, chapter and
 * difficulty per question — because a spreadsheet legitimately files row 3 and row 40 under
 * different chapters, and the reviewer has to be able to correct a row the file got wrong.
 */
function ImportCard({
  index,
  question,
  topics,
  disabled,
  picked,
  verdict,
  onPick,
  onChange,
  onDelete,
}: {
  index: number
  question: EditableQuestion
  topics: Topic[]
  disabled: boolean
  picked: boolean
  verdict: ImportVerdict | null
  onPick: (next: boolean) => void
  onChange: (changes: Partial<EditableQuestion>) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const takesOptions = question.type === 'single_choice' || question.type === 'multiple_choice'
  // The check's warnings describe the text as checked; the parser's describe it as read. Prefer
  // the newer of the two.
  const warnings: ImportWarning[] = verdict ? verdict.warnings : question.warnings

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
        {/* Where it came from in the upload, so it can be found in the original. */}
        <span className={styles.source} title="Where this came from in your upload">
          {question.sourceRef}
        </span>
        <span className={styles.qType}>{QUESTION_TYPE_LABELS[question.type]}</span>
        {question.edited && <span className={styles.editedTag}>edited</span>}
        <span className={styles.qMarks}>
          {question.marks} mark{question.marks === 1 ? '' : 's'}
        </span>
      </div>

      {verdict?.ok === false && verdict.reason && (
        <p className={styles.refusedLine}>
          <i className="ph-bold ph-x-circle" /> Would not save: {verdict.reason}
        </p>
      )}

      {/*
        Advisory only. A card can carry these and still be exactly right — nothing here has checked
        the mathematics, which is what the reviewer is for.
      */}
      {warnings.length > 0 && (
        <ul className={styles.warnList}>
          {warnings.map((warning, i) => (
            <li key={`${warning.code}${i}`}>
              <i className="ph-bold ph-warning" /> {warning.message}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <textarea
          className="form-control"
          rows={3}
          value={question.questionText}
          onChange={(e) => onChange({ questionText: e.target.value })}
        />
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
          Answer:{' '}
          {open ? (
            <input
              className="form-control"
              type="number"
              value={question.numericAnswer ?? ''}
              onChange={(e) => onChange({ numericAnswer: e.target.value === '' ? null : Number(e.target.value) })}
            />
          ) : (
            <strong>{question.numericAnswer}</strong>
          )}
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
              onChange={(e) =>
                onChange({ acceptedAnswers: e.target.value.split('|').map((v) => v.trim()).filter(Boolean) })
              }
            />
          ) : (
            <strong>{question.acceptedAnswers.join(' · ')}</strong>
          )}
          {open && <span className={styles.hint}>Separate alternatives with a vertical bar.</span>}
        </p>
      )}

      <details className={styles.solution} open={open}>
        <summary>Solution {question.solution ? '' : '(none — needed before publishing)'}</summary>
        {open ? (
          <textarea
            className="form-control"
            rows={3}
            value={question.solution ?? ''}
            onChange={(e) => onChange({ solution: e.target.value || null })}
          />
        ) : question.solution ? (
          <MathText>{question.solution}</MathText>
        ) : (
          <p className={styles.hint}>No solution was found in the file.</p>
        )}
      </details>

      {/* Placement — per question, because a file may file its rows differently. */}
      <div className={styles.placement}>
        <label>
          <span>Class</span>
          <select
            className="form-control"
            value={question.classLevel}
            disabled={disabled}
            onChange={(e) => onChange({ classLevel: e.target.value as ClassLevel })}
          >
            {CLASS_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Chapter</span>
          <select
            className="form-control"
            value={question.topic}
            disabled={disabled}
            onChange={(e) => {
              const next = topics.find((t) => t.id === e.target.value)
              // The subtopic belonged to the old chapter, so it cannot survive the change.
              onChange({ topic: e.target.value, topicName: next?.name ?? '', subtopic: null })
            }}
          >
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Difficulty</span>
          <select
            className="form-control"
            value={question.difficulty}
            disabled={disabled}
            onChange={(e) => onChange({ difficulty: e.target.value as Difficulty })}
          >
            {DIFFICULTIES.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select
            className="form-control"
            value={question.type}
            disabled={disabled}
            onChange={(e) => onChange({ type: e.target.value as QuestionType })}
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {QUESTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.qActions}>
        <button type="button" className={styles.secondary} onClick={() => setOpen((v) => !v)}>
          {open ? 'Done editing' : 'Edit'}
        </button>
        <button type="button" className={styles.danger} disabled={disabled} onClick={onDelete}>
          Remove
        </button>
      </div>
    </div>
  )
}
