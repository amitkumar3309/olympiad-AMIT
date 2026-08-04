import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { Admin, Student } from '../api/types'

type AuthState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'student'; student: Student }
  | { status: 'admin'; admin: Admin }

export interface RegisterResult {
  message: string
  requiresEmailVerification: boolean
  student: Student
}

interface AuthContextValue {
  state: AuthState
  /** Creates an account and emails a verification link. Does NOT sign the student in. */
  register: (input: { fullName: string; mobile: string; email: string; password: string }) => Promise<RegisterResult>
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const loadSession = useCallback(async () => {
    try {
      const res = await api.get<{ role: 'student' | 'admin'; student?: Student; admin?: Admin }>('/auth/me')
      if (res.role === 'admin' && res.admin) setState({ status: 'admin', admin: res.admin })
      else if (res.role === 'student' && res.student) setState({ status: 'student', student: res.student })
      else setState({ status: 'guest' })
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
        const res = await api.get<{ role: 'student' | 'admin'; student?: Student; admin?: Admin }>('/auth/me')
        if (cancelled) return
        if (res.role === 'admin' && res.admin) setState({ status: 'admin', admin: res.admin })
        else if (res.role === 'student' && res.student) setState({ status: 'student', student: res.student })
        else setState({ status: 'guest' })
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

  const register = useCallback(async (input: { fullName: string; mobile: string; email: string; password: string }) => {
    // No session is established here by design — the student verifies first.
    return api.post<RegisterResult>('/auth/register', input)
  }, [])

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await api.post<{ student: Student }>('/auth/login', { identifier, password })
    setState({ status: 'student', student: res.student })
    return res.student
  }, [])

  const adminLogin = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ admin: Admin }>('/auth/admin/login', { email, password })
    setState({ status: 'admin', admin: res.admin })
    return res.admin
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

  return (
    <AuthContext.Provider
      value={{
        state,
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
