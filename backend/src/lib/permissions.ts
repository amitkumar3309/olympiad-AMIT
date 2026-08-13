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
  /**
   * Tune the XP award table. Deliberately narrow: it configures **amounts**, never
   * rules — which events exist, how often each may be earned and where the level
   * boundaries fall all stay in code. Separate from the other authoring permissions
   * because it is the one setting that changes the meaning of every student's future
   * progress at once, which is worth being able to withhold on its own.
   */
  'rewards:write',
  /** Read the administrative audit trail. */
  'audit:read',
  /**
   * Reset another account's password, issuing a one-time temporary password that
   * the holder must replace at their next sign-in.
   *
   * Held by `admin` as well as `superadmin` because password recovery is routine
   * competition-desk work — a schoolchild who cannot reach their email should not
   * need the owner of the platform. It is nevertheless the single most dangerous
   * routine capability in the product: it hands over a working credential, so the
   * data-level guard in `users.routes.ts` confines an `admin` to acting on plain
   * student accounts and refuses everyone on a `superadmin`.
   */
  'users:password:reset',
  /**
   * End every live session for an account without changing the password. The mild
   * remedy for "they left themselves signed in on a school computer", and the
   * reason it is separate from suspension: it interrupts access without marking the
   * account as being in any kind of trouble.
   */
  'users:sessions:revoke',
  /**
   * Upload, edit and remove the public event gallery. Separate from
   * `questions:write` because it is the one authoring permission whose output is
   * **published to the open internet** rather than served to a signed-in student —
   * a mistake here is visible to anybody, which is worth being able to withhold on
   * its own even though both currently sit with `admin`.
   */
  'gallery:write',
  /**
   * Compose and withdraw in-app announcements. Narrow on purpose: it reaches every
   * student at once, so it carries a different kind of blast radius from editing a
   * question that one cohort will eventually see.
   */
  'notifications:write',

  // --- Super-admin capabilities ---
  /** Grant or revoke the admin role on an account. */
  'users:role:write',
  /**
   * Permanently delete an account. Withheld from `admin` deliberately, and the
   * sharpest line between the two roles: every other administrative act in this
   * product is reversible, and this one is not. The route additionally refuses any
   * account that has verified its email, so what it can destroy is an abandoned
   * registration rather than a competitor's history.
   */
  'users:delete',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STUDENT_PERMISSIONS: readonly Permission[] = [
  'analytics:read:self',
  'exam:take',
  'questions:read',
];

/**
 * An admin runs the competition day to day: they can see every account, put a
 * misbehaving one on hold, and get a locked-out child back into their account —
 * but they cannot change who is an admin, and they cannot destroy an account.
 *
 * Those two exclusions are the whole point of the third role. Withholding role
 * assignment means a compromised admin session cannot mint more admins or promote
 * itself; withholding deletion means it cannot erase the evidence of having tried.
 * Everything an admin *can* do is reversible, and that is the line.
 */
const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...STUDENT_PERMISSIONS,
  'analytics:read:any',
  'students:read',
  'students:status:write',
  'users:password:reset',
  'users:sessions:revoke',
  'gallery:write',
  'notifications:write',
  'questions:write',
  'questions:delete',
  'taxonomy:write',
  'mocktests:write',
  'challenges:write',
  'rewards:write',
  'audit:read',
];

/**
 * The super admin is an admin plus the two irreversible capabilities. Expressed as
 * a superset rather than its own list so the guarantee "an admin can never do more
 * than a super admin" is structural — it cannot drift as permissions are added,
 * because there is no second place to add one.
 */
const SUPERADMIN_ONLY_PERMISSIONS: readonly Permission[] = ['users:role:write', 'users:delete'];

const SUPERADMIN_PERMISSIONS: readonly Permission[] = [
  ...ADMIN_PERMISSIONS,
  ...SUPERADMIN_ONLY_PERMISSIONS,
];

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

/**
 * True for a capability the super admin holds alone. Exported so the guarantee
 * "an `admin` is strictly weaker than a `superadmin`" can be asserted from a test
 * against this table rather than against a hand-copied list that could drift.
 */
export function isSuperadminOnly(permission: Permission): boolean {
  return (SUPERADMIN_ONLY_PERMISSIONS as readonly string[]).includes(permission);
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
