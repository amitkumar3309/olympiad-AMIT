import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Confetti,
  Countdown,
  EmptyState,
  ErrorState,
  Icon,
  Modal,
  OptionGroup,
  OptionTile,
  SkeletonText,
  clockOffset,
} from './ui'
import MathText from './MathText'
import QuestionPicture from './QuestionPicture'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import {
  ELIGIBILITY_LABELS,
  type DailyQuizHistoryResponse,
  type DailyQuizStartResponse,
  type DailyQuizSubmitResponse,
  type DailyQuizToday,
  type NotificationPrefs,
  type QuizHistoryRow,
  type QuizPrizeInfo,
  type QuizReminders,
} from '../api/types'
import { formatDayKey, formatSolveTime, formatTime } from '../lib/format'
import { humanizeError } from '../lib/errors'
import { bandLabelFor, prizeLine } from '../lib/dailyQuizCopy'
import styles from './DailyQuizPanel.module.css'

/**
 * Today's Daily Quiz, in every state it can be in (Milestone 30, Phase 2 — brief §6.4).
 *
 * One component for the `/daily-quiz` page and the dashboard card (`variant="card"`), so
 * the two can never disagree about what a student may do.
 *
 * ## Nothing here decides anything
 *
 * The server decides the day, whether the quiz is open, the question, the option order,
 * whether an answer was right and what it earned. This component **displays** those, and
 * every countdown is offset from the server's clock (`serverNow`), never the device's.
 * When a countdown reaches zero it re-asks the server rather than assuming what changed.
 *
 * ## Resilience (brief §6.4)
 *
 * The chosen option is kept in `localStorage` until it is submitted, so a reload, a
 * second tab or a session that expired mid-quiz returns to the same choice. Submitting
 * is idempotent on the server, so a retry after a failure is always safe: it either
 * records the answer or reports the one already recorded.
 *
 * ## The 7:00 AM reminder (Milestone 30 Phase 7b)
 *
 * Offered with one tap below the quiz — never while a question is being answered — and only
 * when the server says one can really be sent (`reminders.available`). See `ReminderOffer`.
 */

export interface DailyQuizPanelProps {
  /** `page` for `/daily-quiz`; `card` for the dashboard, with a link to the page. */
  variant?: 'page' | 'card'
}

const SELECTION_PREFIX = 'amit.dailyQuiz.selection:'

function readSelection(key: string): string | null {
  try {
    return window.localStorage.getItem(SELECTION_PREFIX + key)
  } catch {
    return null
  }
}

function writeSelection(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(SELECTION_PREFIX + key)
    else window.localStorage.setItem(SELECTION_PREFIX + key, value)
  } catch {
    // Private browsing or blocked storage: the choice simply is not remembered.
  }
}

/**
 * The day monthly prizes start while it is still ahead, else null (owner, 2026-10-09 — PLAN.md
 * Q24: November counts from the launch on the 8th). Both days are the server's: `today` is its
 * IST day, so a laptop in another time zone cannot promise a prize a day early.
 */
function prizesStartOn(prize: QuizPrizeInfo, today: string): string | null {
  return prize.prizesFrom && today < prize.prizesFrom ? prize.prizesFrom : null
}

/** "This month’s prize for Classes 9–10: …" — the band from the student's class, when there is one. */
function monthlyPrizeLine(prize: QuizPrizeInfo, classLevel: string | null): string {
  const band = bandLabelFor(classLevel, prize.bands)
  return `This month’s prize${band ? ` for ${band}` : ''}: ${prizeLine(prize)}.`
}

export default function DailyQuizPanel({ variant = 'page' }: DailyQuizPanelProps) {
  const { state } = useAuth()
  const classLevel = state.status === 'student' ? state.student.classLevel : null
  const [today, setToday] = useState<DailyQuizToday | null>(null)
  const [offset, setOffset] = useState(0)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [busy, setBusy] = useState<'start' | 'submit' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [burst, setBurst] = useState<number | null>(null)
  const [justEarned, setJustEarned] = useState<number | null>(null)
  const [unlocked, setUnlocked] = useState<QuizHistoryRow | null>(null)

  /** Every response that carries `serverNow` resets the offset the moment it arrives. */
  const accept = useCallback((next: DailyQuizToday) => {
    setOffset(clockOffset(next.serverNow, Date.now()))
    setToday(next)
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      accept(await api.get<DailyQuizToday>('/me/daily-quiz'))
    } catch (err) {
      setLoadError(err)
    }
    // The most recent unlocked answer, for the "yesterday's answer" card. Best-effort:
    // the quiz itself must render even if this fails.
    try {
      const history = await api.get<DailyQuizHistoryResponse>('/me/daily-quiz/history?limit=3')
      setUnlocked(history.attempts.find((row) => row.revealed && row.status !== 'in-progress') ?? null)
    } catch {
      setUnlocked(null)
    }
  }, [accept])

  useEffect(() => {
    void load()
  }, [load])

  const storageKey = today?.quiz ? `${today.quiz.day}:${today.quiz.groupId}` : null

  // Restore an unsent choice: a reload, a second tab, or signing back in after a session expired.
  useEffect(() => {
    if (!storageKey || today?.state !== 'in-progress' || !today.question) return
    const saved = readSelection(storageKey)
    if (saved && today.question.options.some((option) => option.id === saved)) setSelected(saved)
  }, [storageKey, today?.state, today?.question])

  function choose(id: string) {
    setSelected(id)
    setActionError(null)
    if (storageKey) writeSelection(storageKey, id)
  }

  async function start() {
    setBusy('start')
    setActionError(null)
    try {
      accept(await api.post<DailyQuizStartResponse>('/me/daily-quiz/start'))
    } catch (err) {
      setActionError(humanizeError(err, { fallback: 'Could not start the quiz. Please try again.' }))
      void load()
    } finally {
      setBusy(null)
    }
  }

  async function submit() {
    if (!selected) return
    setConfirming(false)
    setBusy('submit')
    setActionError(null)
    try {
      const res = await api.post<DailyQuizSubmitResponse>('/me/daily-quiz/submit', { selectedOptionId: selected })
      accept(res)
      if (storageKey) writeSelection(storageKey, null)
      if (!res.alreadySubmitted) {
        setJustEarned(res.xpAwarded)
        if (res.result?.isCorrect === true) setBurst(Date.now())
      }
    } catch (err) {
      // The choice is kept — in this component and in storage — so trying again is one
      // press. Submitting twice is safe: the server records one answer, once.
      setActionError(
        humanizeError(err, { fallback: 'Your answer could not be sent. It has not been counted yet — please try again.' }),
      )
    } finally {
      setBusy(null)
    }
  }

  const selectedOption = useMemo(
    () => today?.question?.options.find((option) => option.id === selected) ?? null,
    [today?.question, selected],
  )

  /** The reminder switch changed in the card: the server's answer is what is shown. */
  const reminderChanged = useCallback((on: boolean) => {
    setToday((current) => (current ? { ...current, reminders: { ...current.reminders, on } } : current))
  }, [])

  // ---------------------------------------------------------------------------

  const heading = variant === 'page' ? 'h2' : 'h3'

  if (loadError) {
    return (
      <Card>
        <ErrorState titleAs={heading} title="Could not load today’s quiz" error={loadError} onRetry={() => void load()} />
      </Card>
    )
  }

  if (!today) {
    return (
      <Card>
        <SkeletonText lines={5} label="Loading today’s quiz" />
      </Card>
    )
  }

  const { prize, eligibility, quiz } = today
  const startsOn = prizesStartOn(prize, today.today)

  const eligibilityPrompt =
    !eligibility.eligible && eligibility.missing.length > 0 ? (
      <Alert
        tone="info"
        icon="ph-gift"
        title="Complete your profile to be eligible for prizes"
        actions={
          <ButtonLink to="/profile#prize-details" variant="secondary" size="sm">
            Complete my profile
          </ButtonLink>
        }
      >
        Winners need {eligibility.missing.map((key) => ELIGIBILITY_LABELS[key]).join(', ')} on their profile, so the prize
        can reach them through a parent or guardian. You can still play without it.
      </Alert>
    ) : null

  const unlockedCard = unlocked && variant === 'page' ? <UnlockedAnswer row={unlocked} /> : null

  // ---- No quiz --------------------------------------------------------------
  if (!quiz) {
    return (
      <>
        <Card>
          <EmptyState
            titleAs={heading}
            icon="ph-calendar-x"
            title={today.reason === 'no-class' ? 'Add your class to play' : 'No quiz today'}
            description={
              today.reason === 'no-class'
                ? 'The Daily Quiz is set for each class. Add your class to your profile and today’s quiz will appear here.'
                : 'There is no Daily Quiz for your class today. Practice is always open in the meantime.'
            }
            action={
              today.reason === 'no-class' ? (
                <ButtonLink to="/profile" variant="secondary" icon="ph-user-circle">
                  Go to my profile
                </ButtonLink>
              ) : (
                <ButtonLink to="/practice" variant="secondary" icon="ph-target">
                  Practise now
                </ButtonLink>
              )
            }
          />
          {today.nextQuizAt && (
            <p className={styles.nextQuiz}>
              The next quiz for your class opens in{' '}
              <Countdown
                target={today.nextQuizAt}
                offsetMs={offset}
                variant="compact"
                label="Time until the next Daily Quiz opens"
                onComplete={() => void load()}
              />
              .
            </p>
          )}
          {today.reason !== 'no-class' && <ReminderOffer reminders={today.reminders} onChange={reminderChanged} centred />}
        </Card>
        {unlockedCard}
      </>
    )
  }

  const meta = (
    <div className={styles.meta}>
      <Badge tone="danger" live size="sm">
        Live
      </Badge>
      <Badge tone="primary" size="sm">
        {quiz.classRange.label}
      </Badge>
      {quiz.topic && <Badge tone="neutral" size="sm">{quiz.topic}</Badge>}
      {quiz.difficulty && (
        <Badge tone="neutral" size="sm" uppercase>
          {quiz.difficulty}
        </Badge>
      )}
      <span className={styles.closes}>
        <Icon name="ph-hourglass-medium" />
        Closes in{' '}
        <Countdown
          target={quiz.closesAt}
          offsetMs={offset}
          label="Time left in today’s quiz"
          onComplete={() => void load()}
        />
      </span>
    </div>
  )

  // ---- Not started ------------------------------------------------------------
  if (today.state === 'not-started') {
    return (
      <>
        <Card className={styles.card}>
          {meta}
          <h2 className={styles.title}>{variant === 'page' ? 'Today’s question is ready' : 'Today’s Daily Quiz'}</h2>
          <ul className={styles.facts}>
            <li>
              <Icon name="ph-number-circle-one" /> One attempt only — your first answer is final.
            </li>
            <li>
              <Icon name="ph-star" /> +{prize.xpForCorrect} XP for a correct answer.
            </li>
            <li>
              <Icon name="ph-gift" />{' '}
              {startsOn
                ? `Monthly prizes start on ${formatDayKey(startsOn)}: ${prizeLine(prize)} for the top scorer in each class band.`
                : monthlyPrizeLine(prize, classLevel)}
            </li>
            {!startsOn && (
              <li>
                <Icon name="ph-timer" /> Every correct answer counts towards this month’s prize. Your solve time — measured by our
                server from Start to Submit — breaks a tie.
              </li>
            )}
          </ul>
          {eligibilityPrompt}
          {actionError && <Alert tone="danger">{actionError}</Alert>}
          <div className={styles.actions}>
            <Button size="lg" variant="brand" icon="ph-play" loading={busy === 'start'} onClick={() => void start()}>
              Start the quiz
            </Button>
            <span className={styles.note}>The question appears when you press Start.</span>
          </div>
          <ReminderOffer reminders={today.reminders} onChange={reminderChanged} />
        </Card>
        {unlockedCard}
      </>
    )
  }

  // ---- In progress ------------------------------------------------------------
  if (today.state === 'in-progress' && today.question && today.startedAt) {
    return (
      <Card className={styles.card}>
        {meta}
        <div className={styles.elapsed}>
          <Icon name="ph-timer" />
          <span>Your time</span>
          <Countdown target={today.startedAt} offsetMs={offset} direction="up" label="Time since you pressed Start" />
        </div>
        <div className={styles.question}>
          {today.question.text.trim() !== '' && <MathText block>{today.question.text}</MathText>}
          {/* A picture question (Milestone 30 Phase 7b): served from Start, like the words. */}
          <QuestionPicture picture={today.question.image} name="the question" eager />
        </div>
        <OptionGroup legend="Choose your answer" value={selected} onChange={choose} columns={2} disabled={busy === 'submit'}>
          {today.question.options.map((option) => (
            <OptionTile key={option.id} value={option.id} letter={option.letter}>
              <MathText>{option.text}</MathText>
            </OptionTile>
          ))}
        </OptionGroup>
        {actionError && (
          <Alert
            tone="danger"
            actions={
              selected ? (
                <Button size="sm" variant="secondary" icon="ph-arrow-clockwise" onClick={() => void submit()}>
                  Try again
                </Button>
              ) : undefined
            }
          >
            {actionError}
          </Alert>
        )}
        <div className={styles.actions}>
          <Button
            size="lg"
            icon="ph-paper-plane-tilt"
            disabled={!selected}
            loading={busy === 'submit'}
            onClick={() => setConfirming(true)}
          >
            Submit answer
          </Button>
          <span className={styles.note}>{selected ? 'One attempt — check before you submit.' : 'Choose an option to submit.'}</span>
        </div>

        <Modal
          open={confirming}
          onClose={() => setConfirming(false)}
          title={`Submit option ${selectedOption?.letter ?? ''}?`}
          description="You get one attempt. Your answer cannot be changed after this."
          icon="ph-paper-plane-tilt"
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Go back
              </Button>
              <Button icon="ph-check" onClick={() => void submit()}>
                Submit {selectedOption ? `option ${selectedOption.letter}` : ''}
              </Button>
            </>
          }
        >
          {selectedOption && (
            <p className={styles.confirmChoice}>
              <span className={styles.confirmLetter}>{selectedOption.letter}</span>
              <MathText>{selectedOption.text}</MathText>
            </p>
          )}
        </Modal>
      </Card>
    )
  }

  // ---- Submitted ----------------------------------------------------------------
  const result = today.result
  if (today.state === 'submitted' && result) {
    const chosen = today.question?.options.find((option) => option.id === result.selectedOptionId) ?? null
    const tone = result.isCorrect === true ? 'correct' : result.isCorrect === false ? 'incorrect' : 'held'
    return (
      <>
        <Card className={[styles.card, styles.result, styles[tone]].join(' ')}>
          <Confetti burstKey={burst} />
          {meta}
          <div className={styles.verdict} role="status">
            {tone === 'correct' && (
              <>
                <Icon name="ph-check-circle" weight="bold" size="lg" />
                <div>
                  <h2 className={styles.title}>Correct!</h2>
                  <p>
                    {justEarned !== null && justEarned > 0 ? `+${justEarned} XP. ` : result.xpAwarded > 0 ? `+${result.xpAwarded} XP. ` : ''}
                    {startsOn
                      ? `Monthly prizes start on ${formatDayKey(startsOn)}.`
                      : eligibility.eligible
                        ? 'One more towards this month’s prize.'
                        : 'Complete your profile to be in the running for this month’s prize.'}
                  </p>
                </div>
              </>
            )}
            {tone === 'incorrect' && (
              <>
                <Icon name="ph-x-circle" weight="bold" size="lg" />
                <div>
                  <h2 className={styles.title}>Not this time</h2>
                  <p>That answer was incorrect. Your answer still counts toward your streak.</p>
                </div>
              </>
            )}
            {tone === 'held' && (
              <>
                <Icon name="ph-seal-check" weight="bold" size="lg" />
                <div>
                  <h2 className={styles.title}>Answer submitted</h2>
                  <p>Whether it was right — and any XP — is shown when the answer unlocks.</p>
                </div>
              </>
            )}
          </div>

          <dl className={styles.summary}>
            <div>
              <dt>Your answer</dt>
              <dd>
                {chosen ? (
                  <>
                    <span className={styles.confirmLetter}>{chosen.letter}</span> <MathText>{chosen.text}</MathText>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Solve time</dt>
              <dd>{result.solveTimeMs !== null ? formatSolveTime(result.solveTimeMs) : '—'}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{formatTime(result.submittedAt)}</dd>
            </div>
          </dl>

          <p className={styles.unlock}>
            <Icon name="ph-lock-simple" />
            The correct answer and the full solution unlock in{' '}
            <Countdown target={result.revealAt} offsetMs={offset} label="Time until the answer unlocks" onComplete={() => void load()} />{' '}
            (tomorrow at 12:00 AM).
          </p>
          {eligibilityPrompt}
          <div className={styles.actions}>
            {variant === 'card' ? (
              <ButtonLink to="/daily-quiz" variant="secondary" iconAfter="ph-arrow-right">
                Open the Daily Quiz
              </ButtonLink>
            ) : (
              <ButtonLink to="/profile#daily-quiz-history" variant="secondary" icon="ph-clock-counter-clockwise">
                My quiz history
              </ButtonLink>
            )}
          </div>
          <ReminderOffer reminders={today.reminders} onChange={reminderChanged} />
        </Card>
        {unlockedCard}
      </>
    )
  }

  // A state the page does not know how to show is still a page, not a blank.
  return (
    <Card>
      <ErrorState
        titleAs={heading}
        title="Could not show today’s quiz"
        error={null}
        message="Reload to see where you are — any answer you submitted is safe."
        onRetry={() => void load()}
      />
    </Card>
  )
}

/**
 * The 7:00 AM reminder email (Milestone 30 Phase 7b, PLAN.md Q20), in the quiz card.
 *
 *  - **Not available** (the server has no scheduler, or staff switched reminders off):
 *    nothing at all. A reminder nobody will send is a promise the page must not make.
 *  - **Available, off**: one tap — "Email me a reminder at 7 AM" — saving the same switch as
 *    My Profile → Notification preferences. The button carries `loading` while it saves.
 *  - **On**: a quiet line saying so and where to turn it off. Straight after the tap it says
 *    "Done" and takes the focus, so the confirmation is read out where the button was.
 *
 * The server's answer to the save is what is shown, never the value this component asked for.
 */
function ReminderOffer({
  reminders,
  onChange,
  centred = false,
}: {
  reminders: QuizReminders
  onChange: (on: boolean) => void
  centred?: boolean
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const noteRef = useRef<HTMLParagraphElement>(null)

  // The button the student pressed is gone once the save lands; the focus goes to what replaced it.
  useEffect(() => {
    if (confirmed) noteRef.current?.focus()
  }, [confirmed])

  if (!reminders.available) return null

  async function turnOn() {
    setSaving(true)
    setError(null)
    try {
      const res = await api.patch<{ preferences: NotificationPrefs }>('/me/notification-preferences', { dailyQuizReminders: true })
      onChange(res.preferences.dailyQuizReminders)
      setConfirmed(res.preferences.dailyQuizReminders)
    } catch (err) {
      setError(humanizeError(err, { fallback: 'The reminder could not be turned on. Please try again.' }))
    } finally {
      setSaving(false)
    }
  }

  const placement = centred ? ` ${styles.reminderCentred}` : ''

  if (reminders.on) {
    return (
      <p ref={noteRef} tabIndex={-1} className={`${styles.reminderNote}${placement}`}>
        <Icon name="ph-bell-ringing" />
        <span>
          {confirmed ? 'Done — reminders are on: ' : 'Reminders are on: '}
          an email at 7:00 AM on days your class has a quiz. Turn them off in{' '}
          <Link to="/profile#notification-preferences">My Profile → Notification preferences</Link>.
        </span>
      </p>
    )
  }

  return (
    <div className={`${styles.reminderOffer}${placement}`}>
      <Button variant="secondary" size="sm" icon="ph-bell" loading={saving} onClick={() => void turnOn()}>
        Email me a reminder at 7 AM
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  )
}

/**
 * The most recent quiz whose answer is unlocked: the correct option, the student's own
 * choice and the worked solution — the brief's "revealed" state.
 */
export function UnlockedAnswer({ row }: { row: QuizHistoryRow }) {
  const reveal = row.reveal
  if (!reveal) return null
  return (
    <Card className={styles.card}>
      <div className={styles.meta}>
        <Badge tone="success" size="sm" icon="ph-lock-simple-open">
          Answer unlocked
        </Badge>
        <span className={styles.day}>{formatDayKey(row.day)}</span>
        {row.topic && <Badge tone="neutral" size="sm">{row.topic}</Badge>}
      </div>
      {(row.questionText || row.questionImage) && (
        <div className={styles.question}>
          {row.questionText && <MathText block>{row.questionText}</MathText>}
          <QuestionPicture picture={row.questionImage} name="the question" />
        </div>
      )}
      {row.options.length > 0 ? (
        <OptionGroup legend="The options" value={row.selectedOptionId} disabled columns={2}>
          {row.options.map((option) => (
            <OptionTile
              key={option.id}
              value={option.id}
              letter={option.letter}
              result={
                option.id === reveal.correctOptionId
                  ? 'correct'
                  : option.id === row.selectedOptionId
                    ? 'incorrect'
                    : undefined
              }
            >
              <MathText>{option.text}</MathText>
            </OptionTile>
          ))}
        </OptionGroup>
      ) : (
        reveal.correctOptionText && (
          <p>
            Correct answer: <MathText>{reveal.correctOptionText}</MathText>
          </p>
        )
      )}
      <p className={styles.outcome}>
        {row.status === 'not-submitted'
          ? 'You started this quiz but did not submit an answer before midnight.'
          : row.isCorrect
            ? `You answered correctly${row.xpAwarded > 0 ? ` and earned ${row.xpAwarded} XP` : ''}.`
            : 'Your answer was not the correct one.'}
        {row.won && ' 🏆 You won this quiz!'}
      </p>
      {(reveal.solution || reveal.solutionImage) && (
        <div className={styles.solution}>
          <h3>Worked solution</h3>
          {reveal.solution && <MathText block>{reveal.solution}</MathText>}
          <QuestionPicture picture={reveal.solutionImage} name="the solution" fallbackAlt="The worked solution, as a picture" />
        </div>
      )}
      <Link to="/profile#daily-quiz-history" className={styles.historyLink}>
        See every quiz you have played
      </Link>
    </Card>
  )
}
