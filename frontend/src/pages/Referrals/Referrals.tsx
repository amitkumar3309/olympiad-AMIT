import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import { Alert, Badge, Button, Card, CardHeader, DataCard, DataCardList, DataRow, EmptyState, ErrorState, Icon, SkeletonCards, StatTile, Table, TableScroll, type BadgeTone } from '../../components/ui'
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

/**
 * The tone each state is shown in. Deliberately a map beside the labels rather than a
 * chain of conditionals at the call site: a status is one fact, and its words, its
 * tooltip and its colour should be decided in one place.
 */
const STATUS_TONES: Record<ReferralRewardStatus, BadgeTone> = {
  pending_conversion: 'neutral',
  no_reward: 'info',
  accrued: 'warning',
  approved: 'primary',
  paid: 'success',
  rejected: 'danger',
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
      <Icon name={copied ? 'ph-check' : 'ph-copy'} weight="bold" /> {copied ? 'Copied' : label}
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
        {loading && <SkeletonCards count={3} label="Loading your referrals" />}
        {error && !loading && <ErrorState error={error} onRetry={() => void load()} />}

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
                  <Icon name="ph-whatsapp-logo" weight="bold" size="sm" />
                  <span>Share on WhatsApp</span>
                </a>
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <Button variant="secondary" icon="ph-share-network" onClick={() => void nativeShare()}>
                    Share
                  </Button>
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
              <Alert tone="info" title="No referral reward is running at the moment">
                Your link still works and every friend who joins with it is recorded below. If a reward is announced
                later it will apply to referrals from that point on, so it is worth sharing now either way.
              </Alert>
            )}

            {/* ---------------------------------------------------------------
                Counts — always real, always shown
            --------------------------------------------------------------- */}
            <section className={styles.tiles}>
              <StatTile icon="ph-users-three" label="Friends joined" value={summary.counts.total} />
              <StatTile
                icon="ph-check-circle"
                tone="success"
                label="Entered the Olympiad"
                value={summary.counts.converted}
              />
              <StatTile
                icon="ph-clock"
                tone="warning"
                label="Yet to pay the fee"
                value={summary.counts.pendingConversion}
              />
              {/* Only when there is a reward: three tiles reading ₹0.00 look like a fault. */}
              {rewardOn && (
                <>
                  <StatTile
                    icon="ph-hand-coins"
                    label="Earned, awaiting approval"
                    value={rupees(summary.rewards.accruedPaise)}
                  />
                  <StatTile
                    icon="ph-seal-check"
                    tone="success"
                    label="Approved"
                    value={rupees(summary.rewards.approvedPaise)}
                  />
                  <StatTile
                    icon="ph-currency-inr"
                    tone="success"
                    label="Paid to you"
                    value={rupees(summary.rewards.paidPaise)}
                  />
                </>
              )}
            </section>

            {/* ---------------------------------------------------------------
                The people
            --------------------------------------------------------------- */}
            <Card className={styles.listCard}>
              <CardHeader title="Your referrals" size="sm" as="h2" />

              {summary.referrals.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon="ph-user-plus"
                  title="You have not referred anyone yet"
                  description="Share your link with a friend. When they register with it, they appear here — and the moment they pay the entry fee, the referral is complete."
                />
              ) : (
                <>
                  {/* One card per friend on a phone; the table returns from 768px. */}
                  <DataCardList className={styles.mobileOnly}>
                    {summary.referrals.map((row) => (
                      <DataCard
                        key={row.id}
                        title={row.name}
                        subtitle={row.classLevel ?? undefined}
                        status={
                          <Badge tone={STATUS_TONES[row.rewardStatus]} size="sm" title={STATUS_HELP[row.rewardStatus]}>
                            {STATUS_LABELS[row.rewardStatus]}
                          </Badge>
                        }
                      >
                        <DataRow label="Joined">{new Date(row.registeredAt).toLocaleDateString('en-IN')}</DataRow>
                        {rewardOn && (
                          <DataRow label="Reward">{row.rewardAmount > 0 ? row.rewardDisplay : '—'}</DataRow>
                        )}
                      </DataCard>
                    ))}
                  </DataCardList>

                <TableScroll label="Your referrals" className={styles.desktopOnly}>
                  <Table density="compact">
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
                          <td className={styles.muted}>
                            {new Date(row.registeredAt).toLocaleDateString('en-IN')}
                          </td>
                          <td>
                            <Badge tone={STATUS_TONES[row.rewardStatus]} size="sm" title={STATUS_HELP[row.rewardStatus]}>
                              {STATUS_LABELS[row.rewardStatus]}
                            </Badge>
                          </td>
                          {rewardOn && (
                            <td className={styles.amount}>{row.rewardAmount > 0 ? row.rewardDisplay : '—'}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableScroll>
                </>
              )}
            </Card>

            <p className={styles.footNote}>
              A friend counts once they register with your link. They enter the Olympiad — and your referral becomes
              complete — when they pay the entry fee.{' '}
              <Link to="/payment" className="link">
                See the entry fee
              </Link>
            </p>
          </>
        )}
      </div>
    </StudentShell>
  )
}
