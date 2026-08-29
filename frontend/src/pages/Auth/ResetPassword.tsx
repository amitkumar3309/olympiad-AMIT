import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, ButtonLink, Field, PasswordInput } from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import AuthLayout, { AuthStatus } from './AuthLayout'
import styles from './AuthLayout.module.css'

/** Mirrors the backend's rule, so the message a student sees is the rule they broke. */
function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return 'Include at least one letter and one number.'
  }
  return null
}

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { resetPassword } = useAuth()
  const token = params.get('token')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    /*
      Both fields are checked before either is reported, so a student is told
      everything that is wrong at once rather than being sent round the loop twice —
      which on a phone means retyping a password they cannot see.
    */
    const next: { password?: string; confirm?: string } = {}
    const problem = passwordProblem(password)
    if (problem) next.password = problem
    if (confirm !== password) next.confirm = 'The two passwords do not match.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      setDone(await resetPassword(token!, password))
    } catch (err) {
      setError(humanizeError(err, { fallback: 'Could not reset your password. Please try again.' }))
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Reset link needed">
        <AuthStatus
          tone="warning"
          title="This page needs the link from your email"
          description="Password reset links are single-use and expire after 30 minutes. Request a new one and open it from your inbox."
          actions={
            <ButtonLink to="/forgot-password" icon="ph-paper-plane-tilt">
              Request a new link
            </ButtonLink>
          }
        />
        <div className={styles.formFooter}>
          <Link to="/">Back to home</Link>
        </div>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout title="Password updated">
        <AuthStatus
          tone="success"
          title="Your new password is set"
          description={
            <>
              <p>{done}</p>
              <p>You were signed out everywhere else, so sign in again with the new password.</p>
            </>
          }
          actions={
            <Button icon="ph-sign-in" onClick={() => navigate('/#login')}>
              Go to sign in
            </Button>
          }
        />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Choose a new password"
      lead="For your security, setting a new password signs you out on every device."
    >
      {error && (
        <Alert tone="danger" className={styles.alert}>
          {error}
        </Alert>
      )}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field
          label="New password"
          required
          hint="At least 8 characters, including a letter and a number."
          error={errors.password}
        >
          <PasswordInput
            autoComplete="new-password"
            autoFocus
            describedAs="new password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              if (errors.password) setErrors((current) => ({ ...current, password: undefined }))
            }}
          />
        </Field>

        <Field label="Confirm new password" required error={errors.confirm}>
          <PasswordInput
            autoComplete="new-password"
            describedAs="confirmed password"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value)
              if (errors.confirm) setErrors((current) => ({ ...current, confirm: undefined }))
            }}
          />
        </Field>

        <Button type="submit" fullWidth size="lg" loading={submitting} icon="ph-check">
          {submitting ? 'Updating your password' : 'Update my password'}
        </Button>
      </form>

      <div className={styles.formFooter}>
        <Link to="/forgot-password">Request a new link</Link>
        <Link to="/">Home</Link>
      </div>
    </AuthLayout>
  )
}
