import { useEffect, useState, type CSSProperties } from 'react'
import { ArrowRight, Check, Trophy } from 'lucide-react'
import { Diya, Lantern } from '../../../components/Diwali'
import { ButtonLink, Countdown, clockOffset } from '../../../components/ui'
import { api } from '../../../api/client'
import { AMIT_COMPETITION_YEAR, AMIT_FULL_FORM, AMIT_OLYMPIAD, AMIT_SHORT } from '../../../lib/brand'
import { DIWALI_EDITION, editionEndsAt } from '../../../lib/season'
import HeroArt from './HeroArt'
import { useHeroDepth } from '../motion'
import styles from './Hero.module.css'

/**
 * The hero (brief §7.1 #2, the landing mockup's top band).
 *
 * ## Every claim is one the product backs
 *
 * The four facts are ones the code enforces: the class list is `Class 3`–`Class 12`
 * (`lib/classLevels.ts`); registration asks for no board; practice, mock tests and the
 * Daily Quiz cost nothing (the entry fee gates the official Olympiad alone); and the
 * sitting is online (`/exam`). The year is owner-supplied and lives in `lib/brand.ts`.
 *
 * ## The expansion appears here, once
 *
 * Directly under the wordmark, set as part of the logotype — and nowhere else on screen
 * (CLAUDE.md). It is not explained.
 *
 * ## One orchestrated moment
 *
 * The headline, facts and buttons settle into place on load — transform only, staggered,
 * all done inside ~650ms (brief §5.7) — and carry on rather than start again when the app
 * takes the drawn page over (`--drawn-for`, src/main.tsx). Nothing starts invisible: if the
 * animation never runs (a background tab, reduced motion) the content is simply where it
 * belongs. The artwork is the figure of the day (`HeroArt`), which the pointer tilts a little
 * on a desktop (`useHeroDepth`); behind it all, faint graph paper.
 *
 * ## The Diwali edition (Phase 7 — 8 to 15 November 2026, `lib/season.ts`)
 *
 * The same hero, at night: lanterns hanging in the sky, the name in gold, and "Launched this
 * Diwali" with a countdown. The sky and its fireworks are the whole site's, behind every page
 * (`components/Fireworks`); the hero keeps only the night's veil behind its words, so a
 * firework bursting behind the name never takes it below its contrast, and around the words
 * the sky is open. There is still exactly one hero and one `h1`
 * — the festive parts are always in the markup and shown only under
 * `<html data-season="diwali">`, which `public/boot.js` sets before the first paint, so the
 * homepage drawn at build time is right on either side of the dates and nothing moves when
 * the app takes over. The words are the owner's choice (2026-10-08) and true from 8 November:
 * the site launched on Diwali; the countdown is the server's.
 */

export interface HeroProps {
  /** A signed-in student gets "Go to dashboard" instead of "Register for free". */
  signedIn: boolean
  /** A signed-in administrator: the link goes to the admin panel, not a student dashboard. */
  staff?: boolean
  registerTo: string
}

/** Facts the code enforces — see the note above. */
const FACTS = ['Classes 3 to 12', 'Any school board', 'Free to prepare', 'Online'] as const

export default function Hero({ signedIn, staff = false, registerTo }: HeroProps) {
  const depth = useHeroDepth()

  return (
    <section ref={depth.stage} className={styles.hero} aria-labelledby="hero-title">
      {/* Graph paper behind the words and the figure — decoration, hidden during the Diwali edition. */}
      <div className={styles.backdrop} aria-hidden="true" />

      {/* The Diwali lanterns — decoration, shown only during the edition. */}
      <div className={styles.sky} aria-hidden="true">
        <Lantern className={`${styles.lantern} ${styles.lanternLeft}`} />
        <Lantern className={`${styles.lantern} ${styles.lanternRight}`} />
      </div>

      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <p className={styles.eyebrow} style={{ '--i': 0 } as CSSProperties}>
            <Trophy aria-hidden="true" /> National-level mathematics olympiad
          </p>
          <h1 id="hero-title" className={styles.title} style={{ '--i': 1 } as CSSProperties}>
            <span className={styles.short}>{AMIT_SHORT}</span>
            {AMIT_OLYMPIAD.slice(AMIT_SHORT.length)} <span className={styles.year}>{AMIT_COMPETITION_YEAR}</span>
          </h1>
          {/* The expansion, directly under the name it expands. Nowhere else on this page. */}
          <p className={styles.fullForm} style={{ '--i': 2 } as CSSProperties}>
            {AMIT_FULL_FORM}
          </p>

          <ul className={styles.facts} style={{ '--i': 3 } as CSSProperties}>
            {FACTS.map((fact) => (
              <li key={fact} className={styles.fact}>
                <Check aria-hidden="true" className={styles.factMark} />
                {fact}
              </li>
            ))}
          </ul>

          {/* The Diwali edition's block — shown only during it. */}
          <div className={styles.diwali} style={{ '--i': 4 } as CSSProperties}>
            <p className={styles.diwaliWords}>
              <span className={styles.diwaliKicker}>Launched this</span>
              <span className={styles.diwaliWord}>
                <Diya className={styles.diwaliDiya} />
                Diwali
                <Diya className={styles.diwaliDiya} />
              </span>
              <span className="sr-only">: </span>
              <span className={styles.diwaliLine}>A brighter mind for a brighter future</span>
            </p>
            <DiwaliCountdown />
          </div>

          <div className={styles.actions} style={{ '--i': 5 } as CSSProperties}>
            {signedIn ? (
              <ButtonLink to={staff ? '/admin' : '/dashboard'} size="lg" variant="brand" iconAfter={<ArrowRight size={18} aria-hidden="true" />}>
                {staff ? 'Go to the admin panel' : 'Go to dashboard'}
              </ButtonLink>
            ) : (
              <ButtonLink to={registerTo} size="lg" variant="brand" iconAfter={<ArrowRight size={18} aria-hidden="true" />}>
                Register for free
              </ButtonLink>
            )}
            {/* An in-page link: the hash is followed by the homepage, which scrolls to it. */}
            <ButtonLink to="/#how-it-works" size="lg" variant="secondary">
              Explore more
            </ButtonLink>
          </div>
        </div>

        {/* The figure of the day — a new one each day, chosen before the first paint. */}
        <HeroArt layers={depth.layers} />
      </div>
    </section>
  )
}

interface QuizToday {
  day: string
  hasQuiz: boolean
  closesAt: string
  serverNow: string
}

/** What the countdown counts to, once the server has said. */
interface CountTarget {
  label: string
  target: string
  offsetMs: number
  hasQuiz: boolean
}

/**
 * The Diwali block's countdown: to when **today's Daily Quiz closes**, by the server's clock
 * (`GET /daily-quiz/today`). On a day with no quiz it counts to the end of Diwali week
 * instead, rather than claim a quiz that is not there.
 *
 * Asked for only while the edition is on — outside it this box is not shown and the request
 * would be for nothing (reading `<html>` in an effect is fine: the build-time draw never runs
 * effects). Until the answer arrives it shows its boxes empty, so the figures arriving moves
 * nothing; reaching zero asks the server again rather than deciding the day has turned.
 */
function DiwaliCountdown() {
  const [count, setCount] = useState<CountTarget | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (document.documentElement.getAttribute('data-season') !== DIWALI_EDITION.kind) return
    let cancelled = false
    api
      .get<{ today: QuizToday }>('/daily-quiz/today')
      .then(({ today }) => {
        if (cancelled) return
        setCount(
          today.hasQuiz
            ? { label: 'Today’s Daily Quiz closes in', target: today.closesAt, offsetMs: clockOffset(today.serverNow), hasQuiz: true }
            : { label: 'Diwali week ends in', target: editionEndsAt(), offsetMs: clockOffset(today.serverNow), hasQuiz: false },
        )
      })
      .catch(() => {
        // The quiz is unknown: the week's end is a fixed date, so that is still true to count to.
        if (!cancelled) setCount({ label: 'Diwali week ends in', target: editionEndsAt(), offsetMs: 0, hasQuiz: false })
      })
    return () => {
      cancelled = true
    }
  }, [round])

  return (
    <div className={styles.countdownBox}>
      <p className={styles.countdownLabel}>{count ? count.label : 'Today’s Daily Quiz'}</p>
      {count ? (
        <Countdown
          target={count.target}
          offsetMs={count.offsetMs}
          variant="units"
          showDays={!count.hasQuiz}
          label={count.label}
          onComplete={() => setRound((n) => n + 1)}
          className={styles.countdown}
        />
      ) : (
        <div className={styles.countdownWaiting} aria-hidden="true">
          {['Hours', 'Minutes', 'Seconds'].map((unit) => (
            <span key={unit} className={styles.waitingUnit}>
              <span className={styles.waitingValue}>--</span>
              <span className={styles.waitingLabel}>{unit}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
