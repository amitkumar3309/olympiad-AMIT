import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, BadgeCheck, Gift, Medal, Trophy, Zap } from 'lucide-react'
import { api } from '../../../api/client'
import type { PublicQuizWinner, QuizPrizeInfo } from '../../../api/types'
import { Avatar, Button, Section, Skeleton, usePrefersReducedMotion } from '../../../components/ui'
import { bandsSentence, prizeLine } from '../../../lib/dailyQuizCopy'
import { formatDayKey } from '../../../lib/format'
import { RECENT_WINNERS } from '../../../lib/siteConfig'
import { useReveal } from '../motion'
import styles from './Rewards.module.css'

/**
 * The Rewards section (Milestone 30, Phase 3 — the owner's R2 and R3, brief §7.4).
 *
 * ## Every prize word is the owner's
 *
 * The headline and the prize line come from Admin → Daily Quiz → Settings through the
 * public `GET /daily-quiz/info` — "Solve daily. Win every month." and "Surprise gift + cash
 * prize" by default — and an amount appears only once the owner has set one. The prize is
 * monthly, one winner in each class band (owner, 2026-10-09 — PLAN.md Q24). "How winners are
 * chosen" is the sentence the server generates from the same constants its ranking reads,
 * printed verbatim, so the page and the rule cannot disagree.
 *
 * ## What is not here
 *
 * The mockup's Sunday Math Boss Battle and Month-End Booster cards: neither event exists
 * (PLAN.md Q6), and a reward card is a promise. The badge names below are real ones from
 * the product's own catalogue (`backend/src/lib/achievements.ts`, `badges.ts`) — the
 * mockup's "Speed Solver", "Algebra Master" and "Top 50" are not.
 *
 * ## Recent winners
 *
 * The last eight **published** winners — two months of four bands — named the way every public list names a child —
 * first name and last initial, class, city or school, initials only, and anonymous for a
 * student who opted out. The row scrolls itself slowly when it overflows, pauses while a
 * pointer or keyboard focus is in it, and stands still under reduced motion.
 */

export interface RewardsProps {
  prize: QuizPrizeInfo | null
  onPlay: () => void
}

/** Seconds between automatic steps of the winners row. */
const STEP_MS = 4000

export default function Rewards({ prize, onPlay }: RewardsProps) {
  const [winners, setWinners] = useState<PublicQuizWinner[] | null>(null)
  const rowRef = useRef<HTMLOListElement>(null)
  const [paused, setPaused] = useState(false)
  const reduced = usePrefersReducedMotion()
  const reveal = useReveal<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    api
      .get<{ winners: PublicQuizWinner[] }>(`/daily-quiz/winners?limit=${RECENT_WINNERS}`)
      .then((res) => {
        if (!cancelled) setWinners(res.winners)
      })
      .catch(() => {
        if (!cancelled) setWinners([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A slow, pausable carousel — only when there is more than fits.
  useEffect(() => {
    if (reduced || paused || !winners || winners.length < 2) return
    const timer = window.setInterval(() => {
      const row = rowRef.current
      if (!row || row.scrollWidth <= row.clientWidth + 4) return
      const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4
      row.scrollTo({ left: atEnd ? 0 : row.scrollLeft + row.clientWidth * 0.6, behavior: 'smooth' })
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [reduced, paused, winners])

  return (
    <div className={styles.band}>
      <Section
        className={`container ${styles.section}`}
        id="rewards"
        eyebrow="Rewards"
        title={prize?.prizeHeadline ?? 'Solve daily. Win every month.'}
        lead={
          prize ? (
            <>
              Answer the Daily Quiz — every month, the top scorer in each class band wins: <strong>{prizeLine(prize)}</strong>.
            </>
          ) : (
            'Answer the Daily Quiz — every month, the top scorer in each class band wins a prize.'
          )
        }
      >
        <div ref={reveal} className={styles.cards}>
          <article className={`${styles.card} ${styles.champion}`}>
            <span className={styles.shine} aria-hidden="true" />
            {/* A drawn gold medal, where a placeholder picture stood (2026-10-09). */}
            <div className={styles.championArt} aria-hidden="true">
              <span className={styles.medal}>
                <Trophy />
              </span>
            </div>
            <div className={styles.cardBody}>
              <p className={styles.cardEyebrow}>
                <Gift aria-hidden="true" /> Monthly champion
              </p>
              <h3 className={styles.cardTitle}>{prize ? prizeLine(prize) : 'A prize every month'}</h3>
              <p className={styles.cardText}>
                One question a day for your class. Answer the most correctly in a month to win your class band —{' '}
                {bandsSentence(prize?.bands)}. Winners are announced early the next month.
              </p>
              <Button variant="brand" onClick={onPlay} icon={<Zap size={18} aria-hidden="true" />}>
                Play today’s quiz
              </Button>
            </div>
          </article>

          <article className={styles.card}>
            <div className={styles.cardBody}>
              <p className={styles.cardEyebrow}>
                <Award aria-hidden="true" /> Badges &amp; certificates
              </p>
              <h3 className={styles.cardTitle}>Earn as you go</h3>
              <p className={styles.cardText}>
                {prize ? `+${prize.xpForCorrect} XP for every correct Daily Quiz answer, ` : 'XP for every correct Daily Quiz answer, '}
                plus XP for practice and mock tests.
              </p>
              <ul className={styles.badges} aria-label="Some of the badges you can earn">
                {['Week warrior', 'Daily Solver', 'Test Taker', 'Five hundred club'].map((name) => (
                  <li key={name}>
                    <Medal aria-hidden="true" /> {name}
                  </li>
                ))}
              </ul>
              <p className={styles.cardText}>
                <BadgeCheck aria-hidden="true" className={styles.inlineIcon} /> A certificate anyone can{' '}
                <Link to="/verify" className="link">
                  verify
                </Link>{' '}
                when Olympiad results are released.
              </p>
            </div>
          </article>
        </div>

        <div className={styles.winners}>
          <h3 className={styles.winnersTitle}>Recent winners</h3>
          {winners === null ? (
            <Skeleton height={72} />
          ) : winners.length === 0 ? (
            <p className={styles.firstWinner}>
              The first winners are November’s — one in each class band, announced early in December. Will it be you?
            </p>
          ) : (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the handlers only pause the slow carousel while it is pointed at or focused; the list is a keyboard-scrollable region (tabIndex 0), as WCAG asks of one
            <ol
              ref={rowRef}
              className={styles.winnerRow}
              tabIndex={0}
              aria-label="Recent Daily Quiz winners"
              onPointerEnter={() => setPaused(true)}
              onPointerLeave={() => setPaused(false)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
            >
              {winners.map((winner, i) => (
                <li key={`${winner.month ?? winner.day}-${i}`} className={styles.winner}>
                  <Avatar name={winner.displayName} size="sm" decorative />
                  <span className={styles.winnerText}>
                    <span className={styles.winnerName}>{winner.displayName}</span>
                    <span className={styles.winnerMeta}>
                      {[winner.classLevel, winner.place].filter(Boolean).join(' · ')}
                    </span>
                    <span className={styles.winnerDay}>{winner.prizeLabel ?? formatDayKey(winner.day)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className={styles.how}>
          <h3 className={styles.howTitle}>How winners are chosen</h3>
          <p className={styles.howText}>{prize?.howWinnersAreChosen ?? 'Winners are chosen by the rule in the Daily Quiz & Rewards Rules.'}</p>
          <Link to="/rewards/rules" className={styles.rulesLink}>
            Read the Daily Quiz &amp; Rewards Rules
          </Link>
        </div>
      </Section>
    </div>
  )
}
