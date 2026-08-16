import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import { useAuth, ApiError } from '../../context/AuthContext'
import { api } from '../../api/client'
import { CLASS_LEVELS, type ClassLevel, type LeaderboardRow, type PublicStats } from '../../api/types'
import styles from './Landing.module.css'

/**
 * The registration wizard used to contain a fake client-side "OTP" step that
 * accepted the hardcoded string 123456. That step is gone: mobile verification
 * was never real, and email verification now happens for real, out of band, via
 * a single-use link sent to the student's inbox.
 */
type WizardStep = 'details' | 'payment' | 'success'

/**
 * The champions list and the four headline figures used to be hardcoded here —
 * invented names, schools and solve times, plus "450+ participating schools". They
 * are now fetched from `GET /leaderboard` and `GET /public/stats`, both of which
 * return real counts. Where there is no data yet, the section says so rather than
 * showing a number nobody can account for.
 */
const MEDALS = ['🥇', '🥈', '🥉']

const FAQS = [
  { q: 'Who can participate?', a: 'Students from Class 5 to Class 12, across any school board, can register for the Olympiad.' },
  { q: 'Is there negative marking?', a: 'No — there is no negative marking. Attempt every question with confidence.' },
  { q: 'How will results be announced?', a: 'Results are published on your personal dashboard within 48 hours of your exam.' },
]

const EMPTY_FORM = {
  firstName: '',
  middleName: '',
  lastName: '',
  fatherName: '',
  motherName: '',
  dateOfBirth: '',
  classLevel: '',
  schoolName: '',
  address: '',
  mobile: '',
  email: '',
  password: '',
  confirmPassword: '',
}

type FormField = keyof typeof EMPTY_FORM

interface SelectedPhoto {
  dataUrl: string
  name: string
  size: number
}

/** Kept in step with the backend's `MAX_PHOTO_BYTES`. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Marks a field the student must fill in. */
function Required() {
  return (
    <span className={styles.required} aria-hidden="true">
      *
    </span>
  )
}

/** Reads a chosen file into the base64 data URL the API expects. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

/**
 * The labels the wizard shows for each required field, so a missing one can be
 * named specifically instead of the old blanket "Please fill in every field."
 */
const REQUIRED_FIELDS: Array<[FormField, string]> = [
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['fatherName', "Father's name"],
  ['motherName', "Mother's name"],
  ['mobile', 'Mobile number'],
  ['email', 'Email address'],
  ['dateOfBirth', 'Date of birth'],
  ['classLevel', 'Class'],
  ['schoolName', 'Current school name'],
  ['address', 'Full address'],
]

export default function Landing() {
  const navigate = useNavigate()
  const { register, login, resendVerification } = useAuth()

  const [step, setStep] = useState<WizardStep>('details')
  const [form, setForm] = useState(EMPTY_FORM)
  const [photo, setPhoto] = useState<SelectedPhoto | null>(null)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [registeredId, setRegisteredId] = useState('')
  const [resendNotice, setResendNotice] = useState('')

  // Real public figures. Both are best-effort: the landing page must still render if
  // the API is unreachable, so a failure leaves them empty rather than blocking the
  // registration form behind an error screen.
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [champions, setChampions] = useState<LeaderboardRow[] | null>(null)

  const [loginOpen, setLoginOpen] = useState(false)
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [needsVerification, setNeedsVerification] = useState(false)
  const [loginSubmitting, setLoginSubmitting] = useState(false)

  useEffect(() => {
    void api
      .get<{ stats: PublicStats }>('/public/stats')
      .then((res) => setStats(res.stats))
      .catch(() => setStats(null))
    void api
      .get<{ leaderboard: LeaderboardRow[] }>('/leaderboard?limit=3')
      .then((res) => setChampions(res.leaderboard))
      .catch(() => setChampions([]))
  }, [])

  const setField = (field: FormField) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((current) => ({ ...current, [field]: e.target.value }))
  }

  /**
   * Validated here as well as on the server so a mistake is caught before the
   * student is sent to the payment step. The server's zod schema remains the
   * authority — this is convenience, not a security boundary.
   */
  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    setFormError('')
    const file = e.target.files?.[0]
    if (!file) {
      setPhoto(null)
      return
    }
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setPhoto(null)
      setFormError('The photo must be a JPEG, PNG or WebP image.')
      e.target.value = ''
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhoto(null)
      setFormError(`That photo is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Please choose one of 2 MB or less.`)
      e.target.value = ''
      return
    }
    try {
      setPhoto({ dataUrl: await readAsDataUrl(file), name: file.name, size: file.size })
    } catch {
      setPhoto(null)
      setFormError('Could not read that file. Please choose it again.')
    }
  }

  function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError('')

    const missing = REQUIRED_FIELDS.find(([field]) => !form[field].trim())
    if (missing) {
      setFormError(`${missing[1]} is required.`)
      return
    }
    if (!photo) {
      setFormError('A photo is required. Please upload one of 2 MB or less.')
      return
    }
    if (form.password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    if (!/[a-zA-Z]/.test(form.password) || !/\d/.test(form.password)) {
      setFormError('Password must contain at least one letter and one number.')
      return
    }
    if (form.password !== form.confirmPassword) {
      setFormError('Passwords do not match.')
      return
    }
    setStep('payment')
  }

  async function handlePaymentConfirm() {
    if (!photo) {
      setFormError('A photo is required.')
      setStep('details')
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      const result = await register({
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim(),
        lastName: form.lastName.trim(),
        fatherName: form.fatherName.trim(),
        motherName: form.motherName.trim(),
        dateOfBirth: form.dateOfBirth,
        classLevel: form.classLevel as ClassLevel,
        schoolName: form.schoolName.trim(),
        address: form.address.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim(),
        password: form.password,
        photo: photo.dataUrl,
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
      setResendNotice(await resendVerification(form.email.trim()))
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

      {/* Real counts, or nothing at all — never a placeholder headline number. */}
      {stats && (
        <section className={`container ${styles.stats}`}>
          <div className="card">
            <div className={styles.statValue}>{stats.studentsRegistered.toLocaleString()}</div>
            <div className={styles.statLabel}>Students Registered</div>
          </div>
          <div className="card">
            <div className={styles.statValue}>{stats.registeredToday.toLocaleString()}</div>
            <div className={styles.statLabel}>Registered Today</div>
          </div>
          <div className="card">
            <div className={styles.statValue}>{stats.studentsActiveToday.toLocaleString()}</div>
            <div className={styles.statLabel}>Active Today</div>
          </div>
          <div className="card">
            <div className={styles.statValue}>{stats.schoolsRepresented.toLocaleString()}</div>
            <div className={styles.statLabel}>Schools Represented</div>
          </div>
        </section>
      )}

      <section className={`container ${styles.section}`}>
        <h2>🏆 Top Scholars</h2>
        <p>The highest XP earned so far, straight from the leaderboard</p>
        {champions === null ? (
          <p className={styles.championMeta}>Loading the leaderboard…</p>
        ) : champions.length === 0 ? (
          <div className="card">
            <p>
              No one is on the leaderboard yet. Register below, and you could be the first name here.
            </p>
          </div>
        ) : (
          <div className={styles.championGrid}>
            {champions.map((row, index) => (
              <div className="card" key={row.studentId}>
                <div className={styles.championRank}>{MEDALS[index] ?? `#${row.rank}`}</div>
                {/* The API publishes a first name and a last initial only — these are
                    schoolchildren and this page is public. */}
                <h3>{row.displayName}</h3>
                {row.schoolName && <p>{row.schoolName}</p>}
                <p className={styles.championMeta}>
                  {row.classLevel ? `${row.classLevel} · ` : ''}Rank #{row.rank}
                </p>
                <span className={styles.badge}>👑 {row.xp.toLocaleString()} XP</span>
              </div>
            ))}
          </div>
        )}
        {/* The top three are a taste of the standing; the full board is public too, and
            can be filtered by class and by period. */}
        <p className={styles.championMeta}>
          <Link to="/leaderboard">See the full leaderboard</Link> · <Link to="/hall-of-fame">Hall of Fame</Link>
        </p>
      </section>

      <section id="register" className={`container ${styles.section}`}>
        <div className={`card ${styles.wizardCard}`}>
          <div className={styles.steps}>
            <span className={step === 'details' ? styles.stepActive : styles.stepDone}>1. Details</span>
            <span className={step === 'payment' ? styles.stepActive : step === 'success' ? styles.stepDone : ''}>2. Confirm</span>
            <span className={step === 'success' ? styles.stepActive : ''}>3. Verify Email</span>
          </div>

          {formError && <p className="error-text">{formError}</p>}

          {step === 'details' && (
            <form onSubmit={handleDetailsSubmit} noValidate>
              <h2>Start Your Olympiad Journey</h2>
              <p className={styles.requiredLegend}>
                Fields marked <Required /> are required.
              </p>

              <h3 className={styles.formSectionTitle}>Student details</h3>
              <div className={styles.formGrid}>
                <div className="form-group">
                  <label htmlFor="reg-first-name">
                    First Name <Required />
                  </label>
                  <input id="reg-first-name" className="form-control" value={form.firstName} onChange={setField('firstName')} required />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-middle-name">Middle Name</label>
                  <input id="reg-middle-name" className="form-control" value={form.middleName} onChange={setField('middleName')} />
                  <p className={styles.fieldHint}>Leave blank if you don't have one.</p>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-last-name">
                    Last Name <Required />
                  </label>
                  <input id="reg-last-name" className="form-control" value={form.lastName} onChange={setField('lastName')} required />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-father-name">
                    Father's Name <Required />
                  </label>
                  <input id="reg-father-name" className="form-control" value={form.fatherName} onChange={setField('fatherName')} required />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-mother-name">
                    Mother's Name <Required />
                  </label>
                  <input id="reg-mother-name" className="form-control" value={form.motherName} onChange={setField('motherName')} required />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-dob">
                    Date of Birth <Required />
                  </label>
                  <input
                    id="reg-dob"
                    type="date"
                    className="form-control"
                    value={form.dateOfBirth}
                    onChange={setField('dateOfBirth')}
                    max={new Date().toISOString().slice(0, 10)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-class">
                    Class <Required />
                  </label>
                  <select id="reg-class" className="form-control" value={form.classLevel} onChange={setField('classLevel')} required>
                    <option value="">Select your class</option>
                    {CLASS_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-school">
                    Current School Name <Required />
                  </label>
                  <input id="reg-school" className="form-control" value={form.schoolName} onChange={setField('schoolName')} required />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="reg-address">
                  Full Address <Required />
                </label>
                <textarea
                  id="reg-address"
                  className="form-control"
                  rows={3}
                  value={form.address}
                  onChange={setField('address')}
                  required
                />
                <p className={styles.fieldHint}>House / street, city, state and PIN code.</p>
              </div>

              <h3 className={styles.formSectionTitle}>Photo</h3>
              <div className="form-group">
                <label htmlFor="reg-photo">
                  Passport-style Photo <Required />
                </label>
                <input
                  id="reg-photo"
                  type="file"
                  className="form-control"
                  accept={ACCEPTED_PHOTO_TYPES.join(',')}
                  onChange={handlePhotoChange}
                  required
                />
                <p className={styles.fieldHint}>JPEG, PNG or WebP, up to 2 MB.</p>
                {photo && (
                  <div className={styles.photoPreview}>
                    <img src={photo.dataUrl} alt="Your uploaded photo" />
                    <span>
                      {photo.name} · {(photo.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                )}
              </div>

              <h3 className={styles.formSectionTitle}>Contact &amp; sign-in</h3>
              <div className={styles.formGrid}>
                <div className="form-group">
                  <label htmlFor="reg-mobile">
                    Mobile Number (WhatsApp) <Required />
                  </label>
                  <input
                    id="reg-mobile"
                    type="tel"
                    inputMode="numeric"
                    className="form-control"
                    value={form.mobile}
                    onChange={setField('mobile')}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-email">
                    Email Address <Required />
                  </label>
                  <input id="reg-email" type="email" className="form-control" value={form.email} onChange={setField('email')} required />
                  <p className={styles.fieldHint}>We'll send a verification link here. You'll need it to sign in.</p>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-password">
                    Password <Required />
                  </label>
                  <input
                    id="reg-password"
                    type="password"
                    className="form-control"
                    value={form.password}
                    onChange={setField('password')}
                    required
                  />
                  <p className={styles.fieldHint}>At least 8 characters, including a letter and a number.</p>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-confirm">
                    Confirm Password <Required />
                  </label>
                  <input
                    id="reg-confirm"
                    type="password"
                    className="form-control"
                    value={form.confirmPassword}
                    onChange={setField('confirmPassword')}
                    required
                  />
                </div>
              </div>
              <Button type="submit" fullWidth>
                Continue to Payment ➔
              </Button>
            </form>
          )}

          {/*
            The entry fee is NOT collected here, and the QR code that used to sit on this
            step is gone (Milestone 19).

            It could not be made real: at this point there is no account and no session,
            and a Razorpay order has to be recorded against a student — that is what makes
            the entitlement work and what stops one person's payment entitling another.
            Registration also deliberately issues no session until the email is verified.

            What was here before was worse than nothing: a static QR and an "I've Paid"
            button that recorded no payment, verified nothing, and created the account
            regardless. It told every student something untrue.
          */}
          {step === 'payment' && (
            <div className={styles.center}>
              <h2>One last thing</h2>
              <p className={styles.payNote}>
                Creating your account is <strong>free</strong>. Practice, mock tests, the daily challenge and your
                performance analytics are all included at no cost.
              </p>
              <p className={styles.payNote}>
                The <strong>Olympiad entry fee</strong> is paid separately once your account is active — by UPI, card,
                net banking or wallet. You will see it on your dashboard after you verify your email.
              </p>
              <Button onClick={handlePaymentConfirm} disabled={submitting} fullWidth>
                {submitting ? 'Creating your account...' : 'Create My Account ➔'}
              </Button>
              <Button type="button" variant="ghost" fullWidth onClick={() => setStep('details')}>
                Back to details
              </Button>
            </div>
          )}

          {step === 'success' && (
            <div className={styles.center}>
              <span className={styles.successBadge}>📧</span>
              <h2>Almost there, {form.firstName}!</h2>
              <p>
                Your Student ID is <strong>{registeredId}</strong>. We've emailed a verification link to{' '}
                <strong>{form.email}</strong> — click it to activate your account, then sign in.
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
