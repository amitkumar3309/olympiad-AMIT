import { useEffect, useMemo, useState } from 'react'
import { api, API_BASE } from '../../api/client'
import { loadChapters } from '../../api/implicitSubject'
import type {
  BulkPlanRow,
  Difficulty,
  QuizImportApproveResponse,
  QuizImportOutcomeRow,
  QuizImportPreviewResponse,
  QuizImportRow,
  Topic,
} from '../../api/types'
import MathText from '../../components/MathText'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Select,
  Steps,
  Table,
  TableScroll,
  Textarea,
  useToast,
} from '../../components/ui'
import { formatDayKey } from '../../lib/format'
import { humanizeError } from '../../lib/errors'
import { triggerDownload } from '../../lib/download'
import { ClassRangePicker } from './DailyQuizSchedule'
import styles from './DailyQuiz.module.css'

/**
 * Loading weeks of Daily Quizzes at once (Milestone 30, Phase 2 — brief §6.5).
 *
 * Two ways in, both **dry run first**:
 *
 *  - **A file** — CSV, JSON or the Excel template, one row per quiz with its `Day` and
 *    `Classes`. The server reads it with the question importer, checks every row's day and
 *    classes, and writes nothing; the administrator approves the ready rows, and only then
 *    are the questions saved (as drafts) and the quizzes scheduled.
 *  - **The question bank** — questions already written, scheduled one a day from a start
 *    date, skipping days that are taken.
 *
 * Either way the result is reported row by row: one bad row never stops the others.
 */

type FileKind = 'csv' | 'json' | 'excel'

const KIND_OF_EXTENSION: Record<string, FileKind> = { csv: 'csv', json: 'json', xlsx: 'excel' }

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`))
    reader.readAsDataURL(file)
  })
}

function outcomeBadge(row: QuizImportOutcomeRow) {
  if (row.status === 'scheduled') return <Badge tone="success" size="sm">Scheduled · {formatDayKey(row.day)}</Badge>
  if (row.status === 'saved-not-scheduled') return <Badge tone="warning" size="sm">Saved, not scheduled</Badge>
  return <Badge tone="danger" size="sm">Not saved</Badge>
}

// ---------------------------------------------------------------------------
// From a file
// ---------------------------------------------------------------------------

export function QuizFileImport({ onScheduled }: { onScheduled: () => void }) {
  const toast = useToast()
  const [chapters, setChapters] = useState<Topic[]>([])
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<QuizImportPreviewResponse | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [outcome, setOutcome] = useState<QuizImportOutcomeRow[] | null>(null)
  const [busy, setBusy] = useState<'preview' | 'approve' | 'template' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadChapters()
      .then(setChapters)
      .catch(() => setChapters([]))
  }, [])

  const kind: FileKind | null = file ? (KIND_OF_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null) : null
  const ready = useMemo(() => (preview?.rows ?? []).filter((row) => row.problems.length === 0), [preview])
  const chosen = ready.filter((row) => !skipped.has(row.clientId))

  async function downloadTemplate(format: 'csv' | 'json') {
    setBusy('template')
    setError(null)
    try {
      // A file rather than JSON, so not through `api` — the same exception the question
      // importer's Excel template makes.
      const res = await fetch(`${API_BASE}/admin/daily-quiz/import/template?format=${format}`, { credentials: 'include' })
      if (!res.ok) throw new Error('The template could not be downloaded.')
      triggerDownload(await res.blob(), `amit-daily-quiz-template.${format}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The template could not be downloaded.')
    } finally {
      setBusy(null)
    }
  }

  async function runPreview() {
    if (!file || !kind) {
      setError('Choose a .csv, .json or .xlsx file.')
      return
    }
    setBusy('preview')
    setError(null)
    setOutcome(null)
    setSkipped(new Set())
    try {
      const content = await readAsDataUrl(file)
      const res = await api.post<QuizImportPreviewResponse>(`/admin/daily-quiz/import/${kind}`, {
        file: { name: file.name, content },
        topic: topic || null,
        difficulty,
      })
      setPreview(res)
    } catch (err) {
      setPreview(null)
      setError(humanizeError(err, { fallback: 'That file could not be read.' }))
    } finally {
      setBusy(null)
    }
  }

  async function approve() {
    if (!preview?.batchId || chosen.length === 0) return
    setBusy('approve')
    setError(null)
    try {
      const res = await api.post<QuizImportApproveResponse>('/admin/daily-quiz/import/approve', {
        batchId: preview.batchId,
        rows: chosen.map((row: QuizImportRow) => ({
          clientId: row.clientId,
          sourceRef: row.sourceRef,
          day: row.plan!.day,
          classMin: row.plan!.classMin,
          classMax: row.plan!.classMax,
          question: row.question,
        })),
      })
      setOutcome(res.rows)
      toast.success(`${res.scheduled} ${res.scheduled === 1 ? 'quiz' : 'quizzes'} scheduled.`)
      if (res.scheduled > 0) onScheduled()
    } catch (err) {
      setError(humanizeError(err, { fallback: 'The quizzes could not be scheduled.' }))
    } finally {
      setBusy(null)
    }
  }

  const step = outcome ? 'done' : preview ? 'review' : 'upload'

  return (
    <div className={styles.stack}>
      <Steps
        label="Import steps"
        current={step}
        steps={[
          { id: 'upload', label: 'Upload a file' },
          { id: 'review', label: 'Check every row' },
          { id: 'done', label: 'Scheduled' },
        ]}
      />

      <Card>
        <CardHeader title="Import a file of quizzes" as="h2" size="sm" description="One row per quiz. Nothing is saved until you approve the preview." />
        <div className={styles.stack}>
          <ul className={styles.helpList}>
            <li>
              Columns: <code>Day</code>, <code>Classes</code>, <code>Question</code>, <code>Option A</code>–<code>Option F</code>,{' '}
              <code>Correct Answer</code> (a letter), <code>Solution</code>, and optionally <code>Topic</code> and <code>Difficulty</code>.
            </li>
            <li>
              <code>Day</code> as <code>2026-11-08</code> or <code>08/11/2026</code>. <code>Classes</code> as <code>3-5</code>, <code>6-8</code>,{' '}
              <code>9-12</code>, a single class such as <code>9</code>, or <code>All</code>.
            </li>
            <li>Every question needs a worked solution — it unlocks for students the day after the quiz.</li>
            <li>Questions are saved to the bank as drafts, so they stay out of Practice until their answer is revealed.</li>
          </ul>
          <div className={styles.inlineActions}>
            <Button variant="secondary" size="sm" icon="ph-download-simple" loading={busy === 'template'} onClick={() => void downloadTemplate('csv')}>
              CSV template
            </Button>
            <Button variant="secondary" size="sm" icon="ph-download-simple" loading={busy === 'template'} onClick={() => void downloadTemplate('json')}>
              JSON template
            </Button>
          </div>
          <div className={styles.formGrid}>
            <Field label="File" hint=".csv, .json or the .xlsx question template, up to 2 MB (5 MB for .xlsx).">
              <Input
                type="file"
                accept=".csv,.json,.xlsx"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  setPreview(null)
                  setOutcome(null)
                }}
              />
            </Field>
            <Field label="Chapter for rows that name none" optional hint="Otherwise the chapter is detected from the question, or the row is reported.">
              <Select value={topic} onChange={(event) => setTopic(event.target.value)}>
                <option value="">Detect from the question</option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Difficulty for rows that name none">
              <Select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </Select>
            </Field>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className={styles.inlineActions}>
            <Button icon="ph-magnifying-glass" loading={busy === 'preview'} disabled={!file} onClick={() => void runPreview()}>
              Check the file
            </Button>
          </div>
        </div>
      </Card>

      {preview && !outcome && (
        <Card>
          <CardHeader
            title="Preview — nothing has been saved"
            as="h2"
            size="sm"
            description={`${preview.summary.ready} ready · ${preview.summary.withProblems} with problems · ${preview.summary.refused} could not be read`}
          />
          <div className={styles.stack}>
            {preview.unknownChapters.length > 0 && (
              <Alert tone="warning" title="Chapters that do not exist">
                {preview.unknownChapters.join(', ')}. Create them under Chapters (or correct the spelling), then check the file again.
              </Alert>
            )}
            {[...preview.failures.map((f) => `${f.sourceRef}: ${f.reason}`), ...preview.refused.map((r) => r.reason), ...preview.duplicates.map((d) => d.reason)].length > 0 && (
              <Alert tone="danger" title="Rows that could not be read">
                <ul className={styles.problemList}>
                  {preview.failures.map((f) => (
                    <li key={`f-${f.sourceRef}`}>
                      {f.sourceRef}: {f.reason}
                    </li>
                  ))}
                  {[...preview.refused, ...preview.duplicates].map((r, index) => (
                    <li key={`r-${index}`}>{r.reason}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {preview.rows.length === 0 ? (
              <EmptyState size="sm" icon="ph-file-x" title="No quizzes in this file" description="Fix the rows listed above and check the file again." />
            ) : (
              <TableScroll label="Quizzes in the file">
                <Table density="comfortable">
                  <thead>
                    <tr>
                      <th scope="col">Schedule</th>
                      <th scope="col">Row</th>
                      <th scope="col">Day and classes</th>
                      <th scope="col">Question</th>
                      <th scope="col">Answer</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const correct = row.question.options.find((option) => option.isCorrect)
                      const ok = row.problems.length === 0
                      return (
                        <tr key={row.clientId}>
                          <td>
                            <Checkbox
                              label={<span className="sr-only">Schedule {row.sourceRef}</span>}
                              checked={ok && !skipped.has(row.clientId)}
                              disabled={!ok}
                              onChange={(event) => {
                                const next = new Set(skipped)
                                if (event.target.checked) next.delete(row.clientId)
                                else next.add(row.clientId)
                                setSkipped(next)
                              }}
                            />
                          </td>
                          <td className={styles.muted}>{row.sourceRef}</td>
                          <td>
                            {row.plan ? (
                              <>
                                {formatDayKey(row.plan.day)}
                                <div className={styles.muted}>{row.plan.label}</div>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={styles.questionCell}>
                            <MathText>{row.question.questionText}</MathText>
                            <div className={styles.muted}>{row.question.topicName}</div>
                          </td>
                          <td>{correct ? <MathText>{correct.text}</MathText> : '—'}</td>
                          <td>
                            {ok ? (
                              <Badge tone="success" size="sm">Ready</Badge>
                            ) : (
                              <ul className={styles.problemList}>
                                {row.problems.map((problem) => (
                                  <li key={problem}>{problem}</li>
                                ))}
                              </ul>
                            )}
                            {row.warnings.map((warning) => (
                              <div key={warning.message} className={styles.muted}>
                                {warning.message}
                              </div>
                            ))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              </TableScroll>
            )}
            <div className={styles.inlineActions}>
              <Button icon="ph-calendar-check" loading={busy === 'approve'} disabled={chosen.length === 0} onClick={() => void approve()}>
                Save and schedule {chosen.length} {chosen.length === 1 ? 'quiz' : 'quizzes'}
              </Button>
              <span className={styles.muted}>Every row is checked again when you press this.</span>
            </div>
          </div>
        </Card>
      )}

      {outcome && (
        <Card>
          <CardHeader title="What happened" as="h2" size="sm" />
          <TableScroll label="Import results">
            <Table density="compact">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {outcome.map((row) => (
                  <tr key={row.clientId}>
                    <td>{row.sourceRef}</td>
                    <td>{outcomeBadge(row)}</td>
                    <td className={styles.muted}>
                      {row.status === 'scheduled'
                        ? row.label
                        : row.status === 'saved-not-scheduled'
                          ? `${row.reason} The question is in the bank as a draft — schedule it by hand.`
                          : row.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          <div className={styles.inlineActions}>
            <Button
              variant="secondary"
              onClick={() => {
                setPreview(null)
                setOutcome(null)
                setFile(null)
              }}
            >
              Import another file
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// From the question bank
// ---------------------------------------------------------------------------

export function QuizBankBulk({
  today,
  initialIds,
  onScheduled,
}: {
  today: string
  initialIds: readonly string[]
  onScheduled: () => void
}) {
  const toast = useToast()
  const [range, setRange] = useState({ min: 9, max: 12 })
  const [startDay, setStartDay] = useState(today)
  const [ids, setIds] = useState(initialIds.join('\n'))
  const [plan, setPlan] = useState<BulkPlanRow[] | null>(null)
  const [done, setDone] = useState<BulkPlanRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialIds.length > 0) setIds(initialIds.join('\n'))
  }, [initialIds])

  const questionIds = ids
    .split(/[\s,]+/u)
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  async function run(dryRun: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ rows: BulkPlanRow[]; scheduledCount: number }>('/admin/daily-quiz/bulk', {
        classMin: range.min,
        classMax: range.max,
        startDay,
        questionIds,
        dryRun,
      })
      if (dryRun) {
        setPlan(res.rows)
        setDone(null)
      } else {
        setDone(res.rows)
        setPlan(null)
        toast.success(`${res.scheduledCount} ${res.scheduledCount === 1 ? 'quiz' : 'quizzes'} scheduled.`)
        if (res.scheduledCount > 0) onScheduled()
      }
    } catch (err) {
      setError(humanizeError(err, { fallback: 'The plan could not be made.' }))
    } finally {
      setBusy(false)
    }
  }

  const rows = done ?? plan
  return (
    <Card>
      <CardHeader
        title="Schedule questions from the bank"
        as="h2"
        size="sm"
        description="Each question takes the next free day from the start date, in the order given. Select questions in the Question Bank and choose “Schedule as Daily Quiz” to fill this in."
      />
      <div className={styles.stack}>
        <ClassRangePicker min={range.min} max={range.max} onChange={setRange} />
        <div className={styles.formGrid}>
          <Field label="Start day">
            <Input type="date" min={today} value={startDay} onChange={(event) => setStartDay(event.target.value)} />
          </Field>
          <Field label="Question ids" hint={`${questionIds.length} question${questionIds.length === 1 ? '' : 's'} — one per line, in the order to schedule them.`}>
            <Textarea rows={4} value={ids} onChange={(event) => setIds(event.target.value)} />
          </Field>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className={styles.inlineActions}>
          <Button variant="secondary" icon="ph-list-checks" loading={busy && !plan} disabled={questionIds.length === 0} onClick={() => void run(true)}>
            Plan it
          </Button>
          {plan && (
            <Button icon="ph-calendar-check" loading={busy} disabled={!plan.some((row) => row.day && !row.error)} onClick={() => void run(false)}>
              Schedule {plan.filter((row) => row.day && !row.error).length}
            </Button>
          )}
        </div>
        {rows && (
          <TableScroll label={done ? 'What was scheduled' : 'The plan'}>
            <Table density="compact">
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Day</th>
                  <th scope="col">{done ? 'Outcome' : 'Check'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.questionId}>
                    <td className={styles.questionCell}>{row.questionText ? <MathText>{row.questionText}</MathText> : <code>{row.questionId}</code>}</td>
                    <td>{row.day ? formatDayKey(row.day) : '—'}</td>
                    <td>{row.error ? <span className={styles.warnText}>{row.error}</span> : <Badge tone="success" size="sm">{done ? 'Scheduled' : 'Ready'}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </div>
    </Card>
  )
}
