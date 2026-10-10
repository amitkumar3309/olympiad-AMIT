import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import DailyQuizPanel from '../../components/DailyQuizPanel'
import { Icon } from '../../components/ui'
import { api } from '../../api/client'
import type { QuizPrizeInfo } from '../../api/types'
import styles from './DailyQuiz.module.css'

/**
 * `/daily-quiz` — today's question, one attempt, answer unlocked the next day
 * (Milestone 30, Phase 2; brief §6.4).
 *
 * The quiz itself is `components/DailyQuizPanel`, shared with the dashboard card. Under it, a
 * short strip of what a student needs to know before playing (owner, 2026-10-11: the long "how
 * winners are chosen" box beside the quiz was too much). The winner rule itself is not restated
 * here — it is the sentence the server generates, printed in full on the rules page, which the
 * strip links to — so the page and the ranking still cannot disagree.
 *
 * **Lazily loaded** by `App.tsx`: the panel renders maths through `MathText`, which pulls
 * in KaTeX and must stay out of the entry bundle.
 */
export default function DailyQuizPage() {
  const [info, setInfo] = useState<QuizPrizeInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ info: QuizPrizeInfo }>('/daily-quiz/info')
      .then((res) => {
        if (!cancelled) setInfo(res.info)
      })
      .catch(() => {
        // The strip falls back to wording that needs no settings.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Until the settings arrive, the default: right or wrong is shown at once.
  const instant = info?.instantResult ?? true

  return (
    <StudentShell title="Daily Quiz" subtitle="One question a day · the answer unlocks tomorrow">
      <div className={styles.layout}>
        <DailyQuizPanel />

        <section className={styles.notes} aria-labelledby="quiz-notes">
          <h2 id="quiz-notes" className="sr-only">
            Good to know
          </h2>
          <ul className={styles.points}>
            <li>
              <Icon name="ph-clock" size="lg" />
              <span>Open until 11:59 PM, India time</span>
            </li>
            <li>
              <Icon name="ph-lock-key-open" size="lg" />
              <span>{instant ? 'Right or wrong at once; the answer unlocks tomorrow' : 'Your result and the answer unlock tomorrow'}</span>
            </li>
            <li>
              <Icon name="ph-trophy" size="lg" />
              <span>{info?.prizeHeadline ?? 'A prize every month'}</span>
            </li>
          </ul>
          <p className={styles.links}>
            <Link to="/rewards/rules">How winners are chosen</Link>
            <Link to="/daily-quiz/archive">Past quizzes and answers</Link>
          </p>
        </section>
      </div>
    </StudentShell>
  )
}
