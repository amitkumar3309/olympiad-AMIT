import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import { type AdminQuizDetailResponse, type QuizCandidate, type QuizWinnerRow } from '../../api/types'
import AdminShell from './AdminShell'
import MathText from '../../components/MathText'
import QuestionPicture from '../../components/QuestionPicture'
import { Alert, Badge, Breadcrumb, Button, Card, CardHeader, ErrorState, Modal, SkeletonText, StatTile, useToast } from '../../components/ui'
import { formatDayKey, formatNumber, formatSolveTime } from '../../lib/format'
import { humanizeError } from '../../lib/errors'
import { QuestionPicker } from './DailyQuizSchedule'
import WinnerTable from './DailyQuizWinners'
import styles from './DailyQuiz.module.css'

/**
 * One Daily Quiz, for staff (Milestone 30, Phase 2 — brief §6.5): how it landed, and its
 * question with the answer key (staff wrote it).
 *
 * A quiz has no winner of its own since 2026-10-09: the prize is monthly, one winner in each
 * class band (PLAN.md Q24), chosen on the console's Monthly winners tab. A quiz from before
 * that may still carry candidates; they are listed, and acted on, here.
 */
export default function AdminDailyQuizDetail() {
  const { groupId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [data, setData] = useState<AdminQuizDetailResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<'change' | 'remove' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [replacement, setReplacement] = useState<QuizCandidate | null>(null)
  const [removing, setRemoving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.get<AdminQuizDetailResponse>(`/admin/daily-quiz/${groupId}`))
    } catch (err) {
      setError(err)
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  async function change() {
    if (!replacement) return
    setBusy('change')
    setActionError(null)
    try {
      await api.put(`/admin/daily-quiz/${groupId}`, { questionId: replacement.id })
      setChanging(false)
      setReplacement(null)
      toast.success('The quiz now uses the new question.')
      await load()
    } catch (err) {
      setActionError(humanizeError(err, { fallback: 'The question could not be changed.' }))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('remove')
    setActionError(null)
    try {
      await api.del(`/admin/daily-quiz/${groupId}`)
      toast.success('Quiz removed.')
      navigate('/admin/daily-quiz')
    } catch (err) {
      setActionError(humanizeError(err, { fallback: 'The quiz could not be removed.' }))
      setRemoving(false)
    } finally {
      setBusy(null)
    }
  }

  function replaceWinner(updated: QuizWinnerRow) {
    setData((current) =>
      current ? { ...current, winners: current.winners.map((row) => (row.id === updated.id ? updated : row)) } : current,
    )
  }

  if (error) {
    return (
      <AdminShell title="Daily Quiz">
        <ErrorState titleAs="h2" title="Could not load this quiz" error={error} onRetry={() => void load()} />
      </AdminShell>
    )
  }

  if (!data) {
    return (
      <AdminShell title="Daily Quiz">
        <Card>
          <SkeletonText lines={6} label="Loading the quiz" />
        </Card>
      </AdminShell>
    )
  }

  const { quiz, winners, prizeMonth } = data
  // An upcoming quiz may be in a month the monthly page cannot show yet: it opens on its default.
  const monthlyHref =
    prizeMonth && quiz.phase !== 'upcoming' ? `/admin/daily-quiz?tab=monthly&month=${prizeMonth.month}` : '/admin/daily-quiz?tab=monthly'
  const untouched = quiz.stats.started === 0
  const editable = untouched && quiz.phase !== 'revealed'
  const closed = quiz.phase === 'revealed'

  return (
    <AdminShell title={`Daily Quiz · ${formatDayKey(quiz.day)}`} subtitle={quiz.classRange.label}>
      <Breadcrumb items={[{ label: 'Daily Quiz', to: '/admin/daily-quiz' }, { label: formatDayKey(quiz.day) }]} />
      <div className={styles.stack}>
        <div className={styles.statGrid}>
          <StatTile icon="ph-play" label="Started" value={formatNumber(quiz.stats.started)} />
          <StatTile icon="ph-paper-plane-tilt" label="Submitted" value={formatNumber(quiz.stats.submitted)} />
          <StatTile icon="ph-check-circle" tone="success" label="Correct" value={quiz.stats.correctPercent === null ? null : `${quiz.stats.correctPercent}%`} />
          <StatTile icon="ph-timer" label="Median solve time" value={quiz.stats.medianSolveMs === null ? null : formatSolveTime(quiz.stats.medianSolveMs)} />
        </div>

        <Card>
          <CardHeader
            title="The question"
            as="h2"
            size="sm"
            description={[quiz.question.topic, quiz.question.difficulty].filter(Boolean).join(' · ') || undefined}
            actions={
              editable ? (
                <div className={styles.inlineActions}>
                  <Button size="sm" variant="secondary" icon="ph-swap" onClick={() => setChanging(true)}>
                    Change question
                  </Button>
                  <Button size="sm" variant="ghost" icon="ph-trash" onClick={() => setRemoving(true)}>
                    Remove quiz
                  </Button>
                </div>
              ) : undefined
            }
          />
          {!editable && (
            <p className={styles.muted}>
              {closed
                ? 'This quiz has closed, so it is the record of what was set that day and cannot be changed.'
                : 'Students have started this quiz, so its question can no longer be changed or removed.'}
            </p>
          )}
          {/* Playable, not "has text": a picture question's words may be empty (Phase 7b). */}
          {quiz.playable ? (
            <div className={styles.stack}>
              {quiz.question.text && (
                <div className={styles.questionText}>
                  <MathText block>{quiz.question.text}</MathText>
                </div>
              )}
              <QuestionPicture picture={quiz.question.image} name="the question" eager />
              <ol className={styles.staffOptions}>
                {quiz.question.options.map((option) => (
                  <li key={option.id} data-correct={option.id === quiz.question.correctOptionId}>
                    <MathText>{option.text}</MathText>
                    {option.id === quiz.question.correctOptionId && (
                      <Badge tone="success" size="sm" icon="ph-check">
                        Correct
                      </Badge>
                    )}
                  </li>
                ))}
              </ol>
              {(quiz.question.solution || quiz.question.solutionImage) && (
                <div className={styles.solution}>
                  <h3>Worked solution — students see this from the next day</h3>
                  {quiz.question.solution && <MathText block>{quiz.question.solution}</MathText>}
                  <QuestionPicture picture={quiz.question.solutionImage} name="the solution" fallbackAlt="The worked solution, as a picture" />
                </div>
              )}
              <Link to={`/admin/questions/${quiz.question.id}/edit`} className={styles.inlineLink}>
                The question in the bank
              </Link>
            </div>
          ) : (
            <p className={styles.muted}>A daily challenge from before the Daily Quiz. It has no prize and no winner.</p>
          )}
        </Card>

        {actionError && <Alert tone="danger">{actionError}</Alert>}

        <Card>
          <CardHeader
            title="Winners"
            as="h2"
            size="sm"
            description={
              prizeMonth === undefined
                ? 'The prize is monthly, one winner in each class band.'
                : prizeMonth
                  ? `Every correct answer here counts towards its student’s score for ${prizeMonth.label}: the prize is monthly, one winner in each class band.`
                  : 'This quiz’s day is before the monthly prizes start, so its answers count towards no prize.'
            }
          />
          <div className={styles.stack}>
            <p>
              <Link to={monthlyHref} className={styles.inlineLink}>
                {prizeMonth ? `Choose ${prizeMonth.label}’s winners on the Monthly winners tab` : 'The monthly winners'}
              </Link>
            </p>
            {winners.length > 0 && (
              <>
                <p className={styles.muted}>Candidates this quiz had under the old one-winner-a-day rule:</p>
                <WinnerTable rows={winners} onChanged={replaceWinner} label="Candidates for this quiz from before the monthly prize" />
              </>
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={changing}
        onClose={() => setChanging(false)}
        size="lg"
        title="Change this quiz’s question"
        description={`Only until somebody starts it. ${quiz.classRange.label}, ${formatDayKey(quiz.day)}.`}
        icon="ph-swap"
        footer={
          <>
            <Button variant="secondary" onClick={() => setChanging(false)}>
              Cancel
            </Button>
            <Button icon="ph-check" loading={busy === 'change'} disabled={!replacement} onClick={() => void change()}>
              Use this question
            </Button>
          </>
        }
      >
        <QuestionPicker classMin={quiz.classRange.min} classMax={quiz.classRange.max} value={replacement?.id ?? null} onChange={setReplacement} />
      </Modal>

      <Modal
        open={removing}
        onClose={() => setRemoving(false)}
        tone="danger"
        icon="ph-trash"
        title="Remove this quiz?"
        description={`${quiz.classRange.label} will have no quiz on ${formatDayKey(quiz.day)} unless you schedule another. The question stays in the bank.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={busy === 'remove'} onClick={() => void remove()}>
              Remove quiz
            </Button>
          </>
        }
      />
    </AdminShell>
  )
}
