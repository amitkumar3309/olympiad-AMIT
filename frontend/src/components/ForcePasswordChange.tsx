import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Alert, Button, Field, PasswordInput } from './ui'
import { humanizeError } from '../lib/errors'
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
  const [errors, setErrors] = useState<{ newPassword?: string; confirmPassword?: string }>({})
  const [failure, setFailure] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const name = state.status === 'student' ? (state.student.fullName ?? state.student.studentId) : 'there'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFailure('')

    /* Everything wrong at once, on the field it belongs to — this screen is the only
       way into the product, so sending somebody round the loop twice is expensive. */
    const next: { newPassword?: string; confirmPassword?: string } = {}
    if (newPassword.length < 8) {
      next.newPassword = 'Use at least 8 characters.'
    } else if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      next.newPassword = 'Include at least one letter and one number.'
    } else if (newPassword === currentPassword) {
      next.newPassword = 'Choose a password different from the temporary one.'
    }
    if (confirmPassword !== newPassword) {
      next.confirmPassword = 'The two new passwords do not match.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      await api.post('/me/change-password', { currentPassword, newPassword })
      // Re-reads the session so `mustChangePassword` clears and this screen steps
      // aside. The backend re-issues the cookies, so the session survives.
      await refreshSession()
    } catch (err) {
      setFailure(humanizeError(err, { fallback: 'Could not change your password.' }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <main id="main-content" className={styles.card}>
        <h1 className={styles.title}>Choose a new password</h1>
        <p className={styles.lead}>
          Hello {name} — a member of staff has given you a temporary password. Please choose one of your own before
          carrying on. Nobody else should know your new password.
        </p>

        {failure && (
          <Alert tone="danger" className={styles.alert}>
            {failure}
          </Alert>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Field label="Temporary password" required>
            <PasswordInput
              autoComplete="current-password"
              autoFocus
              describedAs="temporary password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>

          <Field
            label="New password"
            required
            hint="At least 8 characters, including a letter and a number."
            error={errors.newPassword}
          >
            <PasswordInput
              autoComplete="new-password"
              describedAs="new password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value)
                if (errors.newPassword) setErrors((current) => ({ ...current, newPassword: undefined }))
              }}
            />
          </Field>

          <Field label="Confirm new password" required error={errors.confirmPassword}>
            <PasswordInput
              autoComplete="new-password"
              describedAs="confirmed password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value)
                if (errors.confirmPassword) setErrors((current) => ({ ...current, confirmPassword: undefined }))
              }}
            />
          </Field>

          <Button type="submit" fullWidth size="lg" loading={submitting} icon="ph-check">
            {submitting ? 'Saving your password' : 'Set my password'}
          </Button>
        </form>

        <Button variant="ghost" fullWidth icon="ph-sign-out" onClick={() => void logout()}>
          Sign out instead
        </Button>
      </main>
    </div>
  )
}
