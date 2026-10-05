/**
 * Locale formatting — the one place a number or a date is turned into words
 * (Milestone 30, Phase 1).
 *
 * The launch brief's rules: **Indian digit grouping** (`1,08,320`, never `108,320`),
 * dates that read like **"Sun, 8 Nov 2026 • 10:00 AM"**, and **Asia/Kolkata** for
 * every date regardless of the device's own time zone — a student in Dubai and one
 * in Delhi must see the same deadline. Pages that predate this module still call
 * `toLocaleString` themselves; new code calls these.
 *
 * Pure functions, no React, no I/O. The formatters are built once and reused,
 * because `Intl` construction is the expensive part.
 */

export const APP_TIME_ZONE = 'Asia/Kolkata'

const numberFormat = new Intl.NumberFormat('en-IN')

/** `108320` → `"1,08,320"`. */
export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

const dateParts = new Intl.DateTimeFormat('en-IN', {
  timeZone: APP_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const timeParts = new Intl.DateTimeFormat('en-IN', {
  timeZone: APP_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

/**
 * `"Sun, 8 Nov 2026"`. `en-IN` prints the weekday with a comma and the day before the
 * month, which is exactly the brief's shape; the parts are reassembled rather than
 * trusting the separator, because engines disagree on it.
 */
export function formatDate(at: Date | string): string {
  const parts = dateParts.formatToParts(new Date(at))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')}`
}

/** `"10:00 AM"` — upper-case, because `en-IN` prints `am` in some engines. */
export function formatTime(at: Date | string): string {
  return timeParts.format(new Date(at)).replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toUpperCase()}`)
}

/** `"Sun, 8 Nov 2026 • 10:00 AM"`. */
export function formatDateTime(at: Date | string): string {
  return `${formatDate(at)} • ${formatTime(at)}`
}

/** Whole seconds split into days/hours/minutes/seconds. Negative input is zero. */
export function splitDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  return {
    days: Math.floor(s / 86_400),
    hours: Math.floor((s % 86_400) / 3_600),
    minutes: Math.floor((s % 3_600) / 60),
    seconds: s % 60,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `"05:27:31"` — hours roll past 24 rather than wrapping, so a 30-hour wait reads 30. */
export function formatClock(totalSeconds: number): string {
  const { days, hours, minutes, seconds } = splitDuration(totalSeconds)
  return `${pad(days * 24 + hours)}:${pad(minutes)}:${pad(seconds)}`
}

/**
 * The compact chip: `"2d 14h"`, `"5h 12m"`, `"3m"`, `"under a minute"` — the two
 * largest non-zero units, which is all a glance needs.
 */
export function formatCompactDuration(totalSeconds: number): string {
  const { days, hours, minutes } = splitDuration(totalSeconds)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return 'under a minute'
}

/**
 * A competition day key (`2026-11-08`) as a date: `"Sun, 8 Nov 2026"`. The key already
 * *is* an IST calendar date, so it is read as IST midnight and never re-derived from a
 * device's clock — a browser in another time zone must not relabel a day.
 */
export function formatDayKey(day: string): string {
  return formatDate(`${day}T00:00:00+05:30`)
}

/** A day key's position in the calendar — whole days since 1970-01-01. */
function dayNumberOf(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)
}

/**
 * `"Today"`, `"Yesterday"` or `"Sun, 4 Oct 2026"` — a competition day relative to the
 * **server's** today (pass the `today` a response carried), never the device's.
 */
export function formatDayLabel(day: string, today: string): string {
  const diff = dayNumberOf(today) - dayNumberOf(day)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return formatDayKey(day)
}

/**
 * When something arrived: `"Just now"`, `"5 min ago"`, `"3 h ago"`, `"2 days ago"`, then
 * the date. A caption rather than a deadline, so the device's clock is good enough.
 */
export function formatTimeAgo(at: Date | string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`
  return formatDate(at)
}

/**
 * Today's entry from a list that rotates daily (Milestone 30, Phase 4 — the dashboard's
 * quote and maths thought). Keyed by a **day key**, so it turns over at IST midnight and
 * is the same for every student all day; `salt` lets two lists rotate out of step.
 */
export function rotateDaily<T>(list: readonly T[], day: string, salt = 0): T | undefined {
  if (list.length === 0) return undefined
  const index = (((dayNumberOf(day) + salt) % list.length) + list.length) % list.length
  return list[index]
}

/**
 * A server-measured solve time: `"42.3 s"`, `"1 min 12 s"`, `"2 h 4 min"`. Tenths below a
 * minute, because a Daily Quiz winner can be decided by them.
 */
export function formatSolveTime(ms: number): string {
  if (ms < 60_000) return `${(Math.max(0, ms) / 1000).toFixed(1)} s`
  const { days, hours, minutes, seconds } = splitDuration(ms / 1000)
  const totalHours = days * 24 + hours
  if (totalHours > 0) return `${totalHours} h ${minutes} min`
  return `${minutes} min ${seconds} s`
}
