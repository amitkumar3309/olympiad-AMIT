/**
 * Mirrors `ACCOUNT_STATUSES` in `backend/src/models/Student.ts`. Three of the four
 * bar sign-in, and they are distinct on purpose: `suspended` is a temporary hold,
 * `blocked` is a ban, `deactivated` is a closed account.
 */
export type AccountStatus = 'active' | 'suspended' | 'blocked' | 'deactivated'

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
  | 'challenges:write'
  | 'rewards:write'
  | 'audit:read'
  | 'gallery:write'
  | 'notifications:write'
  | 'exam:write'
  | 'certificates:write'
  | 'users:password:reset'
  | 'users:sessions:revoke'
  | 'users:role:write'
  | 'users:delete'

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
  /**
   * Set when staff have issued a temporary password. The app holds the session on
   * a forced change screen until it clears — see `ForcePasswordChange`.
   */
  mustChangePassword?: boolean
}

/** An account as an administrator sees it — wider than a student's own view. */
export interface ManagedAccount {
  id: string
  studentId: string
  fullName: string | null
  email: string
  mobile: string
  role: Role
  status: AccountStatus
  isEmailVerified: boolean
  registeredAt: string
  lastLoginAt: string | null
  lockedUntil: string | null
  roleUpdatedAt: string | null
  roleUpdatedBy: string | null
  /** True while a staff-issued temporary password is still outstanding. */
  mustChangePassword: boolean
  passwordResetAt: string | null
  passwordResetBy: string | null
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
  | 'user.password.reset'
  | 'user.sessions.revoked'
  | 'user.deleted'
  | 'gallery.changed'
  | 'notification.changed'
  | 'exam.changed'
  | 'exam.results.published'
  | 'certificate.revoked'
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
  | 'dailychallenge.scheduled'
  | 'dailychallenge.updated'
  | 'dailychallenge.deleted'
  | 'reward.settings.updated'
  | 'subject.changed'
  | 'topic.changed'
  | 'admin.session.started'
  | 'authz.denied'

export interface AuditEntry {
  id: string
  action: AuditAction
  actorRole: Role
  actorLabel: string
  targetType:
    | 'student'
    | 'question'
    | 'mocktest'
    | 'dailychallenge'
    | 'subject'
    | 'topic'
    | 'gallery'
    | 'notification'
    | 'exam'
    | 'certificate'
    | 'route'
    | 'system'
  targetId: string | null
  targetLabel: string | null
  outcome: 'success' | 'denied'
  metadata: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

/** Real XP earned on one competition day. Days with no activity are omitted. */
export interface XpDayPoint {
  day: string
  xp: number
}

// ---------------------------------------------------------------------------
// Performance analytics (Milestone 15)
// ---------------------------------------------------------------------------

/** Which kind of sitting an answer came from. */
export type AnalyticsSurface = 'practice' | 'mock_test' | 'daily_challenge' | 'official_exam'

export const SURFACE_LABELS: Record<AnalyticsSurface, string> = {
  practice: 'Practice',
  mock_test: 'Mock tests',
  daily_challenge: 'Daily challenge',
  official_exam: 'Official exam',
}

/**
 * Raw counts plus the two percentages derived from them.
 *
 * Both percentages are `number | null`, and the distinction is the point: `null` means
 * "nothing has been answered here", which is a different fact from `0`, which means
 * "answered, and all wrong". Rendering a null as `0%` would put the first student's
 * blank record on the same footing as the second's, so every consumer must branch.
 */
export interface PerformanceRow {
  served: number
  answered: number
  correct: number
  marksAwarded: number
  marksAvailable: number
  accuracyPercent: number | null
  scorePercent: number | null
}

export interface NamedPerformanceRow extends PerformanceRow {
  id: string
  name: string
  subjectName?: string | null
}

export interface AreaRow {
  scope: 'topic' | 'subject' | 'difficulty'
  id: string
  name: string
  accuracyPercent: number
  answered: number
}

export interface DayAccuracy {
  day: string
  answered: number
  correct: number
  accuracyPercent: number | null
}

export interface AttemptPoint {
  surface: AnalyticsSurface
  at: string
  label: string
  score: number
  maxMarks: number
  scorePercent: number | null
  answered: number
  correct: number
  served: number
  accuracyPercent: number | null
  /** Null where the surface has no clock — the daily challenge. */
  timeTakenSeconds: number | null
}

export interface PacePoint {
  at: string
  surface: AnalyticsSurface
  label: string
  questions: number
  secondsPerQuestion: number
}

/**
 * Everything `GET /analytics/:studentId` derives, from real submitted attempts.
 *
 * There is no analytics collection behind this — it is computed on read from the four
 * attempt collections, the same derived-not-stored decision XP and the leaderboard rest
 * on. `notes` carries machine-readable reasons a section is empty, so the page can
 * explain itself rather than showing an unexplained blank.
 */
export interface StudentAnalytics {
  generatedAt: string
  hasData: boolean
  overall: PerformanceRow & {
    attempts: number
    servedIncludingDeletedQuestions: number
    averageSecondsPerQuestion: number | null
  }
  bySurface: Array<PerformanceRow & { surface: AnalyticsSurface; attempts: number }>
  byTopic: NamedPerformanceRow[]
  bySubject: NamedPerformanceRow[]
  byDifficulty: Array<PerformanceRow & { difficulty: Difficulty }>
  byType: Array<PerformanceRow & { type: QuestionType }>
  strongAreas: AreaRow[]
  weakAreas: AreaRow[]
  accuracyByDay: DayAccuracy[]
  progressTrend: AttemptPoint[]
  paceTrend: PacePoint[]
  minimumAreaSample: number
  notes: string[]
}

export interface AnalyticsResponse {
  analytics: StudentAnalytics
  /** Participation, from the activity log. Measures something different from the rest. */
  xpByDay: XpDayPoint[]
}

// ---------------------------------------------------------------------------
// Performance recommendations (Milestone 16)
// ---------------------------------------------------------------------------

export type RecommendationKind = 'weak_topic' | 'strong_topic' | 'difficulty' | 'practice' | 'insight'
export type Confidence = 'low' | 'medium' | 'high'

/**
 * The counts a recommendation was derived from — required, never optional.
 *
 * The page shows this rather than hiding it, because a recommendation the reader cannot
 * check is indistinguishable from one that was made up. That distinction is the whole
 * reason the previous "AI insights" feature was deleted in Milestone 15.
 */
export interface RecommendationBasis {
  scope: 'overall' | 'topic' | 'subject' | 'difficulty' | 'surface' | 'bank' | 'trend'
  scopeId: string | null
  scopeName: string | null
  answered: number
  correct: number
  accuracyPercent: number | null
  /** 95% Wilson interval around the accuracy. Null when there is no sample. */
  lowerBoundPercent: number | null
  upperBoundPercent: number | null
  figures: Record<string, number>
}

export interface Recommendation {
  id: string
  kind: RecommendationKind
  title: string
  detail: string
  priority: number
  confidence: Confidence
  basis: RecommendationBasis
  action: { label: string; href: string } | null
}

/**
 * How the recommendations were produced.
 *
 * `kind` is a statement of fact: `'statistical'` means arithmetic over the student's
 * answers, `'model'` means a real trained model produced them. The page prints `basis`
 * verbatim so a reader is never left guessing which one they are looking at.
 */
export interface RecommendationEngineDescriptor {
  id: string
  label: string
  kind: 'statistical' | 'model'
  basis: string
}

export interface RecommendationSet {
  generatedAt: string
  engine: RecommendationEngineDescriptor
  hasData: boolean
  minimumSample: number
  weakTopics: Recommendation[]
  strongTopics: Recommendation[]
  difficulty: Recommendation[]
  practice: Recommendation[]
  insights: Recommendation[]
  /** Machine-readable reasons a section is empty. */
  notes: string[]
}

export interface RecommendationsResponse {
  recommendations: RecommendationSet
}

// ---------------------------------------------------------------------------
// Question generation (Milestone 17)
// ---------------------------------------------------------------------------

/**
 * What produced a batch of draft questions.
 *
 * `kind` is a statement of fact the page prints: `'template'` means blank forms were
 * filled in, `'model'` means a real language model wrote the text. The distinction is
 * recorded in the audit trail too, so "was this question written by a machine?" stays
 * answerable later.
 */
export interface QuestionGeneratorDescriptor {
  id: string
  label: string
  kind: 'template' | 'model'
  basis: string
}

export interface QuestionGeneratorStatus {
  generator: QuestionGeneratorDescriptor
  available: boolean
  alternatives: Array<QuestionGeneratorDescriptor & { available: boolean }>
}

/** A candidate the server refused, with the rule it broke. Shown, never hidden. */
export interface RejectedCandidate {
  index: number
  reason: string
}

export interface GeneratedDraft {
  id: string
  questionText: string
  type: QuestionType
  status: string
}

export interface GenerateQuestionsResponse {
  message: string
  generator: QuestionGeneratorDescriptor
  requested: number
  rejected: RejectedCandidate[]
  notes: string[]
  questions: GeneratedDraft[]
}

/** One question's measured performance, for the admin console. */
export interface QuestionPerformanceRow {
  id: string
  preview: string
  type: QuestionType
  difficulty: Difficulty
  classLevel: ClassLevel
  status: string
  topicName: string | null
  subjectName: string | null
  served: number
  answered: number
  correct: number
  accuracyPercent: number | null
  /** How often a served question was left blank — a mis-worded question's signature. */
  skipRatePercent: number | null
  marksAwarded: number
  marksAvailable: number
}

export interface QuestionPerformanceResponse {
  questions: QuestionPerformanceRow[]
  questionsWithData: number
  minAnswered: number
  notes: string[]
  pagination: Pagination
}

/** One paper's cohort performance. `kind` keeps a rehearsal from reading as the Olympiad. */
export interface TestPerformanceRow {
  id: string
  kind: 'mock_test' | 'official_exam'
  title: string
  classLevel: ClassLevel
  status: string
  totalMarks: number
  questionCount: number
  attemptsStarted: number
  attemptsSubmitted: number
  completionPercent: number | null
  distinctStudents: number
  averageScorePercent: number | null
  /** Reported alongside the mean, because one blank submission moves a small cohort. */
  medianScorePercent: number | null
  highestScorePercent: number | null
  lowestScorePercent: number | null
  averageAccuracyPercent: number | null
  averageSecondsPerQuestion: number | null
}

export interface TestPerformanceResponse {
  tests: TestPerformanceRow[]
  notes: string[]
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
  'daily_challenge_completed',
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
  daily_challenge_completed: { label: 'Answered the daily challenge', icon: 'ph-dice-five' },
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

/**
 * A level and the position inside it, exactly as `lib/xp.ts` computes it.
 *
 * Split out in Milestone 9 because the rewards endpoint returns it as its own object
 * while the dashboard flattens it alongside the streak. Both are the same figures from
 * the same function — the shapes differ, the numbers cannot.
 */
export interface LevelProgress {
  xp: number
  level: number
  levelStartsAt: number
  nextLevelAt: number
  xpIntoLevel: number
  xpForNextLevel: number
  percentToNextLevel: number
}

export interface ProgressSummary extends LevelProgress {
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
  /**
   * Null when the student is genuinely not on this board — no XP in the window, an
   * account not in good standing, or a class board that is not theirs. The `xp` is
   * still real in every one of those cases; what is missing is the position.
   */
  rank: number | null
  xp: number
  totalRanked: number
}

// ---------------------------------------------------------------------------
// Leaderboards and Hall of Fame (Milestone 10)
// ---------------------------------------------------------------------------

/**
 * Mirrors `LEADERBOARD_SCOPES` / `LEADERBOARD_PERIODS` in
 * `backend/src/services/leaderboardService.ts`.
 *
 * As with the permission names and the class list, this is only a *list*: the ranking
 * itself — which rows are summed, how ties are broken, what rank a student holds — is
 * decided entirely by the backend. **Nothing in the frontend computes or re-sorts a
 * rank.** A page that re-sorted rows it was given would be a second ranking
 * implementation, and two of those eventually disagree on somebody's screen.
 */
export const LEADERBOARD_SCOPES = ['overall', 'class'] as const
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number]

export const LEADERBOARD_PERIODS = ['all_time', 'monthly', 'weekly', 'daily'] as const
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number]

export const LEADERBOARD_PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
  all_time: 'All time',
  monthly: 'Last 30 days',
  weekly: 'Last 7 days',
  daily: 'Today',
}

/** The competition days a board's XP was summed over. `from` is null for all time. */
export interface LeaderboardWindow {
  from: string | null
  to: string
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardRow[]
  scope: LeaderboardScope
  classLevel: ClassLevel | null
  period: LeaderboardPeriod
  window: LeaderboardWindow
  pagination: Pagination
  /** The caller's own standing on this board. Null when signed out. */
  me: LeaderboardStanding | null
  /** How far a signed-out visitor may page. Null when the caller may see it all. */
  maxRankedDepth: number | null
  today: string
}

export type HallOfFameBoardCode =
  | 'xp_champions'
  | 'mock_masters'
  | 'streak_legends'
  | 'challenge_champions'
  | 'practice_devotees'

export interface HallOfFameEntry {
  rank: number
  studentId: string
  displayName: string
  classLevel: string | null
  schoolName: string | null
  /** The measured number the board ranks on. Always derived server-side. */
  value: number
  /** How to read that number, e.g. `92% · 46/50`. Composed by the backend. */
  valueLabel: string
  achievedOn: string | null
  detail: string | null
}

export interface HallOfFameBoard {
  code: HallOfFameBoardCode
  title: string
  description: string
  icon: string
  entries: HallOfFameEntry[]
  /** Shown in place of the board when it is empty. Never a placeholder entry. */
  emptyReason: string
}

export interface HallOfFameResponse {
  hallOfFame: {
    boards: HallOfFameBoard[]
    totals: {
      studentsRanked: number
      xpAwarded: number
      mockTestsGraded: number
      challengesAnswered: number
      practiceSessionsCompleted: number
    }
    generatedFor: string
  }
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

/**
 * The daily challenge (Milestone 8).
 *
 * `DailyChallengeToday` splits into two states the same way the mock-test types do, and
 * for the same reason: `attempt` is `null` until the student has answered, and the
 * answer key lives only on `DailyChallengeResult`. A component handed the unanswered
 * shape cannot read a correct answer out of it — there is no field to read.
 */
export interface DailyChallenge {
  day: string
  challengeId: string
  classLevel: ClassLevel
  question: StudentQuestion
}

export interface DailyChallengeResult {
  id: string
  day: string
  submittedAt: string
  xpAwarded: number
  isCorrect: boolean
  awardedMarks: number
  marks: number
  response: {
    selectedOptionKeys: string[]
    numericResponse: number | null
    booleanResponse: boolean | null
  }
  correctAnswer: {
    optionKeys: string[]
    booleanAnswer: boolean | null
    numericAnswer: number | null
    tolerance: number | null
  }
  explanation: string | null
  /** The question has been edited since it was answered. */
  revisionChanged: boolean
}

export interface ChallengeStreak {
  current: number
  longest: number
}

export interface DailyChallengeToday {
  challenge: DailyChallenge | null
  /** Null until answered. Its presence is what makes the reveal reachable. */
  attempt: DailyChallengeResult | null
  streak?: ChallengeStreak
  completedCount?: number
  reward?: { xp: number; claimed: boolean }
  today: string
  reason?: 'none-published' | 'no-class'
}

export interface DailyChallengeAnswerResponse {
  attempt: DailyChallengeResult
  /** True when today's answer was already in — nothing was re-graded or re-paid. */
  alreadyAnswered: boolean
  /** What *this* request awarded: 0 on a repeat submission. */
  xpAwarded: number
  streak: ChallengeStreak
  completedCount: number
}

/** One row of the student's own challenge history. */
export interface DailyChallengeHistoryEntry {
  id: string
  day: string
  submittedAt: string
  isCorrect: boolean
  awardedMarks: number
  marks: number
  xpAwarded: number
  questionText: string | null
  subject: QuestionRef | null
  topic: QuestionRef | null
}

export interface DailyChallengeHistoryResponse {
  attempts: DailyChallengeHistoryEntry[]
  streak: ChallengeStreak
  completedCount: number
  pagination: Pagination
}

// --- Admin ---

export type ChallengeSource = 'scheduled' | 'automatic'

export interface AdminDailyChallenge {
  id: string
  day: string
  classLevel: ClassLevel
  source: ChallengeSource
  marks: number
  question: {
    id: string
    questionText: string | null
    type: QuestionType | null
    difficulty: Difficulty | null
    status: QuestionStatus | null
    subject: QuestionRef | null
    topic: QuestionRef | null
  }
  attempts: number
  correct: number
  /** Of those who answered; null when nobody did. */
  correctPercent: number | null
  createdByLabel: string | null
  createdAt: string
}

export interface AdminDailyChallengeListResponse {
  challenges: AdminDailyChallenge[]
  /** The server's competition day — never computed in the browser. */
  today: string
  upcoming: string[]
  pagination: Pagination
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


// ---------------------------------------------------------------------------
// Gamification (Milestone 9)
// ---------------------------------------------------------------------------

/**
 * The three catalogues, as the server evaluates them.
 *
 * All of it is **derived** server-side from recorded events — there is no stored
 * progress document anywhere in this product — so these types describe a computed
 * answer, not a row. The frontend renders them and never recomputes a tier, a stage or
 * an XP total for itself; doing so is how two screens start disagreeing.
 */
export type BadgeTier = 'bronze' | 'silver' | 'gold'

export interface EvaluatedBadge {
  code: string
  name: string
  description: string
  icon: string
  /** What the family counts, in the student's words — e.g. "practice sessions". */
  unit: string
  /** The highest tier reached, or null when the family is not yet held. */
  tier: BadgeTier | null
  value: number
  /** The next tier to reach, or null once gold is held. */
  nextTier: BadgeTier | null
  progress: number
  target: number
  thresholds: [number, number, number]
}

export interface BadgeSummary {
  heldCount: number
  total: number
  badges: EvaluatedBadge[]
}

export interface JourneyStage {
  id: string
  title: string
  description: string
  icon: string
  complete: boolean
  /** Exactly one stage is current: the first incomplete one, i.e. what to do next. */
  current: boolean
  progress: number
  target: number
}

export interface JourneySummary {
  stages: JourneyStage[]
  completedCount: number
  total: number
  percent: number
  currentStageId: string | null
}

export interface RewardsResponse {
  rewards: {
    xp: number
    level: LevelProgress
    streak: StreakSummary
    challengeStreak: { current: number; longest: number }
    badges: BadgeSummary
    achievements: AchievementSummary
    journey: JourneySummary
    /** The real counts the catalogues were evaluated from. */
    totals: {
      practiceSessions: number
      mockTests: number
      dailyChallenges: number
      activeDays: number
    }
  }
  today: string
}

// --- Admin ---

export interface RewardTableRow {
  event: ActivityType
  /** What the code ships with. */
  defaultXp: number
  /** What an administrator set, or null when the default applies. */
  overrideXp: number | null
  /** What a grant would actually pay right now. */
  effectiveXp: number
}

export interface RewardConfigResponse {
  config: {
    table: RewardTableRow[]
    updatedByLabel: string | null
    updatedAt: string | null
  }
}

// ---------------------------------------------------------------------------
// Milestone 12 — the admin platform
// ---------------------------------------------------------------------------

export type GalleryStatus = 'published' | 'archived'

export interface GalleryItem {
  id: string
  title: string
  caption: string | null
  eventDate: string | null
  status: GalleryStatus
  displayOrder: number
  contentType: string
  size: number
  uploadedByLabel: string | null
  createdAt: string
  updatedAt: string | null
  /** Where to fetch the bytes. Same path for staff and the public. */
  imageUrl: string
}

/**
 * `student` is a system-only audience — staff cannot address one person from the
 * composer. It appears here because a *recipient* sees it on their own rows.
 */
export type NotificationAudience = 'all' | 'class' | 'student'
export type NotificationKind = 'announcement' | 'alert'
/** Written by a human, or generated from a real event. */
export type NotificationSource = 'staff' | 'system'

/** An announcement as staff see it, including how many students opened it. */
export interface AdminNotification {
  id: string
  title: string
  body: string
  kind: NotificationKind
  audience: NotificationAudience
  classLevel: ClassLevel | null
  source: NotificationSource
  /** The system event code, for a generated row. Null for anything staff wrote. */
  event: string | null
  link: string | null
  isPublished: boolean
  publishedAt: string | null
  createdByLabel: string | null
  createdAt: string
  updatedAt: string | null
  readCount: number
}

/** An announcement as its recipient sees it. */
export interface InboxNotification {
  id: string
  title: string
  body: string
  kind: NotificationKind
  audience: NotificationAudience
  classLevel: ClassLevel | null
  source: NotificationSource
  /** A relative in-app path to the thing this is about, or null. */
  link: string | null
  publishedAt: string | null
  read: boolean
  readAt: string | null
}

/**
 * What a staff email broadcast actually did.
 *
 * `suppressed` is reported rather than hidden so the composer can say "60 queued, 12
 * have these emails switched off" — the difference between a feature that looks
 * broken and one that explains itself.
 */
export interface BroadcastOutcome {
  recipients: number
  queued: number
  suppressed: number
  /** Set when the recipient list hit the server's cap. */
  cappedAt: number | null
}

/**
 * The two switchable email streams (Milestone 14).
 *
 * Deliberately short: these are the only optional streams that exist. Verification,
 * password reset, password-change warnings and account-status changes are always
 * sent, and the API reports them under `always` rather than offering dead switches.
 */
export interface NotificationPrefs {
  announcements: boolean
  results: boolean
}

export interface NotificationPrefsResponse {
  preferences: NotificationPrefs
  always: Array<{ category: string; reason: string }>
  /** In-app notifications are never suppressed by a preference. */
  inAppAlwaysOn: boolean
}

export type EmailCategory = 'transactional' | 'security' | 'announcement' | 'results'
export type EmailStatus = 'pending' | 'sent' | 'failed'

/** One row of the outbox, as the delivery console shows it. The body is never sent. */
export interface EmailDelivery {
  id: string
  to: string
  subject: string
  category: EmailCategory
  status: EmailStatus
  attempts: number
  maxAttempts: number
  nextAttemptAt: string
  lastAttemptAt: string | null
  /** The provider's own error message, for a row that failed. */
  lastError: string | null
  sentAt: string | null
  createdAt: string
}

export interface OutboxStats {
  pending: number
  sent: number
  failed: number
  /** Oldest unsent row — the honest answer to "is the queue stuck?". */
  oldestPendingAt: string | null
}

export interface DrainOutcome {
  claimed: number
  sent: number
  failed: number
  retrying: number
}

export interface DayCount {
  day: string
  count: number
}

export interface ClassBreakdownRow {
  classLevel: ClassLevel
  students: number
  activeStudents: number
  xp: number
}

/**
 * Every field here is counted from a collection. Where there is no data the
 * backend sends 0 — or `null` for an average, because "nothing has been sat" and
 * "everybody scored zero" are different facts.
 */
export interface PlatformAnalytics {
  generatedAt: string
  accounts: {
    total: number
    verified: number
    unverified: number
    active: number
    suspended: number
    blocked: number
    deactivated: number
    admins: number
  }
  engagement: {
    everActive: number
    activeLast7: number
    activeLast30: number
    registrationsByDay: DayCount[]
    activeStudentsByDay: DayCount[]
  }
  content: {
    questionsTotal: number
    questionsPublished: number
    questionsDraft: number
    mockTestsTotal: number
    mockTestsPublished: number
    galleryPublished: number
    announcementsPublished: number
  }
  assessment: {
    practiceSessionsSubmitted: number
    mockAttemptsSubmitted: number
    mockAveragePercent: number | null
    dailyChallengeAttempts: number
    dailyChallengeCorrect: number
  }
  xp: {
    awardedTotal: number
    earners: number
    averagePerEarner: number | null
  }
  byClass: ClassBreakdownRow[]
}

/** The leaderboard as staff see it — unmasked, unlike the public board. */
export interface AdminLeaderboardRow {
  rank: number
  studentId: string
  fullName: string | null
  email: string | null
  classLevel: ClassLevel | null
  schoolName: string | null
  status: AccountStatus | null
  xp: number
  level: number
}

export interface RewardsOverview {
  totalStudents: number
  earners: number
  neverEarned: number
  levels: Array<{ level: number; students: number }>
  achievements: Array<{
    code: string
    name: string
    description: string
    /** `null` means the condition is a consecutive-day streak, which cannot be
     *  counted by aggregation — not that nobody holds it. */
    holders: number | null
  }>
}

// ---------------------------------------------------------------------------
// Milestone 13 — the official exam and certificates
// ---------------------------------------------------------------------------

export type ExamStatus = 'draft' | 'published' | 'archived'
export type ExamWindowState = 'open' | 'not-open-yet' | 'closed' | 'not-published'
export type ExamAttemptStatus = 'in_progress' | 'submitted'

/** An official exam as a student sees it before sitting. Never the questions. */
export interface StudentExam {
  id: string
  examCode: string
  title: string
  description: string | null
  classLevel: ClassLevel
  durationMinutes: number
  totalMarks: number
  questionCount: number
  opensAt: string
  closesAt: string
  isOpen: boolean
  windowState: ExamWindowState
  resultsPublished: boolean
  attempt: {
    id: string
    status: ExamAttemptStatus
    startedAt: string
    submittedAt: string | null
  } | null
}

/** One question on a paper being sat. Carries no answer key. */
export interface ExamPaperQuestion {
  position: number
  marks: number
  negativeMarks: number
  selectedOptionKeys: string[]
  numericResponse: number | null
  booleanResponse: boolean | null
  answered: boolean
  question: StudentQuestion | null
}

export interface ExamAttemptInProgress {
  id: string
  status: ExamAttemptStatus
  startedAt: string
  expiresAt: string
  /** The server's clock. The countdown is a display of this, never an input. */
  secondsRemaining: number
  totalQuestions: number
  maxMarks: number
  questions: ExamPaperQuestion[]
}

export interface ExamResult {
  id: string
  examTitle: string
  examCode: string
  score: number
  maxMarks: number
  percentage: number
  accuracy: number
  rank: number
  totalCandidates: number
  percentile: number
  publishedAt: string | null
}

export interface AdminExam {
  id: string
  examCode: string
  title: string
  description: string | null
  instructions: string | null
  classLevel: ClassLevel
  durationMinutes: number
  totalMarks: number
  questionCount: number
  questions: Array<{ question: string; order: number; marks: number; negativeMarks: number }>
  opensAt: string
  closesAt: string
  windowState: ExamWindowState
  status: ExamStatus
  meritThresholdPercent: number
  distinctionThresholdPercent: number
  resultsPublishedAt: string | null
  resultsPublishedBy: string | null
  createdByLabel: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminExamAttempt {
  id: string
  studentId: string | null
  fullName: string | null
  schoolName: string | null
  status: ExamAttemptStatus
  score: number
  maxMarks: number
  percentage: number
  accuracy: number
  correctCount: number
  incorrectCount: number
  unansweredCount: number
  startedAt: string
  submittedAt: string | null
  submissionReason: 'manual' | 'time_expired' | null
  timeTakenSeconds: number
}

export type CertificateTier = 'participation' | 'merit' | 'distinction'

export interface Certificate {
  id: string
  certificateId: string
  /** Only ever sent to the holder and to staff — it is what proves the certificate. */
  verificationCode?: string
  tier: CertificateTier
  title: string
  studentName: string
  studentIdLabel: string
  classLevel: string
  schoolName: string | null
  examTitle: string
  examCode: string
  score: number
  maxMarks: number
  percentage: number
  rank: number
  totalCandidates: number
  issuedAt: string
  issuedBy: string | null
  revoked: boolean
  revokedAt: string | null
  revokedReason: string | null
}

/** What public verification returns. Everything comes from the certificate's snapshot. */
export interface VerificationResponse {
  valid: boolean
  status: 'valid' | 'revoked' | 'not-found'
  certificate?: {
    certificateId: string
    tier: CertificateTier
    title: string
    studentName: string
    studentIdLabel: string
    classLevel: string
    schoolName: string | null
    examTitle: string
    examCode: string
    score: number
    maxMarks: number
    percentage: number
    rank: number
    totalCandidates: number
    issuedAt: string
  }
  revokedAt?: string | null
  revokedReason?: string | null
}
