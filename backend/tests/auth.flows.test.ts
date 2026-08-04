import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { Student } from '../src/models';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  validStudent,
  tokenFromLatestEmail,
  clearTestInbox,
  parseCookies,
  cookieHeader,
} from './helpers/auth';

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/**
 * The primary flow the milestone specified:
 * register → verify → login → protected route → refresh → logout.
 * Run against a real MongoDB, with the real emailed token.
 */
describe('register → verify → login → protected route → refresh → logout', () => {
  it('completes the whole journey', async () => {
    // --- Register -----------------------------------------------------------
    const registered = await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    expect(registered.body.success).toBe(true);
    expect(registered.body.student.email).toBe(validStudent.email);
    expect(registered.body.student.isEmailVerified).toBe(false);
    // Registration must NOT hand out a session before the address is verified.
    expect(parseCookies(registered).access_token).toBeUndefined();

    // --- Login is refused while unverified ---------------------------------
    const premature = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(403);
    expect(premature.body.code).toBe('EMAIL_NOT_VERIFIED');

    // --- Verify, using the token from the real email ----------------------
    const verifyToken = tokenFromLatestEmail('Verify');
    const verified = await request(app).post(`${API}/auth/verify-email`).send({ token: verifyToken }).expect(200);
    expect(verified.body.student.isEmailVerified).toBe(true);

    // --- Login -------------------------------------------------------------
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);

    const cookies = parseCookies(login);
    expect(cookies.access_token).toBeTruthy();
    expect(cookies.refresh_token).toBeTruthy();

    // --- Current-user endpoint --------------------------------------------
    const me = await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(me.body.role).toBe('student');
    expect(me.body.student.email).toBe(validStudent.email);

    // --- A protected route accepts the session ----------------------------
    const studentId = login.body.student.studentId;
    await request(app).get(`${API}/analytics/${studentId}`).set('Cookie', cookieHeader(cookies)).expect(200);

    // ...and rejects a request with no session.
    await request(app).get(`${API}/analytics/${studentId}`).expect(401);

    // --- Refresh rotates the refresh token --------------------------------
    const refreshed = await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(cookies)).expect(200);
    const rotated = parseCookies(refreshed);
    expect(rotated.refresh_token).toBeTruthy();
    expect(rotated.refresh_token).not.toBe(cookies.refresh_token);

    // The newly issued access token still works on a protected route.
    await request(app)
      .get(`${API}/analytics/${studentId}`)
      .set('Cookie', cookieHeader({ ...cookies, ...rotated }))
      .expect(200);

    // --- Logout ------------------------------------------------------------
    const loggedOut = await request(app)
      .post(`${API}/auth/logout`)
      .set('Cookie', cookieHeader({ ...cookies, ...rotated }))
      .expect(200);
    expect(loggedOut.body.success).toBe(true);

    // The revoked refresh token can no longer buy a new session.
    await request(app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', cookieHeader({ refresh_token: rotated.refresh_token! }))
      .expect(401);
  });

  it('lets a student log in with their mobile number as well as their email', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    await request(app).post(`${API}/auth/verify-email`).send({ token: tokenFromLatestEmail('Verify') }).expect(200);

    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.mobile, password: validStudent.password })
      .expect(200);
  });

  it('never stores the password in plaintext and never returns the hash', async () => {
    const res = await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    expect(JSON.stringify(res.body)).not.toContain(validStudent.password);
    expect(res.body.student.passwordHash).toBeUndefined();

    // Read the raw document, explicitly opting into the hidden field.
    const stored = await Student.findOne({ email: validStudent.email }).select('+passwordHash');
    expect(stored!.passwordHash).not.toBe(validStudent.password);
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$/); // a bcrypt hash
  });
});

/**
 * The second flow the milestone specified:
 * forgot password → reset password → login with the new password.
 */
describe('forgot password → reset password → login with the new password', () => {
  const newPassword = 'BrandNewPass7';

  it('completes the whole journey and invalidates the old password', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    await request(app).post(`${API}/auth/verify-email`).send({ token: tokenFromLatestEmail('Verify') }).expect(200);

    // Sign in first so we can prove the reset kills existing sessions.
    const firstLogin = await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
    const oldCookies = parseCookies(firstLogin);

    // --- Forgot password --------------------------------------------------
    const forgot = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: validStudent.email })
      .expect(200);
    expect(forgot.body.success).toBe(true);

    // --- Reset password ---------------------------------------------------
    const resetToken = tokenFromLatestEmail('Reset');
    await request(app).post(`${API}/auth/reset-password`).send({ token: resetToken, password: newPassword }).expect(200);

    // --- The old password no longer works --------------------------------
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(401);

    // --- The new password works ------------------------------------------
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: newPassword })
      .expect(200);

    // --- Sessions issued before the reset are revoked --------------------
    await request(app).post(`${API}/auth/refresh`).set('Cookie', cookieHeader(oldCookies)).expect(401);
    // The pre-reset access token is rejected because its tokenVersion is stale.
    await request(app).get(`${API}/auth/me`).set('Cookie', cookieHeader(oldCookies)).expect(401);
  });

  it('answers identically for a known and an unknown address (no account enumeration)', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    clearTestInbox();

    const known = await request(app).post(`${API}/auth/forgot-password`).send({ email: validStudent.email });
    const unknown = await request(app).post(`${API}/auth/forgot-password`).send({ email: 'nobody@example.com' });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
  });
});
