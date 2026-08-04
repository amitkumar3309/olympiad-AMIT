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
  | 'audit:read'
  | 'users:role:write'

export interface Student {
  fullName: string
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
  | 'admin.session.started'
  | 'authz.denied'

export interface AuditEntry {
  id: string
  action: AuditAction
  actorRole: Role
  actorLabel: string
  targetType: 'student' | 'question' | 'route' | 'system'
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
