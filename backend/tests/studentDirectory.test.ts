import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../src/app';
import { Payment, Student, DEFAULT_ENTRY_FEE_PAISE, type PaymentStatus } from '../src/models';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  clearTestInbox,
  cookieHeader,
  createAdminSession,
  registerVerifyLogin,
  validStudent,
} from './helpers/auth';

/**
 * Milestone 22, Phase B — the admin student directory and its Excel export.
 *
 * The organising idea: **the directory's job is to show everybody, so most of this file is
 * about the students who did *not* pay.** A directory that only lists paying students is
 * indistinguishable from a working one until somebody asks how many people registered — so
 * an unpaid, a failed, a pending and a refunded student are constructed here explicitly and
 * each is asserted to be present, by state, in the default listing.
 *
 * The second theme is that **the export is the listing.** Several tests send the same
 * filters to both endpoints and compare, because an export built from its own query is an
 * export that quietly disagrees with the screen the administrator pressed the button on.
 *
 * The third is what must never be in either: `passwordHash` is `select: false`, which
 * protects `find()` and does nothing for an aggregation, so the projection is the only
 * thing standing between a hash and a spreadsheet on somebody's desk.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/**
 * `exceljs` is CommonJS; its typings are only reachable as an ESM import. Same arrangement
 * as `tests/excelImport.test.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS, see above
const exceljs = require('exceljs') as typeof import('exceljs', { with: { 'resolution-mode': 'import' } });

/** Registers one student with distinct identifiers, unpaid unless a payment is added after. */
async function makeStudent(overrides: Partial<typeof validStudent>): Promise<string> {
  const { studentId } = await registerVerifyLogin(app, overrides, { paid: false });
  return studentId;
}

/**
 * Writes one entry-fee payment row in a chosen state.
 *
 * Straight to the collection rather than through Razorpay: the directory rolls up whatever
 * rows exist, and the paths that create them for real are `payments.test.ts`'s business.
 */
async function addPayment(
  studentId: string,
  status: PaymentStatus,
  extra: { amount?: number; failureReason?: string; method?: string; createdAt?: Date } = {},
): Promise<void> {
  const account = await Student.findOne({ studentId }).select('_id');
  if (!account) throw new Error(`No account ${studentId}`);

  await Payment.create({
    student: account._id,
    purpose: 'olympiad_entry',
    amount: extra.amount ?? DEFAULT_ENTRY_FEE_PAISE,
    currency: 'INR',
    razorpayOrderId: `order_test_${randomUUID()}`,
    razorpayPaymentId: status === 'created' ? null : `pay_test_${randomUUID()}`,
    // Only a captured row is ever given a signature by the real code, and it is never
    // published — one of the tests below proves that.
    razorpaySignature: status === 'captured' ? 'f'.repeat(64) : null,
    status,
    statusSource: status === 'captured' ? 'checkout_verify' : null,
    failureReason: extra.failureReason ?? null,
    method: extra.method ?? null,
    capturedAt: status === 'captured' ? new Date() : null,
    ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
  });
}

interface DirectoryEntry {
  studentId: string
  fullName: string | null
  classLevel: string | null
  paymentState: string
  hasPaid: boolean
  paymentAttempts: number
  payment: null | {
    amount: number
    amountDisplay: string
    status: string
    razorpayOrderId: string
    razorpayPaymentId: string | null
    method: string | null
    failureReason: string | null
    capturedAt: string | null
  }
}

interface DirectoryResponse {
  success: boolean
  students: DirectoryEntry[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

/**
 * One cohort covering every payment state the platform can produce, plus a spread of
 * classes and schools. Returns the admin session that can read it.
 *
 * Built once per test that needs it rather than in a `beforeEach`, because several tests
 * need a *different* cohort and a shared fixture that only some tests use is how a suite
 * ends up asserting against data it did not intend.
 */
async function seedCohort() {
  const admin = await createAdminSession(app, {
    email: 'directory-admin@example.com',
    mobile: '9000000001',
    firstName: 'Directory',
    lastName: 'Admin',
  });

  const paid = await makeStudent({
    email: 'paid@example.com',
    mobile: '9000000002',
    firstName: 'Paid',
    lastName: 'Student',
    classLevel: 'Class 8',
    schoolName: 'Riverdale High',
  });
  await addPayment(paid, 'captured', { method: 'upi' });

  const failed = await makeStudent({
    email: 'failed@example.com',
    mobile: '9000000003',
    firstName: 'Failed',
    lastName: 'Student',
    classLevel: 'Class 8',
    schoolName: 'Springfield Public School',
  });
  await addPayment(failed, 'failed', { failureReason: 'Card declined by issuing bank' });

  const pending = await makeStudent({
    email: 'pending@example.com',
    mobile: '9000000004',
    firstName: 'Pending',
    lastName: 'Student',
    classLevel: 'Class 3',
    schoolName: 'Riverdale High',
  });
  await addPayment(pending, 'attempted');

  const refunded = await makeStudent({
    email: 'refunded@example.com',
    mobile: '9000000005',
    firstName: 'Refunded',
    lastName: 'Student',
    classLevel: 'Class 12',
    schoolName: 'Riverdale High',
  });
  await addPayment(refunded, 'refunded');

  const never = await makeStudent({
    email: 'never@example.com',
    mobile: '9000000006',
    firstName: 'Never',
    lastName: 'Paid',
    classLevel: 'Class 12',
    schoolName: 'Springfield Public School',
  });

  return { admin, paid, failed, pending, refunded, never };
}

function directory(cookies: Record<string, string>, query = ''): request.Test {
  return request(app)
    .get(`${API}/admin/students${query}`)
    .set('Cookie', cookieHeader(cookies));
}

function idsIn(body: DirectoryResponse): string[] {
  return body.students.map((entry) => entry.studentId);
}

function entryFor(body: DirectoryResponse, studentId: string): DirectoryEntry {
  const found = body.students.find((entry) => entry.studentId === studentId);
  if (!found) throw new Error(`${studentId} is missing from the directory: ${idsIn(body).join(', ')}`);
  return found;
}

// ---------------------------------------------------------------------------
// Everyone appears
// ---------------------------------------------------------------------------

describe('GET /admin/students — every registered student, whatever their payment state', () => {
  it('lists paid, failed, pending, refunded and never-started students in one unfiltered page', async () => {
    const cohort = await seedCohort();

    const res = await directory(cohort.admin.cookies, '?limit=100').expect(200);
    const body = res.body as DirectoryResponse;

    // The whole point of the feature. A regression that filtered to paying students would
    // pass every other test in this file.
    for (const studentId of [cohort.paid, cohort.failed, cohort.pending, cohort.refunded, cohort.never]) {
      expect(idsIn(body)).toContain(studentId);
    }
    expect(res.status).not.toBe(500);
  });

  it('derives the payment state of each one from its real payment rows', async () => {
    const cohort = await seedCohort();
    const body = (await directory(cohort.admin.cookies, '?limit=100').expect(200)).body as DirectoryResponse;

    expect(entryFor(body, cohort.paid).paymentState).toBe('paid');
    expect(entryFor(body, cohort.failed).paymentState).toBe('failed');
    expect(entryFor(body, cohort.pending).paymentState).toBe('pending');
    expect(entryFor(body, cohort.refunded).paymentState).toBe('refunded');
    expect(entryFor(body, cohort.never).paymentState).toBe('not_started');
  });

  it('reports the real amount, order id and method for a captured payment', async () => {
    const cohort = await seedCohort();
    const body = (await directory(cohort.admin.cookies, '?limit=100').expect(200)).body as DirectoryResponse;

    const paid = entryFor(body, cohort.paid);
    expect(paid.hasPaid).toBe(true);
    expect(paid.payment?.amount).toBe(DEFAULT_ENTRY_FEE_PAISE);
    expect(paid.payment?.amountDisplay).toBe('₹199.00');
    expect(paid.payment?.razorpayOrderId).toMatch(/^order_test_/);
    expect(paid.payment?.method).toBe('upi');
    expect(paid.payment?.capturedAt).toBeTruthy();
  });

  it("carries a failed payment's own reason, so staff can act on it", async () => {
    const cohort = await seedCohort();
    const body = (await directory(cohort.admin.cookies, '?limit=100').expect(200)).body as DirectoryResponse;

    const failed = entryFor(body, cohort.failed);
    expect(failed.hasPaid).toBe(false);
    expect(failed.payment?.failureReason).toBe('Card declined by issuing bank');
  });

  it('shows a student with no payment row at all as not_started, with a null payment', async () => {
    const cohort = await seedCohort();
    const body = (await directory(cohort.admin.cookies, '?limit=100').expect(200)).body as DirectoryResponse;

    const never = entryFor(body, cohort.never);
    expect(never.payment).toBeNull();
    expect(never.paymentAttempts).toBe(0);
    expect(never.hasPaid).toBe(false);
  });

  it('counts a student who failed and then paid as paid', async () => {
    const admin = await createAdminSession(app, { email: 'a@example.com', mobile: '9000000010' });
    const student = await makeStudent({ email: 'retry@example.com', mobile: '9000000011' });
    await addPayment(student, 'failed', { failureReason: 'Declined' });
    await addPayment(student, 'captured');

    const body = (await directory(admin.cookies, '?limit=100').expect(200)).body as DirectoryResponse;
    const entry = entryFor(body, student);

    // A capture outranks every failure before it, and the representative row shown is the
    // capture rather than the most recent write.
    expect(entry.paymentState).toBe('paid');
    expect(entry.paymentAttempts).toBe(2);
    expect(entry.payment?.status).toBe('captured');
  });
});

// ---------------------------------------------------------------------------
// Nothing sensitive
// ---------------------------------------------------------------------------

describe('GET /admin/students — what must never be in the response', () => {
  it('publishes no password hash, token or payment signature anywhere in the body', async () => {
    const cohort = await seedCohort();
    const res = await directory(cohort.admin.cookies, '?limit=100').expect(200);

    // Serialised and searched as text rather than field by field: the hazard is a field
    // nobody thought to check, and an aggregation bypasses `select: false` entirely.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('razorpaySignature');
    expect(raw).not.toContain('tokenVersion');
    expect(raw).not.toContain('$2a$');
    expect(raw).not.toContain('$2b$');
    expect(raw).not.toContain('f'.repeat(64));
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe('GET /admin/students — filtering', () => {
  it('filters to exactly one payment state without hiding the others from an unfiltered call', async () => {
    const cohort = await seedCohort();

    const paidOnly = (await directory(cohort.admin.cookies, '?paymentState=paid&limit=100').expect(200))
      .body as DirectoryResponse;
    expect(idsIn(paidOnly)).toEqual([cohort.paid]);

    const unpaidOnly = (await directory(cohort.admin.cookies, '?paymentState=not_started&limit=100').expect(200))
      .body as DirectoryResponse;
    // The admin account itself has never paid, so it is legitimately in this list too.
    expect(idsIn(unpaidOnly)).toContain(cohort.never);
    expect(idsIn(unpaidOnly)).not.toContain(cohort.paid);

    const failedOnly = (await directory(cohort.admin.cookies, '?paymentState=failed&limit=100').expect(200))
      .body as DirectoryResponse;
    expect(idsIn(failedOnly)).toEqual([cohort.failed]);
  });

  it('filters by class, across the whole Class 3 – Class 12 range', async () => {
    const cohort = await seedCohort();

    const three = (await directory(cohort.admin.cookies, '?classLevel=Class%203&limit=100').expect(200))
      .body as DirectoryResponse;
    expect(idsIn(three)).toEqual([cohort.pending]);

    const twelve = (await directory(cohort.admin.cookies, '?classLevel=Class%2012&limit=100').expect(200))
      .body as DirectoryResponse;
    expect(idsIn(twelve).sort()).toEqual([cohort.refunded, cohort.never].sort());
  });

  it('combines a class filter with a payment filter', async () => {
    const cohort = await seedCohort();

    const res = (await directory(cohort.admin.cookies, '?classLevel=Class%208&paymentState=paid&limit=100').expect(200))
      .body as DirectoryResponse;

    expect(idsIn(res)).toEqual([cohort.paid]);
    expect(res.pagination.total).toBe(1);
  });

  it('searches by school name as well as by name, email, mobile and student ID', async () => {
    const cohort = await seedCohort();

    const bySchool = (await directory(cohort.admin.cookies, '?search=Riverdale&limit=100').expect(200))
      .body as DirectoryResponse;
    expect(idsIn(bySchool).sort()).toEqual([cohort.paid, cohort.pending, cohort.refunded].sort());

    const byId = (await directory(cohort.admin.cookies, `?search=${cohort.never}&limit=100`).expect(200))
      .body as DirectoryResponse;
    expect(idsIn(byId)).toEqual([cohort.never]);
  });

  it('treats a search string literally rather than as a pattern', async () => {
    const cohort = await seedCohort();

    const res = (await directory(cohort.admin.cookies, '?search=.*&limit=100').expect(200)).body as DirectoryResponse;

    // An unescaped `.*` would match every account rather than none.
    expect(res.students).toHaveLength(0);
    expect(res.pagination.total).toBe(0);
  });

  it('filters by an inclusive registration date range', async () => {
    const admin = await createAdminSession(app, { email: 'a@example.com', mobile: '9000000020' });
    const old = await makeStudent({ email: 'old@example.com', mobile: '9000000021' });
    const recent = await makeStudent({ email: 'recent@example.com', mobile: '9000000022' });

    await Student.updateOne({ studentId: old }, { $set: { registeredAt: new Date('2026-01-10T08:00:00.000Z') } });
    await Student.updateOne({ studentId: recent }, { $set: { registeredAt: new Date('2026-03-20T23:30:00.000Z') } });

    const january = (await directory(admin.cookies, '?registeredFrom=2026-01-01&registeredTo=2026-01-31&limit=100').expect(200))
      .body as DirectoryResponse;
    expect(idsIn(january)).toEqual([old]);

    // The upper bound is the *end* of the named day: a student who registered at 23:30
    // must not fall outside "up to and including the 20th".
    const untilTheTwentieth = (
      await directory(admin.cookies, '?registeredFrom=2026-03-20&registeredTo=2026-03-20&limit=100').expect(200)
    ).body as DirectoryResponse;
    expect(idsIn(untilTheTwentieth)).toEqual([recent]);
  });

  it('refuses a malformed date rather than ignoring it', async () => {
    const admin = await createAdminSession(app, { email: 'a@example.com', mobile: '9000000030' });

    const res = await directory(admin.cookies, '?registeredFrom=last-tuesday');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pagination and sorting
// ---------------------------------------------------------------------------

describe('GET /admin/students — pagination and sorting', () => {
  it('pages a filtered result set with a total that matches the filter', async () => {
    const admin = await createAdminSession(app, { email: 'a@example.com', mobile: '9000000040' });
    const first = await makeStudent({ email: 'p1@example.com', mobile: '9000000041', classLevel: 'Class 7' });
    const second = await makeStudent({ email: 'p2@example.com', mobile: '9000000042', classLevel: 'Class 7' });
    await addPayment(first, 'captured');
    await addPayment(second, 'captured');

    const pageOne = (await directory(admin.cookies, '?paymentState=paid&limit=1&page=1').expect(200))
      .body as DirectoryResponse;
    const pageTwo = (await directory(admin.cookies, '?paymentState=paid&limit=1&page=2').expect(200))
      .body as DirectoryResponse;

    // The count must come from the same pipeline as the rows. A `countDocuments` beside a
    // filtered aggregation is how a total of "everyone" ends up over a list of two.
    expect(pageOne.pagination.total).toBe(2);
    expect(pageOne.pagination.totalPages).toBe(2);
    expect(pageOne.students).toHaveLength(1);
    expect(pageTwo.students).toHaveLength(1);
    expect(idsIn(pageOne)[0]).not.toBe(idsIn(pageTwo)[0]);
  });

  it('sorts by name ascending when asked', async () => {
    const admin = await createAdminSession(app, { email: 'a@example.com', mobile: '9000000050' });
    await makeStudent({ email: 'z@example.com', mobile: '9000000051', firstName: 'Zara', lastName: 'Zed' });
    await makeStudent({ email: 'b@example.com', mobile: '9000000052', firstName: 'Bilal', lastName: 'Bee' });

    const res = (await directory(admin.cookies, '?sort=fullName&order=asc&limit=100').expect(200))
      .body as DirectoryResponse;

    const names = res.students.map((entry) => entry.fullName);
    const withoutAdmin = names.filter((name) => name !== 'Test Kumar Student');
    expect(withoutAdmin[0]).toBe('Bilal Kumar Bee');
    expect(withoutAdmin[withoutAdmin.length - 1]).toBe('Zara Kumar Zed');
  });

  it('refuses a sort key that is not on the allow-list', async () => {
    const admin = await createAdminSession(app, { email: 'a@example.com', mobile: '9000000060' });

    const res = await directory(admin.cookies, '?sort=passwordHash');

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

/** Reads a downloaded workbook back into rows keyed by the header row. */
async function readWorkbook(body: Buffer): Promise<{ headers: string[]; rows: Array<Record<string, unknown>>; sheets: string[] }> {
  const workbook = new exceljs.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);

  const sheet = workbook.getWorksheet('Students');
  if (!sheet) throw new Error(`No "Students" sheet. Sheets: ${workbook.worksheets.map((s) => s.name).join(', ')}`);

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, index) => {
    headers[index - 1] = String(cell.value ?? '');
  });

  const rows: Array<Record<string, unknown>> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = row.getCell(index + 1).value;
    });
    rows.push(record);
  });

  return { headers, rows, sheets: workbook.worksheets.map((s) => s.name) };
}

function exportRequest(cookies: Record<string, string>, query = ''): request.Test {
  return request(app)
    .get(`${API}/admin/students/export${query}`)
    .set('Cookie', cookieHeader(cookies))
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

describe('GET /admin/students/export', () => {
  it('is not swallowed by the /:studentId route', async () => {
    const admin = await createAdminSession(app, { email: 'a@example.com', mobile: '9000000070' });

    const res = await exportRequest(admin.cookies);

    // The failure this guards against is a 400 "studentId must look like AMIT_0000",
    // which is what a route declared after `/admin/students/:studentId` answers.
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
  });

  it('is named for the day it was taken and downloads as an attachment', async () => {
    const admin = await createAdminSession(app, { email: 'a@example.com', mobile: '9000000071' });

    const res = await exportRequest(admin.cookies).expect(200);

    expect(res.headers['content-disposition']).toMatch(/attachment; filename="students-export-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('contains a row for every student, paid or not, with their real payment details', async () => {
    const cohort = await seedCohort();

    const res = await exportRequest(cohort.admin.cookies).expect(200);
    const { rows } = await readWorkbook(res.body as Buffer);

    const byId = new Map(rows.map((row) => [row['Student ID'], row]));
    expect(byId.has(cohort.paid)).toBe(true);
    expect(byId.has(cohort.never)).toBe(true);

    expect(byId.get(cohort.paid)?.['Payment Status']).toBe('Paid');
    // Rupees as a real number, so the column sums. 19900 paise -> 199.
    expect(byId.get(cohort.paid)?.['Payment Amount']).toBe(199);
    expect(byId.get(cohort.paid)?.['Payment Date']).toBeInstanceOf(Date);

    expect(byId.get(cohort.never)?.['Payment Status']).toBe('Not started');
    expect(byId.get(cohort.never)?.['Payment Amount']).toBeNull();
    expect(byId.get(cohort.failed)?.['Payment Status']).toBe('Failed');
    expect(byId.get(cohort.failed)?.['Failure Reason']).toBe('Card declined by issuing bank');
  });

  it('carries no password, hash, token or signature column or value', async () => {
    const cohort = await seedCohort();

    const res = await exportRequest(cohort.admin.cookies).expect(200);
    const { headers, rows } = await readWorkbook(res.body as Buffer);

    for (const banned of ['Password', 'Hash', 'Token', 'Signature', 'Secret']) {
      expect(headers.some((header) => header.toLowerCase().includes(banned.toLowerCase()))).toBe(false);
    }

    const raw = JSON.stringify(rows);
    expect(raw).not.toContain('$2a$');
    expect(raw).not.toContain('$2b$');
    expect(raw).not.toContain('f'.repeat(64));
  });

  it('respects the administrator’s filters', async () => {
    const cohort = await seedCohort();

    const res = await exportRequest(cohort.admin.cookies, '?classLevel=Class%208&paymentState=paid').expect(200);
    const { rows } = await readWorkbook(res.body as Buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.['Student ID']).toBe(cohort.paid);
  });

  it('exports the same students the listing showed for the same filters', async () => {
    const cohort = await seedCohort();
    const query = '?classLevel=Class%2012';

    const listed = (await directory(cohort.admin.cookies, `${query}&limit=100`).expect(200)).body as DirectoryResponse;
    const exported = await readWorkbook((await exportRequest(cohort.admin.cookies, query).expect(200)).body as Buffer);

    // The promise the export makes. Sorted, because the assertion is about membership.
    expect(exported.rows.map((row) => row['Student ID']).sort()).toEqual(idsIn(listed).sort());
  });

  it('ignores every filter when the scope is "all"', async () => {
    const cohort = await seedCohort();

    const res = await exportRequest(cohort.admin.cookies, '?scope=all&classLevel=Class%208&paymentState=paid').expect(200);
    const { rows } = await readWorkbook(res.body as Buffer);

    // The filters would have left exactly one row. Instead: the five students, the
    // promoted administrator, and the bootstrap super admin its promotion provisioned.
    // Staff accounts are genuinely in the directory — that is what the role filter is for.
    expect(rows).toHaveLength(7);
    for (const studentId of [cohort.paid, cohort.failed, cohort.pending, cohort.refunded, cohort.never]) {
      expect(rows.some((row) => row['Student ID'] === studentId)).toBe(true);
    }
  });

  it('says on its own cover sheet what it contains and who took it', async () => {
    const cohort = await seedCohort();

    const res = await exportRequest(cohort.admin.cookies, '?classLevel=Class%208').expect(200);
    const workbook = new exceljs.Workbook();
    await workbook.xlsx.load(res.body as unknown as ArrayBuffer);

    const about = workbook.getWorksheet('About this export');
    expect(about).toBeDefined();

    const text = JSON.stringify(about?.getSheetValues());
    expect(text).toContain('Class 8');
    expect(text).toContain(cohort.admin.studentId);
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('the directory and its export are privileged', () => {
  it('refuses an ordinary student', async () => {
    const student = await registerVerifyLogin(app, { email: 'plain@example.com', mobile: '9000000080' });

    const listing = await directory(student.cookies);
    const download = await exportRequest(student.cookies);

    expect(listing.status).toBe(403);
    expect(download.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    const listing = await request(app).get(`${API}/admin/students`);
    const download = await request(app).get(`${API}/admin/students/export`);

    expect(listing.status).toBe(401);
    expect(download.status).toBe(401);
  });

  it('refuses on the unversioned alias too', async () => {
    const student = await registerVerifyLogin(app, { email: 'plain@example.com', mobile: '9000000081' });

    // Both prefixes mount the same router, so a gate that held on only one would be no
    // gate at all — the property every privileged route in this product is asserted on.
    const res = await request(app)
      .get('/api/admin/students/export')
      .set('Cookie', cookieHeader(student.cookies));

    expect(res.status).toBe(403);
  });
});
