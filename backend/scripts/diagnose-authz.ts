/**
 * READ-ONLY diagnostic for "my superadmin privileges are not working".
 *
 * Writes nothing. It answers one question the browser cannot: when the server
 * refused the request with 403, *what role did it think the caller had?*
 *
 * `checkPermissions` in `middleware/auth.ts` records an `authz.denied` audit entry
 * for every refusal, carrying the resolved role and the permissions that were
 * missing. That entry is the ground truth — it is written after the database
 * re-read, so it reflects the caller's real role rather than the token's claim.
 *
 * Run: npx tsx scripts/diagnose-authz.ts
 */
import { config } from '../src/config';
import { envFileLoaded } from '../src/config/env';
import { redactUri } from '../src/lib/envGuard';
import { connectDB, disconnectDB } from '../src/db/connection';
import { AuditLog, Student } from '../src/models';

async function main(): Promise<void> {
  console.log('=== Environment ===');
  console.log(`Target database : ${redactUri(config.mongoUri)}`);
  console.log(`Loaded .env     : ${envFileLoaded ? 'yes' : 'NO'}`);
  console.log(`ADMIN_EMAIL set : ${config.admin.email ? `yes (${config.admin.email})` : 'NO'}`);
  console.log(`ADMIN hash set  : ${config.admin.passwordHash ? 'yes' : 'NO'}`);
  console.log(`Access token TTL: ${config.auth.accessTokenTtl}`);

  await connectDB();

  console.log('\n=== Last 15 authorization denials (403) ===');
  const denials = await AuditLog.find({ action: 'authz.denied' }).sort({ createdAt: -1 }).limit(15);

  if (denials.length === 0) {
    console.log('None recorded. The 403 did not come from requirePermission.');
  }
  for (const entry of denials) {
    const meta = (entry.metadata ?? {}) as { method?: string; role?: string; missing?: string[] };
    console.log(
      `${entry.createdAt.toISOString()}  role=${meta.role ?? '?'}  ` +
        `actor=${entry.actorLabel ?? '?'} (${entry.actorRole ?? '?'})  ` +
        `${meta.method ?? '?'} ${entry.targetId ?? '?'}  missing=${(meta.missing ?? []).join(',')}`,
    );
  }

  console.log('\n=== Role-change attempts that succeeded ===');
  const roleChanges = await AuditLog.find({ action: 'user.role.changed' }).sort({ createdAt: -1 }).limit(10);
  if (roleChanges.length === 0) console.log('None. No account has ever been promoted through the API.');
  for (const entry of roleChanges) {
    const meta = (entry.metadata ?? {}) as { from?: string; to?: string };
    console.log(
      `${entry.createdAt.toISOString()}  ${entry.targetId}  ${meta.from} -> ${meta.to}  by ${entry.actorLabel} (${entry.actorRole})`,
    );
  }

  console.log('\n=== Recent admin sessions ===');
  const sessions = await AuditLog.find({ action: 'admin.session.started' }).sort({ createdAt: -1 }).limit(5);
  if (sessions.length === 0) console.log('None. The root superadmin has never signed in successfully.');
  for (const entry of sessions) {
    const meta = (entry.metadata ?? {}) as { role?: string; via?: string };
    console.log(`${entry.createdAt.toISOString()}  ${entry.actorLabel}  role=${meta.role} via=${meta.via}`);
  }

  console.log('\n=== The accounts being promoted ===');
  for (const studentId of ['AMIT_7877', 'AMIT_9461']) {
    const account = await Student.findOne({ studentId }).select(
      'studentId email role status isEmailVerified tokenVersion',
    );
    console.log(
      account
        ? `${studentId}: role=${account.role} status=${account.status} verified=${account.isEmailVerified} tv=${account.tokenVersion}`
        : `${studentId}: NO SUCH ACCOUNT`,
    );
  }

  console.log('\n=== Accounts holding a role ===');
  const staff = await Student.find({ role: { $ne: 'student' } }).select('studentId email role status');
  if (staff.length === 0) console.log('None. Every account in the database is a plain student.');
  for (const account of staff) {
    console.log(`${account.studentId}  ${account.email}  role=${account.role}  status=${account.status}`);
  }

  await disconnectDB();
}

main().catch(async (err) => {
  console.error('Diagnostic failed:', err);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
