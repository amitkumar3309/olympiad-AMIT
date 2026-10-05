import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, CalendarDays, RotateCcw, Sparkles, Timer, Zap } from 'lucide-react'
import { api } from '../../../api/client'
import type { ClassLevel, PastProblemGroup, PastQuizProblem } from '../../../api/types'
import MathText from '../../../components/MathText'
import Illustration from '../../../components/Illustration'
import { Button, OptionGroup, OptionTile, SkeletonText, TabPanel, Tabs, useInView } from '../../../components/ui'
import { formatDayKey } from '../../../lib/format'
import { CRACK_THIS_SECONDS, PAST_PROBLEMS_PER_GROUP } from '../../../lib/siteConfig'
import styles from './CrackThis.module.css'

/**
 * "Can you crack this?" — a real Daily Quiz problem, no sign-in (brief §7.1 #4).
 *
 * ## A past Daily Quiz, never today's
 *
 * The owner asked for a real daily problem rather than a demo set (2026-10-05), so this
 * shows the most recent Daily Quiz problems **whose answers are already public**, from
 * `GET /daily-quiz/past`. Never today's: today's is the prize question, timed from the
 * moment a student presses Start, so printing it here would let anybody read it, work it
 * out, and then start and answer in a second. The server decides which days qualify,
 * through the same reveal gate a student's own history uses — this page cannot ask for
 * today's even by mistake.
 *
 * Because the answer is public, this one answers at once: right or wrong, the answer and
 * the worked solution. "Try another" steps back a day, and the page then points at the
 * real thing — "Play today’s Daily Quiz" runs the same sign-in-first flow as the floating
 * button.
 *
 * ## Tabs are class groups
 *
 * The problems arrive grouped Classes 3–5 / 6–8 / 9–12. A tab appears only for a group
 * with a problem to show, and a tab row of one is not drawn — a control with nothing to
 * choose. A signed-in student starts on their own class's group.
 *
 * ## The clock is fair to the reader
 *
 * It starts only once the card is at least half on screen, and it **pauses while the
 * browser tab is hidden** — it counts only the time somebody could actually be looking.
 * The display is a `timer` region, which is never announced every second.
 *
 * This file is loaded on demand (`React.lazy` in `Landing`): it is the only part of the
 * homepage that needs the maths renderer, and KaTeX is the largest thing in the bundle.
 */

const TICK_MS = 250
/** Options longer than this (maths counted as two characters) get a row each. */
const SHORT_OPTION = 10

/** Short answers ("24", "$\frac{123}{7}$") sit four in a row; sentences get a row each. */
function optionColumns(options: readonly { text: string }[]): 1 | 2 | 4 {
  if (options.some((option) => option.text.replace(/\$[^$]*\$/g, 'xx').length > SHORT_OPTION)) return 1
  return options.length === 4 ? 4 : 2
}

function problemKey(problem: PastQuizProblem): string {
  return `${problem.day}:${problem.classRange.min}-${problem.classRange.max}`
}

/** The group a student's class belongs to, if it has a problem to show. */
function groupFor(groups: readonly PastProblemGroup[], classLevel: ClassLevel | null): PastProblemGroup | undefined {
  const n = classLevel ? Number(classLevel.replace('Class ', '')) : NaN
  return groups.find((group) => n >= group.min && n <= group.max)
}

type Outcome = 'correct' | 'incorrect' | 'timeout'

export interface CrackThisProps {
  /** "Play today's Daily Quiz" — the same flow as the floating button. */
  onPlay: () => void
  /** A signed-in student's class, to open on their own group. */
  classLevel?: ClassLevel | null
}

export default function CrackThis({ onPlay, classLevel = null }: CrackThisProps) {
  /** null while loading; 'failed' when the request did. */
  const [groups, setGroups] = useState<PastProblemGroup[] | 'failed' | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ groups: PastProblemGroup[] }>(`/daily-quiz/past?limit=${PAST_PROBLEMS_PER_GROUP}`)
      .then((res) => {
        if (!cancelled) setGroups(res.groups)
      })
      .catch(() => {
        if (!cancelled) setGroups('failed')
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const available = useMemo(
    () => (Array.isArray(groups) ? groups.filter((group) => group.problems.length > 0) : []),
    [groups],
  )

  const [chosenGroup, setChosenGroup] = useState<string | null>(null)
  const group =
    available.find((g) => g.id === chosenGroup) ?? groupFor(available, classLevel) ?? available[0] ?? null
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const problem = group ? group.problems[(offsets[group.id] ?? 0) % group.problems.length]! : null

  const [selected, setSelected] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const cardRef = useRef<HTMLElement>(null)
  const started = useInView(cardRef, { threshold: 0.5 })

  const reset = useCallback(() => {
    setSelected(null)
    setOutcome(null)
    setElapsedMs(0)
  }, [])

  const problemId = problem ? problemKey(problem) : null

  // The clock: counts only while the card has been seen, a problem is open and the tab is
  // visible. Elapsed time is measured, not counted in ticks, so a throttled timer cannot
  // slow it down.
  useEffect(() => {
    if (!started || outcome !== null || problemId === null) return
    let last = performance.now()
    const timer = window.setInterval(() => {
      const nowMs = performance.now()
      const delta = nowMs - last
      last = nowMs
      if (document.visibilityState !== 'visible') return
      setElapsedMs((ms) => ms + delta)
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [started, outcome, problemId])

  const remaining = Math.max(0, CRACK_THIS_SECONDS - Math.floor(elapsedMs / 1000))

  useEffect(() => {
    if (remaining === 0 && outcome === null && problemId !== null) setOutcome('timeout')
  }, [remaining, outcome, problemId])

  function submit() {
    if (selected === null || !problem) return
    setOutcome(selected === problem.answer.letter ? 'correct' : 'incorrect')
  }

  function tryAnother() {
    if (!group) return
    setOffsets((current) => ({ ...current, [group.id]: (current[group.id] ?? 0) + 1 }))
    reset()
  }

  function changeGroup(next: string) {
    setChosenGroup(next)
    reset()
  }

  const playButton = (
    <Button
      size="lg"
      fullWidth
      variant="brand"
      onClick={onPlay}
      icon={<Zap size={18} aria-hidden="true" />}
      className={styles.wrapLabel}
    >
      Play today’s Daily Quiz and win prizes
    </Button>
  )

  let content
  if (groups === null) {
    content = <SkeletonText lines={5} label="Loading a problem" className={styles.loading} />
  } else if (groups === 'failed') {
    content = (
      <div className={styles.notice}>
        <p className={styles.noticeText}>The problem could not be loaded just now.</p>
        <div className={styles.noticeActions}>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)} icon={<RotateCcw size={18} aria-hidden="true" />}>
            Try again
          </Button>
          {playButton}
        </div>
      </div>
    )
  } else if (!group || !problem) {
    content = (
      <div className={styles.notice}>
        <p className={styles.noticeText}>
          Each Daily Quiz problem appears here once its answer unlocks at midnight, and the first is on its way.
          Today’s quiz is the one with prizes.
        </p>
        <div className={styles.noticeActions}>{playButton}</div>
      </div>
    )
  } else {
    content = (
      <PlayArea
        key={problemKey(problem)}
        problem={problem}
        selected={selected}
        onSelect={setSelected}
        outcome={outcome}
        onSubmit={submit}
        canTryAnother={group.problems.length > 1}
        onTryAnother={tryAnother}
        playButton={playButton}
      />
    )
  }

  const showTabs = available.length > 1 && group !== null && problem !== null
  const clock = `00:${String(remaining).padStart(2, '0')}`

  return (
    <section ref={cardRef} className={`container ${styles.section}`} aria-labelledby="crack-title">
      <div className={styles.card}>
        <header className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <Zap />
          </span>
          <div className={styles.headerText}>
            <h2 id="crack-title" className={styles.title}>
              Can you crack this?
            </h2>
            <p className={styles.lead}>
              {problem
                ? 'A real problem from a recent Daily Quiz — no sign-in needed.'
                : 'Real problems from past Daily Quizzes, answers included.'}
            </p>
          </div>
          {problem && (
            <p className={styles.timer} role="timer" aria-label={`${remaining} seconds left`}>
              <Timer aria-hidden="true" />
              <span className="tnum">{clock}</span>
            </p>
          )}
        </header>

        {showTabs ? (
          <div className={styles.withTabs}>
            <Tabs
              items={available.map((g) => ({ id: g.id, label: g.label }))}
              value={group.id}
              onChange={changeGroup}
              label="Class group"
              idPrefix="crack"
              variant="pill"
              className={styles.tabs}
            />
            {available.map((g) => (
              <TabPanel key={g.id} id={g.id} idPrefix="crack" active={g.id === group.id} className={styles.panel}>
                {g.id === group.id ? content : null}
              </TabPanel>
            ))}
          </div>
        ) : (
          content
        )}
      </div>
    </section>
  )
}

interface PlayAreaProps {
  problem: PastQuizProblem
  selected: string | null
  onSelect: (letter: string) => void
  outcome: Outcome | null
  onSubmit: () => void
  canTryAnother: boolean
  onTryAnother: () => void
  playButton: ReactNode
}

function PlayArea({ problem, selected, onSelect, outcome, onSubmit, canTryAnother, onTryAnother, playButton }: PlayAreaProps) {
  const meta = [problem.classRange.label, problem.topic].filter(Boolean).join(' · ')

  return (
    <div className={styles.play}>
      <div className={styles.questionCol}>
        <p className={styles.meta}>
          <CalendarDays aria-hidden="true" />
          <span>
            Daily Quiz, {formatDayKey(problem.day)}
            {meta && ` · ${meta}`}
          </span>
        </p>
        <MathText block className={styles.question}>
          {problem.questionText}
        </MathText>
        <OptionGroup
          legend="Choose your answer"
          value={selected}
          onChange={onSelect}
          disabled={outcome !== null}
          columns={optionColumns(problem.options)}
          className={styles.options}
        >
          {problem.options.map((option) => (
            <OptionTile
              key={option.letter}
              value={option.letter}
              letter={option.letter}
              result={
                outcome === null
                  ? undefined
                  : option.letter === problem.answer.letter
                    ? 'correct'
                    : option.letter === selected
                      ? 'incorrect'
                      : undefined
              }
            >
              <MathText>{option.text}</MathText>
            </OptionTile>
          ))}
        </OptionGroup>

        {/* Polite: announced once, after the answer, never per tick. */}
        <div className={styles.feedback} aria-live="polite">
          {outcome && (
            <div className={`${styles.result} ${styles[outcome]}`}>
              <p className={styles.verdict}>
                {outcome === 'correct' ? (
                  <>
                    <Sparkles aria-hidden="true" /> Correct — well cracked!
                  </>
                ) : (
                  <>
                    {outcome === 'incorrect' ? 'Not quite.' : 'Time’s up!'} The answer is {problem.answer.letter}:{' '}
                    <MathText>{problem.answer.text}</MathText>
                  </>
                )}
              </p>
              {problem.solution && (
                <div className={styles.solution}>
                  <p className={styles.solutionLabel}>Solution</p>
                  <MathText block className={styles.explanation}>
                    {problem.solution}
                  </MathText>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles.side}>
        <div className={styles.bulb} aria-hidden="true">
          <Illustration name="light-bulb" />
          <p className={styles.hand}>
            <span>Think</span>
            <span>Analyse</span>
            <span>Solve</span>
            <span>Grow</span>
          </p>
        </div>
        {outcome === null ? (
          <Button
            size="lg"
            fullWidth
            onClick={onSubmit}
            disabled={selected === null}
            iconAfter={<ArrowRight size={18} aria-hidden="true" />}
          >
            Submit answer
          </Button>
        ) : (
          <div className={styles.after}>
            {canTryAnother && (
              <Button size="lg" fullWidth variant="secondary" onClick={onTryAnother}>
                Try another
              </Button>
            )}
            {playButton}
          </div>
        )}
        {selected === null && outcome === null && <p className={styles.hint}>Pick an option to submit.</p>}
      </div>
    </div>
  )
}
