import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, API_BASE } from '../../api/client'
import type { Certificate } from '../../api/types'
import StudentShell from '../../components/StudentShell'
import Spinner from '../../components/Spinner'
import styles from './Certificates.module.css'

/**
 * The student's certificate library.
 *
 * Empty until an official exam result is released — and that is the honest state, not
 * a gap. Certificates come from the official Olympiad only; no mock test, practice
 * session or daily challenge earns one, and the page says so rather than leaving a
 * blank panel that reads as broken.
 */
export default function Certificates() {
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let cancelled = false

    api
      .get<{ certificates: Certificate[] }>('/me/certificates')
      .then((res) => {
        if (!cancelled) setCertificates(res.certificates)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your certificates.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <StudentShell title="My Certificates">
      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <Spinner label="Loading your certificates..." />
      ) : certificates.length === 0 ? (
        <div className={`card ${styles.empty}`}>
          <h3>No certificates yet</h3>
          <p>
            Certificates are awarded for the <strong>official Olympiad</strong> only — not for mock tests, the practice
            zone or the daily challenge. Once you have sat the official exam and the organisers release the results,
            your certificate will appear here.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {certificates.map((certificate) => (
            <article key={certificate.id} className={`card ${styles.card} ${certificate.revoked ? styles.revoked : ''}`}>
              <div className={styles.head}>
                <div>
                  <span className={styles[`tier_${certificate.tier}`]}>{certificate.title}</span>
                  <h3>{certificate.examTitle}</h3>
                  <span className={styles.code}>{certificate.examCode}</span>
                </div>
                <div className={styles.score}>
                  <strong>{certificate.percentage}%</strong>
                  <span>
                    {certificate.score} / {certificate.maxMarks}
                  </span>
                </div>
              </div>

              <dl className={styles.facts}>
                <div>
                  <dt>Rank</dt>
                  <dd>
                    {certificate.rank} of {certificate.totalCandidates}
                  </dd>
                </div>
                <div>
                  <dt>Certificate no.</dt>
                  <dd className={styles.mono}>{certificate.certificateId}</dd>
                </div>
                <div>
                  <dt>Issued</dt>
                  <dd>{new Date(certificate.issuedAt).toLocaleDateString()}</dd>
                </div>
              </dl>

              {certificate.revoked ? (
                <p className={styles.revokedNote}>
                  This certificate has been revoked{certificate.revokedReason ? `: ${certificate.revokedReason}` : ''}.
                  It can no longer be downloaded, and verification will report it as withdrawn.
                </p>
              ) : (
                <div className={styles.actions}>
                  {/*
                    A plain link rather than an api call: the response is a PDF, not the
                    JSON envelope `api.get` expects, and the cookie rides along because
                    it is same-origin in both environments.
                  */}
                  <a className={styles.download} href={`${API_BASE}/me/certificates/${certificate.id}/download`}>
                    Download PDF
                  </a>
                  {certificate.verificationCode && (
                    <>
                      <button
                        className={styles.copyBtn}
                        onClick={() => {
                          void navigator.clipboard
                            ?.writeText(certificate.verificationCode!)
                            .then(() => setCopied(certificate.id))
                        }}
                      >
                        {copied === certificate.id ? 'Code copied' : 'Copy verification code'}
                      </button>
                      <Link className={styles.verifyLink} to={`/verify/${certificate.verificationCode}`}>
                        Check it publicly
                      </Link>
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </StudentShell>
  )
}
