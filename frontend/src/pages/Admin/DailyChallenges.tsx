import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import {
  CLASS_LEVELS,
  type AdminDailyChallenge,
  type AdminDailyChallengeListResponse,
  type AdminQuestion,
  type ClassLevel,
  type Pagination,
  type Subject,
} from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import MathText from '../../components/MathText'
import styles from './DailyChallenges.module.css'

/**
 * Scheduling the daily challenge (Milestone 8).
 *
 * ## Nothing here is required for the feature to work
 *
 * A day nobody schedules is filled automatically, deterministically, the first time a
 * student asks for it — and then appears in this list marked **Automatic**. This page
 * exists so a competition *can* curate the run-up to an exam, not so somebody has to
 * remember to, every day, forever. That distinction is stated on the page, because an
 * administrator who believes the feature depends on them will treat a missed day as an
 * outage.
 *
 * ## The day strip comes from the server
 *
 * `today` and `upcoming` are sent by the API rather than computed here. A competition
 * day is an **IST** calendar day, and a browser in another timezone would disagree about
 * which day today is — scheduling "today" from a laptop in London could otherwise land
 * on yesterday's challenge, which the backend would then refuse as a duplicate or, worse,
 * accept as tomorrow's.
 */

interface QuestionListResponse {
  questions: AdminQuestion[]
  pagination: Pagination
}

function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export default function AdminDailyChallenges() {
  const [data, setData] = useState<AdminDailyChallengeListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')

  const [classFilter, setClassFilter] = useState<ClassLevel | ''>('')

  // The scheduling form
  const [day, setDay] = useState('')
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 9')
  const [questionId, setQuestionId] = useState('')
  /** Set when the question was chosen in the Question Bank rather than in the picker below. */
  const [handoffNote, setHandoffNote] = useState('')
  const [searchParams] = useSearchParams()
  const [saving, setSaving] = useState(false)

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subjectId, setSubjectId] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [available, setAvailable] = useState<AdminQuestion[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '30' })
      if (classFilter) params.set('classLevel', classFilter)
      const res = await api.get<AdminDailyChallengeListResponse>(`/admin/daily-challenges?${params.toString()}`)
      setData(res)
      // Default the form to the first day with nothing scheduled for the chosen class,
      // which is the day an administrator almost always wants.
      setDay((current) => current || res.upcoming[0] || res.today)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the daily challenges.')
    } finally {
      setLoading(false)
    }
  }, [classFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    api
      .get<{ subjects: Subject[] }>('/subjects')
      .then((res) => setSubjects(res.subjects))
      .catch(() => setSubjects([]))
  }, [])

  /** Only published questions of the class being scheduled can ever be chosen. */
  const loadQuestions = useCallback(
    async (isCurrent: () => boolean) => {
      setPickerLoading(true)
      try {
        const params = new URLSearchParams({ status: 'published', classLevel, limit: '50' })
        if (subjectId) params.set('subject', subjectId)
        if (appliedSearch) params.set('search', appliedSearch)
        const res = await api.get<QuestionListResponse>(`/admin/questions?${params.toString()}`)
        if (isCurrent()) setAvailable(res.questions)
      } catch {
        if (isCurrent()) setAvailable([])
      } finally {
        if (isCurrent()) setPickerLoading(false)
      }
    },
    [classLevel, subjectId, appliedSearch],
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

  /** Which of the upcoming days already have something for the chosen class. */
  const scheduledDays = useMemo(() => {
    const set = new Set<string>()
    for (const challenge of data?.challenges ?? []) {
      if (challenge.classLevel === classLevel) set.add(challenge.day)
    }
    return set
  }, [data, classLevel])

  /**
   * Prefills the scheduler from a Question Bank selection (Milestone 21, Phase I).
   *
   * `?questionId=…&classLevel=…`, built by `questionHandoff.ts`. The class travels with the
   * question because a challenge is scheduled per class and the service refuses a question from
   * another one — carrying it means the examiner does not have to notice.
   *
   * It sets the id **without fetching the question**, unlike the mock-test hand-off, and the
   * difference is deliberate: the picker below is already loading the published questions for this
   * class and will show this one as chosen, so a second read would be the same request twice. The
   * day is deliberately **not** prefilled — a date is a decision, and guessing "tomorrow" is the
   * kind of helpfulness that ends with a challenge scheduled on a day nobody meant.
   */
  useEffect(() => {
    const wanted = searchParams.get('questionId')
    if (!wanted) return

    const wantedClass = searchParams.get('classLevel')
    if (wantedClass && (CLASS_LEVELS as readonly string[]).includes(wantedClass)) {
      setClassLevel(wantedClass as ClassLevel)
    }
    setQuestionId(wanted)
    setHandoffNote('Question brought over from the question bank. Choose a date to schedule it.')
  }, [searchParams])

  async function schedule() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.post('/admin/daily-challenges', { day, classLevel, questionId })
      setNotice(`Scheduled for ${classLevel} on ${formatDay(day)}.`)
      setQuestionId('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not schedule that challenge.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(challenge: AdminDailyChallenge) {
    setBusyId(challenge.id)
    setError('')
    setNotice('')
    try {
      await api.del(`/admin/daily-challenges/${challenge.id}`)
      setNotice(`Cleared ${challenge.classLevel} on ${formatDay(challenge.day)}.`)
      await load()
    } catch (err) {
      // Expected once anybody has answered it — the message says so.
      setError(err instanceof ApiError ? err.message : 'Could not remove that challenge.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <AdminShell title="Daily Challenge">
      <p className={styles.intro}>
        One question a day per class. <strong>Scheduling is optional</strong> — a day nobody schedules is filled
        automatically from the published bank for that class, the same question for everybody, and appears below marked
        “Automatic”. Schedule a day to choose it deliberately instead.
      </p>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className="error-text">{error}</p>}

      <div className={styles.layout}>
        {/* ---------------------------------------------------------------- */}
        <div className="card">
          <h3>Schedule a day</h3>

          <div className="form-group">
            <label htmlFor="dc-class">Class</label>
            <select
              id="dc-class"
              className="form-control"
              value={classLevel}
              onChange={(e) => {
                setClassLevel(e.target.value as ClassLevel)
                // Questions belong to a class, so the chosen one cannot survive the change.
                setQuestionId('')
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
            <label htmlFor="dc-day">Day</label>
            <select id="dc-day" className="form-control" value={day} onChange={(e) => setDay(e.target.value)}>
              {(data?.upcoming ?? []).map((value) => (
                <option key={value} value={value}>
                  {formatDay(value)}
                  {value === data?.today ? ' · today' : ''}
                  {scheduledDays.has(value) ? ' — already set' : ''}
                </option>
              ))}
            </select>
            <p className={styles.help}>
              Days are the competition’s own (IST), sent by the server rather than read from this browser. The past
              cannot be scheduled — a past day is the record of what a class was actually set.
            </p>
          </div>

          {scheduledDays.has(day) && (
            <p className={styles.warn}>
              {classLevel} already has a challenge on {formatDay(day)}. Clear it below first, or pick another day.
            </p>
          )}

          <h4 className={styles.pickerHead}>Choose a published {classLevel} question</h4>

          <form
            className={styles.pickerFilters}
            onSubmit={(e) => {
              e.preventDefault()
              setAppliedSearch(search.trim())
            }}
          >
            <select
              className="form-control"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              aria-label="Filter by subject"
            >
              <option value="">All subjects</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
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

          {pickerLoading ? (
            <div className={styles.centered}>
              <Spinner />
            </div>
          ) : available.length === 0 ? (
            <p className={styles.help}>
              No published questions for {classLevel}. A question must be <strong>published</strong> before it can be
              set as a challenge — an unpublished one would show unreviewed content to a whole class.
            </p>
          ) : (
            <ul className={styles.bankList}>
              {available.map((question) => (
                <li key={question.id} className={questionId === question.id ? styles.bankChosen : ''}>
                  <div className={styles.bankStem}>
                    <MathText>{question.questionText.slice(0, 120)}</MathText>
                    <span className={styles.bankMeta}>
                      {question.subject?.name ?? '—'} · {question.difficulty} · {question.marks} marks
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => setQuestionId(questionId === question.id ? '' : question.id)}
                  >
                    {questionId === question.id ? 'Chosen' : 'Choose'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.formActions}>
            {handoffNote && <p className={styles.handoffHint}>{handoffNote}</p>}
            <Button onClick={() => void schedule()} disabled={saving || !day || !questionId || scheduledDays.has(day)}>
              {saving ? 'Scheduling…' : 'Schedule this challenge'}
            </Button>
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        <div className="card">
          <div className={styles.listHead}>
            <h3>Scheduled and served</h3>
            <select
              className="form-control"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value as ClassLevel | '')}
              aria-label="Filter by class"
            >
              <option value="">All classes</option>
              {CLASS_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className={styles.centered}>
              <Spinner />
            </div>
          ) : (data?.challenges.length ?? 0) === 0 ? (
            <div className={styles.empty}>
              <i className="ph-bold ph-dice-five" />
              <p>
                Nothing yet. A day appears here once it has been scheduled, or once the first student of that class
                asks for it and it is filled automatically.
              </p>
            </div>
          ) : (
            <ul className={styles.dayList}>
              {data?.challenges.map((challenge) => (
                <li key={challenge.id} className={busyId === challenge.id ? styles.busy : ''}>
                  <div className={styles.dayHead}>
                    <span className={styles.dayLabel}>
                      {formatDay(challenge.day)}
                      {challenge.day === data.today && <span className={styles.todayTag}>today</span>}
                    </span>
                    <span className={styles.classTag}>{challenge.classLevel}</span>
                    <span
                      className={`${styles.sourceTag} ${
                        challenge.source === 'scheduled' ? styles.sourceScheduled : styles.sourceAutomatic
                      }`}
                    >
                      {challenge.source === 'scheduled' ? 'Scheduled' : 'Automatic'}
                    </span>
                  </div>

                  <div className={styles.dayQuestion}>
                    <MathText>{(challenge.question.questionText ?? '(question unavailable)').slice(0, 120)}</MathText>
                  </div>

                  <div className={styles.dayFooter}>
                    <span className={styles.dayStat}>
                      {challenge.attempts} answered
                      {challenge.correctPercent !== null ? ` · ${challenge.correctPercent}% correct` : ' · —'}
                    </span>
                    {challenge.attempts === 0 && (
                      <button
                        type="button"
                        className={styles.dangerButton}
                        disabled={busyId === challenge.id}
                        onClick={() => void remove(challenge)}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AdminShell>
  )
}
