import { useEffect, useState } from 'react'
import StudentShell from '../../components/StudentShell'
import DailyQuizPanel from '../../components/DailyQuizPanel'
import { Card, CardHeader, SkeletonText } from '../../components/ui'
import { api } from '../../api/client'
import type { QuizPrizeInfo } from '../../api/types'
import styles from './DailyQuiz.module.css'

/**
 * `/daily-quiz` — today's question, one attempt, answer unlocked the next day
 * (Milestone 30, Phase 2; brief §6.4).
 *
 * The quiz itself is `components/DailyQuizPanel`, shared with the dashboard card. This
 * page adds the one thing a student should be able to read before playing for a prize:
 * how the winner is chosen, in the sentence the server generates from the same settings
 * it ranks by — so the page and the ranking cannot disagree.
 *
 * **Lazily loaded** by `App.tsx`: the panel renders maths through `MathText`, which pulls
 * in KaTeX and must stay out of the entry bundle.
 */
export default function DailyQuizPage() {
  const [info, setInfo] = useState<QuizPrizeInfo | null>(null)
  const [infoFailed, setInfoFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ info: QuizPrizeInfo }>('/daily-quiz/info')
      .then((res) => {
        if (!cancelled) setInfo(res.info)
      })
      .catch(() => {
        if (!cancelled) setInfoFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <StudentShell title="Daily Quiz" subtitle="One question a day · the answer unlocks tomorrow">
      <div className={styles.layout}>
        <div className={styles.main}>
          <DailyQuizPanel />
        </div>
        <Card as="section" className={styles.aside} aria-labelledby="how-winners">
          <CardHeader title={<span id="how-winners">How winners are chosen</span>} as="h2" size="sm" />
          {info ? (
            <>
              <p className={styles.headline}>{info.prizeHeadline}</p>
              <p className={styles.rule}>{info.howWinnersAreChosen}</p>
              <ul className={styles.points}>
                <li>The quiz opens at 12:00 AM and closes at 11:59 PM, India time.</li>
                <li>One attempt per student. Your first answer is final.</li>
                <li>
                  {info.instantResult
                    ? 'You see right or wrong as soon as you submit; the correct option and the full solution unlock the next day.'
                    : 'Results, the correct option and the full solution all unlock the next day.'}
                </li>
                <li>Winners are announced the day after the quiz, once the organisers have checked them.</li>
              </ul>
            </>
          ) : infoFailed ? (
            <p className={styles.rule}>The rules could not be loaded just now. They are the same for every student, every day.</p>
          ) : (
            <SkeletonText lines={4} label="Loading how winners are chosen" />
          )}
        </Card>
      </div>
    </StudentShell>
  )
}
