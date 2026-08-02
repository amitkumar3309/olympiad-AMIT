import styles from './Footer.module.css'

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className="container">
        <p>© {new Date().getFullYear()} A.M.I.T. Olympiad. All Rights Reserved.</p>
        <p className={styles.contact}>Helpline: +91 9782870716 · support@amitolympiad.com</p>
      </div>
    </footer>
  )
}
