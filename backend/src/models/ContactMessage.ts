import mongoose, { Schema, type Document, type Types } from 'mongoose';

export const CONTACT_TOPICS = ['account', 'payment', 'daily-quiz', 'olympiad', 'other'] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const CONTACT_STATUSES = ['new', 'handled'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/**
 * A message sent through the Contact page's form (owner, 2026-10-13).
 *
 * Kept as a record so nothing depends on an email arriving: staff read every message at
 * Admin → Messages whether or not the notification email was sent (`emailed` says which —
 * the provider's free quota is shared with sign-ups, so notifications stop at a daily cap).
 *
 * **Nothing is ever emailed to the address a visitor typed.** The form is public, and a
 * confirmation sent to any address would let a stranger use the site to mail anybody. Staff
 * reply from their own mailbox.
 *
 * `ipHash` is a SHA-256 of the address and a secret, never the address itself: enough to see
 * that one sender is flooding the form, nothing more. No TTL: a parent's question and its
 * handling are a record; a retention period is a question for the legal review.
 */
export interface ContactMessageDocument extends Document {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
  /** The signed-in account that sent it, if any — for staff to find the account. */
  student?: Types.ObjectId | null;
  status: ContactStatus;
  /** Whether a notification email to support was queued for this message. */
  emailed: boolean;
  ipHash?: string | null;
  handledBy?: Types.ObjectId | null;
  handledByLabel?: string | null;
  handledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const contactMessageSchema = new Schema<ContactMessageDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    topic: { type: String, enum: CONTACT_TOPICS, required: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    student: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    status: { type: String, enum: CONTACT_STATUSES, default: 'new' },
    emailed: { type: Boolean, default: false },
    ipHash: { type: String, default: null },
    handledBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    handledByLabel: { type: String, default: null },
    handledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The admin list: newest first, filtered by status.
contactMessageSchema.index({ status: 1, createdAt: -1 });
// The daily cap on notification emails counts today's.
contactMessageSchema.index({ emailed: 1, createdAt: -1 });

export const ContactMessage = mongoose.model<ContactMessageDocument>('ContactMessage', contactMessageSchema);
