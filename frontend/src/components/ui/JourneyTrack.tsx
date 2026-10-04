import { useRef, type ReactNode } from 'react'
import Icon from './Icon'
import { useInView } from './motion'
import styles from './JourneyTrack.module.css'

/**
 * A row of stages, each done, current or locked — the mockups' "6-Month Journey"
 * (Milestone 30).
 *
 * ## State is words first
 *
 * Every stage's state is in its accessible text ("completed", "current stage",
 * "locked"), and a visual marker repeats it: a tick, a "Current" pill, a padlock. The
 * colour of the connector is the third channel, not the first.
 *
 * ## Motion
 *
 * Connectors **draw left to right** the first time the track is on screen, finished
 * ones in the brand colour; the current stage's art breathes gently. Both stop under
 * reduced motion, and `useInView` falls back to "drawn" if the observer never runs.
 *
 * ## On a phone it scrolls, inside itself
 *
 * Six stages do not fit 360px. The track is a contained horizontal scroller with
 * scroll-snap — the page itself never scrolls sideways — and it is keyboard-scrollable
 * (`tabIndex=0`, named), because a region only a finger can scroll is a region a
 * keyboard user cannot see the end of.
 */

export interface JourneyStage {
  key: string
  title: string
  /** "Month 1". */
  caption?: string
  /**
   * `upcoming` is neutral — full colour, no marker — for an overview that belongs to
   * nobody in particular (the homepage's programme, Milestone 30 Phase 3), where a
   * padlock on every stage would read as "you cannot do this".
   */
  state: 'done' | 'current' | 'locked' | 'upcoming'
  /** An `Illustration`, or any decorative art. Optional. */
  art?: ReactNode
}

export interface JourneyTrackProps {
  stages: JourneyStage[]
  /** Names the scroller — "Six-month journey". */
  label: string
  className?: string
}

const STATE_TEXT = { done: 'completed', current: 'current stage', locked: 'locked', upcoming: '' } as const

export default function JourneyTrack({ stages, label, className }: JourneyTrackProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drawn = useInView(ref, { threshold: 0.3 })

  return (
    <div
      ref={ref}
      className={[styles.scroller, className].filter(Boolean).join(' ')}
      // A focusable, named scroll region, so a keyboard can reach the stages that do
      // not fit on a phone.
      tabIndex={0}
      role="region"
      aria-label={label}
      data-drawn={drawn ? 'true' : 'false'}
    >
      <ol className={styles.track}>
        {stages.map((stage, i) => {
          const next = stages[i + 1]
          return (
            <li key={stage.key} className={[styles.stage, styles[stage.state]].join(' ')}>
              <div className={styles.artWrap}>
                <div className={styles.art}>{stage.art}</div>
                <span className={styles.marker} aria-hidden="true">
                  {stage.state === 'done' && <Icon name="ph-check" weight="bold" size="sm" />}
                  {stage.state === 'locked' && <Icon name="ph-lock-simple" weight="bold" size="sm" />}
                </span>
              </div>
              {stage.state === 'current' ? (
                <span className={styles.currentPill}>Current</span>
              ) : (
                stage.caption && <span className={styles.caption}>{stage.caption}</span>
              )}
              <span className={styles.title}>
                {stage.state === 'current' && stage.caption && <span className="sr-only">{stage.caption}: </span>}
                {stage.title}
                {STATE_TEXT[stage.state] && <span className="sr-only">, {STATE_TEXT[stage.state]}</span>}
              </span>
              {next && (
                <span
                  className={[styles.connector, stage.state === 'done' ? styles.connectorDone : ''].join(' ')}
                  style={{ transitionDelay: `${i * 120}ms` }}
                  aria-hidden="true"
                />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
