import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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
 * ## Default
 *
 * **Light**, by the project owner's decision — deliberately *not*
 * `prefers-color-scheme`. Following the OS would mean two students being shown
 * different colours with no way to reason about screenshots or support requests, and
 * the owner asked for light as the baseline with the choice left to the user.
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

/**
 * The stored preference, or the default.
 *
 * Wrapped in try/catch because `localStorage` throws rather than returning null in a
 * few real situations — Safari private browsing historically, and any browser with
 * site data blocked. A colour scheme is not worth crashing the app for.
 */
function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  // Applied to the document element so it covers every page, portal and overlay —
  // including anything rendered outside the React root.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('theme-dark', theme === 'dark')
    // Tells the browser to match its own furniture (form controls, scrollbars) to the
    // theme. Without it, a dark page gets light native scrollbars.
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
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
