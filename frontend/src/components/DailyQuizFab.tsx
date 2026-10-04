import { Link } from 'react-router-dom'
import { CalendarClock, CircleCheck, Gift, Zap } from 'lucide-react'
import styles from './DailyQuizFab.module.css'

/**
 * The floating Daily Quiz button — the brief's R4, and the most animated thing on the
 * homepage (Milestone 30, Phase 1: the component; Phase 3 wires it to the quiz status
 * endpoint and the Login Gate).
 *
 * ## Four states, all of them true
 *
 *  - `guest` — "Daily Quiz · Win a gift + cash". Opens the Login Gate (`onClick`).
 *  - `live` — signed in, today's quiz not yet attempted. A pulsing green dot.
 *  - `done` — attempted today; "See result", with when the answer unlocks.
 *  - `upcoming` — nothing scheduled right now; when the next one opens.
 *
 * The caller decides the state from the server, and supplies the countdown text — this
 * component holds no clock and decides nothing.
 *
 * ## Motion, and why it is split across two elements
 *
 * The wrapper **floats** (±4px, 3s) and the pill **scales** on hover. They are on
 * different elements because an animation beats a transition on the same property: a
 * float and a hover scale on one element would leave the hover dead. Hover and
 * keyboard focus also sweep a diagonal light streak across the pill and brighten its
 * glow — the "shine" the owner asked for. On a touch screen, where there is no hover,
 * the streak sweeps by itself every few seconds. Under reduced motion there is no float
 * and no sweep, only a static glow on hover and focus.
 *
 * ## Accessibility
 *
 * A real link or button, 56px tall (44px is the floor), with a full accessible name
 * ("Play today's Daily Quiz — winners get a surprise gift and cash") because the
 * visible label is two fragments. The icon is decorative. When `collapsed` (a phone,
 * scrolling down) only the icon shows, and the name is unchanged.
 */

export type DailyQuizFabState = 'guest' | 'live' | 'done' | 'upcoming'

export interface DailyQuizFabProps {
  state: DailyQuizFabState
  /** Where the button goes — the quiz, or the result. Omit to render a button. */
  to?: string
  /** For `guest`: open the Login Gate. */
  onClick?: () => void
  /** The second line for `done` / `upcoming` — "Answer unlocks in 5h 12m". */
  detail?: string
  /** Icon only — set while the reader scrolls down on a phone. */
  collapsed?: boolean
  /** `inline` renders it in the flow (the design-system page), without the float. */
  placement?: 'fixed' | 'inline'
  className?: string
}

const COPY: Record<DailyQuizFabState, { title: string; line: string; name: string }> = {
  guest: {
    title: 'Daily Quiz',
    line: 'Win a gift + cash',
    name: 'Play today’s Daily Quiz — winners get a surprise gift and cash',
  },
  live: {
    title: 'Today’s quiz is live',
    line: 'Win a gift + cash',
    name: 'Play today’s Daily Quiz — winners get a surprise gift and cash',
  },
  done: {
    title: 'Done for today · See result',
    line: '',
    name: 'Daily Quiz done for today — see your result',
  },
  upcoming: {
    title: 'Daily Quiz',
    line: '',
    name: 'Daily Quiz — the next one has not opened yet',
  },
}

export default function DailyQuizFab({
  state,
  to,
  onClick,
  detail,
  collapsed,
  placement = 'fixed',
  className,
}: DailyQuizFabProps) {
  const copy = COPY[state]
  const line = copy.line || detail || ''
  const name = detail && (state === 'done' || state === 'upcoming') ? `${copy.name}. ${detail}` : copy.name
  const Glyph = state === 'done' ? CircleCheck : state === 'upcoming' ? CalendarClock : Zap

  const inner = (
    <>
      <span className={styles.icon} aria-hidden="true">
        <Glyph size={22} strokeWidth={2.25} />
        {state === 'live' && <span className={styles.liveDot} />}
      </span>
      <span className={styles.text} aria-hidden="true">
        <span className={styles.title}>{copy.title}</span>
        {line && (
          <span className={styles.line}>
            {(state === 'guest' || state === 'live') && <Gift size={13} strokeWidth={2.5} />}
            {line}
          </span>
        )}
      </span>
    </>
  )

  const pillClasses = [styles.pill, collapsed ? styles.collapsed : ''].filter(Boolean).join(' ')

  return (
    <div className={[styles.fab, placement === 'inline' ? styles.inline : '', className].filter(Boolean).join(' ')}>
      {to ? (
        <Link to={to} className={pillClasses} aria-label={name}>
          {inner}
        </Link>
      ) : (
        <button type="button" className={pillClasses} aria-label={name} onClick={onClick}>
          {inner}
        </button>
      )}
    </div>
  )
}
