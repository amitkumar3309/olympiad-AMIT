import { createHmac } from 'node:crypto';
import { Types } from 'mongoose';
import { config } from '../config';
import { now } from '../lib/clock';
import { buildContactNotificationEmail } from '../lib/email';
import { logger } from '../lib/logger';
import { ContactMessage, type ContactMessageDocument, type ContactStatus, type ContactTopic } from '../models';
import { enqueueEmail } from './emailOutbox';
import type { Actor } from './taxonomyService';

/**
 * The Contact page's form (owner, 2026-10-13: "make sure the contact form works").
 *
 * Every message is **stored first**, then announced to support by email — so a message is
 * never lost to a full email quota or a provider outage: staff read them all at
 * Admin → Messages. The notification email stops at `NOTIFY_DAILY_CAP` a day, because the
 * provider's free quota (300 a day) is shared with every sign-up, and a public form must not be
 * able to spend it.
 *
 * Nothing is sent to the visitor's address (see the model): a public form that mails whatever
 * address is typed into it is a way to send email in this platform's name.
 */

/** Notification emails to support per India day; beyond it messages are stored only. */
export const NOTIFY_DAILY_CAP = 40;

export const CONTACT_TOPIC_LABELS: Readonly<Record<ContactTopic, string>> = {
  account: 'My account or signing in',
  payment: 'A payment or receipt',
  'daily-quiz': 'The Daily Quiz or a prize',
  olympiad: 'The Olympiad itself',
  other: 'Something else',
};

function hashContactIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  return createHmac('sha256', config.jwtSecret).update(`contact-ip:v1:${ip}`).digest('hex').slice(0, 32);
}

/** Midnight at the start of today, India time, as an instant. */
function startOfIndiaDay(at: Date): Date {
  const IST_OFFSET_MS = 330 * 60 * 1000;
  const local = new Date(at.getTime() + IST_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - IST_OFFSET_MS);
}

export interface NewContactMessage {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
  student: Types.ObjectId | null;
  ip: string | null | undefined;
}

export async function receiveContactMessage(input: NewContactMessage): Promise<ContactMessageDocument> {
  const at = now();
  const doc = await ContactMessage.create({
    name: input.name,
    email: input.email,
    topic: input.topic,
    message: input.message,
    student: input.student,
    ipHash: hashContactIp(input.ip),
  });

  const sentToday = await ContactMessage.countDocuments({ emailed: true, createdAt: { $gte: startOfIndiaDay(at) } });
  if (sentToday >= NOTIFY_DAILY_CAP) {
    logger.warn({ cap: NOTIFY_DAILY_CAP }, 'Contact notification cap reached; the message is stored only');
    return doc;
  }

  const queued = await enqueueEmail({
    ...buildContactNotificationEmail({
      to: config.support.email,
      name: input.name,
      email: input.email,
      topic: CONTACT_TOPIC_LABELS[input.topic],
      message: input.message,
    }),
    // Second in line, after account mail: a verification link must never wait behind it.
    category: 'announcement',
  });
  if (queued.queued) {
    doc.emailed = true;
    await doc.save();
  }
  return doc;
}

export interface ContactMessageView {
  id: string;
  name: string;
  email: string;
  topic: ContactTopic;
  topicLabel: string;
  message: string;
  status: ContactStatus;
  emailed: boolean;
  fromAccount: boolean;
  handledByLabel: string | null;
  handledAt: string | null;
  createdAt: string;
}

export function contactMessageView(doc: ContactMessageDocument): ContactMessageView {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    topic: doc.topic,
    topicLabel: CONTACT_TOPIC_LABELS[doc.topic],
    message: doc.message,
    status: doc.status,
    emailed: doc.emailed,
    fromAccount: Boolean(doc.student),
    handledByLabel: doc.handledByLabel ?? null,
    handledAt: doc.handledAt ? doc.handledAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listContactMessages(options: { status: ContactStatus | 'all'; page: number; limit: number }) {
  const filter = options.status === 'all' ? {} : { status: options.status };
  const [docs, total, unhandled] = await Promise.all([
    ContactMessage.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit),
    ContactMessage.countDocuments(filter),
    ContactMessage.countDocuments({ status: 'new' }),
  ]);
  return { messages: docs.map(contactMessageView), total, unhandled };
}

/** Marks a message handled (or back to new). Null when there is no such message. */
export async function setContactStatus(id: string, status: ContactStatus, actor: Actor): Promise<ContactMessageView | null> {
  const doc = await ContactMessage.findByIdAndUpdate(
    id,
    status === 'handled'
      ? { $set: { status, handledBy: actor.id, handledByLabel: actor.label, handledAt: now() } }
      : { $set: { status, handledBy: null, handledByLabel: null, handledAt: null } },
    { new: true },
  );
  return doc ? contactMessageView(doc) : null;
}
