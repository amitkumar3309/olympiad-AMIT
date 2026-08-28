import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import {
  CLASS_LEVELS,
  DIFFICULTIES,
  QUESTION_STATUSES,
  QUESTION_STATUS_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  QUESTION_SORT_KEYS,
  type AdminQuestion,
  type Pagination,
  type QuestionSortKey,
  type QuestionStatus,
  type Subject,
  type Topic,
  type BulkStatusOutcome,
  type BulkStatusResult,
  type PracticeAvailability,
  type ClassLevel,
} from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import MathText from '../../components/MathText'
import Button from '../../components/Button'
import styles from './Questions.module.css'

interface QuestionListResponse {
  questions: AdminQuestion[]
  pagination: Pagination
}

const SORT_LABELS: Record<QuestionSortKey, string> = {
  createdAt: 'Date created',
  updatedAt: 'Last edited',
  marks: 'Marks',
  difficulty: 'Difficulty',
  classLevel: 'Class',
}

/**
 * Which status a question may move to next, mirroring `ALLOWED_TRANSITIONS` in
 * `backend/src/services/questionService.ts`.
 *
 * This is a UI convenience only — it decides which buttons to offer. The backend
 * re-checks every transition, so a stale copy here can only ever show a button that
 * then fails with a clear message, never permit something the API would refuse.
 */
const NEXT_STATUSES: Record<QuestionStatus, QuestionStatus[]> = {
  draft: ['in_review', 'published', 'archived'],
  in_review: ['draft', 'published', 'archived'],
  published: ['archived', 'draft'],
  archived: ['draft'],
}

const EMPTY_FILTERS = {
  search: '',
  status: '',
  subject: '',
  topic: '',
  classLevel: '',
  difficulty: '',
  type: '',
  tag: '',
  source: '',
}

export default function Questions() {
  const { can } = useAuth()
  const canDelete = can('questions:delete')

  const [questions, setQuestions] = useState<AdminQuestion[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')

  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedSearch, setAppliedSearch] = useState('')
  const [sort, setSort] = useState<QuestionSortKey>('createdAt')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [topics, setTopics] = useState<Topic[]>([])

  /** The row whose full detail (solution, answer key) is expanded. */
  const [expandedId, setExpandedId] = useState('')

  /**
   * Bulk selection (Milestone 21, Phase G).
   *
   * Held by id rather than by index, so it survives re-sorting, re-filtering and paging — an
   * index-based selection silently retargets the moment the list order changes, which on a screen
   * whose bulk action *publishes to children* is not an acceptable failure mode.
   */
  const [selected, setSelected] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkReport, setBulkReport] = useState<{ changed: number; requested: number; refused: BulkStatusResult[] } | null>(
    null,
  )

  /** The practice preview: what a student of this class would now find in the picker. */
  const [previewClass, setPreviewClass] = useState<ClassLevel | ''>('')
  const [availability, setAvailability] = useState<PracticeAvailability | null>(null)
  const [availabilityBusy, setAvailabilityBusy] = useState(false)

  // Subjects are needed for the filter dropdown; topics narrow to the chosen
  // subject so the list cannot offer a combination that matches nothing.
  useEffect(() => {
    api
      .get<{ subjects: Subject[] }>('/subjects')
      .then((res) => setSubjects(res.subjects))
      .catch(() => setSubjects([]))
  }, [])

  useEffect(() => {
    if (!filters.subject) {
      setTopics([])
      return
    }
    api
      .get<{ topics: Topic[] }>(`/topics?subject=${filters.subject}&parent=root`)
      .then((res) => setTopics(res.topics))
      .catch(() => setTopics([]))
  }, [filters.subject])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10', sort, order })
      if (appliedSearch) params.set('search', appliedSearch)
      for (const key of ['status', 'subject', 'topic', 'classLevel', 'difficulty', 'type', 'tag', 'source'] as const) {
        if (filters[key]) params.set(key, filters[key])
      }

      const res = await api.get<QuestionListResponse>(`/admin/questions?${params.toString()}`)
      setQuestions(res.questions)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the question bank.')
      setQuestions([])
      setPagination(null)
    } finally {
      setLoading(false)
    }
  }, [page, sort, order, appliedSearch, filters])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Drops the selection when the visible list changes.
   *
   * Deliberately aggressive. A selection that survived a filter or page change would let an
   * administrator publish questions they can no longer see — and "publish" here means "show to
   * children", so a surprising selection is the one bug on this screen worth being paranoid about.
   */
  useEffect(() => {
    setSelected([])
    setBulkReport(null)
  }, [page, sort, order, appliedSearch, filters])

  async function changeStatus(question: AdminQuestion, status: QuestionStatus) {
    setBusyId(question.id)
    setError('')
    setNotice('')
    try {
      await api.patch<{ question: AdminQuestion }>(`/admin/questions/${question.id}/status`, { status })
      setNotice(`Question moved to ${QUESTION_STATUS_LABELS[status].toLowerCase()}.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that question.')
    } finally {
      setBusyId('')
    }
  }

  /**
   * Publishes (or archives) the selection.
   *
   * **This is how a question becomes practice content.** Practice is student-initiated — a student
   * picks a class, a chapter and a difficulty and the server samples what is *published* — so there
   * is no separate practice-assignment step and no admin-curated set to add questions to. Making a
   * batch of imported questions practisable is publishing them, and this is that affordance. See
   * the Milestone 21 Phase G ADR for why a `PracticeSet` collection was rejected.
   *
   * A **partial success is normal** and is shown as one: the endpoint refuses any question with no
   * solution (a published question must be explainable to a student) and reports which, while
   * publishing the rest.
   */
  async function bulkStatus(status: QuestionStatus) {
    if (selected.length === 0) return

    if (status === 'archived' && !window.confirm(`Archive ${selected.length} question(s)? Students will stop seeing them.`)) {
      return
    }

    setBulkBusy(true)
    setError('')
    setNotice('')
    setBulkReport(null)

    try {
      const outcome = await api.patch<BulkStatusOutcome>('/admin/questions/bulk-status', {
        ids: selected,
        status,
      })

      const refused = outcome.results.filter((entry) => !entry.ok)
      setBulkReport({ changed: outcome.changed, requested: outcome.requested, refused })

      if (refused.length === 0) {
        setNotice(
          `${outcome.changed} question${outcome.changed === 1 ? '' : 's'} moved to ${QUESTION_STATUS_LABELS[status].toLowerCase()}.`,
        )
      }

      // Only the ones that moved leave the selection, so the examiner can fix and retry the rest.
      setSelected(refused.map((entry) => entry.id))
      await load()

      // Publishing changes what students can practise, so the preview is refreshed rather than
      // left showing a stale count next to a success message.
      if (status === 'published' && previewClass) await loadAvailability(previewClass)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update those questions.')
    } finally {
      setBulkBusy(false)
    }
  }

  /** Asks the backend what a student of this class would find, using the picker's own function. */
  const loadAvailability = useCallback(async (classLevel: ClassLevel) => {
    setAvailabilityBusy(true)
    try {
      setAvailability(
        await api.get<PracticeAvailability>(`/admin/questions/practice-availability?classLevel=${encodeURIComponent(classLevel)}`),
      )
    } catch (err) {
      setAvailability(null)
      setError(err instanceof ApiError ? err.message : 'Could not check practice availability.')
    } finally {
      setAvailabilityBusy(false)
    }
  }, [])

  async function remove(question: AdminQuestion) {
    // Archiving is the normal removal path, so a hard delete is confirmed
    // explicitly — and the backend refuses it outright for anything ever published.
    if (!window.confirm('Delete this draft permanently? Archiving is reversible; deleting is not.')) return

    setBusyId(question.id)
    setError('')
    setNotice('')
    try {
      await api.del(`/admin/questions/${question.id}`)
      setNotice('Draft deleted.')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that question.')
    } finally {
      setBusyId('')
    }
  }

  function setFilter(key: keyof typeof EMPTY_FILTERS, value: string) {
    setPage(1)
    setFilters((current) => ({
      ...current,
      [key]: value,
      // Changing the subject invalidates any topic chosen under the old one.
      ...(key === 'subject' ? { topic: '' } : {}),
    }))
  }

  const hasFilters = Object.values(filters).some(Boolean) || appliedSearch !== ''

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setAppliedSearch('')
    setPage(1)
  }

  return (
    <AdminShell title="Question Bank">
      <div className={styles.headerRow}>
        <p className={styles.intro}>
          Author, review and publish questions. Everything starts as a draft — students only ever see questions in the{' '}
          <strong>published</strong> state. Mathematics is written as LaTeX between dollar signs, e.g.{' '}
          <code>$x^2 + 1$</code>.
        </p>
        <Link to="/admin/questions/new">
          <Button>+ New question</Button>
        </Link>
      </div>

      <form
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          setAppliedSearch(filters.search.trim())
        }}
      >
        <input
          className="form-control"
          placeholder="Search text, tags or solutions…"
          value={filters.search}
          onChange={(e) => setFilters((c) => ({ ...c, search: e.target.value }))}
          aria-label="Search questions"
        />
        <select className="form-control" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>
          {QUESTION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {QUESTION_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
        <select className="form-control" value={filters.subject} onChange={(e) => setFilter('subject', e.target.value)} aria-label="Filter by subject">
          <option value="">Any subject</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
        <select
          className="form-control"
          value={filters.topic}
          onChange={(e) => setFilter('topic', e.target.value)}
          disabled={!filters.subject}
          aria-label="Filter by topic"
        >
          <option value="">{filters.subject ? 'Any topic' : 'Choose a subject first'}</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}
            </option>
          ))}
        </select>
        <select className="form-control" value={filters.classLevel} onChange={(e) => setFilter('classLevel', e.target.value)} aria-label="Filter by class">
          <option value="">Any class</option>
          {CLASS_LEVELS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select className="form-control" value={filters.difficulty} onChange={(e) => setFilter('difficulty', e.target.value)} aria-label="Filter by difficulty">
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select className="form-control" value={filters.type} onChange={(e) => setFilter('type', e.target.value)} aria-label="Filter by question type">
          <option value="">Any type</option>
          {QUESTION_TYPES.map((value) => (
            <option key={value} value={value}>
              {QUESTION_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
        <select
          className="form-control"
          value={filters.source}
          onChange={(e) => setFilter('source', e.target.value)}
          aria-label="Filter by who drafted it"
        >
          <option value="">Anyone&rsquo;s work</option>
          <option value="human">Written by hand</option>
          <option value="ai_assisted">AI-drafted</option>
        </select>
        <input
          className="form-control"
          placeholder="Tag"
          value={filters.tag}
          onChange={(e) => setFilter('tag', e.target.value)}
          aria-label="Filter by tag"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        {hasFilters && (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </form>

      <div className={styles.sortRow}>
        <label>
          Sort by{' '}
          <select className={styles.sortSelect} value={sort} onChange={(e) => setSort(e.target.value as QuestionSortKey)} aria-label="Sort field">
            {QUESTION_SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={styles.orderToggle} onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}>
          {order === 'asc' ? '↑ Ascending' : '↓ Descending'}
        </button>
        {pagination && <span className={styles.count}>{pagination.total} question{pagination.total === 1 ? '' : 's'}</span>}
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <div className={styles.centered}>
          <Spinner />
          <p>Loading the question bank…</p>
        </div>
      ) : questions.length === 0 ? (
        <div className={styles.empty}>
          {hasFilters ? (
            <>
              <p>No question matches these filters.</p>
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <p>The question bank is empty.</p>
              <p className={styles.emptyHint}>
                Create a subject and topic under <Link to="/admin/taxonomy">Subjects &amp; Topics</Link> first, then add your
                first question.
              </p>
              <Link to="/admin/questions/new">
                <Button>+ New question</Button>
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          {/* --------------------------------------------------------------
              Bulk actions (Milestone 21, Phase G)

              "Select questions and make them available for practice" is publishing them:
              Practice samples what is published for a student's own class, so there is no
              separate assignment step and no curated set to add to.
          -------------------------------------------------------------- */}
          <div className={styles.bulkBar}>
            <label className={styles.bulkPick}>
              <input
                type="checkbox"
                checked={selected.length > 0 && selected.length === questions.length}
                // Indeterminate when only some are ticked, so "select all" is never misleading.
                ref={(el) => {
                  if (el) el.indeterminate = selected.length > 0 && selected.length < questions.length
                }}
                onChange={(e) => setSelected(e.target.checked ? questions.map((q) => q.id) : [])}
                aria-label="Select all questions on this page"
              />
              <span>
                {selected.length === 0
                  ? `Select questions to publish or archive them together`
                  : `${selected.length} of ${questions.length} selected`}
              </span>
            </label>

            {selected.length > 0 && (
              <div className={styles.bulkActions}>
                <Button variant="outline" disabled={bulkBusy} onClick={() => void bulkStatus('published')}>
                  {bulkBusy ? 'Working…' : `Publish ${selected.length} → available to practise`}
                </Button>
                <Button variant="outline" disabled={bulkBusy} onClick={() => void bulkStatus('archived')}>
                  Archive
                </Button>
                <button type="button" className={styles.linkAction} onClick={() => setSelected([])}>
                  Clear
                </button>
              </div>
            )}
          </div>

          {/*
            A partial success is the normal outcome, so the refusals are shown rather than
            collapsed into a success message. The commonest is a question with no solution: the
            editorial bar is that a published question must be explainable to a student.
          */}
          {bulkReport && bulkReport.refused.length > 0 && (
            <div className={styles.bulkReport} role="alert">
              <strong>
                {bulkReport.changed} of {bulkReport.requested} updated. {bulkReport.refused.length} refused:
              </strong>
              <ul>
                {bulkReport.refused.map((entry) => (
                  <li key={entry.id}>
                    <em>{entry.label}</em> — {entry.reason}
                  </li>
                ))}
              </ul>
              <p className={styles.emptyHint}>
                Those are still selected, so you can fix them and try again.
              </p>
            </div>
          )}

          {/* --------------------------------------------------------------
              What a student would actually find
          -------------------------------------------------------------- */}
          <div className={styles.previewBar}>
            <label>
              <span>Check what a class can practise:</span>
              <select
                className="form-control"
                value={previewClass}
                onChange={(e) => {
                  const next = e.target.value as ClassLevel | ''
                  setPreviewClass(next)
                  setAvailability(null)
                  if (next) void loadAvailability(next)
                }}
              >
                <option value="">Choose a class</option>
                {CLASS_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>

            {availabilityBusy && <span className={styles.emptyHint}>Checking…</span>}

            {availability && !availabilityBusy && (
              <div className={styles.availability}>
                {availability.totalQuestions === 0 ? (
                  <p className={styles.emptyHint}>
                    Nothing published for {availability.classLevel} yet, so its practice picker is empty. Publish
                    questions for that class above.
                  </p>
                ) : (
                  <>
                    <p>
                      <strong>{availability.totalQuestions}</strong> question
                      {availability.totalQuestions === 1 ? '' : 's'} available to practise for{' '}
                      {availability.classLevel}:
                    </p>
                    <ul className={styles.availabilityList}>
                      {availability.topics.map((topic) => (
                        <li key={topic.topicId}>
                          {topic.topicName} — {topic.questionCount} ({topic.difficulties.join(', ')})
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          <ul className={styles.list}>
          {questions.map((question) => (
            <li key={question.id} className={`${styles.card} ${busyId === question.id ? styles.busy : ''}`}>
              <div className={styles.cardHead}>
                <input
                  type="checkbox"
                  className={styles.rowPick}
                  checked={selected.includes(question.id)}
                  disabled={bulkBusy}
                  onChange={(e) =>
                    setSelected((ids) => (e.target.checked ? [...ids, question.id] : ids.filter((id) => id !== question.id)))
                  }
                  aria-label={`Select "${question.questionText.slice(0, 40)}"`}
                />
                <span className={styles[`status_${question.status}`]}>{QUESTION_STATUS_LABELS[question.status]}</span>
                <span className={styles.badge}>{QUESTION_TYPE_LABELS[question.type]}</span>
                <span className={styles.badge}>{question.classLevel}</span>
                <span className={styles.badge}>{question.difficulty}</span>
                <span className={styles.badge}>
                  {question.marks} mark{question.marks === 1 ? '' : 's'}
                  {question.negativeMarks > 0 && ` · −${question.negativeMarks}`}
                </span>
                <span className={styles.revision}>rev {question.revision}</span>
              </div>

              {/*
                Machine-drafted questions say so, on the row, naming the model and the person
                who approved them. The record is kept in order to be read: a provenance field
                nobody sees could not answer the question it exists for.
              */}
              {question.provenance?.source === 'ai_assisted' && (
                <p className={styles.provenance}>
                  <i className="ph-bold ph-sparkle" /> Drafted by{' '}
                  <strong>{question.provenance.modelName ?? 'a language model'}</strong>
                  {question.provenance.reviewedByLabel && <> · approved by {question.provenance.reviewedByLabel}</>}
                  {question.provenance.editedByReviewer && <> · edited before saving</>}
                </p>
              )}

              <MathText block className={styles.stem}>
                {question.questionText}
              </MathText>

              <div className={styles.meta}>
                {question.subject?.name ?? '—'}
                {question.topic?.name ? ` › ${question.topic.name}` : ''}
                {question.subtopic?.name ? ` › ${question.subtopic.name}` : ''}
                {question.tags.length > 0 && (
                  <span className={styles.tags}>
                    {question.tags.map((tag) => (
                      <span key={tag} className={styles.tag}>
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </div>

              {expandedId === question.id && (
                <div className={styles.detail}>
                  {question.options.length > 0 && (
                    <ol className={styles.options}>
                      {question.options.map((option) => (
                        <li key={option.key} className={option.isCorrect ? styles.optionCorrect : styles.option}>
                          <span className={styles.optionKey}>{option.key}</span>
                          <MathText>{option.text}</MathText>
                          {option.isCorrect && <span className={styles.correctFlag}>correct</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {question.type === 'true_false' && (
                    <p className={styles.answerLine}>
                      Answer: <strong>{question.booleanAnswer ? 'True' : 'False'}</strong>
                    </p>
                  )}
                  {question.type === 'numeric' && (
                    <p className={styles.answerLine}>
                      Answer: <strong>{question.numericAnswer}</strong>
                      {question.tolerance ? ` (± ${question.tolerance})` : ' (exact)'}
                    </p>
                  )}
                  <div className={styles.solution}>
                    <strong>Solution</strong>
                    {question.solution ? (
                      <MathText block>{question.solution}</MathText>
                    ) : (
                      <p className={styles.missing}>None yet — required before this question can be published.</p>
                    )}
                  </div>
                  <p className={styles.audit}>
                    Created by {question.createdByLabel ?? 'unknown'} · last edited by {question.updatedByLabel ?? 'unknown'}{' '}
                    on {new Date(question.updatedAt).toLocaleString()}
                  </p>
                </div>
              )}

              <div className={styles.actions}>
                <button type="button" className={styles.linkButton} onClick={() => setExpandedId(expandedId === question.id ? '' : question.id)}>
                  {expandedId === question.id ? 'Hide answer & solution' : 'Show answer & solution'}
                </button>
                <Link to={`/admin/questions/${question.id}/edit`} className={styles.linkButton}>
                  Edit
                </Link>
                {NEXT_STATUSES[question.status].map((next) => (
                  <button
                    key={next}
                    type="button"
                    className={styles.linkButton}
                    disabled={busyId === question.id}
                    onClick={() => void changeStatus(question, next)}
                  >
                    {next === 'draft' && question.status === 'archived' ? 'Restore to draft' : `Move to ${QUESTION_STATUS_LABELS[next].toLowerCase()}`}
                  </button>
                ))}
                {/* Offered only for a draft that has never been published — the same
                    rule the backend enforces, so the button is not a dead end. */}
                {canDelete && question.status !== 'published' && !question.publishedAt && (
                  <button type="button" className={styles.dangerButton} disabled={busyId === question.id} onClick={() => void remove(question)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
          </ul>
        </>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className={styles.pager}>
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Previous
          </Button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button variant="outline" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </Button>
        </div>
      )}
    </AdminShell>
  )
}
