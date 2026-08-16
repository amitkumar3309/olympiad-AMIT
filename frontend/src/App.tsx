import { Suspense, lazy, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ProtectedRoute, RequirePermission, RequirePaidEntry } from './components/ProtectedRoute'
import ForcePasswordChange from './components/ForcePasswordChange'
import Spinner from './components/Spinner'
import Landing from './pages/Landing/Landing'
import Payment from './pages/Payment/Payment'
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
/** The daily challenge renders a question, so it carries KaTeX too (Milestone 8). */
const DailyChallengePage = lazy(() => import('./pages/DailyChallenge/DailyChallenge'))
const AdminDailyChallenges = lazy(() => import('./pages/Admin/DailyChallenges'))
/** Gamification (Milestone 9). Neither page renders maths, but both are secondary
 *  destinations, so they are split out to keep the entry bundle for the pages every
 *  student opens on arrival. */
const Rewards = lazy(() => import('./pages/Rewards/Rewards'))
const AdminRewardSettings = lazy(() => import('./pages/Admin/RewardSettings'))
const AdminPayments = lazy(() => import('./pages/Admin/Payments'))
/**
 * Leaderboards and the Hall of Fame (Milestone 10). Both are **public** — a visitor
 * can see the standing without an account, which is the whole reason the backend masks
 * names — so they are split out to keep them off the landing page's critical path while
 * still being reachable without signing in.
 */
const Leaderboard = lazy(() => import('./pages/Leaderboard/Leaderboard'))
/**
 * Milestone 12. The public gallery is a marketing surface reachable without an
 * account; the rest are administrative or the student's own inbox. All secondary
 * destinations, so all split out of the entry bundle.
 */
const PublicGallery = lazy(() => import('./pages/Gallery/Gallery'))
const StudentNotifications = lazy(() => import('./pages/Notifications/Notifications'))
const AdminGallery = lazy(() => import('./pages/Admin/Gallery'))
const AdminNotifications = lazy(() => import('./pages/Admin/Notifications'))
const AdminEmailDeliveries = lazy(() => import('./pages/Admin/EmailDeliveries'))
const AdminQuestionPerformance = lazy(() => import('./pages/Admin/QuestionPerformance'))
const AdminAnalytics = lazy(() => import('./pages/Admin/Analytics'))
const AdminStandings = lazy(() => import('./pages/Admin/Standings'))
/**
 * The official exam and certificates (Milestone 13). The sitting runner renders
 * question content through KaTeX, so it is split out for the same reason the mock-test
 * runner is; the rest are secondary destinations.
 */
const Exams = lazy(() => import('./pages/Exam/Exams'))
const ExamAttemptPage = lazy(() => import('./pages/Exam/ExamAttempt'))
const MyCertificates = lazy(() => import('./pages/Certificates/Certificates'))
const VerifyCertificate = lazy(() => import('./pages/Certificates/Verify'))
const AdminExams = lazy(() => import('./pages/Admin/Exams'))
const AdminCertificates = lazy(() => import('./pages/Admin/Certificates'))
const HallOfFame = lazy(() => import('./pages/HallOfFame/HallOfFame'))
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

/**
 * Holds the entire application on the forced password-change screen while a
 * staff-issued temporary password is still outstanding.
 *
 * Placed *outside* the router deliberately: as a route it would be one URL among
 * many, and anything the student typed into the address bar would step around it.
 * Here there is simply nothing else rendered until the password is changed.
 */
function SessionGate({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const mustChange = (state.status === 'student' || state.status === 'admin') && state.mustChangePassword
  return mustChange ? <ForcePasswordChange /> : <>{children}</>
}

export default function App() {
  return (
    // Theme sits outermost so it applies to every route, and to the auth-loading
    // state before any page has rendered.
    <ThemeProvider>
    <AuthProvider>
      <SessionGate>
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
          {/* Public standing. Deliberately not behind `ProtectedRoute`: the backend
              already decides what a signed-out visitor may see (masked names, and only
              the top of the board), and gating the page would hide the competition from
              exactly the people it is meant to attract. */}
          {/* The entry fee. Behind ProtectedRoute: only a signed-in student has an
              entitlement to buy, and the server takes the account from the token. */}
          <Route path="/payment" element={<ProtectedRoute><Payment /></ProtectedRoute>} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/hall-of-fame" element={<HallOfFame />} />
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
            path="/admin/exams"
            element={
              <RequirePermission permission="exam:write">
                <AdminExams />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/certificates"
            element={
              <RequirePermission permission="certificates:write">
                <AdminCertificates />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/gallery"
            element={
              <RequirePermission permission="gallery:write">
                <AdminGallery />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/notifications"
            element={
              <RequirePermission permission="notifications:write">
                <AdminNotifications />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/email-deliveries"
            element={
              <RequirePermission permission="notifications:write">
                <AdminEmailDeliveries />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/performance"
            element={
              <RequirePermission permission="analytics:read:any">
                <AdminQuestionPerformance />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/analytics"
            element={
              <RequirePermission permission="analytics:read:any">
                <AdminAnalytics />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/standings"
            element={
              <RequirePermission permission="students:read">
                <AdminStandings />
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
          {/* Scheduling the daily challenge. Optional by design — an unscheduled day
              is filled automatically — so this page is a curation tool, not a chore. */}
          <Route
            path="/admin/daily-challenges"
            element={
              <RequirePermission permission="challenges:write">
                <AdminDailyChallenges />
              </RequirePermission>
            }
          />
          {/* The XP award table. Its own permission because it is the one setting that
              changes what every future event is worth for everybody at once. */}
          <Route
            path="/admin/reward-settings"
            element={
              <RequirePermission permission="rewards:write">
                <AdminRewardSettings />
              </RequirePermission>
            }
          />
          {/* The payments console (Milestone 19). Gated on `students:read`, matching the
              backend: it exposes who paid what, which is student account data. Changing
              the fee needs `students:status:write` and the page enforces that itself. */}
          <Route
            path="/admin/payments"
            element={
              <RequirePermission permission="students:read">
                <AdminPayments />
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
          {/* --- Practice Zone (Milestone 6). Free: the entry fee buys the Olympiad only. --- */}
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
          {/* --- Mock tests (Milestone 7). Free: a rehearsal is not the competition. --- */}
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
          {/* --- Gamification (Milestone 9) --- */}
          <Route
            path="/rewards"
            element={
              <ProtectedRoute>
                <Rewards />
              </ProtectedRoute>
            }
          />
          {/* --- Daily challenge (Milestone 8). Free. --- */}
          <Route
            path="/daily-challenge"
            element={
              <ProtectedRoute>
                <DailyChallengePage />
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
          {/* Public marketing surface, like the leaderboard and Hall of Fame. */}
          <Route path="/gallery" element={<PublicGallery />} />
          {/* Public certificate verification: a school or employer must be able to
              check a document without an account. Both forms so a pasted code works. */}
          <Route path="/verify" element={<VerifyCertificate />} />
          <Route path="/verify/:code" element={<VerifyCertificate />} />
          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <StudentNotifications />
              </ProtectedRoute>
            }
          />
          {/*
           * `/exam` is the **official Olympiad** as of Milestone 13. It used to redirect
           * to the Practice Zone, because the old page was a practice paper with no
           * marking and the official sitting did not exist. It does now.
           */}
          <Route
            path="/exam"
            element={
              <RequirePaidEntry feature="The official Olympiad">
                <Exams />
              </RequirePaidEntry>
            }
          />
          <Route
            path="/exam/:attemptId"
            element={
              <RequirePaidEntry feature="The official Olympiad">
                <ExamAttemptPage />
              </RequirePaidEntry>
            }
          />
          <Route
            path="/my-certificates"
            element={
              <ProtectedRoute>
                <MyCertificates />
              </ProtectedRoute>
            }
          />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </SessionGate>
    </AuthProvider>
    </ThemeProvider>
  )
}
