import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Motion hooks for the design system (Milestone 30, Phase 1).
 *
 * ## The rule every hook here obeys
 *
 * **Anything delivered with the browser's rendering steps may never arrive** — an
 * `IntersectionObserver` callback, a `requestAnimationFrame`, a CSS transition's end.
 * None of them runs in a tab that is not compositing (a background tab, a hidden
 * preview, some headless runs). So each hook below has a *timer* path that does not
 * depend on rendering, and nothing that waits on one of these hooks can stay hidden or
 * show a half-counted figure because a frame never came. See `CLAUDE.md`.
 *
 * ## Reduced motion
 *
 * `prefers-reduced-motion: reduce` means: no count-up (show the final value), no
 * reveal (show it now), no loop. `base.css` already collapses every CSS duration; these
 * hooks handle the JavaScript-driven cases that CSS cannot reach.
 */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

function readReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_QUERY).matches
    : false
}

/** Live `prefers-reduced-motion` — follows the OS setting while the page is open. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(REDUCED_QUERY)
    const onChange = () => setReduced(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}

export interface InViewOptions {
  /** Fraction of the element that must be visible. */
  threshold?: number
  /**
   * How long to wait for the observer to report *anything* before assuming it never
   * will. Only used when no callback at all has arrived — an observer that has reported
   * "not visible yet" is working, and is trusted to report the scroll.
   */
  fallbackMs?: number
}

/**
 * `true` once the element has been on screen; it never goes back to `false`.
 *
 * The fallback is deliberately narrow. An observer always delivers one callback soon
 * after `observe()`, visible or not — so *no* callback within `fallbackMs` means the
 * observer is not being serviced, and the hook gives up waiting and reports visible.
 * An observer that *has* reported "below the fold" is working, and the element stays
 * pending until it is scrolled to, which is the point of a reveal.
 */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { threshold = 0.25, fallbackMs = 2000 }: InViewOptions = {},
): boolean {
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    let heardFrom = false
    const observer = new IntersectionObserver(
      (entries) => {
        heardFrom = true
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold },
    )
    observer.observe(el)

    const timer = window.setTimeout(() => {
      if (!heardFrom) setInView(true)
    }, fallbackMs)

    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [ref, threshold, fallbackMs, inView])

  return inView
}

/**
 * Counts from 0 to `target` once `start` is true, easing out over `durationMs`.
 *
 * Returns the number to *display*. The final value is never in doubt: with reduced
 * motion it is returned immediately, and a timer snaps to it at the end of the
 * duration even if `requestAnimationFrame` stopped half way (a tab that went to the
 * background mid-count would otherwise freeze on "6,412" of "12,458").
 */
export function useCountUp(target: number, start: boolean, durationMs = 900): number {
  const reduced = usePrefersReducedMotion()
  const [display, setDisplay] = useState(reduced ? target : 0)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      setDisplay(target)
      return
    }
    if (!start) return

    const began = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / durationMs)
      const eased = 1 - (1 - t) ** 3
      setDisplay(Math.round(target * eased))
      if (t < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    const snap = window.setTimeout(() => setDisplay(target), durationMs + 80)

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      window.clearTimeout(snap)
    }
  }, [target, start, durationMs, reduced])

  return display
}
