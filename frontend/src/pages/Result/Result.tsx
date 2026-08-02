import { useState, type FormEvent } from 'react'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import styles from './Result.module.css'

interface ResultData {
  name: string
  studentId: string
  score: number
  totalMarks: number
  nationalRank: number
  percentile: number
}

function mockLookup(studentId: string): ResultData {
  let hash = 0
  for (const ch of studentId) hash = (hash * 31 + ch.charCodeAt(0)) % 10000
  return {
    name: 'Registered Champion',
    studentId,
    score: 60 + (hash % 40),
    totalMarks: 100,
    nationalRank: 1 + (hash % 500),
    percentile: Number((80 + (hash % 20)).toFixed(1)),
  }
}

export default function Result() {
  const [studentId, setStudentId] = useState('')
  const [result, setResult] = useState<ResultData | null>(null)
  const [error, setError] = useState('')

  function fetchResult(e: FormEvent) {
    e.preventDefault()
    if (!studentId.trim()) {
      setError('Please enter your Student ID.')
      return
    }
    setError('')
    setResult(mockLookup(studentId.trim()))
  }

  return (
    <div>
      <Navbar />
      <div className={`container ${styles.wrap}`}>
        <h1>Result Portal</h1>
        <p>Enter your Student ID to check your Olympiad result.</p>

        <form className={styles.searchRow} onSubmit={fetchResult}>
          <input
            className="form-control"
            placeholder="e.g. AMIT_7821"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          />
          <Button type="submit">
            Search <i className="ph ph-magnifying-glass" />
          </Button>
        </form>
        {error && <p className="error-text">{error}</p>}

        {result && (
          <div className={`card ${styles.resultCard}`}>
            <h2 id="res-name">{result.name}</h2>
            <p className={styles.idLine}>{result.studentId}</p>
            <div className={styles.scoreRow}>
              <div>
                <span className={styles.scoreValue}>
                  {result.score}/{result.totalMarks}
                </span>
                <span className={styles.scoreLabel}>Score</span>
              </div>
              <div>
                <span className={styles.scoreValue}>#{result.nationalRank}</span>
                <span className={styles.scoreLabel}>National Rank</span>
              </div>
              <div>
                <span className={styles.scoreValue}>{result.percentile}%</span>
                <span className={styles.scoreLabel}>Percentile</span>
              </div>
            </div>
            <div className={styles.actions}>
              <Button variant="outline" onClick={() => window.print()}>
                <i className="ph ph-printer" /> Download / Print Card
              </Button>
              <Button
                variant="outline"
                onClick={() => navigator.share?.({ title: 'My AMIT Olympiad Result', text: `I scored ${result.score}/${result.totalMarks}!` })}
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
