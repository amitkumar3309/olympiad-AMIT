import Icon from './Icon'
import styles from './Steps.module.css'

/**
 * Where you are in a sequence of steps.
 *
 * Three flows in this product are genuinely multi-step and all three had said so
 * differently, or not at all: registration (details → check → verify), a bulk import
 * (upload → review → saved) and AI drafting (configure → review → approved). The first
 * had a hand-built row of spans; the other two had nothing, so an examiner looking at a
 * screen of parsed rows had no way to tell whether anything had been written yet.
 *
 * ## What it is careful about
 *
 * **It is a state display, not a control.** The steps are not links: you get to the
 * next one by doing the thing, and a step you have not reached does not exist yet.
 * `aria-current="step"` marks the position, which is how a screen reader reads it.
 *
 * **It never claims progress it does not have.** A step is `done` only once the work
 * behind it is finished — an import that has been *previewed* is still on the review
 * step, because nothing has been written.
 *
 * On a phone the labels of the steps you are not on are visually hidden and the numbers
 * carry the sequence: three wrapped labels change the header's height as you move
 * through, which shifts the content under a thumb.
 */

export interface Step {
  /** Stable key. */
  id: string
  label: string
}

export interface StepsProps {
  steps: Step[]
  /** The id of the step in progress. Everything before it is drawn as done. */
  current: string
  /** Names the list for assistive technology: "Import steps". */
  label: string
  className?: string
}

export default function Steps({ steps, current, label, className }: StepsProps) {
  const currentIndex = steps.findIndex((step) => step.id === current)

  return (
    <ol className={[styles.steps, className].filter(Boolean).join(' ')} aria-label={label}>
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'
        return (
          <li
            key={step.id}
            className={styles[state]}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className={styles.mark} aria-hidden="true">
              {state === 'done' ? <Icon name="ph-check" weight="bold" size="xs" /> : index + 1}
            </span>
            <span className={styles.label}>{step.label}</span>
            {state === 'done' && <span className="sr-only"> (done)</span>}
          </li>
        )
      })}
    </ol>
  )
}
