import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from './ThemeToggle'
import logo from '../assets/logo.png'
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
        <Link to="/" className={styles.brand} onClick={() => setOpen(false)}>
          <img src={logo} alt="A.M.I.T Olympiad" />
          <span>A.M.I.T. OLYMPIAD</span>
        </Link>

        <button className={styles.burger} aria-label="Toggle menu" onClick={() => setOpen((o) => !o)}>
          <i className="ph ph-list" />
        </button>

        <nav className={`${styles.links} ${open ? styles.open : ''}`}>
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
              <Link to="/exam" onClick={() => setOpen(false)}>
                Exam
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
