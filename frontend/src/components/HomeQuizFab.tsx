import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { api } from '../api/client'
import type { DailyQuizStatus } from '../api/types'
import { useAuth } from '../context/AuthContext'
import { formatCompactDuration } from '../lib/format'
import { DAILY_QUIZ_FAB } from '../lib/siteConfig'
import { clockOffset } from './ui'
import DailyQuizFab, { type DailyQuizFabState } from './DailyQuizFab'

/**
 * The floating Daily Quiz button, wired (Milestone 30, Phase 3 — brief §7.2).
 *
 * `DailyQuizFab` draws a state; this decides which, from the server:
 *
 *  - a **guest** gets "Daily Quiz · Win a gift + cash", which opens the Login Gate;
 *  - a **student** gets their real state from `GET /me/daily-quiz/status` — live, done
 *    (with when the answer unlocks), or when the next quiz opens — and a link to the quiz.
 *
 * Nothing is shown to a student until that answer arrives: the button enters ~800ms after
 * first paint anyway, so waiting costs nothing, and guessing would flash the wrong state.
 * A failed request falls back to a plain link to the quiz page, which knows the answer.
 *
 * ## Countdowns are the server's
 *
 * "Answer unlocks in 5h 12m" is measured against `revealAt` with the offset taken from
 * `serverNow` when the response arrived — the device's own clock is never trusted — and
 * re-read every 30 seconds. At zero it asks the server again rather than assuming what
 * comes next.
 *
 * ## It gets out of the way
 *
 * On a phone it shrinks to its icon while the reader scrolls down and comes back when
 * they scroll up or stop. Near the bottom of the page it lifts clear of the footer, so it
 * never covers a footer link. Both are presentation only; the button works without them.
 */

const COLLAPSE_QUERY = '(max-width: 767px)'
/** How long a scroll must pause before a collapsed button expands again. */
const SETTLE_MS = 700
/** The countdown is a compact "5h 12m" — a 30-second tick is plenty. */
const TICK_MS = 30_000
/** Room left between the button and the top of the footer when it lifts. */
const FOOTER_GAP = 16

function secondsUntil(iso: string, offsetMs: number): number {
  return Math.ceil((new Date(iso).getTime() - (Date.now() + offsetMs)) / 1000)
}

export interface HomeQuizFabProps {
  /** A guest pressed it: open the Login Gate. */
  onGuestClick: () => void
}

export default function HomeQuizFab({ onGuestClick }: HomeQuizFabProps) {
  const { state } = useAuth()
  const isStudent = state.status === 'student'

  const [status, setStatus] = useState<DailyQuizStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [offset, setOffset] = useState(0)
  const [, setTick] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [lift, setLift] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await api.get<DailyQuizStatus>('/me/daily-quiz/status')
      setOffset(clockOffset(res.serverNow))
      setStatus(res)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    if (isStudent) void load()
  }, [isStudent, load])

  // The countdown text, re-read on a slow tick; at zero the server is asked again.
  const target = status?.state === 'done' ? status.revealAt : status?.state === 'none' ? status.nextQuizAt : null
  useEffect(() => {
    if (!target) return
    const timer = window.setInterval(() => {
      if (secondsUntil(target, offset) <= 0) void load()
      else setTick((n) => n + 1)
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [target, offset, load])

  // Collapse while scrolling down on a phone; expand on the way up, or once it settles.
  useEffect(() => {
    const phone = window.matchMedia(COLLAPSE_QUERY)
    let lastY = window.scrollY
    let settle: number | undefined
    const onScroll = () => {
      const y = window.scrollY
      if (phone.matches && y > lastY + 8 && y > 120) setCollapsed(true)
      else if (y < lastY - 8) setCollapsed(false)
      lastY = y
      window.clearTimeout(settle)
      settle = window.setTimeout(() => setCollapsed(false), SETTLE_MS)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.clearTimeout(settle)
    }
  }, [])

  // Lift clear of the footer once its top edge comes up the screen.
  useEffect(() => {
    const measure = () => {
      const footer = document.querySelector('footer')
      if (!footer) return
      const overlap = window.innerHeight - footer.getBoundingClientRect().top
      setLift(overlap > 0 ? overlap + FOOTER_GAP : 0)
    }
    measure()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])

  // A signed-in account that is not a student (the root administrator) has no quiz.
  if (state.status === 'loading' || state.status === 'admin') return null

  const style = lift > 0 ? ({ translate: `0 -${lift}px` } as CSSProperties) : undefined
  const common = { collapsed, style }

  if (!isStudent) return <DailyQuizFab state="guest" onClick={onGuestClick} {...common} />
  if (failed) return <DailyQuizFab state="guest" to="/daily-quiz" {...common} />
  if (!status) return null

  let fabState: DailyQuizFabState
  let detail: string | undefined
  switch (status.state) {
    case 'live':
    case 'in-progress':
      fabState = 'live'
      break
    case 'done': {
      fabState = 'done'
      const seconds = status.revealAt ? secondsUntil(status.revealAt, offset) : 0
      detail = seconds > 0 ? `Answer unlocks in ${formatCompactDuration(seconds)}` : 'Answer unlocked'
      break
    }
    case 'none': {
      if (!DAILY_QUIZ_FAB.showWhenNoQuiz) return null
      fabState = 'upcoming'
      const seconds = status.nextQuizAt ? secondsUntil(status.nextQuizAt, offset) : 0
      detail = seconds > 0 ? `Next quiz in ${formatCompactDuration(seconds)}` : 'No quiz today'
      break
    }
    default:
      fabState = 'upcoming'
      detail = 'Add your class to play'
  }

  return <DailyQuizFab state={fabState} to="/daily-quiz" detail={detail} {...common} />
}
