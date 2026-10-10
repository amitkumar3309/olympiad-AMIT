import type { QuizPrizeInfo } from '../../../api/types'
import { Icon, Section } from '../../../components/ui'
import { smoothToggle, useReveal } from '../motion'
import styles from '../Landing.module.css'

/**
 * Questions a parent or student asks before registering (the navbar's FAQ link).
 *
 * Every answer can be checked against the code. Where the product genuinely varies — the
 * fee, the dates, whether a paper penalises a wrong answer — the answer says where the
 * real figure appears rather than inventing one.
 */
const FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'Who can take part?',
    a: 'Any student from Class 3 to Class 12. There is no restriction by school board.',
  },
  {
    q: 'What does it cost?',
    a: 'Preparation is free — practice, mock tests and the Daily Quiz. Only the official Olympiad has an entry fee, and the amount is shown before you pay.',
  },
  {
    q: 'Is there negative marking?',
    a: 'It depends on the paper. Every question shows its marks and any penalty before you answer it.',
  },
  {
    q: 'When are results published?',
    a: 'The organisers release them after the sitting closes. Your certificate is issued at the same moment.',
  },
  {
    q: 'How many times can I sit the Olympiad?',
    a: 'Once. The system enforces it.',
  },
  {
    q: 'What happens if my connection drops during a paper?',
    a: 'Every answer is saved as you give it and the clock is the server’s. Sign back in and carry on.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. Everything runs in a browser, on a phone or a computer.',
  },
  {
    // `publicListingFor()` decides this for every public list — see the backend.
    q: 'Will my child’s name be published?',
    a: 'Public lists show a first name and a last initial, with class and city or school — never contact details or a photo. A student can hide even that from My Profile.',
  },
]

/**
 * The Daily Quiz answer follows the owner's settings: whether a student sees right or
 * wrong at once is the `instantResult` switch, so the sentence is built from it rather
 * than promising instant results the settings may have turned off.
 */
function dailyQuizAnswer(prize: QuizPrizeInfo | null): string {
  const result =
    prize && !prize.instantResult
      ? 'Your result, the correct answer and the full solution unlock the next day at 12:00 AM.'
      : 'You see straight away whether you were right; the correct answer and the full solution unlock the next day at 12:00 AM.'
  return `One question a day for your class, and one attempt. ${result} Every month, the student who answers the most correctly in each class band wins a prize — the Daily Quiz & Rewards Rules explain how winners are chosen.`
}

export interface FaqProps {
  prize: QuizPrizeInfo | null
}

export default function Faq({ prize }: FaqProps) {
  const faqs = [...FAQS.slice(0, 2), { q: 'How does the Daily Quiz work?', a: dailyQuizAnswer(prize) }, ...FAQS.slice(2)]
  const reveal = useReveal<HTMLDivElement>({ rise: 16, gap: 0.04 })
  return (
    <Section id="faq" className={`container ${styles.section} ${styles.faqSection}`} eyebrow="Questions" title="Before you register">
      <div ref={reveal} className={styles.faqList}>
        {faqs.map((f) => (
          // A native <details>, so it opens before the app has taken the drawn page over; once Motion
          // is here, the answer slides open instead of jumping (`smoothToggle`).
          <details className={styles.faqItem} key={f.q}>
            <summary onClick={smoothToggle}>
              <span>{f.q}</span>
              <Icon name="ph-caret-down" weight="bold" className={styles.faqCaret} />
            </summary>
            <div className={styles.faqBody}>
              <p>{f.a}</p>
            </div>
          </details>
        ))}
      </div>
    </Section>
  )
}
