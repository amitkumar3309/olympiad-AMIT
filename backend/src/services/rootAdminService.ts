import { config } from '../config';
import { Student, type StudentDocument } from '../models';
import { logger } from '../lib/logger';

/**
 * The bootstrap super administrator.
 *
 * ## What changed, and why
 *
 * Until Milestone 11 the root administrator had **no database document**. It was a
 * pure environment identity, which kept the bootstrap simple but cost it everything
 * an account normally gets: no refresh token (so no rotation and no theft
 * detection, and an 8-hour session that ended in a silent sign-out with nothing to
 * renew it), no `tokenVersion` (so no way to revoke it), no audit `actor` to join
 * on, and no row in the account listing — the most privileged identity in the
 * product was the only one nobody could see.
 *
 * It now has a document like any other account. `ADMIN_EMAIL` and
 * `ADMIN_PASSWORD_HASH` remain the bootstrap, but only until that document exists:
 * they are the seed, not the ongoing source of truth.
 *
 * ## The escalation this deliberately refuses
 *
 * Provisioning "find the account with `ADMIN_EMAIL`, make it the super admin" would
 * be a privilege-escalation hole: anyone who learned the configured address could
 * register it as an ordinary student *before* the first admin sign-in, and then
 * authenticate against their own password to be handed `superadmin`.
 *
 * So an existing document is adopted **only** if it already holds `superadmin`.
 * Anything else is refused loudly rather than upgraded. The registration route
 * additionally refuses the configured address outright, which closes the window
 * from the other side.
 */

export type RootAdminResolution =
  | { ok: true; account: StudentDocument; provisioned: boolean }
  | { ok: false; reason: 'not-configured' | 'not-root' | 'invalid-credentials' | 'email-taken' };

function generateStudentId(): string {
  return `AMIT_${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`;
}

/**
 * Returns the super administrator's account for the given sign-in attempt,
 * creating it on first use.
 *
 * Note what this does **not** do: it never checks a password against an existing
 * document. Once the document exists it is an ordinary account, and the caller
 * authenticates it through exactly the same path as everybody else — lockout,
 * status, `tokenVersion` and all. The environment hash is consulted only to
 * authorise the very first provisioning, which is the one moment there is no
 * document to check against.
 */
export async function resolveRootSuperadmin(email: string): Promise<RootAdminResolution> {
  const { email: adminEmail, passwordHash: adminPasswordHash } = config.admin;

  if (!adminEmail || !adminPasswordHash) return { ok: false, reason: 'not-configured' };
  if (email.trim().toLowerCase() !== adminEmail.trim().toLowerCase()) return { ok: false, reason: 'not-root' };

  const existing = await Student.findOne({ email: adminEmail.toLowerCase() }).select('+passwordHash');

  if (existing) {
    if (existing.role !== 'superadmin') {
      // Someone holds the configured address without holding the role. Never
      // upgrade it — that is the escalation described above. Loud, because the
      // only innocent explanation is a misconfigured ADMIN_EMAIL.
      logger.error(
        { studentId: existing.studentId, role: existing.role },
        'ADMIN_EMAIL belongs to a non-superadmin account — refusing to grant it the role. ' +
          'Point ADMIN_EMAIL at an address nobody has registered.',
      );
      return { ok: false, reason: 'email-taken' };
    }
    return { ok: true, account: existing, provisioned: false };
  }

  // First sign-in: no document yet, so the environment hash is what authorises
  // creating one. It is copied in as the account's own hash, which is what makes
  // the configured password keep working immediately afterwards.
  const account = await createRootSuperadmin(adminEmail.toLowerCase(), adminPasswordHash);
  logger.warn({ studentId: account.studentId, email: account.email }, 'Provisioned the super administrator account');
  return { ok: true, account, provisioned: true };
}

/**
 * Creates the document. Retries on a `studentId` collision for the same reason
 * registration does — the identifier is only four digits and is uniquely indexed.
 */
async function createRootSuperadmin(email: string, passwordHash: string): Promise<StudentDocument> {
  let lastError: unknown;
  /**
   * Normally left unset — staff have no mobile number, and `requiredOnCreate` is
   * scoped to `student` for that reason. A unique index permits one document with
   * the field missing, and there is only ever one super admin.
   *
   * "Only ever one" is an assumption about production data, though: a legacy
   * account created before `mobile` was enforced would already hold that slot, and
   * provisioning would then fail on a duplicate key with a message about a field
   * nobody set. So a collision on `mobile` specifically falls back to a synthetic
   * 15-digit value — longer than any real number, and only used if the tidy option
   * is unavailable.
   */
  let syntheticMobile: string | undefined;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await Student.create({
        studentId: generateStudentId(),
        email,
        passwordHash,
        role: 'superadmin',
        ...(syntheticMobile ? { mobile: syntheticMobile } : {}),
        // Verified because the address came from the deployment's own environment
        // — there is nobody to send a confirmation link to but the operator.
        isEmailVerified: true,
        status: 'active',
        firstName: 'Super',
        lastName: 'Administrator',
      });
    } catch (err) {
      lastError = err;
      const duplicate = typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
      if (!duplicate) throw err;

      const keyPattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
      if ('mobile' in keyPattern) {
        syntheticMobile = `9${String(Math.floor(Math.random() * 1e14)).padStart(14, '0')}`;
        logger.warn('Another account already has no mobile number; giving the super admin a synthetic one');
      }
      // Otherwise it was `studentId`, and the next iteration generates another.
    }
  }

  throw lastError;
}

/**
 * True if the address is the configured bootstrap identity. Used by registration to
 * refuse it, so the window described above cannot be opened.
 */
export function isRootAdminEmail(email: string): boolean {
  const adminEmail = config.admin.email;
  return Boolean(adminEmail) && email.trim().toLowerCase() === adminEmail!.trim().toLowerCase();
}
