import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarCheck, ClipboardList, Target, TrendingUp } from 'lucide-react'
import { IconTile, Section, type IconTileTone } from '../../../components/ui'
import { useReveal } from '../motion'
import styles from '../Landing.module.css'

/**
 * "About" — what the Olympiad offers, in four cards (the navbar's About link lands here).
 *
 * It describes the competition, never the name: the expansion of A.M.I.T. is shown once,
 * under the hero's wordmark, and is not explained anywhere (CLAUDE.md).
 *
 * **Every card is a real link now.** They were `interactive` cards — lifting on hover —
 * that went nowhere (INTERACTION_AUDIT D4). Practice, mock tests and insights are
 * signed-in pages, so a guest is asked to sign in and then taken there (`?next=`); the
 * Daily Quiz card runs the same sign-in-first flow as the floating button.
 */

interface Feature {
  tone: IconTileTone
  icon: ReactElement
  title: string
  body: string
  to?: string
}

const FEATURES: Feature[] = [
  {
    tone: 'blue',
    icon: <Target />,
    title: 'Practice',
    body: 'Questions for your class, by chapter and difficulty. Marked instantly, with the solution.',
    to: '/practice',
  },
  {
    tone: 'orange',
    icon: <ClipboardList />,
    title: 'Mock tests',
    body: 'Full-length papers on the server’s clock. Answers save as you go.',
    to: '/mock-tests',
  },
  {
    tone: 'magenta',
    icon: <CalendarCheck />,
    title: 'Daily Quiz',
    body: 'One question a day for your class group. Each month, the top scorer in every class band wins a prize.',
  },
  {
    tone: 'green',
    icon: <TrendingUp />,
    title: 'Performance insights',
    body: 'Accuracy by chapter and difficulty, from papers you have actually submitted.',
    to: '/analytics',
  },
]

export interface AboutProps {
  onPlay: () => void
}

export default function About({ onPlay }: AboutProps) {
  const reveal = useReveal<HTMLUListElement>()
  return (
    <Section
      id="about"
      className={`container ${styles.section}`}
      eyebrow="About the Olympiad"
      title="Four ways to prepare, all of them free"
      lead="The entry fee buys a seat in the Olympiad. Getting ready for it costs nothing."
    >
      <ul ref={reveal} className={styles.featureGrid}>
        {FEATURES.map((feature) => {
          const inner = (
            <>
              <IconTile icon={feature.icon} tone={feature.tone} size="lg" className={styles.featureTile} />
              <span className={styles.featureTitle}>
                {feature.title} <ArrowRight aria-hidden="true" className={styles.featureArrow} />
              </span>
              <span className={styles.featureBody}>{feature.body}</span>
            </>
          )
          return (
            <li key={feature.title}>
              {feature.to ? (
                <Link to={feature.to} className={styles.feature}>
                  {inner}
                </Link>
              ) : (
                <button type="button" className={styles.feature} onClick={onPlay}>
                  {inner}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
