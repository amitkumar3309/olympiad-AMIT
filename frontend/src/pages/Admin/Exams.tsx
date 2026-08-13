import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { CLASS_LEVELS, type AdminExam, type AdminExamAttempt, type ClassLevel, type Pagination } from '../../api/types'
import AdminShell from './AdminShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import styles from './Exams.module.css'

interface ListResponse {
  exams: AdminExam[]
  pagination: Pagination
}

/** `datetime-local` gives `2026-11-20T09:00`; the API wants a real ISO instant. */
function toIso(local: string): string {
  return new Date(local).toISOString()
}

export default function Exams() {
  const [exams, setExams] = useState<AdminExam[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [openAttempts, setOpenAttempts] = useState<{ exam: AdminExam; attempts: AdminExamAttempt[] } | null>(null)

  // Composer
  const [title, setTitle] = useState('')
  const [examCode, setExamCode] = useState('')
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 9')
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [opensAt, setOpensAt] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [merit, setMerit] = useState('60')
  const [distinction, setDistinction] = useState('85')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (statusFilter) params.set('status', statusFilter)
      const res = await api.get<ListResponse>(`/admin/exams?${params.toString()}`)
      setExams(res.exams)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the exams.')
      setExams([])
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  async function create(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setCreating(true)
    try {
      await api.post('/admin/exams', {
        title: title.trim(),
        examCode: examCode.trim().toUpperCase(),
        classLevel,
        durationMinutes: Number(durationMinutes),
        opensAt: toIso(opensAt),
        closesAt: toIso(closesAt),
        meritThresholdPercent: Number(merit),
        distinctionThresholdPercent: Number(distinction),
        questions: [],
      })
      setNotice(`“${title.trim()}” was created as a draft. Add questions before publishing.`)
      setTitle('')
      setExamCode('')
      setPage(1)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that exam.')
    } finally {
      setCreating(false)
    }
  }

  async function setStatus(exam: AdminExam, status: 'draft' | 'published' | 'archived') {
    setBusyId(exam.id)
    setError('')
    setNotice('')
    try {
      const res = await api.patch<{ exam: AdminExam }>(`/admin/exams/${exam.id}/status`, { status })
      setExams((list) => list.map((e) => (e.id === exam.id ? res.exam : e)))
      setNotice(`“${exam.title}” is now ${status}.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change that status.')
    } finally {
      setBusyId('')
    }
  }

  async function viewAttempts(exam: AdminExam) {
    setBusyId(exam.id)
    setError('')
    try {
      const res = await api.get<{ exam: AdminExam; attempts: AdminExamAttempt[] }>(`/admin/exams/${exam.id}/attempts`)
      setOpenAttempts(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the attempts.')
    } finally {
      setBusyId('')
    }
  }

  async function publish(exam: AdminExam) {
    if (
      !window.confirm(
        `Release results for “${exam.title}”?\n\nThis fixes every candidate's rank and issues their certificates. It is safe to re-run, but the ranks become visible to students immediately.`,
      )
    ) {
      return
    }
    setBusyId(exam.id)
    setError('')
    setNotice('')
    try {
      const res = await api.post<{
        publication: { candidates: number; resultsWritten: number }
        certificates: { issued: number; skipped: number }
      }>(`/admin/exams/${exam.id}/publish-results`, {})
      setNotice(
        `Released ${res.publication.resultsWritten} results for ${res.publication.candidates} candidates, and issued ${res.certificates.issued} certificates.`,
      )
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not publish those results.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <AdminShell title="Official Exam">
      <div className={`card ${styles.panel}`}>
        <h3>Schedule an official exam</h3>
        <p className={styles.hint}>
          This is the national sitting, not a mock test. The window you set is the one announced to students; each
          student gets <strong>one attempt</strong>, and results are released separately once the window has closed. A
          new exam starts as a <strong>draft</strong> — add its questions, then publish.
        </p>

        <form className={styles.form} onSubmit={create}>
          <div className="form-group">
            <label htmlFor="e-title">Title</label>
            <input id="e-title" className="form-control" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="e-code">Exam code</label>
            <input
              id="e-code"
              className="form-control"
              placeholder="AMIT-2026-C9"
              value={examCode}
              onChange={(e) => setExamCode(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="e-class">Class</label>
            <select id="e-class" className="form-control" value={classLevel} onChange={(e) => setClassLevel(e.target.value as ClassLevel)}>
              {CLASS_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="e-duration">Duration (minutes)</label>
            <input
              id="e-duration"
              type="number"
              min="1"
              max="600"
              className="form-control"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="e-opens">Opens at</label>
            <input id="e-opens" type="datetime-local" className="form-control" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="e-closes">Closes at</label>
            <input id="e-closes" type="datetime-local" className="form-control" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="e-merit">Merit at (%)</label>
            <input id="e-merit" type="number" min="1" max="100" className="form-control" value={merit} onChange={(e) => setMerit(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="e-dist">Distinction at (%)</label>
            <input id="e-dist" type="number" min="1" max="100" className="form-control" value={distinction} onChange={(e) => setDistinction(e.target.value)} />
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? 'Creating...' : 'Create draft'}
          </Button>
        </form>
      </div>

      <div className={`card ${styles.panel}`}>
        <div className={styles.filters}>
          <select
            className="form-control"
            value={statusFilter}
            onChange={(e) => {
              setPage(1)
              setStatusFilter(e.target.value)
            }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {notice && <p className={styles.notice}>{notice}</p>}
        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <Spinner label="Loading exams..." />
        ) : exams.length === 0 ? (
          <p className={styles.empty}>No official exams yet.</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>Class</th>
                  <th>Window</th>
                  <th>Paper</th>
                  <th>Status</th>
                  <th>Results</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((exam) => (
                  <tr key={exam.id} className={busyId === exam.id ? styles.busy : ''}>
                    <td>
                      <strong>{exam.title}</strong>
                      <span className={styles.code}>{exam.examCode}</span>
                    </td>
                    <td className={styles.muted}>{exam.classLevel}</td>
                    <td className={styles.muted}>
                      {new Date(exam.opensAt).toLocaleString()}
                      <br />
                      {new Date(exam.closesAt).toLocaleString()}
                    </td>
                    <td className={styles.muted}>
                      {exam.questionCount} Q · {exam.totalMarks} marks
                    </td>
                    <td>
                      <span className={styles[`status_${exam.status}`]}>{exam.status}</span>
                    </td>
                    <td className={styles.muted}>
                      {exam.resultsPublishedAt ? new Date(exam.resultsPublishedAt).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        {exam.status !== 'published' ? (
                          <button className={styles.actionBtn} disabled={busyId === exam.id} onClick={() => void setStatus(exam, 'published')}>
                            Publish
                          </button>
                        ) : (
                          <button className={styles.actionBtn} disabled={busyId === exam.id} onClick={() => void setStatus(exam, 'draft')}>
                            Unpublish
                          </button>
                        )}
                        <button className={styles.actionBtn} disabled={busyId === exam.id} onClick={() => void viewAttempts(exam)}>
                          Attempts
                        </button>
                        {/* Disabled until the window closes: ranks are a cohort fact,
                            and publishing early would rank against whoever finished first. */}
                        <button
                          className={styles.publishBtn}
                          disabled={busyId === exam.id || exam.windowState !== 'closed'}
                          title={exam.windowState !== 'closed' ? 'The window must close before results can be released' : ''}
                          onClick={() => void publish(exam)}
                        >
                          Release results
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className={styles.pager}>
            <button disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} exams
            </span>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>

      {openAttempts && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={`card ${styles.modal}`}>
            <h3>{openAttempts.exam.title} — attempts</h3>
            {openAttempts.attempts.length === 0 ? (
              <p className={styles.empty}>Nobody has sat this paper yet.</p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Status</th>
                      <th>Score</th>
                      <th>%</th>
                      <th>Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openAttempts.attempts.map((attempt) => (
                      <tr key={attempt.id}>
                        <td>
                          {attempt.fullName ?? '—'}
                          <span className={styles.code}>{attempt.studentId}</span>
                        </td>
                        <td className={styles.muted}>
                          {attempt.status === 'submitted' ? (attempt.submissionReason ?? 'submitted') : 'in progress'}
                        </td>
                        <td>
                          {attempt.score} / {attempt.maxMarks}
                        </td>
                        <td>{attempt.percentage}%</td>
                        <td className={styles.muted}>
                          {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button fullWidth onClick={() => setOpenAttempts(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </AdminShell>
  )
}
