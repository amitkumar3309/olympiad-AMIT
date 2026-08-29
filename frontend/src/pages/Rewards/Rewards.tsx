import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { api, ApiError } from '../../api/client'
import type { BadgeTier, EvaluatedBadge, JourneyStage, RewardsResponse } from '../../api/types'
import { Icon } from '../../components/ui'
import styles from './Rewards.module.css'

/**
 * The student's whole standing: XP, level, streaks, badges, achievements and the
 * journey map.
 *
 * **Nothing on this page is computed here.** Every figure — the level, the tier a badge
 * is held at, which journey stage is current, how far along a locked achievement is —
 * arrives already decided by the reward engine, from one facts object derived from the
 * activity log. That is deliberate: the dashboard shows a subset of the same figures,
 * and the only way two screens cannot disagree is if neither of them does the maths.
 *
 * Three sections, answering three different questions:
 *  - **Journey** — what should I do next? (ordered, exactly one stage current)
 *  - **Badges** — how far along am I? (tiered families that keep levelling)
 *  - **Achievements** — what have I done? (one-off goals, earned or not)
 */

const TIER_LABELS: Record<BadgeTier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }

export default function Rewards() {
  const [data, setData] = useState<RewardsResponse['rewards'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<RewardsResponse>('/me/rewards')
      setData(res.rewards)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your rewards.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <StudentShell title="Rewards">
        <div className={styles.centered}>
          <Spinner />
          <p>Loading your progress…</p>
        </div>
      </StudentShell>
    )
  }

  if (error || !data) {
    return (
      <StudentShell title="Rewards">
        <div className={`card ${styles.centered}`}>
          <h3>Could not load your rewards</h3>
          <p className="error-text">{error ?? 'Something went wrong.'}</p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      </StudentShell>
    )
  }

  const { level, streak, badges, achievements, journey, totals } = data

  return (
    <StudentShell title="Rewards" subtitle={`Level ${level.level} · ${level.xp} XP`}>
      {/* --- XP and level ------------------------------------------------ */}
      <section className={`card ${styles.levelCard}`}>
        <div className={styles.levelHead}>
          <div>
            <div className={styles.levelBadge}>Level {level.level}</div>
            <div className={styles.xpTotal}>
              {level.xp}
              <span> XP</span>
            </div>
          </div>
          <div className={styles.levelRight}>
            <span className={styles.toNext}>
              {level.nextLevelAt - level.xp} XP to level {level.level + 1}
            </span>
          </div>
        </div>

        <div
          className={styles.levelBar}
          role="progressbar"
          aria-valuenow={level.percentToNextLevel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progress to level ${level.level + 1}`}
        >
          <span style={{ width: `${level.percentToNextLevel}%` }} />
        </div>
        <p className={styles.levelFoot}>
          {level.xpIntoLevel} of {level.xpForNextLevel} XP through this level. Every point comes from something you
          actually did — there is no way to earn XP here except by doing it.
        </p>
      </section>

      {/* --- The real counts underneath everything ----------------------- */}
      <section className={styles.statRow}>
        <div className="card">
          <div className={styles.statValue}>{streak.current}</div>
          <div className={styles.statLabel}>Day streak</div>
        </div>
        <div className="card">
          <div className={styles.statValue}>{streak.longest}</div>
          <div className={styles.statLabel}>Best streak</div>
        </div>
        <div className="card">
          <div className={styles.statValue}>{totals.activeDays}</div>
          <div className={styles.statLabel}>Active days</div>
        </div>
        <div className="card">
          <div className={styles.statValue}>{totals.practiceSessions}</div>
          <div className={styles.statLabel}>Practice sessions</div>
        </div>
        <div className="card">
          <div className={styles.statValue}>{totals.mockTests}</div>
          <div className={styles.statLabel}>Mock tests</div>
        </div>
        <div className="card">
          <div className={styles.statValue}>{totals.dailyChallenges}</div>
          <div className={styles.statLabel}>Daily challenges</div>
        </div>
      </section>

      {/* --- Journey map -------------------------------------------------- */}
      <section className="card">
        <div className={styles.sectionHead}>
          <h3>Your journey</h3>
          <span className={styles.sectionMeta}>
            {journey.completedCount} of {journey.total} stages
          </span>
        </div>
        <p className={styles.sectionIntro}>
          The route through the Olympiad, in the order it makes sense to take it. One stage is highlighted: it is
          simply the next thing to do.
        </p>

        <ol className={styles.journey}>
          {journey.stages.map((stage) => (
            <JourneyRow key={stage.id} stage={stage} />
          ))}
        </ol>
      </section>

      {/* --- Badges ------------------------------------------------------- */}
      <section className="card">
        <div className={styles.sectionHead}>
          <h3>Badges</h3>
          <span className={styles.sectionMeta}>
            {badges.heldCount} of {badges.total} held
          </span>
        </div>
        <p className={styles.sectionIntro}>
          Badges level up as you keep going — bronze, then silver, then gold. Unlike an achievement, a badge is never
          finished until its highest tier.
        </p>

        <div className={styles.badgeGrid}>
          {badges.badges.map((badge) => (
            <BadgeCard key={badge.code} badge={badge} />
          ))}
        </div>
      </section>

      {/* --- Achievements -------------------------------------------------- */}
      <section className="card">
        <div className={styles.sectionHead}>
          <h3>Achievements</h3>
          <span className={styles.sectionMeta}>
            {achievements.earnedCount} of {achievements.total} earned
          </span>
        </div>

        <ul className={styles.achievementList}>
          {[...achievements.earned, ...achievements.next].map((achievement) => (
            <li key={achievement.code} className={achievement.earned ? styles.earned : styles.locked}>
              <Icon name={achievement.icon} weight="bold" />
              <div className={styles.achievementMain}>
                <span className={styles.achievementName}>{achievement.name}</span>
                <span className={styles.achievementDescription}>{achievement.description}</span>
              </div>
              {achievement.earned ? (
                <span className={styles.tickMark}>
                  <Icon name="ph-check" weight="bold" />
                </span>
              ) : (
                <span className={styles.achievementProgress}>
                  {achievement.progress}/{achievement.target}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className={styles.actions}>
        <Link to="/practice">
          <Button>Earn some XP</Button>
        </Link>
        <Link to="/daily-challenge">
          <Button variant="outline">Today’s challenge</Button>
        </Link>
      </div>
    </StudentShell>
  )
}

/** One stage of the journey: done, next, or still ahead. */
function JourneyRow({ stage }: { stage: JourneyStage }) {
  const state = stage.complete ? 'done' : stage.current ? 'current' : 'ahead'

  return (
    <li className={`${styles.stage} ${styles[state]}`}>
      <span className={styles.stageMarker}>
        <Icon name={stage.complete ? 'ph-check' : stage.icon} weight="bold" />
      </span>
      <div className={styles.stageMain}>
        <span className={styles.stageTitle}>
          {stage.title}
          {stage.current && <span className={styles.nextTag}>next</span>}
        </span>
        <span className={styles.stageDescription}>{stage.description}</span>
        {/* A partial stage shows how far along it is; a binary one would just read 0/1. */}
        {!stage.complete && stage.target > 1 && (
          <span className={styles.stageProgress}>
            {stage.progress} of {stage.target}
          </span>
        )}
      </div>
    </li>
  )
}

/** One badge family, at whatever tier it is held. */
function BadgeCard({ badge }: { badge: EvaluatedBadge }) {
  const held = badge.tier !== null

  return (
    <article className={`${styles.badge} ${held ? styles[`tier_${badge.tier}`] : styles.tier_none}`}>
      <span className={styles.badgeIcon}>
        <Icon name={badge.icon} weight="bold" />
      </span>
      <span className={styles.badgeName}>{badge.name}</span>
      <span className={styles.badgeTier}>{held ? TIER_LABELS[badge.tier!] : 'Not yet'}</span>
      <span className={styles.badgeDescription}>{badge.description}</span>

      <div className={styles.badgeBar}>
        <span style={{ width: `${Math.round((badge.progress / badge.target) * 100)}%` }} />
      </div>
      <span className={styles.badgeProgress}>
        {badge.nextTier
          ? `${badge.progress} / ${badge.target} ${badge.unit} to ${TIER_LABELS[badge.nextTier].toLowerCase()}`
          : `${badge.value} ${badge.unit} — highest tier`}
      </span>
    </article>
  )
}
