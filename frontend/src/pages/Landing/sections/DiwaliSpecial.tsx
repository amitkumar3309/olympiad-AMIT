import { ArrowRight, Gift } from 'lucide-react'
import { Diya, Firework } from '../../../components/Diwali'
import { Button, ButtonLink } from '../../../components/ui'
import styles from './DiwaliSpecial.module.css'

/**
 * "Diwali Special" (Milestone 30 Phase 7) — the Diwali edition mockup's band under the hero,
 * shown only from 8 to 15 November 2026 (`lib/season.ts`; the markup is always here and
 * hidden outside the dates, so the homepage drawn at build time is right either side of them).
 *
 * **It promises exactly one thing, and the code keeps it**: answer any Daily Quiz during the
 * week and the Diwali 2026 achievement is yours to keep (`backend/src/lib/achievements.ts`,
 * owner-approved 2026-10-08). The mockup's "exclusive launch benefits … and surprises" are not
 * here, because nothing behind them exists.
 */

export interface DiwaliSpecialProps {
  signedIn: boolean
  registerTo: string
  /** "Play today's quiz" — the same flow as the floating button. */
  onPlay: () => void
}

export default function DiwaliSpecial({ signedIn, registerTo, onPlay }: DiwaliSpecialProps) {
  return (
    <section className={`container ${styles.section}`} aria-labelledby="diwali-special-title">
      <div className={styles.band}>
        <div className={styles.art} aria-hidden="true">
          <Firework className={styles.firework} />
          <span className={styles.gift}>
            <Gift />
          </span>
          <Diya className={styles.diya} />
        </div>
        <div className={styles.copy}>
          <p className={styles.pill}>Diwali special</p>
          <h2 id="diwali-special-title" className={styles.title}>
            Earn the Diwali 2026 badge
          </h2>
          <p className={styles.text}>
            Answer any Daily Quiz from 8 to 15 November and it joins your achievements for good.
          </p>
        </div>
        <div className={styles.action}>
          {signedIn ? (
            <Button size="lg" variant="brand" onClick={onPlay} iconAfter={<ArrowRight size={18} aria-hidden="true" />}>
              Play today’s quiz
            </Button>
          ) : (
            <ButtonLink to={registerTo} size="lg" variant="brand" iconAfter={<ArrowRight size={18} aria-hidden="true" />}>
              Register free
            </ButtonLink>
          )}
        </div>
      </div>
    </section>
  )
}
