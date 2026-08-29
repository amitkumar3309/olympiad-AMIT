import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { loadChapterScope } from '../../api/implicitSubject'
import {
  CLASS_LEVELS,
  type AdminMockTest,
  type AdminQuestion,
  type ClassLevel,
  type Pagination,
  type ResultDisplayMode,
  type ReviewPolicy,
  type PaperSuggestion,
  type Topic,
} from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import MathText from '../../components/MathText'
import { Alert, Icon } from '../../components/ui'
import styles from './MockTests.module.css'

/**
 * Creating and editing a mock test (Milestone 7).
 *
 * One form for both, as the question editor does: the only difference is whether it
 * loads an existing test first, and an update sends the whole test rather than a patch
 * (otherwise "remove every question but one" and "leave the questions alone" would be
 * indistinguishable on the wire).
 *
 * ## What this page does not decide
 *
 * The paper may only hold **published** questions of the test's own class, negative
 * marking may not exceed the marks on offer, and the questions and duration freeze once
 * a student has sat it. All four rules live in the service and are enforced there. This
 * page helps the author stay inside them — it only offers published questions for the
 * chosen class, and it warns when a test already has attempts — but it does not
 * duplicate the checks, so its refusals are always the API's own message.
 */

interface Selected {
  id: string
  questionText: string
  marks: number
  negativeMarks: number
}

interface QuestionListResponse {
  questions: AdminQuestion[]
  pagination: Pagination
}

const RESULT_DISPLAY_LABELS: Record<ResultDisplayMode, string> = {
  immediate: 'As soon as the student submits',
  after_close: 'Only after the test closes',
  hidden: 'Never shown to students',
}

const REVIEW_POLICY_LABELS: Record<ReviewPolicy, string> = {
  immediate: 'As soon as the student submits',
  after_close: 'Only after the test closes',
  never: 'Never released to students',
}

/**
 * A `datetime-local` input works in the author's own timezone; the API takes ISO. These
 * two are the only place that conversion happens, so a window is never off by an offset.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export default function MockTestForm() {
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [existing, setExisting] = useState<AdminMockTest | null>(null)
  /** How many students have sat it. Above zero, the paper and the clock are frozen. */
  const [attemptsCount, setAttemptsCount] = useState(0)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState(
    'Answer all questions. Negative marking applies to wrong answers. Unanswered questions score zero.',
  )
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 9')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [maxAttempts, setMaxAttempts] = useState(1)
  const [availableFrom, setAvailableFrom] = useState('')
  const [availableTo, setAvailableTo] = useState('')
  const [resultDisplay, setResultDisplay] = useState<ResultDisplayMode>('immediate')
  /**
   * Matches the API's default rather than the *recommended* policy. `after_close` is
   * the better choice for a scheduled assessment and the help text says so — but it
   * requires a closing time, so defaulting to it would greet every blank form with a
   * validation warning about a field the author has not reached yet.
   */
  const [reviewPolicy, setReviewPolicy] = useState<ReviewPolicy>('immediate')
  const [selected, setSelected] = useState<Selected[]>([])
  /** What a hand-off from the Question Bank could not use, and why. Shown, never swallowed. */
  const [handoffNote, setHandoffNote] = useState('')
  const [searchParams] = useSearchParams()

  /**
   * Filling the paper in one go (chapter-wise, or the whole syllabus).
   *
   * `topics` is the chapter list for the picker below; `fillTopic` empty means a whole-syllabus
   * paper spread across every chapter that has published questions for this class.
   */
  const [topics, setTopics] = useState<Topic[]>([])
  /**
   * The subject the pickers filter by. See `loadChapterScope()` — the Question Bank stays unscoped
   * so legacy data remains manageable, but a paper must not be built from another subject's
   * questions.
   */
  const [pickerSubject, setPickerSubject] = useState<string | null>(null)
  const [fillTopic, setFillTopic] = useState('')
  const [fillCount, setFillCount] = useState(20)
  const [filling, setFilling] = useState(false)
  const [fillNote, setFillNote] = useState('')

  // The picker
  const [available, setAvailable] = useState<AdminQuestion[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')


  /**
   * Every active chapter, for the "fill the paper" control.
   *
   * Not filtered by subject: there is no user-facing subject in this product, and the picker below
   * already scopes what can go on the paper by *class*, which is the thing that actually decides who
   * a question is for.
   */
  useEffect(() => {
    loadChapterScope()
      .then(({ subjectId, chapters }) => {
        setPickerSubject(subjectId)
        setTopics(chapters)
      })
      .catch(() => setTopics([]))
  }, [])

  // Load the test being edited.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    api
      .get<{ test: AdminMockTest; attemptsCount: number }>(`/admin/mock-tests/${id}`)
      .then((res) => {
        if (cancelled) return
        const test = res.test
        setExisting(test)
        setAttemptsCount(res.attemptsCount)
        setTitle(test.title)
        setDescription(test.description ?? '')
        setInstructions(test.instructions ?? '')
        setClassLevel(test.classLevel)
        setDurationMinutes(test.durationMinutes)
        setMaxAttempts(test.maxAttempts)
        setAvailableFrom(toLocalInput(test.availableFrom))
        setAvailableTo(toLocalInput(test.availableTo))
        setResultDisplay(test.resultDisplay)
        setReviewPolicy(test.reviewPolicy)
        setSelected(
          test.questions.map((entry) => ({
            id: entry.id,
            questionText: entry.questionText ?? '(question unavailable)',
            marks: entry.marks,
            negativeMarks: entry.negativeMarks,
          })),
        )
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load that test.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  /**
   * Prefills the paper from a Question Bank selection (Milestone 21, Phase H).
   *
   * `?questions=<ids>&classLevel=<class>`, built by `questionHandoff.ts`. Runs **only when
   * creating** — a hand-off into an existing test would silently rewrite a paper somebody may
   * already have sat, and the API freezes the questions once anybody has.
   *
   * Two things it does rather than trusting the URL. It **fetches each question** instead of taking
   * the ids on faith, because the paper shows the text and the marks and because a stale link could
   * name a question that has since been archived. And anything it cannot use is **reported by
   * name** — a mock test's questions must all be of the test's own class, so a link carrying a
   * mismatch must say so rather than quietly dropping rows and leaving the author to notice a
   * paper is short.
   */
  useEffect(() => {
    if (id) return
    const ids = (searchParams.get('questions') ?? '').split(',').map((v) => v.trim()).filter(Boolean)
    if (ids.length === 0) return

    const wantedClass = searchParams.get('classLevel')
    if (wantedClass && (CLASS_LEVELS as readonly string[]).includes(wantedClass)) {
      setClassLevel(wantedClass as ClassLevel)
    }

    let cancelled = false
    void (async () => {
      const found: Selected[] = []
      const problems: string[] = []

      for (const questionId of ids) {
        try {
          const res = await api.get<{ question: AdminQuestion }>(`/admin/questions/${questionId}`)
          const question = res.question
          if (wantedClass && question.classLevel !== wantedClass) {
            problems.push(`"${question.questionText.slice(0, 40)}…" is for ${question.classLevel}`)
            continue
          }
          found.push({
            id: question.id,
            questionText: question.questionText,
            marks: question.marks,
            negativeMarks: question.negativeMarks,
          })
        } catch {
          problems.push(`one question could not be loaded (${questionId.slice(0, 8)}…)`)
        }
      }

      if (cancelled) return
      // Order is preserved: the ids arrive in the order they were selected, and the author can
      // reorder afterwards.
      setSelected(found)
      setHandoffNote(
        problems.length === 0
          ? `${found.length} question${found.length === 1 ? '' : 's'} brought over from the question bank. Give the test a title and a duration.`
          : `${found.length} of ${ids.length} questions brought over. Left out: ${problems.join('; ')}.`,
      )
    })()

    return () => {
      cancelled = true
    }
    // Deliberately keyed on the search string only: re-running this on every `classLevel` change
    // would fight the author, who is allowed to change the class and clear the paper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, searchParams])

  /** Only published questions for the chosen class are ever offered. */
  const loadQuestions = useCallback(
    async (isCurrent: () => boolean) => {
      setPickerLoading(true)
      setPickerError('')
      try {
        const params = new URLSearchParams({ status: 'published', classLevel, limit: '50', sort: 'createdAt' })
        // Only the implicit subject's questions may go on a paper. Omitted while it is still
        // resolving rather than sent empty, which the schema would refuse as a malformed id.
        if (pickerSubject) params.set('subject', pickerSubject)
          if (appliedSearch) params.set('search', appliedSearch)
        const res = await api.get<QuestionListResponse>(`/admin/questions?${params.toString()}`)
        if (isCurrent()) setAvailable(res.questions)
      } catch (err) {
        if (isCurrent()) setPickerError(err instanceof ApiError ? err.message : 'Could not load the question bank.')
      } finally {
        if (isCurrent()) setPickerLoading(false)
      }
    },
    [classLevel, appliedSearch, pickerSubject],
  )

  /**
   * Guarded against an out-of-order response.
   *
   * `loadQuestions` re-runs whenever the class, subject or search changes, and nothing stopped an
   * *earlier* request from resolving *later* and overwriting the list with results for a filter the
   * user has already moved off. That produced a picker reading "No published questions for Class 7"
   * while the API was returning two of them — which is how the Phase I hand-off surfaced it: it sets
   * the class immediately after mount, so the default-class request and the real one were always in
   * flight together.
   *
   * A `cancelled` flag rather than an `AbortController` because the stale response is harmless
   * once ignored, and this keeps the fix to the one line that was actually wrong: **only the newest
   * request may write to state.**
   */
  useEffect(() => {
    let cancelled = false
    void loadQuestions(() => !cancelled)
    return () => {
      cancelled = true
    }
  }, [loadQuestions])

  const selectedIds = useMemo(() => new Set(selected.map((entry) => entry.id)), [selected])
  const totalMarks = selected.reduce((sum, entry) => sum + (Number.isFinite(entry.marks) ? entry.marks : 0), 0)
  /**
   * The paper and the clock are frozen once anyone has sat the test. The API is what
   * refuses the change; this only stops the author from editing fields that would then
   * be rejected, and the banner above says why.
   */
  const paperLocked = attemptsCount > 0

  /**
   * Fills the paper from the bank in one action.
   *
   * With a chapter: a **chapter-wise** paper. Without: the **whole syllabus**, spread across every
   * chapter that has published questions for this class — which is why this goes through
   * `/admin/questions/paper-suggestion` rather than the ordinary listing with a limit. Forty
   * questions off the top of the bank are the forty most recent, which in a bank filled chapter by
   * chapter means one or two chapters and none of the rest.
   *
   * It **adds to** the paper rather than replacing it, and skips anything already on it, so an author
   * can fill from two chapters in turn. Fewer than asked for is reported rather than hidden: the bank
   * has what it has.
   */
  async function fillPaper() {
    setFilling(true)
    setError('')
    setFillNote('')
    try {
      const params = new URLSearchParams({ classLevel, count: String(fillCount) })
      if (fillTopic) params.set('topic', fillTopic)
      const res = await api.get<PaperSuggestion>(`/admin/questions/paper-suggestion?${params.toString()}`)

      const fresh = res.questions.filter((question) => !selectedIds.has(question.id))
      setSelected((current) => [
        ...current,
        ...fresh.map((question) => ({
          id: question.id,
          questionText: question.questionText,
          marks: question.marks,
          negativeMarks: question.negativeMarks,
        })),
      ])

      const scope = fillTopic ? topics.find((t) => t.id === fillTopic)?.name ?? 'that chapter' : 'the whole syllabus'
      setFillNote(
        fresh.length === 0
          ? `No further published ${classLevel} questions found for ${scope}. Publish some first, or add them by hand.`
          : fresh.length < res.requested
            ? `Added ${fresh.length} of the ${res.requested} asked for from ${scope} — that is all the bank has for ${classLevel}.`
            : `Added ${fresh.length} questions from ${scope}. Adjust the marks or reorder them below.`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not put a paper together.')
    } finally {
      setFilling(false)
    }
  }

  function add(question: AdminQuestion) {
    if (selectedIds.has(question.id)) return
    setSelected((current) => [
      ...current,
      {
        id: question.id,
        questionText: question.questionText,
        // Default to the bank's own price; the author may override it for this paper.
        marks: question.marks,
        negativeMarks: question.negativeMarks,
      },
    ])
  }

  function remove(questionId: string) {
    setSelected((current) => current.filter((entry) => entry.id !== questionId))
  }

  function move(index: number, delta: number) {
    setSelected((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      const [moved] = next.splice(index, 1)
      if (moved) next.splice(target, 0, moved)
      return next
    })
  }

  function patchSelected(questionId: string, patch: Partial<Selected>) {
    setSelected((current) => current.map((entry) => (entry.id === questionId ? { ...entry, ...patch } : entry)))
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const body = {
        title,
        description: description.trim() === '' ? null : description,
        instructions: instructions.trim() === '' ? null : instructions,
        classLevel,
        questions: selected.map((entry) => ({
          question: entry.id,
          marks: entry.marks,
          negativeMarks: entry.negativeMarks,
        })),
        durationMinutes,
        maxAttempts,
        availableFrom: fromLocalInput(availableFrom),
        availableTo: fromLocalInput(availableTo),
        resultDisplay,
        reviewPolicy,
      }

      if (editing && id) {
        await api.put(`/admin/mock-tests/${id}`, body)
      } else {
        await api.post('/admin/mock-tests', body)
      }
      navigate('/admin/mock-tests')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that test.')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <AdminShell title={editing ? 'Edit mock test' : 'New mock test'}>
        <div className={styles.centered}>
          <Spinner />
        </div>
      </AdminShell>
    )
  }

  const needsClosingTime =
    (resultDisplay === 'after_close' || reviewPolicy === 'after_close') && availableTo.trim() === ''

  return (
    <AdminShell title={editing ? `Edit: ${existing?.title ?? 'mock test'}` : 'New mock test'}>
      {error && <Alert tone="danger">{error}</Alert>}

      {paperLocked ? (
        <p className={styles.warn}>
          {attemptsCount} student attempt{attemptsCount === 1 ? '' : 's'} already exist, so the{' '}
          <strong>questions, their marks and the duration are frozen</strong> — changing them would make results
          recorded against this test incomparable. Everything else (instructions, window, attempt limit, when results
          and answers are released) can still be changed. To change the paper, publish a new test.
        </p>
      ) : (
        editing &&
        existing?.status === 'published' && (
          <p className={styles.warn}>
            This test is <strong>published</strong>. The paper can still be changed because nobody has sat it yet —
            once the first student does, the questions, marks and duration are frozen.
          </p>
        )
      )}

      <div className={styles.formGrid}>
        <div className="card">
          <h3>Test details</h3>

          <div className="form-group">
            <label htmlFor="mt-title">Title *</label>
            <input
              id="mt-title"
              className="form-control"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Weekly Mock Test 1"
              maxLength={200}
            />
          </div>

          <div className="form-group">
            <label htmlFor="mt-description">Description</label>
            <input
              id="mt-description"
              className="form-control"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the paper covers, in one line."
              maxLength={2000}
            />
          </div>

          <div className="form-group">
            <label htmlFor="mt-instructions">Instructions shown before the test starts</label>
            <textarea
              id="mt-instructions"
              className="form-control"
              rows={4}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={5000}
            />
            <p className={styles.help}>
              Maths may be written as LaTeX between <code>$…$</code>, exactly as in a question.
            </p>
          </div>

          <div className={styles.twoUp}>
            <div className="form-group">
              <label htmlFor="mt-class">Class *</label>
              <select
                id="mt-class"
                className="form-control"
                value={classLevel}
                disabled={paperLocked}
                onChange={(e) => {
                  setClassLevel(e.target.value as ClassLevel)
                  // Questions belong to a class, so a class change invalidates the paper
                  // rather than silently keeping questions the API would then refuse.
                  if (selected.length > 0) setSelected([])
                }}
              >
                {CLASS_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="mt-duration">Duration (minutes) *</label>
              <input
                id="mt-duration"
                className="form-control"
                type="number"
                min={1}
                max={600}
                value={durationMinutes}
                disabled={paperLocked}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
              />
            </div>
          </div>

          <div className={styles.twoUp}>
            <div className="form-group">
              <label htmlFor="mt-from">Opens (optional)</label>
              <input
                id="mt-from"
                className="form-control"
                type="datetime-local"
                value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="mt-to">Closes (optional)</label>
              <input
                id="mt-to"
                className="form-control"
                type="datetime-local"
                value={availableTo}
                onChange={(e) => setAvailableTo(e.target.value)}
              />
            </div>
          </div>
          <p className={styles.help}>
            Leave both empty for a test that is open indefinitely once published. A paper started near the closing time
            is cut short at it rather than running past — and cannot be started at all with under a minute left.
          </p>

          <div className={styles.twoUp}>
            <div className="form-group">
              <label htmlFor="mt-attempts">Attempts allowed *</label>
              <input
                id="mt-attempts"
                className="form-control"
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="mt-result">When students see their score</label>
            <select
              id="mt-result"
              className="form-control"
              value={resultDisplay}
              onChange={(e) => setResultDisplay(e.target.value as ResultDisplayMode)}
            >
              {(Object.keys(RESULT_DISPLAY_LABELS) as ResultDisplayMode[]).map((value) => (
                <option key={value} value={value}>
                  {RESULT_DISPLAY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="mt-review">When students see the correct answers</label>
            <select
              id="mt-review"
              className="form-control"
              value={reviewPolicy}
              onChange={(e) => setReviewPolicy(e.target.value as ReviewPolicy)}
            >
              {(Object.keys(REVIEW_POLICY_LABELS) as ReviewPolicy[]).map((value) => (
                <option key={value} value={value}>
                  {REVIEW_POLICY_LABELS[value]}
                </option>
              ))}
            </select>
            <p className={styles.help}>
              “After the test closes” is the right choice for a scheduled assessment: releasing the answers while the
              window is open lets the first student to sit the paper pass them to everyone who has not.
            </p>
          </div>

          {needsClosingTime && (
            <p className={styles.warn}>
              A disclosure setting of “after the test closes” needs a closing time — otherwise the release could never
              happen. Set one above, or choose a different setting.
            </p>
          )}

          <div className={styles.formActions}>
            <Button onClick={() => void save()} disabled={saving || title.trim().length < 4 || selected.length === 0}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create test'}
            </Button>
            <Button variant="outline" onClick={() => navigate('/admin/mock-tests')} disabled={saving}>
              Cancel
            </Button>
          </div>
          {selected.length === 0 && <p className={styles.help}>Add at least one question before saving.</p>}
        </div>

        {/* ---------------------------------------------------------------- */}

        <div className="card">
          <h3>
            The paper — {selected.length} question{selected.length === 1 ? '' : 's'}, {totalMarks} marks
          </h3>

          {/* What a Question Bank hand-off brought over, and anything it could not use. */}
          {handoffNote && <p className={styles.handoffHint}>{handoffNote}</p>}

          {/* ----------------------------------------------------------------
              Build the paper in one action — chapter-wise, or whole syllabus
          ---------------------------------------------------------------- */}
          {!paperLocked && (
            <div className={styles.fillBar}>
              <label>
                <span>Fill from</span>
                <select className="form-control" value={fillTopic} onChange={(e) => setFillTopic(e.target.value)}>
                  <option value="">The whole syllabus</option>
                  {topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>How many</span>
                <input
                  className="form-control"
                  type="number"
                  min={1}
                  max={100}
                  value={fillCount}
                  onChange={(e) => setFillCount(Number(e.target.value))}
                />
              </label>
              <Button variant="outline" disabled={filling} onClick={() => void fillPaper()}>
                {filling ? 'Choosing…' : 'Add to the paper'}
              </Button>
              <p className={styles.help}>
                Published {classLevel} questions only. The whole syllabus spreads across every chapter
                that has some, rather than taking the most recent.
              </p>
            </div>
          )}
          {fillNote && <p className={styles.handoffHint}>{fillNote}</p>}

          {selected.length === 0 ? (
            <p className={styles.help}>
              Nothing on the paper yet. Pick published {classLevel} questions from the bank below.
            </p>
          ) : (
            <ol className={styles.paperList}>
              {selected.map((entry, index) => (
                <li key={entry.id}>
                  <div className={styles.paperStem}>
                    <MathText>{entry.questionText.slice(0, 160)}</MathText>
                  </div>
                  <div className={styles.paperControls}>
                    <label>
                      Marks
                      <input
                        className="form-control"
                        type="number"
                        min={0.25}
                        max={100}
                        step={0.25}
                        value={entry.marks}
                        onChange={(e) => patchSelected(entry.id, { marks: Number(e.target.value) })}
                        disabled={paperLocked}
                      />
                    </label>
                    <label>
                      Negative
                      <input
                        className="form-control"
                        type="number"
                        min={0}
                        max={100}
                        step={0.25}
                        value={entry.negativeMarks}
                        onChange={(e) => patchSelected(entry.id, { negativeMarks: Number(e.target.value) })}
                        disabled={paperLocked}
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => move(index, -1)}
                      disabled={index === 0 || paperLocked}
                      aria-label="Move up"
                    >
                      <Icon name="ph-arrow-up" weight="bold" size="sm" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => move(index, 1)}
                      disabled={index === selected.length - 1 || paperLocked}
                      aria-label="Move down"
                    >
                      <Icon name="ph-arrow-down" weight="bold" size="sm" />
                    </button>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => remove(entry.id)}
                      disabled={paperLocked}
                      aria-label="Remove from paper"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <h4 className={styles.pickerHead}>Add published {classLevel} questions</h4>

          <form
            className={styles.pickerFilters}
            onSubmit={(e) => {
              e.preventDefault()
              setAppliedSearch(search.trim())
            }}
          >
            <input
              className="form-control"
              placeholder="Search question text…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search questions"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>

          {pickerError && <Alert tone="danger">{pickerError}</Alert>}

          {pickerLoading ? (
            <div className={styles.centered}>
              <Spinner />
            </div>
          ) : available.length === 0 ? (
            <p className={styles.help}>
              No published questions match. A question has to be <strong>published</strong> and set for {classLevel}{' '}
              before it can go on this paper.
            </p>
          ) : (
            <ul className={styles.bankList}>
              {available.map((question) => (
                <li key={question.id}>
                  <div className={styles.bankStem}>
                    <MathText>{question.questionText.slice(0, 140)}</MathText>
                    <span className={styles.bankMeta}>
                      {question.topic?.name ?? '—'} · {question.difficulty} · {question.marks} marks
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => add(question)}
                    disabled={selectedIds.has(question.id) || paperLocked}
                  >
                    {selectedIds.has(question.id) ? 'On paper' : 'Add'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AdminShell>
  )
}
