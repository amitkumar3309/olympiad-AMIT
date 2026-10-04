import type { CSSProperties } from 'react'
import { ArrowRight, BookOpen, GraduationCap, Laptop, Lightbulb, Pi, Quote, School, Sigma, Trophy, Triangle } from 'lucide-react'
import Illustration from '../../../components/Illustration'
import { ButtonLink } from '../../../components/ui'
import { AMIT_COMPETITION_YEAR, AMIT_FULL_FORM, AMIT_OLYMPIAD, AMIT_SHORT, AMIT_TAGLINE } from '../../../lib/brand'
import { HERO_QUOTE } from '../../../lib/siteConfig'
import styles from './Hero.module.css'

/**
 * The hero (brief §7.1 #2, the landing mockup's top band).
 *
 * ## Every claim is one the product backs
 *
 * The four chips are facts the code enforces: the class list is `Class 3`–`Class 12`
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
 * The headline, chips and buttons settle into place on load — transform only, staggered,
 * all done inside ~650ms (brief §5.7). Nothing starts invisible: if the animation never
 * runs (a background tab, reduced motion) the content is simply where it belongs. The
 * doodles around the artwork breathe and turn in place; they never translate — the
 * landing page's rule for anything that moves (CLAUDE.md).
 */

export interface HeroProps {
  /** A signed-in student gets "Go to dashboard" instead of "Register for free". */
  signedIn: boolean
  registerTo: string
}

const CHIPS = [
  { icon: GraduationCap, label: 'Classes 3 to 12', tone: 'gold' },
  { icon: School, label: 'Any school board', tone: 'orange' },
  { icon: BookOpen, label: 'Free to prepare', tone: 'green' },
  { icon: Laptop, label: 'Online mode', tone: 'magenta' },
] as const

export default function Hero({ signedIn, registerTo }: HeroProps) {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <p className={styles.eyebrow} style={{ '--i': 0 } as CSSProperties}>
            <Trophy aria-hidden="true" /> National-level mathematics olympiad
          </p>
          <h1 id="hero-title" className={styles.title} style={{ '--i': 1 } as CSSProperties}>
            {AMIT_OLYMPIAD} <span className={styles.year}>{AMIT_COMPETITION_YEAR}</span>
          </h1>
          {/* The expansion, directly under the name it expands. Nowhere else on this page. */}
          <p className={styles.fullForm} style={{ '--i': 2 } as CSSProperties}>
            {AMIT_FULL_FORM}
          </p>

          <ul className={styles.chips} style={{ '--i': 3 } as CSSProperties}>
            {CHIPS.map(({ icon: Glyph, label, tone }) => (
              <li key={label} className={styles.chip}>
                <span className={`${styles.chipIcon} ${styles[tone]}`} aria-hidden="true">
                  <Glyph />
                </span>
                {label}
              </li>
            ))}
          </ul>

          <div className={styles.actions} style={{ '--i': 4 } as CSSProperties}>
            {signedIn ? (
              <ButtonLink to="/dashboard" size="lg" variant="brand" iconAfter={<ArrowRight size={18} aria-hidden="true" />}>
                Go to dashboard
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

        <div className={styles.art}>
          <Illustration name="hero-student" priority className={styles.illustration} />
          {/* Decorative doodles — they turn and breathe in place. */}
          <span className={`${styles.doodle} ${styles.doodleBulb}`} aria-hidden="true">
            <Lightbulb />
          </span>
          <span className={`${styles.doodle} ${styles.doodlePi}`} aria-hidden="true">
            <Pi />
          </span>
          <span className={`${styles.doodle} ${styles.doodleTriangle}`} aria-hidden="true">
            <Triangle />
          </span>
          <span className={`${styles.doodle} ${styles.doodleSigma}`} aria-hidden="true">
            <Sigma />
          </span>
          <p className={styles.hand} aria-hidden="true">
            {AMIT_TAGLINE.split(' • ').map((word) => (
              <span key={word}>{word}</span>
            ))}
          </p>
          <figure className={styles.quote}>
            <Quote aria-hidden="true" className={styles.quoteMark} />
            <blockquote>{HERO_QUOTE}</blockquote>
            <figcaption>— {AMIT_SHORT}</figcaption>
          </figure>
        </div>
      </div>
    </section>
  )
}
