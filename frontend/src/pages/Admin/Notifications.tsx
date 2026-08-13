import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { CLASS_LEVELS, type AdminNotification, type ClassLevel, type Pagination } from '../../api/types'
import AdminShell from './AdminShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import styles from './Notifications.module.css'

interface ListResponse {
  notifications: AdminNotification[]
  pagination: Pagination
}

export default function Notifications() {
  const [items, setItems] = useState<AdminNotification[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [page, setPage] = useState(1)
  const [publishedFilter, setPublishedFilter] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  // Composer
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'all' | 'class'>('all')
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 9')
  const [kind, setKind] = useState<'announcement' | 'alert'>('announcement')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (publishedFilter) params.set('published', publishedFilter)
      if (appliedSearch) params.set('search', appliedSearch)

      const res = await api.get<ListResponse>(`/admin/notifications?${params.toString()}`)
      setItems(res.notifications)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load announcements.')
      setItems([])
      setPagination(null)
    } finally {
      setLoading(false)
    }
  }, [page, publishedFilter, appliedSearch])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(e: FormEvent, publishNow: boolean) {
    e.preventDefault()
    setError('')
    setNotice('')
    setSubmitting(true)
    try {
      await api.post('/admin/notifications', {
        title: title.trim(),
        body: body.trim(),
        kind,
        audience,
        classLevel: audience === 'class' ? classLevel : null,
        isPublished: publishNow,
      })
      setNotice(
        publishNow
          ? `“${title.trim()}” is now visible to ${audience === 'all' ? 'every student' : classLevel}.`
          : `“${title.trim()}” was saved as a draft. Students cannot see it yet.`,
      )
      setTitle('')
      setBody('')
      setPage(1)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that announcement.')
    } finally {
      setSubmitting(false)
    }
  }

  async function togglePublished(item: AdminNotification) {
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      const res = await api.patch<{ notification: AdminNotification }>(`/admin/notifications/${item.id}`, {
        isPublished: !item.isPublished,
      })
      setItems((list) => list.map((i) => (i.id === item.id ? res.notification : i)))
      setNotice(
        res.notification.isPublished
          ? `“${item.title}” is now published.`
          : `“${item.title}” was withdrawn. It is hidden from every inbox — though anyone who already read it has seen it.`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that announcement.')
    } finally {
      setBusyId('')
    }
  }

  async function remove(item: AdminNotification) {
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      await api.del(`/admin/notifications/${item.id}`)
      setNotice(`“${item.title}” was deleted.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that announcement.')
    } finally {
      setBusyId('')
    }
  }

  function applySearch(e: FormEvent) {
    e.preventDefault()
    setPage(1)
    setAppliedSearch(search.trim())
  }

  return (
    <AdminShell title="Notifications">
      <div className={`card ${styles.panel}`}>
        <h3>Write an announcement</h3>
        <p className={styles.hint}>
          Announcements appear in each student's in-app inbox. Nothing is emailed. Save a draft to write it now and
          publish later — students see nothing until it is published.
        </p>

        <form onSubmit={(e) => void submit(e, true)}>
          <div className="form-group">
            <label htmlFor="n-title">Title</label>
            <input id="n-title" className="form-control" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="n-body">Message</label>
            <textarea
              id="n-body"
              className="form-control"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />
          </div>

          <div className={styles.row}>
            <div className="form-group">
              <label htmlFor="n-audience">Audience</label>
              <select
                id="n-audience"
                className="form-control"
                value={audience}
                onChange={(e) => setAudience(e.target.value as 'all' | 'class')}
              >
                <option value="all">Every student</option>
                <option value="class">One class</option>
              </select>
            </div>
            {audience === 'class' && (
              <div className="form-group">
                <label htmlFor="n-class">Class</label>
                <select
                  id="n-class"
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
            )}
            <div className="form-group">
              <label htmlFor="n-kind">Kind</label>
              <select
                id="n-kind"
                className="form-control"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'announcement' | 'alert')}
              >
                <option value="announcement">Announcement</option>
                <option value="alert">Alert</option>
              </select>
            </div>
          </div>

          <div className={styles.actions}>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Publish now'}
            </Button>
            <button type="button" className={styles.secondaryBtn} disabled={submitting} onClick={(e) => void submit(e, false)}>
              Save as draft
            </button>
          </div>
        </form>
      </div>

      <div className={`card ${styles.panel}`}>
        <form className={styles.filters} onSubmit={applySearch}>
          <input
            className="form-control"
            placeholder="Search title or message"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search announcements"
          />
          <select
            className="form-control"
            value={publishedFilter}
            onChange={(e) => {
              setPage(1)
              setPublishedFilter(e.target.value)
            }}
            aria-label="Filter by state"
          >
            <option value="">All</option>
            <option value="true">Published</option>
            <option value="false">Drafts</option>
          </select>
          <button type="submit" className={styles.searchBtn}>
            Search
          </button>
        </form>

        {notice && <p className={styles.notice}>{notice}</p>}
        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <Spinner label="Loading announcements..." />
        ) : items.length === 0 ? (
          <p className={styles.empty}>
            {appliedSearch || publishedFilter ? 'Nothing matches these filters.' : 'No announcements yet.'}
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Audience</th>
                  <th>State</th>
                  <th>Read by</th>
                  <th>Written</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={busyId === item.id ? styles.busy : ''}>
                    <td>
                      <strong>{item.title}</strong>
                      <span className={styles.bodyPreview}>{item.body}</span>
                    </td>
                    <td className={styles.muted}>{item.audience === 'all' ? 'Every student' : (item.classLevel ?? '—')}</td>
                    <td>
                      <span className={item.isPublished ? styles.published : styles.draft}>
                        {item.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    {/* A real count of students who opened it — the only honest reach figure. */}
                    <td className={styles.muted}>{item.readCount}</td>
                    <td className={styles.muted}>
                      {new Date(item.createdAt).toLocaleDateString()}
                      {item.createdByLabel ? ` · ${item.createdByLabel}` : ''}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          className={styles.actionBtn}
                          disabled={busyId === item.id}
                          onClick={() => void togglePublished(item)}
                        >
                          {item.isPublished ? 'Withdraw' : 'Publish'}
                        </button>
                        <button className={styles.dangerBtn} disabled={busyId === item.id} onClick={() => void remove(item)}>
                          Delete
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
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} announcements
            </span>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </AdminShell>
  )
}
