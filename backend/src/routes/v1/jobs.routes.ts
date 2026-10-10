import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from '../../config';
import { ensureDb } from '../../middleware/ensureDb';
import { sendError, sendSuccess } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { drainOutbox } from '../../services/emailOutbox';
import { queueDailyQuizReminders } from '../../services/dailyQuizReminders';
import { ensureTodaysQuizzes } from '../../services/dailyQuizAuto';

/**
 * The scheduled jobs (Milestone 30 Phase 7b, PLAN.md Q20) — called by an outside scheduler,
 * never by a person or a browser:
 *
 *  - `POST /jobs/daily-quiz-reminders` — once a day at 07:00 Asia/Kolkata: queues the day's
 *    Daily Quiz reminders (`services/dailyQuizReminders.ts`) and answers with the counts.
 *  - `POST /jobs/outbox` — every minute: sends what is waiting in the email queue
 *    (`drainOutbox()`), which is also what closes known bug #41 — mail no longer waits for
 *    the next visitor on an idle site.
 *
 * ## Why a bearer secret, and why from outside
 *
 * The free Vercel plan's cron is accurate only to the hour and the paid one costs money, so
 * the owner chose a free external pinger (cron-job.org; PROJECT_STATE.md, "Daily-challenge
 * automation"). These routes are therefore on the public internet, and `JOBS_SECRET` is what
 * stands in front of them: the scheduler sends `Authorization: Bearer <secret>`. Unset, both
 * answer **503 naming the variable** — a deployment that never configured the scheduler is
 * not broken, it is unconfigured, and the response says what to set.
 *
 * ## Why the comparison is constant-time
 *
 * A comparison that stops at the first wrong character answers a little faster the more of
 * the secret a guess gets right, and over enough requests that difference is measurable.
 * `timingSafeEqual` takes the same time whatever the input, and it is given the SHA-256 of
 * each side rather than the strings, so the two are always the same length (it throws
 * otherwise) and the length of the real secret is not revealed either.
 *
 * Gated before `ensureDb`, so a wrong secret costs one hash and no database work. The routes
 * stay behind the general rate limiter, and the CSRF check passes them because a scheduler
 * sends no `Origin` — a browser cannot reach them with the header anyway, since the secret is
 * never in any page.
 */
const router = Router();

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** The token after `Bearer `, or null. The scheme is case-insensitive (RFC 9110). */
function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

export function requireJobSecret(req: Request, res: Response, next: NextFunction): void {
  // Never cached: a job's answer is about this moment, and a 401 must not be replayed.
  res.set('Cache-Control', 'no-store');

  const secret = config.jobs.secret;
  if (!secret) {
    sendError(
      res,
      503,
      'Scheduled jobs are not set up on this server. Set JOBS_SECRET in the backend environment and redeploy (see ENVIRONMENT_VARIABLES.md).',
    );
    return;
  }

  const presented = bearerToken(req.get('authorization'));
  if (presented === null || !timingSafeEqual(digest(presented), digest(secret))) {
    // The presented value is never logged — `lib/logger.ts` redacts the header too.
    logger.warn({ path: req.originalUrl, ip: req.ip }, 'Refused a scheduled-job request without the right secret');
    res.set('WWW-Authenticate', 'Bearer realm="jobs"');
    sendError(res, 401, 'This job needs the scheduler’s secret, sent as "Authorization: Bearer <JOBS_SECRET>".');
    return;
  }

  next();
}

router.post('/jobs/daily-quiz-reminders', requireJobSecret, ensureDb, async (_req: Request, res: Response) => {
  try {
    const run = await queueDailyQuizReminders();
    sendSuccess(res, 200, { run });
  } catch (err) {
    logger.error({ err }, 'The Daily Quiz reminder job failed');
    sendError(res, 500, 'Could not queue today’s reminders. Nothing was sent twice; calling again is safe.');
  }
});

/**
 * Fills today's automatic Daily Quizzes (2026-10-10) — every class without one. Optional: the
 * first visit of the day does the same, so this only makes the quizzes exist at midnight rather
 * than at the first request. Safe to call any number of times; a filled class is left alone.
 */
router.post('/jobs/daily-quiz-schedule', requireJobSecret, ensureDb, async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, 200, { classes: await ensureTodaysQuizzes() });
  } catch (err) {
    logger.error({ err }, 'The automatic Daily Quiz job failed');
    sendError(res, 500, 'Could not fill today’s quizzes. Calling again is safe.');
  }
});

router.post('/jobs/outbox', requireJobSecret, ensureDb, async (_req: Request, res: Response) => {
  try {
    const drain = await drainOutbox();
    if (drain.claimed > 0) logger.info({ ...drain, driver: 'job' }, 'Outbox drained by the scheduler');
    sendSuccess(res, 200, { drain });
  } catch (err) {
    logger.error({ err }, 'The scheduled outbox drain failed');
    sendError(res, 500, 'Could not send the queued email. It is still queued; the next call will try again.');
  }
});

export default router;
