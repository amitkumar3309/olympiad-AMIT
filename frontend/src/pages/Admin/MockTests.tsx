import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { CLASS_LEVELS, type AdminMockTest, type MockTestStatus, type Pagination } from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import { Alert, ButtonLink, Icon } from '../../components/ui'
import styles from './MockTests.module.css'
import { humanizeError } from '../../lib/errors'

/**
 * The mock-test list (Milestone 7) — the administrative index of every paper.
 *
 * The buttons offered per row mirror the transitions the service allows, but only as a
 * convenience: the backend re-checks every one of them, so a stale rule here can show a
 * button that then fails with a clear message and can never permit something the API
 * would refuse. Publishing in particular has conditions this page does not evaluate
 * (every question published, a closing time present when the disclosure settings need
 * one) — the refusal is displayed rather than predicted.
 */

interface ListResponse {
  tests: AdminMockTest[]
  pagination: Pagination
}

const STATUS_LABELS: Record<MockTestStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
}

/** Which statuses a test may move to, mirroring the service. UI convenience only. */
const NEXT_STATUSES: Record<MockTestStatus, MockTestStatus[]> = {
  draft: ['published', 'archived'],
  published: ['draft', 'archived'],
  archived: ['draft'],
}

const ACTION_LABELS: Record<MockTestStatus, string> = {
  published: 'Publish',
  draft: 'Unpublish',
  archived: 'Archive',
}

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
}

export default function AdminMockTests() {
  const [tests, setTests] = useState<AdminMockTest[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')

  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [status, setStatus] = useState('')
  const [classLevel, setClassLevel] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (appliedSearch) params.set('search', appliedSearch)
      if (status) params.set('status', status)
      if (classLevel) params.set('classLevel', classLevel)

      const res = await api.get<ListResponse>(`/admin/mock-tests?${params.toString()}`)
      setTests(res.tests)
      setPagination(res.pagination)
    } catch (err) {
      setError(humanizeError(err, { fallback: 'Could not load the mock tests.' }))
    } finally {
      setLoading(false)
    }
  }, [page, appliedSearch, status, classLevel])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStatus(test: AdminMockTest, next: MockTestStatus) {
    setBusyId(test.id)
    setError('')
    setNotice('')
    try {
      await api.patch(`/admin/mock-tests/${test.id}/status`, { status: next })
      setNotice(`“${test.title}” is now ${STATUS_LABELS[next].toLowerCase()}.`)
      await load()
    } catch (err) {
      setError(humanizeError(err, { fallback: 'Could not change that test.' }))
    } finally {
      setBusyId('')
    }
  }

  async function remove(test: AdminMockTest) {
    setBusyId(test.id)
    setError('')
    setNotice('')
    try {
      await api.del(`/admin/mock-tests/${test.id}`)
      setNotice(`“${test.title}” was deleted.`)
      await load()
    } catch (err) {
      // Expected for anything ever published or ever sat — the message says which.
      setError(humanizeError(err, { fallback: 'Could not delete that test.' }))
    } finally {
      setBusyId('')
    }
  }

  return (
    <AdminShell title="Mock Tests">
      <div className={styles.headerRow}>
        <p className={styles.intro}>
          Timed papers assembled from published questions. A student may only sit a test that is{' '}
          <strong>published</strong>, is for their own class, and is inside its availability window.
        </p>
        <Link to="/admin/mock-tests/new">
          <Button>+ New mock test</Button>
        </Link>
      </div>

      <div className="card">
        <form
          className={styles.filters}
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setAppliedSearch(search.trim())
          }}
        >
          <input
            className="form-control"
            placeholder="Search titles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search mock tests by title"
          />
          <select
            className="form-control"
            value={status}
            onChange={(e) => {
              setPage(1)
              setStatus(e.target.value)
            }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABELS) as MockTestStatus[]).map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            className="form-control"
            value={classLevel}
            onChange={(e) => {
              setPage(1)
              setClassLevel(e.target.value)
            }}
            aria-label="Filter by class"
          >
            <option value="">All classes</option>
            {CLASS_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <Button type="submit">Search</Button>
        </form>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <div className={styles.centered}>
          <Spinner />
        </div>
      ) : tests.length === 0 ? (
        <div className={`card ${styles.empty}`}>
          <Icon name="ph-exam" weight="bold" />
          <h2>No mock tests yet</h2>
          <p>
            Create one, add published questions to it, set a duration and a window, then publish it. Until it is
            published no student can see it.
          </p>
          <Link to="/admin/mock-tests/new">
            <Button>Create the first mock test</Button>
          </Link>
        </div>
      ) : (
        <>
          <p className={styles.count}>
            {pagination?.total ?? tests.length} test{(pagination?.total ?? tests.length) === 1 ? '' : 's'}
          </p>

          <div className={styles.list}>
            {tests.map((test) => (
              <article key={test.id} className={`card ${styles.row} ${busyId === test.id ? styles.busy : ''}`}>
                <div className={styles.rowHead}>
                  <h2>{test.title}</h2>
                  <span className={`${styles.badge} ${styles[`status_${test.status}`]}`}>
                    {STATUS_LABELS[test.status]}
                  </span>
                </div>

                <p className={styles.rowMeta}>
                  {test.classLevel} · {test.totalQuestions} question{test.totalQuestions === 1 ? '' : 's'} ·{' '}
                  {test.totalMarks} marks · {test.durationMinutes} min ·{' '}
                  {test.maxAttempts === 1 ? '1 attempt' : `${test.maxAttempts} attempts`}
                </p>

                <p className={styles.rowMeta}>
                  Opens {formatDateTime(test.availableFrom)} · Closes {formatDateTime(test.availableTo)} · Results:{' '}
                  {test.resultDisplay.replace('_', ' ')} · Answers: {test.reviewPolicy.replace('_', ' ')}
                </p>

                <div className={styles.rowActions}>
                  {/* `ui/Button` and `ButtonLink` (Milestone 26) — `.linkButton` was one
                      of five near-identical copies across the admin pages. `ButtonLink`
                      for the two that navigate: a destination must be an `<a>`, or
                      middle-click, ctrl-click and "copy link" all stop working. */}
                  <ButtonLink to={`/admin/mock-tests/${test.id}/edit`} variant="secondary" size="sm">
                    Edit
                  </ButtonLink>
                  <ButtonLink to={`/admin/mock-tests/${test.id}/results`} variant="secondary" size="sm">
                    Results
                  </ButtonLink>
                  {NEXT_STATUSES[test.status].map((next) => (
                    <Button
                      key={next}
                      variant="secondary"
                      size="sm"
                      disabled={busyId === test.id}
                      onClick={() => void changeStatus(test, next)}
                    >
                      {ACTION_LABELS[next]}
                    </Button>
                  ))}
                  {/* Only ever succeeds for a test never published and never sat; the
                      backend decides, and its refusal is shown as an error. */}
                  {!test.publishedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.dangerAction}
                      disabled={busyId === test.id}
                      onClick={() => void remove(test)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className={styles.pager}>
              <Button variant="outline" icon="ph-arrow-left" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                iconAfter="ph-arrow-right"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
      {/* The reset for this area moved to `/admin/system` in Milestone 26 - a destructive
          act belongs in one place a reader arrives at deliberately, not at the foot of
          the page they use to edit the same collection. */}
    </AdminShell>
  )
}
