import mongoose, { Schema, type Document } from 'mongoose';
import { ROLES, type Role } from '../lib/permissions';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';

/**
 * Four states, three of which bar sign-in. They are kept distinct because the
 * audit trail has to be able to say *why* an account stopped working, and because
 * only one of them is meant to be undone as a matter of course:
 *
 * - `active`      — normal.
 * - `suspended`   — a temporary hold by staff, expected to be lifted.
 * - `blocked`     — a permanent bar by staff. A ban.
 * - `deactivated` — the account is closed rather than in trouble.
 *
 * Collapsing `blocked` into `suspended` would make a ban and a routine hold
 * indistinguishable in the trail a year later, which is exactly when someone asks.
 */
export const ACCOUNT_STATUSES = ['active', 'suspended', 'blocked', 'deactivated'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface StudentDocument extends Document {
  /**
   * Kept as the display name and derived from the three name parts on every
   * save, so the many places that already read `fullName` (the admin list, its
   * search, the session envelope, the certificate) keep working unchanged.
   */
  fullName?: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  fatherName: string;
  motherName: string;
  dateOfBirth: Date;
  classLevel: ClassLevel;
  schoolName: string;
  address: string;
  mobile: string;
  email: string;
  passwordHash: string;
  studentId: string;
  isEmailVerified: boolean;
  status: AccountStatus;
  /**
   * Authorization role for this account. Every account starts as `student`; a
   * super admin promotes one to `admin` (see routes/v1/users.routes.ts).
   *
   * `superadmin` **is** storable here, because the root account now has a document
   * (auto-provisioned from `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` on first sign-in,
   * so it can hold a refresh-token family like any other account). It remains
   * un-*assignable*: `ASSIGNABLE_ROLES` omits it, so no API call can mint a second
   * one — the only writer is the bootstrap in `auth.routes.ts`.
   */
  role: Role;
  /**
   * Set when staff issue a temporary password. The holder keeps a working session
   * but must replace the password before the account is useful again.
   */
  mustChangePassword: boolean;
  /** Who issued the temporary password, and when. Never the password itself. */
  passwordResetAt?: Date | null;
  passwordResetBy?: string | null;
  /** Audit convenience: when the role last changed, and who changed it. */
  roleUpdatedAt?: Date | null;
  roleUpdatedBy?: string | null;
  /**
   * Bumped to invalidate every previously issued access token for this student
   * (password reset, logout-everywhere). Access tokens carry the value they
   * were signed with; a mismatch means the token predates the revocation.
   */
  tokenVersion: number;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;
  registeredAt: Date;
  /**
   * Which optional **email** streams this student wants (Milestone 14).
   *
   * Two properties are load-bearing:
   *
   *  - **These control email only, never the in-app inbox.** A notice board a
   *    student can empty is not a record, and read state would become meaningless if
   *    rows could be suppressed at write time — "unread" and "never delivered" would
   *    be indistinguishable. Everything is always written; this decides what is also
   *    posted out.
   *  - **Only the optional categories appear here.** There is no switch for
   *    `transactional` or `security`, by design — see `isOptionalCategory()`. A
   *    setting that refuses to take effect is worse than no setting.
   *
   * Embedded rather than given its own collection: it is exactly one small object per
   * account, always wanted alongside the account, and never large. A 24th model for
   * two booleans would be the sort of sprawl `DECISIONS.md` already warns about for
   * attempt-shaped collections.
   *
   * Optional on the interface, because accounts created before Milestone 14 have no
   * such field. `resolvePrefs()` treats a missing object as all-on, which matches
   * the behaviour those students already had.
   */
  notificationPrefs?: {
    announcements: boolean;
    results: boolean;
  };
}

/**
 * The registration details added in Milestone 4 are mandatory for every *new*
 * account, but must not be mandatory for an existing one: accounts created
 * before this change do not have them, and marking the fields plainly `required`
 * would make an ordinary administrative `save()` (suspending a legacy account,
 * changing its role) fail validation on data the admin never touched. Scoping
 * the requirement to `isNew` enforces it exactly where the data is actually
 * collected — the registration route, the only path that creates a Student.
 * See DATABASE_SCHEMA.md and the Milestone 4 ADR in DECISIONS.md.
 *
 * It is additionally scoped to `student`, because these are the details of an
 * *entrant* — a date of birth, a class, a school. The bootstrap super admin is
 * staff, has none of them, and is the only account created by anything other than
 * the registration route. Since that route can only ever produce a `student`, the
 * requirement still bites in exactly the place the data is collected.
 */
function requiredOnCreate(this: StudentDocument): boolean {
  return this.isNew && this.role === 'student';
}

const studentSchema = new Schema<StudentDocument>({
  fullName: String,
  firstName: { type: String, required: requiredOnCreate, trim: true },
  middleName: { type: String, default: null, trim: true },
  lastName: { type: String, required: requiredOnCreate, trim: true },
  fatherName: { type: String, required: requiredOnCreate, trim: true },
  motherName: { type: String, required: requiredOnCreate, trim: true },
  dateOfBirth: { type: Date, required: requiredOnCreate },
  classLevel: { type: String, enum: CLASS_LEVELS, required: requiredOnCreate },
  schoolName: { type: String, required: requiredOnCreate, trim: true },
  address: { type: String, required: requiredOnCreate, trim: true },
  // `required` is scoped like the registration details above, so the bootstrap
  // super admin (which has no mobile number) can be created. The index options are
  // deliberately untouched: `required` is application-level validation, so this
  // change cannot conflict with the `unique` index already built in production.
  // Only one account may ever lack a mobile, which a unique index permits.
  mobile: { type: String, required: requiredOnCreate, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  // Unique so the id generator can no longer silently collide; the registration
  // handler retries on a duplicate-key error. Two namespaces share this column:
  // `AMIT_xxxx` for entrants, `ADMIN_xxxx` for the bootstrap staff account — the
  // competitor numbering is not spent on people who never entered.
  studentId: { type: String, required: true, unique: true },
  isEmailVerified: { type: Boolean, default: false },
  status: { type: String, enum: ACCOUNT_STATUSES, default: 'active' },
  // Indexed because the admin student list filters by role, and because the
  // authorization freshness check reads it on every privileged request.
  // The enum is the full `ROLES`, not `ASSIGNABLE_ROLES`: the bootstrap super
  // admin is stored here, while remaining unassignable through the API.
  role: { type: String, enum: ROLES, default: 'student', index: true },
  roleUpdatedAt: { type: Date, default: null },
  roleUpdatedBy: { type: String, default: null },
  mustChangePassword: { type: Boolean, default: false },
  passwordResetAt: { type: Date, default: null },
  passwordResetBy: { type: String, default: null },
  tokenVersion: { type: Number, default: 0 },
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  registeredAt: { type: Date, default: Date.now },
  // No schema-level default for the object itself: a pre-Milestone-14 document
  // genuinely has no preferences, and inventing an empty one on read would make
  // "never chose" indistinguishable from "chose the defaults". `resolvePrefs()`
  // is the single place a missing object is interpreted.
  notificationPrefs: {
    announcements: { type: Boolean, default: true },
    results: { type: Boolean, default: true },
  },
});

/**
 * `fullName` is derived, never supplied. Keeping it in sync here rather than at
 * each call site means there is exactly one definition of how the three name
 * parts join, and the existing readers of `fullName` need no change.
 */
studentSchema.pre('validate', function () {
  if (this.firstName || this.lastName) {
    this.fullName = [this.firstName, this.middleName, this.lastName]
      .filter((part): part is string => Boolean(part && part.trim()))
      .map((part) => part.trim())
      .join(' ');
  }
});

/**
 * `passwordHash` is excluded from query results by default at the schema level so
 * it can never leak through a route that forgets to project it away. The login
 * handler opts back in explicitly with `.select('+passwordHash')`.
 */
studentSchema.path('passwordHash').select(false);

export const Student = mongoose.model<StudentDocument>('Student', studentSchema);
