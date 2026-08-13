import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { AuditLog, GalleryItem, Notification, NotificationRead, Student, StudentActivity } from '../src/models';
import { permissionsFor } from '../src/lib/permissions';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  validStudent,
  otherStudent,
  clearTestInbox,
  cookieHeader,
  registerVerifyLogin,
  createAdminSession,
  TINY_JPEG_BASE64,
  TINY_PNG_BASE64,
} from './helpers/auth';

/**
 * Milestone 12 — the admin platform: gallery, in-app notifications, platform
 * analytics, the unmasked leaderboard, and the rewards overview.
 *
 * Two themes run through the suite:
 *
 * 1. **Authorization is asserted for every new route**, at every level that could
 *    plausibly reach it, and on **both** URL prefixes — `/api/v1` and the
 *    unversioned `/api` alias, because a gate that holds on one and not the other
 *    is not a gate.
 * 2. **Every figure is checked against seeded data**, not merely for presence. A
 *    test that asserts a number exists would pass just as happily against a
 *    fabricated one, which is the failure mode this milestone was written to avoid.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

const jpeg = `data:image/jpeg;base64,${TINY_JPEG_BASE64}`;
const png = `data:image/png;base64,${TINY_PNG_BASE64}`;

/** The unversioned alias. Every gate must hold here too. */
const ALIAS = '/api';

// ===========================================================================
// Permissions table
// ===========================================================================

describe('the new permissions sit with the right roles', () => {
  it('gives gallery and notification authoring to admins and super admins, never students', () => {
    for (const role of ['admin', 'superadmin'] as const) {
      expect(permissionsFor(role)).toContain('gallery:write');
      expect(permissionsFor(role)).toContain('notifications:write');
    }
    expect(permissionsFor('student')).not.toContain('gallery:write');
    expect(permissionsFor('student')).not.toContain('notifications:write');
  });

  it('keeps the admin set a strict subset of the super admin set', () => {
    const admin = permissionsFor('admin');
    const superadmin = permissionsFor('superadmin');
    for (const permission of admin) expect(superadmin).toContain(permission);
  });
});

// ===========================================================================
// Gallery
// ===========================================================================

describe('gallery — authorization', () => {
  const routes: Array<[string, 'get' | 'post' | 'patch' | 'delete', string]> = [
    ['list', 'get', '/admin/gallery'],
    ['create', 'post', '/admin/gallery'],
    ['update', 'patch', '/admin/gallery/507f1f77bcf86cd799439011'],
    ['delete', 'delete', '/admin/gallery/507f1f77bcf86cd799439011'],
  ];

  for (const [label, method, path] of routes) {
    it(`refuses a guest and a student on ${label}, on both prefixes`, async () => {
      const { cookies } = await registerVerifyLogin(app);

      for (const prefix of [API, ALIAS]) {
        await request(app)[method](`${prefix}${path}`).expect(401);
        await request(app)[method](`${prefix}${path}`).set('Cookie', cookieHeader(cookies)).expect(403);
      }
    });
  }

  it('records a refused gallery write in the audit trail', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);
    await request(app).get(`${API}/admin/gallery`).set('Cookie', cookieHeader(cookies)).expect(403);

    const entry = await AuditLog.findOne({ action: 'authz.denied' });
    expect(entry).not.toBeNull();
    expect(entry!.actorLabel).toBe(studentId);
    expect(entry!.metadata).toMatchObject({ missing: ['gallery:write'] });
  });
});

describe('gallery — behaviour', () => {
  it('accepts an upload, serves the bytes, and never leaks them into a listing', async () => {
    const { cookies } = await createAdminSession(app);

    const created = await request(app)
      .post(`${API}/admin/gallery`)
      .set('Cookie', cookieHeader(cookies))
      .send({ title: 'Regional final 2026', caption: 'Class 9 prize giving', eventDate: '2026-03-14', image: jpeg })
      .expect(201);

    const id = created.body.item.id as string;
    expect(created.body.item.size).toBeGreaterThan(0);

    // The listing must carry metadata only — `data` is `select: false` precisely so
    // a page of ten does not drag ten images into memory.
    const list = await request(app).get(`${API}/admin/gallery`).set('Cookie', cookieHeader(cookies)).expect(200);
    expect(list.body.gallery).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(TINY_JPEG_BASE64);

    // The bytes come from the dedicated route, and it really is an image.
    const image = await request(app).get(`${API}/gallery/${id}/image`).expect(200);
    expect(image.headers['content-type']).toContain('image/jpeg');
    expect(image.body.length).toBeGreaterThan(0);
  });

  it('shows published items to a signed-out visitor and hides archived ones', async () => {
    const { cookies } = await createAdminSession(app);

    const shown = await request(app)
      .post(`${API}/admin/gallery`)
      .set('Cookie', cookieHeader(cookies))
      .send({ title: 'Published photo', image: jpeg })
      .expect(201);
    const hidden = await request(app)
      .post(`${API}/admin/gallery`)
      .set('Cookie', cookieHeader(cookies))
      .send({ title: 'Archived photo', image: png, status: 'archived' })
      .expect(201);

    const publicList = await request(app).get(`${API}/gallery`).expect(200);
    expect(publicList.body.gallery).toHaveLength(1);
    expect(publicList.body.gallery[0].title).toBe('Published photo');

    // Archiving is a removal, not a UI change: the bytes stop being served too,
    // otherwise anybody holding the URL would still see a taken-down photo.
    await request(app).get(`${API}/gallery/${hidden.body.item.id}/image`).expect(404);
    await request(app).get(`${API}/gallery/${shown.body.item.id}/image`).expect(200);
  });

  it('honours the display order staff chose, not upload order', async () => {
    const { cookies } = await createAdminSession(app);
    const header = cookieHeader(cookies);

    await request(app).post(`${API}/admin/gallery`).set('Cookie', header).send({ title: 'Second', image: jpeg, displayOrder: 2 }).expect(201);
    await request(app).post(`${API}/admin/gallery`).set('Cookie', header).send({ title: 'First', image: png, displayOrder: 1 }).expect(201);

    const list = await request(app).get(`${API}/gallery`).expect(200);
    expect(list.body.gallery.map((item: { title: string }) => item.title)).toEqual(['First', 'Second']);
  });

  it('rejects a file that is not really an image, however it is labelled', async () => {
    const { cookies } = await createAdminSession(app);

    const res = await request(app)
      .post(`${API}/admin/gallery`)
      .set('Cookie', cookieHeader(cookies))
      // A valid data URL claiming to be a PNG, carrying text. The magic-byte check
      // is what stops this being stored and served back with an image content type.
      .send({ title: 'Not an image', image: `data:image/png;base64,${Buffer.from('totally not a png').toString('base64')}` });

    expect(res.status).toBe(400);
    expect(await GalleryItem.countDocuments({})).toBe(0);
  });

  it('paginates and filters, and audits every mutation', async () => {
    const { cookies } = await createAdminSession(app);
    const header = cookieHeader(cookies);

    for (const title of ['Alpha event', 'Beta event', 'Gamma event']) {
      await request(app).post(`${API}/admin/gallery`).set('Cookie', header).send({ title, image: jpeg }).expect(201);
    }

    const paged = await request(app).get(`${API}/admin/gallery?limit=2`).set('Cookie', header).expect(200);
    expect(paged.body.gallery).toHaveLength(2);
    expect(paged.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });

    // Search is matched literally, not as a pattern.
    const searched = await request(app).get(`${API}/admin/gallery?search=Beta`).set('Cookie', header).expect(200);
    expect(searched.body.pagination.total).toBe(1);

    expect(await AuditLog.countDocuments({ action: 'gallery.changed' })).toBe(3);
  });

  it('deletes a photo and records what was removed', async () => {
    const { cookies } = await createAdminSession(app);
    const header = cookieHeader(cookies);
    const created = await request(app).post(`${API}/admin/gallery`).set('Cookie', header).send({ title: 'Doomed', image: jpeg }).expect(201);

    await request(app).delete(`${API}/admin/gallery/${created.body.item.id}`).set('Cookie', header).expect(200);

    expect(await GalleryItem.countDocuments({})).toBe(0);
    const entry = await AuditLog.findOne({ action: 'gallery.changed', 'metadata.operation': 'deleted' });
    expect(entry).not.toBeNull();
    expect(entry!.targetLabel).toBe('Doomed');
  });
});

// ===========================================================================
// Notifications
// ===========================================================================

describe('notifications — authorization', () => {
  const routes: Array<[string, 'get' | 'post' | 'patch' | 'delete', string]> = [
    ['list', 'get', '/admin/notifications'],
    ['create', 'post', '/admin/notifications'],
    ['update', 'patch', '/admin/notifications/507f1f77bcf86cd799439011'],
    ['delete', 'delete', '/admin/notifications/507f1f77bcf86cd799439011'],
  ];

  for (const [label, method, path] of routes) {
    it(`refuses a guest and a student on ${label}, on both prefixes`, async () => {
      const { cookies } = await registerVerifyLogin(app);
      for (const prefix of [API, ALIAS]) {
        await request(app)[method](`${prefix}${path}`).expect(401);
        await request(app)[method](`${prefix}${path}`).set('Cookie', cookieHeader(cookies)).expect(403);
      }
    });
  }

  it('requires a session for the student inbox', async () => {
    for (const prefix of [API, ALIAS]) {
      await request(app).get(`${prefix}/me/notifications`).expect(401);
      await request(app).get(`${prefix}/me/notifications/unread-count`).expect(401);
      await request(app).post(`${prefix}/me/notifications/507f1f77bcf86cd799439011/read`).expect(401);
    }
  });
});

describe('notifications — behaviour', () => {
  it('reaches a student once published, and not before', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);

    const draft = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ title: 'Results are out', body: 'Check your dashboard.' })
      .expect(201);
    expect(draft.body.notification.isPublished).toBe(false);

    // A draft is invisible.
    let inbox = await request(app).get(`${API}/me/notifications`).set('Cookie', cookieHeader(student.cookies)).expect(200);
    expect(inbox.body.notifications).toHaveLength(0);
    expect(inbox.body.unread).toBe(0);

    await request(app)
      .patch(`${API}/admin/notifications/${draft.body.notification.id}`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ isPublished: true })
      .expect(200);

    inbox = await request(app).get(`${API}/me/notifications`).set('Cookie', cookieHeader(student.cookies)).expect(200);
    expect(inbox.body.notifications).toHaveLength(1);
    expect(inbox.body.unread).toBe(1);
    expect(inbox.body.notifications[0].read).toBe(false);
  });

  it('only reaches the class it was addressed to', async () => {
    const admin = await createAdminSession(app);
    const nine = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 9' });
    const ten = await registerVerifyLogin(app, {
      ...otherStudent,
      email: 'class10@example.com',
      mobile: '9111222333',
      classLevel: 'Class 10',
    });

    await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ title: 'Class 9 only', body: 'Your paper moved.', audience: 'class', classLevel: 'Class 9', isPublished: true })
      .expect(201);

    const nineInbox = await request(app).get(`${API}/me/notifications`).set('Cookie', cookieHeader(nine.cookies)).expect(200);
    expect(nineInbox.body.notifications).toHaveLength(1);

    const tenInbox = await request(app).get(`${API}/me/notifications`).set('Cookie', cookieHeader(ten.cookies)).expect(200);
    expect(tenInbox.body.notifications).toHaveLength(0);
  });

  it('refuses a class-targeted announcement with no class', async () => {
    const { cookies } = await createAdminSession(app);
    await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(cookies))
      .send({ title: 'Nobody', body: 'Reaches no one.', audience: 'class' })
      .expect(400);
    // Scoped to `staff`, because the assertion is "no *announcement* was written".
    // Promoting the admin above legitimately produced a `system` role-change notice
    // (Milestone 14), and counting the whole collection would conflate the two.
    expect(await Notification.countDocuments({ source: 'staff' })).toBe(0);
  });

  it('marks read idempotently, so a double tap cannot double-count', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);

    const created = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ title: 'Read me', body: 'Once.', isPublished: true })
      .expect(201);
    const id = created.body.notification.id as string;
    const header = cookieHeader(student.cookies);

    const first = await request(app).post(`${API}/me/notifications/${id}/read`).set('Cookie', header).expect(200);
    expect(first.body.unread).toBe(0);
    // Twice, concurrently is the real case; twice at all is enough to prove the
    // unique index makes it idempotent rather than an error.
    await request(app).post(`${API}/me/notifications/${id}/read`).set('Cookie', header).expect(200);

    expect(await NotificationRead.countDocuments({})).toBe(1);

    const inbox = await request(app).get(`${API}/me/notifications`).set('Cookie', header).expect(200);
    expect(inbox.body.notifications[0].read).toBe(true);
    expect(inbox.body.unread).toBe(0);
  });

  it('refuses to mark an announcement the caller cannot see', async () => {
    const admin = await createAdminSession(app);
    const ten = await registerVerifyLogin(app, { ...otherStudent, classLevel: 'Class 10' });

    const created = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ title: 'Class 9 only', body: 'Not yours.', audience: 'class', classLevel: 'Class 9', isPublished: true })
      .expect(201);

    // 404 rather than 403: the route must not confirm that an id it cannot show
    // nevertheless exists.
    await request(app)
      .post(`${API}/me/notifications/${created.body.notification.id}/read`)
      .set('Cookie', cookieHeader(ten.cookies))
      .expect(404);
    expect(await NotificationRead.countDocuments({})).toBe(0);
  });

  it('filters the inbox to unread only, and marks everything read on request', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const adminHeader = cookieHeader(admin.cookies);
    const header = cookieHeader(student.cookies);

    for (const title of ['One', 'Two', 'Three']) {
      await request(app)
        .post(`${API}/admin/notifications`)
        .set('Cookie', adminHeader)
        .send({ title, body: 'Body text.', isPublished: true })
        .expect(201);
    }

    const all = await request(app).get(`${API}/me/notifications`).set('Cookie', header).expect(200);
    const firstId = all.body.notifications[0].id as string;
    await request(app).post(`${API}/me/notifications/${firstId}/read`).set('Cookie', header).expect(200);

    const unread = await request(app).get(`${API}/me/notifications?unreadOnly=true`).set('Cookie', header).expect(200);
    expect(unread.body.notifications).toHaveLength(2);
    expect(unread.body.unread).toBe(2);

    const marked = await request(app).post(`${API}/me/notifications/read-all`).set('Cookie', header).expect(200);
    expect(marked.body.marked).toBe(2);
    expect(marked.body.unread).toBe(0);
  });

  it('reports how many students actually opened an announcement', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);

    const created = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ title: 'Reach', body: 'Body.', isPublished: true })
      .expect(201);

    let list = await request(app).get(`${API}/admin/notifications`).set('Cookie', cookieHeader(admin.cookies)).expect(200);
    expect(list.body.notifications[0].readCount).toBe(0);

    await request(app)
      .post(`${API}/me/notifications/${created.body.notification.id}/read`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    list = await request(app).get(`${API}/admin/notifications`).set('Cookie', cookieHeader(admin.cookies)).expect(200);
    expect(list.body.notifications[0].readCount).toBe(1);
  });

  it('withdrawing hides it again, and deleting takes its read receipts with it', async () => {
    const admin = await createAdminSession(app);
    const student = await registerVerifyLogin(app, otherStudent);
    const adminHeader = cookieHeader(admin.cookies);

    const created = await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', adminHeader)
      .send({ title: 'Temporary', body: 'Body.', isPublished: true })
      .expect(201);
    const id = created.body.notification.id as string;

    await request(app).post(`${API}/me/notifications/${id}/read`).set('Cookie', cookieHeader(student.cookies)).expect(200);
    expect(await NotificationRead.countDocuments({})).toBe(1);

    await request(app).patch(`${API}/admin/notifications/${id}`).set('Cookie', adminHeader).send({ isPublished: false }).expect(200);
    const afterWithdraw = await request(app).get(`${API}/me/notifications`).set('Cookie', cookieHeader(student.cookies)).expect(200);
    expect(afterWithdraw.body.notifications).toHaveLength(0);

    await request(app).delete(`${API}/admin/notifications/${id}`).set('Cookie', adminHeader).expect(200);
    // The receipts go too: left behind, they would point at nothing and skew the
    // anti-join the unread count relies on.
    expect(await NotificationRead.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'notification.changed' })).toBeGreaterThanOrEqual(3);
  });

  it('paginates and filters the admin list', async () => {
    const { cookies } = await createAdminSession(app);
    const header = cookieHeader(cookies);

    await request(app).post(`${API}/admin/notifications`).set('Cookie', header).send({ title: 'Draft one', body: 'Body.' }).expect(201);
    await request(app)
      .post(`${API}/admin/notifications`)
      .set('Cookie', header)
      .send({ title: 'Live one', body: 'Body.', isPublished: true })
      .expect(201);

    const drafts = await request(app).get(`${API}/admin/notifications?published=false`).set('Cookie', header).expect(200);
    expect(drafts.body.pagination.total).toBe(1);
    expect(drafts.body.notifications[0].title).toBe('Draft one');

    const paged = await request(app).get(`${API}/admin/notifications?limit=1`).set('Cookie', header).expect(200);
    expect(paged.body.notifications).toHaveLength(1);
    expect(paged.body.pagination).toMatchObject({ total: 2, totalPages: 2 });
  });
});

// ===========================================================================
// Platform analytics
// ===========================================================================

describe('platform analytics', () => {
  it('refuses a guest and a student, on both prefixes', async () => {
    const { cookies } = await registerVerifyLogin(app);
    for (const prefix of [API, ALIAS]) {
      await request(app).get(`${prefix}/admin/analytics`).expect(401);
      await request(app).get(`${prefix}/admin/analytics`).set('Cookie', cookieHeader(cookies)).expect(403);
    }
  });

  it('counts accounts from the database rather than reporting a plausible figure', async () => {
    await registerVerifyLogin(app); // verified
    await request(app).post(`${API}/auth/register`).send(otherStudent).expect(201); // unverified
    const { cookies } = await createAdminSession(app, {
      ...validStudent,
      email: 'third@example.com',
      mobile: '9333444555',
    });

    const res = await request(app).get(`${API}/admin/analytics`).set('Cookie', cookieHeader(cookies)).expect(200);
    const { accounts } = res.body.analytics;

    // Three entrants: the two above plus the admin's own student account. The
    // provisioned super admin is deliberately excluded — it never registered.
    expect(accounts.total).toBe(3);
    expect(accounts.unverified).toBe(1);
    expect(accounts.verified).toBe(2);
    expect(accounts.admins).toBe(1);
    expect(await Student.countDocuments({ role: 'superadmin' })).toBe(1);
  });

  it('reports null rather than zero where nothing has been sat', async () => {
    const { cookies } = await createAdminSession(app);
    const res = await request(app).get(`${API}/admin/analytics`).set('Cookie', cookieHeader(cookies)).expect(200);

    // "No papers have been sat" and "everybody scored zero" are different facts,
    // and a 0% average would read as the second.
    expect(res.body.analytics.assessment.mockAttemptsSubmitted).toBe(0);
    expect(res.body.analytics.assessment.mockAveragePercent).toBeNull();
  });

  it('reports real XP totals that match the activity log', async () => {
    const { cookies } = await createAdminSession(app);
    const res = await request(app).get(`${API}/admin/analytics`).set('Cookie', cookieHeader(cookies)).expect(200);

    const rows = await StudentActivity.aggregate<{ _id: null; total: number }>([
      { $group: { _id: null, total: { $sum: '$xpAwarded' } } },
    ]);
    expect(res.body.analytics.xp.awardedTotal).toBe(rows[0]?.total ?? 0);
  });

  it('lists every offered class, including empty ones', async () => {
    const { cookies } = await createAdminSession(app);
    const res = await request(app).get(`${API}/admin/analytics`).set('Cookie', cookieHeader(cookies)).expect(200);

    // Ten offered classes. An absent row would read as missing data; a zero is a
    // fact about the cohort.
    expect(res.body.analytics.byClass).toHaveLength(10);
    for (const row of res.body.analytics.byClass) {
      expect(typeof row.students).toBe('number');
    }
  });

  it('counts recent activity in the window rather than reading zero', async () => {
    // Regression. `shiftDay(key, n)` returns the key n days **before** `key`, so a
    // negative value moves forward — the first cut here was computed with the sign
    // inverted, which produced a future boundary that matched nothing. Both windows
    // read zero however busy the platform was, and nothing failed.
    await registerVerifyLogin(app, otherStudent);
    const { cookies } = await createAdminSession(app);

    const res = await request(app).get(`${API}/admin/analytics`).set('Cookie', cookieHeader(cookies)).expect(200);
    const { engagement } = res.body.analytics;

    expect(engagement.everActive).toBeGreaterThan(0);
    // Everything in this test happened moments ago, so a correct window includes it.
    expect(engagement.activeLast7).toBe(engagement.everActive);
    expect(engagement.activeLast30).toBe(engagement.everActive);
  });

  it('never reports more active students than exist', async () => {
    // Regression. `distinct('student')` over the activity log counted 12 active
    // students against 11 registered ones: the log outlives the accounts it points
    // at, so a deleted account left rows behind that still counted as somebody.
    const student = await registerVerifyLogin(app, otherStudent);
    const { cookies } = await createAdminSession(app);

    // Orphan the rows by removing the account, exactly as deletion would.
    await Student.deleteOne({ studentId: student.studentId });

    const res = await request(app).get(`${API}/admin/analytics`).set('Cookie', cookieHeader(cookies)).expect(200);
    const { accounts, engagement } = res.body.analytics;

    expect(engagement.everActive).toBeLessThanOrEqual(accounts.total);
    expect(engagement.activeLast7).toBeLessThanOrEqual(accounts.total);
  });

  it('bounds the requested window', async () => {
    const { cookies } = await createAdminSession(app);
    const header = cookieHeader(cookies);

    await request(app).get(`${API}/admin/analytics?days=5`).set('Cookie', header).expect(400);
    await request(app).get(`${API}/admin/analytics?days=500`).set('Cookie', header).expect(400);

    const ok = await request(app).get(`${API}/admin/analytics?days=7`).set('Cookie', header).expect(200);
    expect(ok.body.analytics.engagement.registrationsByDay).toHaveLength(7);
  });
});

// ===========================================================================
// The administrative leaderboard
// ===========================================================================

describe('the administrative leaderboard', () => {
  it('refuses a guest and a student, on both prefixes', async () => {
    const { cookies } = await registerVerifyLogin(app);
    for (const prefix of [API, ALIAS]) {
      await request(app).get(`${prefix}/admin/leaderboard`).expect(401);
      await request(app).get(`${prefix}/admin/leaderboard`).set('Cookie', cookieHeader(cookies)).expect(403);
    }
  });

  it('shows full names and student IDs, unlike the public board', async () => {
    const student = await registerVerifyLogin(app, otherStudent);
    const { cookies } = await createAdminSession(app);

    const res = await request(app).get(`${API}/admin/leaderboard`).set('Cookie', cookieHeader(cookies)).expect(200);
    const row = res.body.leaderboard.find((r: { studentId: string }) => r.studentId === student.studentId);

    expect(row).toBeTruthy();
    // The public board shortens this to a first name and a last initial, because
    // the entrants are children and that page is indexable. Staff get the whole
    // derived name, middle name included.
    expect(row.fullName).toBe('Other Kumar Student');
    expect(row.email).toBe(otherStudent.email);
    expect(row.xp).toBeGreaterThan(0);

    const publicBoard = await request(app).get(`${API}/leaderboard`).expect(200);
    expect(JSON.stringify(publicBoard.body)).not.toContain(otherStudent.email);
  });

  it('never lists the super administrator, which earns no XP', async () => {
    await registerVerifyLogin(app, otherStudent);
    const { cookies } = await createAdminSession(app);

    const res = await request(app).get(`${API}/admin/leaderboard`).set('Cookie', cookieHeader(cookies)).expect(200);
    const superadmin = await Student.findOne({ role: 'superadmin' });

    expect(res.body.leaderboard.some((r: { studentId: string }) => r.studentId === superadmin!.studentId)).toBe(false);
  });

  it('paginates with ranks that are positions in the whole ordering', async () => {
    await registerVerifyLogin(app, otherStudent);
    const { cookies } = await createAdminSession(app);
    const header = cookieHeader(cookies);

    const first = await request(app).get(`${API}/admin/leaderboard?limit=1&page=1`).set('Cookie', header).expect(200);
    expect(first.body.leaderboard[0].rank).toBe(1);

    const second = await request(app).get(`${API}/admin/leaderboard?limit=1&page=2`).set('Cookie', header).expect(200);
    // Rank 2, not 1 — position in the full ordering, not in the page.
    if (second.body.leaderboard.length > 0) expect(second.body.leaderboard[0].rank).toBe(2);
  });

  it('filters by class and rejects an unknown one', async () => {
    const { cookies } = await createAdminSession(app);
    const header = cookieHeader(cookies);

    await request(app).get(`${API}/admin/leaderboard?classLevel=Class%209`).set('Cookie', header).expect(200);
    await request(app).get(`${API}/admin/leaderboard?classLevel=Class%2099`).set('Cookie', header).expect(400);
    await request(app).get(`${API}/admin/leaderboard?period=fortnight`).set('Cookie', header).expect(400);
  });
});

// ===========================================================================
// Rewards overview
// ===========================================================================

describe('the rewards overview', () => {
  it('refuses a guest and a student, on both prefixes', async () => {
    const { cookies } = await registerVerifyLogin(app);
    for (const prefix of [API, ALIAS]) {
      await request(app).get(`${prefix}/admin/rewards/overview`).expect(401);
      await request(app).get(`${prefix}/admin/rewards/overview`).set('Cookie', cookieHeader(cookies)).expect(403);
    }
  });

  it('counts achievement holders exactly, and says so when it cannot', async () => {
    await registerVerifyLogin(app, otherStudent);
    const { cookies } = await createAdminSession(app);

    const res = await request(app).get(`${API}/admin/rewards/overview`).set('Cookie', cookieHeader(cookies)).expect(200);
    const byCode = new Map<string, number | null>(
      res.body.overview.achievements.map((a: { code: string; holders: number | null }) => [a.code, a.holders]),
    );

    // Two accounts have registered and verified, so both hold these exactly.
    expect(byCode.get('enrolled')).toBe(2);
    expect(byCode.get('verified')).toBe(2);

    // A consecutive-day streak cannot be counted by aggregation, and this reports
    // `null` rather than a plausible number nobody can reproduce.
    expect(byCode.get('streak_3')).toBeNull();
    expect(byCode.get('streak_7')).toBeNull();
    expect(byCode.get('challenge_streak_5')).toBeNull();
  });

  it('reports level distribution, and `neverEarned` that means what it says', async () => {
    await request(app).post(`${API}/auth/register`).send(otherStudent).expect(201); // never signs in
    const { cookies } = await createAdminSession(app);

    const res = await request(app).get(`${API}/admin/rewards/overview`).set('Cookie', cookieHeader(cookies)).expect(200);
    const { overview } = res.body;

    expect(overview.earners).toBeGreaterThan(0);
    expect(overview.levels.length).toBeGreaterThan(0);
    // The two must always add up — that is what makes the figures a partition of
    // the roll rather than three unrelated counts.
    expect(overview.totalStudents).toBe(overview.earners + overview.neverEarned);

    /**
     * Zero, and that is the correct answer rather than a gap in the data:
     * registration itself grants `account_created` XP, so every account created by
     * this codebase has an activity row from the moment it exists — including the
     * one above that never signed in.
     *
     * A **non-zero** value therefore means something specific and worth surfacing:
     * accounts predating Milestone 5's activity log, which is exactly what
     * `scripts/backfill-activity.ts` exists to repair (see PROJECT_STATE.md).
     */
    expect(overview.neverEarned).toBe(0);
  });
});
