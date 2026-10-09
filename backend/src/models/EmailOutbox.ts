import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * Why a message is being sent — and, for three of the five, whether the student may
 * switch it off.
 *
 *  - `transactional` — the mechanism of using the account: email verification and
 *    password reset. Not a notification *about* anything; without it the account
 *    cannot be used at all.
 *  - `security` — a password change, a suspension, a role change. Always sent,
 *    because "you may turn off the warning that your password was changed" is a
 *    setting that only ever helps an attacker.
 *  - `announcement` and `results` — genuine notifications, each switchable per
 *    student, and on unless the student turns them off.
 *  - `reminders` — the Daily Quiz reminder at 7:00 AM (Milestone 30 Phase 7b, PLAN.md
 *    Q20). Switchable like the two above, but **off unless the student turns it on**:
 *    a daily email nobody asked for is the fastest way to teach a mail provider that
 *    this platform sends spam, and the provider's reputation is what every
 *    verification link depends on.
 *
 * There are deliberately only **three** switchable categories, because those are the
 * only optional email streams that actually exist. A `certificates` category was
 * considered and dropped: a certificate can only be issued by releasing an exam's
 * results, so it always arrives in the same breath as the result and is folded into
 * that one message. A preference controlling a stream nothing sends would be a
 * setting that does nothing, which is worse than a shorter list.
 *
 * The split is the whole preference model. See `emailAllowedFor()` in
 * `services/notificationService.ts`, which is the only place it is interpreted.
 */
export const EMAIL_CATEGORIES = ['transactional', 'security', 'announcement', 'results', 'reminders'] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/**
 * The order the drain sends in — **lower first** (Milestone 30 Phase 7b).
 *
 * A verification link must never wait behind a hundred reminders. The reminder job queues
 * its whole batch at once, at 07:00, and a student who registers at 07:01 would otherwise
 * find their link at the back of that queue, unable to sign in until it cleared — and
 * every message sent before theirs also spends the provider's free daily quota (Brevo's is
 * 300, shared by everything this platform sends). So the account's own mail goes first, then
 * the news a student asked for, then the reminders.
 *
 * Stored on the row (set from the category by `enqueueEmail()`) rather than derived in the
 * query, so the drain's claim is one indexed sort. A `Record` over every category, so a
 * sixth category cannot be added without deciding where it queues.
 */
export const EMAIL_PRIORITY: Readonly<Record<EmailCategory, number>> = {
  transactional: 0,
  security: 0,
  announcement: 1,
  results: 1,
  reminders: 2,
};

/**
 * How many days a category's rows are kept after they are queued — absent means for ever,
 * which is the rule (see the note at the end of this file). Only reminders expire: a
 * reminder for a quiz that closed a fortnight ago is evidence of nothing anybody will ask
 * about, and a hundred a day for a year would be a real part of the free database.
 */
export const EMAIL_RETENTION_DAYS: Readonly<Partial<Record<EmailCategory, number>>> = {
  reminders: 14,
};

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
   * The two halves of a delivery's latency, recorded on the attempt that succeeded.
   *
   * `providerMs` is wall-clock time inside the provider request. `queuedForMs` is
   * `sentAt - createdAt` — everything else, which is ours: the wait to be claimed.
   *
   * Stored rather than derived because they answer different questions and a single
   * figure conflates them. "The verification email took four minutes" has two very
   * different causes, and before Milestone 25 neither could be distinguished without
   * reading a server log — so the answer was always a guess. Null on a row that has
   * never been delivered, which is why `queuedForMs` is not simply computed from
   * `createdAt` on read: a *pending* row has no elapsed delivery time, it has an age.
   */
  providerMs?: number | null;
  queuedForMs?: number | null;
  /** Lower is sent first — `EMAIL_PRIORITY[category]`, written by `enqueueEmail()`. */
  priority: number;
  /**
   * When the TTL index removes this row. Set **only** on a category with a retention in
   * `EMAIL_RETENTION_DAYS` (reminders: 14 days after queueing); every other row has no such
   * field and is kept for ever.
   */
  expiresAt?: Date;
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
  providerMs: { type: Number, default: null, min: 0 },
  queuedForMs: { type: Number, default: null, min: 0 },
  // Required rather than defaulted: `enqueueEmail()` is the only writer and always sets it,
  // and a row from anywhere else should fail loudly rather than queue at a guessed priority.
  // A row queued before Milestone 30 Phase 7b has none; MongoDB sorts a missing field
  // before every number, so such a row is simply sent first — never stranded.
  priority: { type: Number, required: true, min: 0 },
  // Deliberately no default: a field that is absent is what keeps a row out of the TTL.
  expiresAt: { type: Date },
  dedupeKey: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

/**
 * The drain's only query: what is pending and due — the most important first, then the
 * oldest deadline (Milestone 30 Phase 7b; it was `{status, nextAttemptAt}` before reminders
 * gave the queue something that must wait its turn). Equality, then the sort, then the
 * range, so the claim is served from the index. A database that built the old index keeps
 * it until it is dropped; it is harmless, and nothing reads it.
 */
emailOutboxSchema.index({ status: 1, priority: 1, nextAttemptAt: 1 });

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
 * **No TTL for anything that matters**, like `AuditLog`. A delivery record is the evidence
 * for "we did tell them", and for a competition that issues certificates and refuses late
 * submissions, that evidence is worth more than the bytes it costs. Rows are small (a few
 * KB) and bounded by real events rather than by traffic.
 *
 * **The one exception is reminders** (Milestone 30 Phase 7b): a reminder row carries an
 * `expiresAt` 14 days after it was queued, and this index removes it then. It is partial in
 * effect — MongoDB's TTL monitor only deletes a document whose indexed field holds a date,
 * and no other category is given one — so every other row keeps the rule above. A reminder
 * is bounded by the calendar rather than by events (up to the daily cap, every day), which
 * is exactly the growth this rule exists to refuse in a free database.
 */
emailOutboxSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailOutbox = mongoose.model<EmailOutboxDocument>('EmailOutbox', emailOutboxSchema);
