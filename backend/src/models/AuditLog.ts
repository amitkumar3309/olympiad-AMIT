import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { ROLES, type Role } from '../lib/permissions';

/**
 * Every administrative action worth answering "who did this, and when?" about.
 * Kept as a closed list so the audit trail stays queryable — a free-text action
 * string would drift into unsearchable variants.
 */
export const AUDIT_ACTIONS = [
  /** A super admin granted or revoked the admin role. */
  'user.role.changed',
  /** An admin suspended, deactivated or reactivated an account. */
  'student.status.changed',
  /**
   * A student edited their own profile details. Recorded for the same reason an
   * administrator's edit would be: this is a change to an account, and the trail
   * has to be able to answer "who changed this school name, and when?" even when
   * the answer is "the student did". Milestone 5.
   */
  'student.profile.updated',
  /** A student replaced their own profile photo. */
  'student.photo.updated',
  /**
   * A student changed their own password from account settings. The password itself
   * is of course never recorded — only that the change happened, because an
   * unexpected one is what a compromised account looks like.
   */
  'student.password.changed',
  /** Questions were written to the bank in bulk by the generator route. */
  'questions.generated',
  /** A single question was authored. */
  'question.created',
  /** A question's content was edited (its revision was bumped). */
  'question.updated',
  /** A question moved through the editorial workflow (draft/review/published/archived). */
  'question.status.changed',
  /** A never-published question was hard-deleted. */
  'question.deleted',
  /** A mock test was authored. */
  'mocktest.created',
  /** A mock test's content, timing or disclosure settings were edited. */
  'mocktest.updated',
  /**
   * A mock test was published, unpublished or archived. Recorded separately from an
   * edit because publishing is the moment a paper becomes sittable, and unpublishing
   * one that students are part-way through is the kind of act that needs a name
   * against it.
   */
  'mocktest.status.changed',
  /** A mock test that had never been published was hard-deleted. */
  'mocktest.deleted',
  /** A subject was created or edited. */
  'subject.changed',
  /** A topic or subtopic was created or edited. */
  'topic.changed',
  /** An account holding an elevated role signed in. */
  'admin.session.started',
  /**
   * An authenticated user was refused a privileged permission. Recorded because a
   * burst of these is the signature of a privilege-escalation attempt.
   */
  'authz.denied',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGET_TYPES = ['student', 'question', 'mocktest', 'subject', 'topic', 'route', 'system'] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditLogDocument extends Document {
  action: AuditAction;
  /** Role the actor held at the time — not looked up later, so history stays true. */
  actorRole: Role;
  /** Mongo `_id` of the acting account; null for the env-configured root admin. */
  actor?: Types.ObjectId | null;
  /** Human-readable actor (email or `AMIT_xxxx`), denormalised so the log reads standalone. */
  actorLabel: string;
  targetType: AuditTargetType;
  /** Human-facing identifier of the target (`AMIT_xxxx`, a route path, ...). */
  targetId?: string | null;
  targetLabel?: string | null;
  outcome: 'success' | 'denied';
  /** Action-specific detail, e.g. `{ from: 'student', to: 'admin' }`. */
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDocument>({
  action: { type: String, enum: AUDIT_ACTIONS, required: true },
  actorRole: { type: String, enum: ROLES, required: true },
  actor: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  actorLabel: { type: String, required: true },
  targetType: { type: String, enum: AUDIT_TARGET_TYPES, required: true },
  targetId: { type: String, default: null },
  targetLabel: { type: String, default: null },
  outcome: { type: String, enum: ['success', 'denied'], default: 'success' },
  metadata: { type: Schema.Types.Mixed, default: undefined },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

// Newest-first is the only listing order the admin UI offers, and the secondary
// indexes back the action / actor filters on that same listing.
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

/**
 * Deliberately **no TTL index**, unlike `RefreshToken` and `VerificationToken`:
 * an audit trail that silently deletes itself is not an audit trail. If retention
 * ever needs a bound, that is a policy decision for DECISIONS.md.
 */
export const AuditLog = mongoose.model<AuditLogDocument>('AuditLog', auditLogSchema);
