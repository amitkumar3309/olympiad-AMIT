import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { api } from '../../../api/client'
import type { PublicJourneyStage } from '../../../api/types'
import Illustration from '../../../components/Illustration'
import type { IllustrationName } from '../../../components/illustrations'
import { Button, JourneyTrack, Modal, Section } from '../../../components/ui'
import styles from '../Landing.module.css'

/**
 * The journey (brief §7.1 #7) — **the platform's own nine milestones**, not the mockup's
 * six themed months. The owner chose this on 2026-10-04 (PLAN.md Q7): there is no
 * programme calendar behind "Number Forest → Olympiad Kingdom", and a journey of invented
 * topics would be a promise nothing tracks. These nine are the ones every student's
 * dashboard measures (`backend/src/lib/journey.ts`), read from `GET /public/journey` so
 * the homepage and the dashboard cannot describe them differently.
 *
 * On the homepage it is an overview that belongs to nobody, so every stage is `upcoming`
 * — no ticks, no padlocks. "View full journey" opens each stage's description. On a phone
 * the track scrolls inside itself, snapping stage by stage; the page never scrolls sideways.
 */

/** Art for each stage id. A stage the registry does not know simply has none. */
const ART: Record<string, IllustrationName> = {
  enrolled: 'journey-enrolled',
  verified: 'journey-verified',
  first_practice: 'journey-first-practice',
  first_challenge: 'journey-first-quiz',
  habit: 'journey-habit',
  first_mock: 'journey-first-mock',
  level_3: 'journey-level-3',
  seasoned: 'journey-seasoned',
  olympiad_ready: 'journey-olympiad-ready',
}

export default function Journey() {
  const [stages, setStages] = useState<PublicJourneyStage[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ stages: PublicJourneyStage[] }>('/public/journey')
      .then((res) => {
        if (!cancelled) setStages(res.stages)
      })
      .catch(() => {
        if (!cancelled) setStages([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Nothing to show is nothing shown — never a made-up path.
  if (!stages || stages.length === 0) return null

  return (
    <Section
      className={`container ${styles.section}`}
      eyebrow="Level up with every challenge"
      title="Your journey to the Olympiad"
      lead="Nine milestones, from your first day to Olympiad-ready. Your dashboard tracks each one."
      actions={
        <Button variant="link" onClick={() => setOpen(true)} iconAfter={<ArrowRight size={16} aria-hidden="true" />}>
          View full journey
        </Button>
      }
    >
      <div className={styles.journeyCard}>
        <JourneyTrack
          label="The journey's nine milestones"
          stages={stages.map((stage, i) => {
            const art = ART[stage.id]
            return {
              key: stage.id,
              caption: `Step ${i + 1}`,
              title: stage.title,
              state: 'upcoming' as const,
              art: art ? <Illustration name={art} /> : undefined,
            }
          })}
        />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Your journey to the Olympiad" size="md">
        <ol className={styles.journeyList}>
          {stages.map((stage, i) => (
            <li key={stage.id}>
              <span className={styles.journeyStep}>Step {i + 1}</span>
              <span className={styles.journeyTitle}>{stage.title}</span>
              <span className={styles.journeyText}>{stage.description}</span>
            </li>
          ))}
        </ol>
      </Modal>
    </Section>
  )
}
