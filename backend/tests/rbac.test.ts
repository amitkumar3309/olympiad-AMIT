import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { config } from '../src/config';
import { AuditLog, Student } from '../src/models';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  validStudent,
  otherStudent,
  rootAdmin,
  clearTestInbox,
  cookieHeader,
  parseCookies,
  registerVerifyLogin,
  loginRootAdmin,
  createAdminSession,
} from './helpers/auth';

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** Every route a student must never reach, with a request that would otherwise succeed. */
const ADMIN_ENDPOINTS: Array<{ name: string; call: (cookie: string) => request.Test }> = [
  {
    name: 'GET /admin/students',
    call: (cookie) => request(app).get(`${API}/admin/students`).set('Cookie', cookie),
  },
  {
    name: 'GET /admin/students/:studentId',
    call: (cookie) => request(app).get(`${API}/admin/students/AMIT_0001`).set('Cookie', cookie),
  },
  {
    name: 'PATCH /admin/students/:studentId/status',
    call: (cookie) =>
      request(app).patch(`${API}/admin/students/AMIT_0001/status`).set('Cookie', cookie).send({ status: 'suspended' }),
  },
  {
    name: 'PATCH /admin/users/:studentId/role',
    call: (cookie) =>
      request(app).patch(`${API}/admin/users/AMIT_0001/role`).set('Cookie', cookie).send({ role: 'admin' }),
  },
  {
    name: 'GET /admin/audit-logs',
    call: (cookie) => request(app).get(`${API}/admin/audit-logs`).set('Cookie', cookie),
  },
  {
    name: 'POST /admin/generate-questions',
    call: (cookie) =>
      request(app)
        .post(`${API}/admin/generate-questions`)
        .set('Cookie', cookie)
        .send({ classLevel: '8', subject: 'Maths', topic: 'Algebra', difficulty: 'Easy', count: 1 }),
  },
];

describe('roles and the permissions surface', () => {
  it('gives a student only student-level permissions', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);

    expect(login.body.role).toBe('student');
    expect(login.body.student.studentId).toBe(studentId);
    expect(login.body.permissions).toContain('analytics:read:self');
    expect(login.body.permissions).not.toContain('students:read');
    expect(login.body.permissions).not.toContain('users:role:write');
  });

  it('gives the root administrator the superadmin role and the role-write permission', async () => {
    const res = await request(app).post(`${API}/auth/admin/login`).send(rootAdmin).expect(200);

    expect(res.body.role).toBe('superadmin');
    expect(res.body.permissions).toContain('users:role:write');
    expect(res.body.permissions).toContain('students:read');
    expect(res.body.permissions).toContain('audit:read');
  });

  it('gives a promoted admin administrative permissions but not role-write', async () => {
    const { cookies } = await createAdminSession(app);
    const me = await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(me.body.role).toBe('admin');
    expect(me.body.permissions).toContain('students:read');
    expect(me.body.permissions).toContain('students:status:write');
    expect(me.body.permissions).not.toContain('users:role:write');
  });

  it('rejects the root admin credentials with a wrong password', async () => {
    await request(app)
      .post(`${API}/auth/admin/login`)
      .send({ email: rootAdmin.email, password: 'NotTheRootPass1' })
      .expect(401);
  });
});

describe('a student cannot reach admin APIs', () => {
  it.each(ADMIN_ENDPOINTS)('refuses a student on $name with 403', async ({ call }) => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await call(cookieHeader(cookies));

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(200);
    expect(res.body.success).toBe(false);
  });

  it.each(ADMIN_ENDPOINTS)('refuses an unauthenticated caller on $name with 401', async ({ call }) => {
    const res = await call('');
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(200);
  });

  it('refuses a student through the unversioned /api alias too', async () => {
    const { cookies } = await registerVerifyLogin(app);

    // The alias mounts the same router; it must not be a way around the gate.
    const res = await request(app).get('/api/admin/students').set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(403);
  });

  it('leaks no account data in the refusal body', async () => {
    await registerVerifyLogin(app, otherStudent);
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/admin/students`).set('Cookie', cookieHeader(cookies)).expect(403);

    expect(res.body.students).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(otherStudent.email);
  });
});

describe('token manipulation cannot grant privileges', () => {
  it('rejects a superadmin token signed with the wrong secret', async () => {
    const forged = jwt.sign({ role: 'superadmin', email: 'attacker@example.com', root: true }, 'not-the-real-secret');

    const res = await request(app).get(`${API}/admin/students`).set('Cookie', `access_token=${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token whose role is not a known role', async () => {
    const bogus = jwt.sign({ role: 'root', sub: '507f1f77bcf86cd799439011', tv: 0 }, config.jwtSecret);

    await request(app).get(`${API}/admin/students`).set('Cookie', `access_token=${bogus}`).expect(401);
    await request(app).get(`${API}/auth/me`).set('Cookie', `access_token=${bogus}`).expect(401);
  });

  it('rejects a token with no role claim at all', async () => {
    const roleless = jwt.sign({ sub: '507f1f77bcf86cd799439011', tv: 0 }, config.jwtSecret);
    await request(app).get(`${API}/admin/students`).set('Cookie', `access_token=${roleless}`).expect(401);
  });

  it('refuses a token that claims admin for an account that is only a student', async () => {
    // The signature is genuine; only the role claim is a lie. The database is the
    // authority for privileged requests, so the claim buys nothing.
    const { studentId } = await registerVerifyLogin(app);
    const record = await Student.findOne({ studentId });

    const lying = jwt.sign(
      { role: 'admin', sub: String(record!._id), studentId, email: record!.email, tv: record!.tokenVersion },
      config.jwtSecret,
      { expiresIn: '15m' },
    );

    const res = await request(app).get(`${API}/admin/students`).set('Cookie', `access_token=${lying}`);
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(200);
  });

  it('refuses a superadmin claim attached to a student account', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const record = await Student.findOne({ studentId });

    const lying = jwt.sign(
      { role: 'superadmin', sub: String(record!._id), studentId, tv: record!.tokenVersion },
      config.jwtSecret,
      { expiresIn: '15m' },
    );

    await request(app)
      .patch(`${API}/admin/users/${studentId}/role`)
      .set('Cookie', `access_token=${lying}`)
      .send({ role: 'admin' })
      .expect(403);
  });

  it('refuses a Milestone 2 style admin token, which has a role but no subject', async () => {
    // Tokens issued before Milestone 3 carry `role: 'admin'` with no `sub` and no
    // `root` flag. They must be refused rather than matching an arbitrary document
    // — `findById(undefined)` must not degrade into "the first account".
    await registerVerifyLogin(app);
    const legacy = jwt.sign({ role: 'admin', email: 'root@old.test' }, config.jwtSecret, { expiresIn: '8h' });

    const res = await request(app).get(`${API}/admin/students`).set('Cookie', `access_token=${legacy}`);
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(200);
    expect(res.body.students).toBeUndefined();
  });

  it('ignores a `root` claim that has no matching environment identity', async () => {
    // `root: true` skips the database lookup, so the signature is the only thing
    // standing between an attacker and superadmin — check it really does stand.
    const forged = jwt.sign({ role: 'superadmin', email: 'attacker@example.com', root: true }, 'wrong-secret-entirely');
    await request(app).get(`${API}/admin/audit-logs`).set('Cookie', `access_token=${forged}`).expect(401);
  });
});

describe('registration cannot self-assign a role', () => {
  it('ignores a role field submitted at registration', async () => {
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, role: 'admin' })
      .expect(201);

    expect(res.body.student.role).toBe('student');
    const record = await Student.findOne({ email: validStudent.email });
    expect(record!.role).toBe('student');
  });

  it('ignores a superadmin role field submitted at registration', async () => {
    await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, role: 'superadmin' })
      .expect(201);

    const record = await Student.findOne({ email: validStudent.email });
    expect(record!.role).toBe('student');
  });

  it('refuses to assign superadmin through the role endpoint', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    // `superadmin` is not in the assignable enum, so validation rejects it — there
    // is deliberately no API path to a second root administrator.
    await request(app)
      .patch(`${API}/admin/users/${studentId}/role`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ role: 'superadmin' })
      .expect(400);

    const record = await Student.findOne({ studentId });
    expect(record!.role).toBe('student');
  });
});

describe('losing privileges takes effect immediately', () => {
  it('refuses an admin whose role was revoked, without waiting for token expiry', async () => {
    const { cookies, studentId } = await createAdminSession(app);
    await request(app).get(`${API}/admin/students`).set('Cookie', cookieHeader(cookies)).expect(200);

    // Demote directly in the database, leaving `tokenVersion` untouched, so the
    // still-valid access token is refused purely by the freshness check.
    await Student.updateOne({ studentId }, { $set: { role: 'student' } });

    const res = await request(app).get(`${API}/admin/students`).set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(200);
  });

  it('refuses an admin whose account was suspended', async () => {
    const { cookies, studentId } = await createAdminSession(app);
    await Student.updateOne({ studentId }, { $set: { status: 'suspended' } });

    const res = await request(app).get(`${API}/admin/students`).set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(403);
  });

  it('refuses an admin whose account was deleted', async () => {
    const { cookies, studentId } = await createAdminSession(app);
    await Student.deleteOne({ studentId });

    await request(app).get(`${API}/admin/students`).set('Cookie', cookieHeader(cookies)).expect(401);
  });

  it('revokes the promoted account’s existing sessions when the role changes', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    await request(app)
      .patch(`${API}/admin/users/${studentId}/role`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ role: 'admin' })
      .expect(200);

    // The session that existed before the promotion is gone, so the new role can
    // only be picked up by signing in again.
    await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(cookies)).expect(401);
    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(401);
  });

  it('ends a student’s sessions when an admin suspends the account', async () => {
    const { cookies: studentCookies, studentId } = await registerVerifyLogin(app);
    const { cookies: adminCookies } = await createAdminSession(app, otherStudent);

    await request(app)
      .patch(`${API}/admin/students/${studentId}/status`)
      .set('Cookie', cookieHeader(adminCookies))
      .send({ status: 'suspended', reason: 'Investigating suspected collusion' })
      .expect(200);

    // 401 rather than 403: suspending also bumps `tokenVersion`, so the session is
    // revoked outright and never reaches the status check. Either way the student
    // is out, and cannot refresh their way back in.
    await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(studentCookies)).expect(401);
    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(studentCookies)).expect(401);

    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(403);
  });
});

describe('an admin cannot widen its own privileges', () => {
  it('refuses an admin trying to promote someone', async () => {
    const { cookies } = await createAdminSession(app);
    const { studentId: targetId } = await registerVerifyLogin(app, otherStudent);

    const res = await request(app)
      .patch(`${API}/admin/users/${targetId}/role`)
      .set('Cookie', cookieHeader(cookies))
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
    const record = await Student.findOne({ studentId: targetId });
    expect(record!.role).toBe('student');
  });

  it('refuses an admin trying to promote itself', async () => {
    const { cookies, studentId } = await createAdminSession(app);

    await request(app)
      .patch(`${API}/admin/users/${studentId}/role`)
      .set('Cookie', cookieHeader(cookies))
      .send({ role: 'admin' })
      .expect(403);
  });

  it('refuses an admin trying to suspend another admin', async () => {
    const { cookies } = await createAdminSession(app);
    const { studentId: peerId } = await createAdminSession(app, otherStudent);

    const res = await request(app)
      .patch(`${API}/admin/students/${peerId}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'suspended' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/super admin/i);
  });

  it('lets a super admin suspend an admin', async () => {
    const { studentId: adminId } = await createAdminSession(app);
    const rootCookies = await loginRootAdmin(app);

    await request(app)
      .patch(`${API}/admin/students/${adminId}/status`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ status: 'suspended' })
      .expect(200);

    const record = await Student.findOne({ studentId: adminId });
    expect(record!.status).toBe('suspended');
  });

  it('refuses a promoted admin changing the status of its own account', async () => {
    const { cookies, studentId } = await createAdminSession(app);

    await request(app)
      .patch(`${API}/admin/students/${studentId}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'deactivated' })
      .expect(409);
  });

  it('refuses to promote an unverified account', async () => {
    const registration = await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const rootCookies = await loginRootAdmin(app);

    const res = await request(app)
      .patch(`${API}/admin/users/${registration.body.student.studentId}/role`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ role: 'admin' })
      .expect(409);
    expect(res.body.error).toMatch(/verified/i);
  });
});

describe('reading another student’s data', () => {
  it('refuses a student reading someone else’s analytics', async () => {
    const { studentId: otherId } = await registerVerifyLogin(app, otherStudent);
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/analytics/${otherId}`).set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(200);
  });

  it('lets a student read their own analytics', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    await request(app).get(`${API}/analytics/${studentId}`).set('Cookie', cookieHeader(cookies)).expect(200);
  });

  it('lets an admin read any student’s analytics', async () => {
    const { studentId: targetId } = await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);

    await request(app).get(`${API}/analytics/${targetId}`).set('Cookie', cookieHeader(cookies)).expect(200);
  });

  it('stops a demoted admin from reading other students’ analytics', async () => {
    const { studentId: targetId } = await registerVerifyLogin(app);
    const { cookies, studentId: adminId } = await createAdminSession(app, otherStudent);

    await request(app).get(`${API}/analytics/${targetId}`).set('Cookie', cookieHeader(cookies)).expect(200);

    await Student.updateOne({ studentId: adminId }, { $set: { role: 'student' } });

    const res = await request(app).get(`${API}/analytics/${targetId}`).set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(403);
  });
});

describe('administrative audit trail', () => {
  it('records a role change with actor, target and the values either side', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    await request(app)
      .patch(`${API}/admin/users/${studentId}/role`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ role: 'admin', reason: 'Appointed as regional coordinator' })
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'user.role.changed' });
    expect(entry).not.toBeNull();
    expect(entry!.actorRole).toBe('superadmin');
    expect(entry!.actorLabel).toBe(rootAdmin.email);
    expect(entry!.targetId).toBe(studentId);
    expect(entry!.outcome).toBe('success');
    expect(entry!.metadata).toMatchObject({ from: 'student', to: 'admin', reason: 'Appointed as regional coordinator' });
  });

  it('records a status change', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);

    await request(app)
      .patch(`${API}/admin/students/${studentId}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'suspended', reason: 'Repeated abuse reports' })
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'student.status.changed' });
    expect(entry).not.toBeNull();
    expect(entry!.actorRole).toBe('admin');
    expect(entry!.targetId).toBe(studentId);
    expect(entry!.metadata).toMatchObject({ from: 'active', to: 'suspended' });
  });

  it('records question generation', async () => {
    const { cookies } = await createAdminSession(app);

    await request(app)
      .post(`${API}/admin/generate-questions`)
      .set('Cookie', cookieHeader(cookies))
      .send({ classLevel: '9', subject: 'Maths', topic: 'Geometry', difficulty: 'Hard', count: 2 })
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'questions.generated' });
    expect(entry).not.toBeNull();
    expect(entry!.metadata).toMatchObject({ subject: 'Maths', topic: 'Geometry', count: 2 });
  });

  it('records an administrative sign-in', async () => {
    await createAdminSession(app);

    const entries = await AuditLog.find({ action: 'admin.session.started' });
    // One for the root admin doing the promotion, one for the promoted admin's login.
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some((e) => e.actorRole === 'superadmin')).toBe(true);
    expect(entries.some((e) => e.actorRole === 'admin')).toBe(true);
  });

  it('records a refused privileged request, which is what an escalation attempt looks like', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);

    await request(app).get(`${API}/admin/students`).set('Cookie', cookieHeader(cookies)).expect(403);

    const entry = await AuditLog.findOne({ action: 'authz.denied' });
    expect(entry).not.toBeNull();
    expect(entry!.outcome).toBe('denied');
    expect(entry!.actorRole).toBe('student');
    expect(entry!.actorLabel).toBe(studentId);
    expect(entry!.metadata).toMatchObject({ missing: ['students:read'] });
  });

  it('lets an admin read the trail and a student not read it at all', async () => {
    const { cookies: studentCookies } = await registerVerifyLogin(app);
    const { cookies: adminCookies } = await createAdminSession(app, otherStudent);

    const visible = await request(app)
      .get(`${API}/admin/audit-logs`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);
    expect(Array.isArray(visible.body.entries)).toBe(true);
    expect(visible.body.pagination.total).toBeGreaterThan(0);

    await request(app).get(`${API}/admin/audit-logs`).set('Cookie', cookieHeader(studentCookies)).expect(403);
  });

  it('filters the trail by action and outcome', async () => {
    const { cookies: studentCookies } = await registerVerifyLogin(app);
    await request(app).get(`${API}/admin/students`).set('Cookie', cookieHeader(studentCookies)).expect(403);

    const rootCookies = await loginRootAdmin(app);
    const denied = await request(app)
      .get(`${API}/admin/audit-logs?outcome=denied`)
      .set('Cookie', cookieHeader(rootCookies))
      .expect(200);

    expect(denied.body.entries.length).toBeGreaterThan(0);
    expect(denied.body.entries.every((e: { outcome: string }) => e.outcome === 'denied')).toBe(true);
  });

  it('rejects an unknown audit action filter rather than ignoring it', async () => {
    const rootCookies = await loginRootAdmin(app);
    await request(app)
      .get(`${API}/admin/audit-logs?action=not-an-action`)
      .set('Cookie', cookieHeader(rootCookies))
      .expect(400);
  });
});

describe('admin listing and lookup', () => {
  it('lists real accounts with pagination', async () => {
    await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);

    const res = await request(app).get(`${API}/admin/students?limit=1`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.body.students).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it('never includes a password hash in the listing', async () => {
    await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);

    const res = await request(app).get(`${API}/admin/students`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('filters by role and by status', async () => {
    await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);

    const admins = await request(app)
      .get(`${API}/admin/students?role=admin`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(admins.body.pagination.total).toBe(1);

    const active = await request(app)
      .get(`${API}/admin/students?status=active`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(active.body.pagination.total).toBe(2);
  });

  it('treats a search term as literal text, not as a pattern', async () => {
    await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);

    // Unescaped, `.*` would match every account; escaped, it matches none.
    const res = await request(app)
      .get(`${API}/admin/students?search=${encodeURIComponent('.*')}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.pagination.total).toBe(0);
  });

  it('rejects a malformed student ID instead of using it as a filter', async () => {
    const { cookies } = await createAdminSession(app);

    await request(app)
      .get(`${API}/admin/students/not-a-student-id`)
      .set('Cookie', cookieHeader(cookies))
      .expect(400);
  });

  it('rejects an unknown status value', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);

    await request(app)
      .patch(`${API}/admin/students/${studentId}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'banished' })
      .expect(400);
  });

  it('reports 404 for an account that does not exist', async () => {
    const { cookies } = await createAdminSession(app);

    await request(app).get(`${API}/admin/students/AMIT_9999`).set('Cookie', cookieHeader(cookies)).expect(404);
  });

  it('reinstates a suspended account and clears its lockout', async () => {
    const { studentId } = await registerVerifyLogin(app);
    await Student.updateOne(
      { studentId },
      { $set: { status: 'suspended', failedLoginAttempts: 4, lockedUntil: new Date(Date.now() + 60_000) } },
    );
    const { cookies } = await createAdminSession(app, otherStudent);

    await request(app)
      .patch(`${API}/admin/students/${studentId}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'active' })
      .expect(200);

    const record = await Student.findOne({ studentId });
    expect(record!.status).toBe('active');
    expect(record!.failedLoginAttempts).toBe(0);
    expect(record!.lockedUntil).toBeNull();

    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
  });

  it('reports an unchanged status without recording an audit entry', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const { cookies } = await createAdminSession(app, otherStudent);

    const res = await request(app)
      .patch(`${API}/admin/students/${studentId}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'active' })
      .expect(200);

    expect(res.body.changed).toBe(false);
    expect(await AuditLog.countDocuments({ action: 'student.status.changed' })).toBe(0);
  });
});

describe('a promoted admin keeps its own student capabilities', () => {
  it('can still read its own analytics and refresh its session', async () => {
    const { cookies, studentId } = await createAdminSession(app);

    await request(app).get(`${API}/analytics/${studentId}`).set('Cookie', cookieHeader(cookies)).expect(200);

    const refreshed = await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(refreshed.body.role).toBe('admin');
    expect(refreshed.body.permissions).toContain('students:read');
  });

  it('can sign out of every device', async () => {
    const { cookies } = await createAdminSession(app);
    const rotated = parseCookies(
      await request(app).post(`${API}/auth/logout-all`).set('Cookie', cookieHeader(cookies)).expect(200),
    );

    expect(rotated.access_token).toBe('');
    await request(app).get(`${API}/admin/students`).set('Cookie', cookieHeader(cookies)).expect(401);
  });
});
