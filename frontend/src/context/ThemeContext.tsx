import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Light/dark theming for the whole app.
 *
 * ## Why this exists
 *
 * The app used to be half-and-half: the public pages were light, while the dashboard,
 * the admin area and the exam hardcoded a `theme-dark` class on their own shell. So
 * signing in changed the colour scheme under you, and the Admin sign-in form was dark
 * while the navbar above it was light. That inconsistency is what this replaces.
 *
 * ## How it works
 *
 * The theme is applied **once, to `document.documentElement`**, rather than per page.
 * That is the whole point: every page inherits it, so a new page cannot forget to
 * opt in, and no page can disagree with another. `theme.css` defines the light
 * variables on `:root` and overrides them under `.theme-dark`.
 *
 * ## Default: the operating system (changed 2026-09-21)
 *
 * A first-time visitor gets **whatever their device asks for** via
 * `prefers-color-scheme`, and an explicit choice is remembered from then on.
 *
 * This **reverses** the earlier decision, which was a hardcoded light default that
 * deliberately ignored the OS — the reasoning being that two students seeing different
 * colours makes screenshots and support requests harder to reason about. The owner
 * asked for OS-following instead, having hit exactly the confusing case the old rule
 * produced: a device set to dark, a site that stayed light, and no indication that a
 * dark theme existed at all. The support argument is weaker than it looked, because a
 * user who toggles already creates that divergence.
 *
 * Precedence, and the order matters:
 *   1. an explicit choice in `localStorage` — always wins, forever
 *   2. otherwise `prefers-color-scheme`
 *   3. otherwise light
 *
 * The OS is also followed **live** while no explicit choice exists, so flipping the
 * system theme flips the app. That listener is an enhancement and nothing depends on
 * it: a `MediaQueryList` change event does not fire in a tab that is not compositing,
 * which is fine here because the theme is already correct at load and only a *later*
 * OS change would be missed.
 */

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'amit-theme'
export const DEFAULT_THEME: Theme = 'light'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

const OS_DARK = '(prefers-color-scheme: dark)'

/**
 * What the device is asking for, or the default if it will not say.
 *
 * `matchMedia` is guarded because a browser that does not implement it should get a
 * theme rather than a crash.
 */
function readSystemTheme(): Theme {
  try {
    return window.matchMedia(OS_DARK).matches ? 'dark' : 'light'
  } catch {
    return DEFAULT_THEME
  }
}

/** An explicit choice, or `null` if the reader has never made one. */
function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    // `localStorage` throws rather than returning null in a few real situations —
    // Safari private browsing historically, and any browser with site data blocked.
    // A colour scheme is not worth crashing the app for; fall through to the OS.
    return null
  }
}

/** The stored choice if there is one, otherwise the operating system's. */
function resolveInitialTheme(): Theme {
  return readStoredTheme() ?? readSystemTheme()
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme)

  /**
   * Follow the OS while the reader has not chosen for themselves.
   *
   * The stored value is re-read inside the handler rather than captured, so the
   * listener does not need re-binding when somebody toggles — and so a choice made in
   * another tab is respected here too.
   */
  useEffect(() => {
    let query: MediaQueryList
    try {
      query = window.matchMedia(OS_DARK)
    } catch {
      return
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (readStoredTheme()) return
      setThemeState(event.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Applied to the document element so it covers every page, portal and overlay —
  // including anything rendered outside the React root.
  //
  // A change after the first render is applied after the next paint (Milestone 30, Phase 6).
  // Recolouring restyles every element on the page — 400 ms on a slow phone's homepage — and
  // React runs this effect before a click's next frame, so the switch itself did not visibly
  // move until all of that was done (Interaction to Next Paint, brief §10: ≤ 200 ms). Now the
  // switch flips at once and the page follows a moment later. The timer is there because a
  // tab that is not being drawn never runs a frame (CLAUDE.md), and the theme must arrive.
  const appliedOnce = useRef(false)
  useEffect(() => {
    const apply = () => {
      const root = document.documentElement
      root.classList.toggle('theme-dark', theme === 'dark')
      // Tells the browser to match its own furniture (form controls, scrollbars) to the
      // theme. Without it, a dark page gets light native scrollbars.
      root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
    }
    if (!appliedOnce.current) {
      appliedOnce.current = true
      apply()
      return
    }
    let done = false
    const once = () => {
      if (done) return
      done = true
      apply()
    }
    let afterPaint = 0
    const frame = requestAnimationFrame(() => {
      afterPaint = window.setTimeout(once, 0)
    })
    const fallback = window.setTimeout(once, 250)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(afterPaint)
      window.clearTimeout(fallback)
    }
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // A blocked storage write costs the preference on the next visit, nothing more.
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* see above */
      }
      return next
    })
  }, [])

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider')
  return context
}
