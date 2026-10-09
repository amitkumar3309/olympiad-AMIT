import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import {
  ELIGIBILITY_LABELS,
  type QuizWinnerRow,
  type WinnerAction,
  type WinnerStatus,
} from '../../api/types'
import { Alert, Badge, Button, Field, Modal, Table, TableScroll, Textarea, useToast, type BadgeTone } from '../../components/ui'
import { formatDateTime, formatDayKey, formatNumber, formatSolveTime } from '../../lib/format'
import { humanizeError } from '../../lib/errors'
import styles from './DailyQuiz.module.css'

/**
 * The winner table (Milestone 30, Phase 2 — brief §6.5), shared by the monthly winners, a
 * quiz's own page and the prize desk so a candidate is described, and acted on, the same way
 * everywhere. A month's row (one class band's prize, since 2026-10-09) shows its correct
 * answers and their total solve time; a quiz's row, from before, its one solve time.
 *
 * Every action is a request the server decides: it refuses a transition the row's status
 * does not allow (confirming a disqualified student, publishing an unconfirmed one), and it
 * snapshots the prize at confirmation. This table only offers what the status allows, and
 * writes the reason for every disabled path in the page rather than in a tooltip.
 *
 * Two actions ask first: **disqualify**, which needs a reason the audit trail keeps, and
 * **publish**, which puts a child's name on the public site and tells them they won.
 */

const STATUS_TONE: Record<WinnerStatus, BadgeTone> = {
  provisional: 'neutral',
  confirmed: 'info',
  published: 'success',
  disqualified: 'danger',
}

const STATUS_LABEL: Record<WinnerStatus, string> = {
  provisional: 'Provisional',
  confirmed: 'Confirmed',
  published: 'Announced',
  disqualified: 'Disqualified',
}

const DONE_MESSAGE: Record<WinnerAction, string> = {
  confirm: 'Winner confirmed. Announce them when you are ready.',
  disqualify: 'Candidate disqualified.',
  publish: 'Winner announced, and told on their dashboard.',
  contacted: 'Marked as contacted.',
  delivered: 'Prize marked as delivered.',
}

export function WinnerStatusBadge({ status }: { status: WinnerStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} size="sm">
      {STATUS_LABEL[status]}
    </Badge>
  )
}

function rangeLabel(min: number, max: number): string {
  if (min === 3 && max === 12) return 'All classes'
  return min === max ? `Class ${min}` : `Classes ${min}–${max}`
}

export interface WinnerTableProps {
  rows: QuizWinnerRow[]
  /** Called with the server's answer after any action, so the caller can re-render from it. */
  onChanged: (updated: QuizWinnerRow) => void
  /** The prize desk shows which quiz each row came from. */
  showQuiz?: boolean
  label: string
}

export default function WinnerTable({ rows, onChanged, showQuiz = false, label }: WinnerTableProps) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [disqualifying, setDisqualifying] = useState<QuizWinnerRow | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<QuizWinnerRow | null>(null)

  async function act(row: QuizWinnerRow, action: WinnerAction, body: Record<string, unknown> = {}) {
    setBusy(`${row.id}:${action}`)
    setError(null)
    try {
      const res = await api.post<{ winner: QuizWinnerRow }>(`/admin/daily-quiz/winners/${row.id}/${action}`, body)
      onChanged(res.winner)
      toast.success(DONE_MESSAGE[action])
      return true
    } catch (err) {
      setError(humanizeError(err, { fallback: 'That could not be saved. Please try again.' }))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function confirmDisqualify() {
    if (!disqualifying) return
    if (reason.trim().length < 5) {
      setReasonError('Say why, in a few words — it is kept in the audit trail.')
      return
    }
    if (await act(disqualifying, 'disqualify', { reason: reason.trim() })) {
      setDisqualifying(null)
      setReason('')
    }
  }

  async function confirmPublish() {
    if (!publishing) return
    if (await act(publishing, 'publish')) setPublishing(null)
  }

  const isBusy = (row: QuizWinnerRow, action: WinnerAction) => busy === `${row.id}:${action}`

  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <TableScroll label={label}>
        <Table density="comfortable">
          <thead>
            <tr>
              {showQuiz ? <th scope="col">Prize</th> : <th scope="col">Rank</th>}
              <th scope="col">Student</th>
              <th scope="col">Parent / guardian</th>
              <th scope="col">Score</th>
              <th scope="col">Checks</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {showQuiz && row.period === 'month' && row.month ? (
                    <Link to={`/admin/daily-quiz?tab=monthly&month=${row.month}`}>{row.label}</Link>
                  ) : showQuiz ? (
                    <>
                      {row.quizExists === false ? (
                        formatDayKey(row.day)
                      ) : (
                        <Link to={`/admin/daily-quiz/${row.groupId}`}>{formatDayKey(row.day)}</Link>
                      )}
                      <div className={styles.muted}>{rangeLabel(row.classMin, row.classMax)}</div>
                    </>
                  ) : (
                    <span className={styles.rank}>#{row.rank}</span>
                  )}
                </td>
                <td>
                  {row.student ? (
                    <>
                      <strong>{row.student.name}</strong>
                      <div className={styles.muted}>
                        {row.student.studentId} · {row.student.classLevel ?? 'No class'}
                      </div>
                      <div className={styles.muted}>
                        {[row.student.schoolName, row.student.city].filter(Boolean).join(', ') || 'No school or city'}
                      </div>
                    </>
                  ) : (
                    <span className={styles.muted}>Account deleted</span>
                  )}
                </td>
                <td>
                  {row.student?.guardianPhone ? (
                    <a href={`tel:${row.student.guardianPhone}`}>{row.student.guardianPhone}</a>
                  ) : (
                    <span className={styles.warnText}>No phone</span>
                  )}
                  {row.student?.guardianEmail && <div className={styles.muted}>{row.student.guardianEmail}</div>}
                  {row.student && (
                    <div className={styles.muted}>
                      {row.student.email} · {row.student.emailVerified ? 'verified' : 'not verified'}
                    </div>
                  )}
                </td>
                <td>
                  {row.period === 'month' ? (
                    <>
                      <span className={styles.figure}>{row.correctCount ?? 0} correct</span>
                      <div className={styles.muted}>
                        {row.solveTimeMs !== null ? `${formatSolveTime(row.solveTimeMs)} in all` : 'Total time unknown'}
                      </div>
                      <div className={styles.muted}>Last {formatDateTime(row.submittedAt)}</div>
                    </>
                  ) : (
                    <>
                      <span className={styles.figure}>{row.solveTimeMs !== null ? formatSolveTime(row.solveTimeMs) : '—'}</span>
                      <div className={styles.muted}>{formatDateTime(row.submittedAt)}</div>
                    </>
                  )}
                </td>
                <td>
                  <div className={styles.checks}>
                    {row.sharedIpCount > 0 && (
                      <Badge tone="warning" size="sm" icon="ph-wifi-high">
                        {row.period === 'month'
                          ? `${row.sharedIpCount} other ${row.sharedIpCount === 1 ? 'student' : 'students'} answered from a connection they used`
                          : `${row.sharedIpCount} other correct ${row.sharedIpCount === 1 ? 'answer' : 'answers'} on this connection`}
                      </Badge>
                    )}
                    {row.student && !row.student.eligibility.eligible && (
                      <Badge tone="danger" size="sm" icon="ph-user-circle-dashed">
                        Missing {row.student.eligibility.missing.map((key) => ELIGIBILITY_LABELS[key]).join(', ')}
                      </Badge>
                    )}
                    {row.sharedIpCount === 0 && row.student?.eligibility.eligible && <span className={styles.muted}>None</span>}
                  </div>
                </td>
                <td>
                  <WinnerStatusBadge status={row.status} />
                  {row.status === 'disqualified' && row.reason && <div className={styles.muted}>“{row.reason}”</div>}
                  {row.prizeText && row.status !== 'disqualified' && row.status !== 'provisional' && (
                    <div className={styles.muted}>
                      {row.prizeText}
                      {row.cashAmount !== null && row.cashAmount > 0 ? ` · ₹${formatNumber(row.cashAmount)}` : ''}
                    </div>
                  )}
                  {row.contactedAt && <div className={styles.muted}>Contacted {formatDateTime(row.contactedAt)}</div>}
                  {row.deliveredAt && <div className={styles.muted}>Delivered {formatDateTime(row.deliveredAt)}</div>}
                </td>
                <td>
                  <div className={styles.rowActions}>
                    {row.status === 'provisional' && (
                      <Button size="sm" icon="ph-check" loading={isBusy(row, 'confirm')} onClick={() => void act(row, 'confirm')}>
                        Confirm
                      </Button>
                    )}
                    {row.status === 'confirmed' && (
                      <Button size="sm" variant="brand" icon="ph-megaphone" onClick={() => setPublishing(row)}>
                        Announce
                      </Button>
                    )}
                    {row.status === 'published' && !row.contactedAt && (
                      <Button size="sm" variant="secondary" icon="ph-phone" loading={isBusy(row, 'contacted')} onClick={() => void act(row, 'contacted')}>
                        Contacted
                      </Button>
                    )}
                    {row.status === 'published' && !row.deliveredAt && (
                      <Button size="sm" variant="secondary" icon="ph-package" loading={isBusy(row, 'delivered')} onClick={() => void act(row, 'delivered')}>
                        Delivered
                      </Button>
                    )}
                    {row.status !== 'disqualified' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="ph-prohibit"
                        onClick={() => {
                          setReason('')
                          setReasonError(null)
                          setDisqualifying(row)
                        }}
                      >
                        Disqualify
                      </Button>
                    )}
                    {row.status === 'disqualified' && <span className={styles.muted}>No further action</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>

      <Modal
        open={disqualifying !== null}
        onClose={() => setDisqualifying(null)}
        title={`Disqualify ${disqualifying?.student?.name ?? 'this candidate'}?`}
        description={`They will not be offered as a winner for this ${disqualifying?.period === 'month' ? 'month’s prize in their class band' : 'quiz'} again. The reason is kept in the audit trail.`}
        tone="danger"
        icon="ph-prohibit"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisqualifying(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={disqualifying !== null && isBusy(disqualifying, 'disqualify')} onClick={() => void confirmDisqualify()}>
              Disqualify
            </Button>
          </>
        }
      >
        <Field label="Reason" error={reasonError} hint="For example: “Several accounts for one student”, “Details could not be verified”.">
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} />
        </Field>
      </Modal>

      <Modal
        open={publishing !== null}
        onClose={() => setPublishing(null)}
        title={`Announce ${publishing?.student?.name ?? 'this winner'}?`}
        description="Their first name, last initial, class and city or school appear in the Rewards section (or just their class, if they opted out of public lists), and they are told on their dashboard — and by email, unless they switched results emails off."
        icon="ph-megaphone"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPublishing(null)}>
              Not yet
            </Button>
            <Button variant="brand" loading={publishing !== null && isBusy(publishing, 'publish')} onClick={() => void confirmPublish()}>
              Announce winner
            </Button>
          </>
        }
      />
    </>
  )
}
