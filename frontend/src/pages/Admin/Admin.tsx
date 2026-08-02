import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import StatTile from '../../components/StatTile'
import ChartCard from '../../components/ChartCard'
import Spinner from '../../components/Spinner'
import { useAuth, ApiError } from '../../context/AuthContext'
import styles from './Admin.module.css'

const MOCK_STUDENTS = [
  { id: 'AMIT_4821', name: 'Amit Kumar', class: '8', accuracy: '98%' },
  { id: 'AMIT_7821', name: 'Aarav Mehta', class: '10', accuracy: '96%' },
  { id: 'AMIT_2210', name: 'Sneha Kulkarni', class: '9', accuracy: '95%' },
  { id: 'AMIT_9081', name: 'Priya Singh', class: '7', accuracy: '94%' },
]

export default function Admin() {
  const { state, adminLogin, logout } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await adminLogin(email.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (state.status === 'loading') return <Spinner label="Loading admin portal..." />

  if (state.status !== 'admin') {
    return (
      <div className={`theme-dark ${styles.loginWrap}`}>
        <form className={`card ${styles.loginCard}`} onSubmit={handleLogin}>
          <h2>Enterprise Admin Portal</h2>
          <p>Sign in to manage students, questions, and analytics.</p>
          {error && <p className="error-text">{error}</p>}
          <div className="form-group">
            <label>Admin Email</label>
            <input className="form-control" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              className="form-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Signing in...' : 'Login'}
          </Button>
        </form>
      </div>
    )
  }

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <div className={`theme-dark ${styles.shell}`}>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarBrand}>A.M.I.T Admin</div>
        <nav>
          <span className={styles.menuItemActive}>
            <i className="ph-bold ph-squares-four" /> Dashboard
          </span>
          <Link to="/ai-generator" className={styles.menuItem}>
            <i className="ph-bold ph-sparkle" /> AI Question Generator
          </Link>
        </nav>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          <i className="ph-bold ph-sign-out" /> Logout
        </button>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.burger} onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle menu">
            <i className="ph ph-list" />
          </button>
          <h2>Dashboard Overview</h2>
        </header>

        <div className={styles.statRow}>
          <StatTile icon="ph-users" value="15,000+" label="Students Registered" />
          <StatTile icon="ph-trophy" value="450+" label="Participating Schools" />
          <StatTile icon="ph-lightning" value="1,280" label="Challenges Solved Today" />
        </div>

        <ChartCard
          title="Weekly Accuracy Trend"
          type="line"
          label="Accuracy %"
          labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
          data={[72, 78, 75, 82, 88, 90, 92]}
        />

        <div className={`card ${styles.tableCard}`}>
          <h3>Students Data</h3>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_STUDENTS.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{s.name}</td>
                    <td>{s.class}</td>
                    <td>{s.accuracy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
