import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import { useAuth, ApiError } from '../../context/AuthContext'
import styles from './AuthForms.module.css'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { resetPassword } = useAuth()
  const token = params.get('token')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      setNotice(await resetPassword(token!, password))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <div>
        <Navbar />
        <div className={styles.wrap}>
          <div className={`card ${styles.card}`}>
            <span className={styles.statusIcon}>⚠️</span>
            <h1>Reset link needed</h1>
            <p className={styles.lead}>
              This page needs the link from your password reset email. Request a new one if you no longer have it.
            </p>
            <Button fullWidth onClick={() => navigate('/forgot-password')}>
              Request a reset link
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div>
      <Navbar />
      <div className={styles.wrap}>
        <div className={`card ${styles.card}`}>
          <h1>Choose a new password</h1>

          {notice ? (
            <>
              <span className={styles.statusIcon}>✅</span>
              <p className={`${styles.notice} ${styles.success}`}>{notice}</p>
              <Button fullWidth onClick={() => navigate('/')}>
                Go to sign in
              </Button>
            </>
          ) : (
            <>
              <p className={styles.lead}>
                For your security, choosing a new password signs you out of every device.
              </p>
              {error && <p className="error-text">{error}</p>}
              <form className={styles.form} onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    className="form-control"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <p className={styles.hint}>At least 8 characters, including a letter and a number.</p>
                </div>
                <div className="form-group">
                  <label htmlFor="confirm-password">Confirm new password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    className="form-control"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" fullWidth disabled={submitting}>
                  {submitting ? 'Updating...' : 'Update my password'}
                </Button>
                <div className={styles.footerLinks}>
                  <Link to="/forgot-password">Request a new reset link</Link>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}
