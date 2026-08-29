import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, ApiError } from '../../context/AuthContext'
import { Alert, Button, Field, Input, Modal, PasswordInput } from '../../components/ui'
import { humanizeSignInError } from '../../lib/errors'
import styles from './LoginDialog.module.css'

/**
 * Sign in.
 *
 * Extracted from `Landing.tsx` in Milestone 23 Phase C, where it was a hand-rolled
 * overlay: no focus trap, no Escape, no scroll lock, and a click handler on the
 * backdrop that also fired for clicks bubbling out of the form. It is now a `Modal`,
 * which owns all four.
 *
 * ## Why a dialog rather than a page
 *
 * There is no `/login` route. Sign-in has always been a panel on the landing page, and
 * the header and footer reach it through `/#login` (Milestone 23, Phase B) — so it is
 * addressable without a second copy of the form living on a route of its own.
 *
 * ## Three things a sign-in form has to get right
 *
 * **Autofill.** `autoComplete="username"` and `"current-password"` are what make a
 * password manager offer the saved credential; without them a student on a phone types
 * it by hand every time. The identifier accepts a mobile number *or* an email, which is
 * why it is `username` rather than `email`.
 *
 * **Not saying which half was wrong.** The backend answers with one message for an
 * unknown account and a wrong password, deliberately — this form must not add detail it
 * does not have. The one exception is a verified-email failure, which the API marks with
 * `EMAIL_NOT_VERIFIED`, because the student can act on it.
 *
 * **Not showing the reader a schema, or the wrong sentence.** An empty field is caught
 * here, before the request; everything else goes through `humanizeSignInError`, which
 * exists because the ordinary humanizer rewrites a 401 as "your session has ended" —
 * true on a page whose data was refused, and nonsense on the form you sign in with.
 * Both of those reached the screen during this phase's browser pass, which is how they
 * were found.
 */

export interface LoginDialogProps {
  open: boolean
  onClose: () => void
  /**
   * Where to go once the session exists. The landing page sends them to the dashboard,
   * which is what it did before this was extracted — a signed-in student left on the
   * marketing page is not a sign-in.
   */
  onSignedIn?: () => void
}

const FORM_ID = 'login-form'

export default function LoginDialog({ open, onClose, onSignedIn }: LoginDialogProps) {
  const { login } = useAuth()
  const identifierRef = useRef<HTMLInputElement>(null)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({})
  const [error, setError] = useState('')
  const [needsVerification, setNeedsVerification] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  /* A dialog that reopens should not still be showing the last attempt's failure. */
  useEffect(() => {
    if (!open) {
      setError('')
      setErrors({})
      setNeedsVerification(false)
      setSubmitting(false)
    }
  }, [open])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setNeedsVerification(false)

    const next: { identifier?: string; password?: string } = {}
    if (!identifier.trim()) next.identifier = 'Enter your mobile number or email address.'
    if (!password) next.password = 'Enter your password.'
    setErrors(next)
    if (next.identifier) {
      identifierRef.current?.focus()
      return
    }
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      await login(identifier.trim(), password)
      onSignedIn?.()
    } catch (err) {
      setNeedsVerification(err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED')
      setError(humanizeSignInError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sign in"
      description="Use the mobile number or email address you registered with."
      icon="ph-sign-in"
      size="sm"
      // The dialog would otherwise take focus itself. Here the first field is the right
      // landing place: there is one thing to do and a password manager may fill it.
      initialFocus={identifierRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {/*
            `form` associates this button with the form below, so it submits it from
            outside — which is what lets the actions sit in the dialog's footer (primary
            on top on a phone) while Enter in a field still submits.
          */}
          <Button type="submit" form={FORM_ID} loading={submitting} icon="ph-sign-in">
            {submitting ? 'Signing in' : 'Sign in'}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" title="We could not sign you in">
          <p>{error}</p>
          {needsVerification && (
            <p>
              <Link to="/verify-email" onClick={onClose} className={styles.inlineLink}>
                Send me a new verification link
              </Link>
            </p>
          )}
        </Alert>
      )}

      <form id={FORM_ID} className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field label="Mobile number or email" required error={errors.identifier}>
          <Input
            ref={identifierRef}
            // `username`, not `email`: this field takes either, and telling a password
            // manager it is an email address makes it offer the wrong saved value.
            autoComplete="username"
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value)
              if (errors.identifier) setErrors((current) => ({ ...current, identifier: undefined }))
            }}
          />
        </Field>

        <Field label="Password" required error={errors.password}>
          <PasswordInput
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              if (errors.password) setErrors((current) => ({ ...current, password: undefined }))
            }}
          />
        </Field>

        <div className={styles.links}>
          <Link to="/forgot-password" onClick={onClose}>
            Forgot your password?
          </Link>
        </div>
      </form>
    </Modal>
  )
}
