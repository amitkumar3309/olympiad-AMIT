import { useEffect, useState } from 'react'
import { BookOpenCheck, School, UserRound, Users } from 'lucide-react'
import { api } from '../../../api/client'
import type { PublicStats } from '../../../api/types'
import { CountUp, StatTile } from '../../../components/ui'
import { HOME_STATS } from '../../../lib/siteConfig'
import styles from '../Landing.module.css'

/**
 * The live figures under the hero (brief §7.1 #3).
 *
 * Real counts from `GET /public/stats` — computed at most every ten minutes on the server
 * — or **nothing at all**: the strip is not rendered until they load, and a failure
 * leaves it out rather than showing a placeholder. This page has never carried an
 * invented headline number and must not start. Each figure counts up once, the first
 * time it is on screen, and can be switched off in `lib/siteConfig.ts`.
 *
 * The mockup's sub-lines ("across India", "solving now…") are not reproduced: schools are
 * free text, so "across India" is not something we can count, and "active today" means
 * since IST midnight, not this minute.
 */

const FIGURES = [
  { key: 'studentsRegistered', label: 'Students registered', icon: UserRound, tone: 'green' },
  { key: 'schoolsRepresented', label: 'Schools represented', icon: School, tone: 'orange' },
  { key: 'questionsSolved', label: 'Questions solved', icon: BookOpenCheck, tone: 'purple' },
  { key: 'studentsActiveToday', label: 'Active today', icon: Users, tone: 'magenta' },
] as const

export default function Stats() {
  const [stats, setStats] = useState<PublicStats | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ stats: PublicStats }>('/public/stats')
      .then((res) => {
        if (!cancelled) setStats(res.stats)
      })
      .catch(() => {
        // Real figures or none: a failure simply leaves the strip out.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const shown = FIGURES.filter((figure) => HOME_STATS[figure.key])
  if (!stats || shown.length === 0) return null

  return (
    <section className={`container ${styles.stats}`} aria-label="The Olympiad so far">
      <div className={styles.statGrid}>
        {shown.map(({ key, label, icon: Glyph, tone }) => (
          <StatTile
            key={key}
            icon={<Glyph className={styles.statIcon} aria-hidden="true" />}
            iconTone={tone}
            layout="value-first"
            value={<CountUp value={stats[key]} />}
            label={label}
            className={styles.statTile}
          />
        ))}
      </div>
    </section>
  )
}
