import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/logo.png'
import styles from './Navbar.module.css'

export default function Navbar() {
  const { state, logout } = useAuth()
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
              <Link to="/exam" onClick={() => setOpen(false)}>
                Exam
              </Link>
              <button className={styles.logoutBtn} onClick={handleLogout}>
                Logout
              </button>
            </>
          )}
          {state.status === 'admin' && (
            <>
              <Link to="/admin" onClick={() => setOpen(false)}>
                Admin
              </Link>
              <button className={styles.logoutBtn} onClick={handleLogout}>
                Logout
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
