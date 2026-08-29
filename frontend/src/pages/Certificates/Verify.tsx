import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { VerificationResponse } from '../../api/types'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import { Icon } from '../../components/ui'
import styles from './Verify.module.css'

/**
 * Public certificate verification.
 *
 * Deliberately reachable without an account — the whole point is that a school, a
 * parent or an employer can check a document they have been handed. Everything shown
 * comes from the certificate's own snapshot, so this confirms the paper in somebody's
 * hand rather than whatever the live records happen to say today.
 */
export default function Verify() {
  const { code: codeFromUrl } = useParams<{ code?: string }>()
  const navigate = useNavigate()

  const [code, setCode] = useState(codeFromUrl ?? '')
  const [result, setResult] = useState<VerificationResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!codeFromUrl) return
    setCode(codeFromUrl)
    void check(codeFromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFromUrl])

  async function check(value: string) {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.get<VerificationResponse>(`/verify/${encodeURIComponent(value.trim())}`))
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not check that code. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) return
    navigate(`/verify/${encodeURIComponent(trimmed)}`)
    void check(trimmed)
  }

  return (
    <>
      <Navbar />
      <main className={styles.wrap}>
        <header className={styles.header}>
          <h1>Verify a certificate</h1>
          <p>
            Enter the verification code printed on an A.M.I.T Maths Olympiad certificate to confirm it is genuine. No
            account is needed.
          </p>
        </header>

        <form className={`card ${styles.form}`} onSubmit={onSubmit}>
          <label htmlFor="v-code">Verification code</label>
          <div className={styles.row}>
            <input
              id="v-code"
              className="form-control"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
            />
            <Button type="submit" disabled={loading || !code.trim()}>
              {loading ? 'Checking...' : 'Verify'}
            </Button>
          </div>
          <small className={styles.hint}>Dashes and capitals do not matter.</small>
        </form>

        {error && <p className="error-text">{error}</p>}
        {loading && <Spinner label="Checking..." />}

        {result && result.status === 'not-found' && (
          <div className={`card ${styles.bad}`}>
            <h2>No certificate matches that code</h2>
            <p>
              Check the code against the printed certificate. If it still does not match, the document may not have
              been issued by A.M.I.T Maths Olympiad.
            </p>
          </div>
        )}

        {result?.certificate && (
          <div className={`card ${result.valid ? styles.good : styles.withdrawn}`}>
            <div className={styles.verdict}>
              {result.valid ? (
                <>
                  <Icon name="ph-check" weight="bold" size="sm" className={styles.tick} />
                  <div>
                    <h2>This certificate is genuine</h2>
                    <p>Issued by A.M.I.T Maths Olympiad and not withdrawn.</p>
                  </div>
                </>
              ) : (
                <>
                  <span className={styles.cross}>!</span>
                  <div>
                    <h2>This certificate has been withdrawn</h2>
                    <p>
                      It was genuinely issued, and has since been revoked
                      {result.revokedReason ? `: ${result.revokedReason}` : ''}. It should no longer be relied on.
                    </p>
                  </div>
                </>
              )}
            </div>

            <dl className={styles.details}>
              <div>
                <dt>Awarded to</dt>
                <dd>
                  <strong>{result.certificate.studentName}</strong>
                  <span className={styles.mono}>{result.certificate.studentIdLabel}</span>
                </dd>
              </div>
              <div>
                <dt>Award</dt>
                <dd>{result.certificate.title}</dd>
              </div>
              <div>
                <dt>Class</dt>
                <dd>{result.certificate.classLevel}</dd>
              </div>
              {result.certificate.schoolName && (
                <div>
                  <dt>School</dt>
                  <dd>{result.certificate.schoolName}</dd>
                </div>
              )}
              <div>
                <dt>Examination</dt>
                <dd>
                  {result.certificate.examTitle}
                  <span className={styles.mono}>{result.certificate.examCode}</span>
                </dd>
              </div>
              <div>
                <dt>Result</dt>
                <dd>
                  {result.certificate.score} / {result.certificate.maxMarks} ({result.certificate.percentage}%) · rank{' '}
                  {result.certificate.rank} of {result.certificate.totalCandidates}
                </dd>
              </div>
              <div>
                <dt>Certificate no.</dt>
                <dd className={styles.mono}>{result.certificate.certificateId}</dd>
              </div>
              <div>
                <dt>Issued</dt>
                <dd>{new Date(result.certificate.issuedAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}
