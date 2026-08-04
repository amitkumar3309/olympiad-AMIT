import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import type { Permission } from '../../api/types'
import styles from './Admin.module.css'

/**
 * Chrome shared by every administrative page, and the one place the admin
 * navigation is defined.
 *
 * Navigation is permission-aware: each item declares the permission it needs and
 * is simply absent for anyone who does not hold it, so an admin never sees a link
 * that would only greet them with an error. The list comes from the permission
 * array the backend sent, not from a role name, so it cannot drift from what the
 * API will actually allow.
 */
const NAV_ITEMS: Array<{ to: string; label: string; icon: string; permission?: Permission }> = [
  { to: '/admin', label: 'Dashboard', icon: 'ph-squares-four' },
  { to: '/admin/users', label: 'User Management', icon: 'ph-users-three', permission: 'students:read' },
  { to: '/admin/audit-log', label: 'Audit Log', icon: 'ph-scroll', permission: 'audit:read' },
  { to: '/ai-generator', label: 'AI Question Generator', icon: 'ph-sparkle', permission: 'questions:write' },
]

export default function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const { state, can, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const role = state.status === 'student' || state.status === 'admin' ? state.role : null
  const identity =
    state.status === 'admin' ? state.admin.email : state.status === 'student' ? state.student.studentId : ''

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <div className={`theme-dark ${styles.shell}`}>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarBrand}>A.M.I.T Admin</div>
        <nav>
          {NAV_ITEMS.filter((item) => !item.permission || can(item.permission)).map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={pathname === item.to ? styles.menuItemActive : styles.menuItem}
              onClick={() => setSidebarOpen(false)}
            >
              <i className={`ph-bold ${item.icon}`} /> {item.label}
            </Link>
          ))}
        </nav>
        {role && (
          <div className={styles.identity}>
            <span className={styles.identityRole}>{role}</span>
            <span className={styles.identityName}>{identity}</span>
          </div>
        )}
        <button className={styles.logoutBtn} onClick={handleLogout}>
          <i className="ph-bold ph-sign-out" /> Logout
        </button>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.burger} onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle menu">
            <i className="ph ph-list" />
          </button>
          <h2>{title}</h2>
        </header>
        {children}
      </div>
    </div>
  )
}
