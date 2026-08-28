import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Navbar from './Navbar'
import Footer from './Footer'
import ThemeToggle from './ThemeToggle'
import styles from './StudentShell.module.css'

/**
 * Chrome shared by every page in the signed-in student area, and the one place the
 * student navigation is defined.
 *
 * ## Why this exists
 *
 * The `A.M.I.T Hub` sidebar used to be built inside `Dashboard.tsx`, and *only*
 * there. Every link in it pointed at a page that rendered the public top-navbar
 * layout instead — so pressing any item in the menu made the menu itself vanish,
 * and the student had no way back except the browser's back button. That is the bug
 * this component fixes: the shell now wraps each destination, so the sidebar is
 * always present and the current page is always highlighted.
 *
 * It mirrors `pages/Admin/AdminShell.tsx` deliberately: same structure, same mobile
 * drawer behaviour, same footer with a theme toggle and sign-out.
 *
 * ## Guests
 *
 * Two of these routes (`/certificate`, and `/result` via the navbar) are public. A
 * signed-out visitor has no student area to be inside, so for them the shell falls
 * back to the ordinary `Navbar` + `Footer` layout rather than showing a sidebar full
 * of links that would bounce them to a sign-in screen.
 */

interface NavItem {
  to: string
  label: string
  icon: string
  /**
   * Needs a paid entry fee, and shows a padlock until it is. Only the official
   * Olympiad qualifies: practice, mock tests and the daily challenge are free.
   */
  paid?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'ph-squares-four' },
  { to: '/profile', label: 'My Profile', icon: 'ph-user-circle' },
  { to: '/practice', label: 'Practice Zone', icon: 'ph-target' },
  { to: '/mock-tests', label: 'Mock Tests', icon: 'ph-exam' },
  { to: '/daily-challenge', label: 'Daily Challenge', icon: 'ph-dice-five' },
  { to: '/rewards', label: 'Rewards', icon: 'ph-trophy' },
  { to: '/referrals', label: 'Refer & Earn', icon: 'ph-users-three' },
  { to: '/payment', label: 'Entry fee', icon: 'ph-currency-inr' },
  { to: '/notifications', label: 'Notifications', icon: 'ph-bell' },
  { to: '/leaderboard', label: 'Leaderboard', icon: 'ph-ranking' },
  { to: '/hall-of-fame', label: 'Hall of Fame', icon: 'ph-crown' },
  { to: '/analytics', label: 'Analytics', icon: 'ph-chart-line-up' },
  { to: '/report', label: 'Report', icon: 'ph-file-text' },
  { to: '/result', label: 'Result', icon: 'ph-seal-check' },
  { to: '/my-certificates', label: 'Certificates', icon: 'ph-medal' },
]

interface StudentShellProps {
  /** Heading for the page, shown in the shell's topbar. */
  title: ReactNode
  /** Optional line under the heading — student ID, class, a short summary. */
  subtitle?: ReactNode
  children: ReactNode
}

export default function StudentShell({ title, subtitle, children }: StudentShellProps) {
  const { state, logout, hasPaid } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  /**
   * The unread badge (Milestone 14).
   *
   * Fetched here rather than on the Notifications page, because the whole point of a
   * badge is to be visible from everywhere *except* that page. Before this, a system
   * notification could sit unread indefinitely — the menu item gave no sign that
   * anything had arrived, so a student had to think to go and look, which is not a
   * property you can rely on for "your results are out".
   *
   * Re-read on navigation (`pathname` is a dependency) rather than polled on a timer:
   * it is one indexed count, a student changes page far less often than any sensible
   * poll interval, and a timer would keep firing on an idle open tab for no benefit.
   * A failure is swallowed — a missing badge must never break the page around it.
   */
  useEffect(() => {
    if (state.status !== 'student') return
    let cancelled = false

    void api
      .get<{ unread: number }>('/me/notifications/unread-count')
      .then((res) => {
        if (!cancelled) setUnread(res.unread)
      })
      .catch(() => {
        /* A badge is not worth an error state. */
      })

    return () => {
      cancelled = true
    }
  }, [state.status, pathname])

  // Only an actual student account gets the sidebar. A promoted admin is still a
  // student and keeps it (they have a student record and their own progress);
  // the root admin, which has no student record at all, does not.
  if (state.status !== 'student') {
    return (
      <>
        <Navbar />
        <main className="container">{children}</main>
        <Footer />
      </>
    )
  }

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <div className={styles.shell}>
      {/* Tapping outside the open drawer closes it — expected on mobile, and
          otherwise the only way out is to find the burger again. */}
      {sidebarOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <Link to="/dashboard" className={styles.brand} onClick={() => setSidebarOpen(false)}>
          A.M.I.T Hub
        </Link>
        <nav>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              // Highlighting the current route is what makes the persistent sidebar
              // useful rather than merely present.
              className={pathname === item.to ? styles.menuItemActive : styles.menuItem}
              aria-current={pathname === item.to ? 'page' : undefined}
              onClick={() => setSidebarOpen(false)}
            >
              <i className={`ph-bold ${item.icon}`} /> {item.label}
              {item.paid && !hasPaid && (
                <i className={`ph-bold ph-lock-simple ${styles.lock}`} aria-label="Entry fee required" />
              )}
              {item.to === '/notifications' && unread > 0 && (
                // Capped display, so a long absence cannot stretch the menu item.
                <span className={styles.badge} aria-label={`${unread} unread`}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <ThemeToggle />
          <button type="button" className={styles.logoutBtn} onClick={() => void handleLogout()}>
            <i className="ph-bold ph-sign-out" /> Logout
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.burger} onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle menu">
            <i className="ph ph-list" />
          </button>
          <div>
            <h1>{title}</h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}
