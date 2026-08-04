import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import { useAuth, ApiError } from '../../context/AuthContext'
import styles from './AuthForms.module.css'

export default function ForgotPassword() {
  const { forgotPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setSubmitting(true)
    try {
      setNotice(await forgotPassword(email.trim()))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the reset link. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <Navbar />
      <div className={styles.wrap}>
        <div className={`card ${styles.card}`}>
          <h1>Forgot your password?</h1>
          <p className={styles.lead}>
            Enter the email address on your account and we'll send you a link to choose a new password.
          </p>

          {error && <p className="error-text">{error}</p>}

          {notice ? (
            <>
              <p className={`${styles.notice} ${styles.success}`}>{notice}</p>
              <div className={styles.footerLinks}>
                <Link to="/">Back to home</Link>
              </div>
            </>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="forgot-email">Email address</label>
                <input
                  id="forgot-email"
                  type="email"
                  className="form-control"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" fullWidth disabled={submitting}>
                {submitting ? 'Sending...' : 'Send reset link'}
              </Button>
              <div className={styles.footerLinks}>
                <Link to="/">Back to home</Link>
              </div>
            </form>
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}
