import styles from './StatTile.module.css'

interface StatTileProps {
  icon: string
  value: string | number
  label: string
}

export default function StatTile({ icon, value, label }: StatTileProps) {
  return (
    <div className={`card ${styles.tile}`}>
      <i className={`ph-bold ${icon} ${styles.icon}`} />
      <div>
        <div className={styles.value}>{value}</div>
        <div className={styles.label}>{label}</div>
      </div>
    </div>
  )
}
