import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { Admin, Entitlements, Permission, RegisterInput, Role, SessionResponse, Student } from '../api/types'

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
  /** `identifier` is the mobile number OR the email address. */
  login: (identifier: string, password: string) => Promise<Student>
  /**
   * Signs in at the admin portal as either the root super admin or a promoted
   * admin. Resolves once the session is established; read `state`/`can()` for who
   * it turned out to be, since the two identities differ in shape.
   */
  adminLogin: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  logoutEverywhere: () => Promise<void>
  /**
   * Re-reads `/auth/me` into state. Used after an action that changes what the
   * session says about itself — clearing `mustChangePassword` is the case that
   * needs it, since the forced-change screen must step aside once it lifts.
   */
  refreshSession: () => Promise<void>
  verifyEmail: (token: string) => Promise<string>
  resendVerification: (email: string) => Promise<string>
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
   * though the longer-lived refresh cookie is still valid. We therefore try
   * /auth/me first and, if that fails, attempt one refresh before concluding the
   * visitor is a guest — this is what keeps a signed-in user signed in across a
   * browser reload.
   */
  useEffect(() => {
    let cancelled = false

    async function restore() {
      try {
        const res = await api.get<SessionResponse>('/auth/me')
        if (cancelled) return
        setState(toAuthState(res))
      } catch {
        const refreshed = await api.tryRefresh()
        if (cancelled) return
        if (refreshed) {
          await loadSession()
        } else {
          setState({ status: 'guest' })
        }
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

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await api.post<SessionResponse>('/auth/login', { identifier, password })
    setState(toAuthState(res))
    return res.student!
  }, [])

  /**
   * Signs in at the administrator portal.
   *
   * Two different identities legitimately sign in there, and they authenticate
   * against different endpoints:
   *
   * - the **root** super admin, which exists only in the environment
   *   (`ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`), has no database record, and posts to
   *   `/auth/admin/login`;
   * - a **promoted** admin, which is an ordinary student account carrying
   *   `role: 'admin'`, and posts to the normal `/auth/login`.
   *
   * Requiring the promoted admin to know that distinction was a trap: the portal
   * answered their perfectly correct credentials with "Invalid admin credentials",
   * which reads as a broken account rather than as the wrong door. So we try the
   * root endpoint first — it is stateless and touches no account — and fall back to
   * the ordinary login when it reports that these are not the root credentials.
   *
   * The fallback reveals nothing: `/auth/login` returns the same generic failure for
   * an unknown account as for a wrong password, and an account that turns out to
   * hold no administrative permission simply lands on the portal's "this area is for
   * administrators" state.
   */
  const adminLogin = useCallback(async (email: string, password: string) => {
    try {
      setState(toAuthState(await api.post<SessionResponse>('/auth/admin/login', { email, password })))
      return
    } catch (err) {
      // Only "those are not the root credentials" is worth a second attempt. A 500
      // from an unconfigured root account, or a network failure, is the real answer.
      if (!(err instanceof ApiError) || err.status !== 401) throw err
    }
    // `identifier` accepts an email or a mobile number, so a promoted admin can use
    // whichever they sign in with everywhere else.
    setState(toAuthState(await api.post<SessionResponse>('/auth/login', { identifier: email, password })))
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

  const resendVerification = useCallback(async (email: string) => {
    const res = await api.post<{ message: string }>('/auth/resend-verification', { email })
    return res.message
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
        adminLogin,
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
