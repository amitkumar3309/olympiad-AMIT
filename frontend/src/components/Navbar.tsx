import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from './ThemeToggle'
import logo from '../assets/logo.png'
import { AMIT_FULL_FORM, AMIT_SHORT } from '../lib/brand'
import styles from './Navbar.module.css'

export default function Navbar() {
  const { state, can, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <header className={styles.nav}>
      <div className={`container ${styles.inner}`}>
        {/*
          The wordmark stays four letters (Milestone 22, Phase D). The expansion belongs
          where a visitor is asking what the letters mean — the hero, the About section and
          the footer — not in the top bar of every page, where it would be repeated past
          the point of being read.

          It is carried on the image's `alt` and the link's `title` instead, so it is still
          reachable by a screen reader, a search engine and a hover, at no cost to the
          layout.
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

        <button className={styles.burger} aria-label="Toggle menu" onClick={() => setOpen((o) => !o)}>
          <i className="ph ph-list" />
        </button>

        <nav className={`${styles.links} ${open ? styles.open : ''}`}>
          {/* Public, like Result and Certificate — the standing is readable without an
              account, so it belongs in the navigation a guest sees. */}
          <Link to="/leaderboard" onClick={() => setOpen(false)}>
            Leaderboard
          </Link>
          <Link to="/hall-of-fame" onClick={() => setOpen(false)}>
            Hall of Fame
          </Link>
          <Link to="/gallery" onClick={() => setOpen(false)}>
            Gallery
          </Link>
          <Link to="/verify" onClick={() => setOpen(false)}>
            Verify Certificate
          </Link>
          <Link to="/result" onClick={() => setOpen(false)}>
            Result
          </Link>
          <Link to="/certificate" onClick={() => setOpen(false)}>
            Certificate
          </Link>
          {state.status === 'student' && (
            <>
              <Link to="/dashboard" onClick={() => setOpen(false)}>
                Dashboard
              </Link>
              <Link to="/profile" onClick={() => setOpen(false)}>
                Profile
              </Link>
              <Link to="/practice" onClick={() => setOpen(false)}>
                Practice
              </Link>
            </>
          )}
          {/* Shown to guests as the visible way in to the admin portal (the link
              lands on the sign-in form), and to anyone who actually holds the
              permission. Deliberately hidden from a signed-in plain student, who
              would only reach the Unauthorized screen by following it.

              For a signed-in user this is driven by the permission, not by which
              kind of account is signed in: a student promoted to admin keeps their
              student links and gains this one. */}
          {(state.status === 'guest' || can('students:read')) && (
            <Link to="/admin" onClick={() => setOpen(false)}>
              Admin
            </Link>
          )}
          {state.status !== 'guest' && state.status !== 'loading' && (
            <button className={styles.logoutBtn} onClick={handleLogout}>
              Logout
            </button>
          )}
          {/* Available to everyone, signed in or not — the theme is a display
              preference, not an account setting. */}
          <ThemeToggle compact />
        </nav>
      </div>
    </header>
  )
}
