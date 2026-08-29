import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { DrainOutcome, EmailCategory, EmailDelivery, EmailStatus, OutboxStats, Pagination } from '../../api/types'
import AdminShell from './AdminShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { Alert, Icon, Table, TableScroll } from '../../components/ui'
import styles from './EmailDeliveries.module.css'

interface ListResponse {
  deliveries: EmailDelivery[]
  stats: OutboxStats
  pagination: Pagination
  /** Where the links inside these emails point. See the banner below. */
  linkBase?: { url: string; configured: boolean }
}

const STATUSES: EmailStatus[] = ['pending', 'sent', 'failed']
const CATEGORIES: EmailCategory[] = ['transactional', 'security', 'announcement', 'results']

/**
 * The email delivery console (Milestone 14).
 *
 * This page exists because **a queue nobody can see is a queue nobody trusts**. Before
 * this milestone, email was sent inline and a failure was swallowed into a single log
 * line — so "did that student ever get their verification link?" was a question the
 * product could not answer, by anyone, ever. Since login requires verification, that
 * was not a cosmetic gap.
 *
 * Every figure is counted from the outbox collection, and nothing here is estimated —
 * the same rule the rest of the admin figures follow. `oldestPendingAt` is the honest
 * answer to "is the queue stuck?", which a bare pending count cannot give.
 */
export default function EmailDeliveries() {
  const [deliveries, setDeliveries] = useState<EmailDelivery[]>([])
  const [linkBase, setLinkBase] = useState<{ url: string; configured: boolean } | null>(null)
  const [stats, setStats] = useState<OutboxStats | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<EmailStatus | ''>('')
  const [category, setCategory] = useState<EmailCategory | ''>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (status) params.set('status', status)
      if (category) params.set('category', category)

      const res = await api.get<ListResponse>(`/admin/email-deliveries?${params.toString()}`)
      setDeliveries(res.deliveries)
      setStats(res.stats)
      setLinkBase(res.linkBase ?? null)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the delivery log.')
      setDeliveries([])
      setPagination(null)
    } finally {
      setLoading(false)
    }
  }, [page, status, category])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Sends what is queued, now.
   *
   * Necessary rather than a convenience: the free tier has no scheduler, so delivery
   * is driven by an opportunistic kick when a message is queued plus a sweep on later
   * requests. On a quiet site neither may happen soon, and "the mail goes out when
   * somebody visits the site" is not a promise an organiser can make to a parent.
   */
  async function drain() {
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const res = await api.post<{ drain: DrainOutcome; stats: OutboxStats }>('/admin/email-deliveries/drain', {})
      setStats(res.stats)
      setNotice(describeDrain(res.drain))
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the queued email.')
    } finally {
      setWorking(false)
    }
  }

  async function retry() {
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const res = await api.post<{ requeued: number; drain: DrainOutcome; stats: OutboxStats }>(
        '/admin/email-deliveries/retry',
        {},
      )
      setStats(res.stats)
      setNotice(
        res.requeued === 0
          ? 'There were no failed messages to requeue.'
          : `${res.requeued} failed message${res.requeued === 1 ? '' : 's'} requeued. ${describeDrain(res.drain)}`,
      )
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not requeue those messages.')
    } finally {
      setWorking(false)
    }
  }

  function describeDrain(outcome: DrainOutcome): string {
    if (outcome.claimed === 0) return 'Nothing was waiting to be sent.'
    const parts = [`${outcome.sent} sent`]
    if (outcome.retrying > 0) parts.push(`${outcome.retrying} failed and will be retried`)
    if (outcome.failed > 0) parts.push(`${outcome.failed} gave up after the last attempt`)
    return `${parts.join(', ')}.`
  }

  return (
    <AdminShell title="Email delivery">
      {/* A message can be delivered perfectly and still be useless: if FRONTEND_URL is
          unset, every link in it points at localhost. That is invisible in the table
          below — the row says "sent" — so it is called out here, above everything. */}
      {linkBase && !linkBase.configured && (
        <div className={`card ${styles.linkWarning}`}>
          <Icon name="ph-warning-circle" weight="bold" />
          <div>
            <strong>Every link in these emails points at {linkBase.url}</strong>
            <p>
              That address is your own machine, not a site your students can reach, so verification and password-reset
              links are dead for everyone who receives one — even the messages below marked <em>sent</em>. Set{' '}
              <code>FRONTEND_URL</code> to your real frontend URL in the backend&rsquo;s environment variables and
              redeploy the backend. Students who already registered can then be recovered with <em>resend
              verification</em>; their accounts are fine.
            </p>
          </div>
        </div>
      )}

      <div className={`card ${styles.panel}`}>
        <p className={styles.intro}>
          Every email the platform sends is queued here first and delivered in the background, so no student's
          registration, password reset or result ever waits on the mail provider. A message that fails is retried with
          a growing delay, and gives up only after its last attempt — at which point it stays on this page rather than
          disappearing.
        </p>

        {stats && (
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.pending}</span>
              <span className={styles.statLabel}>Queued</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.sent}</span>
              <span className={styles.statLabel}>Sent</span>
            </div>
            <div className={`${styles.stat} ${stats.failed > 0 ? styles.statBad : ''}`}>
              <span className={styles.statValue}>{stats.failed}</span>
              <span className={styles.statLabel}>Gave up</span>
            </div>
            <div className={styles.stat}>
              {/*
                The one figure that answers "is the queue stuck?". A pending count
                alone cannot: three queued messages is healthy if they arrived a second
                ago and a problem if the oldest has been waiting since Tuesday.
              */}
              <span className={styles.statValue}>
                {stats.oldestPendingAt ? new Date(stats.oldestPendingAt).toLocaleString() : '—'}
              </span>
              <span className={styles.statLabel}>Oldest still queued</span>
            </div>
          </div>
        )}

        <div className={styles.toolbar}>
          <select className="form-control" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value as EmailStatus | '') }}>
            <option value="">Any status</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select className="form-control" value={category} onChange={(e) => { setPage(1); setCategory(e.target.value as EmailCategory | '') }}>
            <option value="">Any category</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Button type="button" disabled={working} onClick={() => void drain()}>
            {working ? 'Working...' : 'Send queued now'}
          </Button>
          <button type="button" className={styles.secondaryBtn} disabled={working} onClick={() => void retry()}>
            Requeue failed
          </button>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <p className={styles.notice}>{notice}</p>}

        {loading ? (
          <Spinner label="Loading the delivery log..." />
        ) : deliveries.length === 0 ? (
          <p className={styles.empty}>
            {status || category
              ? 'No messages match that filter.'
              : 'No email has been queued yet. Messages appear here as soon as anything is sent.'}
          </p>
        ) : (
          <TableScroll label="Email deliveries">
            <Table density="compact">
              <thead>
                <tr>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((row) => (
                  <tr key={row.id}>
                    <td className={styles.mono}>{row.to}</td>
                    {/* The subject only. A delivery record has no business
                        reproducing the contents of somebody's reset email. */}
                    <td>{row.subject}</td>
                    <td>{row.category}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[row.status]}`}>{row.status}</span>
                      {row.lastError && <p className={styles.errorDetail}>{row.lastError}</p>}
                    </td>
                    <td>
                      {row.attempts} / {row.maxAttempts}
                    </td>
                    <td className={styles.when}>
                      {row.status === 'sent' && row.sentAt
                        ? `Sent ${new Date(row.sentAt).toLocaleString()}`
                        : row.status === 'pending'
                          ? `Due ${new Date(row.nextAttemptAt).toLocaleString()}`
                          : `Last tried ${row.lastAttemptAt ? new Date(row.lastAttemptAt).toLocaleString() : '—'}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
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
    </AdminShell>
  )
}
