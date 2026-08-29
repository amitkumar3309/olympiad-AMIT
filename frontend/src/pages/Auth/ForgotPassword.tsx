import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, Field, Input } from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import AuthLayout, { AuthStatus } from './AuthLayout'
import styles from './AuthLayout.module.css'

/**
 * "Send me a reset link."
 *
 * The response is deliberately the same whether or not the address has an account —
 * that is a backend property (`forgot-password` answers with one generic 200), and the
 * copy here has to match it rather than promise "we found you". Saying anything more
 * specific would turn this page into an account-existence oracle.
 */
export default function ForgotPassword() {
  const { forgotPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      setSent(await forgotPassword(email.trim()))
    } catch (err) {
      setError(humanizeError(err, { fallback: 'Could not send the reset link. Please try again.' }))
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <AuthStatus
          tone="success"
          title="If that address has an account, the link is on its way"
          description={
            <>
              <p>{sent}</p>
              <p>The link works once and expires in 30 minutes. Check your spam folder if it has not arrived.</p>
            </>
          }
          actions={
            <Button variant="secondary" onClick={() => setSent('')}>
              Use a different address
            </Button>
          }
        />
        <div className={styles.formFooter}>
          <Link to="/">Back to home</Link>
          <Link to="/#login">Sign in</Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      lead="Enter the email address on your account and we will send you a link to choose a new one."
    >
      {error && (
        <Alert tone="danger" className={styles.alert}>
          {error}
        </Alert>
      )}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field label="Email address" required hint="The address you registered with.">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Button type="submit" fullWidth size="lg" loading={submitting} icon="ph-paper-plane-tilt">
          {submitting ? 'Sending the link' : 'Send reset link'}
        </Button>
      </form>

      <div className={styles.formFooter}>
        <Link to="/#login">Back to sign in</Link>
        <Link to="/">Home</Link>
      </div>
    </AuthLayout>
  )
}
