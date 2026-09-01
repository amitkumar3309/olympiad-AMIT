import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, Field, Input, Spinner } from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import AuthLayout, { AuthStatus } from './AuthLayout'
import styles from './AuthLayout.module.css'

type Phase = 'verifying' | 'success' | 'failed' | 'noToken'

/**
 * The redemption request in flight (or settled) for each token, in this tab.
 *
 * Module-level rather than a ref, because a ref only survives while the component does.
 * A verification token is strictly single-use, so a **second** request for one click is
 * not a harmless duplicate: it used to make the server report "already used" and email a
 * replacement link, which invalidated the link the reader was holding. The server no
 * longer does either (see the verify-email route), but the request should not be sent
 * twice in the first place, and it can be sent twice for reasons this page does not
 * control — StrictMode in development, a remount, a suspended lazy chunk resuming, a
 * double click on the link.
 *
 * A *promise* rather than a stored outcome, so a mount that arrives while the request is
 * still in flight attaches to the same one and renders its result. Storing a
 * placeholder outcome instead would leave that mount showing the spinner for ever: the
 * original promise resolves into an unmounted component, and its `setState` calls go
 * nowhere.
 *
 * Keyed by the token, so a genuinely different link in the same tab is still redeemed. A
 * full page reload clears it, which is correct: that is a new attempt, and the server
 * answers an already-verified account with success.
 */
const redemptions = new Map<string, Promise<string>>()

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

  /**
   * Subscribes to the redemption of this token, starting it only if nobody has.
   *
   * There is deliberately **no "already attempted" ref**. One was tried first and it
   * hung the page: StrictMode runs the effect, cleans it up, and runs it again on the
   * same instance, so the ref was already set on the second run, the effect returned
   * early, nothing subscribed, and the screen sat on "Verifying your email" for ever
   * while the request had in fact succeeded. Found by opening the page rather than by
   * reading it.
   *
   * The map is what makes the request happen once; every mount may safely attach to it.
   */
  useEffect(() => {
    if (!token) return

    const existing = redemptions.get(token)
    const request = existing ?? verifyEmail(token)
    if (!existing) redemptions.set(token, request)

    let cancelled = false
    request
      .then((msg) => {
        if (cancelled) return
        setMessage(msg)
        setPhase('success')
      })
      .catch((err) => {
        if (cancelled) return
        setMessage(humanizeError(err, { fallback: 'We could not verify that link.' }))
        setPhase('failed')
      })

    return () => {
      cancelled = true
    }
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
