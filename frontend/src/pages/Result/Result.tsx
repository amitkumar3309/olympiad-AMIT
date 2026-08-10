import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import { api, ApiError } from '../../api/client'
import type { PublishedResult, ResultResponse } from '../../api/types'
import styles from './Result.module.css'

/**
 * The public result portal.
 *
 * **This page used to fabricate results.** It hashed whatever string was typed into
 * the search box and derived a score, a national rank and a percentile from it — so
 * any visitor could enter any ID, including one that did not exist, and be shown an
 * authoritative-looking "72/100 · National Rank #146 · 91.4th percentile" for a
 * competition that has not been sat. There was no server call at all.
 *
 * It now queries `GET /results/:studentId`, which returns only **published** results
 * from the real collection. Nothing writes one yet, so every lookup honestly reports
 * that no result has been published — which is the truth, and infinitely more useful
 * to a parent than a convincing fiction.
 */
export default function Result() {
  const [studentId, setStudentId] = useState('')
  const [result, setResult] = useState<PublishedResult | null>(null)
  const [notPublished, setNotPublished] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  async function fetchResult(e: FormEvent) {
    e.preventDefault()
    const trimmed = studentId.trim().toUpperCase()

    setError('')
    setResult(null)
    setNotPublished(false)

    if (!trimmed) {
      setError('Please enter your Student ID.')
      return
    }
    // Checked here as well as by the server so an obvious typo gets an immediate,
    // specific message rather than a round trip and a generic 400.
    if (!/^AMIT_\d{4}$/.test(trimmed)) {
      setError('Student IDs look like AMIT_0000. Check the ID on your registration email.')
      return
    }

    setSearching(true)
    try {
      const res = await api.get<ResultResponse>(`/results/${trimmed}`)
      if (res.result) setResult(res.result)
      else setNotPublished(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not look up that result. Please try again.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div>
      <Navbar />
      <div className={`container ${styles.wrap}`}>
        <h1>Result Portal</h1>
        <p>Enter your Student ID to check your Olympiad result.</p>

        <form className={styles.searchRow} onSubmit={(e) => void fetchResult(e)}>
          <input
            className="form-control"
            placeholder="e.g. AMIT_7821"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            aria-label="Student ID"
          />
          <Button type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search'} <i className="ph ph-magnifying-glass" />
          </Button>
        </form>
        {error && <p className="error-text">{error}</p>}

        {notPublished && (
          <div className={`card ${styles.notPublished}`}>
            <i className="ph-bold ph-clock-countdown" />
            <h2>No result published yet</h2>
            <p>
              Results are published here once the Olympiad has been held and marking is complete. Nothing has been
              released yet, so there is nothing to show for any Student ID.
            </p>
            <p className={styles.notPublishedNote}>
              Registered students can follow their progress in the meantime on their{' '}
              <Link to="/dashboard">dashboard</Link>.
            </p>
          </div>
        )}

        {result && (
          <div className={`card ${styles.resultCard}`}>
            <h2 id="res-name">{result.studentName ?? result.studentId}</h2>
            <p className={styles.idLine}>{result.studentId}</p>
            <div className={styles.scoreRow}>
              <div>
                <span className={styles.scoreValue}>
                  {result.score}/{result.totalMarks}
                </span>
                <span className={styles.scoreLabel}>Score</span>
              </div>
              {/* Each rank is shown only when it was actually computed. A dash is
                  honest; a zero or a guess would not be. */}
              {result.nationalRank !== null && (
                <div>
                  <span className={styles.scoreValue}>#{result.nationalRank}</span>
                  <span className={styles.scoreLabel}>National Rank</span>
                </div>
              )}
              {result.percentile !== null && (
                <div>
                  <span className={styles.scoreValue}>{result.percentile}%</span>
                  <span className={styles.scoreLabel}>Percentile</span>
                </div>
              )}
              <div>
                <span className={styles.scoreValue}>{result.accuracy}%</span>
                <span className={styles.scoreLabel}>Accuracy</span>
              </div>
            </div>
            {result.badges.length > 0 && (
              <ul className={styles.badges}>
                {result.badges.map((badge) => (
                  <li key={badge}>{badge}</li>
                ))}
              </ul>
            )}
            <div className={styles.actions}>
              <Button variant="outline" onClick={() => window.print()}>
                <i className="ph ph-printer" /> Download / Print Card
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  navigator.share?.({
                    title: 'My AMIT Olympiad Result',
                    text: `I scored ${result.score}/${result.totalMarks}!`,
                  })
                }
              >
                <i className="ph ph-share-network" /> Share
              </Button>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}
