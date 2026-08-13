import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, API_BASE } from '../../api/client'
import type { Certificate, CertificateTier, Pagination } from '../../api/types'
import AdminShell from './AdminShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import styles from './Certificates.module.css'

interface ListResponse {
  certificates: Certificate[]
  pagination: Pagination
}

const TIERS: CertificateTier[] = ['participation', 'merit', 'distinction']

export default function Certificates() {
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [page, setPage] = useState(1)
  const [tier, setTier] = useState('')
  const [revokedFilter, setRevokedFilter] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [pendingRevoke, setPendingRevoke] = useState<Certificate | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (tier) params.set('tier', tier)
      if (revokedFilter) params.set('revoked', revokedFilter)
      if (appliedSearch) params.set('search', appliedSearch)

      const res = await api.get<ListResponse>(`/admin/certificates?${params.toString()}`)
      setCertificates(res.certificates)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the certificates.')
      setCertificates([])
    } finally {
      setLoading(false)
    }
  }, [page, tier, revokedFilter, appliedSearch])

  useEffect(() => {
    void load()
  }, [load])

  async function revoke(certificate: Certificate) {
    setBusyId(certificate.id)
    setError('')
    setNotice('')
    try {
      await api.post(`/admin/certificates/${certificate.id}/revoke`, { reason: reason.trim() })
      setNotice(
        `${certificate.certificateId} was revoked. Verification now reports it as withdrawn rather than missing, because a printed copy may still exist.`,
      )
      setPendingRevoke(null)
      setReason('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke that certificate.')
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
    <AdminShell title="Certificates">
      <div className={`card ${styles.panel}`}>
        <p className={styles.hint}>
          Certificates are issued <strong>only</strong> by releasing an official exam's results — there is no way to
          issue one by hand, which is what makes a certificate a statement about a result rather than a decision. They
          can be <strong>revoked</strong> but never deleted, so verification can say "issued and since withdrawn"
          instead of "no such certificate".
        </p>

        <form className={styles.filters} onSubmit={applySearch}>
          <input
            className="form-control"
            placeholder="Search name, student ID or certificate no."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search certificates"
          />
          <select
            className="form-control"
            value={tier}
            onChange={(e) => {
              setPage(1)
              setTier(e.target.value)
            }}
            aria-label="Filter by tier"
          >
            <option value="">All tiers</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            className="form-control"
            value={revokedFilter}
            onChange={(e) => {
              setPage(1)
              setRevokedFilter(e.target.value)
            }}
            aria-label="Filter by state"
          >
            <option value="">All</option>
            <option value="false">Valid</option>
            <option value="true">Revoked</option>
          </select>
          <button type="submit" className={styles.searchBtn}>
            Search
          </button>
        </form>

        {notice && <p className={styles.notice}>{notice}</p>}
        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <Spinner label="Loading certificates..." />
        ) : certificates.length === 0 ? (
          <p className={styles.empty}>
            {appliedSearch || tier || revokedFilter
              ? 'Nothing matches these filters.'
              : 'No certificates have been issued yet. They appear here when an official exam’s results are released.'}
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Certificate no.</th>
                  <th>Student</th>
                  <th>Exam</th>
                  <th>Award</th>
                  <th>Result</th>
                  <th>Issued</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {certificates.map((certificate) => (
                  <tr key={certificate.id} className={busyId === certificate.id ? styles.busy : ''}>
                    <td className={styles.mono}>{certificate.certificateId}</td>
                    <td>
                      {certificate.studentName}
                      <span className={styles.code}>{certificate.studentIdLabel}</span>
                    </td>
                    <td className={styles.muted}>
                      {certificate.examTitle}
                      <span className={styles.code}>{certificate.examCode}</span>
                    </td>
                    <td>
                      <span className={styles[`tier_${certificate.tier}`]}>{certificate.tier}</span>
                    </td>
                    <td className={styles.muted}>
                      {certificate.percentage}% · rank {certificate.rank}/{certificate.totalCandidates}
                    </td>
                    <td className={styles.muted}>{new Date(certificate.issuedAt).toLocaleDateString()}</td>
                    <td>
                      <div className={styles.actions}>
                        <a
                          className={styles.actionBtn}
                          href={`${API_BASE}/admin/certificates/${certificate.id}/download`}
                        >
                          PDF
                        </a>
                        {certificate.revoked ? (
                          <span className={styles.revoked} title={certificate.revokedReason ?? undefined}>
                            revoked
                          </span>
                        ) : (
                          <button
                            className={styles.dangerBtn}
                            disabled={busyId === certificate.id}
                            onClick={() => {
                              setPendingRevoke(certificate)
                              setReason('')
                            }}
                          >
                            Revoke
                          </button>
                        )}
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
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} certificates
            </span>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>

      {pendingRevoke && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={`card ${styles.modal}`}>
            <h3>Revoke {pendingRevoke.certificateId}?</h3>
            <p className={styles.modalLead}>
              {pendingRevoke.studentName} will no longer be able to download it, and public verification will report it
              as withdrawn. The record is kept — a printed copy may exist in the world, and its holder deserves a
              straight answer rather than "no such certificate".
            </p>
            <div className="form-group">
              <label htmlFor="revoke-reason">Reason (recorded in the audit trail)</label>
              <input
                id="revoke-reason"
                className="form-control"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Issued against a paper later found to be compromised"
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setPendingRevoke(null)}>
                Cancel
              </button>
              <Button disabled={reason.trim().length < 3 || busyId === pendingRevoke.id} onClick={() => void revoke(pendingRevoke)}>
                Revoke certificate
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  )
}
