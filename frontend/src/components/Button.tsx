import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

type Variant = 'primary' | 'outline' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  fullWidth?: boolean
}

export default function Button({ variant = 'primary', fullWidth, className, ...rest }: ButtonProps) {
  const classes = [styles.btn, styles[variant], fullWidth ? styles.fullWidth : '', className]
    .filter(Boolean)
    .join(' ')
  return <button className={classes} {...rest} />
}
