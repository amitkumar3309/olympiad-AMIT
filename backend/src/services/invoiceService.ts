import type { Types } from 'mongoose';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { config } from '../config';
import { ApiError } from '../lib/ApiError';
import { Payment, Student, type PaymentDocument, type StudentDocument } from '../models';

/**
 * Invoices for the entry fee (Milestone 22, Phase C).
 *
 * ## There is no `Invoice` collection, and there must not be one
 *
 * An invoice is a **rendering of a captured `Payment`**, not a second record of it. The
 * amount, the currency, the date, the method and both provider ids are already stored,
 * already immutable, and already the thing the money is reconciled against — writing
 * them again under another name would create a second source of truth about a
 * transaction, which is the failure mode `models/Payment.ts` opens by warning about.
 *
 * That decision is what makes every property the feature needs fall out for free:
 *
 * - **Idempotent.** Downloading is a pure read. There is nothing to create, so nothing
 *   can be created twice.
 * - **Stable.** The number is *derived* from the payment (see `invoiceNumberFor`), so the
 *   same transaction resolves to the same number on every request, for ever, with no
 *   counter to allocate and no row to keep in step.
 * - **Honest about money.** The amount comes from `Payment.amount`, which is a snapshot
 *   of what was actually charged. Re-pricing the fee cannot alter an invoice already
 *   issued — a student who paid ₹100 has an invoice for ₹100 after the fee becomes ₹199.
 *
 * ## Only a captured payment has an invoice
 *
 * A `created`, `attempted` or `failed` row is an attempt, not a transaction; issuing a
 * document that says money was received for one would be false. `refunded` is refused
 * too, and for a sharper reason: the invoice would be true of the past and read as true
 * of the present, and a refunded student holding an invoice is a support argument nobody
 * can win. Both refuse with a message saying which state the payment is actually in.
 *
 * ## What is *not* snapshotted, and why that is stated rather than hidden
 *
 * The buyer's name, class, contact and address are read from the live `Student` at render
 * time, not frozen at payment time. This is the opposite of `Certificate`, which
 * snapshots everything printable — and the difference is deliberate: a certificate is a
 * claim about a past event that must never change, whereas an invoice is addressed to a
 * person, and a person who corrects a misspelt name wants the correction to appear.
 * Every *financial* fact on the document is a snapshot; only the address block is live.
 */

// ---------------------------------------------------------------------------
// The number
// ---------------------------------------------------------------------------

/**
 * `AMIT-INV-2026-64F0A1B2C3D4`.
 *
 * **Derived, never allocated.** The year comes from the capture date and the suffix from
 * the payment's own `ObjectId`, so the number is a pure function of the transaction: the
 * same payment yields the same number on every call, in any process, for ever, and a
 * payment that predates this feature has one without a migration.
 *
 * A sequential counter (`…-000123`) was the obvious alternative and was rejected. It
 * needs either a write on a GET — which is exactly the "downloading must not create
 * anything" rule inverted — or a number allocated at capture time, which every payment
 * already in the database would lack. Uniqueness here rests on the `ObjectId`, which is
 * already unique by construction, rather than on a counter that two concurrent readers
 * could allocate twice.
 *
 * Twelve hex characters rather than the full twenty-four: an ObjectId's last six bytes
 * are its per-process random value and its counter, which is what actually distinguishes
 * two ids created in the same second, and twelve characters still fit on one printed
 * line.
 */
export function invoiceNumberFor(payment: { _id: unknown; capturedAt: Date | null; createdAt: Date }): string {
  const id = String(payment._id);
  const year = (payment.capturedAt ?? payment.createdAt).getUTCFullYear();
  return `AMIT-INV-${year}-${id.slice(-12).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Amount in words
// ---------------------------------------------------------------------------

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function underThousand(value: number): string {
  if (value < 20) return ONES[value] ?? '';
  if (value < 100) {
    const rest = value % 10;
    return `${TENS[Math.floor(value / 10)]}${rest ? ` ${ONES[rest]}` : ''}`;
  }
  const rest = value % 100;
  return `${ONES[Math.floor(value / 100)]} Hundred${rest ? ` and ${underThousand(rest)}` : ''}`;
}

/**
 * `19900` → `Rupees One Hundred and Ninety Nine Only`.
 *
 * The **Indian** grouping (crore, lakh, thousand), because that is what a reader of a
 * rupee invoice expects and a western grouping would read as a mistake. Pure and
 * total-function: every non-negative integer number of paise has an answer, including
 * zero.
 *
 * It exists because an amount in words is the conventional check against a tampered
 * figure on a printed invoice, and it is the one part of the document that cannot be
 * altered by changing a single digit.
 */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;

  const parts: string[] = [];
  let left = rupees;

  const crore = Math.floor(left / 10_000_000);
  left %= 10_000_000;
  const lakh = Math.floor(left / 100_000);
  left %= 100_000;
  const thousand = Math.floor(left / 1_000);
  left %= 1_000;

  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (left) parts.push(underThousand(left));

  const rupeeWords = parts.length > 0 ? parts.join(' ') : 'Zero';
  const paiseWords = remainder > 0 ? ` and ${underThousand(remainder)} Paise` : '';
  return `Rupees ${rupeeWords}${paiseWords} Only`;
}

// ---------------------------------------------------------------------------
// The invoice
// ---------------------------------------------------------------------------

export interface InvoiceIssuer {
  name: string;
  addressLines: string[];
  email: string;
  phone: string;
  website: string;
  /** Printed only when configured. **Never invented** — see the note in `config/env.ts`. */
  gstin: string | null;
  /** Free text for whatever is legally correct here. Printed verbatim when set. */
  taxNote: string | null;
}

export interface InvoiceData {
  invoiceNumber: string;
  /** The capture date. An invoice is dated when the money was taken, not when it was printed. */
  invoiceDate: Date;
  issuer: InvoiceIssuer;
  buyer: {
    name: string;
    studentId: string;
    email: string;
    mobile: string;
    classLevel: string | null;
    schoolName: string | null;
    address: string | null;
  };
  item: { description: string; amount: number };
  /** Paise. Equal to `item.amount`: there is exactly one line and no tax is computed. */
  totalPaise: number;
  totalDisplay: string;
  totalInWords: string;
  currency: string;
  payment: {
    id: string;
    status: 'captured';
    method: string | null;
    razorpayOrderId: string;
    razorpayPaymentId: string | null;
    capturedAt: Date;
    createdAt: Date;
  };
}

/** The issuer block, from configuration. Nothing here is invented at render time. */
function issuerFrom(): InvoiceIssuer {
  return {
    name: config.invoice.orgName,
    addressLines: config.invoice.orgAddressLines,
    email: config.invoice.orgEmail,
    phone: config.invoice.orgPhone,
    website: config.publicAppUrl,
    gstin: config.invoice.gstin,
    taxNote: config.invoice.taxNote,
  };
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/**
 * Assembles the document from a captured payment and the account that holds it.
 *
 * Refuses anything that is not `captured`, naming the state it found — "no invoice
 * exists" would send a student to support to be told the payment never completed, which
 * is a thing the page could have said itself.
 */
export function buildInvoice(payment: PaymentDocument, student: StudentDocument): InvoiceData {
  if (payment.status !== 'captured' || !payment.capturedAt) {
    throw ApiError.conflict(
      payment.status === 'refunded'
        ? 'This payment was refunded, so it has no invoice. Contact support if you need a record of the refund.'
        : `No money has been taken for this payment yet (it is ${payment.status}), so there is nothing to invoice.`,
    );
  }

  return {
    invoiceNumber: invoiceNumberFor(payment),
    invoiceDate: payment.capturedAt,
    issuer: issuerFrom(),
    buyer: {
      // `studentId` as the fallback, never a blank line: an invoice addressed to nobody
      // is worse than one addressed to an account number.
      name: student.fullName ?? student.studentId,
      studentId: student.studentId,
      email: student.email,
      mobile: student.mobile,
      classLevel: student.classLevel ?? null,
      schoolName: student.schoolName ?? null,
      address: student.address ?? null,
    },
    item: {
      description: 'AMIT Maths Olympiad — entry fee (one-off registration for the official Olympiad)',
      amount: payment.amount,
    },
    totalPaise: payment.amount,
    totalDisplay: rupees(payment.amount),
    totalInWords: amountInWords(payment.amount),
    currency: payment.currency,
    payment: {
      id: String(payment._id),
      status: 'captured',
      method: payment.method,
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: payment.razorpayPaymentId,
      capturedAt: payment.capturedAt,
      createdAt: payment.createdAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * One of the caller's **own** invoices.
 *
 * The account is part of the **query**, not a check after the read, so there is no path
 * where a payment is fetched and then compared — the pattern every owner-scoped route in
 * this product follows, and the reason the security audit found no IDOR. Somebody else's
 * payment id is simply not found, which also means this cannot be used to discover
 * whether an id exists.
 */
export async function invoiceForStudent(paymentId: string, student: Types.ObjectId): Promise<InvoiceData> {
  const payment = await Payment.findOne({ _id: paymentId, student });
  if (!payment) throw ApiError.notFound('No payment of yours with that id.');

  const account = await Student.findById(student);
  if (!account) throw ApiError.notFound('No account found.');

  return buildInvoice(payment, account);
}

/**
 * Any invoice, for staff.
 *
 * Gated at the route on `students:read`, matching `/admin/payments` — it discloses who
 * paid what, which is student account data, and the set of people who may already read a
 * student's record is the same set that should be able to reissue their receipt.
 */
export async function invoiceForStaff(paymentId: string): Promise<InvoiceData> {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw ApiError.notFound('No payment with that id.');

  const account = await Student.findById(payment.student);
  if (!account) throw ApiError.notFound('The account this payment belongs to no longer exists.');

  return buildInvoice(payment, account);
}

/** Every payment of the caller's that has an invoice — i.e. every captured one. */
export async function listInvoicesFor(student: Types.ObjectId): Promise<InvoiceData[]> {
  const payments = await Payment.find({ student, status: 'captured' }).sort({ capturedAt: -1 }).limit(50);
  const account = await Student.findById(student);
  if (!account) throw ApiError.notFound('No account found.');
  return payments.map((payment) => buildInvoice(payment, account));
}

/** What the preview endpoint returns. Dates as ISO strings; no field the PDF lacks. */
export function invoiceView(invoice: InvoiceData) {
  return {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    issuer: invoice.issuer,
    buyer: invoice.buyer,
    item: { description: invoice.item.description, amount: invoice.item.amount, amountDisplay: rupees(invoice.item.amount) },
    totalPaise: invoice.totalPaise,
    totalDisplay: invoice.totalDisplay,
    totalInWords: invoice.totalInWords,
    currency: invoice.currency,
    payment: invoice.payment,
    /** So a client need not decide from the presence of `gstin` what to title the page. */
    title: invoice.issuer.gstin ? 'Tax Invoice' : 'Invoice',
  };
}

/** The download filename: the invoice number, which is already unique and readable. */
export function invoiceFilenameFor(invoice: InvoiceData): string {
  return `${invoice.invoiceNumber}.pdf`;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const NAVY = rgb(0.05, 0.11, 0.24);
const INK = rgb(0.13, 0.22, 0.47);
const SLATE = rgb(0.35, 0.39, 0.45);
const RULE = rgb(0.82, 0.84, 0.88);
const GOLD = rgb(0.831, 0.686, 0.216);
const PANEL = rgb(0.965, 0.969, 0.98);

/** A4 portrait, in points. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const RIGHT = PAGE_WIDTH - MARGIN;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function drawRight(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color = NAVY): void {
  page.drawText(text, { x: RIGHT - font.widthOfTextAtSize(text, size), y, size, font, color });
}

/**
 * Wraps to a width, because an address is free text a student typed and a 500-character
 * one would otherwise run off the page and out of the document.
 */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * `₹` is not in `StandardFonts.Helvetica`'s WinAnsi encoding, and pdf-lib **throws** on a
 * character it cannot encode rather than dropping it — so every amount on the page would
 * take the whole download down with a 500.
 *
 * Embedding a Unicode font would mean shipping a font binary in the repository, which the
 * certificate deliberately avoids for the same reason (see `renderCertificatePdf`). `Rs.`
 * is unambiguous on an INR invoice, prints everywhere, and costs nothing.
 */
function money(paise: number): string {
  return `Rs. ${(paise / 100).toFixed(2)}`;
}

/** Replaces anything WinAnsi cannot encode, so free text a student typed cannot 500. */
function printable(text: string): string {
  return text
    .replace(/₹/g, 'Rs. ')
    .replace(/[—–]/g, '-')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    // Anything still outside Latin-1 (a name in Devanagari, an emoji in an address) is
    // dropped rather than allowed to throw. Losing a character beats losing the document.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

function drawHeader(page: PDFPage, fonts: Fonts, invoice: InvoiceData): number {
  let y = PAGE_HEIGHT - MARGIN - 12;

  page.drawText(printable(invoice.issuer.name), { x: MARGIN, y, size: 18, font: fonts.bold, color: NAVY });
  drawRight(page, invoice.issuer.gstin ? 'TAX INVOICE' : 'INVOICE', fonts.bold, 18, y, GOLD);
  y -= 16;

  // The issuer block: only lines that are actually configured. An invoice with a blank
  // address line looks like a document that failed to render.
  const issuerLines = [
    ...invoice.issuer.addressLines,
    `${invoice.issuer.email} · ${invoice.issuer.phone}`,
    invoice.issuer.website,
    ...(invoice.issuer.gstin ? [`GSTIN: ${invoice.issuer.gstin}`] : []),
  ];
  for (const line of issuerLines) {
    page.drawText(printable(line), { x: MARGIN, y, size: 8.5, font: fonts.regular, color: SLATE });
    y -= 11;
  }

  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 1.2, color: GOLD });
  return y - 24;
}

function drawMeta(page: PDFPage, fonts: Fonts, invoice: InvoiceData, top: number): number {
  const rows: Array<[string, string]> = [
    ['Invoice number', invoice.invoiceNumber],
    ['Invoice date', invoice.invoiceDate.toISOString().slice(0, 10)],
    ['Payment date', invoice.payment.capturedAt.toISOString().slice(0, 10)],
    ['Status', 'PAID'],
  ];

  let y = top;
  for (const [label, value] of rows) {
    page.drawText(label, { x: PAGE_WIDTH / 2 + 10, y, size: 9, font: fonts.regular, color: SLATE });
    drawRight(page, printable(value), fonts.bold, 9, y, NAVY);
    y -= 14;
  }
  return y;
}

function drawBuyer(page: PDFPage, fonts: Fonts, invoice: InvoiceData, top: number): number {
  let y = top;
  page.drawText('BILLED TO', { x: MARGIN, y, size: 8, font: fonts.bold, color: SLATE });
  y -= 15;

  page.drawText(printable(invoice.buyer.name), { x: MARGIN, y, size: 12, font: fonts.bold, color: NAVY });
  y -= 14;

  const lines = [
    `Student ID: ${invoice.buyer.studentId}`,
    ...(invoice.buyer.classLevel ? [invoice.buyer.classLevel] : []),
    ...(invoice.buyer.schoolName ? [invoice.buyer.schoolName] : []),
    invoice.buyer.email,
    invoice.buyer.mobile,
  ];
  for (const line of lines) {
    page.drawText(printable(line), { x: MARGIN, y, size: 9, font: fonts.regular, color: INK });
    y -= 12;
  }

  if (invoice.buyer.address) {
    for (const line of wrap(printable(invoice.buyer.address), fonts.regular, 9, PAGE_WIDTH / 2 - MARGIN)) {
      page.drawText(line, { x: MARGIN, y, size: 9, font: fonts.regular, color: SLATE });
      y -= 11;
    }
  }

  return y;
}

function drawItems(page: PDFPage, fonts: Fonts, invoice: InvoiceData, top: number): number {
  let y = top;

  page.drawRectangle({ x: MARGIN, y: y - 6, width: RIGHT - MARGIN, height: 22, color: PANEL });
  page.drawText('DESCRIPTION', { x: MARGIN + 10, y, size: 8, font: fonts.bold, color: SLATE });
  drawRight(page, 'AMOUNT', fonts.bold, 8, y, SLATE);
  y -= 26;

  const description = wrap(printable(invoice.item.description), fonts.regular, 10, RIGHT - MARGIN - 140);
  const firstLine = description[0] ?? '';
  page.drawText(firstLine, { x: MARGIN + 10, y, size: 10, font: fonts.regular, color: NAVY });
  drawRight(page, money(invoice.item.amount), fonts.regular, 10, y, NAVY);
  y -= 13;

  for (const line of description.slice(1)) {
    page.drawText(line, { x: MARGIN + 10, y, size: 10, font: fonts.regular, color: NAVY });
    y -= 13;
  }

  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.6, color: RULE });
  y -= 20;

  page.drawText('Total paid', { x: PAGE_WIDTH / 2 + 10, y, size: 11, font: fonts.bold, color: NAVY });
  drawRight(page, money(invoice.totalPaise), fonts.bold, 13, y, NAVY);
  y -= 18;

  page.drawText(printable(invoice.totalInWords), { x: MARGIN, y, size: 9, font: fonts.regular, color: SLATE });
  y -= 20;

  /**
   * Tax appears **only** when the deployment has configured it. With no GSTIN and no tax
   * note, the document says nothing about tax at all — rather than printing "Tax: ₹0.00"
   * or "inclusive of all taxes", either of which is a legal claim this code is in no
   * position to make. See the Phase C ADR.
   */
  if (invoice.issuer.taxNote) {
    for (const line of wrap(printable(invoice.issuer.taxNote), fonts.regular, 8.5, RIGHT - MARGIN)) {
      page.drawText(line, { x: MARGIN, y, size: 8.5, font: fonts.regular, color: SLATE });
      y -= 11;
    }
    y -= 8;
  }

  return y;
}

function drawPaymentPanel(page: PDFPage, fonts: Fonts, invoice: InvoiceData, top: number): number {
  const rows: Array<[string, string]> = [
    ['Payment method', invoice.payment.method ?? 'Razorpay'],
    ['Order ID', invoice.payment.razorpayOrderId],
    ...(invoice.payment.razorpayPaymentId ? ([['Payment ID', invoice.payment.razorpayPaymentId]] as Array<[string, string]>) : []),
    ['Received on', invoice.payment.capturedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'],
  ];

  const height = rows.length * 14 + 26;
  page.drawRectangle({ x: MARGIN, y: top - height + 14, width: RIGHT - MARGIN, height, color: PANEL });

  let y = top - 4;
  page.drawText('PAYMENT DETAILS', { x: MARGIN + 10, y, size: 8, font: fonts.bold, color: SLATE });
  y -= 16;

  for (const [label, value] of rows) {
    page.drawText(label, { x: MARGIN + 10, y, size: 9, font: fonts.regular, color: SLATE });
    page.drawText(printable(value), { x: MARGIN + 130, y, size: 9, font: fonts.bold, color: INK });
    y -= 14;
  }

  return y - 16;
}

/**
 * Renders the invoice.
 *
 * Server-side, from database values only — the browser supplies an id and nothing else,
 * which is the same rule the certificate follows. A client-rendered invoice is a document
 * whose amount is whatever the client felt like.
 *
 * `pdf-lib` because it is already the project's PDF library, is pure JavaScript with no
 * native binary and no headless browser, and therefore runs inside a Vercel serverless
 * function on the free tier.
 */
export async function renderInvoicePdf(invoice: InvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${invoice.invoiceNumber} — ${invoice.issuer.name}`);
  doc.setAuthor(invoice.issuer.name);
  doc.setSubject('Olympiad entry fee');
  doc.setProducer('A.M.I.T Olympiad platform');

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const afterHeader = drawHeader(page, fonts, invoice);
  const afterBuyer = drawBuyer(page, fonts, invoice, afterHeader);
  const afterMeta = drawMeta(page, fonts, invoice, afterHeader);
  const afterItems = drawItems(page, fonts, invoice, Math.min(afterBuyer, afterMeta) - 30);
  drawPaymentPanel(page, fonts, invoice, afterItems);

  // --- Footer ------------------------------------------------------------
  page.drawLine({ start: { x: MARGIN, y: 78 }, end: { x: RIGHT, y: 78 }, thickness: 0.6, color: RULE });
  page.drawText('This is a computer-generated invoice and is valid without a signature.', {
    x: MARGIN,
    y: 62,
    size: 8,
    font: fonts.regular,
    color: SLATE,
  });
  page.drawText(printable(`Questions about this payment? ${invoice.issuer.email} · quote ${invoice.invoiceNumber}`), {
    x: MARGIN,
    y: 50,
    size: 8,
    font: fonts.regular,
    color: SLATE,
  });
  drawRight(page, printable(invoice.issuer.name), fonts.bold, 8, 50, SLATE);

  return doc.save();
}
