import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import { hasEntryEntitlement } from '../services/paymentService';

/**
 * THE Olympiad entry gate (owner decision, 2026-08-17).
 *
 * ## What it covers, and what it deliberately does not
 *
 * **Only the official Olympiad.** Practice, mock tests, the daily challenge and
 * analytics are free and are gated nowhere — a student prepares for free and pays only
 * to compete. This is narrower than the version that briefly shipped on 2026-08-16,
 * which gated all four; the owner reversed that the next day, and the reversal is the
 * product decision rather than a technical one. If you are adding a surface, the
 * question to ask is "is this the competition itself?", and for everything built so far
 * the answer is no.
 *
 * ## Why this is a middleware and not a permission
 *
 * `requirePermission()` answers "what may this *role* do?" and reads a static table.
 * Payment is a different axis entirely: two students with identical roles differ by
 * whether money arrived, which is a fact about a collection rather than about a role.
 * Putting `entry:paid` into the permission table would mean the table stopped being
 * derivable from the role, which is the property that makes it checkable by reading it.
 *
 * So this runs *alongside* the authorization gate rather than inside it. A gated route
 * still declares its permission; this adds the second question.
 *
 * ## Why routes never call `hasEntryEntitlement()` themselves
 *
 * The same reason there is one grader and one reward engine: a surface that has to
 * remember to ask is a surface that will eventually forget, and a forgotten paywall is
 * indistinguishable from a working one until somebody notices the revenue. Mounting a
 * middleware makes the gate visible in the route definition, where a reviewer can see
 * whether it is there.
 *
 * ## 402, not 403
 *
 * They mean genuinely different things to the page that receives them. 403 is "you may
 * not, and nothing you do will change that" — the `Unauthorized` screen. 402 is "not
 * yet, and here is what to do about it" — a pay button. The frontend branches on the
 * status, so returning 403 here would strand a paying customer on a dead end.
 *
 * ## Ordering
 *
 * Mount **after** `requireAuth`/`requirePermission` (there is no entitlement without an
 * identity) and **after** `ensureDb` (this reads two collections). Getting that wrong
 * shows up as a 402 for an anonymous caller, which leaks that the route exists.
 */
export async function requireEntry(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sub = req.user?.sub;
  if (!sub) {
    // Should be unreachable: an auth gate runs first. Refusing rather than falling
    // through is deliberate — a missing identity here means the route was assembled
    // wrongly, and admitting the caller would be the wrong way to find that out.
    next(new ApiError(401, 'Not authenticated'));
    return;
  }

  try {
    if (await hasEntryEntitlement(new Types.ObjectId(sub))) {
      next();
      return;
    }
  } catch (err) {
    // A failed entitlement read must not admit the caller. It is money.
    logger.error({ err, sub }, 'Entitlement check failed — refusing rather than admitting');
    next(new ApiError(503, 'Could not confirm your entry fee right now. Please try again shortly.'));
    return;
  }

  next(
    ApiError.paymentRequired(
      'The Olympiad entry fee has not been paid for this account. Pay it to sit the official exam — practice, mock ' +
        'tests and the daily challenge stay free.',
    ),
  );
}
