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
 * opt in, and no page can disagree with another.
 *
 * ## Dark is the default, and it is the *absence* of a class
 *
 * `tokens.css` defines the **dark** variables on `:root` and overrides them under
 * **`.theme-light`** — the inverse of the arrangement before Milestone 26. That is
 * not a stylistic preference about which block goes where: a class applied by React
 * cannot be on the element for the first paint, so with dark on a class every cold
 * load would flash white before the effect ran. With dark on `:root` the default
 * theme needs no class at all.
 *
 * The minority who choose light are served by `applyStoredTheme()`, which is called
 * from `main.tsx` **before** `createRoot` — module evaluation happens before the
 * first paint, so the class is present in time. Doing it in an effect would flash
 * dark for them, which is the same defect in the other direction.
 *
 * ## Default
 *
 * **Dark**, by the project owner's decision on 2026-09-20, taken together with the
 * move to the lime accent. Deliberately *not* `prefers-color-scheme`: following the
 * OS would mean two students being shown different colours with no way to reason
 * about screenshots or support requests. Light remains a real, supported theme and
 * the toggle keeps working; it is the baseline that changed, not the choice.
 */

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'amit-theme'
export const DEFAULT_THEME: Theme = 'dark'

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

/**
 * Puts the theme on the document element.
 *
 * `theme-light` is the class, because dark lives on `:root` — see the header. The
 * `colorScheme` line tells the browser to match its own furniture (form controls,
 * scrollbars, the overscroll gutter) to the theme; without it a dark page gets light
 * native scrollbars, which is the most obvious possible tell.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('theme-light', theme === 'light')
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark'
}

/**
 * Applies the stored theme **before React mounts**.
 *
 * Called from `main.tsx` at module scope. This is the only reason a visitor who
 * chose light does not see a dark flash on every cold load, and it is why it is
 * exported rather than kept private: an effect inside the provider runs after the
 * first paint, by which time the wrong colours have already been shown.
 *
 * Safe to call more than once, and safe to call before the provider exists — it
 * touches nothing but a class name.
 */
export function applyStoredTheme(): void {
  applyTheme(readStoredTheme())
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  // Applied to the document element so it covers every page, portal and overlay —
  // including anything rendered outside the React root. `applyStoredTheme()` has
  // normally already done this for the first render; this keeps it true on a change.
  useEffect(() => {
    applyTheme(theme)
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
