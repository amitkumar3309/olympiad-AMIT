import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { Admin, Student } from '../api/types'

type AuthState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'student'; student: Student }
  | { status: 'admin'; admin: Admin }

interface AuthContextValue {
  state: AuthState
  register: (fullName: string, mobile: string, password: string) => Promise<Student>
  login: (mobile: string, password: string) => Promise<Student>
  adminLogin: (email: string, password: string) => Promise<Admin>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    api
      .get<{ role: 'student' | 'admin'; student?: Student; admin?: Admin }>('/api/auth/me')
      .then((res) => {
        if (res.role === 'admin' && res.admin) setState({ status: 'admin', admin: res.admin })
        else if (res.role === 'student' && res.student) setState({ status: 'student', student: res.student })
        else setState({ status: 'guest' })
      })
      .catch(() => setState({ status: 'guest' }))
  }, [])

  const register = useCallback(async (fullName: string, mobile: string, password: string) => {
    const res = await api.post<{ student: Student }>('/api/auth/register', { fullName, mobile, password })
    setState({ status: 'student', student: res.student })
    return res.student
  }, [])

  const login = useCallback(async (mobile: string, password: string) => {
    const res = await api.post<{ student: Student }>('/api/auth/login', { mobile, password })
    setState({ status: 'student', student: res.student })
    return res.student
  }, [])

  const adminLogin = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ admin: Admin }>('/api/auth/admin/login', { email, password })
    setState({ status: 'admin', admin: res.admin })
    return res.admin
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setState({ status: 'guest' })
  }, [])

  return (
    <AuthContext.Provider value={{ state, register, login, adminLogin, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export { ApiError }
