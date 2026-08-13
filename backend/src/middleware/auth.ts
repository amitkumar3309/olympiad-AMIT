import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config';
import { ApiError } from '../lib/ApiError';
import { recordAudit } from '../lib/audit';
import { logger } from '../lib/logger';
import { can, permissionsFor, requiresFreshCheck, type Permission, type Role } from '../lib/permissions';
import { verifyAccessToken, type AccessTokenClaims } from '../lib/tokens';
import { Student } from '../models';
import { ensureDb } from './ensureDb';

export type AuthPayload = AccessTokenClaims;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * The only authorization module in this backend. Routes must gate access through
 * `requirePermission` (preferred) or `requireAuth`, and must never compare
 * `req.user.role` to a literal themselves — the role → permission table in
 * `lib/permissions.ts` is the single place that mapping is allowed to live
 * (see CLAUDE.md "Architecture Rules").
 */

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Verifies the access-token cookie and attaches its claims. Stateless: signature
 * and expiry only, with no database read, so it stays cheap on every request.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const claims = verifyAccessToken(req.cookies?.[config.auth.accessCookieName]);
  if (!claims) {
    next(ApiError.unauthorized('Not authenticated'));
    return;
  }
  req.user = claims;
  next();
}

/**
 * Attaches the caller's claims **if** a valid session cookie is present, and does
 * nothing at all if it is not. Never rejects, and never reads the database.
 *
 * This is not a gate and must never be used as one — it grants nothing. It exists for a
 * genuinely public route whose *content* legitimately differs for a signed-in caller:
 * the leaderboard is readable by anybody, but a signed-in student also gets their own
 * standing in the same response and may page deeper into the list than an anonymous
 * visitor (see `leaderboard.routes.ts`). The alternative — a second, authenticated copy
 * of the same endpoint — would be two ranking surfaces that could disagree.
 *
 * Anything a route decides on the strength of `req.user` here is a *presentation*
 * decision. A capability decision still goes through `requirePermission`, which does
 * reject, and does re-read the role from the database when it matters.
 */
export function attachUserIfPresent(req: Request, _res: Response, next: NextFunction): void {
  const claims = verifyAccessToken(req.cookies?.[config.auth.accessCookieName]);
  if (claims) req.user = claims;
  next();
}

/**
 * Role-level gate, retained for routes whose requirement genuinely *is* an
 * identity rather than a capability (`/auth/logout-all` only makes sense for the
 * account that owns the session). For anything a role is merely a proxy for, use
 * `requirePermission`.
 */
export function requireAuth(...roles: Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    authenticate(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (roles.length > 0 && !roles.includes(req.user!.role)) {
        next(ApiError.forbidden('Not authorized'));
        return;
      }
      next();
    });
  };
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

type RoleResolution = { ok: true; role: Role } | { ok: false; error: ApiError };

/**
 * Re-derives the caller's role from the database.
 *
 * The access token carries the role it was signed with, and lives up to its TTL.
 * Trusting it alone would let a demoted or suspended admin keep administrative
 * access for the remainder of that window. For privileged requests we therefore
 * spend one indexed read to get the current truth — cheap, because administrative
 * traffic is a rounding error next to student traffic.
 *
 * The environment-configured root admin has no document to read, so it is exempt;
 * its privileges can only be withdrawn by changing the environment variables.
 */
async function resolveCurrentRole(claims: AccessTokenClaims): Promise<RoleResolution> {
  if (claims.root) return { ok: true, role: claims.role };

  try {
    const account = await Student.findById(claims.sub).select('role status tokenVersion');

    if (!account) {
      return { ok: false, error: ApiError.unauthorized('Your session is no longer valid.') };
    }
    // A stale `tv` means the session was revoked (logout-everywhere, password
    // reset, or a role change — all of which bump it deliberately).
    if (typeof claims.tv === 'number' && claims.tv !== account.tokenVersion) {
      return { ok: false, error: ApiError.unauthorized('Your session has been revoked. Please sign in again.') };
    }
    if (account.status !== 'active') {
      return { ok: false, error: ApiError.forbidden('This account is no longer active.') };
    }
    return { ok: true, role: account.role };
  } catch (err) {
    logger.error({ err }, 'Could not verify the current role of the caller');
    return {
      ok: false,
      error: new ApiError(503, 'Could not verify your permissions right now. Please try again shortly.'),
    };
  }
}

async function attachFreshRole(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const resolved = await resolveCurrentRole(req.user!);
  if (!resolved.ok) {
    next(resolved.error);
    return;
  }
  // The database wins over the token for every subsequent decision.
  req.user = { ...req.user!, role: resolved.role };
  next();
}

function checkPermissions(required: readonly Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.user!.role;
    const missing = required.filter((permission) => !can(role, permission));

    if (missing.length === 0) {
      next();
      return;
    }

    // Recorded because a burst of these is what an escalation attempt looks like.
    // Deliberately fire-and-forget: the refusal must not wait on a log write.
    void recordAudit(req, {
      action: 'authz.denied',
      targetType: 'route',
      targetId: req.originalUrl,
      outcome: 'denied',
      metadata: { method: req.method, role, missing },
    });

    logger.warn({ role, missing, path: req.originalUrl }, 'Authorization denied');
    next(ApiError.forbidden('You do not have permission to perform this action.'));
  };
}

/**
 * The gate every capability-based route should use.
 *
 * Returns a middleware *chain* (Express accepts an array wherever it accepts a
 * handler). For privileged permissions the chain additionally guarantees a
 * database connection and re-reads the caller's role, so the check is never based
 * on a stale token. For student-level permissions it stays stateless and does no
 * database work at all.
 */
export function requirePermission(...required: Permission[]): RequestHandler[] {
  const chain: RequestHandler[] = [authenticate];
  if (requiresFreshCheck(required)) {
    chain.push(ensureDb, attachFreshRole);
  }
  chain.push(checkPermissions(required));
  return chain;
}

/**
 * Capability check for a decision a route-level gate cannot express, because it
 * depends on the data being addressed rather than the path — e.g. "reading *this*
 * student's analytics is allowed because it is your own, or because you may read
 * anyone's". Still asks `lib/permissions.ts`, so the mapping stays in one place.
 */
export function callerCan(req: Request, permission: Permission): boolean {
  return req.user !== undefined && can(req.user.role, permission);
}

/**
 * Same as `callerCan`, but re-reads the role from the database first. Use this for
 * an in-handler check that grants access to *someone else's* data, where relying on
 * a possibly-stale token role would keep a demoted admin privileged until expiry.
 * Requires a live database connection (the caller's route already has `ensureDb`).
 */
export async function callerCanFresh(req: Request, permission: Permission): Promise<boolean> {
  if (!req.user) return false;
  const resolved = await resolveCurrentRole(req.user);
  if (!resolved.ok) return false;
  req.user = { ...req.user, role: resolved.role };
  return can(resolved.role, permission);
}

export { permissionsFor };
