import { useTheme } from '../context/ThemeContext'
import { Icon } from './ui'
import styles from './ThemeToggle.module.css'

/**
 * The light/dark switch.
 *
 * One control, used in all three shells (public navbar, dashboard sidebar, admin
 * sidebar) so the affordance is in a predictable place wherever you are. It is a real
 * `<button>` with `aria-pressed`, not a styled checkbox, because its job is to perform
 * an action rather than to hold form state.
 *
 * The label names the theme it will switch **to**, which is the convention that reads
 * correctly for a screen reader ("Switch to dark mode") — a button labelled with the
 * current state is ambiguous about what pressing it does.
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useTheme()
  const goingDark = theme === 'light'
  const label = goingDark ? 'Switch to dark mode' : 'Switch to light mode'

  return (
    <button
      type="button"
      className={`${styles.toggle} ${compact ? styles.compact : ''}`}
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      aria-pressed={theme === 'dark'}
    >
      <Icon name={goingDark ? 'ph-moon' : 'ph-sun'} weight="bold" />
      {!compact && <span>{goingDark ? 'Dark' : 'Light'}</span>}
    </button>
  )
}
