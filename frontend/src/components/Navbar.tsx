import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, ButtonLink, Icon } from './ui'
import { lockScroll, unlockScroll } from './ui/scrollLock'
import ThemeToggle from './ThemeToggle'
import logo from '../assets/logo.png'
import { AMIT_FULL_FORM, AMIT_SHORT } from '../lib/brand'
import styles from './Navbar.module.css'

/**
 * The public header, on every page a signed-out visitor can reach.
 *
 * ## What changed in Milestone 23, Phase B
 *
 * It carried eight links in one row, which on a phone became a full-width dropdown
 * with no way to close it except the burger, and on a desktop gave equal weight to
 * "Gallery" and "Verify Certificate" — and to **Admin**, which a marketing page was
 * advertising to every visitor.
 *
 * Now: four public destinations, a theme toggle, and one call to action. The two
 * certificate/result *lookups* moved to the footer, which is where a utility belongs;
 * the admin door moved there too, so it is still one click from anywhere without being
 * the loudest thing in the header. Nothing became unreachable.
 *
 * **A signed-out visitor now has a Sign in button**, which they did not before — the
 * login form is a panel on the landing page, and there was no way to ask for it from
 * anywhere else. It links to `/#login`, which the landing page opens on arrival.
 *
 * The mobile panel is a real disclosure: Escape closes it, a press outside closes it,
 * changing route closes it, focus moves into it and returns to the burger, and it is
 * removed from the tab order while shut.
 */

interface PublicLink {
  to: string
  label: string
}

/** The four public destinations. Kept short deliberately — see the note above. */
const PUBLIC_LINKS: PublicLink[] = [
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/hall-of-fame', label: 'Hall of Fame' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/verify', label: 'Verify a certificate' },
]

export default function Navbar() {
  const { state, can, logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const burgerRef = useRef<HTMLButtonElement>(null)

  const signedIn = state.status === 'student' || state.status === 'admin'
  const isStaff = can('students:read')

  /* Route change closes the panel — including a browser back. */
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    lockScroll()
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus()
    // Captured now rather than read in the cleanup: the button is the same element
    // across renders, but reading a ref during cleanup is the pattern that goes wrong
    // when it is not, and the linter is right to say so.
    const burger = burgerRef.current

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      unlockScroll()
      burger?.focus()
    }
  }, [open])

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  const links = (
    <>
      {PUBLIC_LINKS.map((link) => {
        const current = pathname === link.to || pathname.startsWith(`${link.to}/`)
        return (
          <Link
            key={link.to}
            to={link.to}
            className={current ? styles.linkActive : styles.link}
            aria-current={current ? 'page' : undefined}
          >
            {link.label}
          </Link>
        )
      })}
    </>
  )

  /*
    Both are shown to a promoted admin, deliberately: they hold `students:read` *and*
    have a student record with their own progress, so "which one did they mean?" has no
    single answer. The root administrator has no student record and gets Admin alone.
  */
  const account = signedIn ? (
    <>
      {isStaff && (
        <ButtonLink to="/admin" variant="outline" size="sm" icon="ph-shield-check">
          Admin
        </ButtonLink>
      )}
      {state.status === 'student' && (
        <ButtonLink to="/dashboard" size="sm" icon="ph-squares-four">
          Dashboard
        </ButtonLink>
      )}
      <Button variant="ghost" size="sm" icon="ph-sign-out" onClick={() => void handleLogout()}>
        Sign out
      </Button>
    </>
  ) : (
    <>
      <ButtonLink to="/#login" variant="outline" size="sm" icon="ph-sign-in">
        Sign in
      </ButtonLink>
      <ButtonLink to="/#register" size="sm">
        Register
      </ButtonLink>
    </>
  )

  return (
    <header className={styles.nav}>
      <div className={`container ${styles.inner}`}>
        {/*
          The wordmark stays four letters (Milestone 22, Phase D). The expansion belongs
          where a visitor is asking what the letters mean — the hero — not in the top bar
          of every page, where it would be repeated past the point of being read.

          It is carried on the image's `alt` and the link's `title` instead, so it is
          still reachable by a screen reader, a search engine and a hover, at no cost to
          the layout.
        */}
        <Link
          to="/"
          className={styles.brand}
          title={`${AMIT_SHORT} Olympiad — ${AMIT_FULL_FORM}`}
          onClick={() => setOpen(false)}
        >
          <img src={logo} alt={`${AMIT_SHORT} Olympiad — ${AMIT_FULL_FORM}`} />
          <span>A.M.I.T. OLYMPIAD</span>
        </Link>

        <nav className={styles.desktopNav} aria-label="Primary">
          {links}
        </nav>

        <div className={styles.desktopActions}>
          <ThemeToggle compact />
          {account}
        </div>

        <div className={styles.mobileActions}>
          <ThemeToggle compact />
          <button
            ref={burgerRef}
            type="button"
            className={styles.burger}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            // Only while the panel exists. It is mounted on demand, so naming it when
            // it is closed is an IDREF pointing at nothing — the same defect `Tabs`
            // had, found on this page by the Phase C sweep.
            aria-controls={open ? 'public-nav-panel' : undefined}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name={open ? 'ph-x' : 'ph-list'} weight="bold" size="md" />
          </button>
        </div>
      </div>

      {/*
        Mounted only while open, rather than hidden with CSS. Two reasons: a hidden
        copy of the same links is a second `Primary` navigation landmark that a screen
        reader lists on every page, and a panel that merely slides off-screen keeps its
        links in the tab order. The desktop nav above is `display: none` on a phone,
        which does remove it from both.
      */}
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={panelRef} id="public-nav-panel" className={styles.panel}>
            <nav className={styles.panelNav} aria-label="Primary">
              {links}
            </nav>
            <div className={styles.panelActions}>{account}</div>
          </div>
        </>
      )}
    </header>
  )
}
