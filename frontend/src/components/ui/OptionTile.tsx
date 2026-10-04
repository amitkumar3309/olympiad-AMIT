import { createContext, useContext, useId, type ReactNode } from 'react'
import Icon from './Icon'
import styles from './OptionTile.module.css'

/**
 * An answer choice — the mockups' A–D tiles (Milestone 30).
 *
 * ## It is a real radio group
 *
 * `OptionGroup` is a `<fieldset>` with a legend, and every `OptionTile` wraps a native
 * `<input type="radio">` that shares the group's `name`. That buys, for free, the
 * behaviour a hand-built `role="radio"` has to reimplement: arrow keys move between
 * choices, one Tab stop for the whole group, Space selects, and a screen reader
 * announces "B, 12 over 3, radio button, 2 of 4". The input is visually hidden; the
 * tile is its label, so the whole tile is the click target.
 *
 * ## States
 *
 * idle → hover → **selected** (border, tint *and* a filled letter — never colour
 * alone) → after marking, **correct** or **incorrect**, each with an icon and words for
 * a screen reader. `disabled` locks the group once an answer is in.
 *
 * ## It does not render maths itself
 *
 * The content is `children`. A question's option goes in as `<MathText>`, which lives
 * in `components/` because it knows the product's LaTeX rules; this component knows
 * nothing about questions.
 */

interface GroupContextValue {
  name: string
  value: string | null
  onChange: (value: string) => void
  disabled: boolean
}

const GroupContext = createContext<GroupContextValue | null>(null)

export interface OptionGroupProps {
  /** What is being chosen — "Choose your answer". Read to a screen reader; visually
      hidden unless `showLegend`. */
  legend: string
  showLegend?: boolean
  value: string | null
  onChange: (value: string) => void
  disabled?: boolean
  /** Two columns from a small phone up, four from a tablet — the mockups' row of four. */
  columns?: 1 | 2 | 4
  children: ReactNode
  className?: string
}

export function OptionGroup({
  legend,
  showLegend,
  value,
  onChange,
  disabled = false,
  columns = 2,
  children,
  className,
}: OptionGroupProps) {
  const name = useId()
  return (
    <GroupContext.Provider value={{ name, value, onChange, disabled }}>
      <fieldset className={[styles.group, styles[`cols-${columns}`], className].filter(Boolean).join(' ')} disabled={disabled}>
        <legend className={showLegend ? styles.legend : 'sr-only'}>{legend}</legend>
        {children}
      </fieldset>
    </GroupContext.Provider>
  )
}

export interface OptionTileProps {
  /** The choice's own id — what `onChange` receives. Opaque; never a letter. */
  value: string
  /** The letter painted on the tile — "A". Display only. */
  letter: string
  /** Set once the answer has been marked. Omit before. */
  result?: 'correct' | 'incorrect'
  children: ReactNode
}

export default function OptionTile({ value, letter, result, children }: OptionTileProps) {
  const group = useContext(GroupContext)
  if (!group) throw new Error('OptionTile must be rendered inside an OptionGroup')

  const selected = group.value === value
  const classes = [
    styles.tile,
    selected ? styles.selected : '',
    result ? styles[result] : '',
    group.disabled ? styles.disabled : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <label className={classes}>
      <input
        type="radio"
        className={styles.input}
        name={group.name}
        value={value}
        checked={selected}
        disabled={group.disabled}
        onChange={() => group.onChange(value)}
      />
      <span className={styles.letter} aria-hidden="true">
        {letter}
      </span>
      <span className={styles.content}>{children}</span>
      {result === 'correct' && (
        <span className={styles.mark}>
          <Icon name="ph-check-circle" weight="bold" size="md" />
          <span className="sr-only">Correct answer</span>
        </span>
      )}
      {result === 'incorrect' && (
        <span className={styles.mark}>
          <Icon name="ph-x-circle" weight="bold" size="md" />
          <span className="sr-only">Your answer, incorrect</span>
        </span>
      )}
    </label>
  )
}
