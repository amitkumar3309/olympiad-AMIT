import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Button from './Button'
import styles from './ForcePasswordChange.module.css'

/**
 * Shown in place of the whole application when staff have issued a temporary
 * password, until the holder chooses one of their own.
 *
 * Why it wraps everything rather than living on a route: a temporary password is a
 * credential a member of staff knows. Leaving the account usable while it is still
 * in force would mean the window in which somebody else could sign in as this
 * student lasts as long as they never get round to changing it. Wrapping the app
 * means there is no page to navigate to instead, and no route to deep-link past.
 *
 * This is a *user-interface* gate, not a security boundary — the API is still
 * reachable directly with the temporary password, exactly as it is with any other
 * working credential. What it enforces is that the ordinary way through the product
 * leads to a new password. The backend's part of the bargain is narrower and
 * stricter: `mustChangePassword` clears in exactly one place, the change-password
 * route, so the flag cannot be dismissed by anything except actually changing it.
 */
export default function ForcePasswordChange() {
  const { state, logout, refreshSession } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const name = state.status === 'student' ? (state.student.fullName ?? state.student.studentId) : 'there'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setError('Choose a password different from the temporary one.')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/me/change-password', { currentPassword, newPassword })
      // Re-reads the session so `mustChangePassword` clears and this screen steps
      // aside. The backend re-issues the cookies, so the session survives.
      await refreshSession()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={`card ${styles.card}`} onSubmit={handleSubmit}>
        <h2>Choose a new password</h2>
        <p className={styles.lead}>
          Hello {name} — a member of staff has given you a temporary password. Please choose one of your own before
          carrying on. Nobody else should know your new password.
        </p>

        {error && <p className="error-text">{error}</p>}

        <div className="form-group">
          <label htmlFor="fpc-current">Temporary password</label>
          <input
            id="fpc-current"
            type="password"
            className="form-control"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="fpc-new">New password</label>
          <input
            id="fpc-new"
            type="password"
            className="form-control"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <small className={styles.hint}>At least 8 characters, including a letter and a number.</small>
        </div>
        <div className="form-group">
          <label htmlFor="fpc-confirm">Confirm new password</label>
          <input
            id="fpc-confirm"
            type="password"
            className="form-control"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? 'Saving...' : 'Set my password'}
        </Button>

        <button type="button" className={styles.signOut} onClick={() => void logout()}>
          Sign out instead
        </button>
      </form>
    </div>
  )
}
