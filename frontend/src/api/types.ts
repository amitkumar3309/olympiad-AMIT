export type AccountStatus = 'active' | 'suspended' | 'deactivated'

export type Role = 'student' | 'admin' | 'superadmin'

/**
 * Mirrors the permission names in `backend/src/lib/permissions.ts` so the UI can
 * refer to them type-safely. It is deliberately only a *name* list: which role
 * holds which permission is decided by the backend and arrives on every auth
 * response, so the two can never drift into disagreeing about access.
 */
export type Permission =
  | 'analytics:read:self'
  | 'exam:take'
  | 'questions:read'
  | 'analytics:read:any'
  | 'students:read'
  | 'students:status:write'
  | 'questions:write'
  | 'questions:delete'
  | 'taxonomy:write'
  | 'mocktests:write'
  | 'audit:read'
  | 'users:role:write'

/**
 * Mirrors `CLASS_LEVELS` in `backend/src/lib/classLevels.ts`. Like the permission
 * names above this is only a *list* — the backend's zod schema is what actually
 * enforces it, so a stale copy here can never widen what the API accepts.
 */
export const CLASS_LEVELS = [
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12 - Science',
  'Class 12 - Commerce',
  'Class 12 - Humanities',
] as const

export type ClassLevel = (typeof CLASS_LEVELS)[number]

/** Everything registration collects, as the backend expects it. */
export interface RegisterInput {
  firstName: string
  middleName?: string
  lastName: string
  fatherName: string
  motherName: string
  /** `YYYY-MM-DD`. */
  dateOfBirth: string
  classLevel: ClassLevel
  schoolName: string
  address: string
  mobile: string
  email: string
  password: string
  /** A base64 data URL, e.g. `data:image/jpeg;base64,...`. Max 2 MB decoded. */
  photo: string
}

export interface Student {
  fullName: string
  firstName: string
  middleName: string | null
  lastName: string
  fatherName: string
  motherName: string
  /** `YYYY-MM-DD`, or null for an account created before Milestone 4. */
  dateOfBirth: string | null
  classLevel: ClassLevel | null
  schoolName: string
  address: string
  mobile: string
  email: string
  studentId: string
  isEmailVerified: boolean
  status: AccountStatus
  role: Role
}

export interface Admin {
  email: string
  role: Role
}

/** What the backend sends on login / refresh / `/auth/me`. */
export interface SessionResponse {
  role: Role
  permissions: Permission[]
  student?: Student
  admin?: Admin
}

/** An account as an administrator sees it — wider than a student's own view. */
export interface ManagedAccount {
  id: string
  studentId: string
  fullName: string | null
  email: string
  mobile: string
  role: 'student' | 'admin'
  status: AccountStatus
  isEmailVerified: boolean
  registeredAt: string
  lastLoginAt: string | null
  lockedUntil: string | null
  roleUpdatedAt: string | null
  roleUpdatedBy: string | null
  /** Milestone 4 registration details — null on accounts created before it. */
  firstName: string | null
  middleName: string | null
  lastName: string | null
  fatherName: string | null
  motherName: string | null
  dateOfBirth: string | null
  classLevel: ClassLevel | null
  schoolName: string | null
  address: string | null
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type AuditAction =
  | 'user.role.changed'
  | 'student.status.changed'
  | 'student.profile.updated'
  | 'student.photo.updated'
  | 'student.password.changed'
  | 'questions.generated'
  | 'question.created'
  | 'question.updated'
  | 'question.status.changed'
  | 'question.deleted'
  | 'mocktest.created'
  | 'mocktest.updated'
  | 'mocktest.status.changed'
  | 'mocktest.deleted'
  | 'subject.changed'
  | 'topic.changed'
  | 'admin.session.started'
  | 'authz.denied'

export interface AuditEntry {
  id: string
  action: AuditAction
  actorRole: Role
  actorLabel: string
  targetType: 'student' | 'question' | 'mocktest' | 'subject' | 'topic' | 'route' | 'system'
  targetId: string | null
  targetLabel: string | null
  outcome: 'success' | 'denied'
  metadata: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

export interface TopicMetric {
  topicName: string
  attempted: number
  correct: number
}

export interface LearningPoint {
  date: string
  accuracy: number
}

export interface AnalyticsData {
  overallAccuracy: number
  averageSpeedPerQuestion: number
  totalQuestionsAttempted: number
  topicMetrics: TopicMetric[]
  learningCurve: LearningPoint[]
  aiInsights: string[]
}

/** Real XP earned on one competition day. Days with no activity are omitted. */
export interface XpDayPoint {
  day: string
  xp: number
}

/**
 * What `GET /analytics/:studentId` returns.
 *
 * `data` is **null** until exam submission exists, because accuracy, speed and
 * topic breakdowns are all functions of answered questions — the endpoint used to
 * fill that gap with invented figures and no longer does. `xpByDay` is always real.
 */
export interface AnalyticsResponse {
  data: AnalyticsData | null
  reason?: 'no-exam-data'
  xpByDay: XpDayPoint[]
}

// ---------------------------------------------------------------------------
// Question bank (Milestone 4)
// ---------------------------------------------------------------------------

/** Mirrors `QUESTION_TYPES` in `backend/src/models/Question.ts`. */
export const QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false', 'numeric'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

/** Mirrors `QUESTION_STATUSES`. `draft` → `in_review` → `published`, plus `archived`. */
export const QUESTION_STATUSES = ['draft', 'in_review', 'published', 'archived'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export const TAXONOMY_STATUSES = ['active', 'archived'] as const
export type TaxonomyStatus = (typeof TAXONOMY_STATUSES)[number]

/** Labels for the type/status codes, so the UI never shows a raw enum value. */
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  true_false: 'True / false',
  numeric: 'Numeric answer',
}

export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  archived: 'Archived',
}

export interface Subject {
  id: string
  name: string
  slug: string
  description: string | null
  status: TaxonomyStatus
  displayOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * A topic **or** a subtopic — they are the same entity, distinguished by `parent`
 * (and `depth`: 0 for a topic, 1 for a subtopic).
 */
export interface Topic {
  id: string
  subject: string
  parent: string | null
  depth: number
  name: string
  slug: string
  description: string | null
  status: TaxonomyStatus
  displayOrder: number
  createdAt: string
  updatedAt: string
}

/** A populated subject/topic reference as the question endpoints return it. */
export interface QuestionRef {
  id: string
  name: string | null
}

export interface QuestionOption {
  key: string
  text: string
  isCorrect: boolean
}

/**
 * The **author's** view of a question, from the `/admin/questions` endpoints —
 * it includes the answer key and the solution.
 *
 * The student-facing `/questions` endpoints return a deliberately narrower shape
 * with no `isCorrect`, `solution`, `booleanAnswer` or `numericAnswer`. There is no
 * type here for that shape yet because no student page consumes it (the exam is
 * still a hardcoded mock); when one does, give it its own interface rather than
 * making these fields optional — optional answer fields are how an answer key
 * eventually leaks into a student view.
 */
export interface AdminQuestion {
  id: string
  questionText: string
  type: QuestionType
  options: QuestionOption[]
  booleanAnswer: boolean | null
  numericAnswer: number | null
  tolerance: number | null
  solution: string | null
  subject: QuestionRef | null
  topic: QuestionRef | null
  subtopic: QuestionRef | null
  classLevel: ClassLevel
  difficulty: Difficulty
  marks: number
  negativeMarks: number
  status: QuestionStatus
  tags: string[]
  revision: number
  createdByLabel: string | null
  updatedByLabel: string | null
  publishedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

/** The write shape. Mirrors `createQuestionSchema` on the backend. */
export interface QuestionInput {
  questionText: string
  type: QuestionType
  options: Array<{ text: string; isCorrect: boolean }>
  booleanAnswer: boolean | null
  numericAnswer: number | null
  tolerance: number | null
  solution: string | null
  subject: string
  topic: string
  subtopic: string | null
  classLevel: ClassLevel
  difficulty: Difficulty
  marks: number
  negativeMarks: number
  tags: string[]
}

export const QUESTION_SORT_KEYS = ['createdAt', 'updatedAt', 'marks', 'difficulty', 'classLevel'] as const
export type QuestionSortKey = (typeof QUESTION_SORT_KEYS)[number]

// ---------------------------------------------------------------------------
// Profile, progress and dashboard (Milestone 5)
// ---------------------------------------------------------------------------

/** The student's own full profile, from `GET /me/profile`. */
export interface OwnProfile {
  studentId: string
  fullName: string | null
  firstName: string | null
  middleName: string | null
  lastName: string | null
  fatherName: string | null
  motherName: string | null
  /** `YYYY-MM-DD`. */
  dateOfBirth: string | null
  classLevel: ClassLevel | null
  schoolName: string | null
  address: string | null
  /** Identity fields — displayed, but not editable here. See profileSchemas.ts. */
  mobile: string
  email: string
  isEmailVerified: boolean
  status: AccountStatus
  role: Role
  registeredAt: string
  lastLoginAt: string | null
  hasPhoto: boolean
}

/** The editable subset, as `PATCH /me/profile` expects it. */
export interface ProfileUpdateInput {
  firstName: string
  middleName: string | null
  lastName: string
  fatherName: string
  motherName: string
  dateOfBirth: string
  classLevel: ClassLevel
  schoolName: string
  address: string
}

/** Mirrors `ACTIVITY_TYPES` in `backend/src/models/StudentActivity.ts`. */
export const ACTIVITY_TYPES = [
  'account_created',
  'email_verified',
  'daily_visit',
  'profile_updated',
  'photo_updated',
  'password_changed',
  'practice_completed',
  'mock_test_completed',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

/** How each recorded event is described to the student, with its icon. */
export const ACTIVITY_LABELS: Record<ActivityType, { label: string; icon: string }> = {
  account_created: { label: 'Joined the Olympiad', icon: 'ph-user-plus' },
  email_verified: { label: 'Verified your email address', icon: 'ph-seal-check' },
  daily_visit: { label: 'Showed up for the day', icon: 'ph-flame' },
  profile_updated: { label: 'Updated your profile', icon: 'ph-pencil-simple' },
  photo_updated: { label: 'Changed your photo', icon: 'ph-camera' },
  password_changed: { label: 'Changed your password', icon: 'ph-lock-key' },
  practice_completed: { label: 'Completed a practice session', icon: 'ph-target' },
  mock_test_completed: { label: 'Completed a mock test', icon: 'ph-exam' },
}

export interface ActivityEntry {
  id: string
  type: ActivityType
  xpAwarded: number
  detail: string | null
  /** Competition-local `YYYY-MM-DD`. */
  occurredOn: string
  createdAt: string
}

export interface StreakSummary {
  current: number
  longest: number
  activeDays: number
  lastActiveOn: string | null
  countedToday: boolean
}

export interface ProgressSummary {
  xp: number
  level: number
  levelStartsAt: number
  nextLevelAt: number
  xpIntoLevel: number
  xpForNextLevel: number
  percentToNextLevel: number
  streak: StreakSummary
}

export interface Achievement {
  code: string
  name: string
  description: string
  icon: string
  earned: boolean
  progress: number
  target: number
}

export interface AchievementSummary {
  earnedCount: number
  total: number
  earned: Achievement[]
  next: Achievement[]
}

export interface LeaderboardRow {
  rank: number
  studentId: string
  /** First name plus last initial — the backend never publishes a child's full name. */
  displayName: string
  classLevel: string | null
  schoolName: string | null
  xp: number
}

export interface LeaderboardStanding {
  /** Null when the student has no XP yet, i.e. is genuinely not ranked. */
  rank: number | null
  xp: number
  totalRanked: number
}

/**
 * A submitted exam attempt. Always an empty list today, because nothing in the
 * product writes an `ExamAttempt` yet — the dashboard renders its empty state
 * rather than sample scores. The shape is here so the panel starts working when
 * exam submission lands.
 */
export interface ExamPerformance {
  id: string
  submittedAt: string | null
  totalScore: number
  accuracy: number
  timeTakenSeconds: number
  questionCount: number
}

/** Real published-question availability for the student's class, per subject. */
export interface SubjectChallenge {
  subjectId: string
  subjectName: string
  questionCount: number
  difficulties: string[]
  totalMarks: number
}

export interface DashboardData {
  student: {
    studentId: string
    fullName: string | null
    firstName: string | null
    classLevel: ClassLevel | null
    schoolName: string | null
  }
  progress: ProgressSummary
  activity: ActivityEntry[]
  recentTests: ExamPerformance[]
  achievements: AchievementSummary
  leaderboard: { top: LeaderboardRow[]; me: LeaderboardStanding }
  challenges: SubjectChallenge[]
  /** The competition day the figures were computed for. */
  today: string
}

/**
 * A **published** exam result, from `GET /results/:studentId`.
 *
 * Nothing writes a `Result` yet, so the endpoint truthfully returns `null` for every
 * student and the portal shows "not published". The page it feeds used to invent a
 * score, national rank and percentile by hashing whatever ID was typed in.
 */
export interface PublishedResult {
  studentId: string
  studentName: string | null
  examId: string
  score: number
  totalMarks: number
  accuracy: number
  nationalRank: number | null
  statewiseRank: number | null
  percentile: number | null
  xpEarned: number
  badges: string[]
  submittedAt: string | null
}

export interface ResultResponse {
  result: PublishedResult | null
  reason?: 'not-published'
}

/** A certificate the student has actually earned — requires a published result. */
export interface EarnedCertificate {
  id: string
  studentId: string
  studentName: string | null
  title: string
  examId: string
  issuedAt: string | null
  percentile: number | null
}

/** One day's count in an admin statistics series. */
export interface DayCount {
  day: string
  count: number
}

/** Real platform activity for the admin dashboard, replacing a sample chart. */
export interface AdminStats {
  registrationsByDay: DayCount[]
  activeStudentsByDay: DayCount[]
  totalStudents: number
  totalActiveToday: number
}

/** Real participation counts for the public landing page. */
export interface PublicStats {
  studentsRegistered: number
  registeredToday: number
  schoolsRepresented: number
  studentsActiveToday: number
}

/**
 * The student-facing view of a question — no `isCorrect`, `solution`,
 * `booleanAnswer`, `numericAnswer` or `tolerance`. Kept as its own interface rather
 * than making those optional on `AdminQuestion`: optional answer fields are how an
 * answer key eventually leaks into a student view.
 */
/**
 * Practice Zone (Milestone 6).
 *
 * The split between these two shapes is the client half of the answer-integrity rule:
 * `PracticeQuestion` is what the browser is given **while working** and has no field
 * that could reveal an answer, and `PracticeReviewQuestion` adds the reveal and only
 * ever arrives from a submitted session. Keeping them as separate types rather than one
 * with optional fields means a component cannot accidentally read `correctAnswer` on a
 * question that is still in progress — it would not compile.
 */
export type PracticeStatus = 'in_progress' | 'submitted' | 'abandoned'

export interface PracticeResponse {
  selectedOptionKeys: string[]
  numericResponse: number | null
  booleanResponse: boolean | null
  answered: boolean
}

export interface PracticeQuestion extends StudentQuestion {
  order: number
  response: PracticeResponse
}

export interface PracticeReviewQuestion extends PracticeQuestion {
  outcome: {
    isCorrect: boolean | null
    awardedMarks: number
    marks: number
    negativeMarks: number
  }
  correctAnswer: {
    optionKeys: string[]
    booleanAnswer: boolean | null
    numericAnswer: number | null
    tolerance: number | null
  }
  explanation: string | null
  /** The question has been edited since it was served. */
  revisionChanged: boolean
}

export interface PracticeSessionFilters {
  subject: QuestionRef | null
  topic: QuestionRef | null
  difficulty: Difficulty | null
  classLevel: ClassLevel
}

interface PracticeSessionBase {
  id: string
  status: PracticeStatus
  totalQuestions: number
  maxMarks: number
  answeredCount: number
  startedAt: string
  submittedAt: string | null
  filters: PracticeSessionFilters
}

export interface PracticeSessionInProgress extends PracticeSessionBase {
  status: 'in_progress' | 'abandoned'
  questions: PracticeQuestion[]
}

export interface PracticeSessionReview extends PracticeSessionBase {
  status: 'submitted'
  score: number
  correctCount: number
  incorrectCount: number
  unansweredCount: number
  accuracy: number
  timeTakenSeconds: number
  questions: PracticeReviewQuestion[]
}

export type PracticeSessionView = PracticeSessionInProgress | PracticeSessionReview

/** Narrows a session to its graded form. The one place the distinction is decided. */
export function isReviewed(session: PracticeSessionView): session is PracticeSessionReview {
  return session.status === 'submitted'
}

export interface PracticeTopicOption {
  topicId: string
  topicName: string
  questionCount: number
  difficulties: Difficulty[]
}

export interface PracticeSubjectOption {
  subjectId: string
  subjectName: string
  questionCount: number
  difficulties: Difficulty[]
  topics: PracticeTopicOption[]
}

export interface PracticeOptionsResponse {
  classLevel: ClassLevel | null
  subjects: PracticeSubjectOption[]
  reason?: 'no-class'
}

/** One row of practice history. Carries no answers and no per-question detail. */
export interface PracticeHistoryEntry {
  id: string
  status: PracticeStatus
  totalQuestions: number
  maxMarks: number
  score: number | null
  accuracy: number | null
  correctCount: number | null
  timeTakenSeconds: number | null
  startedAt: string
  submittedAt: string | null
  filters: {
    subject: QuestionRef | null
    topic: QuestionRef | null
    difficulty: Difficulty | null
  }
}

export interface StudentQuestion {
  id: string
  questionText: string
  type: QuestionType
  options: Array<{ key: string; text: string }>
  subject: QuestionRef | null
  topic: QuestionRef | null
  subtopic: QuestionRef | null
  classLevel: ClassLevel
  difficulty: Difficulty
  marks: number
  negativeMarks: number
  tags: string[]
  revision: number
}

export interface DailyChallenge {
  day: string
  question: StudentQuestion
}

/**
 * Mock tests (Milestone 7).
 *
 * The type split here is the client half of two server-side rules, and both are
 * expressed as separate interfaces rather than optional fields — so a component that
 * would read something it is not entitled to does not compile.
 *
 * **The answer key.** `MockAttemptQuestion` is what the browser is given while the
 * paper is open and has no field that could reveal an answer. `MockReviewQuestion`
 * adds the reveal and only ever arrives on an attempt the server has both graded *and*
 * decided may be disclosed.
 *
 * **Disclosure.** There are three shapes a finished attempt can arrive as, because the
 * test author has three positions available: the full review, the score without the
 * answers, and the bare fact that it was submitted. `MockAttemptView` is the union, and
 * the two narrowing helpers below are the only place the distinction is decided.
 */
export type MockTestStatus = 'draft' | 'published' | 'archived'
export type MockAttemptStatus = 'in_progress' | 'submitted'
export type ResultDisplayMode = 'immediate' | 'after_close' | 'hidden'
export type ReviewPolicy = 'immediate' | 'after_close' | 'never'
export type MockUnavailableReason = 'not-published' | 'not-open-yet' | 'closed' | 'attempts-used' | 'wrong-class'

export interface MockDisclosure {
  showResult: boolean
  showReview: boolean
  reason: 'in-progress' | 'awaiting-close' | 'withheld' | null
}

/** One row in the student's attempt history. Carries no per-question detail. */
export interface MockAttemptSummary {
  id: string
  testId: string
  testTitle: string | null
  attemptNumber: number
  status: MockAttemptStatus
  totalQuestions: number
  maxMarks: number
  startedAt: string
  expiresAt: string
  submittedAt: string | null
  autoSubmitted: boolean
  resultAvailable: boolean
  reviewAvailable: boolean
  disclosureReason: MockDisclosure['reason']
  /** Null when the test withholds results, not merely when there is no score. */
  score: number | null
  accuracy: number | null
  correctCount: number | null
  timeTakenSeconds: number | null
}

/** A test as it appears in the student's list, with their own attempt state. */
export interface MockTestSummary {
  id: string
  title: string
  description: string | null
  classLevel: ClassLevel
  totalQuestions: number
  totalMarks: number
  durationMinutes: number
  opensAt: string | null
  closesAt: string | null
  available: boolean
  unavailableReason: MockUnavailableReason | null
  maxAttempts: number
  attemptsUsed: number
  attemptsLeft: number
  resumeAttemptId: string | null
  attempts: MockAttemptSummary[]
}

/** The pre-start briefing. Still carries no questions. */
export interface MockTestDetail extends MockTestSummary {
  instructions: string | null
  resultDisplay: ResultDisplayMode
  reviewPolicy: ReviewPolicy
}

export interface MockTestListResponse {
  classLevel: ClassLevel | null
  tests: MockTestSummary[]
  reason?: 'no-class'
}

export interface MockAttemptResponse {
  selectedOptionKeys: string[]
  numericResponse: number | null
  booleanResponse: boolean | null
  answered: boolean
}

export interface MockAttemptQuestion extends StudentQuestion {
  order: number
  response: MockAttemptResponse
}

export interface MockReviewQuestion extends MockAttemptQuestion {
  outcome: {
    isCorrect: boolean | null
    awardedMarks: number
    marks: number
    negativeMarks: number
  }
  correctAnswer: {
    optionKeys: string[]
    booleanAnswer: boolean | null
    numericAnswer: number | null
    tolerance: number | null
  }
  explanation: string | null
  /** The question has been edited since it was served. */
  revisionChanged: boolean
}

interface MockAttemptBase {
  id: string
  testId: string
  testTitle: string | null
  attemptNumber: number
  status: MockAttemptStatus
  totalQuestions: number
  maxMarks: number
  startedAt: string
  submittedAt: string | null
}

export interface MockAttemptInProgress extends MockAttemptBase {
  status: 'in_progress'
  answeredCount: number
  durationMinutes: number
  expiresAt: string
  /** The server's remaining time. The countdown on screen is derived from this. */
  secondsRemaining: number
  questions: MockAttemptQuestion[]
}

/** Submitted, and the score released — but not necessarily the answers. */
export interface MockAttemptResult extends MockAttemptBase {
  status: 'submitted'
  score: number
  correctCount: number
  incorrectCount: number
  unansweredCount: number
  accuracy: number
  timeTakenSeconds: number
  autoSubmitted: boolean
}

/** Submitted, and the answers released too. */
export interface MockAttemptReview extends MockAttemptResult {
  questions: MockReviewQuestion[]
}

/** Submitted, and nothing released. All the student is told is that it is done. */
export interface MockAttemptWithheld extends MockAttemptBase {
  status: 'submitted'
  autoSubmitted: boolean
}

export type MockAttemptView = MockAttemptInProgress | MockAttemptResult | MockAttemptReview | MockAttemptWithheld

export function isMockAttemptOpen(attempt: MockAttemptView): attempt is MockAttemptInProgress {
  return attempt.status === 'in_progress'
}

/**
 * Narrows to the graded-and-revealed shape.
 *
 * Checks for the `questions` array rather than trusting the disclosure flag alongside
 * it: the array is the thing being consumed, and this way the type cannot claim a
 * review that the payload does not actually contain.
 */
export function isMockAttemptReviewed(attempt: MockAttemptView): attempt is MockAttemptReview {
  return attempt.status === 'submitted' && Array.isArray((attempt as MockAttemptReview).questions)
}

export function isMockAttemptScored(attempt: MockAttemptView): attempt is MockAttemptResult {
  return attempt.status === 'submitted' && typeof (attempt as MockAttemptResult).score === 'number'
}

// --- Admin ---

export interface AdminMockTestQuestion {
  id: string
  order: number
  marks: number
  negativeMarks: number
  questionText: string | null
  type: QuestionType | null
  difficulty: Difficulty | null
  status: QuestionStatus | null
  subject: QuestionRef | null
  topic: QuestionRef | null
}

export interface AdminMockTest {
  id: string
  title: string
  description: string | null
  instructions: string | null
  classLevel: ClassLevel
  durationMinutes: number
  totalMarks: number
  totalQuestions: number
  availableFrom: string | null
  availableTo: string | null
  maxAttempts: number
  resultDisplay: ResultDisplayMode
  reviewPolicy: ReviewPolicy
  status: MockTestStatus
  questions: AdminMockTestQuestion[]
  createdByLabel: string | null
  updatedByLabel: string | null
  publishedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MockTestResultRow {
  id: string
  student: { id: string; studentId: string | null; fullName: string | null; schoolName: string | null }
  attemptNumber: number
  status: MockAttemptStatus
  score: number | null
  maxMarks: number
  accuracy: number | null
  correctCount: number
  incorrectCount: number
  unansweredCount: number
  timeTakenSeconds: number | null
  autoSubmitted: boolean
  rank: number | null
  startedAt: string
  submittedAt: string | null
}

export interface MockTestResults {
  test: {
    id: string
    title: string
    classLevel: ClassLevel
    totalMarks: number
    totalQuestions: number
    durationMinutes: number
    status: MockTestStatus
    availableFrom: string | null
    availableTo: string | null
  }
  stats: {
    attemptsStarted: number
    attemptsSubmitted: number
    attemptsInProgress: number
    autoSubmittedCount: number
    distinctStudents: number
    averageScore: number | null
    highestScore: number | null
    lowestScore: number | null
    averageAccuracy: number | null
    averageTimeSeconds: number | null
  }
  rows: MockTestResultRow[]
  questionStats: Array<{
    id: string
    order: number
    questionText: string | null
    served: number
    answered: number
    correct: number
    correctPercent: number | null
  }>
}
