import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, FilePenLine, FileText, Send, Trophy } from 'lucide-react'
import { IconTile, Section, useInView, type IconTileTone } from '../../../components/ui'
import styles from './HowItWorks.module.css'

/**
 * "From registering to being ranked" — four steps, each a link to the page where it
 * happens (brief §7.1 #6; the mockup's copy, which is the product's own).
 *
 * Every step is true as written: registration is free and needs a verified email before
 * the first sign-in; practice, mock tests and the Daily Quiz cost nothing; the Olympiad
 * has an entry fee, shown before paying (no amount here — there is no public endpoint for
 * it, and a marketing page must not invent one); one attempt, in the announced window,
 * with certificates issued when results are released.
 *
 * The dashed paper-plane path above the cards draws itself, left to right, the first
 * time the section is on screen — and is simply drawn if that never happens.
 */

interface Step {
  title: string
  body: string
  to: string
  icon: typeof FileText
  tone: IconTileTone
}

export interface HowItWorksProps {
  registerTo: string
}

export default function HowItWorks({ registerTo }: HowItWorksProps) {
  const pathRef = useRef<HTMLDivElement>(null)
  const drawn = useInView(pathRef, { threshold: 0.3 })

  const steps: Step[] = [
    { title: 'Register', body: 'Free. Confirm your email address before signing in.', to: registerTo, icon: FileText, tone: 'blue' },
    { title: 'Prepare, free', body: 'Practice, mock tests and the Daily Quiz cost nothing.', to: '/practice', icon: BookOpen, tone: 'gold' },
    { title: 'Enter the Olympiad', body: 'The sitting has an entry fee, shown in full before you pay.', to: '/payment', icon: FilePenLine, tone: 'magenta' },
    {
      title: 'Sit it, and be ranked',
      body: 'One attempt, in the announced window. Certificates are issued when results are released.',
      to: '/result',
      icon: Trophy,
      tone: 'orange',
    },
  ]

  return (
    <Section
      id="how-it-works"
      className={`container ${styles.section}`}
      eyebrow="Your journey starts here"
      title="From registering to being ranked"
      lead="A simple four-step path into the A.M.I.T. Olympiad."
    >
      <div ref={pathRef} className={styles.flight} data-drawn={drawn ? 'true' : 'false'} aria-hidden="true">
        <svg className={styles.path} viewBox="0 0 400 80" preserveAspectRatio="none">
          <path d="M4 70 C 90 10, 170 90, 250 40 S 360 20, 380 18" pathLength={1} />
        </svg>
        <Send className={styles.plane} />
      </div>

      <ol className={styles.steps}>
        {steps.map(({ title, body, to, icon: Glyph, tone }, index) => (
          <li key={title}>
            <Link to={to} className={styles.step}>
              <IconTile icon={<Glyph className={styles.stepIcon} />} tone={tone} size="md" />
              <span className={styles.number} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.title}>
                <span className="sr-only">Step {index + 1}: </span>
                {title}
              </span>
              <span className={styles.body}>{body}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  )
}
