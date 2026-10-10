import { useCallback, useEffect, useRef, type MouseEvent } from 'react'

/**
 * The homepage's motion (2026-10-09 — the owner: "I want the homepage to look more premium and
 * better, use react animations for smoother effects"). Three things move, and only these:
 *
 *  - **The hero's figure tilts towards the pointer** on a desktop (`useHeroDepth`), and the
 *    founder's quote drifts the other way, on springs — depth, without anything moving by itself.
 *  - **A group of cards rises into place** as it is scrolled to, one after another (`useReveal`).
 *  - **A question in the FAQ opens and closes smoothly** (`smoothToggle`).
 *
 * ## Motion, loaded after the page is up
 *
 * They are driven by Motion (motion.dev — the React animation library formerly called Framer
 * Motion), which `motionKit.ts` narrows to `animate` and `stagger`. It is **loaded on demand**, never
 * with the page: the homepage is drawn at build time and the app takes it over after the first
 * paint, and the reader's taps must answer within 200 ms on a slow phone (CLAUDE.md), so nothing
 * here may be in the way of either. `preloadMotion()` fetches it once the page has settled.
 *
 * ## Nothing is ever hidden that a reader could be looking at
 *
 * The homepage's rule (CLAUDE.md: motion "can never hide content"). The drawn page carries none of
 * this. A group is hidden only **after** the observer has reported it entirely off screen — so a
 * reader looking at it never sees it vanish — and it comes back the moment it is scrolled to, a
 * control inside it takes the focus, or the page is printed. If Motion has not arrived within
 * `MOTION_WAIT_MS`, it simply appears. Under reduced motion nothing here runs at all.
 */

type MotionKit = typeof import('./motionKit')

let kit: Promise<MotionKit> | null = null
let ready: MotionKit | null = null

/** Motion, fetched once. A failure is forgotten, so the next caller tries again. */
function loadMotion(): Promise<MotionKit> {
  kit ??= import('./motionKit').then(
    (loaded) => (ready = loaded),
    (err: unknown) => {
      kit = null
      throw err
    },
  )
  return kit
}

/** Starts fetching Motion once the page has settled — so the first scroll or FAQ tap finds it there. */
export function usePreloadMotion(): void {
  useEffect(() => {
    if (reducedMotion()) return
    // A timer, not an idle callback or an animation frame, which a tab nobody is looking at may
    // never run (CLAUDE.md) — and nothing waits on this anyway.
    const timer = window.setTimeout(() => void loadMotion().catch(() => {}), 1500)
    return () => window.clearTimeout(timer)
  }, [])
}

/** How long a group waits for Motion before it simply appears. */
const MOTION_WAIT_MS = 400

/** The entrance curve the site's tokens use (`--ease-out`): fast, then settle. */
const EASE_OUT = [0.16, 1, 0.3, 1] as const

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timed out')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        window.clearTimeout(timer)
        reject(err)
      },
    )
  })
}

// ---------------------------------------------------------------------------------------------
// The hero's depth
// ---------------------------------------------------------------------------------------------

/**
 * The hero's figure, tilted towards the pointer: at most 4°, with the quote card drifting the
 * other way, both on springs so the movement settles rather than stops. A mouse only — a phone has
 * no hover, and a tilt that follows a finger fights the scroll — and never under reduced motion.
 * `transform` alone, which the browser animates without laying the page out again.
 */
export function useHeroDepth() {
  const stage = useRef<HTMLElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const quote = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = stage.current
    if (!root || typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches || reducedMotion()) return

    let detach = () => {}
    let cancelled = false
    void loadMotion()
      .then(({ animate }) => {
        if (cancelled) return
        const spring = { type: 'spring', stiffness: 140, damping: 20, mass: 0.7 } as const
        let target = { x: 0, y: 0 }
        let box = root.getBoundingClientRect()
        let frame = 0

        const settle = () => {
          frame = 0
          const { x, y } = target
          if (card.current) {
            animate(card.current, { transform: `perspective(1200px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 4).toFixed(2)}deg)` }, spring)
          }
          if (quote.current) {
            animate(quote.current, { transform: `translate3d(${(-x * 12).toFixed(1)}px, ${(-y * 8).toFixed(1)}px, 0)` }, spring)
          }
        }
        const schedule = () => {
          if (!frame) frame = window.requestAnimationFrame(settle)
        }
        const onMove = (event: PointerEvent) => {
          if (event.pointerType !== 'mouse') return
          target = {
            x: Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width - 0.5) * 2)),
            y: Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height - 0.5) * 2)),
          }
          schedule()
        }
        const onLeave = () => {
          target = { x: 0, y: 0 }
          schedule()
        }
        const measure = () => {
          box = root.getBoundingClientRect()
        }

        root.addEventListener('pointerenter', measure)
        root.addEventListener('pointermove', onMove)
        root.addEventListener('pointerleave', onLeave)
        window.addEventListener('resize', measure)
        detach = () => {
          root.removeEventListener('pointerenter', measure)
          root.removeEventListener('pointermove', onMove)
          root.removeEventListener('pointerleave', onLeave)
          window.removeEventListener('resize', measure)
          if (frame) window.cancelAnimationFrame(frame)
        }
      })
      .catch(() => {
        // No Motion, no tilt: the figure simply stays still.
      })

    return () => {
      cancelled = true
      detach()
    }
  }, [])

  return { stage, layers: { card, quote } }
}

// ---------------------------------------------------------------------------------------------
// A group rising into place
// ---------------------------------------------------------------------------------------------

/** Every group still waiting, so a printed page shows them all. */
const waiting = new Set<() => void>()
let printListening = false

function showAllForPrint() {
  for (const show of [...waiting]) show()
}

/**
 * A group of cards that rises into place, one after another, the first time it is scrolled to.
 *
 * Returns a **callback ref** for the group's container — so a section that draws its group only
 * once its data has arrived is still caught when it does. Its children (or what `selector` picks;
 * `null` for the container itself) are the items. Hidden only after the observer has reported the
 * whole group off screen, and shown again when any of it comes into view, when a control in it takes
 * the focus, before printing — or, should Motion not arrive in time, at once.
 */
export function useReveal<T extends HTMLElement>({
  selector = ':scope > *' as string | null,
  rise = 28,
  gap = 0.08,
}: { selector?: string | null; rise?: number; gap?: number } = {}) {
  return useCallback((root: T | null) => (root ? attachReveal(root, selector, rise, gap) : undefined), [selector, rise, gap])
}

function attachReveal(root: HTMLElement, selector: string | null, rise: number, gap: number): (() => void) | undefined {
  if (typeof IntersectionObserver === 'undefined' || reducedMotion()) return undefined
  const items = selector === null ? [root] : [...root.querySelectorAll<HTMLElement>(selector)]
  if (items.length === 0) return undefined

  let hidden = false
  let finished = false

  const clear = () => {
    for (const item of items) {
      item.style.removeProperty('opacity')
      item.style.removeProperty('transform')
    }
  }
  const stop = () => {
    finished = true
    observer.disconnect()
    root.removeEventListener('focusin', showNow)
    waiting.delete(showNow)
  }
  function show(animate: boolean) {
    if (finished) return
    stop()
    if (!hidden) return
    if (!animate) {
      clear()
      return
    }
    withTimeout(loadMotion(), MOTION_WAIT_MS)
      .then((motion) => {
        motion
          .animate(
            items,
            { opacity: [0, 1], transform: [`translateY(${rise}px)`, 'translateY(0px)'] },
            { duration: 0.8, ease: EASE_OUT, delay: motion.stagger(gap) },
          )
          .then(clear, clear)
      })
      .catch(clear)
  }
  function showNow() {
    show(false)
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1]
      if (!entry || finished) return
      if (entry.isIntersecting) {
        show(true)
      } else if (!hidden) {
        // Entirely off screen, so nobody sees this: lowered and transparent until scrolled to.
        hidden = true
        for (const item of items) {
          item.style.opacity = '0'
          item.style.transform = `translateY(${rise}px)`
        }
        void loadMotion().catch(() => {})
      }
    },
    { threshold: 0 },
  )
  observer.observe(root)
  root.addEventListener('focusin', showNow)
  waiting.add(showNow)
  if (!printListening) {
    printListening = true
    window.addEventListener('beforeprint', showAllForPrint)
  }

  return () => {
    stop()
    clear()
  }
}

// ---------------------------------------------------------------------------------------------
// The FAQ, opening smoothly
// ---------------------------------------------------------------------------------------------

/**
 * A `<summary>`'s click, made smooth: the answer's height and opacity animate instead of jumping.
 *
 * Only once Motion is here and motion is allowed — until then the click is left alone and the
 * `<details>` opens as it always has, which is also what the drawn page does before the app takes
 * over. The answer is the summary's next sibling.
 */
export function smoothToggle(event: MouseEvent<HTMLElement>): void {
  const summary = event.currentTarget
  const details = summary.parentElement
  const body = summary.nextElementSibling
  if (!ready || reducedMotion() || !(details instanceof HTMLDetailsElement) || !(body instanceof HTMLElement)) return
  if (details.dataset.moving === 'true') {
    event.preventDefault()
    return
  }
  event.preventDefault()
  const { animate } = ready
  details.dataset.moving = 'true'
  const done = () => {
    body.style.removeProperty('height')
    body.style.removeProperty('opacity')
    body.style.removeProperty('overflow')
    delete details.dataset.moving
    delete details.dataset.closing
  }

  body.style.overflow = 'hidden'
  if (details.open) {
    // The caret turns back now, not when the answer has finished closing.
    details.dataset.closing = 'true'
    animate(body, { height: [`${body.offsetHeight}px`, '0px'], opacity: [1, 0] }, { duration: 0.28, ease: EASE_OUT }).then(
      () => {
        details.open = false
        done()
      },
      done,
    )
  } else {
    details.open = true
    const height = body.scrollHeight
    animate(body, { height: ['0px', `${height}px`], opacity: [0, 1] }, { duration: 0.36, ease: EASE_OUT }).then(done, done)
  }
}
