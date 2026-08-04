import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { Admin, Permission, RegisterInput, Role, SessionResponse, Student } from '../api/types'

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
  | { status: 'student'; student: Student; role: Role; permissions: Permission[] }
  | { status: 'admin'; admin: Admin; role: Role; permissions: Permission[] }

export interface RegisterResult {
  message: string
  requiresEmailVerification: boolean
  student: Student
}

interface AuthContextValue {
  state: AuthState
  /** True when the signed-in user holds the permission, per the backend's own table. */
  can: (permission: Permission) => boolean
  /** Creates an account and emails a verification link. Does NOT sign the student in. */
  register: (input: RegisterInput) => Promise<RegisterResult>
  /** `identifier` is the mobile number OR the email address. */
  login: (identifier: string, password: string) => Promise<Student>
  adminLogin: (email: string, password: string) => Promise<Admin>
  logout: () => Promise<void>
  logoutEverywhere: () => Promise<void>
  verifyEmail: (token: string) => Promise<string>
  resendVerification: (email: string) => Promise<string>
  forgotPassword: (email: string) => Promise<string>
  resetPassword: (token: string, password: string) => Promise<string>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Turns an auth response into state, keeping role/permissions together with the identity. */
function toAuthState(res: SessionResponse): AuthState {
  const permissions = res.permissions ?? []
  if (res.student) return { status: 'student', student: res.student, role: res.role, permissions }
  if (res.admin) return { status: 'admin', admin: res.admin, role: res.role, permissions }
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

  const adminLogin = useCallback(async (email: string, password: string) => {
    const res = await api.post<SessionResponse>('/auth/admin/login', { email, password })
    setState(toAuthState(res))
    return res.admin!
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

  return (
    <AuthContext.Provider
      value={{
        state,
        can,
        register,
        login,
        adminLogin,
        logout,
        logoutEverywhere,
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
