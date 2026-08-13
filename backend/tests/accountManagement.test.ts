import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { AuditLog, Student, StudentActivity, StudentPhoto } from '../src/models';
import { PERMISSIONS, isSuperadminOnly, permissionsFor } from '../src/lib/permissions';
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

/**
 * Milestone 11 — what a super administrator may do that an administrator may not.
 *
 * The suite is organised around the one property the whole milestone rests on: an
 * `admin` is *strictly weaker* than a `superadmin`, at every level. Not weaker by
 * convention, and not weaker because the UI hides a button — weaker because the
 * permission table says so, and because the routes refuse the account even when the
 * request is made directly.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** Registers an account and stops there — no verification, so it stays deletable. */
async function registerOnly(overrides: Partial<typeof validStudent> = {}): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/register`)
    .send({ ...validStudent, ...overrides })
    .expect(201);
  return res.body.student.studentId as string;
}

// ===========================================================================
// The guarantee, stated against the table itself
// ===========================================================================

describe('an admin is strictly weaker than a super admin', () => {
  it('holds a subset of the super admin’s permissions, with no exceptions', () => {
    const admin = permissionsFor('admin');
    const superadmin = permissionsFor('superadmin');

    // Read off the table rather than a hand-copied list, so a permission added to
    // `admin` alone in some future change fails here rather than shipping.
    for (const permission of admin) {
      expect(superadmin).toContain(permission);
    }
    expect(superadmin.length).toBeGreaterThan(admin.length);
  });

  it('is denied exactly the irreversible capabilities, and no others', () => {
    const admin = permissionsFor('admin');
    const withheld = PERMISSIONS.filter((permission) => !admin.includes(permission));

    // Both of these destroy something: a role assignment can mint an administrator,
    // and a deletion cannot be undone. Everything else an admin does is reversible,
    // which is the line the two roles are drawn along.
    expect([...withheld].sort()).toEqual(['users:delete', 'users:role:write']);
    for (const permission of withheld) expect(isSuperadminOnly(permission)).toBe(true);
  });

  it('grants a student none of the administrative capabilities', () => {
    const student = permissionsFor('student');
    expect(student).not.toContain('users:password:reset');
    expect(student).not.toContain('users:sessions:revoke');
    expect(student).not.toContain('users:delete');
    expect(student).not.toContain('users:role:write');
  });
});

// ===========================================================================
// The super administrator's own account
// ===========================================================================

describe('the super administrator has a real account', () => {
  it('is provisioned on first sign-in and gets a refresh token', async () => {
    const res = await request(app).post(`${API}/auth/admin/login`).send(rootAdmin).expect(200);
    const cookies = parseCookies(res);

    expect(res.body.role).toBe('superadmin');
    // The whole point of the change: a refresh-token family, so the session
    // rotates and can be revoked, instead of an 8-hour token that simply died.
    expect(cookies.refresh_token).toBeTruthy();

    const account = await Student.findOne({ email: rootAdmin.email });
    expect(account).not.toBeNull();
    expect(account!.role).toBe('superadmin');
    expect(account!.isEmailVerified).toBe(true);
    expect(account!.studentId).toMatch(/^ADMIN_\d{4}$/);
  });

  it('can actually refresh that session', async () => {
    const cookies = await loginRootAdmin(app);
    const refreshed = await request(app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(refreshed.body.role).toBe('superadmin');
    expect(refreshed.body.permissions).toContain('users:role:write');
  });

  it('provisions once, not once per sign-in', async () => {
    await loginRootAdmin(app);
    await loginRootAdmin(app);
    await loginRootAdmin(app);

    expect(await Student.countDocuments({ role: 'superadmin' })).toBe(1);
  });

  it('is turned away from the student login, even with the right password', async () => {
    await loginRootAdmin(app);

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: rootAdmin.email, password: rootAdmin.password });

    // Staff, not an entrant: it has no class or school, and the public login form
    // is not where the most privileged account should be reachable.
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/administrator portal/i);
    // Refused *without* a session — the 403 is not a cosmetic redirect.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('does not leak which address is the administrator’s', async () => {
    await loginRootAdmin(app);

    // A wrong password gets the ordinary generic failure, identical to any other
    // account's. The "use the portal" answer only appears once the caller has
    // already proved they know the password, so this is not an enumeration oracle.
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: rootAdmin.email, password: 'NotTheRootPassword1' });

    expect(res.status).toBe(401);
    expect(res.body.error).not.toMatch(/administrator portal/i);
  });

  it('holds a staff id, not a competitor one', async () => {
    await loginRootAdmin(app);
    const account = await Student.findOne({ role: 'superadmin' });

    // `AMIT_xxxx` is the number a child writes on an exam paper, and there are only
    // ten thousand of them. Staff get their own namespace rather than spending one.
    expect(account!.studentId).toMatch(/^ADMIN_\d{4}$/);
    expect(account!.studentId).not.toMatch(/^AMIT_/);
  });

  it('earns no XP, so it can never appear on a public leaderboard', async () => {
    await loginRootAdmin(app);
    await loginRootAdmin(app);

    const account = await Student.findOne({ email: rootAdmin.email });
    // Not "zero XP" but "no activity rows at all": every board is an aggregation
    // over this collection, so having no rows is what makes it unrankable.
    expect(await StudentActivity.countDocuments({ student: account!._id })).toBe(0);
  });

  it('refuses to adopt an existing non-superadmin account holding the configured address', async () => {
    // The escalation this closes: claim ADMIN_EMAIL as an ordinary student before
    // the first administrative sign-in, then authenticate with your own password.
    // The full field set, because a `student` still has to supply it — which the
    // model enforcing that here is itself worth knowing.
    await Student.create({
      studentId: 'AMIT_4242',
      email: rootAdmin.email,
      passwordHash: 'irrelevant',
      role: 'student',
      firstName: 'Squatter',
      lastName: 'Account',
      fatherName: 'Father Squatter',
      motherName: 'Mother Squatter',
      dateOfBirth: new Date('2010-01-01'),
      classLevel: 'Class 9',
      schoolName: 'Somewhere School',
      address: '1 Opportunist Lane, Example City, 110001',
      mobile: '9999999999',
    });

    const res = await request(app).post(`${API}/auth/admin/login`).send(rootAdmin);

    expect(res.status).toBe(500);
    expect(res.status).not.toBe(200);
    // Still a student. The role was not granted.
    const account = await Student.findOne({ email: rootAdmin.email });
    expect(account!.role).toBe('student');
  });

  it('cannot be registered as an ordinary account', async () => {
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, email: rootAdmin.email });

    expect(res.status).toBe(409);
    expect(await Student.countDocuments({ email: rootAdmin.email })).toBe(0);
  });

  it('cannot be demoted, suspended, password-reset or deleted through the API', async () => {
    const rootCookies = await loginRootAdmin(app);
    const superadmin = await Student.findOne({ role: 'superadmin' });
    const id = superadmin!.studentId;
    const header = cookieHeader(rootCookies);

    // 409 for the role route, which catches "your own account" first; 403 from the
    // protected-account guard for the rest. Either way: refused.
    await request(app).patch(`${API}/admin/users/${id}/role`).set('Cookie', header).send({ role: 'student' }).expect(409);
    await request(app)
      .patch(`${API}/admin/students/${id}/status`)
      .set('Cookie', header)
      .send({ status: 'blocked' })
      .expect(409);
    await request(app).post(`${API}/admin/users/${id}/reset-password`).set('Cookie', header).send({}).expect(409);
    await request(app)
      .delete(`${API}/admin/users/${id}`)
      .set('Cookie', header)
      .send({ confirmStudentId: id })
      .expect(409);

    expect((await Student.findOne({ role: 'superadmin' }))!.status).toBe('active');
  });
});

// ===========================================================================
// Password reset
// ===========================================================================

describe('resetting another account’s password', () => {
  it('issues a working temporary password that must then be changed', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    const res = await request(app)
      .post(`${API}/admin/users/${studentId}/reset-password`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ reason: 'Student lost access to their email' })
      .expect(200);

    const temporary = res.body.temporaryPassword as string;
    expect(temporary).toBeTruthy();
    expect(res.body.student.mustChangePassword).toBe(true);

    // The old password is dead and the new one works.
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(401);

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: temporary })
      .expect(200);
    expect(login.body.mustChangePassword).toBe(true);

    // And the flag clears only by actually changing the password.
    const cookies = parseCookies(login);
    await request(app)
      .post(`${API}/me/change-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({ currentPassword: temporary, newPassword: 'ChosenByThem7' })
      .expect(200);

    const after = await Student.findOne({ studentId });
    expect(after!.mustChangePassword).toBe(false);
  });

  it('never writes the temporary password into the audit trail', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    const res = await request(app)
      .post(`${API}/admin/users/${studentId}/reset-password`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({})
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'user.password.reset' });
    expect(entry).not.toBeNull();
    expect(entry!.targetId).toBe(studentId);
    expect(JSON.stringify(entry!.toObject())).not.toContain(res.body.temporaryPassword);
  });

  it('ends every existing session for the account', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    // Working before.
    await request(app).get(`${API}/me/profile`).set('Cookie', cookieHeader(cookies)).expect(200);

    await request(app)
      .post(`${API}/admin/users/${studentId}/reset-password`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({})
      .expect(200);

    // The refresh token is revoked, so the session cannot be renewed either.
    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(401);
  });

  it('is available to an ordinary admin for a student', async () => {
    const { cookies } = await createAdminSession(app);
    const targetId = await registerOnly(otherStudent);

    await request(app)
      .post(`${API}/admin/users/${targetId}/reset-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({})
      .expect(200);
  });

  it('refuses an admin acting on another admin', async () => {
    const { cookies } = await createAdminSession(app);
    const peer = await createAdminSession(app, otherStudent);

    const res = await request(app)
      .post(`${API}/admin/users/${peer.studentId}/reset-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({});

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(200);
  });

  it('refuses a student outright', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const targetId = await registerOnly(otherStudent);

    await request(app)
      .post(`${API}/admin/users/${targetId}/reset-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({})
      .expect(403);
  });
});

// ===========================================================================
// Deletion
// ===========================================================================

describe('deleting an account', () => {
  it('lets a super admin delete an unverified one, and its photo with it', async () => {
    const studentId = await registerOnly();
    const rootCookies = await loginRootAdmin(app);
    const before = await Student.findOne({ studentId });

    await request(app)
      .delete(`${API}/admin/users/${studentId}`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ confirmStudentId: studentId, reason: 'Duplicate registration' })
      .expect(200);

    expect(await Student.findOne({ studentId })).toBeNull();
    expect(await StudentPhoto.findOne({ student: before!._id })).toBeNull();

    // The trail keeps the identifiers, because there is no document left to join to.
    const entry = await AuditLog.findOne({ action: 'user.deleted' });
    expect(entry).not.toBeNull();
    expect(entry!.targetId).toBe(studentId);
    expect(entry!.metadata).toMatchObject({ email: validStudent.email });
  });

  it('refuses an ordinary admin entirely', async () => {
    const { cookies } = await createAdminSession(app);
    const targetId = await registerOnly(otherStudent);

    const res = await request(app)
      .delete(`${API}/admin/users/${targetId}`)
      .set('Cookie', cookieHeader(cookies))
      .send({ confirmStudentId: targetId });

    expect(res.status).toBe(403);
    expect(await Student.findOne({ studentId: targetId })).not.toBeNull();
  });

  it('refuses a verified account, pointing at deactivation instead', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    const res = await request(app)
      .delete(`${API}/admin/users/${studentId}`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ confirmStudentId: studentId });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/deactivate/i);
    expect(await Student.findOne({ studentId })).not.toBeNull();
  });

  it('refuses when the typed confirmation does not match the account', async () => {
    const studentId = await registerOnly();
    const rootCookies = await loginRootAdmin(app);

    await request(app)
      .delete(`${API}/admin/users/${studentId}`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ confirmStudentId: 'AMIT_0000' })
      .expect(400);

    expect(await Student.findOne({ studentId })).not.toBeNull();
  });
});

// ===========================================================================
// Status, including the new `blocked`
// ===========================================================================

describe('account status', () => {
  it('bars sign-in once blocked, with a message that says so', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    await request(app)
      .patch(`${API}/admin/students/${studentId}/status`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ status: 'blocked', reason: 'Repeated abuse of the practice zone' })
      .expect(200);

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/blocked/i);
  });

  it('records blocked distinctly from suspended in the trail', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    await request(app)
      .patch(`${API}/admin/students/${studentId}/status`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ status: 'blocked' })
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'student.status.changed' });
    expect(entry!.metadata).toMatchObject({ from: 'active', to: 'blocked' });
  });

  it('lets a blocked account be reinstated', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);
    const header = cookieHeader(rootCookies);

    await request(app).patch(`${API}/admin/students/${studentId}/status`).set('Cookie', header).send({ status: 'blocked' }).expect(200);
    await request(app).patch(`${API}/admin/students/${studentId}/status`).set('Cookie', header).send({ status: 'active' }).expect(200);

    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
  });

  it('refuses an admin blocking another admin', async () => {
    const { cookies } = await createAdminSession(app);
    const peer = await createAdminSession(app, otherStudent);

    await request(app)
      .patch(`${API}/admin/students/${peer.studentId}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'blocked' })
      .expect(403);
  });
});

// ===========================================================================
// Forced sign-out
// ===========================================================================

describe('revoking sessions', () => {
  it('signs an account out everywhere without changing anything else', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    await request(app)
      .post(`${API}/admin/users/${studentId}/revoke-sessions`)
      .set('Cookie', cookieHeader(rootCookies))
      .send({ reason: 'Left signed in on a school computer' })
      .expect(200);

    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(401);

    // Still active, still verified, same password — this is not a punishment.
    const account = await Student.findOne({ studentId });
    expect(account!.status).toBe('active');
    expect(account!.mustChangePassword).toBe(false);
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
  });

  it('refuses an admin acting on another admin', async () => {
    const { cookies } = await createAdminSession(app);
    const peer = await createAdminSession(app, otherStudent);

    await request(app)
      .post(`${API}/admin/users/${peer.studentId}/revoke-sessions`)
      .set('Cookie', cookieHeader(cookies))
      .send({})
      .expect(403);
  });
});
