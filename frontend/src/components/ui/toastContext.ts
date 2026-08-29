import { createContext, useContext } from 'react'

/**
 * The toast API, separated from the provider component so that importing the hook
 * does not defeat Fast Refresh (`react/only-export-components`).
 *
 * ## What a toast is for, and what it is not for
 *
 * A toast confirms that something the user just did has finished — "Answer saved",
 * "Invoice downloaded", "Reward marked paid". It is transient and it is not read again.
 *
 * It is therefore the wrong control for anything the user needs to *act* on or *keep*:
 *
 *  - A validation failure belongs beside the field (`Field`'s `error`).
 *  - A caveat about the page belongs on the page (`Alert`).
 *  - A destructive confirmation belongs in a dialog (`Modal`).
 *
 * The rule that follows is "avoid excessive toasts": a screen that toasts on every
 * interaction trains people to dismiss them, and then the one that mattered is
 * dismissed too.
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export interface ToastInput {
  /** The message. One sentence, in the user's terms, no error codes. */
  message: string
  tone?: ToastTone
  /** Optional second line. Use it for a detail, never for a stack trace. */
  detail?: string
  /**
   * Milliseconds before it dismisses itself. `0` keeps it until dismissed by hand.
   * Omit it and the tone decides: an error stays longer, because it is the one the
   * reader has to finish reading.
   */
  duration?: number
}

export interface Toast extends ToastInput {
  id: string
  tone: ToastTone
}

export interface ToastApi {
  /** Show a toast; returns its id, which `dismiss` accepts. */
  show: (input: ToastInput) => string
  success: (message: string, detail?: string) => string
  error: (message: string, detail?: string) => string
  warning: (message: string, detail?: string) => string
  info: (message: string, detail?: string) => string
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

/**
 * Throws when there is no provider above it, rather than silently swallowing the
 * message. A toast that is never shown is indistinguishable from an action that never
 * happened, which is exactly the class of bug worth failing loudly on.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) {
    throw new Error('useToast() requires <ToastProvider>, which is mounted in App.tsx')
  }
  return api
}
