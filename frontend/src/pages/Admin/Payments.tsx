import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, API_BASE } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import type { AdminPaymentsResponse, PaymentRecord, PaymentSettingsResponse } from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import styles from './Payments.module.css'

/**
 * The payments console (Milestone 19).
 *
 * Two jobs that belong together: **what has been collected**, and **what is being
 * charged**. Splitting them across two pages would mean an administrator changing a
 * price without seeing what the current one has taken.
 *
 * ## Every figure here is counted
 *
 * `collectedDisplay` and the per-status counts come from an aggregation over the
 * `Payment` collection — no estimates, no projections, following the rule the rest of
 * the admin area follows. Where nothing has been paid, this shows ₹0.00 and an empty
 * table, because "nobody has paid yet" is a fact worth stating plainly.
 *
 * ## The switch is the important control
 *
 * `entryFeeEnabled` is what makes the paywall real. Turning it off admits every student
 * to everything immediately, and it exists for two situations that have no other
 * answer: a provider outage during an exam window, and a decision to run a cohort free.
 * It is not a debug flag, so it is labelled and confirmed rather than hidden.
 */

const STATUS_FILTERS = ['', 'created', 'attempted', 'captured', 'failed', 'refunded'] as const

function statusClass(status: PaymentRecord['status']): string {
  if (status === 'captured') return styles.ok
  if (status === 'failed') return styles.bad
  return styles.pending
}

export default function AdminPayments() {
  const { can } = useAuth()
  const [data, setData] = useState<AdminPaymentsResponse | null>(null)
  const [settings, setSettings] = useState<PaymentSettingsResponse | null>(null)
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('')

  // The fee is edited in **rupees**, because that is what an administrator thinks in.
  // It is converted to paise on the way out, once, here — the API and the database
  // only ever deal in integer paise.
  const [feeRupees, setFeeRupees] = useState('')
  const [enabled, setEnabled] = useState(true)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  /** Only a super admin (or whoever holds it) may *change* the fee; reading is wider. */
  const mayEdit = can('students:status:write')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [payments, feeSettings] = await Promise.all([
        api.get<AdminPaymentsResponse>(`/admin/payments${status ? `?status=${status}` : ''}`),
        api.get<PaymentSettingsResponse>('/admin/payment-settings'),
      ])
      setData(payments)
      setSettings(feeSettings)
      setFeeRupees((feeSettings.olympiadEntryFee / 100).toFixed(2))
      setEnabled(feeSettings.entryFeeEnabled)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load payments.')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  async function saveSettings() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const paise = Math.round(Number(feeRupees) * 100)
      if (!Number.isFinite(paise) || paise < 100) {
        setError('The fee must be at least ₹1.00 — Razorpay refuses an order below one rupee.');
        return
      }
      const saved = await api.put<PaymentSettingsResponse>('/admin/payment-settings', {
        olympiadEntryFee: paise,
        entryFeeEnabled: enabled,
      })
      setSettings((current) => (current ? { ...current, ...saved } : saved))
      setNotice(
        `Saved. New entrants pay ${saved.amountDisplay}${
          saved.entryFeeEnabled ? '.' : ', and the gate is currently OFF — everybody has full access.'
        }`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the fee.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminShell title="Payments">
      {error && <p className="error-text">{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      {loading && !data ? (
        <div className={styles.centered}>
          <Spinner />
        </div>
      ) : (
        <>
          {/* ---------------------------------------------------------------
              The fee itself
          --------------------------------------------------------------- */}
          <section className={`card ${styles.settings}`}>
            <h3 className={styles.sectionTitle}>Entry fee</h3>

            {settings?.providerConfigured === false && (
              <div className={styles.warn}>
                <i className="ph-bold ph-warning" />
                <div>
                  <strong>Razorpay is not configured.</strong> No student can pay until{' '}
                  <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> are set in the backend environment.
                  While the fee is switched on, students will be told payment is unavailable rather than being let in.
                </div>
              </div>
            )}

            <div className={styles.feeRow}>
              <label className={styles.field}>
                <span>Fee (₹)</span>
                <input
                  className="form-control"
                  type="number"
                  min={1}
                  step="0.01"
                  value={feeRupees}
                  disabled={!mayEdit}
                  onChange={(e) => setFeeRupees(e.target.value)}
                />
              </label>

              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!mayEdit}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span>
                  <strong>Charge the entry fee</strong>
                  <em>
                    {enabled
                      ? 'On — practice, mock tests, the daily challenge and the exam need a paid entry.'
                      : 'Off — every student has full access without paying.'}
                  </em>
                </span>
              </label>
            </div>

            <div className={styles.warn}>
              <i className="ph-bold ph-info" />
              <div>
                <strong>Changing the price never re-prices a payment already taken.</strong> Each row below stores what
                was actually charged, so a change here applies to the next student and to nobody who has already paid.
              </div>
            </div>

            {mayEdit ? (
              <Button onClick={() => void saveSettings()} disabled={saving}>
                {saving ? 'Saving…' : 'Save fee settings'}
              </Button>
            ) : (
              <p className={styles.readonly}>You can see the fee but not change it.</p>
            )}
          </section>

          {/* ---------------------------------------------------------------
              What has been collected
          --------------------------------------------------------------- */}
          <section className={styles.totals}>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>Collected</span>
              <span className={styles.totalValue}>{data?.collectedDisplay ?? '₹0.00'}</span>
              <span className={styles.totalNote}>Captured payments only — money actually taken.</span>
            </div>
            {(data?.byStatus ?? []).map((row) => (
              <div key={row.status} className={`card ${styles.total}`}>
                <span className={styles.totalLabel}>{row.status}</span>
                <span className={styles.totalValue}>{row.count}</span>
                <span className={styles.totalNote}>₹{(row.amount / 100).toFixed(2)}</span>
              </div>
            ))}
          </section>

          {/* ---------------------------------------------------------------
              The transactions
          --------------------------------------------------------------- */}
          <section className="card">
            <div className={styles.tableHead}>
              <h3 className={styles.sectionTitle}>Transactions</h3>
              <label className={styles.filter}>
                <span>Status</span>
                <select
                  className="form-control"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as (typeof STATUS_FILTERS)[number])}
                >
                  {STATUS_FILTERS.map((value) => (
                    <option key={value || 'all'} value={value}>
                      {value === '' ? 'All' : value}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(data?.payments.length ?? 0) === 0 ? (
              <p className={styles.empty}>
                {status
                  ? `No payments with status “${status}”.`
                  : 'No payments yet. Rows appear here the moment a student opens the checkout.'}
              </p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Method</th>
                      <th>Order</th>
                      <th>When</th>
                      <th>Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          <span className={styles.name}>{payment.student?.fullName ?? '—'}</span>
                          <span className={styles.sub}>{payment.student?.studentId ?? ''}</span>
                        </td>
                        <td className={styles.mono}>{payment.amountDisplay}</td>
                        <td>
                          <span className={`${styles.pill} ${statusClass(payment.status)}`}>{payment.status}</span>
                          {payment.failureReason && <span className={styles.sub}>{payment.failureReason}</span>}
                        </td>
                        <td>{payment.method ?? '—'}</td>
                        <td className={styles.mono}>{payment.razorpayOrderId}</td>
                        <td>
                          {new Date(payment.capturedAt ?? payment.createdAt).toLocaleString()}
                          {!payment.capturedAt && <span className={styles.sub}>not captured</span>}
                        </td>
                        <td>
                          {/*
                            Offered only where it can succeed. An invoice exists for a
                            **captured** payment and nothing else, so a link on an
                            attempted or failed row would be an invitation to a 409 —
                            and, worse, would suggest a receipt exists for money that
                            was never taken.
                          */}
                          {payment.status === 'captured' ? (
                            <a className={styles.invoiceLink} href={`${API_BASE}/admin/payments/${payment.id}/invoice`}>
                              <i className="ph-bold ph-download-simple" /> PDF
                            </a>
                          ) : (
                            <span className={styles.sub}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={styles.foot}>Showing the 100 most recent payments.</p>
          </section>
        </>
      )}
    </AdminShell>
  )
}
