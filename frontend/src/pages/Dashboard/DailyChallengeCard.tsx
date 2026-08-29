import { useEffect, useState } from 'react'
import MathText from '../../components/MathText'
import { Badge, ButtonLink, Card, CardHeader, EmptyState, SkeletonText } from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import { api } from '../../api/client'
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
        if (!cancelled) setError(humanizeError(err, { fallback: 'Could not load today’s challenge.' }))
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
      <Card>
        <CardHeader title="Today's challenge" size="sm" as="h3" />
        <SkeletonText lines={3} label="Loading today's challenge" />
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader title="Today's challenge" size="sm" as="h3" />
        <EmptyState size="sm" icon="ph-warning-circle" title="Could not be loaded" description={error} />
      </Card>
    )
  }

  if (!state?.challenge) {
    return (
      <Card>
        <CardHeader title="Today's challenge" size="sm" as="h3" />
        <EmptyState
          size="sm"
          icon="ph-dice-five"
          title={state?.reason === 'no-class' ? 'We need your class first' : 'No challenge today'}
          description={
            state?.reason === 'no-class'
              ? 'Add your class to your profile and a daily challenge will be set for it.'
              : 'Nothing has been published for your class yet. A challenge appears here as soon as one is.'
          }
        />
      </Card>
    )
  }

  const { question } = state.challenge
  const answered = state.attempt !== null

  return (
    <Card>
      <CardHeader
        title="Today's challenge"
        size="sm"
        as="h3"
        actions={
          <Badge tone="neutral" uppercase size="sm">
            {question.difficulty} · {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
          </Badge>
        }
      />

      {[question.topic?.name, question.subtopic?.name].filter(Boolean).length > 0 && (
        <p className={styles.challengeTaxonomy}>
          {[question.topic?.name, question.subtopic?.name].filter(Boolean).join(' › ')}
        </p>
      )}

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
        <ButtonLink
          to="/daily-challenge"
          variant={answered ? 'secondary' : 'primary'}
          icon={answered ? 'ph-eye' : 'ph-pencil-simple'}
        >
          {answered ? 'See your answer' : 'Answer today’s challenge'}
        </ButtonLink>
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
    </Card>
  )
}
