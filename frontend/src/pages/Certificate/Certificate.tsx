import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import { useAuth } from '../../context/AuthContext'
import logo from '../../assets/logo.png'
import styles from './Certificate.module.css'

export default function Certificate() {
  const { state } = useAuth()
  const student = state.status === 'student' ? state.student : null
  const name = student?.fullName ?? 'Future Champion'
  const id = student?.studentId ?? 'AMIT_XXXX'
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div>
      <Navbar />
      <div className={`container ${styles.wrap}`}>
        <h1>Premium Digital Certificate</h1>
        {!student && <p>Log in to see your personalized certificate. Shown below is a preview.</p>}

        <div className={styles.certificate}>
          <img src={logo} alt="A.M.I.T Olympiad" className={styles.certLogo} />
          <p className={styles.presented}>This certificate is proudly presented to</p>
          <h2 className={styles.recipient}>{name}</h2>
          <p className={styles.desc}>
            For outstanding participation and achievement in the <strong>A.M.I.T Maths Olympiad 2027</strong>,
            demonstrating excellence in analytical thinking and mathematical problem solving.
          </p>
          <div className={styles.metaRow}>
            <div>
              <span className={styles.metaLabel}>Certificate ID</span>
              <span className={styles.metaValue}>{id}</span>
            </div>
            <div>
              <span className={styles.metaLabel}>Date Issued</span>
              <span className={styles.metaValue}>{date}</span>
            </div>
          </div>
          <p className={styles.signature}>Amit Kumar — Founder &amp; M.D.</p>
        </div>

        <div className={styles.actions}>
          <Button variant="outline" onClick={() => window.print()}>
            <i className="ph ph-printer" /> Download / Print
          </Button>
        </div>
      </div>
      <Footer />
    </div>
  )
}
