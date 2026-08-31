import { useEffect, useRef, useState } from 'react'
import { Icon } from './ui'
import type { ChallengeRollover } from '../api/types'
import styles from './ChallengeCountdown.module.css'

/**
 * How long today's question stays today's.
 *
 * ## The clock is the server's
 *
 * Everything here is a **display** of two figures the API sent: a duration
 * (`secondsRemaining`) and the absolute instant it ends (`nextChangeAt`). Nothing in
 * this component decides when the day turns. That is not a stylistic preference — the
 * competition day is an **IST** calendar day (`lib/competitionDay.ts` on the backend),
 * so a browser in another timezone that computed "midnight" for itself would count down
 * to the wrong moment, and a device with a wrong clock would count down to an arbitrary
 * one. Both figures are sent because they fail differently:
 *
 * - `secondsRemaining` is a duration, so it is immune to a device clock that is hours
 *   out. It is what the first render uses.
 * - `nextChangeAt` is absolute, so it is immune to a *timer* that stops advancing —
 *   which is exactly what happens in a background tab, where `setInterval` is throttled
 *   to once a minute or paused outright. It is what each tick re-derives from.
 *
 * The pair is why a page left open all afternoon still shows the right figure: the tick
 * measures elapsed wall-clock time against the deadline rather than counting its own
 * firings. A timer that has missed two hundred firings therefore under-reports nothing.
 *
 * ## Reaching zero is a refetch, not a change of state
 *
 * At zero the component calls `onElapsed` and the page **asks the server again**. It
 * does not swap in tomorrow's challenge, because it does not have one, and it must not
 * infer that the question changed — the server is the only thing that knows which day
 * it is. Until that request answers, the countdown holds at 0 and says the new question
 * is on its way.
 *
 * ## What the copy says, and what it deliberately leaves out
 *
 * Owner's decision (2026-08-31): a student sees **the timer and nothing else** — no
 * mention that staff can change the question, and no `source` badge saying who chose
 * today's. The first version said both, on the reasoning that a reader told only
 * "midnight" has been misled the moment an administrator re-points a day. The owner
 * weighed that and chose the simpler line; the residual risk is real but small, and it
 * resolves itself — the page re-requests the endpoint at zero, and any earlier change is
 * picked up on the next load.
 *
 * So do not reintroduce the administrator sentence, the `source` clause, or a
 * "scheduled / automatic" badge on a student surface without asking. `challenge.source`
 * is still on the payload and still used by the admin console.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `7h 12m 44s`, or `12m 44s` inside the last hour. Never a bare `00:00:00`. */
function formatRemaining(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`
  return `${seconds}s`
}

/** The change-over instant in the reader's own locale, since it is a real wall time. */
function formatChangeTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export interface ChallengeCountdownProps {
  rollover: ChallengeRollover
  /**
   * Called once the countdown reaches zero, so the page can re-ask the server for the
   * day's challenge. The component never decides that the day has changed by itself.
   */
  onElapsed?: () => void
  /** `full` for the challenge page, `compact` for the dashboard card. */
  variant?: 'full' | 'compact'
}

export default function ChallengeCountdown({ rollover, onElapsed, variant = 'full' }: ChallengeCountdownProps) {
  const [remaining, setRemaining] = useState(rollover.secondsRemaining)

  /**
   * Kept in a ref so the ticking effect does not have to list it as a dependency —
   * a page that passes an inline arrow would otherwise tear down and rebuild the
   * interval on every render, and the countdown would never advance.
   */
  const elapsedRef = useRef(onElapsed)
  elapsedRef.current = onElapsed

  /** Whether zero has already been reported, so the refetch is asked for once. */
  const firedRef = useRef(false)

  useEffect(() => {
    firedRef.current = false
    setRemaining(rollover.secondsRemaining)

    const deadline = new Date(rollover.nextChangeAt).getTime()
    // A malformed instant is not fatal: fall back to counting the duration down, which
    // is still correct for the next few hours and cannot show a wrong absolute time.
    const usable = !Number.isNaN(deadline)
    const startedAt = Date.now()

    const tick = () => {
      const left = usable
        ? Math.ceil((deadline - Date.now()) / 1000)
        : rollover.secondsRemaining - Math.round((Date.now() - startedAt) / 1000)
      const clamped = Math.max(0, left)
      setRemaining(clamped)

      if (clamped === 0 && !firedRef.current) {
        firedRef.current = true
        elapsedRef.current?.()
      }
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [rollover.nextChangeAt, rollover.secondsRemaining])

  const changeTime = formatChangeTime(rollover.nextChangeAt)

  return (
    <div className={`${styles.wrap} ${variant === 'compact' ? styles.compact : ''}`}>
      <Icon name="ph-timer" weight="bold" size={variant === 'compact' ? 'sm' : 'md'} className={styles.icon} />

      <div className={styles.body}>
        <p className={styles.line}>
          {remaining === 0 ? (
            /* Two different truths, and saying the wrong one is a small lie the reader
               can catch: the challenge page really is refetching, and the dashboard
               card really is not — it has no `onElapsed` and deliberately does not
               swap a question under someone mid-glance. */
            onElapsed ? (
              <>
                <strong>Today’s question has just changed.</strong> Loading the new one…
              </>
            ) : (
              <>
                <strong>Today’s question has changed.</strong> Open the daily challenge for the new one.
              </>
            )
          ) : (
            <>
              {/* Not a live region: a value that changes every second would be
                  announced every second, which makes a screen reader unusable. The
                  sentence beside it carries the same information without a clock. */}
              <span className={styles.clock}>{formatRemaining(remaining)}</span>
              <span className={styles.label}>
                {variant === 'compact' ? 'until the next question' : 'until today’s question changes'}
              </span>
            </>
          )}
        </p>

        {variant === 'full' && (
          <p className={styles.note}>
            The next question appears when this timer runs out
            {changeTime && (
              <>
                {' — '}
                <time dateTime={rollover.nextChangeAt}>{changeTime}</time> your time
              </>
            )}
            .
          </p>
        )}
      </div>
    </div>
  )
}
