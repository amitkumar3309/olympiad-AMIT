import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { Admin, Entitlements, Permission, RegisterInput, Role, SessionProbe, SessionResponse, Student } from '../api/types'

/**
 * `status` says which *kind of account* is signed in — one backed by a student
 * record, or the environment-configured root administrator, which has no record.
 * It does **not** say what the user may do: that is `role` and `permissions`,
 * which the backend sends with every auth response. A promoted admin is a normal
 * student account, so it appears as `status: 'student'` with `role: 'admin'`.
 *
 * Always ask `can(...)` before showing or gating anything. Never branch on
 * `status` to decide whether something administrative is allowed.
 */
type AuthState =
  | { status: 'loading' }
  | { status: 'guest' }
  | {
      status: 'student'
      student: Student
      role: Role
      permissions: Permission[]
      mustChangePassword: boolean
      entitlements: Entitlements
    }
  | {
      status: 'admin'
      admin: Admin
      role: Role
      permissions: Permission[]
      mustChangePassword: boolean
      entitlements: Entitlements
    }

export interface RegisterResult {
  message: string
  requiresEmailVerification: boolean
  student: Student
  /**
   * When another verification link may be requested — an absolute instant decided by
   * the server, which the success screen counts down to. Optional so an older backend
   * simply leaves the resend button enabled rather than breaking the page.
   */
  nextResendAt?: string
}

/** What a resend attempt reports: the generic message, and when to allow the next one. */
export interface ResendResult {
  message: string
  nextResendAt?: string
}

interface AuthContextValue {
  state: AuthState
  /** True when the signed-in user holds the permission, per the backend's own table. */
  can: (permission: Permission) => boolean
  /**
   * True when the entry fee has been paid — or is not being charged.
   *
   * Read this exactly as you read `can()`: it comes from the server on every auth
   * response and is never derived here. It is **presentation only** — it decides
   * whether to show a lock or a link. The server refuses the request regardless, with
   * a 402, so a tampered client gets a nicer-looking failure and nothing more.
   *
   * `false` while the session is loading or for a guest, so a gate never opens by
   * default while the answer is unknown.
   */
  hasPaid: boolean
  /** Creates an account and emails a verification link. Does NOT sign the student in. */
  register: (input: RegisterInput) => Promise<RegisterResult>
  /**
   * Signs in at the one door this product has.
   *
   * `identifier` is the mobile number OR the email address. It resolves to the
   * **role**, because where a session belongs afterwards is a property of the account
   * rather than of the page the form happened to be opened from.
   */
  login: (identifier: string, password: string) => Promise<Role>
  logout: () => Promise<void>
  logoutEverywhere: () => Promise<void>
  /**
   * Re-reads `/auth/me` into state. Used after an action that changes what the
   * session says about itself — clearing `mustChangePassword` is the case that
   * needs it, since the forced-change screen must step aside once it lifts.
   */
  refreshSession: () => Promise<void>
  verifyEmail: (token: string) => Promise<string>
  /** `next` (Milestone 30) is carried into the new link — an exact path from `lib/nextPath.ts`, or omitted. */
  resendVerification: (email: string, next?: string | null) => Promise<ResendResult>
  forgotPassword: (email: string) => Promise<string>
  resetPassword: (token: string, password: string) => Promise<string>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Turns an auth response into state, keeping role/permissions together with the identity. */
function toAuthState(res: SessionResponse): AuthState {
  const permissions = res.permissions ?? []
  const mustChangePassword = res.mustChangePassword === true
  // Absent means not entitled. An older backend, a truncated response or a field the
  // server chose not to send must never read as "paid" — the gate has to fail closed.
  const entitlements: Entitlements = { olympiadEntry: res.entitlements?.olympiadEntry === true }
  if (res.student)
    return { status: 'student', student: res.student, role: res.role, permissions, mustChangePassword, entitlements }
  if (res.admin)
    return { status: 'admin', admin: res.admin, role: res.role, permissions, mustChangePassword, entitlements }
  return { status: 'guest' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const loadSession = useCallback(async () => {
    try {
      setState(toAuthState(await api.get<SessionResponse>('/auth/me')))
    } catch {
      setState({ status: 'guest' })
    }
  }, [])

  /**
   * Restores the session on every page load / refresh. The access token is a
   * session cookie and short-lived, so it is often already gone or expired even
   * though the longer-lived refresh cookie is still valid. We therefore ask
   * `/auth/session` first and, when it says a refresh cookie is there, attempt one
   * refresh before concluding the visitor is a guest — this is what keeps a
   * signed-in user signed in across a browser reload.
   *
   * `/auth/session` rather than `/auth/me` (Milestone 30, Phase 5 — audit D9): it
   * answers a guest **200** instead of 401, and a refresh is attempted only when there
   * is a refresh cookie to use. Before, every public page a guest opened logged two
   * failed requests (`/auth/me` 401, `/auth/refresh` 401) as console errors.
   */
  useEffect(() => {
    let cancelled = false

    /**
     * The probe, retried when the failure may pass (Milestone 30, Phase 6 — audit D17).
     *
     * Every failure used to read as "signed out", so a student on a weak connection whose
     * first request at page load failed was sent to the sign-in dialog from the middle of
     * their own dashboard. A failure that says nothing about the session — no answer, a
     * timeout, a 5xx, a 429 — is tried twice more, a second and then three seconds later,
     * while the page shows its loading state. A 4xx is an answer and is not retried.
     */
    async function fetchProbe(): Promise<SessionProbe> {
      const waits = [1000, 3000]
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await api.get<SessionProbe>('/auth/session')
        } catch (err) {
          const transient = !(err instanceof ApiError) || err.status >= 500 || err.status === 429
          const wait = waits[attempt]
          if (!transient || wait === undefined || cancelled) throw err
          await new Promise((resolve) => setTimeout(resolve, wait))
        }
      }
    }

    async function restore() {
      try {
        const probe = await fetchProbe()
        if (cancelled) return
        if (probe.authenticated) {
          setState(toAuthState(probe))
          return
        }
        if (probe.canRefresh && (await api.tryRefresh())) {
          if (!cancelled) await loadSession()
          return
        }
        if (!cancelled) setState({ status: 'guest' })
      } catch (err) {
        // A backend that predates the probe answers 404. The two apps deploy separately,
        // so for the minutes between the two deployments — or after a backend-only
        // rollback — fall back to the old path rather than show every signed-in student
        // as a guest and send them to the sign-in dialog.
        if (err instanceof ApiError && err.status === 404) {
          if (!cancelled) await loadSession()
          return
        }
        if (!cancelled) setState({ status: 'guest' })
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [loadSession])

  const register = useCallback(async (input: RegisterInput) => {
    // No session is established here by design — the student verifies first.
    return api.post<RegisterResult>('/auth/register', input)
  }, [])

  /**
   * Signs in, and resolves to the role so the caller knows where to send them.
   *
   * ## Why there is a second request in here
   *
   * Two identities legitimately sign in, and they authenticate against different
   * endpoints. A **promoted** admin is an ordinary student account carrying
   * `role: 'admin'`, and uses `/auth/login` like everybody else. The **bootstrap**
   * super administrator does not: `/auth/login` refuses it deliberately, and
   * authentication happens at `/auth/admin/login`.
   *
   * Until Milestone 27 the reader was made to know that. There were two sign-in forms,
   * and the administrator's was advertised in the footer of every public page —
   * so the product told every visitor where its admin door was, and told a promoted
   * admin who used it "Invalid admin credentials", which reads as a broken account
   * rather than as the wrong door.
   *
   * There is one form now. On `ADMIN_PORTAL_REQUIRED` the same credentials are
   * re-posted to the admin route and the reader simply ends up signed in. The retry is
   * safe precisely because of *when* the server answers that code: only once the
   * password is already correct, so it is never returned to somebody who is guessing,
   * and a wrong password is a 401 on the first call that is never retried. It
   * therefore costs one extra request for one account in the product and nothing at
   * all for anybody else.
   *
   * If the retry itself fails — the bootstrap account is addressed by the configured
   * **email**, so signing in as it by mobile number cannot work — that failure is
   * reported as itself rather than papered over. It is not reachable in practice:
   * staff are provisioned without a mobile number.
   */
  const login = useCallback(async (identifier: string, password: string): Promise<Role> => {
    let res: SessionResponse
    try {
      res = await api.post<SessionResponse>('/auth/login', { identifier, password })
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'ADMIN_PORTAL_REQUIRED') throw err
      res = await api.post<SessionResponse>('/auth/admin/login', { email: identifier, password })
    }
    setState(toAuthState(res))
    return res.role
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      // Clear local state even if the request failed, so the UI can never show a
      // signed-in shell after the user asked to leave.
      setState({ status: 'guest' })
    }
  }, [])

  const logoutEverywhere = useCallback(async () => {
    try {
      await api.post('/auth/logout-all')
    } finally {
      setState({ status: 'guest' })
    }
  }, [])

  const verifyEmail = useCallback(async (token: string) => {
    const res = await api.post<{ message: string }>('/auth/verify-email', { token })
    return res.message
  }, [])

  const resendVerification = useCallback(async (email: string, next?: string | null): Promise<ResendResult> => {
    // The whole response, not just the message: `nextResendAt` is what the cooldown
    // countdown is driven by, and it must come from the server rather than the browser.
    return api.post<ResendResult>('/auth/resend-verification', { email, ...(next ? { next } : {}) })
  }, [])

  const forgotPassword = useCallback(async (email: string) => {
    const res = await api.post<{ message: string }>('/auth/forgot-password', { email })
    return res.message
  }, [])

  const resetPassword = useCallback(async (token: string, password: string) => {
    const res = await api.post<{ message: string }>('/auth/reset-password', { token, password })
    return res.message
  }, [])

  const can = useCallback(
    (permission: Permission) =>
      (state.status === 'student' || state.status === 'admin') && state.permissions.includes(permission),
    [state],
  )

  const hasPaid =
    (state.status === 'student' || state.status === 'admin') && state.entitlements.olympiadEntry === true

  return (
    <AuthContext.Provider
      value={{
        state,
        can,
        hasPaid,
        register,
        login,
        logout,
        logoutEverywhere,
        refreshSession: loadSession,
        verifyEmail,
        resendVerification,
        forgotPassword,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export { ApiError }
