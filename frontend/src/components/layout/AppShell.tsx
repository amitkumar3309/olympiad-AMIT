import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Badge, Icon } from '../ui'
import { lockScroll, unlockScroll } from '../ui/scrollLock'
import DeveloperCredit from '../DeveloperCredit'
import ThemeToggle from '../ThemeToggle'
import { findActiveItem, type NavGroup, type NavItem } from './navigation'
import styles from './AppShell.module.css'

/**
 * The application chrome, for both signed-in areas (Milestone 23, Phase B).
 *
 * `StudentShell` and `pages/Admin/AdminShell` were near-identical copies of a sidebar,
 * a drawer, a topbar and an active-item comparison — which is why the two halves of
 * the product had drifted apart on mobile, and why neither drawer trapped focus or was
 * removed from the tab order while off-screen. There is now one implementation and two
 * navigation models (`navigation.ts`).
 *
 * ## Three layouts, not one that shrinks
 *
 * | Width | Navigation |
 * |---|---|
 * | `< 768px` | Student: a **bottom bar** of four destinations plus More. Admin: a burger. Either way the drawer holds everything. |
 * | `768–1023px` | A burger in the topbar opening the same drawer. No bottom bar — a tablet is not held one-handed. |
 * | `≥ 1024px` | A permanent sidebar. No burger, no bottom bar. |
 *
 * The permanent sidebar starts at 1024px rather than 768px (where it used to) because
 * the admin area is full of wide tables and a 264px sidebar on a 768px screen leaves
 * 500px for them.
 *
 * ## Why the sidebar and the drawer are two elements
 *
 * They hold the same navigation, and the obvious implementation is one element that
 * slides. That was the first implementation, and it was wrong twice over — both found
 * by driving the browser, neither visible in the code:
 *
 *  - A drawer that is merely translated off-screen keeps all twenty links in the tab
 *    order and in the accessibility tree. Hiding it with `visibility: hidden` fixes
 *    that, but then `focus()` on the newly-opened drawer is a **silent no-op** until a
 *    style recalculation has happened — so focus intermittently stayed on the button
 *    that opened it, and nothing announced the menu.
 *  - Marking it `inert` instead fixes both, but `inert` then has to be *removed* on a
 *    desktop, which needs a JavaScript media query — and a media-query change is
 *    delivered with the browser's style recalculation, which a tab that is not
 *    rendering never performs. A stale reading left the **permanent desktop sidebar
 *    `inert`**: the whole navigation unreachable by keyboard and absent from the
 *    accessibility tree. The worst available failure, produced by the least reliable
 *    signal.
 *
 * So: the permanent sidebar is `display: none` below 1024px — CSS, which cannot be
 * stale, and which does remove it from the accessibility tree — and the drawer is
 * **mounted only while it is open**, like a modal. Nothing about correctness now
 * depends on an event arriving. The one thing that still uses a media query is closing
 * an open drawer when the window is widened past the breakpoint, and if that fails the
 * CSS has already hidden it.
 *
 * ## `focus`
 *
 * A timed paper passes `focus`, which drops the bottom bar — it sits exactly where the
 * answer buttons are, and a mis-tap during an exam navigates away from it. The drawer
 * and its burger stay available at every width, because a student must always be able
 * to leave.
 */

export interface AppShellProps {
  /** Which navigation model this is. Only `student` gets a bottom bar. */
  variant: 'student' | 'admin'
  groups: NavGroup[]
  brand: { label: string; to: string }
  /** Destinations for the mobile bottom bar. Student only; a fifth "More" slot is
   *  appended by the shell. */
  bottomNav?: NavItem[]
  title: ReactNode
  subtitle?: ReactNode
  /** Page-level actions, beside the title on desktop and under it on a phone. */
  actions?: ReactNode
  /** The signed-in identity block, shown at the foot of the navigation. */
  identity?: ReactNode
  /** Unread notifications, for the badge on the item that declares `badge: 'unread'`. */
  unread?: number
  /** Whether the entry fee is paid; a `paid` item shows a padlock until it is. */
  hasPaid?: boolean
  /** Drops the bottom bar for a timed paper. See the note above. */
  focus?: boolean
  children: ReactNode
}

export default function AppShell({
  variant,
  groups,
  brand,
  bottomNav,
  title,
  subtitle,
  actions,
  identity,
  unread = 0,
  hasPaid = true,
  focus,
  children,
}: AppShellProps) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const drawerRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  const activeItem = findActiveItem(pathname, groups)
  const showBottomNav = variant === 'student' && bottomNav && bottomNav.length > 0 && !focus

  const openDrawer = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    openerRef.current = event.currentTarget
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  /* Any route change closes the drawer — including a browser back, which no click
     handler on an item would catch. */
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  /*
    Close an open drawer once the window is wide enough for the permanent sidebar.

    Tidiness rather than correctness: the CSS has already hidden the drawer by then, so
    what this prevents is the scroll lock outliving anything the reader can see. Both
    listeners are registered because neither is reliable alone — a media-query change is
    delivered with a style recalculation, which a tab that is not rendering skips.
  */
  useEffect(() => {
    if (!drawerOpen) return
    const query = window.matchMedia('(min-width: 1024px)')
    const closeIfWide = () => {
      if (query.matches) setDrawerOpen(false)
    }
    query.addEventListener('change', closeIfWide)
    window.addEventListener('resize', closeIfWide)
    return () => {
      query.removeEventListener('change', closeIfWide)
      window.removeEventListener('resize', closeIfWide)
    }
  }, [drawerOpen])

  /* Escape, scroll lock, and focus in and back out. */
  useEffect(() => {
    if (!drawerOpen) return

    lockScroll()
    /*
      Focus moves into the drawer, synchronously.

      It works because the drawer has just been *mounted* — like a modal, and unlike a
      panel that was hidden by a style. No `requestAnimationFrame`: a frame never
      arrives in a tab that is not compositing.
    */
    closeButtonRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setDrawerOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const root = drawerRef.current
      if (!root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
      if (items.length === 0) return

      const first = items[0]!
      const last = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      unlockScroll()
      openerRef.current?.focus()
    }
  }, [drawerOpen])

  /*
    Tells the toast stack how much room the bottom bar takes, so a confirmation does
    not appear underneath it. Set on the document rather than passed down, because the
    toasts render in a portal on `document.body` — see `Toast.module.css`.
  */
  useEffect(() => {
    if (!showBottomNav) return
    const root = document.documentElement
    root.style.setProperty('--bottom-nav-offset', 'var(--bottom-nav-height)')
    return () => {
      // Braces, not a concise body: `removeProperty` returns the old value, and a
      // cleanup function that returns anything is not a valid effect destructor.
      root.style.removeProperty('--bottom-nav-offset')
    }
  }, [showBottomNav])

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  function renderItem(item: NavItem, onNavigate?: () => void) {
    const current = item === activeItem
    const locked = Boolean(item.paid) && !hasPaid
    const showUnread = item.badge === 'unread' && unread > 0

    return (
      <li key={item.to}>
        <Link
          to={item.to}
          className={current ? styles.itemActive : styles.item}
          aria-current={current ? 'page' : undefined}
          onClick={onNavigate}
        >
          <Icon name={item.icon} weight="bold" size="sm" />
          <span className={styles.itemLabel}>{item.label}</span>
          {locked && (
            <Icon name="ph-lock-simple" size="xs" className={styles.itemTrailing} label="Entry fee required" />
          )}
          {showUnread && (
            <span className={styles.itemTrailing}>
              <Badge tone="danger" variant="solid" size="sm">
                {unread > 99 ? '99+' : unread}
                <span className="sr-only"> unread</span>
              </Badge>
            </span>
          )}
        </Link>
      </li>
    )
  }

  /**
   * The navigation, rendered into either the permanent sidebar or the drawer.
   *
   * Only one of the two is ever in the accessibility tree: below 1024px the sidebar is
   * `display: none`, and at or above it the drawer is not mounted. That is what keeps a
   * single `Main navigation` landmark on the page rather than two copies of it.
   */
  function navPanel(inDrawer: boolean) {
    return (
      <>
        <div className={styles.panelHead}>
          <Link to={brand.to} className={styles.brand} onClick={inDrawer ? closeDrawer : undefined}>
            <Icon
              name={variant === 'admin' ? 'ph-shield-check' : 'ph-graduation-cap'}
              weight="bold"
              size="md"
            />
            <span>{brand.label}</span>
          </Link>
          {inDrawer && (
            <button
              ref={closeButtonRef}
              type="button"
              className={styles.closeDrawer}
              onClick={closeDrawer}
              aria-label="Close menu"
            >
              <Icon name="ph-x" weight="bold" size="sm" />
            </button>
          )}
        </div>

        <div className={styles.panelScroll}>
          <nav className={styles.nav} aria-label={variant === 'admin' ? 'Admin sections' : 'Student sections'}>
            {groups.map((group, index) => (
              <div key={group.label ?? `group-${index}`} className={styles.group}>
                {group.label && <p className={styles.groupLabel}>{group.label}</p>}
                {/* The list is labelled rather than headed, so a screen reader announces
                    "Prepare, list, 3 items" without inventing a heading level that would
                    have to fit the page's outline. */}
                <ul className={styles.items} aria-label={group.label}>
                  {group.items.map((item) => renderItem(item, inDrawer ? closeDrawer : undefined))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className={styles.panelFoot}>
          {identity}
          <DeveloperCredit variant="compact" className={styles.credit} />
          <div className={styles.panelActions}>
            <ThemeToggle />
            <button type="button" className={styles.logout} onClick={() => void handleLogout()}>
              <Icon name="ph-sign-out" weight="bold" size="sm" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className={`${styles.shell} ${showBottomNav ? styles.withBottomNav : ''}`}>
      {/* First focusable thing on the page: 30-odd navigation links otherwise stand
          between a keyboard user and the content, on every page. */}
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>

      {/* Permanent from 1024px, `display: none` below it. */}
      <aside className={styles.sidebar} aria-label="Main navigation">
        {navPanel(false)}
      </aside>

      <div className={styles.column}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={`${styles.burger} ${focus ? styles.burgerAlways : ''}`}
            onClick={openDrawer}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
          >
            <Icon name="ph-list" weight="bold" size="md" />
          </button>

          <div className={styles.titles}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>

          {actions && <div className={styles.actions}>{actions}</div>}

          {/* Notifications are in the drawer on a phone, so the bell is the one thing
              lifted out of it — an unread count nobody can see is not a count. */}
          {variant === 'student' && (
            <Link
              to="/notifications"
              className={styles.bell}
              aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
            >
              <Icon name={unread > 0 ? 'ph-bell-ringing' : 'ph-bell'} weight="bold" size="md" />
              {unread > 0 && <span className={styles.bellDot} aria-hidden="true" />}
            </Link>
          )}
        </header>

        <main id="main-content" className={styles.content}>
          {children}
        </main>
      </div>

      {/*
        Mounted only while open. A dialog rather than a plain panel, because that is
        what it behaves like on a phone: it covers the page, it traps focus, and Escape
        closes it.
      */}
      {drawerOpen && (
        <>
          <div className={styles.backdrop} onClick={closeDrawer} aria-hidden="true" />
          <div
            ref={drawerRef}
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            {navPanel(true)}
          </div>
        </>
      )}

      {showBottomNav && (
        <nav className={styles.bottomNav} aria-label="Primary">
          {bottomNav!.map((item) => {
            const current = findActiveItem(pathname, [{ items: bottomNav! }]) === item
            return (
              <Link
                key={item.to}
                to={item.to}
                className={current ? styles.bottomItemActive : styles.bottomItem}
                aria-current={current ? 'page' : undefined}
              >
                <Icon name={item.icon} weight="bold" size="md" />
                <span>{item.label}</span>
              </Link>
            )
          })}
          <button type="button" className={styles.bottomItem} onClick={openDrawer} aria-expanded={drawerOpen}>
            <span className={styles.bottomMore}>
              <Icon name="ph-list" weight="bold" size="md" />
              {unread > 0 && <span className={styles.bellDot} aria-hidden="true" />}
            </span>
            <span>More</span>
          </button>
        </nav>
      )}
    </div>
  )
}
