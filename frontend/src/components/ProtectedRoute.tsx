import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { state } = useAuth()
  if (state.status === 'loading') return <Spinner label="Checking your session..." />
  if (state.status !== 'student') return <Navigate to="/" replace />
  return <>{children}</>
}

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { state } = useAuth()
  if (state.status === 'loading') return <Spinner label="Checking your session..." />
  if (state.status !== 'admin') return <Navigate to="/admin" replace />
  return <>{children}</>
}
