/**
 * The single source of truth for authorization in this backend.
 *
 * Every access decision is expressed as a *permission*, never as an inline role
 * comparison. Routes declare the permission they need
 * (`requirePermission('students:read')`) and this module decides which roles hold
 * it. That means adding a role, or moving a capability between roles, is a change
 * to the table below and nothing else — there are no `role === 'admin'` checks
 * scattered through handlers to hunt down (see CLAUDE.md "Architecture Rules").
 *
 * The frontend never re-implements this table: the effective permission list is
 * sent to the client in the auth responses, so the UI and the API can never
 * disagree about what a user may do.
 */

export const ROLES = ['student', 'admin', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that can be assigned to a database-backed account through the API. */
export const ASSIGNABLE_ROLES = ['student', 'admin'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const PERMISSIONS = [
  // --- Student-facing capabilities ---
  /** Read one's own performance analytics. */
  'analytics:read:self',
  /** Sit an exam / attempt questions. */
  'exam:take',
  /** Read the question bank. */
  'questions:read',

  // --- Administrative capabilities ---
  /** Read any student's analytics, not just one's own. */
  'analytics:read:any',
  /** List, search and view student accounts. */
  'students:read',
  /** Suspend, deactivate or reactivate a student account. */
  'students:status:write',
  /** Create and edit questions, and move them through the editorial workflow. */
  'questions:write',
  /**
   * Hard-delete a question. Separate from `questions:write` because it is the one
   * question-bank action that destroys data rather than changing it — archiving,
   * which is the normal removal path, needs only `questions:write`.
   */
  'questions:delete',
  /** Create, edit and archive subjects, topics and subtopics. */
  'taxonomy:write',
  /**
   * Author mock tests, publish and unpublish them, and read every student's
   * attempts and results for them. Distinct from `questions:write` because
   * assembling and scheduling an assessment is a different job from writing the
   * questions in the bank, and because it carries the right to read other
   * students' scores — which authoring a question does not.
   */
  'mocktests:write',
  /**
   * Schedule the daily challenge — choose which published question a given class
   * gets on a given day — and read how each day's challenge landed. Separate from
   * `questions:write` for the same reason as `mocktests:write`: deciding what a
   * cohort is set today is a scheduling job, not an authoring one, and it carries
   * the right to see how many students got it right.
   */
  'challenges:write',
  /** Read the administrative audit trail. */
  'audit:read',

  // --- Super-admin capabilities ---
  /** Grant or revoke the admin role on an account. */
  'users:role:write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STUDENT_PERMISSIONS: readonly Permission[] = [
  'analytics:read:self',
  'exam:take',
  'questions:read',
];

/**
 * An admin runs the competition day to day: they can see every account and put a
 * misbehaving one on hold, but they cannot change who is an admin. Confining
 * privilege *escalation* to the super admin is the whole point of the third role
 * — otherwise any compromised admin session could mint more admins.
 */
const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...STUDENT_PERMISSIONS,
  'analytics:read:any',
  'students:read',
  'students:status:write',
  'questions:write',
  'questions:delete',
  'taxonomy:write',
  'mocktests:write',
  'challenges:write',
  'audit:read',
];

const SUPERADMIN_PERMISSIONS: readonly Permission[] = [...ADMIN_PERMISSIONS, 'users:role:write'];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  student: STUDENT_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  superadmin: SUPERADMIN_PERMISSIONS,
};

/** The permissions a role holds, as a plain array safe to send to a client. */
export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Permissions no `student` holds. A request needing one of these is by definition
 * a privileged request, so the authorization middleware re-checks it against the
 * database instead of trusting the (up to 15-minute-old) access token alone —
 * that is what makes a demotion or suspension take effect immediately rather than
 * at the next token expiry. See SECURITY.md.
 */
export function isElevated(permission: Permission): boolean {
  return !STUDENT_PERMISSIONS.includes(permission);
}

/** True if any of the required permissions is elevated. */
export function requiresFreshCheck(permissions: readonly Permission[]): boolean {
  return permissions.some(isElevated);
}

/**
 * True for any role holding administrative capability. Derived from the table
 * above rather than written as `role !== 'student'`, so adding a role cannot leave
 * this behind.
 */
export function isPrivilegedRole(role: Role): boolean {
  return ROLE_PERMISSIONS[role].some(isElevated);
}
