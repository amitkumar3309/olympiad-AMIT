import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, BadgeCheck, Gift, Medal, Zap } from 'lucide-react'
import { api } from '../../../api/client'
import type { PublicQuizWinner, QuizPrizeInfo } from '../../../api/types'
import Illustration from '../../../components/Illustration'
import { Avatar, Button, Section, Skeleton, usePrefersReducedMotion } from '../../../components/ui'
import { prizeLine } from '../../../lib/dailyQuizCopy'
import { formatDayKey } from '../../../lib/format'
import { RECENT_WINNERS } from '../../../lib/siteConfig'
import styles from './Rewards.module.css'

/**
 * The Rewards section (Milestone 30, Phase 3 — the owner's R2 and R3, brief §7.4).
 *
 * ## Every prize word is the owner's
 *
 * The headline and the prize line come from Admin → Daily Quiz → Settings through the
 * public `GET /daily-quiz/info` — "Solve daily. Win daily." and "Surprise gift + cash
 * prize" by default — and an amount appears only once the owner has set one. "How winners
 * are chosen" is the sentence the server generates from the same settings its winner
 * computation reads, printed verbatim, so the page and the rule cannot disagree.
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
 * The last seven **published** winners, named the way every public list names a child —
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
        title={prize?.prizeHeadline ?? 'Solve daily. Win daily.'}
        lead={
          prize ? (
            <>
              Answer the Daily Quiz — each day’s winner gets: <strong>{prizeLine(prize)}</strong> 🎁
            </>
          ) : (
            'Answer the Daily Quiz — each day’s winner gets a prize. 🎁'
          )
        }
      >
        <div className={styles.cards}>
          <article className={`${styles.card} ${styles.champion}`}>
            <span className={styles.shine} aria-hidden="true" />
            <div className={styles.championArt} aria-hidden="true">
              <Illustration name="gift-box" />
            </div>
            <div className={styles.cardBody}>
              <p className={styles.cardEyebrow}>
                <Gift aria-hidden="true" /> Daily Quiz Champion
              </p>
              <h3 className={styles.cardTitle}>{prize ? prizeLine(prize) : 'A prize every day'}</h3>
              <p className={styles.cardText}>One question a day for your class. The winner is announced the next day.</p>
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
              The first winner will be announced the day after launch — will it be you?
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
                <li key={`${winner.day}-${i}`} className={styles.winner}>
                  <Avatar name={winner.displayName} size="sm" decorative />
                  <span className={styles.winnerText}>
                    <span className={styles.winnerName}>{winner.displayName}</span>
                    <span className={styles.winnerMeta}>
                      {[winner.classLevel, winner.place].filter(Boolean).join(' · ')}
                    </span>
                    <span className={styles.winnerDay}>{formatDayKey(winner.day)}</span>
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
