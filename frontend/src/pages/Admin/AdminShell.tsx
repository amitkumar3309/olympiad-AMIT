import type { ReactNode } from 'react'
import { useAuth } from '../../context/AuthContext'
import AppShell from '../../components/layout/AppShell'
import { ADMIN_NAV, visibleGroups } from '../../components/layout/navigation'
import styles from './AdminShell.module.css'

/**
 * Chrome for every administrative page.
 *
 * Since Milestone 23 Phase B this is a thin wrapper: the layout lives in
 * `components/layout/AppShell` (shared with the student area) and the navigation in
 * `components/layout/navigation.ts`. Sharing the shell is what makes the two halves of
 * the product behave identically on a phone — they had drifted apart, because each had
 * its own copy of the drawer.
 *
 * **Navigation is permission-aware**, and that filtering is the one piece of logic
 * left here. Each item declares the permission it needs and is simply absent for
 * anyone who does not hold it, so an administrator never follows a link that greets
 * them with an error. The permissions come from the array the backend sent, never from
 * a role name, so this cannot drift from what the API will actually allow.
 */

interface AdminShellProps {
  title: string
  /** Optional line under the heading. */
  subtitle?: ReactNode
  /** Page-level actions, beside the title. */
  actions?: ReactNode
  children: ReactNode
}

export default function AdminShell({ title, subtitle, actions, children }: AdminShellProps) {
  const { state, can } = useAuth()

  const role = state.status === 'student' || state.status === 'admin' ? state.role : null
  const identityName =
    state.status === 'admin' ? state.admin.email : state.status === 'student' ? state.student.studentId : ''

  return (
    <AppShell
      variant="admin"
      groups={visibleGroups(ADMIN_NAV, can)}
      brand={{ label: 'A.M.I.T Admin', to: '/admin' }}
      title={title}
      subtitle={subtitle}
      actions={actions}
      identity={
        role ? (
          <div className={styles.identity}>
            <span className={styles.identityRole}>{role}</span>
            <span className={styles.identityName}>{identityName}</span>
          </div>
        ) : undefined
      }
    >
      {children}
    </AppShell>
  )
}
