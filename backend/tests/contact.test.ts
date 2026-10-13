import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { ContactMessage, EmailOutbox } from '../src/models';
import { NOTIFY_DAILY_CAP } from '../src/services/contactService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, registerVerifyLogin } from './helpers/auth';

/**
 * The Contact page's form (2026-10-13): stored first, announced to support by email within a
 * daily cap, never emailed to the address a visitor typed, and read and handled at
 * Admin → Messages.
 */
beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

const good = {
  name: 'Meera Iyer',
  email: 'Parent@Example.com',
  topic: 'payment',
  message: 'I paid the entry fee yesterday but my dashboard still says unpaid. <script>alert(1)</script>',
};
const send = (body: Record<string, unknown>, cookies?: Record<string, string>) => {
  const req = request(app).post(`${API}/contact`);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  return req.send(body);
};

describe('POST /contact', () => {
  it('stores the message and emails the support address — never the sender', async () => {
    const res = await send(good).expect(201);
    expect(res.body.message).toMatch(/reached us/);

    const saved = await ContactMessage.findOne({});
    expect(saved).toMatchObject({ name: 'Meera Iyer', email: 'parent@example.com', topic: 'payment', status: 'new', emailed: true, student: null });
    expect(saved?.ipHash).toMatch(/^[0-9a-f]{32}$/);

    const mail = await EmailOutbox.find({});
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe(config.support.email);
    expect(mail[0]!.category).toBe('announcement');
    // A stranger's words never reach the subject, and the HTML is escaped.
    expect(mail[0]!.subject).not.toContain('paid');
    expect(mail[0]!.html).not.toContain('<script>');
    expect(mail[0]!.html).toContain('&lt;script&gt;');
    expect(mail[0]!.text).toContain('parent@example.com');
    expect(await EmailOutbox.countDocuments({ to: 'parent@example.com' })).toBe(0);
  });

  it('says what is wrong with each field', async () => {
    const res = await send({ name: 'M', email: 'not-an-email', topic: 'nope', message: 'short' }).expect(400);
    const text = JSON.stringify(res.body);
    expect(text).toMatch(/your name/);
    expect(text).toMatch(/email address we can reply to/);
    expect(text).toMatch(/what your message is about/);
    expect(text).toMatch(/at least 10 characters/);
    expect(await ContactMessage.countDocuments({})).toBe(0);
  });

  it('answers a bot that fills the hidden field like anybody, and keeps nothing', async () => {
    const res = await send({ ...good, website: 'http://spam.example' }).expect(201);
    expect(res.body.message).toMatch(/reached us/);
    expect(await ContactMessage.countDocuments({})).toBe(0);
    expect(await EmailOutbox.countDocuments({})).toBe(0);
  });

  it('notes the account when a signed-in student writes', async () => {
    const { cookies } = await registerVerifyLogin(app);
    await EmailOutbox.deleteMany({});
    await send(good, cookies).expect(201);
    const saved = await ContactMessage.findOne({});
    expect(saved?.student).not.toBeNull();
  });

  it('stops emailing at the daily cap, and still keeps every message', async () => {
    await ContactMessage.insertMany(
      Array.from({ length: NOTIFY_DAILY_CAP }, (_, i) => ({ ...good, email: `p${i}@example.com`, emailed: true })),
    );
    await send(good).expect(201);
    expect(await ContactMessage.countDocuments({})).toBe(NOTIFY_DAILY_CAP + 1);
    expect((await ContactMessage.findOne({ email: 'parent@example.com' }))?.emailed).toBe(false);
    expect(await EmailOutbox.countDocuments({})).toBe(0);
  });
});

describe('Admin → Messages', () => {
  it('is staff only, lists the new ones, and marks one handled', async () => {
    await send(good).expect(201);
    await send({ ...good, email: 'other@example.com', topic: 'other', message: 'A second message about something else.' }).expect(201);

    const { cookies: student } = await registerVerifyLogin(app);
    await request(app).get(`${API}/admin/contact-messages`).set('Cookie', cookieHeader(student)).expect(403);
    await request(app).get(`${API}/admin/contact-messages`).expect(401);

    const { cookies: admin } = await createAdminSession(app, { firstName: 'Author', lastName: 'Admin', mobile: '9000000001', email: 'author@example.com' });
    const list = await request(app).get(`${API}/admin/contact-messages`).set('Cookie', cookieHeader(admin)).expect(200);
    expect(list.body.messages).toHaveLength(2);
    expect(list.body.unhandled).toBe(2);
    expect(list.body.messages[0]).toMatchObject({ email: 'other@example.com', topicLabel: 'Something else', status: 'new' });

    const id = list.body.messages[0].id as string;
    const done = await request(app)
      .patch(`${API}/admin/contact-messages/${id}`)
      .set('Cookie', cookieHeader(admin))
      .send({ status: 'handled' })
      .expect(200);
    expect(done.body.message.status).toBe('handled');
    expect(done.body.message.handledByLabel).toBeTruthy();

    const fresh = await request(app).get(`${API}/admin/contact-messages`).set('Cookie', cookieHeader(admin)).expect(200);
    expect(fresh.body.messages).toHaveLength(1);
    expect(fresh.body.unhandled).toBe(1);
    const all = await request(app).get(`${API}/admin/contact-messages?status=all`).set('Cookie', cookieHeader(admin)).expect(200);
    expect(all.body.messages).toHaveLength(2);

    await request(app)
      .patch(`${API}/admin/contact-messages/0123456789abcdef01234567`)
      .set('Cookie', cookieHeader(admin))
      .send({ status: 'handled' })
      .expect(404);
    await request(app).patch(`${API}/admin/contact-messages/nope`).set('Cookie', cookieHeader(admin)).send({ status: 'handled' }).expect(400);
  });
});
