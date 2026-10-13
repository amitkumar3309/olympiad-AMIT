import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { attachUserIfPresent, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { adminActionLimiter, contactLimiter } from '../../middleware/rateLimiter';
import { sendError, sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { listContactMessages, receiveContactMessage, setContactStatus } from '../../services/contactService';
import { actorFrom } from '../../services/taxonomyService';
import {
  contactIdParamSchema,
  contactListQuerySchema,
  contactMessageSchema,
  contactStatusSchema,
  type ContactListQuery,
  type ContactMessageBody,
} from '../../validation/contactSchemas';

/**
 * The Contact page's form and its staff inbox (2026-10-13). See `services/contactService.ts`.
 */
const router = Router();

const THANKS = 'Thank you — your message has reached us. We reply by email, usually within two working days.';

router.post(
  '/contact',
  contactLimiter,
  validate({ body: contactMessageSchema }),
  attachUserIfPresent,
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const body = req.body as ContactMessageBody;
      // The honeypot: a person never sees the field, so a value means a bot. It gets the same
      // answer as anybody, so it learns nothing, and nothing is stored or sent.
      if (body.website.trim() !== '') {
        sendSuccess(res, 201, { message: THANKS });
        return;
      }
      const sub = req.user?.sub;
      await receiveContactMessage({
        name: body.name,
        email: body.email,
        topic: body.topic,
        message: body.message,
        student: sub && Types.ObjectId.isValid(sub) ? new Types.ObjectId(sub) : null,
        ip: req.ip,
      });
      sendSuccess(res, 201, { message: THANKS });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to store a contact message',
        fallback: 'Your message could not be sent just now. Please try again, or email us directly.',
      });
    }
  },
);

router.get(
  '/admin/contact-messages',
  requirePermission('students:read'),
  validate({ query: contactListQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const query = req.query as unknown as ContactListQuery;
      const { messages, total, unhandled } = await listContactMessages(query);
      sendSuccess(res, 200, {
        messages,
        unhandled,
        pagination: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
      });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to list contact messages', fallback: 'Could not load the messages. Please try again.' });
    }
  },
);

router.patch(
  '/admin/contact-messages/:id',
  adminActionLimiter,
  requirePermission('students:read'),
  validate({ params: contactIdParamSchema, body: contactStatusSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { status } = req.body as { status: 'new' | 'handled' };
      const message = await setContactStatus(String(req.params.id), status, actorFrom(req));
      if (!message) {
        sendError(res, 404, 'That message no longer exists.');
        return;
      }
      sendSuccess(res, 200, { message });
    } catch (err) {
      respondToServiceError(res, err, { log: 'Failed to update a contact message', fallback: 'Could not update the message. Please try again.' });
    }
  },
);

export default router;
