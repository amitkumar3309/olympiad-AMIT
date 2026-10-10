import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Avatar, Button, ButtonLink, Icon, Menu, SkipLink, usePrefersReducedMotion } from './ui'
import { DiwaliGreeting, StringLights } from './Diwali'
import { lockScroll, unlockScroll } from './ui/scrollLock'
import ThemeToggle from './ThemeToggle'
import logoMark from '../assets/logo-mark.webp'
import { AMIT_FULL_FORM, AMIT_OLYMPIAD, AMIT_TAGLINE } from '../lib/brand'
import { isStaffRole } from '../lib/roleHome'
import styles from './Navbar.module.css'

/**
 * The public header, on every page a signed-out visitor can reach (redesigned for the
 * launch mockup in Milestone 30, Phase 3 — brief §7.1 #1).
 *
 * ## Six destinations, three of them on the homepage
 *
 * Home, About, How it works and FAQ are sections of the homepage; Leaderboards and
 * Gallery are pages. A section link is an ordinary link to `/#section` — from another
 * page it lands on the homepage at that section, and on the homepage it scrolls there
 * (`Landing` follows the hash). While the homepage is open the link for the section
 * being read is highlighted, so the bar doubles as a "you are here".
 *
 * Hall of Fame and Verify a certificate left the bar for the footer, where every other
 * lookup already lives; nothing became unreachable.
 *
 * ## No flash of the wrong account state
 *
 * Until the session check answers, the account area is an empty box of the right size —
 * not "Sign in", which a signed-in student would see flicker away. Signed in, an avatar
 * menu (Dashboard, My Profile, Sign out) replaces Sign in and Register; staff also get
 * Admin, which is navigation for somebody who holds the role, not a public door.
 *
 * ## It settles in when you scroll
 *
 * At the top of a page the bar is transparent over the hero. Once the page moves it
 * gains a frosted surface and a shadow, so content passing underneath stays legible.
 *
 * The mobile panel is a real disclosure: Escape closes it, a press outside closes it,
 * changing route closes it, focus moves into it and returns to the burger, and it is
 * removed from the tab order while shut.
 */

interface NavLink {
  to: string
  label: string
  /** The homepage section this link scrolls to, if it is one. */
  section?: SectionKey
}

type SectionKey = 'home' | 'about' | 'how-it-works' | 'faq'

const LINKS: NavLink[] = [
  { to: '/', label: 'Home', section: 'home' },
  { to: '/#about', label: 'About', section: 'about' },
  { to: '/#how-it-works', label: 'How it works', section: 'how-it-works' },
  { to: '/leaderboard', label: 'Leaderboards' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/#faq', label: 'FAQ', section: 'faq' },
]

/** The homepage sections the bar can point at, in page order. */
const SPY_SECTIONS: Exclude<SectionKey, 'home'>[] = ['about', 'how-it-works', 'faq']

/**
 * Which homepage section is being read: the one spanning a line a third of the way down
 * the window. Above the first it is Home; between the anchored sections (the journey, the
 * leaderboard) it is none — highlighting "How it works" while somebody reads Top Scholars
 * would be a wrong "you are here".
 */
function sectionInView(): SectionKey | null {
  const line = window.innerHeight * 0.35
  const first = document.getElementById(SPY_SECTIONS[0]!)
  if (!first || first.getBoundingClientRect().top > line) return 'home'
  for (const id of SPY_SECTIONS) {
    const rect = document.getElementById(id)?.getBoundingClientRect()
    if (rect && rect.top <= line && rect.bottom > line) return id
  }
  return null
}

export default function Navbar() {
  const { state, can, logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const reducedMotion = usePrefersReducedMotion()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [section, setSection] = useState<SectionKey | null>('home')
  const panelRef = useRef<HTMLDivElement>(null)
  const burgerRef = useRef<HTMLButtonElement>(null)

  const onHome = pathname === '/'
  const signedIn = state.status === 'student' || state.status === 'admin'
  const isStaff = can('students:read')

  /* Route change closes the panel — including a browser back. */
  useEffect(() => setOpen(false), [pathname])

  /* The frosted bar once the page has moved, and — on the homepage — the section in view. */
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8)
      if (onHome) setSection(sectionInView())
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [onHome])

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

  /** "Home" on the homepage scrolls back to the top rather than doing nothing. */
  function onHomeClick(event: MouseEvent<HTMLAnchorElement>) {
    setOpen(false)
    if (!onHome) return
    event.preventDefault()
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })
    navigate('/', { replace: true })
  }

  function isCurrent(link: NavLink): boolean {
    if (link.section) return onHome && section === link.section
    return pathname === link.to || pathname.startsWith(`${link.to}/`)
  }

  const links = LINKS.map((link) => {
    const current = isCurrent(link)
    return (
      <Link
        key={link.to}
        to={link.to}
        className={current ? styles.linkActive : styles.link}
        // A section is a location on this page; a route is a page.
        aria-current={current ? (link.section ? 'location' : 'page') : undefined}
        onClick={link.section === 'home' ? onHomeClick : () => setOpen(false)}
      >
        {link.label}
      </Link>
    )
  })

  const firstName = state.status === 'student' ? state.student.firstName : null
  // Staff have no student area (owner, 2026-10-10): the admin panel and Sign out, nothing else.
  const studentMenu = state.status === 'student' && !isStaffRole(state.role)

  /*
    Signed in: a student gets the avatar menu (Dashboard, My Profile, Sign out). Staff — a
    promoted admin or the super admin, both student records with a role — get Admin and Sign
    out only: no dashboard or profile of their own (owner, 2026-10-10).
  */
  const account =
    state.status === 'loading' ? (
      <span className={styles.accountPending} aria-hidden="true" />
    ) : signedIn ? (
      <>
        {isStaff && (
          <ButtonLink to="/admin" variant="secondary" size="sm" icon="ph-shield-check">
            Admin
          </ButtonLink>
        )}
        {studentMenu && state.status === 'student' ? (
          <Menu
            label={`Account menu for ${firstName}`}
            align="end"
            trigger={
              <>
                <Avatar
                  name={state.student.fullName || firstName || 'Student'}
                  // Their own photo — other students only ever get initials — and only
                  // when the session says one exists, so a missing one is not a 404.
                  src={state.student.hasPhoto ? `/api/v1/students/${state.student.studentId}/photo` : null}
                  size="sm"
                  decorative
                />
                <span className={styles.accountName}>{firstName}</span>
                <ChevronDown size={16} strokeWidth={2.25} aria-hidden="true" />
              </>
            }
            items={[
              { label: 'Dashboard', icon: 'ph-squares-four', to: '/dashboard' },
              { label: 'My Profile', icon: 'ph-user', to: '/profile' },
              { separator: true },
              { label: 'Sign out', icon: 'ph-sign-out', onSelect: () => void handleLogout() },
            ]}
          />
        ) : (
          <Button variant="ghost" size="sm" icon="ph-sign-out" onClick={() => void handleLogout()}>
            Sign out
          </Button>
        )}
      </>
    ) : (
      <>
        <ButtonLink to="/#login" variant="secondary" size="sm">
          Sign in
        </ButtonLink>
        <ButtonLink to="/register" size="sm">
          Register
        </ButtonLink>
      </>
    )

  /* The phone panel lists the account actions as plain links: a menu inside a menu is
     one disclosure too many on a small screen. */
  const panelAccount =
    state.status === 'loading' ? null : signedIn ? (
      <>
        {studentMenu && (
          <>
            <ButtonLink to="/dashboard" icon="ph-squares-four">
              Dashboard
            </ButtonLink>
            <ButtonLink to="/profile" variant="secondary" icon="ph-user">
              My Profile
            </ButtonLink>
          </>
        )}
        {isStaff && (
          <ButtonLink to="/admin" variant="secondary" icon="ph-shield-check">
            Admin
          </ButtonLink>
        )}
        <Button variant="ghost" icon="ph-sign-out" onClick={() => void handleLogout()}>
          Sign out
        </Button>
      </>
    ) : (
      <>
        <ButtonLink to="/register">Register</ButtonLink>
        <ButtonLink to="/#login" variant="secondary">
          Sign in
        </ButtonLink>
      </>
    )

  return (
    <>
    {/* The first stop for a keyboard on every public page (Milestone 30, Phase 6). */}
    <SkipLink />
    <header className={styles.nav} data-scrolled={scrolled ? 'true' : 'false'}>
      <div className={`container ${styles.inner}`}>
        {/*
          **The mark is the emblem alone** — `logo-mark.png`, built from `logo.png` by
          `scripts/crop-logo-mark.cjs` and served as the 6 KB `logo-mark.webp` (Milestone 30
          Phase 6) — **and the name beside it is text.** In the full
          lockup the wordmark is 8px tall at this size and the expansion one pixel, so the
          text is the only legible instance of the name in the header, not a second one.
          The expansion is on the link's `title`, never on screen here (CLAUDE.md).
        */}
        <div className={styles.brandGroup}>
          <Link to="/" className={styles.brand} title={`${AMIT_OLYMPIAD} — ${AMIT_FULL_FORM}`} onClick={onHomeClick}>
            <img src={logoMark} alt="" aria-hidden="true" width={48} height={48} />
            <span className={styles.brandText}>
              <span className={styles.brandName}>{AMIT_OLYMPIAD}</span>
              <span className={styles.brandTagline} aria-hidden="true">
                {AMIT_TAGLINE}
              </span>
            </span>
          </Link>
          {/* The Diwali edition's greeting (Phase 7) — beside the link, not in it: it is no part of its name. */}
          <DiwaliGreeting />
        </div>

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
            // Only while the panel exists: naming it when it is closed is an IDREF
            // pointing at nothing.
            aria-controls={open ? 'public-nav-panel' : undefined}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name={open ? 'ph-x' : 'ph-list'} weight="bold" size="md" />
          </button>
        </div>
      </div>

      {/*
        Mounted only while open, rather than hidden with CSS: a hidden copy of the same
        links is a second `Primary` landmark a screen reader lists on every page, and a
        panel that merely slides off-screen keeps its links in the tab order.
      */}
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={panelRef} id="public-nav-panel" className={styles.panel}>
            <nav className={styles.panelNav} aria-label="Primary">
              {links}
            </nav>
            {panelAccount && <div className={styles.panelActions}>{panelAccount}</div>}
          </div>
        </>
      )}

      {/* The Diwali edition's string of lights (Phase 7), hanging from the bar's lower edge. */}
      <StringLights className={styles.lights} />
    </header>
    </>
  )
}
