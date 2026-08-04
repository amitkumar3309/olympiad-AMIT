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
  | 'questions.generated'
  | 'question.created'
  | 'question.updated'
  | 'question.status.changed'
  | 'question.deleted'
  | 'subject.changed'
  | 'topic.changed'
  | 'admin.session.started'
  | 'authz.denied'

export interface AuditEntry {
  id: string
  action: AuditAction
  actorRole: Role
  actorLabel: string
  targetType: 'student' | 'question' | 'subject' | 'topic' | 'route' | 'system'
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
