import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * Why a message is being sent — and, for three of the five, whether the student
 * may switch it off.
 *
 *  - `transactional` — the mechanism of using the account: email verification and
 *    password reset. Not a notification *about* anything; without it the account
 *    cannot be used at all.
 *  - `security` — a password change, a suspension, a role change. Always sent,
 *    because "you may turn off the warning that your password was changed" is a
 *    setting that only ever helps an attacker.
 *  - `announcement` and `results` — genuine notifications, each switchable per
 *    student.
 *
 * There are deliberately only **two** switchable categories, because those are the
 * only two optional email streams that actually exist. A `certificates` category was
 * considered and dropped: a certificate can only be issued by releasing an exam's
 * results, so it always arrives in the same breath as the result and is folded into
 * that one message. A preference controlling a stream nothing sends would be a
 * setting that does nothing, which is worse than a shorter list.
 *
 * The split is the whole preference model. See `emailAllowedFor()` in
 * `services/notificationService.ts`, which is the only place it is interpreted.
 */
export const EMAIL_CATEGORIES = ['transactional', 'security', 'announcement', 'results'] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** `pending` covers "never tried" and "tried, failed, due again" — see below. */
export const EMAIL_STATUSES = ['pending', 'sent', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/**
 * One outbound email, persisted **before** anything tries to send it.
 *
 * ## Why this collection exists
 *
 * Before Milestone 14, `sendEmail()` was awaited inline in registration and in
 * forgot-password, and it swallowed delivery failures. Two consequences, both real:
 * a student's registration request sat waiting on a third-party SMTP handshake, and
 * when that handshake failed the verification link was **lost** — no record, no
 * retry, nothing to look at afterwards except one log line. Since login requires
 * verification, a lost link is an account that cannot be used.
 *
 * Persisting the intent first inverts both problems. The request does one indexed
 * insert and returns; delivery happens outside it and may be retried, because the
 * row is still there to retry from.
 *
 * ## Why there is no `sending` status
 *
 * A row is claimed by pushing `nextAttemptAt` into the future and incrementing
 * `attempts` in the same conditional write — a visibility timeout, not a state
 * change. A separate `sending` state would be a lie the moment a serverless
 * container is frozen or recycled mid-send: the row would sit in `sending` for ever
 * with nothing to move it, and the message would never arrive. With a timeout, a
 * crashed attempt simply becomes due again.
 *
 * The honest consequence is **at-least-once** delivery: if a container dies after
 * the provider accepted the message but before the row was marked `sent`, the
 * message is sent twice. That is the right trade — a duplicate "your results are
 * out" is a mild annoyance, a missing one is a student who never found out — and no
 * amount of local bookkeeping can close it without provider-side idempotency.
 */
export interface EmailOutboxDocument extends Document {
  to: string;
  subject: string;
  text: string;
  html: string;
  category: EmailCategory;
  /** Who it is about, when that is known. Null for a message to a bare address. */
  student?: Types.ObjectId | null;
  status: EmailStatus;
  attempts: number;
  maxAttempts: number;
  /** When this row may next be claimed. Also the visibility timeout while in flight. */
  nextAttemptAt: Date;
  lastAttemptAt?: Date | null;
  /** The provider's own message, kept for the admin delivery view. */
  lastError?: string | null;
  sentAt?: Date | null;
  /**
   * Application-level idempotency, e.g. `results:<examId>:<studentId>`.
   *
   * Partial-unique, so releasing the same exam's results twice cannot email the
   * cohort twice — the second enqueue loses on the index rather than being
   * prevented by a check that a concurrent invocation could have raced.
   */
  dedupeKey?: string | null;
  createdAt: Date;
}

const emailOutboxSchema = new Schema<EmailOutboxDocument>({
  to: { type: String, required: true, trim: true },
  subject: { type: String, required: true },
  text: { type: String, required: true },
  html: { type: String, required: true },
  category: { type: String, enum: EMAIL_CATEGORIES, required: true },
  student: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  status: { type: String, enum: EMAIL_STATUSES, default: 'pending', index: true },
  attempts: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 4, min: 1 },
  nextAttemptAt: { type: Date, default: Date.now },
  lastAttemptAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  sentAt: { type: Date, default: null },
  dedupeKey: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

/** The drain's only query: what is pending and due, oldest deadline first. */
emailOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

/**
 * Partial, so the many rows with no natural idempotency key (a verification email
 * genuinely may be requested again) do not all collide on `null` — which a plain
 * unique index would make them do.
 */
emailOutboxSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

/** The admin delivery view: newest first, filtered by status. */
emailOutboxSchema.index({ createdAt: -1 });

/**
 * Deliberately **no TTL**, like `AuditLog`. A delivery record is the evidence for
 * "we did tell them", and for a competition that issues certificates and refuses
 * late submissions, that evidence is worth more than the bytes it costs. Rows are
 * small (a few KB) and bounded by real events rather than by traffic.
 */
export const EmailOutbox = mongoose.model<EmailOutboxDocument>('EmailOutbox', emailOutboxSchema);
