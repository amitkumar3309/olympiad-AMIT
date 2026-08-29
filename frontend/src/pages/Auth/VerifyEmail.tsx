import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, Field, Input, Spinner } from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import AuthLayout, { AuthStatus } from './AuthLayout'
import styles from './AuthLayout.module.css'

type Phase = 'verifying' | 'success' | 'failed' | 'noToken'

/**
 * The page an emailed verification link lands on.
 *
 * Email verification is required before a student can sign in at all, so this is the
 * screen standing between registering and using the product — which is why the failure
 * states carry the way forward (a resend form) rather than just the bad news.
 */
export default function VerifyEmail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { verifyEmail, resendVerification } = useAuth()
  const token = params.get('token')

  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'noToken')
  const [message, setMessage] = useState('')
  const [resendEmail, setResendEmail] = useState('')
  const [resendNotice, setResendNotice] = useState('')
  const [resendError, setResendError] = useState('')
  const [resending, setResending] = useState(false)

  // React 18+ StrictMode mounts effects twice in development. The verification
  // token is strictly single-use, so a second call would report "already used"
  // and show a spurious failure — this guard makes the attempt happen once.
  const attempted = useRef(false)

  useEffect(() => {
    if (!token || attempted.current) return
    attempted.current = true

    verifyEmail(token)
      .then((msg) => {
        setMessage(msg)
        setPhase('success')
      })
      .catch((err) => {
        setMessage(humanizeError(err, { fallback: 'We could not verify that link.' }))
        setPhase('failed')
      })
  }, [token, verifyEmail])

  const handleResend = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setResending(true)
      setResendNotice('')
      setResendError('')
      try {
        setResendNotice(await resendVerification(resendEmail.trim()))
      } catch (err) {
        setResendError(humanizeError(err, { fallback: 'Could not send a new link. Please try again.' }))
      } finally {
        setResending(false)
      }
    },
    [resendEmail, resendVerification],
  )

  if (phase === 'verifying') {
    return (
      <AuthLayout title="Verifying your email">
        <Spinner label="Checking your verification link" />
      </AuthLayout>
    )
  }

  if (phase === 'success') {
    return (
      <AuthLayout title="Email verified">
        <AuthStatus
          tone="success"
          title="Your account is active"
          description={
            <>
              <p>{message}</p>
              <p>Sign in with the email address and password you registered with.</p>
            </>
          }
          actions={
            <Button icon="ph-sign-in" onClick={() => navigate('/#login')}>
              Continue to sign in
            </Button>
          }
        />
      </AuthLayout>
    )
  }

  const noToken = phase === 'noToken'

  return (
    <AuthLayout title={noToken ? 'Verification link needed' : 'That link did not work'}>
      <AuthStatus
        tone={noToken ? 'warning' : 'danger'}
        title={noToken ? 'Open the link from your email' : 'We could not verify your email'}
        description={
          noToken
            ? 'Verification links are single-use and expire after 24 hours. Open the most recent one from your inbox, or ask for a new one below.'
            : message
        }
      />

      <form className={styles.form} onSubmit={handleResend} noValidate>
        {resendError && <Alert tone="danger">{resendError}</Alert>}
        {resendNotice && <Alert tone="success">{resendNotice}</Alert>}

        <Field
          label="Send a new link to"
          required
          hint="The email address you registered with."
        >
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={resendEmail}
            onChange={(event) => setResendEmail(event.target.value)}
          />
        </Field>

        <Button type="submit" fullWidth size="lg" loading={resending} icon="ph-paper-plane-tilt">
          {resending ? 'Sending a new link' : 'Send me a new link'}
        </Button>
      </form>

      <div className={styles.formFooter}>
        <Link to="/#login">Back to sign in</Link>
        <Link to="/">Home</Link>
      </div>
    </AuthLayout>
  )
}
