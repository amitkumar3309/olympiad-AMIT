import request from 'supertest';
import type { Express } from 'express';
import { getTestInbox, clearTestInbox } from '../../src/lib/email';

export const API = '/api/v1';

/**
 * The smallest real JPEG that passes validation: a 1x1 pixel image. Used instead
 * of a fabricated string because registration checks the file's magic bytes, not
 * just the MIME type it claims (see `validation/authSchemas.ts`).
 */
export const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

export const validPhoto = `data:image/jpeg;base64,${TINY_JPEG_BASE64}`;

/**
 * A second, byte-wise different image, used to prove a photo was actually replaced
 * rather than merely re-accepted. It is a 1x1 PNG; the leading bytes are the real
 * PNG signature, which is the part validation checks (see `validation/authSchemas.ts`
 * — the file is never decoded as an image, only its header and size are examined).
 */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export const validPngPhoto = `data:image/png;base64,${TINY_PNG_BASE64}`;

/**
 * Every field registration requires as of Milestone 4. Kept as one fixture so a
 * future change to the required set is a single edit here rather than in every
 * suite that needs an account.
 */
export const validStudent = {
  firstName: 'Test',
  middleName: 'Kumar',
  lastName: 'Student',
  fatherName: 'Father Student',
  motherName: 'Mother Student',
  dateOfBirth: '2010-04-15',
  classLevel: 'Class 9',
  schoolName: 'Springfield Public School',
  address: '12 Example Road, Example City, 110001',
  mobile: '9876543210',
  email: 'student@example.com',
  password: 'CorrectHorse9',
  photo: validPhoto,
};

/** A second, distinct account — for tests that need two students. */
export const otherStudent = {
  ...validStudent,
  firstName: 'Other',
  lastName: 'Student',
  mobile: '9123456780',
  email: 'other@example.com',
  password: 'DifferentHorse8',
};

/** Matches the values `tests/setup.ts` puts into the environment. */
export const rootAdmin = {
  email: 'root-admin@amit.test',
  password: 'RootAdminPass9',
};

/** Extracts the `token=` value from the most recent email of a given kind. */
export function tokenFromLatestEmail(match: 'Verify' | 'Reset'): string {
  const inbox = getTestInbox();
  const email = [...inbox].reverse().find((m) => m.subject.includes(match));
  if (!email) throw new Error(`No email containing "${match}" was sent. Inbox: ${inbox.map((m) => m.subject).join(', ')}`);
  const found = /token=([A-Za-z0-9%._-]+)/.exec(email.text);
  if (!found?.[1]) throw new Error(`No token found in email body: ${email.text}`);
  return decodeURIComponent(found[1]);
}

export { clearTestInbox };

/** Reads Set-Cookie into a name -> value map. */
export function parseCookies(res: request.Response): Record<string, string> {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Record<string, string> = {};
  for (const cookie of list) {
    const [pair] = cookie.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (pair && eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter(([, v]) => v && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** Registers, verifies, and logs in — returns the session cookies. */
export async function registerVerifyLogin(
  app: Express,
  overrides: Partial<typeof validStudent> = {},
): Promise<{ cookies: Record<string, string>; student: typeof validStudent; studentId: string }> {
  const student = { ...validStudent, ...overrides };

  const registration = await request(app).post(`${API}/auth/register`).send(student).expect(201);

  const token = tokenFromLatestEmail('Verify');
  await request(app).post(`${API}/auth/verify-email`).send({ token }).expect(200);

  const login = await request(app)
    .post(`${API}/auth/login`)
    .send({ identifier: student.email, password: student.password })
    .expect(200);

  return { cookies: parseCookies(login), student, studentId: registration.body.student.studentId };
}

/** Signs in as the environment-configured root administrator (`superadmin`). */
export async function loginRootAdmin(app: Express): Promise<Record<string, string>> {
  const res = await request(app).post(`${API}/auth/admin/login`).send(rootAdmin).expect(200);
  return parseCookies(res);
}

/**
 * Produces a signed-in administrator: registers a student, has the root admin
 * promote it, then signs in again so the new session carries the admin role.
 * This is the only way an admin account comes into existence (see DECISIONS.md).
 */
export async function createAdminSession(
  app: Express,
  overrides: Partial<typeof validStudent> = {},
): Promise<{ cookies: Record<string, string>; studentId: string; account: typeof validStudent }> {
  const { studentId, student } = await registerVerifyLogin(app, overrides);
  const rootCookies = await loginRootAdmin(app);

  await request(app)
    .patch(`${API}/admin/users/${studentId}/role`)
    .set('Cookie', cookieHeader(rootCookies))
    .send({ role: 'admin' })
    .expect(200);

  // The promotion revoked the earlier session on purpose, so sign in afresh.
  const login = await request(app)
    .post(`${API}/auth/login`)
    .send({ identifier: student.email, password: student.password })
    .expect(200);

  return { cookies: parseCookies(login), studentId, account: student };
}
