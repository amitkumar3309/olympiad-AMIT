import { useEffect, useState } from 'react'
import StudentShell from '../../components/StudentShell'
import MathText from '../../components/MathText'
import QuestionPicture from '../../components/QuestionPicture'
import { Button, ButtonLink, Card, EmptyState, ErrorState, Icon, SkeletonText, Tabs } from '../../components/ui'
import { api } from '../../api/client'
import { QUIZ_CLASS_GROUPS, type ClassLevel, type PastQuizProblem, type QuizArchivePage } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import { formatDayKey } from '../../lib/format'
import styles from './DailyQuizArchive.module.css'

/**
 * `/daily-quiz/archive` — every earlier Daily Quiz, with its answer and worked solution
 * (Milestone 30 Phase 7: the brief's optional "public archive of past Daily Quizzes",
 * approved by the owner on 2026-10-08). Public and indexed.
 *
 * ## Never today's
 *
 * Today's quiz is the prize question, timed from the moment a student presses Start, so a
 * public copy would let anybody work it out first. The server decides which days qualify
 * (`GET /daily-quiz/archive`, through the one reveal gate) and this page cannot ask for
 * today's even by mistake: paging "back" from any day starts no later than yesterday.
 *
 * ## A study page, not a game
 *
 * The homepage's "Can you crack this?" is the timed taster. Here each problem shows its
 * options and keeps the answer and the solution behind "Show the answer", so a reader can
 * try it first — a `<details>`, which needs no script to open and is announced as a
 * disclosure.
 *
 * One class group at a time, a fortnight of days per page; a signed-in student starts on
 * their own class's group.
 */

/** How many days each page holds — the server allows 1 to 31. */
const DAYS_PER_PAGE = 14

type GroupId = (typeof QUIZ_CLASS_GROUPS)[number]['id']

/** The group a class belongs to, if any. */
function groupOf(classLevel: ClassLevel | null): GroupId | null {
  const n = classLevel ? Number(classLevel.replace('Class ', '')) : NaN
  return QUIZ_CLASS_GROUPS.find((group) => n >= group.min && n <= group.max)?.id ?? null
}

interface Loaded {
  problems: PastQuizProblem[]
  nextBefore: string | null
}

function archivePath(group: GroupId, before: string | null): string {
  const query = new URLSearchParams({ group, days: String(DAYS_PER_PAGE) })
  if (before) query.set('before', before)
  return `/daily-quiz/archive?${query.toString()}`
}

export default function DailyQuizArchive() {
  const { state } = useAuth()
  const classLevel = state.status === 'student' ? state.student.classLevel : null

  const [chosen, setChosen] = useState<GroupId | null>(null)
  const group: GroupId = chosen ?? groupOf(classLevel) ?? QUIZ_CLASS_GROUPS[0].id
  const groupLabel = QUIZ_CLASS_GROUPS.find((g) => g.id === group)!.label

  const [loaded, setLoaded] = useState<Partial<Record<GroupId, Loaded>>>({})
  const [failed, setFailed] = useState<Partial<Record<GroupId, unknown>>>({})
  const [attempt, setAttempt] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState<unknown>(null)

  const page = loaded[group]
  const error = failed[group]

  // The first page of a group, the first time it is shown (and again after "Try again").
  useEffect(() => {
    if (page || error !== undefined) return
    let cancelled = false
    api
      .get<QuizArchivePage>(archivePath(group, null))
      .then((res) => {
        if (!cancelled) setLoaded((current) => ({ ...current, [group]: { problems: res.problems, nextBefore: res.nextBefore } }))
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed((current) => ({ ...current, [group]: err }))
      })
    return () => {
      cancelled = true
    }
  }, [group, page, error, attempt])

  function retry() {
    setFailed((current) => {
      const next = { ...current }
      delete next[group]
      return next
    })
    setAttempt((n) => n + 1)
  }

  async function loadEarlier() {
    if (!page?.nextBefore) return
    setLoadingMore(true)
    setMoreFailed(null)
    try {
      const res = await api.get<QuizArchivePage>(archivePath(group, page.nextBefore))
      setLoaded((current) => ({
        ...current,
        [group]: { problems: [...(current[group]?.problems ?? []), ...res.problems], nextBefore: res.nextBefore },
      }))
    } catch (err) {
      setMoreFailed(err)
    } finally {
      setLoadingMore(false)
    }
  }

  function chooseGroup(id: string) {
    setChosen(id as GroupId)
    setMoreFailed(null)
  }

  let content
  if (error !== undefined) {
    content = <ErrorState error={error} title="The past quizzes could not be loaded" titleAs="h2" onRetry={retry} />
  } else if (!page) {
    content = <SkeletonText lines={8} label="Loading past quizzes" className={styles.loading} />
  } else if (page.problems.length === 0) {
    content = (
      <EmptyState
        icon="ph-calendar-blank"
        titleAs="h2"
        title={`No past quizzes for ${groupLabel} yet`}
        description="Each Daily Quiz appears here, with its answer and worked solution, once its answer unlocks at midnight India time."
      />
    )
  } else {
    content = (
      <>
        <ol className={styles.list}>
          {page.problems.map((problem) => (
            <li key={`${problem.day}:${problem.classRange.min}-${problem.classRange.max}`}>
              <Problem problem={problem} />
            </li>
          ))}
        </ol>
        {page.nextBefore && (
          <div className={styles.more}>
            {moreFailed !== null && (
              <p className={styles.moreError} role="alert">
                The earlier quizzes could not be loaded. Try again.
              </p>
            )}
            <Button variant="secondary" loading={loadingMore} onClick={() => void loadEarlier()}>
              Show earlier quizzes
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <StudentShell
      title="Past Daily Quizzes"
      subtitle="Every earlier Daily Quiz, with its answer and worked solution"
      actions={
        <ButtonLink to="/daily-quiz" variant="primary" size="sm">
          Play today’s quiz
        </ButtonLink>
      }
    >
      <div className={styles.page}>
        <p className={styles.intro}>
          Try each one before you open its answer. Today’s quiz is never here: it is the prize question until its answer
          unlocks at midnight.
        </p>
        <Tabs
          items={QUIZ_CLASS_GROUPS.map((g) => ({ id: g.id, label: g.label }))}
          value={group}
          onChange={chooseGroup}
          label="Class group"
          idPrefix="archive"
          variant="pill"
          mode="filter"
          className={styles.tabs}
        />
        {content}
      </div>
    </StudentShell>
  )
}

function Problem({ problem }: { problem: PastQuizProblem }) {
  const meta = [problem.classRange.label, problem.topic, problem.difficulty].filter(Boolean).join(' · ')
  const headingId = `quiz-${problem.day}-${problem.classRange.min}-${problem.classRange.max}`

  return (
    <Card as="article" className={styles.problem} aria-labelledby={headingId}>
      <header className={styles.problemHeader}>
        <Icon name="ph-calendar-blank" size="lg" className={styles.calendar} />
        <div className={styles.problemTitle}>
          <h2 id={headingId} className={styles.day}>
            {formatDayKey(problem.day)}
          </h2>
          {meta && <p className={styles.meta}>{meta}</p>}
        </div>
      </header>

      {problem.questionText.trim() !== '' && (
        <MathText block className={styles.question}>
          {problem.questionText}
        </MathText>
      )}
      <QuestionPicture picture={problem.image} name="the question" />

      <ol className={styles.options} aria-label="Options">
        {problem.options.map((option) => (
          <li key={option.letter} className={styles.option}>
            <span className={styles.letter} aria-hidden="true">
              {option.letter}
            </span>
            <span className={styles.optionText}>
              <span className="sr-only">Option {option.letter}: </span>
              <MathText>{option.text}</MathText>
            </span>
          </li>
        ))}
      </ol>

      <details className={styles.answer}>
        <summary className={styles.summary}>Show the answer</summary>
        <div className={styles.reveal}>
          <p className={styles.answerLine}>
            <span className={styles.answerLabel}>Answer {problem.answer.letter}</span>{' '}
            <MathText>{problem.answer.text}</MathText>
          </p>
          {(problem.solution || problem.solutionImage) && (
            <div className={styles.solution}>
              <p className={styles.solutionLabel}>Solution</p>
              {problem.solution && (
                <MathText block className={styles.explanation}>
                  {problem.solution}
                </MathText>
              )}
              <QuestionPicture picture={problem.solutionImage} name="the solution" fallbackAlt="The worked solution, as a picture" />
            </div>
          )}
        </div>
      </details>
    </Card>
  )
}
