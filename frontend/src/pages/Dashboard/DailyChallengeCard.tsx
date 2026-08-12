import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import MathText from '../../components/MathText'
import Button from '../../components/Button'
import { api, ApiError } from '../../api/client'
import type { DailyChallengeToday } from '../../api/types'
import styles from './Dashboard.module.css'

/**
 * Today's challenge, as a dashboard card.
 *
 * **Lazy-loaded on purpose.** It renders question content through `MathText`, which
 * pulls in KaTeX (~300 KB of JS and CSS). The dashboard is a page every student opens,
 * so importing that statically would put a maths typesetter in the main bundle for
 * everyone — the same reason the admin question pages are code-split (see `App.tsx`).
 *
 * It used to be read-only, and said so: "answering here, with marking and XP, arrives
 * with scored exams". Milestone 8 built that, so the card now shows the question, says
 * whether today's is still open, and hands the student to `/daily-challenge` to answer
 * it. Answering happens on that page rather than inline for one reason worth stating:
 * the result is a marked answer with a worked explanation, which is more than fits
 * usefully in a dashboard tile.
 */

export default function DailyChallengeCard() {
  const [state, setState] = useState<DailyChallengeToday | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<DailyChallengeToday>('/me/daily-challenge')
      .then((res) => {
        if (!cancelled) setState(res)
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

  if (!state?.challenge) {
    return (
      <div className="card">
        <h3>🎲 Today’s challenge</h3>
        <div className={styles.empty}>
          <i className="ph-bold ph-dice-five" />
          <p>
            {state?.reason === 'no-class'
              ? 'Add your class to your profile and a daily challenge will be set for it.'
              : 'No challenge today — nothing has been published for your class yet. Check back soon.'}
          </p>
        </div>
      </div>
    )
  }

  const { question } = state.challenge
  const answered = state.attempt !== null

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

      {/* Options are shown unanswered as a preview of the question, and suppressed once
          it has been answered — the marked version with the explanation lives on the
          challenge page, and repeating it here would just be a second, worse copy. */}
      {!answered && question.options.length > 0 && (
        <ol className={styles.challengeOptions}>
          {question.options.map((option) => (
            <li key={option.key}>
              <span className={styles.optionKey}>{option.key.toUpperCase()}</span>
              <MathText>{option.text}</MathText>
            </li>
          ))}
        </ol>
      )}

      <div className={styles.challengeActions}>
        <Link to="/daily-challenge">
          <Button variant={answered ? 'outline' : 'primary'}>
            {answered ? 'See your answer' : 'Answer today’s challenge'}
          </Button>
        </Link>
        <span className={styles.challengeNote}>
          {answered
            ? state.attempt?.isCorrect
              ? `Answered — correct, ${state.attempt.awardedMarks}/${state.attempt.marks}.`
              : 'Answered — have a look at the explanation.'
            : `Worth ${state.reward?.xp ?? 0} XP, once a day.${
                (state.streak?.current ?? 0) > 0 ? ` ${state.streak?.current}-day streak going.` : ''
              }`}
        </span>
      </div>
    </div>
  )
}
