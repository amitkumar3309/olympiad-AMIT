import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import logoMark from '../assets/logo-mark.webp'
import { AMIT_FULL_FORM, AMIT_OLYMPIAD, AMIT_TAGLINE, FOUNDER } from '../lib/brand'
import { SIDEBAR_MOTTO } from '../lib/siteConfig'
import AppShell from './layout/AppShell'
import AccountMenu from './layout/AccountMenu'
import NotificationBell from './layout/NotificationBell'
import { STUDENT_BOTTOM_NAV, STUDENT_NAV, STUDENT_TOP_NAV } from './layout/navigation'
import { Section } from './ui'
import Illustration from './Illustration'
import Navbar from './Navbar'
import Footer from './Footer'
import ThemeToggle from './ThemeToggle'
import DiwaliIntroPlayer from './DiwaliIntroPlayer'
import styles from './StudentShell.module.css'

/**
 * Chrome for every page in the signed-in student area.
 *
 * Since Milestone 23 Phase B this is a thin wrapper: the layout lives in
 * `layout/AppShell` (shared with the admin area) and the navigation in
 * `layout/navigation.ts`. What stays here is what only the student area knows — the
 * unread-notification count, whether the entry fee is paid, and the guest fallback —
 * and, since Milestone 30 Phase 4, what the launch mockup puts in the student chrome: the
 * lockup, the top bar's links, the bell with its menu, the profile chip and the
 * motivational card at the foot of the sidebar.
 *
 * ## Guests
 *
 * Some of these routes (`/result`, the public boards) are public. A
 * signed-out visitor has no student area to be inside, so for them this falls back to
 * the public `Navbar` + `Footer` layout rather than showing a menu full of links that
 * would bounce them to a sign-in screen.
 */

interface StudentShellProps {
  /** Heading for the page — the `h1`, above the page's content. */
  title: ReactNode
  /** Optional line under the heading — student ID, class, a short summary. */
  subtitle?: ReactNode
  /** Page-level actions, beside the title. */
  actions?: ReactNode
  /**
   * The page draws its own `h1` (the dashboard's welcome banner). `title` is then only
   * the guest fallback's heading.
   */
  headless?: boolean
  /**
   * A timed paper. Drops the mobile bottom bar, which otherwise sits exactly where
   * the answer buttons are; the menu stays reachable from the burger at every width.
   */
  focus?: boolean
  children: ReactNode
}

/**
 * The unread count outlives one page's shell: each route renders its own `StudentShell`, so
 * the last answer and when it was asked are kept here, or the badge would read 0 on every
 * page the once-a-minute check skips.
 */
const UNREAD_REFRESH_MS = 60_000
let unreadCheckedAt = 0
let lastUnread = 0
/** Whose count `lastUnread` is — another account signing in on this tab starts afresh. */
let unreadFor: string | null = null

export default function StudentShell({ title, subtitle, actions, headless, focus, children }: StudentShellProps) {
  const { state, hasPaid } = useAuth()
  const { pathname } = useLocation()
  const me = state.status === 'student' ? state.student.studentId : null
  const [unread, setUnread] = useState(me !== null && me === unreadFor ? lastUnread : 0)

  /**
   * The unread badge (Milestone 14).
   *
   * Fetched here rather than on the Notifications page, because the whole point of a
   * badge is to be visible from everywhere *except* that page. Before this, a system
   * notification could sit unread indefinitely — the menu item gave no sign that
   * anything had arrived, so a student had to think to go and look, which is not a
   * property you can rely on for "your results are out".
   *
   * Re-read on navigation (`pathname` is a dependency) rather than polled on a timer — but
   * **at most once a minute** (2026-10-10): it was three database operations on every page
   * change, the most frequent signed-in request, for a badge that changes a few times a week.
   * A timer would keep firing on an idle open tab for no benefit.
   * A failure is swallowed — a missing badge must never break the page around it.
   */
  const refreshUnread = useCallback((isCancelled: () => boolean = () => false) => {
    void api
      .get<{ unread: number }>('/me/notifications/unread-count')
      .then((res) => {
        lastUnread = res.unread
        if (!isCancelled()) setUnread(res.unread)
      })
      .catch(() => {
        /* A badge is not worth an error state. */
      })
  }, [])

  useEffect(() => {
    if (me === null) return
    if (me === unreadFor && Date.now() - unreadCheckedAt < UNREAD_REFRESH_MS) return
    if (me !== unreadFor) lastUnread = 0
    unreadFor = me
    unreadCheckedAt = Date.now()
    let cancelled = false
    refreshUnread(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [me, pathname, refreshUnread])

  // Only an actual student account gets the shell. A promoted admin is still a
  // student and keeps it (they have a student record and their own progress); the
  // root admin, which has no student record at all, does not.
  if (state.status !== 'student') {
    return (
      <>
        <Navbar />
        <main id="main-content" className="container">
          {/*
            **The guest fallback renders the title too** (Milestone 26).

            It did not, and that was a real defect rather than a cosmetic one: four
            public routes came through this branch — `/leaderboard`, `/hall-of-fame`,
            `/result` and the old `/certificate` — and for a signed-out visitor every one of
            them opened at `h2` with **no `h1` anywhere in the document**. A screen
            reader user landing on the public leaderboard had nothing naming the page.

            The signed-in branch never had the problem because `AppShell` puts the
            `h1` above the page; this branch simply dropped `title` and `subtitle` on
            the floor. `size="page"` matches the shell's own heading treatment, so a
            page looks the same either side of signing in.

            `as="div"`: the heading names the *page*, and the content below it is not
            a region of its own — an `aria-labelledby` here would announce a landmark
            that wraps nothing.
          */}
          <Section as="div" titleAs="h1" size="page" spacing="block" title={title} lead={subtitle} />
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
      topNav={STUDENT_TOP_NAV}
      brand={{
        label: AMIT_OLYMPIAD,
        to: '/dashboard',
        logo: logoMark,
        tagline: AMIT_TAGLINE,
        // The expansion on the link's title, as the public navbar carries it (CLAUDE.md).
        title: `${AMIT_OLYMPIAD} — ${AMIT_FULL_FORM}`,
      }}
      headerEnd={
        <>
          {/* In the drawer below 768px, where the top bar has no room for it. */}
          <span className={styles.theme}>
            <ThemeToggle compact />
          </span>
          <NotificationBell unread={unread} onChange={() => refreshUnread()} />
          <AccountMenu student={state.student} />
        </>
      }
      sidebarFooter={
        <aside className={styles.motto} aria-label="Motto">
          <p className={styles.mottoText}>{SIDEBAR_MOTTO}</p>
          <p className={styles.mottoSign}>— {FOUNDER}</p>
          <Illustration name="mountain-climber" className={styles.mottoArt} />
        </aside>
      }
      title={title}
      subtitle={subtitle}
      actions={actions}
      headless={headless}
      unread={unread}
      hasPaid={hasPaid}
      focus={focus}
    >
      {/* The Diwali intro, once that week, for a student who has not seen it — never over a
          timed paper. A portal: where it sits here does not matter. */}
      {!focus && <DiwaliIntroPlayer />}
      {children}
    </AppShell>
  )
}
