import type { Request } from 'express';
import { Types } from 'mongoose';
import { isConnected } from '../db/connection';
import { AuditLog, type AuditAction, type AuditTargetType } from '../models';
import { logger } from './logger';
import type { AccessTokenClaims } from './tokens';

export interface AuditEntry {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string | null;
  targetLabel?: string | null;
  outcome?: 'success' | 'denied';
  metadata?: Record<string, unknown>;
}

/**
 * How an actor is identified in the trail: `AMIT_xxxx` for any account-backed
 * actor, so it matches the `targetId` of entries about that same account and can be
 * pasted straight into the admin search. The root admin has no student ID, so it is
 * identified by the email it signs in with.
 */
function actorLabel(claims: AccessTokenClaims): string {
  return claims.studentId ?? claims.email ?? `${claims.role} (unidentified)`;
}

function actorObjectId(claims: AccessTokenClaims): Types.ObjectId | null {
  // The environment-configured root admin has no database document, so there is
  // no ObjectId to reference — only the label identifies it.
  if (!claims.sub || !Types.ObjectId.isValid(claims.sub)) return null;
  return new Types.ObjectId(claims.sub);
}

/**
 * Writes one row to the administrative audit trail.
 *
 * Never throws. A failed audit write must not turn a completed administrative
 * action into an error response — the action already happened, and reporting it as
 * failed would be a lie that invites the admin to repeat it. Failures are logged at
 * `error` level instead, so they are visible in the platform logs. (Trade-off
 * recorded in DECISIONS.md.)
 */
export async function recordAudit(req: Request, entry: AuditEntry): Promise<void> {
  const claims = req.user;
  if (!claims) {
    logger.error({ action: entry.action }, 'Audit entry skipped: no authenticated actor on the request');
    return;
  }

  // Every route that changes state runs behind `ensureDb`, so this only bites on
  // the root-admin login, which is deliberately answerable without a database.
  // Logging the entry beats throwing away the record entirely.
  if (!isConnected()) {
    logger.warn({ entry, actor: actorLabel(claims) }, 'Audit entry not persisted: database not connected');
    return;
  }

  try {
    await AuditLog.create({
      action: entry.action,
      actorRole: claims.role,
      actor: actorObjectId(claims),
      actorLabel: actorLabel(claims),
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel ?? null,
      outcome: entry.outcome ?? 'success',
      metadata: entry.metadata,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  } catch (err) {
    logger.error({ err, action: entry.action, actor: actorLabel(claims) }, 'Failed to write audit log entry');
  }
}
