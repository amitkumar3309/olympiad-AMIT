import { useEffect, useRef, useState } from 'react'
import { formatClock, formatCompactDuration, splitDuration } from '../../lib/format'
import styles from './Countdown.module.css'

/**
 * A countdown (or an elapsed timer) **displayed from the server's clock** (Milestone 30).
 *
 * ## The browser's clock is never trusted
 *
 * A device can be minutes wrong, or in another time zone, and the deadline it is
 * counting to is IST midnight. So the caller passes `offsetMs` — how far the server's
 * clock is ahead of this device's, measured when the response arrived (see
 * `clockOffset`) — and every tick computes the remaining time **fresh from the wall
 * clock plus that offset**. It never counts its own ticks, so a tab that throttled
 * its timers for two hours still reads correctly the moment it is looked at. This is
 * the same rule as `components/ChallengeCountdown.tsx`.
 *
 * It is a **display**. Reaching zero calls `onComplete`, and the caller re-asks the
 * server what happens next; the countdown never decides that a day has turned.
 *
 * ## Accessibility
 *
 * `role="timer"`, whose implicit `aria-live` is `off`: a screen reader is not told
 * every second (the brief's §10), and reads the current value when it reaches it. The
 * `label` says what is being counted — "Time left in today's quiz".
 */

export interface CountdownProps {
  /** The instant counted to (`down`) or from (`up`). */
  target: string | Date
  /** Server minus device, in ms. 0 when the device is trusted, which it never should be. */
  offsetMs?: number
  direction?: 'down' | 'up'
  /**
   * `clock` — `00:27:31`. `compact` — `2d 14h`, for a chip. `units` — four boxes with
   * DAYS / HOURS / MINUTES / SECONDS under them (the Boss Battle card).
   */
  variant?: 'clock' | 'compact' | 'units'
  /** What is being counted, for a screen reader. */
  label: string
  /** Called once, when a countdown reaches zero. */
  onComplete?: () => void
  className?: string
}

const UNIT_LABELS = ['Days', 'Hours', 'Minutes', 'Seconds'] as const

export default function Countdown({
  target,
  offsetMs = 0,
  direction = 'down',
  variant = 'clock',
  label,
  onComplete,
  className,
}: CountdownProps) {
  const [now, setNow] = useState(() => Date.now())
  const completed = useRef(false)
  const targetMs = new Date(target).getTime()

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [])

  const serverNow = now + offsetMs
  // Down rounds UP, so it never shows 0 before the instant has truly passed — the
  // same rule the backend's `secondsUntilNextDay()` follows. Up rounds down.
  const seconds =
    direction === 'down'
      ? Math.max(0, Math.ceil((targetMs - serverNow) / 1000))
      : Math.max(0, Math.floor((serverNow - targetMs) / 1000))

  useEffect(() => {
    if (direction !== 'down' || seconds > 0 || completed.current) return
    completed.current = true
    onComplete?.()
  }, [direction, seconds, onComplete])

  // A new target (tomorrow's) re-arms the completion callback.
  useEffect(() => {
    completed.current = false
  }, [targetMs])

  const classes = [styles.countdown, styles[variant], className].filter(Boolean).join(' ')

  if (variant === 'units') {
    const parts = splitDuration(seconds)
    const values = [parts.days, parts.hours, parts.minutes, parts.seconds]
    return (
      <div role="timer" aria-label={label} className={classes}>
        {values.map((value, i) => (
          <span key={UNIT_LABELS[i]} className={styles.unit}>
            <span className={styles.unitValue}>{String(value).padStart(2, '0')}</span>
            <span className={styles.unitLabel}>{UNIT_LABELS[i]}</span>
          </span>
        ))}
      </div>
    )
  }

  return (
    <span role="timer" aria-label={label} className={classes}>
      {variant === 'compact' ? formatCompactDuration(seconds) : formatClock(seconds)}
    </span>
  )
}
