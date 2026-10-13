import { z } from 'zod';
import { CONTACT_STATUSES, CONTACT_TOPICS } from '../models/ContactMessage';

/**
 * The Contact page's form (2026-10-13).
 *
 * `website` is a **honeypot**: the field is hidden from people (off screen, out of the tab
 * order, `autocomplete="off"`), so only a form-filling bot fills it. It is accepted here so the
 * bot gets an ordinary answer; the route then stores nothing (`isBot`).
 */
export const contactMessageSchema = z.object({
  name: z.string().trim().min(2, 'Tell us your name.').max(80, 'Keep your name under 80 characters.'),
  email: z.string().trim().toLowerCase().email('Enter an email address we can reply to.').max(254),
  topic: z.enum(CONTACT_TOPICS, { message: 'Choose what your message is about.' }),
  message: z
    .string()
    .trim()
    .min(10, 'Write a little more, so we can help — at least 10 characters.')
    .max(2000, 'Keep your message under 2,000 characters.'),
  website: z.string().max(200).optional().default(''),
});
export type ContactMessageBody = z.infer<typeof contactMessageSchema>;

export const contactListQuerySchema = z.object({
  status: z.enum([...CONTACT_STATUSES, 'all'] as const).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

export const contactIdParamSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/i, 'That message id is not valid.'),
});

export const contactStatusSchema = z.object({ status: z.enum(CONTACT_STATUSES) });
