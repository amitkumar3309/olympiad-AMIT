import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import StatTile from '../../components/StatTile'
import { useAuth } from '../../context/AuthContext'
import styles from './Dashboard.module.css'

const LEADERBOARD = [
  { rank: 1, name: 'Ananya Sharma', xp: 3420, school: 'Delhi Public School' },
  { rank: 2, name: 'Rahul Verma', xp: 3100, school: "St. Xavier's High" },
  { rank: 3, name: 'Priya Singh', xp: 2950, school: 'Kendriya Vidyalaya' },
]

const NAV_ITEMS = [
  { to: '/dashboard', icon: 'ph-squares-four', label: 'Dashboard' },
  { to: '/exam', icon: 'ph-pencil-line', label: 'Live Exam' },
  { to: '/analytics', icon: 'ph-chart-line-up', label: 'Analytics' },
  { to: '/report', icon: 'ph-file-text', label: 'Report' },
  { to: '/certificate', icon: 'ph-medal', label: 'Certificate' },
]

export default function Dashboard() {
  const { state, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const student = state.status === 'student' ? state.student : null

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <div className={`theme-dark ${styles.shell}`}>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brand}>A.M.I.T Hub</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <Link key={item.to} to={item.to} className={item.to === '/dashboard' ? styles.menuItemActive : styles.menuItem}>
              <i className={`ph-bold ${item.icon}`} /> {item.label}
            </Link>
          ))}
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
          <div>
            <h1>Welcome back, {student?.fullName ?? 'Champion'} 👋</h1>
            <p className={styles.studentId}>Student ID: {student?.studentId}</p>
          </div>
        </header>

        <div className={styles.statRow}>
          <StatTile icon="ph-fire" value="1,280" label="Challenges Solved Today" />
          <StatTile icon="ph-clock" value="8.91s" label="Fastest Solve Time" />
          <StatTile icon="ph-users-three" value="450+" label="Participating Schools" />
        </div>

        <div className={styles.grid}>
          <div className="card">
            <h3>🏆 Leaderboard</h3>
            <ul className={styles.leaderboard}>
              {LEADERBOARD.map((l) => (
                <li key={l.rank}>
                  <span className={styles.rank}>#{l.rank}</span>
                  <span className={styles.lbName}>{l.name}</span>
                  <span className={styles.lbSchool}>{l.school}</span>
                  <span className={styles.lbXp}>{l.xp} XP</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3>Quick Actions</h3>
            <div className={styles.actions}>
              <Link to="/exam" className={styles.actionCard}>
                <i className="ph-bold ph-pencil-line" />
                Take Live Exam
              </Link>
              <Link to="/analytics" className={styles.actionCard}>
                <i className="ph-bold ph-chart-line-up" />
                View Analytics
              </Link>
              <Link to="/certificate" className={styles.actionCard}>
                <i className="ph-bold ph-medal" />
                My Certificate
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
