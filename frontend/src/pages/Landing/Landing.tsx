import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import { useAuth, ApiError } from '../../context/AuthContext'
import qrCode from '../../assets/my_qr.png'
import styles from './Landing.module.css'

/**
 * The registration wizard used to contain a fake client-side "OTP" step that
 * accepted the hardcoded string 123456. That step is gone: mobile verification
 * was never real, and email verification now happens for real, out of band, via
 * a single-use link sent to the student's inbox.
 */
type WizardStep = 'details' | 'payment' | 'success'

const CHAMPIONS = [
  { rank: '🥇', name: 'Amit Kumar', school: 'SGS DAV, Hanumangarh, Rajasthan', meta: 'Class 8 · 8.91s', badge: 'Golden Crown (+50 XP)' },
  { rank: '🥈', name: 'Aarav Mehta', school: 'DPS Delhi, New Delhi', meta: 'Class 10 · 9.12s', badge: 'Silver Crown (+30 XP)' },
  { rank: '🥉', name: 'Sneha Kulkarni', school: "St. Xavier's, Mumbai", meta: 'Class 9 · 9.35s', badge: 'Bronze Crown (+20 XP)' },
]

const FAQS = [
  { q: 'Who can participate?', a: 'Students from Class 5 to Class 12, across any school board, can register for the Olympiad.' },
  { q: 'Is there negative marking?', a: 'No — there is no negative marking. Attempt every question with confidence.' },
  { q: 'How will results be announced?', a: 'Results are published on your personal dashboard within 48 hours of your exam.' },
]

export default function Landing() {
  const navigate = useNavigate()
  const { register, login, resendVerification } = useAuth()

  const [step, setStep] = useState<WizardStep>('details')
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [registeredId, setRegisteredId] = useState('')
  const [resendNotice, setResendNotice] = useState('')

  const [loginOpen, setLoginOpen] = useState(false)
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [needsVerification, setNeedsVerification] = useState(false)
  const [loginSubmitting, setLoginSubmitting] = useState(false)

  function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!fullName.trim() || !mobile.trim() || !email.trim() || !password || !confirmPassword) {
      setFormError('Please fill in every field.')
      return
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setFormError('Password must contain at least one letter and one number.')
      return
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.')
      return
    }
    setStep('payment')
  }

  async function handlePaymentConfirm() {
    setSubmitting(true)
    setFormError('')
    try {
      const result = await register({
        fullName: fullName.trim(),
        mobile: mobile.trim(),
        email: email.trim(),
        password,
      })
      setRegisteredId(result.student.studentId)
      setStep('success')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Registration failed. Please try again.')
      setStep('details')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    setResendNotice('')
    try {
      setResendNotice(await resendVerification(email.trim()))
    } catch (err) {
      setResendNotice(err instanceof ApiError ? err.message : 'Could not send a new link.')
    }
  }

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault()
    setLoginError('')
    setNeedsVerification(false)
    setLoginSubmitting(true)
    try {
      await login(loginIdentifier.trim(), loginPassword)
      navigate('/dashboard')
    } catch (err) {
      if (err instanceof ApiError) {
        setLoginError(err.message)
        setNeedsVerification(err.code === 'EMAIL_NOT_VERIFIED')
      } else {
        setLoginError('Login failed.')
      }
    } finally {
      setLoginSubmitting(false)
    }
  }

  return (
    <div>
      <Navbar />

      <section className={styles.hero}>
        <div className={`container ${styles.heroInner}`}>
          <span className={styles.kicker}>🌟 National Level Mathematics Competition</span>
          <h1>AMIT MATHS OLYMPIAD 2027</h1>
          <p className={styles.tagline}>Think Faster. Solve Smarter. Become a Champion.</p>
          <div className={styles.heroActions}>
            <Button onClick={() => document.getElementById('register')?.scrollIntoView({ behavior: 'smooth' })}>
              Register Now ➔
            </Button>
            <Button variant="outline" onClick={() => setLoginOpen(true)}>
              Student Login 🔑
            </Button>
          </div>
        </div>
      </section>

      <section className={`container ${styles.stats}`}>
        <div className="card"><div className={styles.statValue}>142</div><div className={styles.statLabel}>Today's Registrations</div></div>
        <div className="card"><div className={styles.statValue}>1280</div><div className={styles.statLabel}>Challenges Solved Today</div></div>
        <div className="card"><div className={styles.statValue}>8.91s</div><div className={styles.statLabel}>Current Fastest Time</div></div>
        <div className="card"><div className={styles.statValue}>450+</div><div className={styles.statLabel}>Participating Schools</div></div>
      </section>

      <section className={`container ${styles.section}`}>
        <h2>🏆 Today's Champions</h2>
        <p>Publicly recognizing today's fastest problem-solving leaders</p>
        <div className={styles.championGrid}>
          {CHAMPIONS.map((c) => (
            <div className="card" key={c.name}>
              <div className={styles.championRank}>{c.rank}</div>
              <h3>{c.name}</h3>
              <p>{c.school}</p>
              <p className={styles.championMeta}>{c.meta}</p>
              <span className={styles.badge}>👑 {c.badge}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="register" className={`container ${styles.section}`}>
        <div className={`card ${styles.wizardCard}`}>
          <div className={styles.steps}>
            <span className={step === 'details' ? styles.stepActive : styles.stepDone}>1. Details</span>
            <span className={step === 'payment' ? styles.stepActive : step === 'success' ? styles.stepDone : ''}>2. Payment</span>
            <span className={step === 'success' ? styles.stepActive : ''}>3. Verify Email</span>
          </div>

          {formError && <p className="error-text">{formError}</p>}

          {step === 'details' && (
            <form onSubmit={handleDetailsSubmit}>
              <h2>Start Your Olympiad Journey</h2>
              <div className={styles.formGrid}>
                <div className="form-group">
                  <label htmlFor="reg-name">Student Name (Full Name)</label>
                  <input id="reg-name" className="form-control" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-mobile">Mobile Number (WhatsApp)</label>
                  <input id="reg-mobile" className="form-control" value={mobile} onChange={(e) => setMobile(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-email">Email Address</label>
                  <input
                    id="reg-email"
                    type="email"
                    className="form-control"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  <p className={styles.fieldHint}>We'll send a verification link here. You'll need it to sign in.</p>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-password">Password</label>
                  <input
                    id="reg-password"
                    type="password"
                    className="form-control"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <p className={styles.fieldHint}>At least 8 characters, including a letter and a number.</p>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-confirm">Confirm Password</label>
                  <input
                    id="reg-confirm"
                    type="password"
                    className="form-control"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <Button type="submit" fullWidth>
                Continue to Payment ➔
              </Button>
            </form>
          )}

          {step === 'payment' && (
            <div className={styles.center}>
              <h2>Scan &amp; Pay Registration Fee</h2>
              <div className={styles.qrBox}>
                <img src={qrCode} alt="Payment QR code" />
              </div>
              <Button onClick={handlePaymentConfirm} disabled={submitting} fullWidth>
                {submitting ? 'Creating your account...' : "I've Paid — Create My Account ➔"}
              </Button>
              <Button type="button" variant="ghost" fullWidth onClick={() => setStep('details')}>
                Back to details
              </Button>
            </div>
          )}

          {step === 'success' && (
            <div className={styles.center}>
              <span className={styles.successBadge}>📧</span>
              <h2>Almost there, {fullName}!</h2>
              <p>
                Your Student ID is <strong>{registeredId}</strong>. We've emailed a verification link to{' '}
                <strong>{email}</strong> — click it to activate your account, then sign in.
              </p>
              {resendNotice && <p className={styles.resendNotice}>{resendNotice}</p>}
              <Button variant="outline" fullWidth onClick={handleResend}>
                Didn't get it? Resend the link
              </Button>
              <Button variant="ghost" fullWidth onClick={() => setLoginOpen(true)}>
                I've verified — sign me in
              </Button>
            </div>
          )}
        </div>
      </section>

      <section className={`container ${styles.section}`}>
        <h2>Frequently Asked Questions</h2>
        {FAQS.map((f) => (
          <details className={styles.faqItem} key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <Footer />

      {loginOpen && (
        <div className={styles.modalOverlay} onClick={() => setLoginOpen(false)}>
          <div className={`card ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
            <h2>Student Login</h2>
            {loginError && <p className="error-text">{loginError}</p>}
            {needsVerification && (
              <p className={styles.resendNotice}>
                Need a new verification link?{' '}
                <Link to="/verify-email" onClick={() => setLoginOpen(false)}>
                  Request one here
                </Link>
                .
              </p>
            )}
            <form onSubmit={handleLoginSubmit}>
              <div className="form-group">
                <label htmlFor="login-identifier">Mobile Number or Email</label>
                <input
                  id="login-identifier"
                  className="form-control"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  type="password"
                  className="form-control"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" fullWidth disabled={loginSubmitting}>
                {loginSubmitting ? 'Signing in...' : 'Login & Enter Dashboard 🚀'}
              </Button>
              <div className={styles.modalLinks}>
                <Link to="/forgot-password" onClick={() => setLoginOpen(false)}>
                  Forgot your password?
                </Link>
              </div>
              <Button type="button" variant="ghost" fullWidth onClick={() => setLoginOpen(false)}>
                Cancel
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
