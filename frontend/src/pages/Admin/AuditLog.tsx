import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { AuditAction, AuditEntry, Pagination } from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import styles from './AuditLog.module.css'

const ACTION_LABELS: Record<AuditAction, string> = {
  'user.role.changed': 'Role changed',
  'student.status.changed': 'Account status changed',
  'questions.generated': 'Questions generated',
  'admin.session.started': 'Admin signed in',
  'authz.denied': 'Permission denied',
}

interface AuditListResponse {
  entries: AuditEntry[]
  pagination: Pagination
}

/** Renders the action-specific detail without pretending to know every shape. */
function describe(entry: AuditEntry): string {
  const meta = entry.metadata
  if (!meta) return '—'
  const parts: string[] = []
  if (typeof meta.from === 'string' && typeof meta.to === 'string') parts.push(`${meta.from} → ${meta.to}`)
  if (typeof meta.count === 'number') parts.push(`${meta.count} question(s)`)
  if (Array.isArray(meta.missing) && meta.missing.length > 0) parts.push(`needed ${meta.missing.join(', ')}`)
  if (typeof meta.method === 'string') parts.push(String(meta.method))
  if (typeof meta.reason === 'string' && meta.reason) parts.push(`“${meta.reason}”`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (actionFilter) params.set('action', actionFilter)
      if (outcomeFilter) params.set('outcome', outcomeFilter)

      const res = await api.get<AuditListResponse>(`/admin/audit-logs?${params.toString()}`)
      setEntries(res.entries)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the audit trail.')
      setEntries([])
      setPagination(null)
    } finally {
      setLoading(false)
    }
  }, [page, actionFilter, outcomeFilter])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AdminShell title="Audit Log">
      <div className={`card ${styles.panel}`}>
        <p className={styles.intro}>
          Every administrative action, and every refused attempt at one. Refusals are recorded on purpose: a run of them
          against the same account is what an attempt to escalate privileges looks like.
        </p>

        <div className={styles.filters}>
          <select
            className="form-control"
            value={actionFilter}
            onChange={(e) => {
              setPage(1)
              setActionFilter(e.target.value)
            }}
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="form-control"
            value={outcomeFilter}
            onChange={(e) => {
              setPage(1)
              setOutcomeFilter(e.target.value)
            }}
            aria-label="Filter by outcome"
          >
            <option value="">All outcomes</option>
            <option value="success">Succeeded</option>
            <option value="denied">Denied</option>
          </select>
        </div>

        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <Spinner label="Loading the audit trail..." />
        ) : entries.length === 0 ? (
          <p className={styles.empty}>
            No entries recorded yet. Administrative actions will appear here as they happen.
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>Detail</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className={styles.muted}>{new Date(entry.createdAt).toLocaleString()}</td>
                    <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td>
                      <span className={styles.actor}>{entry.actorLabel}</span>
                      <span className={styles.actorRole}>{entry.actorRole}</span>
                    </td>
                    <td className={styles.mono}>{entry.targetId ?? entry.targetLabel ?? '—'}</td>
                    <td className={styles.detail}>{describe(entry)}</td>
                    <td>
                      <span className={entry.outcome === 'denied' ? styles.denied : styles.success}>
                        {entry.outcome}
                      </span>
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
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} entries
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
