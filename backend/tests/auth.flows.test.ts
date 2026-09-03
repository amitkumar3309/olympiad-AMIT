import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { Student, VerificationToken } from '../src/models';
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
import { getTestInbox } from '../src/lib/email';

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
  const newPassword = 'BrandNewPass7!';

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

/**
 * A spent verification token, and the two opposite things it can mean.
 *
 * Reported from production: "This verification link has already been used. Try signing
 * in." on a fresh link, *and* the student could not sign in. Those two facts together
 * are the whole bug — a link that had done its job would leave an account that can sign
 * in, so the token had been burned without the account being verified.
 *
 * Both halves are pinned here, because fixing one without the other just moves the dead
 * end.
 */
/**
 * Ages the outstanding verification link so the five-minute resend cooldown has passed.
 *
 * The cooldown is measured from the age of the live token rather than from a counter, so
 * moving that row back in time is exactly equivalent to waiting — and it keeps these
 * tests instant. Nothing here fakes a clock: the row really is old.
 */
async function ageOutstandingLink(minutes = 6): Promise<void> {
  await VerificationToken.updateMany(
    { type: 'email_verify', usedAt: null },
    { $set: { createdAt: new Date(Date.now() - minutes * 60 * 1000) } },
  );
}

describe('the resend cooldown', () => {
  it('refuses a second link while the first is still fresh, and keeps that first link working', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const original = tokenFromLatestEmail('Verify');
    const before = getTestInbox().length;

    // Straight away, which is what an impatient student does.
    const res = await request(app)
      .post(`${API}/auth/resend-verification`)
      .send({ email: validStudent.email })
      .expect(200);

    // The answer never varies — see the enumeration test below — but nothing was sent.
    expect(res.body.nextResendAt).toBeTruthy();
    expect(getTestInbox().length, 'no second link inside the cooldown').toBe(before);

    // And the link they already have is untouched, which is the point: issuing a new one
    // would have superseded it.
    await request(app).post(`${API}/auth/verify-email`).send({ token: original }).expect(200);
  });

  it('sends a fresh link once the wait has passed', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const original = tokenFromLatestEmail('Verify');
    const before = getTestInbox().length;

    await ageOutstandingLink();

    await request(app).post(`${API}/auth/resend-verification`).send({ email: validStudent.email }).expect(200);

    expect(getTestInbox().length, 'a link must be sent once the cooldown has passed').toBeGreaterThan(before);
    const replacement = tokenFromLatestEmail('Verify');
    expect(replacement).not.toBe(original);

    // The new link works, and the superseded one says so without sending anything more.
    const stale = await request(app).post(`${API}/auth/verify-email`).send({ token: original });
    expect(stale.status).toBe(400);
    expect(stale.body.error).toMatch(/out of date|most recent/i);
    await request(app).post(`${API}/auth/verify-email`).send({ token: replacement }).expect(200);
  });

  it('answers identically for an address that is not registered', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    clearTestInbox();

    const known = await request(app)
      .post(`${API}/auth/resend-verification`)
      .send({ email: validStudent.email })
      .expect(200);
    const unknown = await request(app)
      .post(`${API}/auth/resend-verification`)
      .send({ email: 'nobody.at.all@example.com' })
      .expect(200);

    /**
     * The whole point of the generic answer: this endpoint must not become a way to test
     * which addresses are registered. A *truthful* remaining time would leak exactly
     * that — an unknown address would always report a full five minutes while a real one
     * counted down — so the deadline is always "five minutes from now" and the real window
     * is enforced against the token instead.
     */
    expect(unknown.body.message).toBe(known.body.message);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort());
    expect(getTestInbox().filter((mail) => mail.to === 'nobody.at.all@example.com')).toHaveLength(0);
  });
});

describe('a spent verification link', () => {
  it('reports success when the link already did its job', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const token = tokenFromLatestEmail('Verify');

    await request(app).post(`${API}/auth/verify-email`).send({ token }).expect(200);

    // The same link again: a double submit, a mail scanner following links, a retry
    // after a cold start, or somebody clicking twice. The account is verified, so the
    // honest answer is success — not a dead end telling them to try something else.
    const second = await request(app).post(`${API}/auth/verify-email`).send({ token });

    expect(second.status).toBe(200);
    expect(second.status).not.toBe(400);
    expect(second.body.alreadyVerified).toBe(true);

    // And the claim is true: they really can sign in.
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
  });

  it('never leaves a link spent when the verification itself failed', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const token = tokenFromLatestEmail('Verify');

    // Make the account update throw, the way a transient database error, a cold-start
    // timeout or a dropped connection would. Before the fix this burned the token: the
    // student saw "already been used" for ever, and could not sign in either, because
    // login requires a verified address.
    const save = Student.prototype.save;
    Student.prototype.save = function failing() {
      return Promise.reject(new Error('Simulated write failure'));
    } as typeof save;

    let failed: request.Response;
    try {
      failed = await request(app).post(`${API}/auth/verify-email`).send({ token });
    } finally {
      Student.prototype.save = save;
    }

    expect(failed.status).toBe(500);
    expect(await Student.findOne({ email: validStudent.email }).then((s) => s!.isEmailVerified)).toBe(false);

    // The link must still work. This is the assertion the whole fix exists for.
    const retry = await request(app).post(`${API}/auth/verify-email`).send({ token });
    expect(retry.status, 'the link must survive a failed attempt').toBe(200);
    expect(retry.status).not.toBe(400);

    expect(await Student.findOne({ email: validStudent.email }).then((s) => s!.isEmailVerified)).toBe(true);
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
  });

  /**
   * **The loop that broke registration in production.**
   *
   * This test previously asserted the opposite: that a stale link *should* trigger a
   * fresh email. That premise was the defect. Issuing a token invalidates the
   * outstanding one, so mailing a replacement on every stale click destroyed the very
   * link the error message told the reader to open, and their next click destroyed its
   * replacement. Two real registrations burned 24 tokens between them and neither
   * account could ever be verified — see TROUBLESHOOTING.md.
   *
   * The rule now: **never destroy a live link to send a message.** If a working link is
   * already in the inbox, say so and send nothing.
   */
  it('does not destroy the live link when an older one is clicked', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const stale = tokenFromLatestEmail('Verify');

    // Asking for a new link invalidates every earlier one, by design — so this is the
    // "somebody opened the older of two emails" case, which is one of several ways a
    // student legitimately arrives holding a superseded token. The cooldown has to have
    // passed for a second link to be sent at all, which is what `ageOutstandingLink`
    // stands in for.
    await ageOutstandingLink();
    await request(app).post(`${API}/auth/resend-verification`).send({ email: validStudent.email }).expect(200);
    const live = tokenFromLatestEmail('Verify');
    expect(live).not.toBe(stale);

    const before = getTestInbox().length;
    const res = await request(app).post(`${API}/auth/verify-email`).send({ token: stale });

    expect(res.status).toBe(400);
    // Not "try signing in": that account cannot sign in, and pointing somebody at a
    // door that will not open is the failure this replaces.
    expect(res.body.error).not.toMatch(/try signing in/i);
    // And not "we have emailed you a new one", because we deliberately have not.
    expect(res.body.error).not.toMatch(/emailed you a new one/i);
    expect(res.body.error).toMatch(/out of date|most recent/i);

    expect(getTestInbox().length, 'a stale click must not send another link').toBe(before);

    // The link that was already in the inbox still works. This is the assertion the
    // whole fix exists for: before it, this request returned 400 as well.
    const good = await request(app).post(`${API}/auth/verify-email`).send({ token: live });
    expect(good.status, 'the newest link must survive a stale click').toBe(200);
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
  });

  /**
   * Two requests for one click: a page that fires twice, an impatient double click, a
   * mail scanner that follows links. One consumes the token; the other must not conclude
   * the link was wasted and mail a replacement — which is how the loop above started.
   */
  it('absorbs two redemptions of one link without mailing anybody', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const token = tokenFromLatestEmail('Verify');
    const before = getTestInbox().length;

    const [first, second] = await Promise.all([
      request(app).post(`${API}/auth/verify-email`).send({ token }),
      request(app).post(`${API}/auth/verify-email`).send({ token }),
    ]);

    // Both are honest: one did the work, the other found it already done.
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(getTestInbox().length, 'a duplicate request must not send another link').toBe(before);

    expect(await Student.findOne({ email: validStudent.email }).then((s) => s!.isEmailVerified)).toBe(true);
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
  });

  /**
   * The belt-and-braces resend is still there for the case it was written for: a token
   * that really was burned without doing its job, with nothing live left to destroy.
   */
  it('still emails a fresh link when the account has no working link at all', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const token = tokenFromLatestEmail('Verify');

    // Marked used *without* `supersededAt`, which is what a redemption that died
    // mid-flight leaves behind — the one state where there is a genuine dead end and
    // no live link in the inbox. With nothing live, there is also no cooldown to wait
    // out: the wait is measured from the link in the inbox, and there isn't one.
    await VerificationToken.updateOne({ type: 'email_verify' }, { $set: { usedAt: new Date() } });

    const before = getTestInbox().length;
    const res = await request(app).post(`${API}/auth/verify-email`).send({ token });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/emailed you a new one/i);
    const inbox = getTestInbox();
    expect(inbox.length, 'a real dead end must be repaired with a fresh link').toBeGreaterThan(before);
    expect(inbox[inbox.length - 1]!.to).toBe(validStudent.email);

    // And that fresh link works.
    await request(app).post(`${API}/auth/verify-email`).send({ token: tokenFromLatestEmail('Verify') }).expect(200);
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: validStudent.password })
      .expect(200);
  });

  it('does not re-send once the account is verified, so a replay cannot pump out email', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const token = tokenFromLatestEmail('Verify');
    await request(app).post(`${API}/auth/verify-email`).send({ token }).expect(200);

    const before = getTestInbox().length;
    const replay = await request(app).post(`${API}/auth/verify-email`).send({ token }).expect(200);

    expect(replay.body.alreadyVerified).toBe(true);
    // The verified branch returns before the re-send, so a stale link in an inbox — or a
    // mail scanner re-following it — cannot be turned into a mail generator.
    expect(getTestInbox().length, 'a verified account must not trigger more email').toBe(before);
  });

  it('sends nothing for a token that belongs to nobody', async () => {
    const before = getTestInbox().length;

    const res = await request(app)
      .post(`${API}/auth/verify-email`)
      .send({ token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
      .expect(400);

    expect(res.body.error).toMatch(/invalid/i);
    // There is no account to send to, and inventing one would make this endpoint a way
    // to have mail sent to arbitrary addresses.
    expect(getTestInbox().length).toBe(before);
  });

  it('keeps a reset link usable when the reset itself fails', async () => {
    await registerVerifyLogin(app);
    await request(app).post(`${API}/auth/forgot-password`).send({ email: validStudent.email }).expect(200);
    const token = tokenFromLatestEmail('Reset');

    const save = Student.prototype.save;
    Student.prototype.save = function failing() {
      return Promise.reject(new Error('Simulated write failure'));
    } as typeof save;

    let failed: request.Response;
    try {
      failed = await request(app)
        .post(`${API}/auth/reset-password`)
        .send({ token, password: 'BrandNewPass9!' });
    } finally {
      Student.prototype.save = save;
    }

    expect(failed.status).toBe(500);

    // Same property as the verification link: a transient failure must not consume the
    // one thing standing between the student and their account.
    await request(app).post(`${API}/auth/reset-password`).send({ token, password: 'BrandNewPass9!' }).expect(200);
    await request(app)
      .post(`${API}/auth/login`)
      .send({ identifier: validStudent.email, password: 'BrandNewPass9!' })
      .expect(200);
  });
});
