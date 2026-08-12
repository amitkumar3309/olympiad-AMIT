import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { sendSuccess } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { todayKey } from '../../lib/competitionDay';
import { actorFrom } from '../../services/taxonomyService';
import {
  adminChallengeView,
  attemptStatsFor,
  deleteChallenge,
  findChallengeById,
  listChallenges,
  loadChallengeQuestions,
  rescheduleChallenge,
  scheduleChallenge,
  upcomingDays,
} from '../../services/dailyChallengeService';
import {
  challengeIdParamSchema,
  listChallengesQuerySchema,
  rescheduleChallengeSchema,
  scheduleChallengeSchema,
  type ListChallengesQuery,
  type RescheduleChallengeBody,
  type ScheduleChallengeBody,
} from '../../validation/dailyChallengeSchemas';

/**
 * Scheduling the daily challenge (Milestone 8).
 *
 * Gated on `challenges:write`, which is elevated — so every request re-reads the
 * caller's role from the database and a demoted administrator loses access at once
 * rather than at token expiry.
 *
 * ## Scheduled, or automatic
 *
 * Staff do not have to schedule anything: a day nobody has scheduled is pinned
 * automatically the first time a student asks for it, deterministically, and appears
 * here afterwards marked `source: 'automatic'`. This endpoint set exists so a
 * competition *can* curate the run-up to an exam — not so that somebody has to
 * remember to, every day, forever.
 *
 * The rules about what may be scheduled, and when a scheduled day may still be changed,
 * live in `services/dailyChallengeService.ts`. This file does HTTP.
 */
const router = Router();

/** How many days ahead the scheduling strip offers. Two working weeks is plenty. */
const UPCOMING_DAYS = 14;

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * Scheduled and already-served challenges, newest day first, with how each landed.
 *
 * `attempts` / `correct` / `correctPercent` come from one aggregation over the whole
 * page rather than two queries per row. `correctPercent` is of the students who
 * *answered*, and `null` when nobody did — "nobody tried" and "everybody got it wrong"
 * must not render as the same thing.
 */
router.get(
  '/admin/daily-challenges',
  requirePermission('challenges:write'),
  validate({ query: listChallengesQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const query = req.query as unknown as ListChallengesQuery;
      const { challenges, total } = await listChallenges(query);
      const [questions, stats] = await Promise.all([
        loadChallengeQuestions(challenges),
        attemptStatsFor(challenges.map((challenge) => challenge._id as Types.ObjectId)),
      ]);

      sendSuccess(res, 200, {
        challenges: challenges.map((challenge) =>
          adminChallengeView(
            challenge,
            questions.get(String(challenge.question)) ?? null,
            stats.get(String(challenge._id)),
          ),
        ),
        // The day strip the scheduling UI offers. Computed here because an IST day is
        // this backend's decision — a browser in another timezone would disagree about
        // which day is today, and schedule against the wrong one.
        today: todayKey(),
        upcoming: upcomingDays(UPCOMING_DAYS),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to list daily challenges',
        fallback: 'Could not load the daily challenges. Please try again.',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

router.post(
  '/admin/daily-challenges',
  requirePermission('challenges:write'),
  validate({ body: scheduleChallengeSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const body = req.body as ScheduleChallengeBody;
      const challenge = await scheduleChallenge(
        { day: body.day, classLevel: body.classLevel, questionId: body.questionId },
        actorFrom(req),
      );

      await recordAudit(req, {
        action: 'dailychallenge.scheduled',
        targetType: 'dailychallenge',
        targetId: String(challenge._id),
        targetLabel: `${challenge.classLevel} · ${challenge.day}`,
        metadata: { day: challenge.day, classLevel: challenge.classLevel, question: String(challenge.question) },
      });

      const questions = await loadChallengeQuestions([challenge]);
      sendSuccess(res, 201, {
        challenge: adminChallengeView(challenge, questions.get(String(challenge.question)) ?? null),
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to schedule a daily challenge',
        fallback: 'Could not schedule that challenge. Please try again.',
      });
    }
  },
);

router.put(
  '/admin/daily-challenges/:id',
  requirePermission('challenges:write'),
  validate({ params: challengeIdParamSchema, body: rescheduleChallengeSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as unknown as { id: string };
      const { questionId } = req.body as RescheduleChallengeBody;
      const challenge = await rescheduleChallenge(id, questionId, actorFrom(req));

      await recordAudit(req, {
        action: 'dailychallenge.updated',
        targetType: 'dailychallenge',
        targetId: String(challenge._id),
        targetLabel: `${challenge.classLevel} · ${challenge.day}`,
        metadata: { day: challenge.day, question: String(challenge.question) },
      });

      const questions = await loadChallengeQuestions([challenge]);
      sendSuccess(res, 200, {
        challenge: adminChallengeView(challenge, questions.get(String(challenge.question)) ?? null),
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to change a daily challenge',
        fallback: 'Could not change that challenge. Please try again.',
      });
    }
  },
);

router.delete(
  '/admin/daily-challenges/:id',
  requirePermission('challenges:write'),
  validate({ params: challengeIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      // Read first so the audit entry can name the day that was cleared; afterwards
      // there is nothing left to read.
      const { id } = req.params as unknown as { id: string };
      const existing = await findChallengeById(id);
      const label = `${existing.classLevel} · ${existing.day}`;

      await deleteChallenge(id);

      await recordAudit(req, {
        action: 'dailychallenge.deleted',
        targetType: 'dailychallenge',
        targetId: id,
        targetLabel: label,
        metadata: { day: existing.day, classLevel: existing.classLevel },
      });

      sendSuccess(res, 200, { deleted: true });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to delete a daily challenge',
        fallback: 'Could not remove that challenge. Please try again.',
      });
    }
  },
);

export default router;
