import { useEffect, useState } from 'react'
import MathText from '../../components/MathText'
import { api, ApiError } from '../../api/client'
import type { DailyChallenge } from '../../api/types'
import styles from './Dashboard.module.css'

/**
 * Today's challenge question.
 *
 * **Lazy-loaded on purpose.** It renders question content through `MathText`, which
 * pulls in KaTeX (~300 KB of JS and CSS). The dashboard is a page every student
 * opens, so importing that statically would put a maths typesetter in the main
 * bundle for everyone — the same reason the admin question pages are code-split
 * (see `App.tsx`). Keeping this in its own module means the cost is paid only by a
 * student whose class actually has a published challenge.
 *
 * It is deliberately **read-only**. Answering needs somewhere to submit to and
 * something to score against, neither of which exists yet, and the alternative —
 * checking the answer in the browser — would mean shipping the answer key to the
 * client, which is exactly the hole Milestone 4 closed. So the card shows the
 * question and says plainly that answering arrives with scored exams.
 */

interface ChallengeResponse {
  challenge: DailyChallenge | null
  reason?: 'none-published' | 'no-class'
}

export default function DailyChallengeCard() {
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<ChallengeResponse>('/me/daily-challenge')
      .then((res) => {
        if (cancelled) return
        setChallenge(res.challenge)
        setReason(res.reason ?? null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load today’s challenge.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="card">
        <h3>🎲 Today’s challenge</h3>
        <p className={styles.challengeLoading}>Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <h3>🎲 Today’s challenge</h3>
        <div className={styles.empty}>
          <i className="ph-bold ph-warning-circle" />
          <p>{error}</p>
        </div>
      </div>
    )
  }

  if (!challenge) {
    return (
      <div className="card">
        <h3>🎲 Today’s challenge</h3>
        <div className={styles.empty}>
          <i className="ph-bold ph-dice-five" />
          <p>
            {reason === 'no-class'
              ? 'Add your class to your profile and a daily challenge will be picked for it.'
              : 'No challenge today — nothing has been published for your class yet. Check back soon.'}
          </p>
        </div>
      </div>
    )
  }

  const { question } = challenge

  return (
    <div className="card">
      <div className={styles.challengeHead}>
        <h3>🎲 Today’s challenge</h3>
        <span className={styles.challengeBadge}>
          {question.difficulty} · {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
        </span>
      </div>

      <p className={styles.challengeTaxonomy}>
        {[question.subject?.name, question.topic?.name, question.subtopic?.name].filter(Boolean).join(' › ')}
      </p>

      <div className={styles.challengeQuestion}>
        <MathText>{question.questionText}</MathText>
      </div>

      {question.options.length > 0 && (
        <ol className={styles.challengeOptions}>
          {question.options.map((option) => (
            <li key={option.key}>
              <span className={styles.optionKey}>{option.key.toUpperCase()}</span>
              <MathText>{option.text}</MathText>
            </li>
          ))}
        </ol>
      )}

      <p className={styles.challengeNote}>
        Have a go on paper — answering here, with marking and XP, arrives with scored exams.
      </p>
    </div>
  )
}
