import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Spinner from '../../components/Spinner'
import { api, ApiError } from '../../api/client'
import type { ReferralRewardStatus, StudentReferralSummary } from '../../api/types'
import { AMIT_SHORT } from '../../lib/brand'
import styles from './Referrals.module.css'

/**
 * Refer & Earn, the student's page (Milestone 22, Phase F).
 *
 * ## Nothing on this page is invented
 *
 * Every number comes from `GET /me/referrals`, which counts real `Referral` rows. There is
 * no placeholder count, no illustrative reward and no "you could earn ₹500" — and the one
 * place that would have been tempting is handled explicitly: **when no reward is
 * configured, the page says the programme tracks introductions and pays nothing yet.** It
 * does not show ₹0 as though it were an offer, and it does not promise that a future
 * reward will be backdated, because it will not be: the amount is snapshotted when a
 * referral converts.
 *
 * ## The reward figures only appear when there is a reward
 *
 * With `settings.rewardEnabled` false there are no earnings tiles at all, because three
 * tiles reading ₹0.00 look like a broken page rather than an honest one. The referral
 * *counts* are always shown, since those are real either way.
 */

/** What each state means to the student who is looking at their own list. */
const STATUS_LABELS: Record<ReferralRewardStatus, string> = {
  pending_conversion: 'Signed up',
  no_reward: 'Joined the Olympiad',
  accrued: 'Reward earned',
  approved: 'Reward approved',
  paid: 'Reward paid',
  rejected: 'Not eligible',
}

const STATUS_HELP: Record<ReferralRewardStatus, string> = {
  pending_conversion: 'They have registered but not paid the entry fee yet.',
  no_reward: 'They paid the entry fee. No reward was set up at the time.',
  accrued: 'They paid the entry fee and your reward is waiting to be approved.',
  approved: 'Approved, and waiting to be paid out.',
  paid: 'Paid out to you.',
  rejected: 'This referral was not accepted. Contact support if you think that is wrong.',
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`
}

/** A copy button that says what it did, then goes quiet again. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      // Reverts on its own, so the button never sits looking as if it is mid-action.
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // `navigator.clipboard` is unavailable over plain HTTP and in some in-app browsers.
      // The value is on screen and selectable, so this is a missing convenience rather
      // than a failure worth an error state.
      setCopied(false)
    }
  }

  return (
    <button type="button" className={styles.copyBtn} onClick={() => void copy()}>
      <i className={`ph-bold ${copied ? 'ph-check' : 'ph-copy'}`} /> {copied ? 'Copied' : label}
    </button>
  )
}

export default function Referrals() {
  const [summary, setSummary] = useState<StudentReferralSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<{ referral: StudentReferralSummary }>('/me/referrals')
      setSummary(res.referral)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your referrals.')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rewardOn = summary?.settings.rewardEnabled === true && summary.settings.rewardAmount > 0

  /**
   * The message a student shares. Built here rather than server-side because it is copy,
   * not data — and it carries the link the server generated, which is the part that has to
   * be right.
   */
  const shareText = summary
    ? `I'm preparing for the ${AMIT_SHORT} Maths Olympiad — practice, mock tests and a daily challenge are free. Join with my link: ${summary.link}`
    : ''

  async function nativeShare() {
    if (!summary) return
    try {
      // Present on Android Chrome and iOS Safari; absent on most desktops. The WhatsApp
      // link beside it works everywhere, so this is an upgrade rather than the only path.
      await navigator.share?.({ title: `${AMIT_SHORT} Maths Olympiad`, text: shareText, url: summary.link })
    } catch {
      /* The student dismissed the sheet. Not an error. */
    }
  }

  return (
    <StudentShell title="Refer & Earn" subtitle="Invite a friend to the Olympiad">
      <div className={styles.wrap}>
        {loading && <Spinner label="Loading your referrals..." />}
        {error && !loading && (
          <div className={`card ${styles.errorCard}`}>
            <p className="error-text">{error}</p>
            <button type="button" className={styles.retry} onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        {summary && !loading && (
          <>
            {/* ---------------------------------------------------------------
                The code and the link
            --------------------------------------------------------------- */}
            <section className={`card ${styles.codeCard}`}>
              <p className={styles.codeLabel}>Your referral code</p>
              <p className={styles.code}>{summary.code}</p>

              <div className={styles.linkRow}>
                <input
                  className={styles.linkInput}
                  value={summary.link}
                  readOnly
                  aria-label="Your referral link"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton value={summary.link} label="Copy link" />
              </div>

              <div className={styles.shareRow}>
                {/*
                  `wa.me` rather than a WhatsApp SDK: it is a plain link, works on desktop
                  and mobile, and adds no third-party script to a page students open on
                  cheap phones.
                */}
                <a
                  className={styles.shareWhatsapp}
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <i className="ph-bold ph-whatsapp-logo" /> Share on WhatsApp
                </a>
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <button type="button" className={styles.shareBtn} onClick={() => void nativeShare()}>
                    <i className="ph-bold ph-share-network" /> Share
                  </button>
                )}
                <CopyButton value={summary.code} label="Copy code" />
              </div>
            </section>

            {/* ---------------------------------------------------------------
                What a referral is worth — or that it is worth nothing yet
            --------------------------------------------------------------- */}
            {rewardOn ? (
              <section className={`card ${styles.rewardCard}`}>
                <p className={styles.rewardLead}>
                  You earn <strong>{rupees(summary.settings.rewardAmount)}</strong> for every friend who joins with your
                  link and pays the Olympiad entry fee.
                </p>
                {summary.settings.terms && <p className={styles.rewardTerms}>{summary.settings.terms}</p>}
              </section>
            ) : (
              /**
               * The honest version, and the one that matters most on this page. No reward
               * amount has been set, so none is shown — and the wording deliberately does
               * not promise that a future reward will cover past referrals, because it
               * will not: the amount is fixed at the moment a referral converts.
               */
              <section className={`card ${styles.rewardCard} ${styles.rewardOff}`}>
                <p className={styles.rewardLead}>
                  <i className="ph-bold ph-info" /> No referral reward is running at the moment.
                </p>
                <p className={styles.rewardTerms}>
                  Your link still works and every friend who joins with it is recorded below. If a reward is announced
                  later it will apply to referrals from that point on, so it is worth sharing now either way.
                </p>
              </section>
            )}

            {/* ---------------------------------------------------------------
                Counts — always real, always shown
            --------------------------------------------------------------- */}
            <section className={styles.tiles}>
              <div className="card">
                <div className={styles.tileValue}>{summary.counts.total}</div>
                <div className={styles.tileLabel}>Friends joined</div>
              </div>
              <div className="card">
                <div className={styles.tileValue}>{summary.counts.converted}</div>
                <div className={styles.tileLabel}>Entered the Olympiad</div>
              </div>
              <div className="card">
                <div className={styles.tileValue}>{summary.counts.pendingConversion}</div>
                <div className={styles.tileLabel}>Yet to pay the fee</div>
              </div>
              {/* Only when there is a reward: three tiles reading ₹0.00 look like a fault. */}
              {rewardOn && (
                <>
                  <div className="card">
                    <div className={styles.tileValue}>{rupees(summary.rewards.accruedPaise)}</div>
                    <div className={styles.tileLabel}>Earned, awaiting approval</div>
                  </div>
                  <div className="card">
                    <div className={styles.tileValue}>{rupees(summary.rewards.approvedPaise)}</div>
                    <div className={styles.tileLabel}>Approved</div>
                  </div>
                  <div className="card">
                    <div className={styles.tileValue}>{rupees(summary.rewards.paidPaise)}</div>
                    <div className={styles.tileLabel}>Paid to you</div>
                  </div>
                </>
              )}
            </section>

            {/* ---------------------------------------------------------------
                The people
            --------------------------------------------------------------- */}
            <section className={`card ${styles.listCard}`}>
              <h3>Your referrals</h3>

              {summary.referrals.length === 0 ? (
                <div className={styles.empty}>
                  <i className="ph-bold ph-user-plus" />
                  <p>You have not referred anyone yet.</p>
                  <p className={styles.emptyHint}>
                    Share your link with a friend. When they register with it, they will appear here.
                  </p>
                </div>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Friend</th>
                        <th>Class</th>
                        <th>Joined</th>
                        <th>Status</th>
                        {rewardOn && <th>Reward</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {summary.referrals.map((row) => (
                        <tr key={row.id}>
                          {/* The name arrives masked from the server — "Rahul S." A referral
                              list is a list of children, and the reader is not staff. */}
                          <td className={styles.name}>{row.name}</td>
                          <td className={styles.muted}>{row.classLevel ?? '—'}</td>
                          <td className={styles.muted}>{new Date(row.registeredAt).toLocaleDateString()}</td>
                          <td>
                            <span className={styles[`status_${row.rewardStatus}`]} title={STATUS_HELP[row.rewardStatus]}>
                              {STATUS_LABELS[row.rewardStatus]}
                            </span>
                          </td>
                          {rewardOn && (
                            <td className={styles.amount}>{row.rewardAmount > 0 ? row.rewardDisplay : '—'}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className={styles.footNote}>
              A friend counts once they register with your link. They enter the Olympiad — and your referral becomes
              complete — when they pay the entry fee. <Link to="/payment">See the entry fee →</Link>
            </p>
          </>
        )}
      </div>
    </StudentShell>
  )
}
