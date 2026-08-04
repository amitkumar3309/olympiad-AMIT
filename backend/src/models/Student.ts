import mongoose, { Schema, type Document } from 'mongoose';
import { ASSIGNABLE_ROLES, type AssignableRole } from '../lib/permissions';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';

export type AccountStatus = 'active' | 'suspended' | 'deactivated';

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
   * super admin promotes one to `admin` (see routes/v1/users.routes.ts). Only the
   * environment-configured root account holds `superadmin`, and it has no document
   * here at all — so `superadmin` is deliberately not an assignable value.
   */
  role: AssignableRole;
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
 */
function requiredOnCreate(this: StudentDocument): boolean {
  return this.isNew;
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
  mobile: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  // Unique so the AMIT_xxxx generator can no longer silently collide; the
  // registration handler retries on a duplicate-key error.
  studentId: { type: String, required: true, unique: true },
  isEmailVerified: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'suspended', 'deactivated'], default: 'active' },
  // Indexed because the admin student list filters by role, and because the
  // authorization freshness check reads it on every privileged request.
  role: { type: String, enum: ASSIGNABLE_ROLES, default: 'student', index: true },
  roleUpdatedAt: { type: Date, default: null },
  roleUpdatedBy: { type: String, default: null },
  tokenVersion: { type: Number, default: 0 },
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  registeredAt: { type: Date, default: Date.now },
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
