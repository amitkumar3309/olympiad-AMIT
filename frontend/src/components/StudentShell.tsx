import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import AppShell from './layout/AppShell'
import { STUDENT_BOTTOM_NAV, STUDENT_NAV } from './layout/navigation'
import Navbar from './Navbar'
import Footer from './Footer'

/**
 * Chrome for every page in the signed-in student area.
 *
 * Since Milestone 23 Phase B this is a thin wrapper: the layout lives in
 * `layout/AppShell` (shared with the admin area) and the navigation in
 * `layout/navigation.ts`. What stays here is what only the student area knows — the
 * unread-notification count, whether the entry fee is paid, and the guest fallback.
 *
 * ## Guests
 *
 * Two of these routes (`/certificate`, and `/result` via the navbar) are public. A
 * signed-out visitor has no student area to be inside, so for them this falls back to
 * the public `Navbar` + `Footer` layout rather than showing a menu full of links that
 * would bounce them to a sign-in screen.
 */

interface StudentShellProps {
  /** Heading for the page, shown in the shell's topbar. */
  title: ReactNode
  /** Optional line under the heading — student ID, class, a short summary. */
  subtitle?: ReactNode
  /** Page-level actions, beside the title. */
  actions?: ReactNode
  /**
   * A timed paper. Drops the mobile bottom bar, which otherwise sits exactly where
   * the answer buttons are; the menu stays reachable from the burger at every width.
   */
  focus?: boolean
  children: ReactNode
}

export default function StudentShell({ title, subtitle, actions, focus, children }: StudentShellProps) {
  const { state, hasPaid } = useAuth()
  const { pathname } = useLocation()
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

  // Only an actual student account gets the shell. A promoted admin is still a
  // student and keeps it (they have a student record and their own progress); the
  // root admin, which has no student record at all, does not.
  if (state.status !== 'student') {
    return (
      <>
        <Navbar />
        <main id="main-content" className="container">
          {children}
        </main>
        <Footer />
      </>
    )
  }

  return (
    <AppShell
      variant="student"
      groups={STUDENT_NAV}
      bottomNav={STUDENT_BOTTOM_NAV}
      brand={{ label: 'A.M.I.T Hub', to: '/dashboard' }}
      title={title}
      subtitle={subtitle}
      actions={actions}
      unread={unread}
      hasPaid={hasPaid}
      focus={focus}
    >
      {children}
    </AppShell>
  )
}
