import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute, RequirePermission } from './components/ProtectedRoute'
import Landing from './pages/Landing/Landing'
import Admin from './pages/Admin/Admin'
import AdminUsers from './pages/Admin/Users'
import AdminAuditLog from './pages/Admin/AuditLog'
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
          {/* The admin entry point doubles as the root-admin sign-in form, so it is
              not permission-gated; it renders its own unauthorized state instead. */}
          <Route path="/admin" element={<Admin />} />
          <Route
            path="/admin/users"
            element={
              <RequirePermission permission="students:read">
                <AdminUsers />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/audit-log"
            element={
              <RequirePermission permission="audit:read">
                <AdminAuditLog />
              </RequirePermission>
            }
          />
          <Route
            path="/ai-generator"
            element={
              <RequirePermission permission="questions:write">
                <AiGenerator />
              </RequirePermission>
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
