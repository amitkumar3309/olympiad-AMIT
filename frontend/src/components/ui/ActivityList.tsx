import type { ReactElement, ReactNode } from 'react'
import IconTile, { type IconTileTone } from './IconTile'
import styles from './ActivityList.module.css'

/**
 * A short feed of things that happened — the mockups' "Recent Activity"
 * (Milestone 30). An icon, what happened, when, and what it was worth.
 *
 * The rows are whatever the server recorded; this component formats nothing and
 * invents nothing. A row with no value (an achievement with no XP) simply has no
 * value column.
 */

export interface ActivityItem {
  key: string
  icon: string | ReactElement
  tone?: IconTileTone
  title: ReactNode
  /** "Today, 10:12 AM". */
  time: ReactNode
  /** "+20 XP". */
  value?: ReactNode
}

export interface ActivityListProps {
  items: ActivityItem[]
  className?: string
}

export default function ActivityList({ items, className }: ActivityListProps) {
  return (
    <ul className={[styles.list, className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <li key={item.key} className={styles.item}>
          <IconTile icon={item.icon} tone={item.tone ?? 'blue'} shape="circle" size="md" />
          <div className={styles.text}>
            <p className={styles.title}>{item.title}</p>
            <p className={styles.time}>{item.time}</p>
          </div>
          {item.value && <p className={styles.value}>{item.value}</p>}
        </li>
      ))}
    </ul>
  )
}
