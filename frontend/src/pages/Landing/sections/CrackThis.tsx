import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Brain, Calculator, Lightbulb, Puzzle, Sparkles, Timer, Zap } from 'lucide-react'
import MathText from '../../../components/MathText'
import Illustration from '../../../components/Illustration'
import { Button, OptionGroup, OptionTile, TabPanel, Tabs, useInView } from '../../../components/ui'
import { SAMPLE_QUESTION_SECONDS } from '../../../lib/siteConfig'
import { publishedCategories, publishedQuestions, type SampleCategory } from '../sampleQuestions'
import styles from './CrackThis.module.css'

/**
 * "Can you crack this?" — a public sample question, no sign-in (brief §7.1 #4).
 *
 * ## It is practice, so it answers at once
 *
 * Unlike the Daily Quiz, which keeps its answer until the next day, this says right or
 * wrong the moment you submit, with a one-line explanation and "Try another". When the
 * 30 seconds run out it shows the answer. Then it points at the real thing: "Play today's
 * Daily Quiz and win prizes" runs the same sign-in-first flow as the floating button.
 *
 * ## The clock is fair to the reader
 *
 * It starts only once the card is at least half on screen, and it **pauses while the
 * browser tab is hidden** — it counts only the time somebody could actually be looking.
 * The display is a `timer` region, which is never announced every second.
 *
 * ## The questions
 *
 * From `sampleQuestions.ts`, each answer checked by `npm run verify:samples`. A tab
 * appears only once it has five owner-reviewed questions, so until the owner approves the
 * drafts this is the Mathematics set alone — and a tab list of one would be a control
 * with nothing to choose, so it is not drawn. The first question shown rotates daily.
 *
 * This file is loaded on demand (`React.lazy` in `Landing`): it is the only part of the
 * homepage that needs the maths renderer, and KaTeX is the largest thing in the bundle.
 */

const TAB_ICONS: Record<SampleCategory, typeof Calculator> = {
  mathematics: Calculator,
  logic: Puzzle,
  reasoning: Brain,
  brainstorming: Lightbulb,
}

const LETTERS = ['A', 'B', 'C', 'D'] as const
const TICK_MS = 250
/** Options longer than this (maths counted as two characters) get a row each. */
const SHORT_OPTION = 10

/** Short answers ("24", "$rac{123}{7}$") sit four in a row; sentences get a row each. */
function optionColumns(options: readonly string[]): 1 | 4 {
  return options.some((option) => option.replace(/\$[^$]*\$/g, 'xx').length > SHORT_OPTION) ? 1 : 4
}

/** Today's IST day number, so the first question changes daily but not on every visit. */
function istDayNumber(): number {
  return Math.floor((Date.now() + 5.5 * 3_600_000) / 86_400_000)
}

type Outcome = 'correct' | 'incorrect' | 'timeout'

export interface CrackThisProps {
  /** "Play today's Daily Quiz" — the same flow as the floating button. */
  onPlay: () => void
}

export default function CrackThis({ onPlay }: CrackThisProps) {
  const categories = useMemo(() => publishedCategories(), [])
  const [category, setCategory] = useState<SampleCategory>(categories[0]?.id ?? 'mathematics')
  const questions = useMemo(() => publishedQuestions(category), [category])
  const [offsets, setOffsets] = useState<Partial<Record<SampleCategory, number>>>({})
  const index = (istDayNumber() + (offsets[category] ?? 0)) % Math.max(questions.length, 1)
  const question = questions[index]

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

  // The clock: counts only while the card has been seen, the question is open and the
  // tab is visible. Elapsed time is measured, not counted in ticks, so a throttled timer
  // cannot slow it down.
  useEffect(() => {
    if (!started || outcome !== null) return
    let last = performance.now()
    const timer = window.setInterval(() => {
      const nowMs = performance.now()
      const delta = nowMs - last
      last = nowMs
      if (document.visibilityState !== 'visible') return
      setElapsedMs((ms) => ms + delta)
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [started, outcome, question?.id])

  const remaining = Math.max(0, SAMPLE_QUESTION_SECONDS - Math.floor(elapsedMs / 1000))

  useEffect(() => {
    if (remaining === 0 && outcome === null) setOutcome('timeout')
  }, [remaining, outcome])

  if (!question) return null

  function submit() {
    if (selected === null || !question) return
    setOutcome(Number(selected) === question.answer ? 'correct' : 'incorrect')
  }

  function tryAnother() {
    setOffsets((current) => ({ ...current, [category]: (current[category] ?? 0) + 1 }))
    reset()
  }

  function changeCategory(next: string) {
    setCategory(next as SampleCategory)
    reset()
  }

  const correctText = question.options[question.answer]
  const clock = `00:${String(remaining).padStart(2, '0')}`

  const body = (
    <div className={styles.play}>
      <div className={styles.questionCol}>
        <MathText block className={styles.question}>
          {question.question}
        </MathText>
        <OptionGroup
          legend="Choose your answer"
          value={selected}
          onChange={setSelected}
          disabled={outcome !== null}
          columns={optionColumns(question.options)}
          className={styles.options}
        >
          {question.options.map((option, i) => (
            <OptionTile
              key={`${question.id}-${i}`}
              value={String(i)}
              letter={LETTERS[i]!}
              result={
                outcome === null
                  ? undefined
                  : i === question.answer
                    ? 'correct'
                    : String(i) === selected
                      ? 'incorrect'
                      : undefined
              }
            >
              <MathText>{option}</MathText>
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
                ) : outcome === 'incorrect' ? (
                  <>
                    Not quite. The answer is <MathText>{correctText}</MathText>.
                  </>
                ) : (
                  <>
                    Time’s up! The answer is <MathText>{correctText}</MathText>.
                  </>
                )}
              </p>
              <MathText block className={styles.explanation}>
                {question.explanation}
              </MathText>
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
            onClick={submit}
            disabled={selected === null}
            iconAfter={<ArrowRight size={18} aria-hidden="true" />}
          >
            Submit answer
          </Button>
        ) : (
          <div className={styles.after}>
            <Button size="lg" fullWidth variant="secondary" onClick={tryAnother}>
              Try another
            </Button>
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
          </div>
        )}
        {selected === null && outcome === null && <p className={styles.hint}>Pick an option to submit.</p>}
      </div>
    </div>
  )

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
            <p className={styles.lead}>Try a sample question — no sign-in needed.</p>
          </div>
          <p className={styles.timer} role="timer" aria-label={`${remaining} seconds left`}>
            <Timer aria-hidden="true" />
            <span className="tnum">{clock}</span>
          </p>
        </header>

        {categories.length > 1 ? (
          <div className={styles.withTabs}>
            <Tabs
              items={categories.map((c) => {
                const Glyph = TAB_ICONS[c.id]
                return { id: c.id, label: c.label, icon: <Glyph size={18} aria-hidden="true" /> }
              })}
              value={category}
              onChange={changeCategory}
              label="Question type"
              idPrefix="crack"
              variant="pill"
              className={styles.tabs}
            />
            {categories.map((c) => (
              <TabPanel key={c.id} id={c.id} idPrefix="crack" active={c.id === category} className={styles.panel}>
                {body}
              </TabPanel>
            ))}
          </div>
        ) : (
          body
        )}
      </div>
    </section>
  )
}
