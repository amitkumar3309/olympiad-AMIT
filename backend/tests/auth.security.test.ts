import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { config } from '../src/config';
import { Student, VerificationToken, RefreshToken } from '../src/models';
import { hashToken } from '../src/lib/tokens';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  validStudent,
  tokenFromLatestEmail,
  clearTestInbox,
  parseCookies,
  cookieHeader,
  registerVerifyLogin,
} from './helpers/auth';

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

describe('invalid tokens', () => {
  it('rejects a garbage email-verification token', async () => {
    const res = await request(app).post(`${API}/auth/verify-email`).send({ token: 'not-a-real-token' }).expect(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('rejects a garbage password-reset token', async () => {
    const res = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token: 'not-a-real-token', password: 'Whatever123' })
      .expect(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('rejects a verification token that has already been used', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const token = tokenFromLatestEmail('Verify');

    await request(app).post(`${API}/auth/verify-email`).send({ token }).expect(200);
    const replay = await request(app).post(`${API}/auth/verify-email`).send({ token }).expect(400);
    expect(replay.body.error).toMatch(/already been used/i);
  });

  it('rejects a reset token that has already been used', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    await request(app).post(`${API}/auth/forgot-password`).send({ email: validStudent.email }).expect(200);
    const token = tokenFromLatestEmail('Reset');

    await request(app).post(`${API}/auth/reset-password`).send({ token, password: 'FirstChange1' }).expect(200);
    const replay = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'SecondChange2' })
      .expect(400);
    expect(replay.body.error).toMatch(/already been used/i);
  });

  it('rejects an access token signed with the wrong secret', async () => {
    const forged = jwt.sign({ role: 'student', sub: '507f1f77bcf86cd799439011', tv: 0 }, 'not-the-real-secret');
    await request(app).get(`${API}/auth/me`).set('Cookie', `access_token=${forged}`).expect(401);
  });

  it('rejects a structurally invalid access token', async () => {
    await request(app).get(`${API}/auth/me`).set('Cookie', 'access_token=abc.def.ghi').expect(401);
  });

  it('rejects an unknown refresh token', async () => {
    await request(app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', 'refresh_token=0000000000000000000000000000000000000000000000000000000000000000')
      .expect(401);
  });
});

describe('expired tokens', () => {
  it('rejects an expired access token on the current-user endpoint', async () => {
    const { student } = await registerVerifyLogin(app);
    const record = await Student.findOne({ email: student.email });

    // Signed with a negative lifetime, so it is already past its `exp`.
    const expired = jwt.sign(
      { role: 'student', sub: String(record!._id), studentId: record!.studentId, tv: record!.tokenVersion },
      config.jwtSecret,
      { expiresIn: '-10s' },
    );

    const res = await request(app).get(`${API}/auth/me`).set('Cookie', `access_token=${expired}`).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects an expired access token on a protected route', async () => {
    const expired = jwt.sign({ role: 'student', sub: '507f1f77bcf86cd799439011', tv: 0 }, config.jwtSecret, {
      expiresIn: '-10s',
    });
    await request(app).get(`${API}/analytics/AMIT_0001`).set('Cookie', `access_token=${expired}`).expect(401);
  });

  it('rejects an expired email-verification token', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const token = tokenFromLatestEmail('Verify');

    // Backdate the stored record rather than waiting 24 hours.
    await VerificationToken.updateOne({ tokenHash: hashToken(token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).post(`${API}/auth/verify-email`).send({ token }).expect(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('rejects an expired password-reset token', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    await request(app).post(`${API}/auth/forgot-password`).send({ email: validStudent.email }).expect(200);
    const token = tokenFromLatestEmail('Reset');

    await VerificationToken.updateOne({ tokenHash: hashToken(token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).post(`${API}/auth/reset-password`).send({ token, password: 'NewPass123' }).expect(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('rejects an expired refresh token', async () => {
    const { cookies } = await registerVerifyLogin(app);

    await RefreshToken.updateOne(
      { tokenHash: hashToken(cookies.refresh_token!) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(401);
  });
});

describe('refresh token rotation and theft detection', () => {
  it('kills the whole token family when a rotated token is replayed', async () => {
    const { cookies } = await registerVerifyLogin(app);

    // Rotate once — the original token is now spent.
    const first = await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(200);
    const rotated = parseCookies(first);

    // Replaying the spent token signals theft: the family is revoked.
    const replay = await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(401);
    expect(replay.body.error).toMatch(/security/i);

    // ...which means even the legitimately rotated token stops working.
    await request(app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', cookieHeader({ refresh_token: rotated.refresh_token! }))
      .expect(401);
  });

  it('stores refresh tokens only as hashes, never in plaintext', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const raw = cookies.refresh_token!;

    expect(await RefreshToken.findOne({ tokenHash: raw })).toBeNull();
    expect(await RefreshToken.findOne({ tokenHash: hashToken(raw) })).not.toBeNull();
  });

  it('stores verification tokens only as hashes, never in plaintext', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const raw = tokenFromLatestEmail('Verify');

    expect(await VerificationToken.findOne({ tokenHash: raw })).toBeNull();
    expect(await VerificationToken.findOne({ tokenHash: hashToken(raw) })).not.toBeNull();
  });
});

describe('session revocation', () => {
  it('logout-all revokes every session, including other devices', async () => {
    const { cookies, student } = await registerVerifyLogin(app);

    // A second, independent login stands in for another device.
    const other = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: student.email, password: student.password })
      .expect(200);
    const otherCookies = parseCookies(other);

    await request(app).post(`${API}/auth/logout-all`).set('Cookie', cookieHeader(cookies)).expect(200);

    // Neither device can refresh, and neither access token is accepted.
    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(401);
    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(otherCookies)).expect(401);
    await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(otherCookies)).expect(401);
  });

  it('a plain logout leaves other devices signed in', async () => {
    const { cookies, student } = await registerVerifyLogin(app);
    const other = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: student.email, password: student.password })
      .expect(200);
    const otherCookies = parseCookies(other);

    await request(app).post(`${API}/auth/logout`).set('Cookie', cookieHeader(cookies)).expect(200);

    // The logged-out device is done, the other one carries on.
    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(401);
    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(otherCookies)).expect(200);
  });
});

describe('account status handling', () => {
  it('refuses login for a suspended account', async () => {
    await registerVerifyLogin(app);
    await Student.updateOne({ email: validStudent.email }, { $set: { status: 'suspended' } });

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(403);
    expect(res.body.error).toMatch(/suspended/i);
  });

  it('refuses login for a deactivated account', async () => {
    await registerVerifyLogin(app);
    await Student.updateOne({ email: validStudent.email }, { $set: { status: 'deactivated' } });

    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(403);
  });

  it('stops honouring an existing session once the account is suspended', async () => {
    const { cookies } = await registerVerifyLogin(app);
    await Student.updateOne({ email: validStudent.email }, { $set: { status: 'suspended' } });

    await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(cookies)).expect(403);
    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(401);
  });

  it('locks an account after repeated failed logins, then unlocks it when the window passes', async () => {
    await registerVerifyLogin(app);

    for (let i = 0; i < config.auth.maxFailedLogins; i += 1) {
      await request(app)
        .post(`${API}/auth/login`)
        .send({ identifier: validStudent.email, password: 'WrongPassword1' })
        .expect(401);
    }

    // Even the correct password is refused while locked.
    const locked = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(423);
    expect(locked.body.error).toMatch(/locked/i);

    // Expire the lock rather than waiting for the real window.
    await Student.updateOne({ email: validStudent.email }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });

    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
  });
});

describe('registration validation and conflicts', () => {
  it('rejects a weak password', async () => {
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, password: 'short' })
      .expect(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('rejects a password with no digit', async () => {
    await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, password: 'allletters' })
      .expect(400);
  });

  it('rejects a malformed email address', async () => {
    await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, email: 'not-an-email' })
      .expect(400);
  });

  it('rejects a duplicate email and a duplicate mobile distinctly', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const dupeEmail = await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, mobile: '9000000001' })
      .expect(409);
    expect(dupeEmail.body.error).toMatch(/email/i);

    const dupeMobile = await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, email: 'other@example.com' })
      .expect(409);
    expect(dupeMobile.body.error).toMatch(/mobile/i);
  });

  it('gives every student a distinct studentId', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, email: 'second@example.com', mobile: '9000000002' })
      .expect(201);

    const ids = (await Student.find({}).select('studentId')).map((s) => s.studentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses one message for unknown accounts and wrong passwords', async () => {
    await registerVerifyLogin(app);

    const wrongPassword = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: 'WrongPassword1' })
      .expect(401);
    const unknownAccount = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: 'nobody@example.com', password: 'WrongPassword1' })
      .expect(401);

    expect(wrongPassword.body.error).toBe(unknownAccount.body.error);
  });
});
