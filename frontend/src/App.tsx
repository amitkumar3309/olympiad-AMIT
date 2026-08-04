import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute'
import Landing from './pages/Landing/Landing'
import Admin from './pages/Admin/Admin'
import AiGenerator from './pages/AiGenerator/AiGenerator'
import Analytics from './pages/Analytics/Analytics'
import Dashboard from './pages/Dashboard/Dashboard'
import Exam from './pages/Exam/Exam'
import Certificate from './pages/Certificate/Certificate'
import Report from './pages/Report/Report'
import Result from './pages/Result/Result'
import VerifyEmail from './pages/Auth/VerifyEmail'
import ForgotPassword from './pages/Auth/ForgotPassword'
import ResetPassword from './pages/Auth/ResetPassword'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          {/* Public auth flows — reached from emailed links, so they must not be gated. */}
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/result" element={<Result />} />
          <Route path="/certificate" element={<Certificate />} />
          <Route path="/admin" element={<Admin />} />
          <Route
            path="/ai-generator"
            element={
              <AdminRoute>
                <AiGenerator />
              </AdminRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute>
                <Analytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/report"
            element={
              <ProtectedRoute>
                <Report />
              </ProtectedRoute>
            }
          />
          <Route
            path="/exam"
            element={
              <ProtectedRoute>
                <Exam />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
