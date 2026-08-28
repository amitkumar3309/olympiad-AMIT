import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { adminActionLimiter } from '../../middleware/rateLimiter';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { respondToServiceError } from '../../lib/serviceError';
import { recordAudit } from '../../lib/audit';
import { CONFIRM_PHRASES, performReset, previewReset, scopeLabel } from '../../services/contentResetService';
import {
  resetScopeParamSchema,
  resetConfirmSchema,
  type ResetScopeParam,
  type ResetConfirmInput,
} from '../../validation/resetSchemas';

/**
 * The content reset (Milestone 22) — one endpoint per administrative area that empties it.
 *
 * Everything about how this behaves lives in `services/contentResetService.ts`; the two
 * routes here are the gate. Four things guard them, and each one is doing a different job:
 *
 * - **`content:reset`** — super admin only. The authorization. Nothing else here is.
 * - **`adminActionLimiter`** — this is the most expensive write in the product, and its
 *   damage scales with repetition, which is the same argument that put the limiter in
 *   front of the staff password reset.
 * - **A typed confirmation phrase** — a guard against the wrong click and the wrong scope,
 *   not against an attacker. It is checked here rather than in the service so the service
 *   stays callable from a script that has its own confirmation.
 * - **A blocker re-check inside the service** — because the dialog the administrator
 *   confirmed may be minutes old.
 */
const router = Router();

/**
 * What a reset would destroy, counted from the collections.
 *
 * A GET, and it writes nothing — so it is safe for the page to load on arrival, which is
 * the point: an administrator should be able to see that the question bank holds 3,201
 * questions *before* deciding, rather than being told after.
 */
router.get(
  '/admin/reset/:scope/preview',
  requirePermission('content:reset'),
  validate({ params: resetScopeParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { scope } = req.params as unknown as ResetScopeParam;
      sendSuccess(res, 200, { preview: await previewReset(scope) });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to preview a content reset',
        fallback: 'Could not work out what that reset would delete.',
      });
    }
  },
);

/**
 * Empties one area. **Irreversible.**
 *
 * The confirmation phrase is compared exactly, after trimming — `RESET CHAPTERS` and
 * nothing else. Case is not forgiven, and the phrases differ per scope, so a phrase
 * copied from one dialog cannot confirm another.
 *
 * The audit entry is written **after** the delete and carries the per-collection counts,
 * because afterwards there is nothing left to count and an entry reading "a reset
 * happened" answers none of the questions anybody will ask.
 */
router.post(
  '/admin/reset/:scope',
  requirePermission('content:reset'),
  adminActionLimiter,
  validate({ params: resetScopeParamSchema, body: resetConfirmSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { scope } = req.params as unknown as ResetScopeParam;
      const { confirm } = req.body as ResetConfirmInput;

      if (confirm.trim() !== CONFIRM_PHRASES[scope]) {
        // 400 rather than 403: the caller is allowed to do this, they have simply not
        // confirmed it. The message names the exact phrase, because a confirmation the
        // user cannot work out how to give is just a broken button.
        sendError(res, 400, `To confirm, type exactly: ${CONFIRM_PHRASES[scope]}`);
        return;
      }

      const actor = req.user?.studentId ?? req.user?.email ?? 'unknown';
      const outcome = await performReset(scope, actor);

      await recordAudit(req, {
        action: 'content.reset',
        targetType: 'system',
        targetId: scope,
        targetLabel: `Reset ${scopeLabel(scope)}`,
        metadata: {
          scope,
          totalDeleted: outcome.totalDeleted,
          // Denormalised per collection: after this there is nothing left to join against.
          deleted: Object.fromEntries(outcome.deleted.map((line) => [line.label, line.count])),
        },
      });

      sendSuccess(res, 200, {
        scope: outcome.scope,
        label: outcome.label,
        deleted: outcome.deleted,
        totalDeleted: outcome.totalDeleted,
      });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Content reset failed',
        fallback: 'Could not complete that reset. Nothing may have been deleted — check the area before retrying.',
      });
    }
  },
);

export default router;
