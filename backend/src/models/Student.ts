import mongoose, { Schema, type Document } from 'mongoose';
import { ASSIGNABLE_ROLES, type AssignableRole } from '../lib/permissions';

export type AccountStatus = 'active' | 'suspended' | 'deactivated';

export interface StudentDocument extends Document {
  fullName?: string;
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

const studentSchema = new Schema<StudentDocument>({
  fullName: String,
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
 * `passwordHash` is excluded from query results by default at the schema level so
 * it can never leak through a route that forgets to project it away. The login
 * handler opts back in explicitly with `.select('+passwordHash')`.
 */
studentSchema.path('passwordHash').select(false);

export const Student = mongoose.model<StudentDocument>('Student', studentSchema);
