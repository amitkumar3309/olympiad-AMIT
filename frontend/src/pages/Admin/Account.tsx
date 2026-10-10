import { useState, type CSSProperties, type FormEvent } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, Card, CardHeader, Field, PasswordInput, useToast } from '../../components/ui'
import PasswordRules from '../../components/PasswordRules'
import { humanizeError } from '../../lib/errors'
import { passwordProblem } from '../../lib/passwordPolicy'
import AdminShell from './AdminShell'
import styles from './Account.module.css'

/**
 * **My account**, for staff (owner, 2026-10-10: "the admin/superadmin shouldn't have a profile
 * like student"). Staff have no student profile, so this is the one place they see which account
 * they are signed in as and change its password — nothing about a class, a school or a photo.
 *
 * The password goes through the same `POST /me/change-password` and the same policy mirror
 * (`passwordProblem()` and the live checklist) as every other form that sets one.
 */
export default function AdminAccount() {
  const { state } = useAuth()
  const toast = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<{ currentPassword?: string; newPassword?: string; confirmPassword?: string }>({})
  const [failure, setFailure] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const account = state.status === 'student' ? state.student : null
  const role = state.status === 'student' || state.status === 'admin' ? state.role : null
  const roleLabel = role === 'superadmin' ? 'Super administrator' : role === 'admin' ? 'Administrator' : null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFailure('')

    const next: typeof errors = {}
    if (!currentPassword) next.currentPassword = 'Enter your current password.'
    const problem = passwordProblem(newPassword)
    if (problem) next.newPassword = problem
    else if (newPassword === currentPassword) next.newPassword = 'Choose a password different from the current one.'
    if (confirmPassword !== newPassword) next.confirmPassword = 'The two new passwords do not match.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      await api.post('/me/change-password', { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password changed.')
    } catch (err) {
      setFailure(humanizeError(err, { fallback: 'Could not change your password.' }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AdminShell title="My account" subtitle="The account you are signed in with.">
      <div className="stack" style={{ '--stack-gap': 'var(--block-gap)' } as CSSProperties}>
        <Card>
          <CardHeader title="Signed in as" as="h2" size="sm" />
          <dl className={styles.details}>
            <div>
              <dt>Name</dt>
              <dd>{account?.fullName || '—'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{account?.email || '—'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{roleLabel ?? '—'}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Change your password" as="h2" size="sm" description="You stay signed in on this device." />
          <form className="stack" onSubmit={handleSubmit} noValidate>
            {failure && <Alert tone="danger">{failure}</Alert>}
            <Field label="Current password" required error={errors.currentPassword}>
              <PasswordInput
                autoComplete="current-password"
                describedAs="current password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field label="New password" required error={errors.newPassword}>
              <PasswordInput
                autoComplete="new-password"
                describedAs="new password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <PasswordRules value={newPassword} />
            </Field>
            <Field label="Confirm new password" required error={errors.confirmPassword}>
              <PasswordInput
                autoComplete="new-password"
                describedAs="confirmed password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" icon="ph-check" loading={submitting}>
                Change password
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </AdminShell>
  )
}
