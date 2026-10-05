import { useNavigate } from 'react-router-dom'
import type { Student } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import { Avatar, Icon, Menu } from '../ui'
import styles from './AccountMenu.module.css'

/**
 * The student top bar's profile chip (Milestone 30, Phase 4 — brief §8): the student's own
 * photo, name, class and ID, and a menu of My Profile, Help & Support and Log out.
 *
 * The photo is asked for only when the session says one exists (`hasPhoto`), so an account
 * without one shows its initials instead of a broken request on every page. Below 1024px
 * the chip is the avatar alone; the name is still the button's accessible name.
 */
export default function AccountMenu({ student }: { student: Student }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const name = student.fullName || student.firstName || 'Student'
  const meta = [student.classLevel, `ID: ${student.studentId}`].filter(Boolean).join(' | ')

  async function signOut() {
    await logout()
    navigate('/')
  }

  return (
    <Menu
      label={`Account menu for ${name}`}
      align="end"
      className={styles.trigger}
      trigger={
        <>
          <Avatar
            name={name}
            src={student.hasPhoto ? `/api/v1/students/${student.studentId}/photo` : null}
            size="sm"
            decorative
          />
          <span className={styles.text}>
            <span className={styles.name}>{name}</span>
            <span className={styles.meta}>{meta}</span>
          </span>
          <Icon name="ph-caret-down" weight="bold" size="xs" className={styles.caret} />
        </>
      }
      items={[
        { label: 'My Profile', icon: 'ph-user-circle', to: '/profile' },
        { label: 'Help & Support', icon: 'ph-question', to: '/contact' },
        { separator: true },
        { label: 'Log out', icon: 'ph-sign-out', onSelect: () => void signOut() },
      ]}
    />
  )
}
