import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import { useAuth, ApiError } from '../../context/AuthContext'
import qrCode from '../../assets/my_qr.png'
import styles from './Landing.module.css'

type WizardStep = 'details' | 'otp' | 'payment' | 'success'

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
  const { register, login } = useAuth()

  const [step, setStep] = useState<WizardStep>('details')
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [registeredId, setRegisteredId] = useState('')

  const [loginOpen, setLoginOpen] = useState(false)
  const [loginMobile, setLoginMobile] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginSubmitting, setLoginSubmitting] = useState(false)

  function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!fullName.trim() || !mobile.trim() || !password || !confirmPassword) {
      setFormError('Please fill in every field.')
      return
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.')
      return
    }
    setStep('otp')
  }

  function handleOtpSubmit(e: FormEvent) {
    e.preventDefault()
    if (otp.trim() !== '123456') {
      setFormError("Incorrect OTP. Enter '123456' for this demo verification step.")
      return
    }
    setFormError('')
    setStep('payment')
  }

  async function handlePaymentConfirm() {
    setSubmitting(true)
    setFormError('')
    try {
      const student = await register(fullName.trim(), mobile.trim(), password)
      setRegisteredId(student.studentId)
      setStep('success')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Registration failed. Please try again.')
      setStep('details')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault()
    setLoginError('')
    setLoginSubmitting(true)
    try {
      await login(loginMobile.trim(), loginPassword)
      navigate('/dashboard')
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : 'Login failed.')
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
            <span className={step === 'otp' ? styles.stepActive : step === 'details' ? '' : styles.stepDone}>2. OTP Verification</span>
            <span className={step === 'payment' ? styles.stepActive : step === 'success' ? styles.stepDone : ''}>3. Payment</span>
            <span className={step === 'success' ? styles.stepActive : ''}>4. Done</span>
          </div>

          {formError && <p className="error-text">{formError}</p>}

          {step === 'details' && (
            <form onSubmit={handleDetailsSubmit}>
              <h2>Start Your Olympiad Journey</h2>
              <div className={styles.formGrid}>
                <div className="form-group">
                  <label>Student Name (Full Name)</label>
                  <input className="form-control" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Mobile Number (WhatsApp)</label>
                  <input className="form-control" value={mobile} onChange={(e) => setMobile(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input type="password" className="form-control" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Confirm Password</label>
                  <input
                    type="password"
                    className="form-control"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <Button type="submit" fullWidth>
                Verify Mobile via OTP ➔
              </Button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleOtpSubmit}>
              <h2>Mobile Number Verification (OTP)</h2>
              <p>We have sent a 6-digit OTP to your mobile number. (For demo testing, enter: <strong>123456</strong>)</p>
              <div className="form-group">
                <input
                  className={`form-control ${styles.otpInput}`}
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="Enter 6-digit OTP"
                />
              </div>
              <Button type="submit" fullWidth>
                Verify &amp; Proceed to Payment ➔
              </Button>
              <Button type="button" variant="ghost" fullWidth onClick={() => setStep('details')}>
                Cancel / Edit Form
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
                {submitting ? 'Confirming...' : "I've Paid — Complete Registration ➔"}
              </Button>
            </div>
          )}

          {step === 'success' && (
            <div className={styles.center}>
              <span className={styles.successBadge}>✅</span>
              <h2>Welcome, {fullName}!</h2>
              <p>
                Your Student ID is <strong>{registeredId}</strong>. You're now logged in — head to your dashboard to
                get started.
              </p>
              <Button onClick={() => navigate('/dashboard')} fullWidth>
                Go to Dashboard 🚀
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
            <form onSubmit={handleLoginSubmit}>
              <div className="form-group">
                <label>Mobile Number</label>
                <input className="form-control" value={loginMobile} onChange={(e) => setLoginMobile(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  className="form-control"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" fullWidth disabled={loginSubmitting}>
                {loginSubmitting ? 'Logging in...' : 'Login & Enter Dashboard 🚀'}
              </Button>
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
