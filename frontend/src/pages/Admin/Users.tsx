import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { AccountStatus, ManagedAccount, Pagination } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import AdminShell from './AdminShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import styles from './Users.module.css'

const STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  blocked: 'Blocked',
  deactivated: 'Deactivated',
}

/**
 * What each status actually means, shown in the picker. Staff pick these under
 * time pressure and the words alone do not distinguish them — "suspended" and
 * "blocked" both read as "off" — so the difference is spelled out where the choice
 * is made rather than in documentation nobody has open.
 */
const STATUS_HELP: Record<AccountStatus, string> = {
  active: 'Can sign in normally.',
  suspended: 'A temporary hold. Sign-in is barred until you lift it.',
  blocked: 'A permanent bar. Use for genuine abuse — it reads as a ban in the audit trail.',
  deactivated: 'The account is closed rather than in trouble. Reversible, and keeps all exam history.',
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

/**
 * The temporary password, shown once and never retrievable again.
 *
 * Deliberately a blocking dialog rather than a toast: this is the only moment the
 * value exists in readable form anywhere, so a message that could scroll away or
 * time out would lose it, and the only recovery is to reset again.
 */
function TemporaryPasswordDialog({
  account,
  password,
  onClose,
}: {
  account: ManagedAccount
  password: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="temp-pw-title">
      <div className={`card ${styles.modal}`}>
        <h3 id="temp-pw-title">Temporary password for {account.studentId}</h3>
        <p className={styles.modalLead}>
          Give this to {account.fullName ?? 'the account holder'} ({account.email}). They will be asked to choose their
          own password the moment they sign in.
        </p>
        <div className={styles.tempPassword}>
          <code>{password}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(password).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className={styles.modalWarn}>
          This is shown only once. If you close this without noting it down, you will have to reset again.
        </p>
        <Button fullWidth onClick={onClose}>
          I have noted it down
        </Button>
      </div>
    </div>
  )
}

/** Confirmation for the one administrative action that cannot be undone. */
function DeleteAccountDialog({
  account,
  busy,
  onCancel,
  onConfirm,
}: {
  account: ManagedAccount
  busy: boolean
  onCancel: () => void
  onConfirm: (confirmStudentId: string) => void
}) {
  const [typed, setTyped] = useState('')

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className={`card ${styles.modal}`}>
        <h3 id="delete-title">Delete {account.studentId} permanently?</h3>
        <p className={styles.modalLead}>
          This removes the account and its registration photo for good. It cannot be undone. Only unverified accounts
          can be deleted — a verified one should be deactivated instead, which is reversible and keeps its history.
        </p>
        <div className="form-group">
          <label htmlFor="delete-confirm">
            Type <strong>{account.studentId}</strong> to confirm
          </label>
          <input
            id="delete-confirm"
            className="form-control"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            disabled={busy || typed.trim() !== account.studentId}
            onClick={() => onConfirm(typed.trim())}
          >
            {busy ? 'Deleting...' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Users() {
  const { can } = useAuth()
  const canWriteStatus = can('students:status:write')
  const canWriteRole = can('users:role:write')
  const canResetPassword = can('users:password:reset')
  const canRevokeSessions = can('users:sessions:revoke')
  const canDelete = can('users:delete')

  const [accounts, setAccounts] = useState<ManagedAccount[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  /** The one-time temporary password, held until the dialog is dismissed. */
  const [issued, setIssued] = useState<{ account: ManagedAccount; password: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ManagedAccount | null>(null)

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

  async function resetPassword(account: ManagedAccount) {
    setBusyId(account.studentId)
    setError('')
    setNotice('')
    try {
      const res = await api.post<{ temporaryPassword: string; student: ManagedAccount }>(
        `/admin/users/${account.studentId}/reset-password`,
        {},
      )
      setAccounts((list) => list.map((a) => (a.studentId === account.studentId ? res.student : a)))
      // Held in state rather than announced, because it must survive until the
      // dialog is dismissed — see `TemporaryPasswordDialog`.
      setIssued({ account: res.student, password: res.temporaryPassword })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset that password.')
    } finally {
      setBusyId('')
    }
  }

  async function revokeSessions(account: ManagedAccount) {
    setBusyId(account.studentId)
    setError('')
    setNotice('')
    try {
      await api.post(`/admin/users/${account.studentId}/revoke-sessions`, {})
      setNotice(`${account.studentId} has been signed out on every device. They can sign back in as normal.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign that account out.')
    } finally {
      setBusyId('')
    }
  }

  async function deleteAccount(account: ManagedAccount, confirmStudentId: string) {
    setBusyId(account.studentId)
    setError('')
    setNotice('')
    try {
      await api.del(`/admin/users/${account.studentId}`, { confirmStudentId })
      setPendingDelete(null)
      setNotice(`${account.studentId} (${account.email}) has been permanently deleted.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that account.')
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
      {issued && (
        <TemporaryPasswordDialog
          account={issued.account}
          password={issued.password}
          onClose={() => {
            setIssued(null)
            setNotice(`A temporary password was issued for ${issued.account.studentId}. All their sessions were ended.`)
          }}
        />
      )}
      {pendingDelete && (
        <DeleteAccountDialog
          account={pendingDelete}
          busy={busyId === pendingDelete.studentId}
          onCancel={() => setPendingDelete(null)}
          onConfirm={(confirmStudentId) => void deleteAccount(pendingDelete, confirmStudentId)}
        />
      )}
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
            {(Object.keys(STATUS_LABELS) as AccountStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
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
            <option value="superadmin">Super admin</option>
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
                      {account.mustChangePassword && (
                        <span className={styles.pendingReset} title="A temporary password is outstanding">
                          reset pending
                        </span>
                      )}
                    </td>
                    <td className={styles.muted}>{account.classLevel ?? '—'}</td>
                    <td className={styles.muted}>{account.schoolName ?? '—'}</td>
                    <td className={styles.email}>{account.email}</td>
                    <td>
                      <span className={account.role === 'student' ? styles.roleStudent : styles.roleAdmin}>
                        {account.role === 'superadmin' ? 'super admin' : account.role}
                      </span>
                    </td>
                    <td>
                      <span className={styles[`status_${account.status}`]}>{STATUS_LABELS[account.status]}</span>
                    </td>
                    <td className={styles.muted}>
                      {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td>
                      {/* The super administrator is not manageable through the API at
                          all — the backend refuses every one of these. Offering the
                          buttons anyway would just be a row of guaranteed errors. */}
                      {account.role === 'superadmin' ? (
                        <span className={styles.muted} title="Managed through the deployment environment, not the app">
                          Protected
                        </span>
                      ) : (
                      <div className={styles.actions}>
                        {canWriteStatus && (
                          <select
                            className={styles.actionSelect}
                            value={account.status}
                            disabled={busyId === account.studentId}
                            onChange={(e) => void changeStatus(account, e.target.value as AccountStatus)}
                            aria-label={`Change status for ${account.studentId}`}
                            title={STATUS_HELP[account.status]}
                          >
                            {(Object.keys(STATUS_LABELS) as AccountStatus[]).map((status) => (
                              <option key={status} value={status} title={STATUS_HELP[status]}>
                                {STATUS_LABELS[status]}
                              </option>
                            ))}
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
                        {canResetPassword && (
                          <button
                            className={styles.actionBtn}
                            disabled={busyId === account.studentId}
                            onClick={() => void resetPassword(account)}
                            title="Issues a one-time password and signs the account out everywhere"
                          >
                            Reset password
                          </button>
                        )}
                        {canRevokeSessions && (
                          <button
                            className={styles.actionBtn}
                            disabled={busyId === account.studentId}
                            onClick={() => void revokeSessions(account)}
                            title="Ends every active session without changing anything else"
                          >
                            Sign out
                          </button>
                        )}
                        {/* Deletion is offered only where it can actually succeed: a
                            verified account is refused by the backend, so showing the
                            button would be an invitation to a 409. */}
                        {canDelete && !account.isEmailVerified && (
                          <button
                            className={styles.dangerBtn}
                            disabled={busyId === account.studentId}
                            onClick={() => setPendingDelete(account)}
                            title="Permanently deletes this unverified account"
                          >
                            Delete
                          </button>
                        )}
                        {!canWriteStatus && !canWriteRole && !canResetPassword && !canRevokeSessions && (
                          <span className={styles.muted}>View only</span>
                        )}
                      </div>
                      )}
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
