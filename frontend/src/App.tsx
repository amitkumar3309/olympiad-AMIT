import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ProtectedRoute, RequirePermission } from './components/ProtectedRoute'
import Spinner from './components/Spinner'
import Landing from './pages/Landing/Landing'
import Admin from './pages/Admin/Admin'
import AdminUsers from './pages/Admin/Users'
import AdminAuditLog from './pages/Admin/AuditLog'

/**
 * The question-bank pages are loaded on demand.
 *
 * They pull in KaTeX for maths rendering, which is ~300 KB of JS and CSS. Only
 * staff ever open these routes, so bundling it into the main entry would make every
 * student download a maths typesetter to look at the landing page. Splitting here
 * keeps the initial bundle roughly where it was before Milestone 4.
 */
const AdminQuestions = lazy(() => import('./pages/Admin/Questions'))
const AdminQuestionForm = lazy(() => import('./pages/Admin/QuestionForm'))
const AdminTaxonomy = lazy(() => import('./pages/Admin/Taxonomy'))
const AiGenerator = lazy(() => import('./pages/AiGenerator/AiGenerator'))
/** Same reasoning: the session runner renders question content through KaTeX. */
const PracticeSessionPage = lazy(() => import('./pages/Practice/PracticeSession'))
/**
 * Mock tests (Milestone 7). The attempt runner and the two administrative pages that
 * show question text all render maths, so they are split out for the same reason.
 */
const MockTestAttemptPage = lazy(() => import('./pages/MockTests/MockTestAttempt'))
const AdminMockTests = lazy(() => import('./pages/Admin/MockTests'))
const AdminMockTestForm = lazy(() => import('./pages/Admin/MockTestForm'))
const AdminMockTestResults = lazy(() => import('./pages/Admin/MockTestResults'))
import Analytics from './pages/Analytics/Analytics'
import Dashboard from './pages/Dashboard/Dashboard'
import Profile from './pages/Profile/Profile'
import Practice from './pages/Practice/Practice'
import MockTests from './pages/MockTests/MockTests'
import Certificate from './pages/Certificate/Certificate'
import Report from './pages/Report/Report'
import Result from './pages/Result/Result'
import VerifyEmail from './pages/Auth/VerifyEmail'
import ForgotPassword from './pages/Auth/ForgotPassword'
import ResetPassword from './pages/Auth/ResetPassword'

export default function App() {
  return (
    // Theme sits outermost so it applies to every route, and to the auth-loading
    // state before any page has rendered.
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        {/* One boundary around every route: only the lazily-loaded ones can suspend,
            and a single fallback is simpler than wrapping each of them. */}
        <Suspense
          fallback={
            <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
              <Spinner />
            </div>
          }
        >
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
          {/* Question bank. `questions:write` gates authoring; the delete button
              inside the list is additionally gated on `questions:delete`. */}
          <Route
            path="/admin/questions"
            element={
              <RequirePermission permission="questions:write">
                <AdminQuestions />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/questions/new"
            element={
              <RequirePermission permission="questions:write">
                <AdminQuestionForm />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/questions/:id/edit"
            element={
              <RequirePermission permission="questions:write">
                <AdminQuestionForm />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/taxonomy"
            element={
              <RequirePermission permission="taxonomy:write">
                <AdminTaxonomy />
              </RequirePermission>
            }
          />
          {/* Mock tests. `mocktests:write` covers authoring *and* reading every
              student's marks for a test, which is why it is its own permission and not
              a corner of `questions:write`. */}
          <Route
            path="/admin/mock-tests"
            element={
              <RequirePermission permission="mocktests:write">
                <AdminMockTests />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/mock-tests/new"
            element={
              <RequirePermission permission="mocktests:write">
                <AdminMockTestForm />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/mock-tests/:id/edit"
            element={
              <RequirePermission permission="mocktests:write">
                <AdminMockTestForm />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/mock-tests/:id/results"
            element={
              <RequirePermission permission="mocktests:write">
                <AdminMockTestResults />
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
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
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
          {/* --- Practice Zone (Milestone 6) --- */}
          <Route
            path="/practice"
            element={
              <ProtectedRoute>
                <Practice />
              </ProtectedRoute>
            }
          />
          <Route
            path="/practice/:sessionId"
            element={
              <ProtectedRoute>
                <PracticeSessionPage />
              </ProtectedRoute>
            }
          />
          {/* --- Mock tests (Milestone 7) --- */}
          <Route
            path="/mock-tests"
            element={
              <ProtectedRoute>
                <MockTests />
              </ProtectedRoute>
            }
          />
          <Route
            path="/mock-tests/attempts/:attemptId"
            element={
              <ProtectedRoute>
                <MockTestAttemptPage />
              </ProtectedRoute>
            }
          />
          {/**
           * `/exam` was the old practice paper — real questions, but no marking, because
           * nothing could grade them. The Practice Zone supersedes it entirely, so this
           * redirects rather than dead-ending any bookmark or old link. The path stays
           * free for the *official* exam, which is a different thing (see DECISIONS.md
           * on why practice and `ExamAttempt` are deliberately separate).
           */}
          <Route path="/exam" element={<Navigate to="/practice" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  )
}
