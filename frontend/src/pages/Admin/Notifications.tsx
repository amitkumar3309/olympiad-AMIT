import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import {
  CLASS_LEVELS,
  type AdminNotification,
  type BroadcastOutcome,
  type ClassLevel,
  type Pagination,
} from '../../api/types'
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
  /** Empty means the server's default, which is the staff stream. */
  const [sourceFilter, setSourceFilter] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  // Composer
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'all' | 'class'>('all')
  const [classLevel, setClassLevel] = useState<ClassLevel>('Class 9')
  const [kind, setKind] = useState<'announcement' | 'alert'>('announcement')
  const [emailBroadcast, setEmailBroadcast] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (publishedFilter) params.set('published', publishedFilter)
      if (sourceFilter) params.set('source', sourceFilter)
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
  }, [page, publishedFilter, sourceFilter, appliedSearch])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(e: FormEvent, publishNow: boolean) {
    e.preventDefault()
    setError('')
    setNotice('')
    setSubmitting(true)
    try {
      const res = await api.post<{ broadcast: BroadcastOutcome | null }>('/admin/notifications', {
        title: title.trim(),
        body: body.trim(),
        kind,
        audience,
        classLevel: audience === 'class' ? classLevel : null,
        isPublished: publishNow,
        // Only meaningful together with publication; a draft emails nobody.
        emailBroadcast: publishNow && emailBroadcast,
      })
      setNotice(
        publishNow
          ? `“${title.trim()}” is now visible to ${audience === 'all' ? 'every student' : classLevel}.` +
            describeBroadcast(res.broadcast)
          : `“${title.trim()}” was saved as a draft. Students cannot see it yet.`,
      )
      setTitle('')
      setBody('')
      setEmailBroadcast(false)
      setPage(1)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that announcement.')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Reports what the email half actually did.
   *
   * Suppressed recipients are named rather than hidden. Staff who email 72 students
   * and see "60 queued" need to know the other 12 chose not to receive announcements —
   * otherwise the honest outcome reads as a bug, and the natural next move is to send
   * it again.
   */
  function describeBroadcast(broadcast: BroadcastOutcome | null): string {
    if (!broadcast) return ''

    const parts = [`${broadcast.queued} email${broadcast.queued === 1 ? '' : 's'} queued`]
    if (broadcast.suppressed > 0) {
      parts.push(`${broadcast.suppressed} skipped (announcement emails switched off)`)
    }
    if (broadcast.cappedAt !== null) {
      parts.push(`capped at the first ${broadcast.cappedAt} recipients`)
    }
    return ` ${parts.join('; ')}.`
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

          {/*
            Email is opt-in per announcement, and unchecked by default.

            Milestone 12 shipped notifications in-app only because emailing the whole
            roll from a free tier is a deliverability problem. That has not changed —
            what changed is that staff can now decide a particular notice is worth it.
            Leaving this on by default would quietly undo the reasoning, so it resets
            after every send.
          */}
          <label className={styles.emailOptIn}>
            <input type="checkbox" checked={emailBroadcast} onChange={(e) => setEmailBroadcast(e.target.checked)} />
            <span>
              <strong>Also send this by email</strong>
              <em>
                Queued and delivered in the background, so publishing is not held up. Students who have switched
                announcement emails off are skipped, and the recipient list is capped — everyone still sees it in their
                inbox either way.
              </em>
            </span>
          </label>

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
          {/*
            Defaults to the staff stream, which is what the server does when this is
            omitted. Releasing one national exam's results writes a system row per
            candidate, so listing both by default would bury the announcements this
            page exists to manage.
          */}
          <select
            className="form-control"
            value={sourceFilter}
            onChange={(e) => {
              setPage(1)
              setSourceFilter(e.target.value)
            }}
            aria-label="Filter by who wrote it"
          >
            <option value="">Written by staff</option>
            <option value="system">Sent automatically</option>
            <option value="all">Both</option>
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
                      {item.source === 'system' && <span className={styles.systemTag}>Automatic</span>}
                      <span className={styles.bodyPreview}>{item.body}</span>
                    </td>
                    <td className={styles.muted}>
                      {item.audience === 'all'
                        ? 'Every student'
                        : item.audience === 'student'
                          ? 'One student'
                          : (item.classLevel ?? '—')}
                    </td>
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
                        {/*
                          A system row cannot be withdrawn or edited — the backend
                          refuses with a 409, and offering a button that always fails
                          would be worse than not offering it. Delete stays available:
                          housekeeping is not falsification.
                        */}
                        {item.source === 'staff' && (
                          <button
                            className={styles.actionBtn}
                            disabled={busyId === item.id}
                            onClick={() => void togglePublished(item)}
                          >
                            {item.isPublished ? 'Withdraw' : 'Publish'}
                          </button>
                        )}
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
