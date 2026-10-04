import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { QuizCandidate, QuizCandidatesResponse } from '../../api/types'
import MathText from '../../components/MathText'
import { Alert, Badge, Button, EmptyState, Field, Input, Modal, Pagination, SearchInput, Select, SkeletonText } from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import styles from './DailyQuiz.module.css'

/**
 * Choosing a quiz's question (Milestone 30, Phase 2) — the schedule dialog, and the
 * "change question" dialog on a quiz's own page.
 *
 * The picker lists only what can become a quiz: unpublished single-choice questions with
 * one correct option and a worked solution, for a class inside the range, never used on
 * another day. The server re-checks every one of those rules when the quiz is saved; this
 * list exists so the administrator is never offered a question that would be refused.
 *
 * A brand-new question is written in the Question Bank's editor, which has the live
 * Markdown/LaTeX preview — it is saved as a draft there and appears in this picker.
 */

const CLASS_PRESETS = [
  { key: '3-5', label: 'Classes 3–5', min: 3, max: 5 },
  { key: '6-8', label: 'Classes 6–8', min: 6, max: 8 },
  { key: '9-12', label: 'Classes 9–12', min: 9, max: 12 },
  { key: 'all', label: 'All classes', min: 3, max: 12 },
] as const

const CLASS_NUMBERS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const PAGE_SIZE = 8

export interface QuestionPickerProps {
  classMin: number
  classMax: number
  value: string | null
  onChange: (candidate: QuizCandidate) => void
}

/** A searchable, paginated radio list of the questions that can be a quiz for this range. */
export function QuestionPicker({ classMin, classMax, value, onChange }: QuestionPickerProps) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<QuizCandidatesResponse | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const id = window.setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(id)
  }, [search])

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ classMin: String(classMin), classMax: String(classMax), page: String(page), limit: String(PAGE_SIZE) })
    if (query) params.set('search', query)
    setData(null)
    setError(null)
    api
      .get<QuizCandidatesResponse>(`/admin/daily-quiz/candidates?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err)
      })
    return () => {
      cancelled = true
    }
  }, [classMin, classMax, page, query])

  return (
    <div className={styles.picker}>
      <Field label="Find a question" hint="Unpublished single-choice questions with a solution, for these classes.">
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the question text" />
      </Field>
      {error !== null ? (
        <Alert tone="danger">{humanizeError(error, { fallback: 'Could not load the questions.' })}</Alert>
      ) : !data ? (
        <SkeletonText lines={4} label="Loading questions" />
      ) : data.candidates.length === 0 ? (
        <EmptyState
          size="sm"
          icon="ph-question"
          title="No question can be a quiz for these classes yet"
          description="A Daily Quiz needs an unpublished single-choice question with a worked solution. Write one in the Question Bank — it is saved as a draft — and it will appear here."
          action={
            <Link to="/admin/questions/new" className={styles.inlineLink}>
              Write a new question
            </Link>
          }
        />
      ) : (
        <>
          <fieldset className={styles.pickerList}>
            <legend className="sr-only">Questions</legend>
            {data.candidates.map((candidate) => (
              <label key={candidate.id} className={styles.pickerItem} data-selected={value === candidate.id}>
                <input
                  type="radio"
                  name="quiz-question"
                  value={candidate.id}
                  checked={value === candidate.id}
                  disabled={!candidate.ready}
                  onChange={() => onChange(candidate)}
                />
                <span className={styles.pickerText}>
                  <MathText>{candidate.questionText}</MathText>
                  <span className={styles.pickerMeta}>
                    <Badge size="sm" tone="neutral">
                      {candidate.classLevel}
                    </Badge>
                    <Badge size="sm" tone="neutral">
                      {candidate.difficulty}
                    </Badge>
                    {candidate.topic && <span className={styles.muted}>{candidate.topic}</span>}
                    {!candidate.ready && (
                      <span className={styles.warnText}>Needs exactly one correct option out of 2–6 — fix it in the Question Bank.</span>
                    )}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {data.pagination.totalPages > 1 && (
            <Pagination
              page={page}
              pageCount={data.pagination.totalPages}
              total={data.pagination.total}
              pageSize={PAGE_SIZE}
              onChange={setPage}
              label="Question pages"
            />
          )}
        </>
      )}
    </div>
  )
}

/** Preset buttons plus a custom from–to range. */
export function ClassRangePicker({
  min,
  max,
  onChange,
}: {
  min: number
  max: number
  onChange: (range: { min: number; max: number }) => void
}) {
  return (
    <div className={styles.rangePicker}>
      <div className={styles.presets} role="group" aria-label="Class group">
        {CLASS_PRESETS.map((preset) => (
          <Button
            key={preset.key}
            size="sm"
            variant={preset.min === min && preset.max === max ? 'primary' : 'secondary'}
            aria-pressed={preset.min === min && preset.max === max}
            onClick={() => onChange({ min: preset.min, max: preset.max })}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <div className={styles.customRange}>
        <Field label="From class">
          <Select value={String(min)} onChange={(event) => onChange({ min: Number(event.target.value), max: Math.max(Number(event.target.value), max) })}>
            {CLASS_NUMBERS.map((n) => (
              <option key={n} value={n}>
                Class {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To class">
          <Select value={String(max)} onChange={(event) => onChange({ min: Math.min(min, Number(event.target.value)), max: Number(event.target.value) })}>
            {CLASS_NUMBERS.map((n) => (
              <option key={n} value={n}>
                Class {n}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  )
}

export interface ScheduleDialogProps {
  open: boolean
  onClose: () => void
  onScheduled: () => void
  /** The server's today — the earliest day that may be chosen. */
  today: string
  initialDay?: string
}

export default function ScheduleDialog({ open, onClose, onScheduled, today, initialDay }: ScheduleDialogProps) {
  const [day, setDay] = useState(initialDay ?? today)
  const [range, setRange] = useState({ min: 9, max: 12 })
  const [chosen, setChosen] = useState<QuizCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDay(initialDay ?? today)
      setChosen(null)
      setError(null)
    }
  }, [open, initialDay, today])

  async function save() {
    if (!chosen) {
      setError('Choose the question first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/admin/daily-quiz', { day, classMin: range.min, classMax: range.max, questionId: chosen.id })
      onScheduled()
    } catch (err) {
      setError(humanizeError(err, { fallback: 'The quiz could not be scheduled.' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Schedule a Daily Quiz"
      description="The quiz opens at 12:00 AM and closes at 11:59 PM India time on its day. Its answer unlocks the next day."
      icon="ph-calendar-plus"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="ph-calendar-check" loading={busy} disabled={!chosen} onClick={() => void save()}>
            Schedule
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <Field label="Day" hint="Today or later, in India time.">
          <Input type="date" min={today} value={day} onChange={(event) => setDay(event.target.value)} />
        </Field>
        <ClassRangePicker
          min={range.min}
          max={range.max}
          onChange={(next) => {
            setRange(next)
            setChosen(null)
          }}
        />
        <QuestionPicker classMin={range.min} classMax={range.max} value={chosen?.id ?? null} onChange={setChosen} />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  )
}
