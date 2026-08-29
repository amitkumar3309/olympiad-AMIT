import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import type {
  AdminReferralRow,
  AdminReferralSettings,
  AdminReferralsResponse,
  ReferralRewardStatus,
} from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import { Alert, Icon, Table, TableScroll } from '../../components/ui'
import styles from './Referrals.module.css'

/**
 * The referral console (Milestone 22, Phase G).
 *
 * Two jobs that belong on one page: **what is owed**, and **what a referral is worth**.
 * Splitting them would mean an administrator changing the reward without seeing what the
 * current one has already accrued — the same argument that keeps the fee beside the
 * collected total on the payments console.
 *
 * ## What this page can and cannot do
 *
 * It can move a reward along a fixed path and it can set the amount for *future*
 * conversions. It **cannot create a reward, choose what an individual referral is worth,
 * or pay somebody who was not introduced** — the amount is snapshotted server-side when a
 * referral converts, and no request from here carries one. That is what stops the console
 * being a way to pay an arbitrary sum to an arbitrary person, and it is enforced by the API
 * rather than by this file.
 *
 * ## Every figure is counted
 *
 * The three totals are programme-wide sums from the collection, not the current page —
 * "what do we owe?" must not change as somebody pages. Where nothing has accrued they read
 * ₹0.00, because that is the true answer.
 */

const STATUS_LABELS: Record<ReferralRewardStatus, string> = {
  pending_conversion: 'Awaiting entry fee',
  no_reward: 'Converted · no reward',
  accrued: 'Reward accrued',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Rejected',
}

const STATUS_HELP: Record<ReferralRewardStatus, string> = {
  pending_conversion: 'The referred student registered but has not paid the entry fee.',
  no_reward: 'They paid, but no reward was configured at that moment. Nothing is owed.',
  accrued: 'They paid while a reward was configured. This is owed, pending your approval.',
  approved: 'Approved and awaiting payout.',
  paid: 'Paid out. This is terminal.',
  rejected: 'Refused, with a reason on the record.',
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All referrals' },
  { value: 'pending_conversion', label: 'Awaiting entry fee' },
  { value: 'no_reward', label: 'Converted · no reward' },
  { value: 'accrued', label: 'Reward accrued' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
]

/**
 * A note the API requires before it will act — a payout reference, or a rejection reason.
 *
 * A dialog rather than a `prompt()`, because both values end up on a permanent record: the
 * payout reference is how a payment is traced afterwards, and the rejection reason is what
 * somebody reads when they ask why. Neither should be typed into a browser chrome box that
 * offers no context about what is being confirmed.
 */
function NoteDialog({
  title,
  lead,
  label,
  placeholder,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  lead: string
  label: string
  placeholder: string
  confirmLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState('')

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="note-title">
      <div className={`card ${styles.dialog}`}>
        <h3 id="note-title">{title}</h3>
        <p className={styles.dialogLead}>{lead}</p>
        <div className="form-group">
          <label htmlFor="note-input">{label}</label>
          <input
            id="note-input"
            className="form-control"
            value={note}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className={styles.dialogActions}>
          <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || note.trim().length < 2}
            onClick={() => onConfirm(note.trim())}
          >
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

type PendingAction = { row: AdminReferralRow; kind: 'mark-paid' | 'reject' } | null

export default function AdminReferrals() {
  const { can } = useAuth()
  /** Reading the console is `students:read`; moving money is its own permission. */
  const mayPay = can('referrals:write')

  const [data, setData] = useState<AdminReferralsResponse | null>(null)
  const [settings, setSettings] = useState<AdminReferralSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [pending, setPending] = useState<PendingAction>(null)

  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)

  // The reward is edited in **rupees**, because that is what an administrator thinks in.
  // It is converted to paise once, on the way out — the API and the database only ever
  // deal in integer paise. Same arrangement as the entry fee on the payments console.
  const [rewardRupees, setRewardRupees] = useState('')
  const [rewardEnabled, setRewardEnabled] = useState(false)
  const [terms, setTerms] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (status) params.set('rewardStatus', status)
      if (appliedSearch) params.set('search', appliedSearch)

      const [list, config] = await Promise.all([
        api.get<AdminReferralsResponse>(`/admin/referrals?${params.toString()}`),
        api.get<AdminReferralSettings>('/admin/referral-settings'),
      ])
      setData(list)
      setSettings(config)
      setRewardEnabled(config.rewardEnabled)
      setRewardRupees((config.rewardAmount / 100).toFixed(2))
      setTerms(config.terms ?? '')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the referrals.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [page, status, appliedSearch])

  useEffect(() => {
    void load()
  }, [load])

  async function act(row: AdminReferralRow, path: string, body: Record<string, string> | undefined, done: string) {
    setBusyId(row.id)
    setError('')
    setNotice('')
    try {
      await api.post(`/admin/referrals/${row.id}/${path}`, body ?? {})
      setNotice(done)
      setPending(null)
      await load()
    } catch (err) {
      // The API answers 409 when the row has moved on — another administrator got there
      // first. Its message names the state it found, which is the useful thing to show.
      setError(err instanceof ApiError ? err.message : 'Could not update that referral.')
    } finally {
      setBusyId('')
    }
  }

  async function saveSettings() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const rupees = Number(rewardRupees)
      if (!Number.isFinite(rupees) || rupees < 0) {
        setError('Enter the reward as a number of rupees, for example 50.')
        return
      }
      const saved = await api.put<AdminReferralSettings>('/admin/referral-settings', {
        rewardEnabled,
        // Rounded, not truncated: 49.995 typed into a rupee box means 50, and paise are
        // integers by the time they leave here.
        rewardAmount: Math.round(rupees * 100),
        terms: terms.trim(),
      })
      setSettings(saved)
      setNotice(
        saved.rewardEnabled && saved.rewardAmount > 0
          ? `Referrals now earn ${saved.rewardDisplay}. This applies to conversions from now on — rewards already earned keep the amount they were earned at.`
          : 'Referral rewards are switched off. Introductions are still tracked.',
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the referral settings.')
    } finally {
      setSaving(false)
    }
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setAppliedSearch(search.trim())
  }

  const rewardConfigured = settings !== null && settings.rewardEnabled && settings.rewardAmount > 0

  return (
    <AdminShell title="Referrals">
      {pending?.kind === 'mark-paid' && (
        <NoteDialog
          title={`Mark ${pending.row.rewardDisplay} as paid`}
          lead={`To ${pending.row.referrer.fullName ?? pending.row.referrer.studentId ?? 'the referrer'}, for introducing ${pending.row.referred.fullName ?? 'a student'}. Record how it was paid — this is what the payment is traced by afterwards.`}
          label="Payout reference"
          placeholder="UPI 402931 · NEFT ref · handed over at the centre"
          confirmLabel="Mark paid"
          busy={busyId === pending.row.id}
          onCancel={() => setPending(null)}
          onConfirm={(note) =>
            void act(pending.row, 'mark-paid', { payoutReference: note }, `Recorded as paid: ${note}.`)
          }
        />
      )}
      {pending?.kind === 'reject' && (
        <NoteDialog
          title="Reject this referral"
          lead="The reason goes on the record and is what somebody reads if they ask why. This cannot be undone from here."
          label="Reason"
          placeholder="Duplicate account · self-referral · fee refunded"
          confirmLabel="Reject"
          busy={busyId === pending.row.id}
          onCancel={() => setPending(null)}
          onConfirm={(note) => void act(pending.row, 'reject', { reason: note }, 'Referral rejected.')}
        />
      )}

      {loading && !data && <Spinner label="Loading referrals..." />}
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <p className={styles.notice}>{notice}</p>}

      {data && (
        <>
          {/* -----------------------------------------------------------------
              What is owed. Programme-wide, counted from the collection.
          ----------------------------------------------------------------- */}
          <section className={styles.totals}>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>Accrued, awaiting approval</span>
              <span className={styles.totalValue}>{data.totals.accruedDisplay}</span>
            </div>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>Approved, awaiting payout</span>
              <span className={styles.totalValue}>{data.totals.approvedDisplay}</span>
            </div>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>Paid out</span>
              <span className={styles.totalValue}>{data.totals.paidDisplay}</span>
            </div>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>Referrals recorded</span>
              <span className={styles.totalValue}>{data.pagination.total}</span>
            </div>
          </section>

          {/* -----------------------------------------------------------------
              What a referral is worth
          ----------------------------------------------------------------- */}
          <section className={`card ${styles.settings}`}>
            <h2 className={styles.sectionTitle}>Referral reward</h2>

            {!rewardConfigured && (
              /**
               * Stated plainly rather than left to be inferred from a zero. No reward
               * amount has ever been specified for this product, so none was invented —
               * and an administrator arriving here should understand that the tracking
               * below is real even though nothing is owed.
               */
              <p className={styles.notConfigured}>
                <Icon name="ph-info" weight="bold" /> No referral reward is configured, so nothing is being accrued.
                Introductions are still recorded and shown below — set an amount here when you have decided one.
              </p>
            )}

            {mayPay ? (
              <div className={styles.settingsForm}>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={rewardEnabled}
                    onChange={(e) => setRewardEnabled(e.target.checked)}
                  />
                  <span>Pay a reward for successful referrals</span>
                </label>

                <div className="form-group">
                  <label htmlFor="reward-amount">Reward per successful referral (₹)</label>
                  <input
                    id="reward-amount"
                    className="form-control"
                    type="number"
                    min="0"
                    step="1"
                    value={rewardRupees}
                    onChange={(e) => setRewardRupees(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="reward-terms">What students are told (optional)</label>
                  <input
                    id="reward-terms"
                    className="form-control"
                    value={terms}
                    maxLength={500}
                    placeholder="₹50 once your friend pays the Olympiad entry fee."
                    onChange={(e) => setTerms(e.target.value)}
                  />
                </div>

                <p className={styles.settingsNote}>
                  A referral becomes payable when the student it introduced <strong>pays the entry fee</strong> — that
                  rule is fixed and is not configurable here. Changing the amount applies to conversions from now on;
                  rewards already earned keep the amount they were earned at.
                </p>

                <button type="button" className={styles.primary} disabled={saving} onClick={() => void saveSettings()}>
                  {saving ? 'Saving…' : 'Save reward settings'}
                </button>
              </div>
            ) : (
              <p className={styles.readOnly}>
                {rewardConfigured
                  ? `Referrals earn ${settings?.rewardDisplay} once the referred student pays the entry fee.`
                  : 'No reward is configured.'}{' '}
                You do not have permission to change this.
              </p>
            )}
          </section>

          {/* -----------------------------------------------------------------
              The referrals themselves
          ----------------------------------------------------------------- */}
          <section className={`card ${styles.listCard}`}>
            <div className={styles.tableHead}>
              <h2 className={styles.sectionTitle}>All referrals</h2>
              <form className={styles.filters} onSubmit={applySearch}>
                <input
                  className="form-control"
                  placeholder="Student ID, email or referral code"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search referrals"
                />
                <select
                  className="form-control"
                  value={status}
                  onChange={(e) => {
                    setPage(1)
                    setStatus(e.target.value)
                  }}
                  aria-label="Filter by reward status"
                >
                  {STATUS_FILTERS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button type="submit" className={styles.secondary}>
                  Search
                </button>
              </form>
            </div>

            {data.referrals.length === 0 ? (
              <p className={styles.empty}>
                {status || appliedSearch
                  ? 'No referrals match these filters.'
                  : 'No referrals yet. A row appears here the moment somebody registers with another student’s link.'}
              </p>
            ) : (
              <TableScroll label="Referrals">
                <Table density="compact">
                  <thead>
                    <tr>
                      <th>Referrer</th>
                      <th>Referred student</th>
                      <th>Code</th>
                      <th>Registered</th>
                      <th>Paid the fee</th>
                      <th>Reward</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.referrals.map((row) => (
                      <tr key={row.id} className={busyId === row.id ? styles.busy : ''}>
                        <td>
                          <span className={styles.name}>{row.referrer.fullName ?? '—'}</span>
                          <span className={styles.sub}>{row.referrer.studentId ?? ''}</span>
                        </td>
                        <td>
                          <span className={styles.name}>{row.referred.fullName ?? '—'}</span>
                          <span className={styles.sub}>
                            {row.referred.studentId ?? ''}
                            {row.referred.classLevel ? ` · ${row.referred.classLevel}` : ''}
                          </span>
                        </td>
                        <td className={styles.mono}>{row.code}</td>
                        <td className={styles.muted}>{new Date(row.registeredAt).toLocaleDateString()}</td>
                        <td>
                          {/* Derived from the payment record at read time, so a stale
                              referral row cannot make this say the wrong thing. */}
                          {row.referredHasPaid ? (
                            <span className={styles.paidYes}>
                              Yes
                              {row.convertedAt && (
                                <span className={styles.sub}>{new Date(row.convertedAt).toLocaleDateString()}</span>
                              )}
                            </span>
                          ) : (
                            <span className={styles.paidNo}>Not yet</span>
                          )}
                        </td>
                        <td>
                          <span className={styles[`status_${row.rewardStatus}`]} title={STATUS_HELP[row.rewardStatus]}>
                            {STATUS_LABELS[row.rewardStatus]}
                          </span>
                          {row.rewardAmount > 0 && <span className={styles.sub}>{row.rewardDisplay}</span>}
                          {row.payoutReference && <span className={styles.sub}>Ref: {row.payoutReference}</span>}
                          {row.rejectedReason && <span className={styles.sub}>{row.rejectedReason}</span>}
                        </td>
                        <td>
                          {/*
                            Only the transitions the API will actually accept. Offering
                            "Mark paid" on an unapproved row would be an invitation to a
                            409 — and worse, it would suggest paying is a single click
                            when the two-step approval exists on purpose.
                          */}
                          {!mayPay ? (
                            <span className={styles.muted}>View only</span>
                          ) : (
                            <div className={styles.actions}>
                              {row.rewardStatus === 'accrued' && (
                                <button
                                  type="button"
                                  className={styles.approveBtn}
                                  disabled={busyId === row.id}
                                  onClick={() => void act(row, 'approve', undefined, 'Reward approved.')}
                                >
                                  Approve
                                </button>
                              )}
                              {row.rewardStatus === 'approved' && (
                                <button
                                  type="button"
                                  className={styles.payBtn}
                                  disabled={busyId === row.id}
                                  onClick={() => setPending({ row, kind: 'mark-paid' })}
                                >
                                  Mark paid
                                </button>
                              )}
                              {row.rewardStatus !== 'paid' && row.rewardStatus !== 'rejected' && (
                                <button
                                  type="button"
                                  className={styles.rejectBtn}
                                  disabled={busyId === row.id}
                                  onClick={() => setPending({ row, kind: 'reject' })}
                                >
                                  Reject
                                </button>
                              )}
                              {(row.rewardStatus === 'paid' || row.rewardStatus === 'rejected') && (
                                <span className={styles.muted}>Closed</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}

            {data.pagination.totalPages > 1 && (
              <div className={styles.pager}>
                <button disabled={data.pagination.page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <span>
                  Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} referrals
                </span>
                <button
                  disabled={data.pagination.page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </AdminShell>
  )
}
