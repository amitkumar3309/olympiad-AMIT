import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { useAuth, ApiError } from '../../context/AuthContext'
import styles from './AuthForms.module.css'

type Phase = 'verifying' | 'success' | 'failed' | 'noToken'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { verifyEmail, resendVerification } = useAuth()
  const token = params.get('token')

  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'noToken')
  const [message, setMessage] = useState('')
  const [resendEmail, setResendEmail] = useState('')
  const [resendNotice, setResendNotice] = useState('')
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
        setMessage(err instanceof ApiError ? err.message : 'Could not verify your email.')
        setPhase('failed')
      })
  }, [token, verifyEmail])

  const handleResend = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setResending(true)
      setResendNotice('')
      try {
        setResendNotice(await resendVerification(resendEmail.trim()))
      } catch (err) {
        setResendNotice(err instanceof ApiError ? err.message : 'Could not send a new link.')
      } finally {
        setResending(false)
      }
    },
    [resendEmail, resendVerification],
  )

  return (
    <div>
      <Navbar />
      <div className={styles.wrap}>
        <div className={`card ${styles.card}`}>
          {phase === 'verifying' && <Spinner label="Verifying your email address..." />}

          {phase === 'success' && (
            <>
              <span className={styles.statusIcon}>✅</span>
              <h1>Email verified</h1>
              <p className={styles.lead}>{message}</p>
              <Button fullWidth onClick={() => navigate('/')}>
                Continue to sign in
              </Button>
            </>
          )}

          {(phase === 'failed' || phase === 'noToken') && (
            <>
              <span className={styles.statusIcon}>⚠️</span>
              <h1>{phase === 'noToken' ? 'Verification link needed' : 'Verification failed'}</h1>
              <p className={styles.lead}>
                {phase === 'noToken'
                  ? 'Open the link from your verification email, or request a new one below.'
                  : message}
              </p>

              {resendNotice && <p className={`${styles.notice} ${styles.success}`}>{resendNotice}</p>}

              <form className={styles.form} onSubmit={handleResend}>
                <div className="form-group">
                  <label htmlFor="resend-email">Your email address</label>
                  <input
                    id="resend-email"
                    type="email"
                    className="form-control"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" fullWidth disabled={resending}>
                  {resending ? 'Sending...' : 'Send me a new link'}
                </Button>
              </form>

              <div className={styles.footerLinks}>
                <Link to="/">Back to home</Link>
              </div>
            </>
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}
