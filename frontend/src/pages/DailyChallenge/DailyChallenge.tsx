import { useCallback, useEffect, useState } from 'react'
import StudentShell from '../../components/StudentShell'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Icon,
  SkeletonText,
  StatTile,
} from '../../components/ui'
import MathText from '../../components/MathText'
import { api, ApiError } from '../../api/client'
import type {
  DailyChallengeAnswerResponse,
  DailyChallengeHistoryResponse,
  DailyChallengeResult,
  DailyChallengeToday,
  StudentQuestion,
} from '../../api/types'
import styles from './DailyChallenge.module.css'

/**
 * Today's challenge: one question, answered once, marked by the server.
 *
 * The page has exactly two states and the **server** decides which: `attempt` is null
 * until the student has answered, and the answer key only exists on the payload once it
 * is not. So there is nothing here to guard — a component holding the unanswered shape
 * has no correct answer to leak, because the field does not exist on it.
 *
 * Nothing on this page marks anything, and nothing decides what the reward is or which
 * day it is. The day is the server's (an IST calendar day), the grade is the server's,
 * and the XP figure shown is the one the server says it actually awarded — which is why
 * a repeat submission shows no "+XP" at all rather than repeating the first one's.
 *
 * **Lazily loaded** by `App.tsx`: it renders question content through `MathText`, which
 * pulls in KaTeX (~260 KB) and must stay out of the entry bundle.
 */

function formatDay(day: string): string {
  // The day is already a competition-local calendar date, so it is formatted as a plain
  // date and never re-derived from a timestamp — a browser in another timezone must not
  // be able to relabel it.
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export default function DailyChallengePage() {
  const [today, setToday] = useState<DailyChallengeToday | null>(null)
  const [history, setHistory] = useState<DailyChallengeHistoryResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [booleanResponse, setBooleanResponse] = useState<boolean | null>(null)
  const [numericResponse, setNumericResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [justEarned, setJustEarned] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [state, past] = await Promise.all([
        api.get<DailyChallengeToday>('/me/daily-challenge'),
        api.get<DailyChallengeHistoryResponse>('/me/daily-challenge/history?limit=10'),
      ])
      setToday(state)
      setHistory(past)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load today’s challenge.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const question = today?.challenge?.question ?? null
  const attempt = today?.attempt ?? null

  const canSubmit =
    question !== null &&
    attempt === null &&
    (question.type === 'true_false'
      ? booleanResponse !== null
      : question.type === 'numeric'
        ? numericResponse.trim() !== ''
        : selectedKeys.length > 0)

  function toggleOption(key: string) {
    if (!question) return
    if (question.type === 'multiple_choice') {
      setSelectedKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
    } else {
      setSelectedKeys((keys) => (keys[0] === key ? [] : [key]))
    }
  }

  async function submit() {
    if (!question) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body: Record<string, unknown> = {}
      if (question.type === 'true_false') body.booleanResponse = booleanResponse
      else if (question.type === 'numeric') body.numericResponse = Number(numericResponse)
      else body.selectedOptionKeys = selectedKeys

      const res = await api.post<DailyChallengeAnswerResponse>('/me/daily-challenge/answer', body)
      setJustEarned(res.xpAwarded)
      setToday((current) =>
        current
          ? {
              ...current,
              attempt: res.attempt,
              streak: res.streak,
              completedCount: res.completedCount,
              reward: current.reward ? { ...current.reward, claimed: true } : current.reward,
            }
          : current,
      )
      // The history gains today's row, and the streak on it is the server's.
      setHistory(await api.get<DailyChallengeHistoryResponse>('/me/daily-challenge/history?limit=10'))
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not submit your answer.')
    } finally {
      setSubmitting(false)
    }
  }

  // -------------------------------------------------------------------------

  if (loadError) {
    return (
      <StudentShell title="Daily Challenge">
        <ErrorState error={loadError} title="Could not load today’s challenge" onRetry={() => void load()} />
      </StudentShell>
    )
  }

  if (!today) {
    return (
      <StudentShell title="Daily Challenge">
        <Card>
          <SkeletonText lines={4} label="Loading today’s challenge" />
        </Card>
      </StudentShell>
    )
  }

  const streak = today.streak ?? history?.streak ?? { current: 0, longest: 0 }

  return (
    <StudentShell title="Daily Challenge" subtitle={`One question a day · ${formatDay(today.today)}`}>
      <section className={styles.statRow}>
        <StatTile icon="ph-flame" tone="warning" label="Day streak" value={streak.current} />
        <StatTile icon="ph-trophy" tone="neutral" label="Best streak" value={streak.longest} />
        <StatTile
          icon="ph-check-circle"
          tone="success"
          label="Answered"
          value={today.completedCount ?? history?.completedCount ?? 0}
        />
        <StatTile
          icon="ph-star"
          label="XP"
          // `null` when there is no reward configured — an em dash, never a zero that
          // would read as an offer of nothing.
          value={today.reward ? `+${today.reward.xp}` : null}
          hint={today.reward?.claimed ? 'Claimed today' : 'For answering today'}
        />
      </section>

      {!today.challenge ? (
        <Card>
          <EmptyState
            icon="ph-dice-five"
            title="No challenge today"
            description={
              today.reason === 'no-class'
                ? 'Add your class to your profile and a daily challenge will be set for it.'
                : 'Nothing has been published for your class yet. This page fills in as soon as it is.'
            }
            action={
              today.reason === 'no-class' ? (
                <ButtonLink to="/profile" variant="secondary" icon="ph-user-circle">
                  Go to my profile
                </ButtonLink>
              ) : (
                <ButtonLink to="/practice" variant="secondary" icon="ph-target">
                  Practise in the meantime
                </ButtonLink>
              )
            }
          />
        </Card>
      ) : (
        <Card>
          <div className={styles.questionHead}>
            {question?.topic?.name && <Badge tone="neutral">{question.topic.name}</Badge>}
            <Badge tone="neutral" uppercase size="sm">
              {question?.difficulty}
            </Badge>
            <Badge tone="primary" size="sm">
              {today.challenge.question.marks}{' '}
              {today.challenge.question.marks === 1 ? 'mark' : 'marks'}
            </Badge>
          </div>

          <div className={styles.questionText}>
            <MathText>{today.challenge.question.questionText}</MathText>
          </div>

          {attempt === null ? (
            <>
              {question?.type === 'multiple_choice' && (
                <p className={styles.hint}>Select every correct option — all of them must be right.</p>
              )}

              {question && question.options.length > 0 && (
                <div className={styles.options}>
                  {question.options.map((option) => {
                    const chosen = selectedKeys.includes(option.key)
                    return (
                      <button
                        type="button"
                        key={option.key}
                        className={`${styles.option} ${chosen ? styles.optionChosen : ''}`}
                        onClick={() => toggleOption(option.key)}
                        aria-pressed={chosen}
                      >
                        <span className={styles.optionKey}>{option.key.toUpperCase()}</span>
                        <MathText>{option.text}</MathText>
                      </button>
                    )
                  })}
                </div>
              )}

              {question?.type === 'true_false' && (
                <div className={styles.options}>
                  {[true, false].map((value) => (
                    <button
                      type="button"
                      key={String(value)}
                      className={`${styles.option} ${booleanResponse === value ? styles.optionChosen : ''}`}
                      onClick={() => setBooleanResponse(booleanResponse === value ? null : value)}
                      aria-pressed={booleanResponse === value}
                    >
                      <span className={styles.optionKey}>{value ? 'T' : 'F'}</span>
                      {value ? 'True' : 'False'}
                    </button>
                  ))}
                </div>
              )}

              {question?.type === 'numeric' && (
                <div className={styles.numericRow}>
                  <label htmlFor="challenge-answer">Your answer</label>
                  <input
                    id="challenge-answer"
                    className="form-control"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={numericResponse}
                    onChange={(e) => setNumericResponse(e.target.value)}
                  />
                </div>
              )}

              {submitError && <Alert tone="danger">{submitError}</Alert>}

              <div className={styles.submitRow}>
                <Button
                  size="lg"
                  icon="ph-check"
                  loading={submitting}
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                >
                  {submitting ? 'Marking' : 'Submit answer'}
                </Button>
                <span className={styles.submitNote}>
                  One answer a day. A wrong answer is never penalised — the XP is for taking part.
                </span>
              </div>
            </>
          ) : (
            <ChallengeResult attempt={attempt} question={today.challenge.question} justEarned={justEarned} />
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Your past challenges" size="sm" as="h2" />
        {!history ? (
          <SkeletonText lines={3} label="Loading your past challenges" />
        ) : history.attempts.length === 0 ? (
          <EmptyState
            size="sm"
            icon="ph-clock-counter-clockwise"
            title="Nothing yet"
            description="Every challenge you answer is listed here, right or wrong, with the mark it earned."
          />
        ) : (
          <ul className={styles.history}>
            {history.attempts.map((entry) => (
              <li key={entry.id}>
                <span className={`${styles.verdictDot} ${entry.isCorrect ? styles.dotCorrect : styles.dotWrong}`}>
                  <Icon
                    name={entry.isCorrect ? 'ph-check' : 'ph-x'}
                    weight="bold"
                    size="xs"
                    label={entry.isCorrect ? 'Correct' : 'Incorrect'}
                  />
                </span>
                <div className={styles.historyMain}>
                  <span className={styles.historyDay}>{formatDay(entry.day)}</span>
                  <span className={styles.historyText}>
                    {entry.questionText ? (
                      <MathText>{entry.questionText.slice(0, 90)}</MathText>
                    ) : (
                      'Challenge'
                    )}
                  </span>
                </div>
                <span className={styles.historyMarks}>
                  {entry.awardedMarks}/{entry.marks}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </StudentShell>
  )
}

/**
 * The marked answer.
 *
 * Only reachable with an attempt in hand, which by construction only exists once the
 * student has answered — so the reveal below needs no extra condition. Unlike a mock
 * test there is no disclosure policy: a daily challenge exists to teach one question a
 * day, and holding its explanation back would defeat the point.
 */
function ChallengeResult({
  attempt,
  question,
  justEarned,
}: {
  attempt: DailyChallengeResult
  question: StudentQuestion
  justEarned: number | null
}) {
  function correctAnswerText(): string {
    if (question.type === 'true_false') return attempt.correctAnswer.booleanAnswer ? 'True' : 'False'
    if (question.type === 'numeric') {
      const tolerance = attempt.correctAnswer.tolerance
      const value = String(attempt.correctAnswer.numericAnswer ?? '—')
      return tolerance && tolerance > 0 ? `${value} (± ${tolerance})` : value
    }
    return attempt.correctAnswer.optionKeys.map((key) => key.toUpperCase()).join(', ')
  }

  function yourAnswerText(): string {
    if (question.type === 'true_false') return attempt.response.booleanResponse ? 'True' : 'False'
    if (question.type === 'numeric') return String(attempt.response.numericResponse)
    return attempt.response.selectedOptionKeys.map((key) => key.toUpperCase()).join(', ')
  }

  return (
    <div className={styles.result}>
      {/* The verdict carries an icon, a word and a mark — three channels, so it never
          depends on telling green from red. */}
      <div className={`${styles.verdict} ${attempt.isCorrect ? styles.verdictCorrect : styles.verdictWrong}`}>
        <Icon name={attempt.isCorrect ? 'ph-check-circle' : 'ph-x-circle'} weight="bold" size="md" />
        <span>{attempt.isCorrect ? 'Correct' : 'Not quite'}</span>
        <span className={styles.verdictMarks}>
          {attempt.awardedMarks}/{attempt.marks}
        </span>
      </div>

      {/* Only what this submission actually earned. A repeat submission earns nothing
          and says nothing, rather than repeating the first one's reward. */}
      {justEarned !== null && justEarned > 0 && (
        <Alert tone="success" icon="ph-star" className={styles.xpNote}>
          +{justEarned} XP earned for today’s challenge.
        </Alert>
      )}
      {justEarned === 0 && (
        <Alert tone="info" className={styles.xpNote}>
          You had already answered today — your first answer is the one that counts.
        </Alert>
      )}

      {question.options.length > 0 && (
        <ul className={styles.reviewOptions}>
          {question.options.map((option) => {
            const chosen = attempt.response.selectedOptionKeys.includes(option.key)
            const correct = attempt.correctAnswer.optionKeys.includes(option.key)
            return (
              <li
                key={option.key}
                className={`${correct ? styles.optCorrect : ''} ${chosen && !correct ? styles.optWrong : ''}`}
              >
                <span className={styles.optionKey}>{option.key.toUpperCase()}</span>
                <MathText>{option.text}</MathText>
                {correct && (
                  <Icon name="ph-check" weight="bold" className={styles.optIcon} label="Correct answer" />
                )}
                {chosen && !correct && (
                  <Icon name="ph-x" weight="bold" className={styles.optIcon} label="Your answer" />
                )}
              </li>
            )
          })}
        </ul>
      )}

      <dl className={styles.answerPair}>
        <div>
          <dt>Your answer</dt>
          <dd>{yourAnswerText()}</dd>
        </div>
        <div>
          <dt>Correct answer</dt>
          <dd>{correctAnswerText()}</dd>
        </div>
      </dl>

      {attempt.explanation && (
        <div className={styles.explanation}>
          <h5>Explanation</h5>
          <MathText>{attempt.explanation}</MathText>
        </div>
      )}

      {attempt.revisionChanged && (
        <p className={styles.revisionNote}>
          This question has been edited since you answered it, so the wording above may differ from what you saw. Your
          mark was calculated against the version you were served.
        </p>
      )}

      <p className={styles.tomorrow}>
        <Icon name="ph-sun-horizon" weight="bold" size="sm" />
        <span>A new challenge is set for your class every day.</span>
      </p>
    </div>
  )
}
