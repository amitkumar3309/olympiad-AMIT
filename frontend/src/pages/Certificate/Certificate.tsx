import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import type { EarnedCertificate } from '../../api/types'
import logo from '../../assets/logo.png'
import styles from './Certificate.module.css'

/**
 * Digital certificates.
 *
 * **This page used to issue an award nobody had earned.** It rendered "For outstanding
 * participation and achievement in the A.M.I.T Maths Olympiad 2027" for anyone who was
 * signed in — or "Future Champion / AMIT_XXXX" for a guest — stamped with today's date
 * and the student's own ID as the certificate number, all client-side with no server
 * call. A student could print it the minute they registered.
 *
 * It now asks `GET /certificates/:studentId`, which returns only certificates backed by
 * a **published result**. Nothing writes one yet, so the honest answer for everybody is
 * that there is nothing to issue, and the page says so instead of printing a credential.
 */
export default function Certificate() {
  const { state } = useAuth()
  const student = state.status === 'student' ? state.student : null

  const [certificates, setCertificates] = useState<EarnedCertificate[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!student) return
    let cancelled = false
    api
      .get<{ certificates: EarnedCertificate[] }>(`/certificates/${student.studentId}`)
      .then((res) => {
        if (!cancelled) setCertificates(res.certificates)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your certificates.')
      })
    return () => {
      cancelled = true
    }
  }, [student])

  return (
    <div>
      <Navbar />
      <div className={`container ${styles.wrap}`}>
        <h1>Digital Certificate</h1>

        {/* A guest is told what a certificate requires, rather than being shown a
            filled-in specimen with a placeholder name on it. */}
        {!student && (
          <div className={`card ${styles.pending}`}>
            <i className="ph-bold ph-certificate" />
            <h2>Sign in to see your certificates</h2>
            <p>
              Certificates are issued to registered students after the Olympiad has been held and results are
              published. <Link to="/">Register or sign in</Link> to check yours.
            </p>
          </div>
        )}

        {student && error && <p className="error-text">{error}</p>}
        {student && !certificates && !error && <Spinner label="Checking for your certificates..." />}

        {student && certificates?.length === 0 && (
          <div className={`card ${styles.pending}`}>
            <i className="ph-bold ph-certificate" />
            <h2>No certificate yet</h2>
            <p>
              A certificate is issued once you have sat the Olympiad and your result has been published. The exam has
              not been held yet, so there is nothing to issue — and we will not print one that has not been earned.
            </p>
            <p className={styles.pendingNote}>
              Your certificate will appear here automatically. In the meantime, your progress is on your{' '}
              <Link to="/dashboard">dashboard</Link>.
            </p>
          </div>
        )}

        {/* Rendered only from a real, server-issued certificate record. */}
        {certificates?.map((certificate) => (
          <div key={certificate.id}>
            <div className={styles.certificate}>
              <img src={logo} alt="A.M.I.T Olympiad" className={styles.certLogo} />
              <p className={styles.presented}>This certificate is proudly presented to</p>
              <h2 className={styles.recipient}>{certificate.studentName ?? certificate.studentId}</h2>
              <p className={styles.desc}>{certificate.title}</p>
              <div className={styles.metaRow}>
                <div>
                  <span className={styles.metaLabel}>Certificate ID</span>
                  <span className={styles.metaValue}>{certificate.id}</span>
                </div>
                <div>
                  <span className={styles.metaLabel}>Date Issued</span>
                  <span className={styles.metaValue}>
                    {certificate.issuedAt
                      ? new Date(certificate.issuedAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                        })
                      : '—'}
                  </span>
                </div>
                {certificate.percentile !== null && (
                  <div>
                    <span className={styles.metaLabel}>Percentile</span>
                    <span className={styles.metaValue}>{certificate.percentile}%</span>
                  </div>
                )}
              </div>
              <p className={styles.signature}>Amit Kumar — Founder &amp; M.D.</p>
            </div>

            <div className={styles.actions}>
              <Button variant="outline" onClick={() => window.print()}>
                <i className="ph ph-printer" /> Download / Print
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Footer />
    </div>
  )
}
