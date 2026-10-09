import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AdminShell from './AdminShell'
import Button from '../../components/Button'
import MathText from '../../components/MathText'
import QuestionPicture from '../../components/QuestionPicture'
import QuestionPictureField from '../../components/QuestionPictureField'
import { api, API_BASE } from '../../api/client'
import { loadChapters } from '../../api/implicitSubject'
import { uploadQuestionPicture } from '../../api/questionImages'
import { ACCEPTED_PICTURE_TYPES, PICTURE_ACCEPT_ATTRIBUTE } from '../../lib/shrinkPicture'
import {
  CLASS_LEVELS,
  DIFFICULTIES,
  type ClassLevel,
  type Difficulty,
  type ImportFileKind,
  type ImportParserInfo,
  type ImportPreview,
  type ImportStatus,
  type ImportValidation,
  type ImportVerdict,
  type ImportWarning,
  type ImportedQuestion,
  type QuestionType,
} from '../../api/types'
import { Alert, Icon, Steps, Table, TableScroll } from '../../components/ui'
import styles from './QuestionImport.module.css'
import { humanizeError } from '../../lib/errors'

/**
 * Uploading questions (Milestone 21, Phase F; made simple on 2026-10-09).
 *
 * ## The form is the owner's
 *
 * "Remove the part where he/she has to choose the chapters. Just … the type of file being uploaded
 * (word docx, excel, csv, json, photo), … classes from 3 to 12, … the type of question …, an
 * optional field to write the topic, … options accordingly based on the type of question chosen,
 * and then submit … it should reflect in the respective chosen class." So the page asks for exactly
 * that, in that order, and the server holds the rest: the **class** and the **type** chosen here are
 * every question's (a file that says otherwise is noted on the question, or reported if its type
 * disagrees), and the **topic is a name** — typed here, else the file's own, else General — which
 * becomes a chapter when the questions are saved. There is no chapter to choose and none to create
 * first. Difficulty and marks are under "More settings", with the defaults most uploads want.
 *
 * ## The safety property it has to preserve
 *
 * **Uploading writes nothing, and only saving writes.** The candidates on this screen live *here* —
 * there is no staging collection on purpose, so the question bank cannot fill with machine-read
 * text nobody looked at. Leaving the page discards them, and the page says so rather than letting
 * an examiner assume their work is safe.
 *
 * ## Why it is one page and not five
 *
 * A choice of format, but **one review screen** underneath. Every format becomes the same candidate
 * shape, so a spreadsheet row, a Word paragraph and a photographed question are edited, checked and
 * saved by identical code here. Five review screens would be five places for the save payload to
 * drift out of step with the backend.
 *
 * ## Photos are the question (Milestone 30 Phase 7b)
 *
 * Nothing reads a photo (owner: "i don't want ocr as of now" — PLAN.md Q19). Each is shrunk and
 * uploaded on its own (`api/questionImages.ts`), and its card asks for what the chosen type needs:
 * options and the right ones, true or false, or the answers accepted — plus a one-line description
 * for a student who cannot see it, and a worked solution, written or as a second photo.
 *
 * ## What is deliberately not hidden
 *
 * Failures, duplicates, rejected rows, per-file outcomes and the batch warnings all get their own
 * visible section. The spec's rule is "do not silently skip invalid rows", and the honest reading of
 * it is that an examiner should see, without clicking anything, how many questions their file *did
 * not* produce and why.
 */

/**
 * The three stages, and the honest naming of the middle one: a read file has been *read*, not
 * saved. Nothing here is a link — you reach the next stage by doing the work.
 */
const IMPORT_STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'review', label: 'Review' },
  { id: 'saved', label: 'Saved' },
]

// ---------------------------------------------------------------------------
// Local shapes
// ---------------------------------------------------------------------------

/** A candidate plus the one fact only this screen knows: whether it was edited here. */
interface EditableQuestion extends ImportedQuestion {
  edited: boolean
}

type Busy = 'upload' | 'check' | 'approve' | 'template' | null

/** The formats, in the owner's order. */
const KIND_ORDER: ImportFileKind[] = ['docx', 'excel', 'csv', 'json', 'image']

const KIND_LABELS: Record<ImportFileKind, string> = {
  docx: 'Word',
  excel: 'Excel',
  csv: 'CSV',
  json: 'JSON',
  image: 'Photo',
}

/** Where a saved batch is listed in the question bank, by the provenance saving stamps on it. */
const SOURCE_FOR_KIND: Record<ImportFileKind | 'picture', string> = {
  excel: 'excel_import',
  docx: 'docx_import',
  image: 'image_import',
  csv: 'csv_import',
  json: 'json_import',
  picture: 'picture_import',
}

const KIND_ACCEPT: Record<ImportFileKind, string> = {
  excel: '.xlsx',
  docx: '.docx',
  image: '.jpg,.jpeg,.png,.webp',
  csv: '.csv',
  json: '.json',
}

const KIND_ICONS: Record<ImportFileKind, string> = {
  excel: 'ph-file-xls',
  docx: 'ph-file-doc',
  image: 'ph-image',
  csv: 'ph-file-csv',
  json: 'ph-brackets-curly',
}

/**
 * The four types the owner named, in their order. "MCQ" is the one with several right options
 * here — the owner lists it beside "single correct" — and the label says so, because in a file a
 * bare "MCQ" has long meant one right option.
 */
const UPLOAD_TYPES: Array<{ value: QuestionType; label: string; inFile: string; inWord: string }> = [
  {
    value: 'multiple_choice',
    label: 'MCQ — more than one correct option',
    inFile: 'every right option’s letter, such as A, C',
    inWord: 'Answer: A, C',
  },
  {
    value: 'single_choice',
    label: 'Single correct — exactly one correct option',
    inFile: 'the right option’s letter, such as B',
    inWord: 'Answer: B',
  },
  {
    value: 'fill_blank',
    label: 'Fill in the blank',
    inFile: 'every answer you accept, separated by |, such as 5050 | five thousand and fifty',
    inWord: 'Answer: 5050 | five thousand and fifty',
  },
  {
    value: 'true_false',
    label: 'True or false',
    inFile: 'TRUE or FALSE',
    inWord: 'Answer: True',
  },
]

/** How a question's type is named on its card — the form's words, so the two agree. */
const TYPE_NAMES: Record<QuestionType, string> = {
  multiple_choice: 'MCQ (more than one correct)',
  single_choice: 'Single correct',
  fill_blank: 'Fill in the blank',
  true_false: 'True or false',
  numeric: 'Numeric answer',
}

/** A choice question's photo starts with four empty options and none marked: the examiner says which are right. */
const BLANK_OPTIONS = () => [0, 1, 2, 3].map(() => ({ text: '', isCorrect: false }))

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

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export default function QuestionImport() {
  const [status, setStatus] = useState<ImportStatus | null>(null)

  // --- The form, in the owner's order ---
  const [kind, setKind] = useState<ImportFileKind>('docx')
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 9')
  const [questionType, setQuestionType] = useState<QuestionType | ''>('')
  const [topicName, setTopicName] = useState('')
  /** The chapters that exist, offered as suggestions for the topic — never required. */
  const [chapterNames, setChapterNames] = useState<string[]>([])
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium')
  const [marks, setMarks] = useState(4)
  const [negativeMarks, setNegativeMarks] = useState(1)
  const [files, setFiles] = useState<ChosenFile[]>([])
  /** The photos: kept as files, shrunk and uploaded one by one when the upload starts. */
  const [pictures, setPictures] = useState<File[]>([])
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // --- The review ---
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  /** The class the batch on screen was uploaded for: every question in it went there. */
  const [batchClass, setBatchClass] = useState<ClassLevel | null>(null)
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
    classLevel: ClassLevel | null
    source: string
    chapters: string[]
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
      .catch((err) => setError(humanizeError(err, { fallback: 'Could not load the importer.' })))
  }, [])

  /**
   * The existing chapters, as suggestions for the topic field. Through the shared resolver of the
   * implicit subject, so the names offered are the ones the server will match the typed topic to.
   * A failure costs only the suggestions: the topic is typed either way.
   */
  useEffect(() => {
    loadChapters()
      .then((chapters) => setChapterNames(chapters.map((chapter) => chapter.name)))
      .catch(() => setChapterNames([]))
  }, [])

  /** Photos are imported as the question itself, which no parser reads (Phase 7b). */
  const picturesMode = kind === 'image'
  const parser = useMemo((): ImportParserInfo | null => {
    if (picturesMode) return status?.pictures ? { ...status.pictures, kind: 'image', available: true } : null
    return status?.parsers.find((p) => p.kind === kind) ?? null
  }, [status, kind, picturesMode])
  const limit = status?.limits.maxFileBytes[kind] ?? 0
  const maxPictures = status?.limits.maxPictures ?? 20
  const chosen = useMemo(() => (batch ?? []).filter((q) => selected.includes(q.clientId)), [batch, selected])
  const typeInfo = UPLOAD_TYPES.find((entry) => entry.value === questionType) ?? null

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

    if (picturesMode) {
      const usable = picked.filter((file) => ACCEPTED_PICTURE_TYPES.includes(file.type))
      setPictures(usable.slice(0, maxPictures))
      const skipped = picked.length - usable.length
      if (skipped > 0) {
        setError(`${skipped} file${skipped === 1 ? ' was' : 's were'} not a JPEG, PNG or WebP photo and ${skipped === 1 ? 'was' : 'were'} left out.`)
      } else if (usable.length > maxPictures) {
        setError(`Only the first ${maxPictures} photos were taken — that is the most one upload may carry.`)
      }
      return
    }

    const maxFiles = status?.limits.maxFiles ?? 20

    try {
      const encoded: ChosenFile[] = []
      for (const file of picked.slice(0, maxFiles)) {
        // Checked here as well as on the server so an examiner is told before spending a minute
        // encoding a 30 MB file. The server's limit is the one that counts.
        if (limit > 0 && file.size > limit) {
          throw new Error(`${file.name} is ${formatBytes(file.size)}, over the ${formatBytes(limit)} limit.`)
        }
        encoded.push({ name: file.name, content: await readAsDataUrl(file), size: file.size })
      }
      setFiles(encoded)
      if (picked.length > maxFiles) {
        setError(`Only the first ${maxFiles} files were taken — that is the most one upload may carry.`)
      }
    } catch (err) {
      setFiles([])
      setError(err instanceof Error ? err.message : 'Those files could not be read.')
    }
  }

  function switchKind(next: ImportFileKind) {
    setKind(next)
    setFiles([])
    setPictures([])
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (picturesMode) await runPictureUpload()
    else await runUpload()
  }

  /** The upload's form, as the server takes it: the class, the type and the topic are every question's. */
  function formFields() {
    return {
      classLevel,
      questionType: questionType || null,
      topicName: topicName.trim() || null,
      difficulty,
      marks,
      negativeMarks,
    }
  }

  async function runUpload() {
    if (files.length === 0 || !questionType) return

    setBusy('upload')
    setError(null)
    setSaved(null)
    setChecked(null)

    try {
      const result = await api.post<ImportPreview>(`/admin/questions/import/${kind}`, {
        ...formFields(),
        files: files.map((f) => ({ name: f.name, content: f.content })),
      })

      setPreview(result)
      setBatchClass(classLevel)
      setBatch(result.questions.map((q) => ({ ...q, edited: false })))
      // Everything that passed the screener starts ticked: the common case is "these are fine,
      // save them", and an examiner who has to tick two hundred boxes will stop reading them.
      setSelected(result.questions.map((q) => q.clientId))
    } catch (err) {
      setError(humanizeError(err, { fallback: 'That upload could not be read.' }))
      setPreview(null)
      setBatch(null)
    } finally {
      setBusy(null)
    }
  }

  /**
   * Photos: every one shrunk and stored one by one, then made a candidate of the chosen type.
   *
   * One at a time, so a slow connection shows its progress and one photo that fails is reported by
   * name while the rest go on. Storing a photo writes no question; the candidates exist only on this
   * screen until they are saved, like every other format's.
   */
  async function runPictureUpload() {
    if (pictures.length === 0 || !questionType) return

    setBusy('upload')
    setError(null)
    setSaved(null)
    setChecked(null)
    const stored: Array<{ key: string; name: string }> = []
    const failed: Array<{ sourceRef: string; reason: string }> = []
    try {
      for (const [index, file] of pictures.entries()) {
        setProgress({ done: index, of: pictures.length })
        const result = await uploadQuestionPicture(file)
        if ('error' in result) failed.push({ sourceRef: file.name, reason: result.error })
        else stored.push({ key: result.image.key, name: file.name })
      }
      setProgress(null)
      if (stored.length === 0) {
        setError(failed.map((failure) => failure.reason).join(' '))
        return
      }

      const result = await api.post<ImportPreview>('/admin/questions/import/pictures', {
        ...formFields(),
        pictures: stored,
      })
      const takesOptions = questionType === 'single_choice' || questionType === 'multiple_choice'
      const questions = result.questions.map((q) => ({
        ...q,
        options: takesOptions && q.options.length === 0 ? BLANK_OPTIONS() : q.options,
        edited: false,
      }))
      // A photo that could not be uploaded is listed with the files that could not be read.
      setPreview({ ...result, examined: result.examined + failed.length, failures: [...result.failures, ...failed] })
      setBatchClass(classLevel)
      setBatch(questions)
      setSelected(questions.map((q) => q.clientId))
    } catch (err) {
      setError(humanizeError(err, { fallback: 'Those photos could not be prepared.' }))
      setPreview(null)
      setBatch(null)
    } finally {
      setProgress(null)
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

  /** Asks whether the ticked questions would save, using the same code saving uses. */
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
      setError(humanizeError(err, { fallback: 'Could not check those questions.' }))
    } finally {
      setBusy(null)
    }
  }

  // -------------------------------------------------------------------------
  // Saving and discarding
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
      const where = batchClass ? ` to ${batchClass}` : ''

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
              ? `Saved ${plural(kept, 'question')}${where} and published ${kept === 1 ? 'it' : 'them'} to Practice.`
              : `Saved ${plural(kept, 'question')}${where}; ${publishedCount} of them published to Practice.`
            : `Saved ${plural(kept, 'question')}${where} as draft${kept === 1 ? '' : 's'}.`

      setSaved({
        message: headline,
        classLevel: batchClass,
        source: SOURCE_FOR_KIND[preview.kind],
        chapters: (result.chaptersCreated ?? []).map((chapter) => chapter.name),
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
      setError(humanizeError(err, { fallback: 'Those questions could not be saved.' }))
    } finally {
      setBusy(null)
    }
  }

  /**
   * Records that the examiner threw the rest away.
   *
   * Nothing was stored, so this is genuinely just not saving — but the count is the one honest
   * measure of whether a template or a batch of photos is producing usable questions, and it is
   * invisible everywhere else.
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
   * data is here, and an examiner fixing a two-hundred-row spreadsheet wants it beside the file.
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
  const ready =
    questionType !== '' && parser?.available === true && (picturesMode ? pictures.length > 0 : files.length > 0)

  /**
   * Where the examiner is, derived from what exists rather than tracked in its own state.
   * A separate stage variable is a second thing that can disagree with the screen — and
   * the distinction that matters here is precisely the one that is easy to lose: a batch
   * that has been *read* has written nothing.
   */
  const stage = saved ? 'saved' : batch && batch.length > 0 ? 'review' : 'upload'

  return (
    <AdminShell title="Bulk import">
      <div className={styles.page}>
        <Steps steps={IMPORT_STEPS} current={stage} label="Import steps" />

        {error && <Alert tone="danger">{error}</Alert>}

        {/* ----------------------------------------------------------------
            The form — the owner's five fields, in their order
        ---------------------------------------------------------------- */}
        <form className={`card ${styles.uploadCard}`} onSubmit={(e) => void upload(e)}>
          <h2>Upload questions</h2>
          <p className={styles.hint}>
            Choose what you are uploading and who it is for. <strong>Nothing is saved until you press Save</strong> at
            the end.
          </p>

          <fieldset className={styles.field}>
            <legend>1. What are you uploading?</legend>
            {/* A choice of one, so a labelled group of pressed buttons — `ui/Tabs`' filter mode —
                not the tabs pattern (Milestone 30, Phase 6): `role="tab"` promises panels,
                `aria-controls` and arrow keys, and there are none. */}
            <div className={styles.tabs} role="group" aria-label="File type">
              {KIND_ORDER.map((option) => {
                const info = status?.parsers.find((p) => p.kind === option)
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={kind === option}
                    className={styles.tab}
                    data-active={kind === option}
                    disabled={busy !== null}
                    onClick={() => switchKind(option)}
                  >
                    <Icon name={KIND_ICONS[option]} weight="bold" />
                    <span>{KIND_LABELS[option]}</span>
                    {option !== 'image' && info && !info.available && <em className={styles.offTag}>unavailable</em>}
                  </button>
                )
              })}
            </div>
            {parser && !parser.available && (
              <p className={styles.offNotice}>
                <Icon name="ph-plugs" weight="bold" /> {KIND_LABELS[kind]} files cannot be read in this deployment.
              </p>
            )}
          </fieldset>

          <div className={styles.grid}>
            <div className="form-group">
              <label htmlFor="imp-class">2. Class *</label>
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
              <p className={styles.hint}>Every question in this upload goes to this class.</p>
            </div>

            <div className="form-group">
              <label htmlFor="imp-type">3. Question type *</label>
              <select
                id="imp-type"
                className="form-control"
                value={questionType}
                onChange={(e) => setQuestionType(e.target.value as QuestionType | '')}
              >
                <option value="">Choose a type</option>
                {UPLOAD_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <p className={styles.hint}>
                {typeInfo
                  ? picturesMode
                    ? 'Each photo’s card will ask for the answer this type needs.'
                    : `In your file, the answer is ${typeInfo.inFile}.`
                  : 'Every question in this upload is this type.'}
              </p>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="imp-topic">4. Topic (optional)</label>
            <input
              id="imp-topic"
              className="form-control"
              list="imp-topic-names"
              maxLength={120}
              autoComplete="off"
              placeholder="For example, Algebra"
              value={topicName}
              onChange={(e) => setTopicName(e.target.value)}
            />
            <datalist id="imp-topic-names">
              {chapterNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </datalist>
            <p className={styles.hint}>
              {picturesMode
                ? 'Every photo goes under this topic. Leave it blank and they go under General.'
                : 'Every question goes under this topic. Leave it blank to use the topic written in your file — or General.'}{' '}
              A new topic is added when you save.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="imp-files">
              5. {picturesMode ? 'Photos' : `${KIND_LABELS[kind]} file`} *{' '}
              <span className={styles.hint}>({picturesMode ? 'JPG, PNG or WebP' : KIND_ACCEPT[kind]})</span>
            </label>
            <input
              id="imp-files"
              ref={fileInput}
              className="form-control"
              type="file"
              accept={picturesMode ? PICTURE_ACCEPT_ATTRIBUTE : KIND_ACCEPT[kind]}
              multiple={picturesMode}
              onChange={(e) => void onFilesChosen(e)}
            />
            {picturesMode ? (
              <p className={styles.hint}>
                Up to {maxPictures} photos at a time, one question each. Each is made smaller before it is uploaded, so a
                phone photo is fine.
              </p>
            ) : (
              limit > 0 && (
                <p className={styles.hint}>
                  Up to {formatBytes(limit)} each, {status?.limits.maxFiles} files, {status?.limits.maxQuestions} questions
                  per upload.
                </p>
              )
            )}
            {picturesMode && pictures.length > 0 && (
              <ul className={styles.fileList}>
                {pictures.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <Icon name="ph-image" weight="bold" /> {file.name}{' '}
                    <span className={styles.hint}>{formatBytes(file.size)}</span>
                  </li>
                ))}
              </ul>
            )}
            {!picturesMode && files.length > 0 && (
              <ul className={styles.fileList}>
                {files.map((f) => (
                  <li key={f.name}>
                    <Icon name={KIND_ICONS[kind]} weight="bold" /> {f.name}{' '}
                    <span className={styles.hint}>{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            )}
            <FormatNotes kind={kind} typeInfo={typeInfo} busy={busy} onTemplate={() => void downloadTemplate()} />
          </div>

          <details className={styles.more}>
            <summary>More settings — difficulty and marks</summary>
            <div className={styles.grid}>
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
            <p className={styles.hint}>Used for any question whose file does not give its own.</p>
          </details>

          <Button type="submit" disabled={!ready || busy !== null} loading={busy === 'upload'}>
            {busy === 'upload'
              ? progress
                ? `Uploading ${progress.done + 1} of ${progress.of}…`
                : picturesMode
                  ? 'Preparing…'
                  : 'Reading…'
              : picturesMode
                ? 'Upload the photos'
                : 'Read the questions'}
          </Button>
          {questionType === '' && <p className={styles.hint}>Choose the question type first.</p>}
          <p className={styles.hint}>
            {picturesMode ? (
              <>
                <strong>No question is saved by this.</strong> The photos are uploaded so you can give their answers;
                any you do not save are removed after a day.
              </>
            ) : (
              <>
                <strong>Nothing is saved by this.</strong> You will see everything that was read, everything that could not
                be, and why — and you save them afterwards.
              </>
            )}
          </p>
        </form>

        {/* ----------------------------------------------------------------
            What came back
        ---------------------------------------------------------------- */}
        {preview && (
          <div className={`card ${styles.counts}`}>
            <h2>What was read</h2>
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
                <Icon name="ph-scissors" weight="bold" /> This upload hit its limit of {status?.limits.maxQuestions}{' '}
                questions, so the rest was not read. Split the file and upload the remainder separately.
              </p>
            )}

            {preview.files.length > 1 && (
              <TableScroll label="Per-file outcome">
                <Table className={styles.fileTable}>
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
                </Table>
              </TableScroll>
            )}

            {problemCount > 0 && (
              <button type="button" className={styles.secondary} onClick={downloadErrors}>
                <Icon name="ph-download-simple" weight="bold" /> Download the problem list ({problemCount})
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
              <Icon name="ph-warning-circle" weight="bold" /> Read this before saving
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
                  Review {plural(batch.length, 'question')}
                  {batchClass ? ` for ${batchClass}` : ''}
                </h3>
                <p className={styles.hint}>
                  <strong>Nothing is saved yet.</strong> These exist only on this screen — leaving the page discards
                  them. Check each answer, then save.
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
                <Button type="button" disabled={busy !== null || chosen.length === 0} loading={busy === 'approve'} onClick={() => void approve(false)}>
                  {`Save ${plural(chosen.length, 'question')}${batchClass ? ` to ${batchClass}` : ''}`}
                </Button>
                <Button type="button" variant="secondary" disabled={busy !== null || chosen.length === 0} onClick={() => void approve(true)}>
                  Save and publish to Practice
                </Button>
                {/* Writes nothing, so it may be pressed freely. */}
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy !== null || chosen.length === 0}
                  onClick={() => void check()}
                >
                  {busy === 'check' ? 'Checking…' : 'Check before saving'}
                </button>
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
          <div className={`card ${styles.savedBox}`} role="status">
            <h2>{saved.message}</h2>
            {saved.chapters.length > 0 && (
              <p>
                New topic{saved.chapters.length === 1 ? '' : 's'} added: <strong>{saved.chapters.join(', ')}</strong>.
              </p>
            )}
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
                <p className={styles.hint}>Open them in the question bank, add what is missing, and publish from there.</p>
              </>
            )}
            <p className={styles.hint}>
              A draft can be scheduled as a Daily Quiz, or published to Practice from the question bank.
            </p>
            <p>
              <Link to={bankLink(saved.classLevel, saved.source)} className="link">
                {saved.classLevel ? `See ${saved.classLevel}’s questions in the question bank` : 'Open the question bank'}
              </Link>
            </p>
          </div>
        )}
      </div>
    </AdminShell>
  )
}

/** The question bank, filtered to what was just saved — its class, and how it arrived. */
function bankLink(classLevel: ClassLevel | null, source: string): string {
  const params = new URLSearchParams({ source })
  if (classLevel) params.set('classLevel', classLevel)
  return `/admin/questions?${params.toString()}`
}

/**
 * What a file of the chosen format has to look like, beside the file field.
 *
 * Word gets its conventions, with the answer line spelled for the chosen type; the three tabular
 * formats get the generated Excel template (CSV and JSON read the same columns); photos get what
 * happens next. Short on purpose: the template explains every column itself.
 */
function FormatNotes({
  kind,
  typeInfo,
  busy,
  onTemplate,
}: {
  kind: ImportFileKind
  typeInfo: (typeof UPLOAD_TYPES)[number] | null
  busy: Busy
  onTemplate: () => void
}) {
  if (kind === 'docx') {
    return (
      <ul className={styles.conventions}>
        <li>
          Number each question — <code>Q1.</code>, <code>1.</code> or <code>Question 1:</code>
        </li>
        <li>
          One option per line — <code>(a)</code>, <code>(b)</code>, <code>(c)</code>
        </li>
        <li>
          Give the answer on its own line — <code>{typeInfo?.inWord ?? 'Answer: B'}</code>
        </li>
        <li>
          Optionally add <code>Solution:</code> and <code>Topic:</code> lines
        </li>
        <li>
          Type mathematics as <code>$…$</code>. Equations made with Word&rsquo;s equation editor cannot be read.
        </li>
      </ul>
    )
  }
  if (kind === 'image') {
    return (
      <ul className={styles.conventions}>
        <li>One question per photo — crop away everything else, including other questions</li>
        <li>Students see each photo exactly as you upload it. Nothing reads it.</li>
        <li>
          Next, for each photo: <strong>describe it</strong> in one line and give its answer
        </li>
        <li>The worked solution can be written out, or be a second photo</li>
      </ul>
    )
  }
  return (
    <>
      <p className={styles.templateRow}>
        <button type="button" className={styles.secondary} disabled={busy !== null} onClick={onTemplate}>
          <Icon name="ph-download-simple" weight="bold" /> {busy === 'template' ? 'Building…' : 'Download the Excel template'}
        </button>
        <span className={styles.hint}>Column order and heading capitalisation do not matter.</span>
      </p>
      <ul className={styles.conventions}>
        {kind !== 'excel' && <li>The same columns as the Excel template, in any order</li>}
        {kind === 'csv' && <li>Save from Excel or Google Sheets as “CSV UTF-8”, so maths symbols and ₹ survive</li>}
        {kind === 'json' && <li>An array of objects, one per question, keyed by the column names</li>}
        <li>
          Separate several accepted answers with <code>|</code>, never a comma
        </li>
      </ul>
    </>
  )
}

/** What the save and check endpoints take. Built once so the two cannot drift. */
function payloadOf(question: EditableQuestion) {
  return {
    questionText: question.questionText,
    // A picture is named by its key and its description; its size is the server's to read (Phase 7b).
    image: question.image ? { key: question.image.key, alt: question.image.alt.trim() } : null,
    type: question.type,
    options: question.options,
    booleanAnswer: question.booleanAnswer,
    numericAnswer: question.numericAnswer,
    tolerance: question.tolerance,
    acceptedAnswers: question.acceptedAnswers,
    solution: question.solution,
    solutionImage: question.solutionImage ? { key: question.solutionImage.key, alt: question.solutionImage.alt.trim() } : null,
    marks: question.marks,
    negativeMarks: question.negativeMarks,
    tags: question.tags,
    // The chapter, or — for a topic the bank does not have yet — its name, made a chapter on saving.
    topic: question.topic,
    topicName: question.topicName,
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
 * What the save endpoint really answers with.
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
  /** The topics that became chapters with this save. */
  chaptersCreated?: Array<{ id: string; name: string }>
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
 * One uploaded question, editable in place.
 *
 * Plain controlled inputs rather than a rich editor, for the reason the AI generator's card gives:
 * these are the same fields the question editor already exposes, and a second editing surface with
 * its own quirks would be a second thing to keep correct.
 *
 * **Where it goes is not edited here** (owner, 2026-10-09): the class and the type are the form's,
 * and the topic is shown — marked "new" when saving will add it. The answer is edited in the shape
 * the type needs: options with one or several marked right, true or false, or the answers accepted.
 * A photo's card starts open, because nothing on it is filled in yet.
 */
function ImportCard({
  index,
  question,
  disabled,
  picked,
  verdict,
  onPick,
  onChange,
  onDelete,
}: {
  index: number
  question: EditableQuestion
  disabled: boolean
  picked: boolean
  verdict: ImportVerdict | null
  onPick: (next: boolean) => void
  onChange: (changes: Partial<EditableQuestion>) => void
  onDelete: () => void
}) {
  const image = question.image ?? null
  const [open, setOpen] = useState(() => Boolean(image) && question.options.every((option) => !option.text.trim()))
  const takesOptions = question.type === 'single_choice' || question.type === 'multiple_choice'
  const single = question.type === 'single_choice'

  /** Marks an option right or wrong; single correct means one right answer, so marking one unmarks the rest. */
  function markCorrect(position: number, correct: boolean) {
    onChange({
      options: question.options.map((option, j) =>
        single ? { ...option, isCorrect: j === position && correct } : j === position ? { ...option, isCorrect: correct } : option,
      ),
    })
  }
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
        <span className={styles.qType}>{TYPE_NAMES[question.type]}</span>
        {question.edited && <span className={styles.editedTag}>edited</span>}
        <span className={styles.qMarks}>
          {question.marks} mark{question.marks === 1 ? '' : 's'}
        </span>
      </div>

      <p className={styles.metaLine}>
        {question.classLevel} · {question.topicName}
        {question.topic === null && <span className={styles.newTag}>new topic</span>}
      </p>

      {verdict?.ok === false && verdict.reason && (
        <p className={styles.refusedLine}>
          <Icon name="ph-x-circle" weight="bold" /> Would not save: {verdict.reason}
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
              <Icon name="ph-warning" weight="bold" /> {warning.message}
            </li>
          ))}
        </ul>
      )}

      {/* The question as a photo (Phase 7b): shown as students will see it, and described here. */}
      <QuestionPicture picture={image} name="the question" />
      {image &&
        (open ? (
          <label className={styles.describe}>
            <span>Describe the photo *</span>
            <input
              className="form-control"
              value={image.alt}
              maxLength={300}
              onChange={(e) => onChange({ image: { ...image, alt: e.target.value } })}
            />
            <span className={styles.hint}>
              One line, read aloud instead of the photo — for a student who cannot see it, this is the question.
            </span>
          </label>
        ) : (
          <p className={styles.hint}>{image.alt.trim() ? `Described as: ${image.alt}` : 'Not described yet — press Edit to describe it.'}</p>
        ))}

      {open ? (
        <textarea
          className="form-control"
          rows={image ? 2 : 3}
          aria-label={image ? 'Words with the photo (optional)' : 'Question text'}
          placeholder={image ? 'Optional — a line such as “Look at the figure”' : undefined}
          value={question.questionText}
          onChange={(e) => onChange({ questionText: e.target.value })}
        />
      ) : (
        question.questionText.trim() !== '' && (
          <p className={styles.qText}>
            <MathText>{question.questionText}</MathText>
          </p>
        )
      )}

      {takesOptions && open && (
        <p className={styles.hint}>
          {single ? 'Mark the one correct option.' : 'Mark every correct option — at least two.'}
        </p>
      )}
      {takesOptions && (
        <ul className={styles.options}>
          {question.options.map((option, i) => {
            const letter = String.fromCharCode(65 + i)
            return (
              <li key={i} className={option.isCorrect ? styles.correct : undefined}>
                {open ? (
                  <div className={styles.optionEdit}>
                    <input
                      type={single ? 'radio' : 'checkbox'}
                      name={single ? `correct-${question.clientId}` : undefined}
                      checked={option.isCorrect}
                      aria-label={`Option ${letter} is ${single ? 'the' : 'a'} correct answer`}
                      onChange={(e) => markCorrect(i, e.target.checked)}
                    />
                    <input
                      className="form-control"
                      value={option.text}
                      aria-label={`Option ${letter}`}
                      placeholder={`Option ${letter}`}
                      onChange={(e) =>
                        onChange({ options: question.options.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)) })
                      }
                    />
                    {question.options.length > 2 && (
                      <button
                        type="button"
                        className={styles.linkAction}
                        onClick={() => onChange({ options: question.options.filter((_, j) => j !== i) })}
                      >
                        Remove<span className="sr-only"> option {letter}</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <MathText>{option.text}</MathText>
                    {option.isCorrect && <Icon name="ph-check" weight="bold" className={styles.tick} />}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {takesOptions && open && question.options.length < 8 && (
        <button
          type="button"
          className={styles.linkAction}
          onClick={() => onChange({ options: [...question.options, { text: '', isCorrect: false }] })}
        >
          + Add an option
        </button>
      )}

      {question.type === 'true_false' &&
        (open ? (
          <fieldset className={styles.answerChoice}>
            <legend>Answer *</legend>
            {[true, false].map((value) => (
              <label key={String(value)}>
                <input
                  type="radio"
                  name={`answer-${question.clientId}`}
                  checked={question.booleanAnswer === value}
                  onChange={() => onChange({ booleanAnswer: value })}
                />
                {value ? 'True' : 'False'}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className={styles.answerLine}>
            Answer:{' '}
            <strong>{question.booleanAnswer === null ? 'not chosen yet' : question.booleanAnswer ? 'True' : 'False'}</strong>
          </p>
        ))}

      {question.type === 'numeric' && (
        <p className={styles.answerLine}>
          Answer:{' '}
          {open ? (
            <input
              className="form-control"
              type="number"
              aria-label="The numeric answer"
              value={question.numericAnswer ?? ''}
              onChange={(e) => onChange({ numericAnswer: e.target.value === '' ? null : Number(e.target.value) })}
            />
          ) : (
            <strong>{question.numericAnswer}</strong>
          )}
          {question.tolerance ? <span className={styles.hint}> (± {question.tolerance})</span> : null}
        </p>
      )}

      {question.type === 'fill_blank' &&
        (open ? (
          <div className={styles.describe}>
            <label htmlFor={`accepted-${question.clientId}`}>Accepted answers *</label>
            <AcceptedAnswersInput
              id={`accepted-${question.clientId}`}
              describedBy={`accepted-${question.clientId}-hint`}
              value={question.acceptedAnswers}
              onChange={(acceptedAnswers) => onChange({ acceptedAnswers })}
            />
            <span id={`accepted-${question.clientId}-hint`} className={styles.hint}>
              Every answer you accept, separated by a vertical bar ( | ).
            </span>
          </div>
        ) : (
          <p className={styles.answerLine}>
            Accepted:{' '}
            <strong>{question.acceptedAnswers.length > 0 ? question.acceptedAnswers.join(' · ') : 'none yet'}</strong>
          </p>
        ))}

      <details className={styles.solution} open={open}>
        <summary>Solution {question.solution || question.solutionImage ? '' : '(none — needed before publishing)'}</summary>
        {open ? (
          <>
            <textarea
              className="form-control"
              rows={3}
              aria-label="Worked solution"
              value={question.solution ?? ''}
              onChange={(e) => onChange({ solution: e.target.value || null })}
            />
            {/* Or as a photo (Phase 7b) — a solution worked on paper and photographed. */}
            <QuestionPictureField
              label="Photo of the worked solution"
              hint="Optional — instead of writing it out, or beside it."
              value={question.solutionImage ?? null}
              onChange={(next) => onChange({ solutionImage: next })}
              describeRequired={false}
              disabled={disabled}
            />
          </>
        ) : (
          <>
            {question.solution && <MathText>{question.solution}</MathText>}
            <QuestionPicture picture={question.solutionImage} name="the solution" fallbackAlt="The worked solution, as a picture" />
            {!question.solution && !question.solutionImage && (
              <p className={styles.hint}>
                {image ? 'No solution yet — write one, or add a photo of it.' : 'No solution was found in the file.'}
              </p>
            )}
          </>
        )}
      </details>

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

/**
 * The accepted answers of a fill-in-the-blank, typed as one line.
 *
 * Holds what was typed itself and hands the parsed list up, rather than re-joining the list into
 * the field on every keystroke — which swallowed the `|` as it was typed, so a second answer could
 * never be started.
 */
function AcceptedAnswersInput({
  id,
  describedBy,
  value,
  onChange,
}: {
  id: string
  describedBy: string
  value: string[]
  onChange: (answers: string[]) => void
}) {
  const [text, setText] = useState(() => value.join(' | '))
  return (
    <input
      id={id}
      aria-describedby={describedBy}
      className="form-control"
      value={text}
      placeholder="5050 | five thousand and fifty"
      onChange={(e) => {
        setText(e.target.value)
        onChange(
          e.target.value
            .split('|')
            .map((answer) => answer.trim())
            .filter(Boolean),
        )
      }}
    />
  )
}
