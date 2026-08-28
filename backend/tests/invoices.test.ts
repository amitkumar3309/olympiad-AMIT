import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { Payment, PaymentSettings, Student, type PaymentStatus } from '../src/models';
import { amountInWords, invoiceNumberFor } from '../src/services/invoiceService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, registerVerifyLogin } from './helpers/auth';

/**
 * Milestone 22, Phase C — the student invoice.
 *
 * Three properties this file exists to pin, because each fails silently:
 *
 * 1. **A student can reach their own invoice and nobody else's.** The id is in the URL, so
 *    the test that matters is the one that changes it.
 * 2. **The number is stable and the download creates nothing.** There is no `Invoice`
 *    collection, so "idempotent" is asserted by counting documents before and after four
 *    downloads and by comparing numbers across calls.
 * 3. **The money is the money that was taken.** The fee is administrator-editable, so the
 *    test that matters re-prices it *after* a capture and asserts the invoice did not move.
 *    A regression here hands a student a receipt for an amount they never paid.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const ORIGINAL_INVOICE = { ...config.invoice };

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
  Object.assign(config.invoice, ORIGINAL_INVOICE);
});

/** Writes one entry-fee payment in a chosen state and returns its id. */
async function addPayment(
  studentId: string,
  status: PaymentStatus,
  extra: { amount?: number; method?: string } = {},
): Promise<string> {
  const account = await Student.findOne({ studentId }).select('_id');
  if (!account) throw new Error(`No account ${studentId}`);

  const payment = await Payment.create({
    student: account._id,
    purpose: 'olympiad_entry',
    amount: extra.amount ?? 19_900,
    currency: 'INR',
    razorpayOrderId: `order_test_${randomUUID()}`,
    razorpayPaymentId: `pay_test_${randomUUID()}`,
    // A captured row is the only one the real code ever signs. It must not be published.
    razorpaySignature: status === 'captured' ? 'd'.repeat(64) : null,
    status,
    statusSource: status === 'captured' ? 'checkout_verify' : null,
    method: extra.method ?? 'upi',
    capturedAt: status === 'captured' ? new Date('2026-08-20T09:30:00.000Z') : null,
  });

  return String(payment._id);
}

/** A student with one captured payment. */
async function paidStudent(overrides: Record<string, string> = {}) {
  const session = await registerVerifyLogin(
    app,
    { email: 'invoice@example.com', mobile: '9700000001', ...overrides },
    { paid: false },
  );
  const paymentId = await addPayment(session.studentId, 'captured');
  return { ...session, paymentId };
}

function pdfRequest(path: string, cookies: Record<string, string>): request.Test {
  return request(app)
    .get(path)
    .set('Cookie', cookieHeader(cookies))
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

interface InvoicePreview {
  invoiceNumber: string
  invoiceDate: string
  title: string
  issuer: { name: string; gstin: string | null; taxNote: string | null; addressLines: string[] }
  buyer: { name: string; studentId: string; email: string; mobile: string; classLevel: string | null }
  item: { description: string; amount: number; amountDisplay: string }
  totalPaise: number
  totalDisplay: string
  totalInWords: string
  payment: { razorpayOrderId: string; razorpayPaymentId: string | null; method: string | null; capturedAt: string }
}

// ---------------------------------------------------------------------------
// The number, and the words
// ---------------------------------------------------------------------------

describe('invoice numbering', () => {
  it('is derived from the payment, so the same transaction always resolves to the same number', () => {
    const payment = {
      _id: '64f0a1b2c3d4e5f60718293a',
      capturedAt: new Date('2026-08-20T09:30:00.000Z'),
      createdAt: new Date('2026-08-19T09:30:00.000Z'),
    };

    const first = invoiceNumberFor(payment);
    const second = invoiceNumberFor(payment);

    expect(first).toBe(second);
    // The year is the *capture* year, and the suffix is the last twelve hex characters
    // of the payment's own `ObjectId` — asserted as a literal, so a change to either half
    // of the derivation breaks a test rather than silently renumbering every invoice.
    expect(first).toBe('AMIT-INV-2026-E5F60718293A');
  });

  it('gives two different payments two different numbers', () => {
    const a = invoiceNumberFor({
      _id: '64f0a1b2c3d4e5f60718293a',
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date(),
    });
    const b = invoiceNumberFor({
      _id: '64f0a1b2c3d4e5f60718293b',
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date(),
    });

    expect(a).not.toBe(b);
  });

  it('falls back to the creation year when a payment has no capture date', () => {
    const number = invoiceNumberFor({
      _id: '64f0a1b2c3d4e5f60718293a',
      capturedAt: null,
      createdAt: new Date('2025-03-04T00:00:00.000Z'),
    });

    expect(number).toContain('AMIT-INV-2025-');
  });
});

describe('amountInWords', () => {
  it('writes rupee amounts the way an Indian invoice reads them', () => {
    expect(amountInWords(19_900)).toBe('Rupees One Hundred and Ninety Nine Only');
    expect(amountInWords(10_000)).toBe('Rupees One Hundred Only');
    expect(amountInWords(49_900)).toBe('Rupees Four Hundred and Ninety Nine Only');
    // Indian grouping: lakh and crore, not million.
    expect(amountInWords(1_00_00_000)).toBe('Rupees One Lakh Only');
    expect(amountInWords(12_34_56_700)).toBe('Rupees Twelve Lakh Thirty Four Thousand Five Hundred and Sixty Seven Only');
  });

  it('handles zero and a paise remainder rather than producing an empty string', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
    expect(amountInWords(150)).toBe('Rupees One and Fifty Paise Only');
  });
});

// ---------------------------------------------------------------------------
// A student's own invoice
// ---------------------------------------------------------------------------

describe('GET /me/invoices', () => {
  it('lists one invoice per captured payment, and nothing for an attempt', async () => {
    const student = await paidStudent();
    await addPayment(student.studentId, 'failed');
    await addPayment(student.studentId, 'attempted');

    const res = await request(app)
      .get(`${API}/me/invoices`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    const invoices = res.body.invoices as InvoicePreview[];
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.payment.razorpayOrderId).toBeTruthy();
  });

  it('is empty for a student who has not paid, rather than an error', async () => {
    const student = await registerVerifyLogin(app, { email: 'nopay@example.com', mobile: '9700000009' }, { paid: false });

    const res = await request(app)
      .get(`${API}/me/invoices`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    expect(res.body.invoices).toEqual([]);
  });
});

describe('GET /me/invoices/:paymentId — the preview', () => {
  it('is built from the real payment and the real account', async () => {
    const student = await paidStudent({ firstName: 'Aarav', lastName: 'Sharma', classLevel: 'Class 8' });

    const res = await request(app)
      .get(`${API}/me/invoices/${student.paymentId}`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    const invoice = res.body.invoice as InvoicePreview;
    expect(invoice.buyer.name).toBe('Aarav Kumar Sharma');
    expect(invoice.buyer.studentId).toBe(student.studentId);
    expect(invoice.buyer.email).toBe('invoice@example.com');
    expect(invoice.buyer.classLevel).toBe('Class 8');
    expect(invoice.totalPaise).toBe(19_900);
    expect(invoice.totalDisplay).toBe('₹199.00');
    expect(invoice.totalInWords).toBe('Rupees One Hundred and Ninety Nine Only');
    expect(invoice.payment.method).toBe('upi');
    // Dated when the money was taken, not when the page was opened.
    expect(invoice.invoiceDate.slice(0, 10)).toBe('2026-08-20');
  });

  it('never publishes the payment signature', async () => {
    const student = await paidStudent();

    const res = await request(app)
      .get(`${API}/me/invoices/${student.paymentId}`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('razorpaySignature');
    expect(raw).not.toContain('d'.repeat(64));
  });

  it('is titled "Invoice" with no GSTIN configured, and says nothing about tax', async () => {
    const student = await paidStudent();

    const res = await request(app)
      .get(`${API}/me/invoices/${student.paymentId}`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    const invoice = res.body.invoice as InvoicePreview;
    // Nothing is invented: no GST number, no tax rate, no "inclusive of all taxes".
    expect(invoice.title).toBe('Invoice');
    expect(invoice.issuer.gstin).toBeNull();
    expect(invoice.issuer.taxNote).toBeNull();
  });

  it('becomes a "Tax Invoice" once a GSTIN is configured', async () => {
    Object.assign(config.invoice, { gstin: '29ABCDE1234F1Z5', taxNote: 'Fees are exempt under …' });
    const student = await paidStudent();

    const res = await request(app)
      .get(`${API}/me/invoices/${student.paymentId}`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    const invoice = res.body.invoice as InvoicePreview;
    expect(invoice.title).toBe('Tax Invoice');
    expect(invoice.issuer.gstin).toBe('29ABCDE1234F1Z5');
  });
});

describe('GET /me/invoices/:paymentId/download', () => {
  it('returns a real PDF named for the invoice number', async () => {
    const student = await paidStudent();

    const res = await pdfRequest(`${API}/me/invoices/${student.paymentId}/download`, student.cookies).expect(200);

    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="AMIT-INV-\d{4}-[0-9A-F]{12}\.pdf"/);
    // Personal financial data behind an authorization check.
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('is idempotent: downloading four times creates nothing and returns the same number', async () => {
    const student = await paidStudent();

    const before = await Payment.countDocuments({});
    const numbers = new Set<string>();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await pdfRequest(`${API}/me/invoices/${student.paymentId}/download`, student.cookies).expect(200);
      const match = /filename="([^"]+)\.pdf"/.exec(String(res.headers['content-disposition']));
      numbers.add(match?.[1] ?? 'none');
    }

    // One number across four downloads, and not a single new document anywhere — there is
    // no `Invoice` collection to create one in, which is the point.
    expect(numbers.size).toBe(1);
    expect(await Payment.countDocuments({})).toBe(before);
  });

  it('shows what was actually charged, even after the fee is changed', async () => {
    const student = await registerVerifyLogin(app, { email: 'old@example.com', mobile: '9700000002' }, { paid: false });
    // Paid ₹100, back when that was the fee.
    const paymentId = await addPayment(student.studentId, 'captured', { amount: 10_000 });

    // The owner then raises the fee. `Payment.amount` is a snapshot, so this must not move.
    await PaymentSettings.findOneAndUpdate(
      { key: 'default' },
      { $set: { olympiadEntryFee: 19_900, entryFeeEnabled: true } },
      { upsert: true, setDefaultsOnInsert: true },
    );

    const res = await request(app)
      .get(`${API}/me/invoices/${paymentId}`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);

    const invoice = res.body.invoice as InvoicePreview;
    expect(invoice.totalPaise).toBe(10_000);
    expect(invoice.totalDisplay).toBe('₹100.00');
    expect(invoice.totalInWords).toBe('Rupees One Hundred Only');
  });

  it('renders a name in Devanagari instead of throwing', async () => {
    // Registration deliberately accepts a name in any Indian script (`\p{L}\p{M}` in
    // `authSchemas.ts`), and `StandardFonts.Helvetica` cannot encode one — pdf-lib
    // *throws* on a character outside WinAnsi rather than dropping it, so without the
    // sanitiser every such student's download would be a 500. This is the case that would
    // reach production and affect real children.
    const student = await registerVerifyLogin(
      app,
      { email: 'devanagari@example.com', mobile: '9700000011', firstName: 'अमित', lastName: 'कुमार' },
      { paid: false },
    );
    const paymentId = await addPayment(student.studentId, 'captured');

    const res = await pdfRequest(`${API}/me/invoices/${paymentId}/download`, student.cookies);

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('produces an invoice for a Class 3 student and a Class 12 student alike', async () => {
    const three = await registerVerifyLogin(
      app,
      { email: 'c3@example.com', mobile: '9700000003', classLevel: 'Class 3', dateOfBirth: '2017-05-05' },
      { paid: false },
    );
    const twelve = await registerVerifyLogin(
      app,
      { email: 'c12@example.com', mobile: '9700000004', classLevel: 'Class 12' },
      { paid: false },
    );

    for (const session of [three, twelve]) {
      const paymentId = await addPayment(session.studentId, 'captured');
      const res = await pdfRequest(`${API}/me/invoices/${paymentId}/download`, session.cookies);
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});

// ---------------------------------------------------------------------------
// Only a captured payment has an invoice
// ---------------------------------------------------------------------------

describe('a payment that took no money has no invoice', () => {
  it('refuses an attempted payment and names the state it is in', async () => {
    const student = await registerVerifyLogin(app, { email: 'att@example.com', mobile: '9700000005' }, { paid: false });
    const paymentId = await addPayment(student.studentId, 'attempted');

    const res = await request(app)
      .get(`${API}/me/invoices/${paymentId}`)
      .set('Cookie', cookieHeader(student.cookies));

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('attempted');
    expect(res.status).not.toBe(500);
  });

  it('refuses a failed payment', async () => {
    const student = await registerVerifyLogin(app, { email: 'fail@example.com', mobile: '9700000006' }, { paid: false });
    const paymentId = await addPayment(student.studentId, 'failed');

    const res = await request(app)
      .get(`${API}/me/invoices/${paymentId}`)
      .set('Cookie', cookieHeader(student.cookies));

    expect(res.status).toBe(409);
  });

  it('refuses a refunded payment with its own message', async () => {
    const student = await registerVerifyLogin(app, { email: 'ref@example.com', mobile: '9700000007' }, { paid: false });
    const paymentId = await addPayment(student.studentId, 'refunded');

    const res = await request(app)
      .get(`${API}/me/invoices/${paymentId}`)
      .set('Cookie', cookieHeader(student.cookies));

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('refunded');
  });
});

// ---------------------------------------------------------------------------
// Authorization — the part that matters most
// ---------------------------------------------------------------------------

describe('invoice access is owner-scoped', () => {
  it("does not return another student's invoice when the id is changed", async () => {
    const owner = await paidStudent();
    const stranger = await registerVerifyLogin(
      app,
      { email: 'stranger@example.com', mobile: '9700000008' },
      { paid: false },
    );

    const preview = await request(app)
      .get(`${API}/me/invoices/${owner.paymentId}`)
      .set('Cookie', cookieHeader(stranger.cookies));
    const download = await pdfRequest(`${API}/me/invoices/${owner.paymentId}/download`, stranger.cookies);

    // 404, not 403: the account is part of the query, so the row is simply not found —
    // which also means this cannot be used to discover which payment ids exist.
    expect(preview.status).toBe(404);
    expect(download.status).toBe(404);
  });

  it('refuses an anonymous caller', async () => {
    const owner = await paidStudent();

    const preview = await request(app).get(`${API}/me/invoices/${owner.paymentId}`);
    const list = await request(app).get(`${API}/me/invoices`);

    expect(preview.status).toBe(401);
    expect(list.status).toBe(401);
  });

  it('answers 400 for an id that is not an id, rather than searching for it', async () => {
    const student = await paidStudent();

    const res = await request(app)
      .get(`${API}/me/invoices/not-an-id`)
      .set('Cookie', cookieHeader(student.cookies));

    expect(res.status).toBe(400);
  });

  it('answers 404 for a well-formed id that does not exist', async () => {
    const student = await paidStudent();

    const res = await request(app)
      .get(`${API}/me/invoices/64f0a1b2c3d4e5f60718293a`)
      .set('Cookie', cookieHeader(student.cookies));

    expect(res.status).toBe(404);
  });
});

describe('staff invoice access', () => {
  it('lets an administrator download any student’s invoice', async () => {
    const owner = await paidStudent();
    const admin = await createAdminSession(app, { email: 'inv-admin@example.com', mobile: '9700000010' });

    const res = await pdfRequest(`${API}/admin/payments/${owner.paymentId}/invoice`, admin.cookies);

    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses a plain student on the staff route, on both URL prefixes', async () => {
    const owner = await paidStudent();

    const versioned = await pdfRequest(`${API}/admin/payments/${owner.paymentId}/invoice`, owner.cookies);
    const alias = await pdfRequest(`/api/admin/payments/${owner.paymentId}/invoice`, owner.cookies);

    expect(versioned.status).toBe(403);
    expect(alias.status).toBe(403);
  });

  it('refuses an anonymous caller on the staff route', async () => {
    const owner = await paidStudent();

    const res = await request(app).get(`${API}/admin/payments/${owner.paymentId}/invoice`);

    expect(res.status).toBe(401);
  });
});
