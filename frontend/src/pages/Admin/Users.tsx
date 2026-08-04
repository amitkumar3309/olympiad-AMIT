import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { AccountStatus, ManagedAccount, Pagination } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import styles from './Users.module.css'

const STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
}

interface StudentListResponse {
  students: ManagedAccount[]
  pagination: Pagination
}

/**
 * The registration photo, fetched straight from the API as an image rather than
 * through `api.get` — it is raw image bytes, not a JSON envelope. The request is
 * same-origin in both environments (`frontend/vercel.json` rewrites `/api/*` to
 * the backend), so the session cookie rides along and the endpoint's own
 * authorization check applies. Accounts registered before Milestone 4 have no
 * photo, so a 404 is expected and falls back to initials.
 */
function StudentPhoto({ studentId, name }: { studentId: string; name: string | null }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span className={styles.photoFallback} aria-label="No photo on file">
        {(name ?? '?').trim().charAt(0).toUpperCase() || '?'}
      </span>
    )
  }

  return (
    <img
      className={styles.photo}
      src={`/api/v1/students/${studentId}/photo`}
      alt={name ? `Photo of ${name}` : 'Student photo'}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

export default function Users() {
  const { can } = useAuth()
  const canWriteStatus = can('students:status:write')
  const canWriteRole = can('users:role:write')

  const [accounts, setAccounts] = useState<ManagedAccount[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')

  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (appliedSearch) params.set('search', appliedSearch)
      if (statusFilter) params.set('status', statusFilter)
      if (roleFilter) params.set('role', roleFilter)

      const res = await api.get<StudentListResponse>(`/admin/students?${params.toString()}`)
      setAccounts(res.students)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load accounts.')
      setAccounts([])
      setPagination(null)
    } finally {
      setLoading(false)
    }
  }, [page, appliedSearch, statusFilter, roleFilter])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStatus(account: ManagedAccount, status: AccountStatus) {
    setBusyId(account.studentId)
    setError('')
    setNotice('')
    try {
      const res = await api.patch<{ changed: boolean; student: ManagedAccount }>(
        `/admin/students/${account.studentId}/status`,
        { status },
      )
      setAccounts((list) => list.map((a) => (a.studentId === account.studentId ? res.student : a)))
      setNotice(
        res.changed
          ? `${account.studentId} is now ${STATUS_LABELS[status].toLowerCase()}. Any active sessions were ended.`
          : `${account.studentId} was already ${STATUS_LABELS[status].toLowerCase()}.`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that account.')
    } finally {
      setBusyId('')
    }
  }

  async function changeRole(account: ManagedAccount, role: 'student' | 'admin') {
    setBusyId(account.studentId)
    setError('')
    setNotice('')
    try {
      const res = await api.patch<{ changed: boolean; student: ManagedAccount }>(
        `/admin/users/${account.studentId}/role`,
        { role },
      )
      setAccounts((list) => list.map((a) => (a.studentId === account.studentId ? res.student : a)))
      const article = role === 'admin' ? 'an' : 'a'
      setNotice(
        res.changed
          ? `${account.studentId} is now ${article} ${role}. They must sign in again for the change to apply.`
          : `${account.studentId} was already ${article} ${role}.`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that role.')
    } finally {
      setBusyId('')
    }
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setAppliedSearch(search.trim())
  }

  return (
    <AdminShell title="User Management">
      <div className={`card ${styles.panel}`}>
        <form className={styles.filters} onSubmit={applySearch}>
          <input
            className="form-control"
            placeholder="Search name, email, mobile or student ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search accounts"
          />
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
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
          </select>
          <select
            className="form-control"
            value={roleFilter}
            onChange={(e) => {
              setPage(1)
              setRoleFilter(e.target.value)
            }}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            <option value="student">Students</option>
            <option value="admin">Admins</option>
          </select>
          <button type="submit" className={styles.searchBtn}>
            Search
          </button>
        </form>

        {notice && <p className={styles.notice}>{notice}</p>}
        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <Spinner label="Loading accounts..." />
        ) : accounts.length === 0 ? (
          <p className={styles.empty}>
            No accounts match these filters.
            {appliedSearch || statusFilter || roleFilter ? ' Try widening your search.' : ''}
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Student ID</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>School</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className={busyId === account.studentId ? styles.busy : ''}>
                    <td>
                      <StudentPhoto studentId={account.studentId} name={account.fullName} />
                    </td>
                    <td className={styles.mono}>{account.studentId}</td>
                    <td>
                      {account.fullName ?? '—'}
                      {!account.isEmailVerified && <span className={styles.unverified}>unverified</span>}
                    </td>
                    <td className={styles.muted}>{account.classLevel ?? '—'}</td>
                    <td className={styles.muted}>{account.schoolName ?? '—'}</td>
                    <td className={styles.email}>{account.email}</td>
                    <td>
                      <span className={account.role === 'admin' ? styles.roleAdmin : styles.roleStudent}>
                        {account.role}
                      </span>
                    </td>
                    <td>
                      <span className={styles[`status_${account.status}`]}>{STATUS_LABELS[account.status]}</span>
                    </td>
                    <td className={styles.muted}>
                      {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        {canWriteStatus && (
                          <select
                            className={styles.actionSelect}
                            value={account.status}
                            disabled={busyId === account.studentId}
                            onChange={(e) => void changeStatus(account, e.target.value as AccountStatus)}
                            aria-label={`Change status for ${account.studentId}`}
                          >
                            <option value="active">Active</option>
                            <option value="suspended">Suspended</option>
                            <option value="deactivated">Deactivated</option>
                          </select>
                        )}
                        {/* Only rendered for a super admin — and the backend refuses it
                            for anyone else regardless of what the UI shows. */}
                        {canWriteRole && (
                          <button
                            className={styles.roleBtn}
                            disabled={busyId === account.studentId}
                            onClick={() => void changeRole(account, account.role === 'admin' ? 'student' : 'admin')}
                          >
                            {account.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                          </button>
                        )}
                        {!canWriteStatus && !canWriteRole && <span className={styles.muted}>View only</span>}
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
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} accounts
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
