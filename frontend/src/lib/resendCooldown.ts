import { useCallback, useEffect, useState } from 'react'

/**
 * The wait between verification emails, as the reader experiences it.
 *
 * ## The deadline is the server's; this only displays it
 *
 * Every response that sends a verification link carries `nextResendAt`, an absolute
 * instant. Nothing here decides how long the wait is — the same rule the daily
 * challenge's countdown follows, and for a stronger reason: this cooldown also protects
 * a mail quota, and a limit enforced only in a browser is a suggestion. The server
 * refuses an early resend regardless of what this shows.
 *
 * An **absolute instant** rather than a duration because a countdown that decrements its
 * own counter is wrong the moment the tab is backgrounded and `setInterval` is throttled.
 * Each tick measures the remaining wall-clock time instead, so a tab left in the
 * background for ten minutes reads zero when it comes back rather than 4:12.
 *
 * ## Why it is persisted
 *
 * A student who reloads the verification page, or closes it and follows a link from
 * their inbox, must not get a fresh five minutes or a button that lies about being
 * ready. The deadline is kept in `localStorage` under the address it belongs to, so it
 * survives a reload and stays specific to that account.
 *
 * Storing an email address locally is deliberate and narrow: it is the address the
 * person just typed into this browser, it never leaves it, and the alternative — a
 * single shared key — would show one account's cooldown on another's screen.
 */

const STORAGE_PREFIX = 'amit.resend.'

function storageKey(email: string): string {
  return `${STORAGE_PREFIX}${email.trim().toLowerCase()}`
}

/** Reads a stored deadline, discarding one that has passed or was never valid. */
function storedDeadline(email: string): number | null {
  if (!email.trim()) return null
  try {
    const raw = window.localStorage.getItem(storageKey(email))
    if (!raw) return null
    const at = Date.parse(raw)
    if (Number.isNaN(at) || at <= Date.now()) {
      window.localStorage.removeItem(storageKey(email))
      return null
    }
    return at
  } catch {
    // Private browsing, a full quota, storage disabled: the cooldown then simply does
    // not survive a reload, which is a smaller failure than the page not rendering.
    return null
  }
}

function remember(email: string, iso: string): void {
  try {
    window.localStorage.setItem(storageKey(email), iso)
  } catch {
    /* see above */
  }
}

export interface ResendCooldown {
  /** Whole seconds left, 0 when another link may be requested. */
  secondsLeft: number
  /** Record a deadline the server has just issued. */
  start: (nextResendAt: string | undefined, email: string) => void
}

/**
 * Tracks the cooldown for one address.
 *
 * `email` may change as the reader types (the verification page asks for it), so the
 * hook re-reads its stored deadline when it does — otherwise the countdown from one
 * address would be shown beside another.
 */
export function useResendCooldown(email: string): ResendCooldown {
  const [deadline, setDeadline] = useState<number | null>(() => storedDeadline(email))
  const [secondsLeft, setSecondsLeft] = useState(0)

  // Follow the address being asked about.
  useEffect(() => {
    setDeadline(storedDeadline(email))
  }, [email])

  useEffect(() => {
    if (deadline === null) {
      setSecondsLeft(0)
      return
    }

    const tick = () => {
      // Measured against the deadline rather than counted down, so a throttled or
      // paused timer cannot make this over-report.
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left === 0) setDeadline(null)
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [deadline])

  const start = useCallback((nextResendAt: string | undefined, forEmail: string) => {
    if (!nextResendAt) return
    const at = Date.parse(nextResendAt)
    if (Number.isNaN(at)) return
    remember(forEmail, nextResendAt)
    setDeadline(at)
  }, [])

  return { secondsLeft, start }
}

/** `4:59`. Minutes and seconds, because the wait is minutes long by design. */
export function formatCooldown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
