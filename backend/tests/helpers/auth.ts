import request from 'supertest';
import type { Express } from 'express';
import { getTestInbox, clearTestInbox } from '../../src/lib/email';

export const API = '/api/v1';

export const validStudent = {
  fullName: 'Test Student',
  mobile: '9876543210',
  email: 'student@example.com',
  password: 'CorrectHorse9',
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
): Promise<{ cookies: Record<string, string>; student: typeof validStudent }> {
  const student = { ...validStudent, ...overrides };

  await request(app).post(`${API}/auth/register`).send(student).expect(201);

  const token = tokenFromLatestEmail('Verify');
  await request(app).post(`${API}/auth/verify-email`).send({ token }).expect(200);

  const login = await request(app)
    .post(`${API}/auth/login`)
    .send({ identifier: student.email, password: student.password })
    .expect(200);

  return { cookies: parseCookies(login), student };
}
