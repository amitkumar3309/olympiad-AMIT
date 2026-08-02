import styles from './Spinner.module.css'

export default function Spinner({ label }: { label?: string }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.ring} />
      {label && <p className={styles.label}>{label}</p>}
    </div>
  )
}
