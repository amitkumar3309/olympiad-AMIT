import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, API_BASE } from '../../api/client'
import {
  CLASS_LEVELS,
  type AccountStatus,
  type ManagedAccount,
  type Pagination,
  type StudentDirectoryEntry,
  type StudentPaymentState,
} from '../../api/types'
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
 * The five payment states, and what each one means to the person reading the row.
 *
 * `not_started` is deliberately worded as a neutral fact rather than as a failure: most
 * of the directory is students who registered and have not paid yet, and a screen that
 * renders the ordinary case as a problem trains staff to ignore the colour.
 */
const PAYMENT_LABELS: Record<StudentPaymentState, string> = {
  paid: 'Paid',
  pending: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
  not_started: 'Not started',
}

const PAYMENT_HELP: Record<StudentPaymentState, string> = {
  paid: 'A payment was captured. This student has their seat in the Olympiad.',
  pending: 'A checkout was opened and has not resolved either way. It may still complete.',
  failed: 'The most recent attempt failed and none has succeeded.',
  refunded: 'Money was taken and returned.',
  not_started: 'Registered, and has never opened a checkout.',
}

/** Sort options offered in the toolbar, mapped to what the API accepts. */
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'registeredAt:desc', label: 'Newest registrations' },
  { value: 'registeredAt:asc', label: 'Oldest registrations' },
  { value: 'fullName:asc', label: 'Name (A–Z)' },
  { value: 'fullName:desc', label: 'Name (Z–A)' },
  { value: 'classLevel:asc', label: 'Class (low to high)' },
  { value: 'paymentState:asc', label: 'Payment status' },
  { value: 'paymentAmount:desc', label: 'Amount paid (high to low)' },
  { value: 'lastLoginAt:desc', label: 'Recently signed in' },
]

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
  students: StudentDirectoryEntry[]
  pagination: Pagination
}

/**
 * One payment cell: the state, and the detail that makes it actionable.
 *
 * A chip alone answers "did they pay?" and nothing else, which is the question staff ask
 * *second*. The first is usually "how much, when, and what went wrong" — so the amount and
 * capture date sit under a paid chip, and the provider's own failure reason under a failed
 * one. The order id is on the `title`, because it is what support asks for and it is far
 * too long to put in a column.
 */
function PaymentCell({ entry }: { entry: StudentDirectoryEntry }) {
  const { payment, paymentState } = entry

  return (
    <div className={styles.paymentCell}>
      <span className={styles[`pay_${paymentState}`]} title={PAYMENT_HELP[paymentState]}>
        {PAYMENT_LABELS[paymentState]}
      </span>
      {paymentState === 'paid' && payment && (
        <span className={styles.paymentDetail} title={`Order ${payment.razorpayOrderId}`}>
          {payment.amountDisplay}
          {payment.capturedAt ? ` · ${new Date(payment.capturedAt).toLocaleDateString()}` : ''}
          {payment.method ? ` · ${payment.method}` : ''}
        </span>
      )}
      {paymentState === 'failed' && payment?.failureReason && (
        <span className={styles.paymentDetail} title={`Order ${payment.razorpayOrderId}`}>
          {payment.failureReason}
        </span>
      )}
      {paymentState === 'pending' && payment && (
        <span className={styles.paymentDetail} title={`Order ${payment.razorpayOrderId}`}>
          {payment.amountDisplay} · started {new Date(payment.createdAt).toLocaleDateString()}
        </span>
      )}
      {paymentState === 'refunded' && payment && (
        <span className={styles.paymentDetail} title={`Order ${payment.razorpayOrderId}`}>
          {payment.amountDisplay} returned
        </span>
      )}
    </div>
  )
}

/**
 * Folds an updated account back into its directory row.
 *
 * The status, role and password-reset endpoints answer with a `ManagedAccount` — the
 * account half only, because those routes hold a document and know nothing about payments.
 * Assigning it over the row would therefore blank the payment column of whichever student
 * an administrator had just acted on, which looks exactly like the student having lost
 * their payment. Merging keeps the half the response did not speak about.
 */
function mergeAccount(row: StudentDirectoryEntry, updated: ManagedAccount): StudentDirectoryEntry {
  return { ...row, ...updated }
}

/** Saves a downloaded blob under a filename, without leaving the page. */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Reads the filename the server chose out of `Content-Disposition`.
 *
 * The server names the file (`students-export-YYYY-MM-DD.xlsx`) because the date on it
 * should be the date the data was read, not the date on the browser's clock — which can
 * be wrong, and in a different timezone is routinely a day out.
 */
function filenameFrom(header: string | null, fallback: string): string {
  const match = header ? /filename="([^"]+)"/.exec(header) : null
  return match?.[1] ?? fallback
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

  const [accounts, setAccounts] = useState<StudentDirectoryEntry[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  /** The one-time temporary password, held until the dialog is dismissed. */
  const [issued, setIssued] = useState<{ account: ManagedAccount; password: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ManagedAccount | null>(null)
  /** Which export is in flight, so both buttons can say what they are doing. */
  const [exporting, setExporting] = useState<'filtered' | 'all' | null>(null)

  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sortChoice, setSortChoice] = useState('registeredAt:desc')
  const [page, setPage] = useState(1)

  /**
   * The filters, as query parameters — built once and used by **both** the listing and the
   * export, so "Download Excel" cannot fetch a different set of students from the one on
   * screen. The server enforces the same thing on its side by running one pipeline; this
   * is the client half of the promise.
   */
  const filterParams = useCallback(() => {
    const params = new URLSearchParams()
    if (appliedSearch) params.set('search', appliedSearch)
    if (statusFilter) params.set('status', statusFilter)
    if (roleFilter) params.set('role', roleFilter)
    if (classFilter) params.set('classLevel', classFilter)
    if (paymentFilter) params.set('paymentState', paymentFilter)
    if (fromDate) params.set('registeredFrom', fromDate)
    if (toDate) params.set('registeredTo', toDate)

    const [sort, order] = sortChoice.split(':')
    if (sort) params.set('sort', sort)
    if (order) params.set('order', order)
    return params
  }, [appliedSearch, statusFilter, roleFilter, classFilter, paymentFilter, fromDate, toDate, sortChoice])

  const anyFilter = Boolean(
    appliedSearch || statusFilter || roleFilter || classFilter || paymentFilter || fromDate || toDate,
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = filterParams()
      params.set('page', String(page))
      params.set('limit', '20')

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
  }, [page, filterParams])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Downloads the directory as `.xlsx`.
   *
   * Fetched directly rather than through `api.get`, because the response body is a file
   * rather than the `{ success, ... }` envelope the client wrapper parses. Same-origin in
   * both environments (`frontend/vercel.json` rewrites `/api/*`), so the session cookie
   * rides along and the endpoint's own authorization applies — this button is a
   * convenience, never the gate.
   *
   * A failure still arrives as JSON, so the server's own message is read out of it: the
   * one an administrator is most likely to meet is the row cap, and "narrow it by class"
   * is only useful advice if it actually reaches them.
   */
  async function downloadExcel(scope: 'filtered' | 'all') {
    setExporting(scope)
    setError('')
    setNotice('')
    try {
      const params = scope === 'all' ? new URLSearchParams({ scope: 'all' }) : filterParams()
      const res = await fetch(`${API_BASE}/admin/students/export?${params.toString()}`, {
        credentials: 'include',
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `The export failed (${res.status}).`)
      }

      const filename = filenameFrom(
        res.headers.get('content-disposition'),
        `students-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
      )
      triggerDownload(await res.blob(), filename)
      setNotice(
        scope === 'all'
          ? 'Downloaded every registered student.'
          : `Downloaded the ${pagination?.total ?? 0} student${pagination?.total === 1 ? '' : 's'} matching your current filters.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download that export.')
    } finally {
      setExporting(null)
    }
  }

  async function changeStatus(account: ManagedAccount, status: AccountStatus) {
    setBusyId(account.studentId)
    setError('')
    setNotice('')
    try {
      const res = await api.patch<{ changed: boolean; student: ManagedAccount }>(
        `/admin/students/${account.studentId}/status`,
        { status },
      )
      setAccounts((list) => list.map((a) => (a.studentId === account.studentId ? mergeAccount(a, res.student) : a)))
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
      setAccounts((list) => list.map((a) => (a.studentId === account.studentId ? mergeAccount(a, res.student) : a)))
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
      setAccounts((list) => list.map((a) => (a.studentId === account.studentId ? mergeAccount(a, res.student) : a)))
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

  /** Clears every filter at once — the way back from a search that found nothing. */
  function clearFilters() {
    setSearch('')
    setAppliedSearch('')
    setStatusFilter('')
    setRoleFilter('')
    setClassFilter('')
    setPaymentFilter('')
    setFromDate('')
    setToDate('')
    setPage(1)
  }

  return (
    <AdminShell title="All Students">
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

          {/* Second row: the filters added with the directory. Separate from the first so
              the search box keeps its width — this is the control staff use most. */}
          <select
            className="form-control"
            value={classFilter}
            onChange={(e) => {
              setPage(1)
              setClassFilter(e.target.value)
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
          <select
            className="form-control"
            value={paymentFilter}
            onChange={(e) => {
              setPage(1)
              setPaymentFilter(e.target.value)
            }}
            aria-label="Filter by payment status"
          >
            {/* "All payment statuses" is the default and must stay the default: the
                directory exists to show everyone who registered, not everyone who paid. */}
            <option value="">All payment statuses</option>
            {(Object.keys(PAYMENT_LABELS) as StudentPaymentState[]).map((state) => (
              <option key={state} value={state} title={PAYMENT_HELP[state]}>
                {PAYMENT_LABELS[state]}
              </option>
            ))}
          </select>
          <select
            className="form-control"
            value={sortChoice}
            onChange={(e) => {
              setPage(1)
              setSortChoice(e.target.value)
            }}
            aria-label="Sort by"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className={styles.dateRange}>
            <label htmlFor="registered-from">Registered</label>
            <input
              id="registered-from"
              className="form-control"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => {
                setPage(1)
                setFromDate(e.target.value)
              }}
              aria-label="Registered on or after"
            />
            <span>to</span>
            <input
              className="form-control"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => {
                setPage(1)
                setToDate(e.target.value)
              }}
              aria-label="Registered on or before"
            />
            {anyFilter && (
              <button type="button" className={styles.clearBtn} onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </form>

        {/* What the two download buttons will actually produce, stated before they are
            pressed. An export whose scope the administrator has to guess at is how a
            filtered file gets mistaken for the whole roll. */}
        <div className={styles.exportBar}>
          <div className={styles.exportSummary}>
            {pagination ? (
              <>
                <strong>{pagination.total.toLocaleString('en-IN')}</strong>
                {anyFilter ? ' students match your filters' : ' registered accounts'}
                {anyFilter && ' — everyone else is hidden by a filter, not missing.'}
              </>
            ) : (
              'Loading the directory…'
            )}
          </div>
          <div className={styles.exportActions}>
            <button
              type="button"
              className={styles.exportBtn}
              disabled={exporting !== null || !pagination}
              onClick={() => void downloadExcel('filtered')}
              title="Downloads exactly the students listed below, with the filters you have applied"
            >
              <i className="ph-bold ph-download-simple" />{' '}
              {exporting === 'filtered'
                ? 'Building…'
                : anyFilter
                  ? `Download Excel (${pagination?.total ?? 0} filtered)`
                  : 'Download Excel'}
            </button>
            {anyFilter && (
              <button
                type="button"
                className={styles.exportSecondary}
                disabled={exporting !== null}
                onClick={() => void downloadExcel('all')}
                title="Ignores every filter and exports every registered student"
              >
                {exporting === 'all' ? 'Building…' : 'Download all students'}
              </button>
            )}
          </div>
        </div>

        {notice && <p className={styles.notice}>{notice}</p>}
        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <Spinner label="Loading accounts..." />
        ) : accounts.length === 0 ? (
          <p className={styles.empty}>
            {anyFilter ? 'No accounts match these filters.' : 'No accounts have been registered yet.'}
            {anyFilter && (
              <>
                {' '}
                <button type="button" className={styles.linkBtn} onClick={clearFilters}>
                  Clear the filters
                </button>{' '}
                to see everyone.
              </>
            )}
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
                  <th>Phone</th>
                  <th>Payment</th>
                  <th>Registered</th>
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
                    <td className={styles.mono}>{account.mobile}</td>
                    <td>
                      <PaymentCell entry={account} />
                    </td>
                    <td className={styles.muted}>{new Date(account.registeredAt).toLocaleDateString()}</td>
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
