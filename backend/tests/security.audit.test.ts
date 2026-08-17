import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { isAllowedRequestOrigin } from '../src/middleware/csrf';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { publishAndIssue, seedExam, seedSubmittedAttempt } from './helpers/exams';
import {
  API,
  clearTestInbox,
  cookieHeader,
  createAdminSession,
  loginRootAdmin,
  otherStudent,
  registerVerifyLogin,
} from './helpers/auth';

/**
 * The boundaries the security audit (2026-08-17) either closed or wanted pinned.
 *
 * Kept in its own file rather than scattered through the feature suites on purpose: a
 * property like "a cross-site request cannot change state" is not a fact about
 * payments or about notifications, it is a fact about the whole API, and it should
 * fail in one obvious place when somebody removes the middleware that provides it.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** The one origin the test environment allows (no `FRONTEND_URL` is set under test). */
const ALLOWED_ORIGIN = 'http://localhost:5173';
const EVIL_ORIGIN = 'https://evil.example.com';

// ===========================================================================
// CSRF — the gap this audit closed
// ===========================================================================

describe('cross-site request forgery', () => {
  /**
   * The shape the whole defence is about.
   *
   * `POST /auth/logout-all` needs **no body**, so the two incidental defences
   * SECURITY.md relied on do not apply to it: a cross-site form post is not
   * preflighted, and there is no JSON for `express.json()` to refuse. Before the
   * audit this succeeded with a stolen ambient cookie.
   */
  it('refuses a state-changing request carrying a session cookie from another origin', async () => {
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app)
      .post(`${API}/auth/logout-all`)
      .set('Cookie', cookieHeader(cookies))
      .set('Origin', EVIL_ORIGIN);

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
  });

  it('allows the same request from the front end’s own origin', async () => {
    const { cookies } = await registerVerifyLogin(app);

    await request(app)
      .post(`${API}/auth/logout-all`)
      .set('Cookie', cookieHeader(cookies))
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);
  });

  /**
   * The gate is mounted once for the whole API rather than per route, so it must hold
   * on the unversioned alias too — a check that held on only one prefix would be
   * bypassed by using the other, which is the rule every other gate here follows.
   */
  it('holds on the unversioned /api alias as well as /api/v1', async () => {
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app)
      .post('/api/auth/logout-all')
      .set('Cookie', cookieHeader(cookies))
      .set('Origin', EVIL_ORIGIN);

    expect(res.status).toBe(403);
  });

  it('refuses a forged payment order, which is the state change money hangs off', async () => {
    const { cookies } = await registerVerifyLogin(app, {}, { paid: false });

    const res = await request(app)
      .post(`${API}/payments/orders`)
      .set('Cookie', cookieHeader(cookies))
      .set('Origin', EVIL_ORIGIN);

    expect(res.status).toBe(403);
  });

  it('refuses a forged administrative action', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const rootCookies = await loginRootAdmin(app);

    const res = await request(app)
      .patch(`${API}/admin/users/${studentId}/role`)
      .set('Cookie', cookieHeader(rootCookies))
      .set('Origin', EVIL_ORIGIN)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
    expect(res.body.error).not.toMatch(/permission/i);
  });

  /**
   * `Origin: null` is what a sandboxed iframe and a `data:` document send. It is not a
   * URL, resolves to no host, and must not be treated as "no origin".
   */
  it('refuses an opaque origin rather than treating it as absent', async () => {
    const { cookies } = await registerVerifyLogin(app);

    const res = await request(app)
      .post(`${API}/auth/logout-all`)
      .set('Cookie', cookieHeader(cookies))
      .set('Origin', 'null');

    expect(res.status).toBe(403);
  });

  /**
   * A page can suppress `Referer` with a referrer policy but cannot suppress `Origin`,
   * so `Referer` is only consulted when `Origin` is absent — and when it is, a
   * disallowed one is still refused.
   */
  it('falls back to Referer when Origin is absent', async () => {
    const { cookies } = await registerVerifyLogin(app);

    const refused = await request(app)
      .post(`${API}/auth/logout-all`)
      .set('Cookie', cookieHeader(cookies))
      .set('Referer', `${EVIL_ORIGIN}/attack.html`);
    expect(refused.status).toBe(403);

    const allowed = await request(app)
      .post(`${API}/auth/logout-all`)
      .set('Cookie', cookieHeader(cookies))
      .set('Referer', `${ALLOWED_ORIGIN}/profile`);
    expect(allowed.status).toBe(200);
  });

  /**
   * Reads are deliberately not policed: a cross-origin read is already governed by
   * CORS, which decides whether the response may be *seen*, and refusing GETs here
   * would break nothing an attacker relies on while breaking ordinary clients.
   */
  it('does not police GET, which cannot be a forgery of a state change', async () => {
    await request(app).get(`${API}/public/stats`).set('Origin', EVIL_ORIGIN).expect(200);
  });

  /**
   * A request with neither header is not browser-issued and therefore cannot be a
   * forgery. Refusing it would break every API client — including Razorpay's webhook,
   * which is authenticated by an HMAC over its raw body instead.
   */
  it('allows a non-browser client that sends no origin at all', async () => {
    const { cookies } = await registerVerifyLogin(app);
    await request(app).post(`${API}/auth/logout-all`).set('Cookie', cookieHeader(cookies)).expect(200);
  });

  it('treats the request’s own host as same-origin, so a single-domain deployment works unconfigured', () => {
    expect(isAllowedRequestOrigin('https://api.example.com', 'api.example.com')).toBe(true);
    expect(isAllowedRequestOrigin('https://evil.example.com', 'api.example.com')).toBe(false);
    expect(isAllowedRequestOrigin(undefined, 'api.example.com')).toBe(false);
  });
});

// ===========================================================================
// CORS allow-list
// ===========================================================================

describe('the CORS allow-list', () => {
  /**
   * `http://localhost:5173` used to be in the list unconditionally, including in
   * production, which let any page a visitor happened to be serving on that port make
   * credentialed cross-origin reads of live student data — and made `localhost:5173` a
   * permanently "allowed" origin for the CSRF check above.
   *
   * Asserted against the config rather than a copy of the rule, so it fails if the
   * derivation changes rather than if a literal is edited.
   */
  it('admits localhost only outside production', () => {
    const hasLocalhost = config.cors.origins.includes('http://localhost:5173');
    expect(hasLocalhost).toBe(!config.isProd);
  });

  it('never reflects an arbitrary origin', () => {
    for (const origin of config.cors.origins) {
      expect(origin).toMatch(/^https?:\/\//);
    }
    expect(config.cors.origins).not.toContain('*');
  });
});

// ===========================================================================
// Public exposure of children's names
// ===========================================================================

describe('the unauthenticated lookups do not publish a child’s full name', () => {
  /**
   * A surname nothing else in a response could contain by accident, so
   * "the surname is absent" is a real assertion rather than a lucky one.
   */
  const SURNAME = 'Chandrasekaran';

  /** A published official result for one student, through the real publication path. */
  async function publishedResultFor(): Promise<string> {
    const { studentId } = await registerVerifyLogin(app, { firstName: 'Ishaan', lastName: SURNAME });
    const { cookies } = await createAdminSession(app, otherStudent);
    const { exam } = await seedExam(app, cookies, { questionCount: 2, marksEach: 10 });
    await seedSubmittedAttempt(exam, studentId, 2);
    await publishAndIssue(exam);
    return studentId;
  }

  /**
   * `AMIT_0000`–`AMIT_9999` is ten thousand identifiers, so these two routes can be
   * walked. They therefore publish exactly what the leaderboard publishes — a first
   * name and a last initial — rather than the full legal name they used to return
   * beside a score and a national rank.
   */
  it('masks the name on a published result', async () => {
    const studentId = await publishedResultFor();

    const res = await request(app).get(`${API}/results/${studentId}`).expect(200);

    expect(res.body.result.studentName).toBe('Ishaan C.');
    // The surname is what identifies a minor beside a school, a class and a rank.
    expect(JSON.stringify(res.body)).not.toContain(SURNAME);
  });

  it('masks the name on a public certificate listing', async () => {
    const studentId = await publishedResultFor();

    const res = await request(app).get(`${API}/certificates/${studentId}`).expect(200);

    expect(res.body.certificates).toHaveLength(1);
    expect(res.body.certificates[0].studentName).toBe('Ishaan C.');
    expect(JSON.stringify(res.body)).not.toContain(SURNAME);
  });

  /**
   * The public listing must not carry the verification code. The readable serial is
   * guessable by design; the code is what public verification keys on, and handing it
   * out here would collapse the two identifiers into one.
   */
  it('never returns a verification code from the public certificate listing', async () => {
    const studentId = await publishedResultFor();

    const res = await request(app).get(`${API}/certificates/${studentId}`).expect(200);

    expect(JSON.stringify(res.body)).not.toContain('verificationCode');
  });

  /**
   * The student's **own** certificate is unchanged: they are looking at the document
   * in their hand, and it carries their full name and its verification code.
   */
  it('still gives the holder their own full name and code', async () => {
    const { studentId, cookies } = await registerVerifyLogin(app, { firstName: 'Ishaan', lastName: SURNAME });
    const { cookies: adminCookies } = await createAdminSession(app, otherStudent);
    const { exam } = await seedExam(app, adminCookies, { questionCount: 2, marksEach: 10 });
    await seedSubmittedAttempt(exam, studentId, 2);
    await publishAndIssue(exam);

    const res = await request(app)
      .get(`${API}/me/certificates`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.certificates).toHaveLength(1);
    expect(res.body.certificates[0].studentName).toContain(SURNAME);
    expect(res.body.certificates[0].verificationCode).toBeTruthy();
  });
});
