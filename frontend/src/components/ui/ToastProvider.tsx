import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { ToastContext, type Toast, type ToastInput, type ToastTone } from './toastContext'
import styles from './Toast.module.css'

/**
 * The toast host. Mounted once, at the root of the application.
 *
 * ## Announcement
 *
 * Each toast is its own live region — `role="alert"` for an error (assertive: it
 * interrupts, because a failed save is worth interrupting for) and `role="status"` for
 * everything else (polite: it waits its turn). The container itself is a labelled
 * region rather than a live region, so a re-render of the list cannot cause a
 * re-announcement of toasts already read.
 *
 * ## Bounded
 *
 * At most three are shown; a fourth pushes the oldest out. An unbounded stack on a
 * 320px screen becomes a wall that covers the page it is reporting on.
 */

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 4500,
  info: 5000,
  warning: 7000,
  // Longest, because it is the one that has to be finished, and often the one that
  // names what to do next.
  error: 9000,
}

const TONE_ICON: Record<ToastTone, string> = {
  success: 'ph-check-circle',
  error: 'ph-warning-circle',
  warning: 'ph-warning',
  info: 'ph-info',
}

const MAX_VISIBLE = 3

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, number>())
  const counter = useRef(0)

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (input: ToastInput) => {
      counter.current += 1
      const id = `toast-${counter.current}`
      const tone = input.tone ?? 'info'
      const toast: Toast = { ...input, id, tone }

      setToasts((current) => {
        const next = [...current, toast]
        // Trim from the front: the oldest has been on screen longest and is the one
        // most likely to have been read already.
        return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next
      })

      const duration = input.duration ?? DEFAULT_DURATION[tone]
      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        )
      }
      return id
    },
    [dismiss],
  )

  /* Clear every pending timer if the provider itself unmounts. */
  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer))
      timers.current.clear()
    },
    [],
  )

  const api = useMemo(
    () => ({
      show,
      dismiss,
      success: (message: string, detail?: string) => show({ message, detail, tone: 'success' }),
      error: (message: string, detail?: string) => show({ message, detail, tone: 'error' }),
      warning: (message: string, detail?: string) => show({ message, detail, tone: 'warning' }),
      info: (message: string, detail?: string) => show({ message, detail, tone: 'info' }),
    }),
    [show, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 &&
        createPortal(
          <div className={styles.region} role="region" aria-label="Notifications">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`${styles.toast} ${styles[toast.tone]}`}
                role={toast.tone === 'error' ? 'alert' : 'status'}
                aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
              >
                <Icon name={TONE_ICON[toast.tone]} weight="bold" size="md" className={styles.icon} />
                <div className={styles.text}>
                  <p className={styles.message}>{toast.message}</p>
                  {toast.detail && <p className={styles.detail}>{toast.detail}</p>}
                </div>
                <button
                  type="button"
                  className={styles.close}
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                >
                  <Icon name="ph-x" weight="bold" size="xs" />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  )
}
