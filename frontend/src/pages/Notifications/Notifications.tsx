import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { InboxNotification, Pagination } from '../../api/types'
import StudentShell from '../../components/StudentShell'
import Spinner from '../../components/Spinner'
import styles from './Notifications.module.css'

interface InboxResponse {
  notifications: InboxNotification[]
  unread: number
  pagination: Pagination
}

/**
 * The student's own notice board — **everything** the platform has told them.
 *
 * That completeness is the point, and it is why nothing here can be switched off.
 * Since Milestone 14 some of these are also emailed and some of those emails can be
 * declined, so this page is the one place where the record is guaranteed whole: a
 * student who never opens their email still finds their result here.
 *
 * Two things arrive from the server and are not decided here: `source` (whether a
 * human or the platform wrote it) and `link` (where the thing it is about lives). The
 * page renders them; it never infers either from the text.
 */
export default function Notifications() {
  const [items, setItems] = useState<InboxNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (unreadOnly) params.set('unreadOnly', 'true')

      const res = await api.get<InboxResponse>(`/me/notifications?${params.toString()}`)
      setItems(res.notifications)
      setUnread(res.unread)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your notifications.')
      setItems([])
      setPagination(null)
    } finally {
      setLoading(false)
    }
  }, [page, unreadOnly])

  useEffect(() => {
    void load()
  }, [load])

  async function markRead(item: InboxNotification) {
    if (item.read) return
    setBusyId(item.id)
    try {
      const res = await api.post<{ unread: number }>(`/me/notifications/${item.id}/read`, {})
      setUnread(res.unread)
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, read: true, readAt: new Date().toISOString() } : i)))
    } catch {
      // Marking read is a convenience, not the point of the page — a failure here
      // must not bury the announcement the student came to read.
    } finally {
      setBusyId('')
    }
  }

  async function markAllRead() {
    try {
      const res = await api.post<{ unread: number }>('/me/notifications/read-all', {})
      setUnread(res.unread)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update your notifications.')
    }
  }

  return (
    <StudentShell title="Notifications">
      <div className={`card ${styles.panel}`}>
        <div className={styles.toolbar}>
          <span className={styles.count}>
            {unread > 0 ? `${unread} unread` : 'All caught up'}
          </span>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => {
                setPage(1)
                setUnreadOnly(e.target.checked)
              }}
            />
            Unread only
          </label>
          {unread > 0 && (
            <button className={styles.linkBtn} onClick={() => void markAllRead()}>
              Mark all as read
            </button>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <Spinner label="Loading your notifications..." />
        ) : items.length === 0 ? (
          <p className={styles.empty}>
            {unreadOnly ? 'Nothing unread.' : 'No notifications yet. Announcements from the organisers will appear here.'}
          </p>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li
                key={item.id}
                className={`${styles.item} ${item.read ? '' : styles.unreadItem} ${busyId === item.id ? styles.busy : ''}`}
                onMouseEnter={() => void markRead(item)}
              >
                <div className={styles.itemHead}>
                  <strong>{item.title}</strong>
                  {item.kind === 'alert' && <span className={styles.alertTag}>Alert</span>}
                  {item.source === 'system' && <span className={styles.systemTag}>Automatic</span>}
                  {!item.read && <span className={styles.dot} aria-label="Unread" />}
                </div>
                {/*
                  `white-space: pre-line` in the stylesheet, because the server writes
                  multi-line bodies (a result carries score, rank and certificate on
                  separate lines). Still a plain text node — notification copy never
                  goes near an HTML sink.
                */}
                <p className={styles.body}>{item.body}</p>
                <span className={styles.meta}>
                  {item.publishedAt ? new Date(item.publishedAt).toLocaleString() : ''}
                  {item.audience === 'class' && item.classLevel ? ` · ${item.classLevel}` : ''}
                  {item.audience === 'student' ? ' · Just for you' : ''}
                </span>
                {item.link && (
                  <Link className={styles.action} to={item.link}>
                    Take me there <i className="ph ph-arrow-right" aria-hidden="true" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className={styles.pager}>
            <button disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </StudentShell>
  )
}
