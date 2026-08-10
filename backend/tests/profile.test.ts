import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { AuditLog, Student, StudentActivity, StudentPhoto } from '../src/models';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  clearTestInbox,
  cookieHeader,
  loginRootAdmin,
  parseCookies,
  registerVerifyLogin,
  validPhoto,
  validPngPhoto,
  TINY_JPEG_BASE64,
  TINY_PNG_BASE64,
} from './helpers/auth';

/**
 * Milestone 5 — the student's own profile and account settings.
 *
 * Everything here runs against a real in-memory MongoDB, and the assertions read the
 * saved documents back rather than trusting the response body: the point of the
 * milestone is that the data is genuinely persisted, so a test that only inspected
 * the echo would prove nothing.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** The editable profile payload, as the form submits it (every field, always). */
function profilePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'Test',
    middleName: 'Kumar',
    lastName: 'Student',
    fatherName: 'Father Student',
    motherName: 'Mother Student',
    dateOfBirth: '2010-04-15',
    classLevel: 'Class 9',
    schoolName: 'Springfield Public School',
    address: '12 Example Road, Example City, 110001',
    ...overrides,
  };
}

// ===========================================================================
// Reading your own profile
// ===========================================================================

describe('GET /me/profile', () => {
  it('returns every stored registration field for the signed-in student', async () => {
    const { cookies, student, studentId } = await registerVerifyLogin(app);

    const res = await request(app).get(`${API}/me/profile`).set('Cookie', cookieHeader(cookies)).expect(200);

    const { profile } = res.body;
    expect(profile.studentId).toBe(studentId);
    expect(profile.firstName).toBe(student.firstName);
    expect(profile.middleName).toBe(student.middleName);
    expect(profile.lastName).toBe(student.lastName);
    expect(profile.fatherName).toBe(student.fatherName);
    expect(profile.motherName).toBe(student.motherName);
    expect(profile.dateOfBirth).toBe(student.dateOfBirth);
    expect(profile.classLevel).toBe(student.classLevel);
    expect(profile.schoolName).toBe(student.schoolName);
    expect(profile.address).toBe(student.address);
    expect(profile.email).toBe(student.email);
    expect(profile.mobile).toBe(student.mobile);
    expect(profile.isEmailVerified).toBe(true);
    // The photo is mandatory at registration, so it must be reported as present.
    expect(profile.hasPhoto).toBe(true);
  });

  it('never includes the password hash', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/me/profile`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(res.body.profile.passwordHash).toBeUndefined();
  });

  it('refuses an unauthenticated request', async () => {
    const res = await request(app).get(`${API}/me/profile`);
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(500);
  });

  it('is gated on the unversioned /api alias too', async () => {
    const res = await request(app).get('/api/me/profile');
    expect(res.status).toBe(401);
  });

  it('answers 404 rather than crashing for the root admin, which has no student record', async () => {
    const cookies = await loginRootAdmin(app);
    const res = await request(app).get(`${API}/me/profile`).set('Cookie', cookieHeader(cookies));

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ===========================================================================
// Editing your own profile
// ===========================================================================

describe('PATCH /me/profile', () => {
  it('persists every changed field to MongoDB', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);

    const res = await request(app)
      .patch(`${API}/me/profile`)
      .set('Cookie', cookieHeader(cookies))
      .send(
        profilePayload({
          firstName: 'Renamed',
          lastName: 'Learner',
          middleName: null,
          classLevel: 'Class 10',
          schoolName: 'New Horizon Academy',
          address: '99 Changed Street, Another City, 560001',
          dateOfBirth: '2009-08-01',
        }),
      )
      .expect(200);

    expect(res.body.changed).toBe(true);

    const saved = await Student.findOne({ studentId });
    expect(saved!.firstName).toBe('Renamed');
    expect(saved!.lastName).toBe('Learner');
    expect(saved!.middleName).toBeNull();
    expect(saved!.classLevel).toBe('Class 10');
    expect(saved!.schoolName).toBe('New Horizon Academy');
    expect(saved!.address).toBe('99 Changed Street, Another City, 560001');
    expect(saved!.dateOfBirth.toISOString().slice(0, 10)).toBe('2009-08-01');
  });

  it('re-derives fullName from the edited name parts', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);

    await request(app)
      .patch(`${API}/me/profile`)
      .set('Cookie', cookieHeader(cookies))
      .send(profilePayload({ firstName: 'Aarav', middleName: 'Singh', lastName: 'Mehta' }))
      .expect(200);

    const saved = await Student.findOne({ studentId });
    expect(saved!.fullName).toBe('Aarav Singh Mehta');
  });

  it('reports changed:false and records nothing when the submission is identical', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const account = await Student.findOne({ studentId });
    const before = await StudentActivity.countDocuments({ student: account!._id, type: 'profile_updated' });

    const res = await request(app)
      .patch(`${API}/me/profile`)
      .set('Cookie', cookieHeader(cookies))
      .send(profilePayload())
      .expect(200);

    expect(res.body.changed).toBe(false);
    expect(await StudentActivity.countDocuments({ student: account!._id, type: 'profile_updated' })).toBe(before);
  });

  it('cannot be used to change identity, role or status, even when those keys are sent', async () => {
    const { cookies, student, studentId } = await registerVerifyLogin(app);

    await request(app)
      .patch(`${API}/me/profile`)
      .set('Cookie', cookieHeader(cookies))
      .send({
        ...profilePayload(),
        email: 'attacker@example.com',
        mobile: '9999999999',
        studentId: 'AMIT_0001',
        role: 'admin',
        status: 'suspended',
        isEmailVerified: false,
        tokenVersion: 999,
      })
      .expect(200);

    const saved = await Student.findOne({ studentId });
    expect(saved!.email).toBe(student.email);
    expect(saved!.mobile).toBe(student.mobile);
    expect(saved!.studentId).toBe(studentId);
    expect(saved!.role).toBe('student');
    expect(saved!.status).toBe('active');
    expect(saved!.isEmailVerified).toBe(true);
    expect(saved!.tokenVersion).toBe(0);
  });

  it('rejects an invalid class, a future date of birth and a name with digits', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const cookie = cookieHeader(cookies);

    for (const bad of [
      { classLevel: 'Class 13' },
      { dateOfBirth: '2099-01-01' },
      { firstName: 'Robot9000' },
      { address: 'too short' },
      { schoolName: 'X' },
    ]) {
      const res = await request(app).patch(`${API}/me/profile`).set('Cookie', cookie).send(profilePayload(bad));
      expect(res.status, `expected 400 for ${JSON.stringify(bad)}`).toBe(400);
      expect(res.status).not.toBe(500);
    }
  });

  it('refuses an unauthenticated edit', async () => {
    const res = await request(app).patch(`${API}/me/profile`).send(profilePayload());
    expect(res.status).toBe(401);
  });

  it('records an activity entry and an audit entry naming the changed fields but not their values', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const secret = '77 Private Lane, Sensitive Town, 400001';

    await request(app)
      .patch(`${API}/me/profile`)
      .set('Cookie', cookieHeader(cookies))
      .send(profilePayload({ address: secret, schoolName: 'Another School' }))
      .expect(200);

    const account = await Student.findOne({ studentId });
    const activity = await StudentActivity.findOne({ student: account!._id, type: 'profile_updated' });
    expect(activity).not.toBeNull();
    // Editing a profile is recorded but deliberately worth no XP — it is repeatable
    // at will, so paying for it would make XP a measure of clicking Save.
    expect(activity!.xpAwarded).toBe(0);

    const audit = await AuditLog.findOne({ action: 'student.profile.updated', targetId: studentId });
    expect(audit).not.toBeNull();
    expect(audit!.actorLabel).toBe(studentId);
    expect(audit!.metadata!.fields).toEqual(expect.arrayContaining(['address', 'schoolName']));
    // The trail is readable by any admin, so it names fields, never their contents.
    expect(JSON.stringify(audit!.metadata)).not.toContain('Private Lane');
  });
});

// ===========================================================================
// Replacing your photo
// ===========================================================================

describe('PUT /me/photo', () => {
  it('replaces the stored image rather than adding a second one', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    const account = await Student.findOne({ studentId });

    const original = await StudentPhoto.findOne({ student: account!._id });
    expect(original!.contentType).toBe('image/jpeg');

    await request(app).put(`${API}/me/photo`).set('Cookie', cookieHeader(cookies)).send({ photo: validPngPhoto }).expect(200);

    expect(await StudentPhoto.countDocuments({ student: account!._id })).toBe(1);
    const replaced = await StudentPhoto.findOne({ student: account!._id });
    expect(replaced!.contentType).toBe('image/png');
    expect(replaced!.data.equals(Buffer.from(TINY_PNG_BASE64, 'base64'))).toBe(true);
    expect(replaced!.data.equals(Buffer.from(TINY_JPEG_BASE64, 'base64'))).toBe(false);
    expect(replaced!.size).toBe(Buffer.from(TINY_PNG_BASE64, 'base64').length);
  });

  it('serves the replacement through the existing photo endpoint', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    await request(app).put(`${API}/me/photo`).set('Cookie', cookieHeader(cookies)).send({ photo: validPngPhoto }).expect(200);

    const res = await request(app).get(`${API}/students/${studentId}/photo`).set('Cookie', cookieHeader(cookies)).expect(200);

    expect(res.headers['content-type']).toContain('image/png');
  });

  it('rejects a file whose bytes are not the image type it claims', async () => {
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app)
      .put(`${API}/me/photo`)
      .set('Cookie', cookieHeader(cookies))
      // Declares PNG, but the payload is plain text.
      .send({ photo: `data:image/png;base64,${Buffer.from('not an image at all').toString('base64')}` });

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });

  it('rejects a non-image content type', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app)
      .put(`${API}/me/photo`)
      .set('Cookie', cookieHeader(cookies))
      .send({ photo: `data:application/pdf;base64,${TINY_JPEG_BASE64}` });

    expect(res.status).toBe(400);
  });

  it('rejects an image over the 2 MB ceiling', async () => {
    const { cookies } = await registerVerifyLogin(app);
    // A real JPEG signature followed by enough padding to exceed the limit.
    const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024 + 10)]);

    const res = await request(app)
      .put(`${API}/me/photo`)
      .set('Cookie', cookieHeader(cookies))
      .send({ photo: `data:image/jpeg;base64,${oversized.toString('base64')}` });

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });

  it('refuses an unauthenticated upload', async () => {
    const res = await request(app).put(`${API}/me/photo`).send({ photo: validPhoto });
    expect(res.status).toBe(401);
  });

  it('records the replacement in the activity feed and the audit trail', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    await request(app).put(`${API}/me/photo`).set('Cookie', cookieHeader(cookies)).send({ photo: validPngPhoto }).expect(200);

    const account = await Student.findOne({ studentId });
    expect(await StudentActivity.countDocuments({ student: account!._id, type: 'photo_updated' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'student.photo.updated', targetId: studentId })).toBe(1);
  });
});

// ===========================================================================
// Changing your password
// ===========================================================================

describe('POST /me/change-password', () => {
  const currentPassword = 'CorrectHorse9';
  const newPassword = 'BrandNewSecret7';

  it('changes the password, so the old one stops working and the new one starts', async () => {
    const { cookies, student } = await registerVerifyLogin(app);

    await request(app)
      .post(`${API}/me/change-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({ currentPassword, newPassword })
      .expect(200);

    const withOld = await request(app).post(`${API}/auth/login`).send({ identifier: student.email, password: currentPassword });
    expect(withOld.status).toBe(401);

    const withNew = await request(app).post(`${API}/auth/login`).send({ identifier: student.email, password: newPassword });
    expect(withNew.status).toBe(200);
  });

  it('refuses a wrong current password without changing anything', async () => {
    const { cookies, student } = await registerVerifyLogin(app);

    const res = await request(app)
      .post(`${API}/me/change-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({ currentPassword: 'NotMyPassword1', newPassword });

    expect(res.status).toBe(401);

    // The original password must still work: a failed attempt may not lock the owner
    // out of their own account.
    const login = await request(app).post(`${API}/auth/login`).send({ identifier: student.email, password: currentPassword });
    expect(login.status).toBe(200);
  });

  it('refuses a new password identical to the current one', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app)
      .post(`${API}/me/change-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({ currentPassword, newPassword: currentPassword });

    expect(res.status).toBe(400);
  });

  it('refuses a new password that fails the length policy', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app)
      .post(`${API}/me/change-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({ currentPassword, newPassword: 'short1' });

    expect(res.status).toBe(400);
  });

  it('signs other devices out but keeps the device that made the change signed in', async () => {
    const { cookies, student } = await registerVerifyLogin(app);

    // A second device for the same account.
    const secondLogin = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: student.email, password: currentPassword })
      .expect(200);
    const otherDevice = parseCookies(secondLogin);

    const change = await request(app)
      .post(`${API}/me/change-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({ currentPassword, newPassword })
      .expect(200);

    // The response re-issues this device's cookies, so the caller stays signed in.
    const refreshed = parseCookies(change);
    expect(Object.keys(refreshed).length).toBeGreaterThan(0);
    const stillHere = await request(app).get(`${API}/me/profile`).set('Cookie', cookieHeader(refreshed));
    expect(stillHere.status).toBe(200);

    // The other device's access token predates the tokenVersion bump.
    const evicted = await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(otherDevice));
    expect(evicted.status).toBe(401);
  });

  it('refuses an unauthenticated change', async () => {
    const res = await request(app).post(`${API}/me/change-password`).send({ currentPassword, newPassword });
    expect(res.status).toBe(401);
  });

  it('records the change in the activity feed and the audit trail, without the password', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    await request(app)
      .post(`${API}/me/change-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({ currentPassword, newPassword })
      .expect(200);

    const account = await Student.findOne({ studentId });
    const activity = await StudentActivity.findOne({ student: account!._id, type: 'password_changed' });
    expect(activity).not.toBeNull();
    expect(activity!.xpAwarded).toBe(0);

    const audit = await AuditLog.findOne({ action: 'student.password.changed', targetId: studentId });
    expect(audit).not.toBeNull();
    const serialised = JSON.stringify(audit!.toObject());
    expect(serialised).not.toContain(newPassword);
    expect(serialised).not.toContain(currentPassword);
  });

  it('tells the root admin its password is not managed here', async () => {
    const cookies = await loginRootAdmin(app);
    const res = await request(app)
      .post(`${API}/me/change-password`)
      .set('Cookie', cookieHeader(cookies))
      .send({ currentPassword: 'RootAdminPass9', newPassword });

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
  });
});
