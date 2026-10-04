import type { ReactElement, ReactNode } from 'react'
import Icon from './Icon'
import IconTile, { type IconTileTone } from './IconTile'
import styles from './StatTile.module.css'

/**
 * One counted figure.
 *
 * Replaces the original `components/StatTile.tsx` (which re-exports this) and the
 * several private `.total` / `.totalValue` / `.tile` blocks that had grown across the
 * admin pages.
 *
 * ## Two layouts
 *
 * `label-first` (the default) puts what is counted above the figure — right for a row
 * of administrative figures, where a reader scans the labels to find the number they
 * want. `value-first` is the launch mockups' stat card: a tinted icon, the figure, the
 * label under it, and a delta under that ("↑ +120 this week"). Pass a `CountUp` as the
 * `value` to make it count up on first view.
 *
 * ## `null` is not zero
 *
 * `value` accepts `null`, and it renders an em dash rather than a `0`. This is the
 * product's oldest data rule: "nothing has been sat" and "everybody scored zero" are
 * different facts about a child, and the backend returns `null` for the first
 * precisely so a screen cannot claim the second.
 *
 * ## A delta says its direction in words
 *
 * The arrow and the colour are decoration; the delta's text must carry the meaning
 * ("+120 this week"), because a colour-blind reader cannot tell green from red and a
 * screen reader does not see either.
 */

export interface StatDelta {
  /** The words — "+120 this week", "Keep it going!", "out of 12,458". */
  text: ReactNode
  /** `up` is good news (green, an up arrow), `down` bad news, `neutral` neither. */
  direction?: 'up' | 'down' | 'neutral'
}

export interface StatTileProps {
  /**
   * A Phosphor glyph name, or an already rendered element (a Lucide icon on the
   * redesigned pages). A string is sized here; an element's caller owns its size.
   */
  icon: string | ReactElement
  /** `null` for "no data", which is rendered as an em dash and never as zero. */
  value: ReactNode | null
  label: string
  /** A short qualifier under the figure — "this week", "programme total". */
  hint?: ReactNode
  /** The mockups' "↑ +120 this week" line. */
  delta?: StatDelta
  /** Semantic tint for the icon (`label-first`). */
  tone?: 'primary' | 'neutral' | 'success' | 'warning' | 'danger'
  /** Categorical tint for the icon (`value-first`) — gold for XP, orange for a streak. */
  iconTone?: IconTileTone
  layout?: 'label-first' | 'value-first'
  className?: string
}

function Figure({ value }: { value: ReactNode | null }) {
  return value === null || value === undefined ? (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">No data</span>
    </>
  ) : (
    <>{value}</>
  )
}

function Delta({ delta }: { delta: StatDelta }) {
  const direction = delta.direction ?? 'neutral'
  const glyph = direction === 'up' ? 'ph-arrow-up' : direction === 'down' ? 'ph-arrow-down' : null
  return (
    <p className={[styles.delta, styles[`delta-${direction}`]].join(' ')}>
      {glyph && <Icon name={glyph} weight="bold" size="xs" />}
      {delta.text}
    </p>
  )
}

export default function StatTile({
  icon,
  value,
  label,
  hint,
  delta,
  tone = 'primary',
  iconTone = 'blue',
  layout = 'label-first',
  className,
}: StatTileProps) {
  if (layout === 'value-first') {
    return (
      <div className={[styles.tile, styles.valueFirst, className].filter(Boolean).join(' ')}>
        <IconTile icon={icon} tone={iconTone} shape="circle" size="md" />
        <div className={styles.text}>
          <p className={styles.bigValue}>
            <Figure value={value} />
          </p>
          <p className={styles.caption}>{label}</p>
          {delta && <Delta delta={delta} />}
          {hint && <p className={styles.hint}>{hint}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className={[styles.tile, className].filter(Boolean).join(' ')}>
      <span className={`${styles.iconWrap} ${styles[tone]}`}>
        {typeof icon === 'string' ? <Icon name={icon} weight="bold" size="md" /> : icon}
      </span>
      <div className={styles.text}>
        <p className={styles.label}>{label}</p>
        <p className={styles.value}>
          <Figure value={value} />
        </p>
        {delta && <Delta delta={delta} />}
        {hint && <p className={styles.hint}>{hint}</p>}
      </div>
    </div>
  )
}
