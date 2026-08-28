import type { Workbook, Worksheet } from 'exceljs' with { 'resolution-mode': 'import' };
import type { StudentDirectoryEntry, StudentDirectoryFilters, StudentPaymentState } from './studentDirectoryService';

/**
 * The student registration export (Milestone 22, Phase B) — the `.xlsx` an administrator
 * downloads from the student directory.
 *
 * ## It renders; it does not query
 *
 * Every row handed to this file has already been through
 * `services/studentDirectoryService.ts`, which is the same code path the on-screen table
 * uses. That is the point: an export with its own query is an export that disagrees with
 * the screen the administrator was looking at. This file's only job is to turn rows into
 * cells.
 *
 * ## What may not be in here
 *
 * There is no password, no hash, no token, no refresh-token family, no API key, no
 * Razorpay signature and no session state — and the reason is structural rather than
 * careful: this file can only write what `StudentDirectoryEntry` contains, and that view
 * is an explicit allow-list built by a pipeline that projects fields by name. Adding a
 * secret to this spreadsheet would take a deliberate change in two other files first.
 *
 * ## Types, not strings
 *
 * Dates are written as real dates with a number format, and money as a real number with a
 * currency format, rather than as pre-formatted text. An administrator's first act with
 * this file is a pivot table or a sort, and a column of `"₹100.00"` strings sorts
 * alphabetically and sums to zero.
 */

/**
 * `exceljs` is CommonJS and requires cleanly, but its typings are only reachable as an
 * ESM import — hence the `with { 'resolution-mode': 'import' }` type-only import above and
 * the `require` here. Identical to the arrangement in `services/excelImportParser.ts`; see
 * the longer note there.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS, see above
const exceljs = require('exceljs') as typeof import('exceljs', { with: { 'resolution-mode': 'import' } });

/** How each derived payment state is spelled for a human reading the spreadsheet. */
const PAYMENT_STATE_LABELS: Record<StudentPaymentState, string> = {
  paid: 'Paid',
  pending: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
  not_started: 'Not started',
};

interface Column {
  header: string;
  width: number;
  /** `date` and `money` get a number format; everything else is written as-is. */
  kind?: 'date' | 'datetime' | 'money';
  value: (entry: StudentDirectoryEntry) => string | number | Date | null;
}

/**
 * The columns, in the order they appear.
 *
 * Every one of them reads a field the platform genuinely stores. There is no column here
 * that the application cannot fill — the same rule the question-import template follows,
 * for the same reason: a column an administrator fills in by hand is data the product will
 * never see again.
 */
const COLUMNS: Column[] = [
  { header: 'Student ID', width: 14, value: (e) => e.studentId },
  { header: 'Full Name', width: 26, value: (e) => e.fullName },
  { header: 'Class', width: 12, value: (e) => e.classLevel },
  { header: 'Email', width: 30, value: (e) => e.email },
  { header: 'Phone', width: 16, value: (e) => e.mobile },
  { header: 'School', width: 30, value: (e) => e.schoolName },
  { header: "Father's Name", width: 24, value: (e) => e.fatherName },
  { header: "Mother's Name", width: 24, value: (e) => e.motherName },
  { header: 'Date of Birth', width: 14, value: (e) => e.dateOfBirth },
  { header: 'Address', width: 40, value: (e) => e.address },
  { header: 'Registration Date', width: 20, kind: 'datetime', value: (e) => new Date(e.registeredAt) },
  { header: 'Account Status', width: 14, value: (e) => e.status },
  { header: 'Email Verified', width: 14, value: (e) => (e.isEmailVerified ? 'Yes' : 'No') },
  { header: 'Role', width: 12, value: (e) => e.role },
  { header: 'Payment Status', width: 16, value: (e) => PAYMENT_STATE_LABELS[e.paymentState] },
  {
    header: 'Payment Amount',
    width: 16,
    kind: 'money',
    // Rupees, because that is the unit a human reconciles in — the stored value is paise
    // and stays paise everywhere inside the application.
    value: (e) => (e.payment ? e.payment.amount / 100 : null),
  },
  { header: 'Currency', width: 10, value: (e) => e.payment?.currency ?? null },
  {
    header: 'Payment Date',
    width: 20,
    kind: 'datetime',
    // The capture date, never the order date: this column answers "when was the money
    // taken?", and an abandoned checkout has an order date but took nothing.
    value: (e) => (e.payment?.capturedAt ? new Date(e.payment.capturedAt) : null),
  },
  { header: 'Payment Method', width: 14, value: (e) => e.payment?.method ?? null },
  { header: 'Order ID', width: 26, value: (e) => e.payment?.razorpayOrderId ?? null },
  { header: 'Payment ID', width: 26, value: (e) => e.payment?.razorpayPaymentId ?? null },
  { header: 'Payment Attempts', width: 18, value: (e) => e.paymentAttempts },
  { header: 'Failure Reason', width: 32, value: (e) => e.payment?.failureReason ?? null },
  // Referral columns (Milestone 22, Phase E). Absent from Phase B on purpose: the data did
  // not exist then, and a column the application cannot fill is not a column.
  { header: 'Referral Code', width: 16, value: (e) => e.referralCode },
  { header: 'Referred By', width: 26, value: (e) => (e.referredBy ? e.referredBy.fullName ?? e.referredBy.studentId : null) },
  { header: 'Referred By ID', width: 16, value: (e) => e.referredBy?.studentId ?? null },
  { header: 'Last Sign-in', width: 20, kind: 'datetime', value: (e) => (e.lastLoginAt ? new Date(e.lastLoginAt) : null) },
];

export interface ExportMeta {
  /** One line saying exactly what this file contains. Written into the sheet. */
  description: string;
  /** When it was produced, so a file found on a desk later can be dated. */
  generatedAt: Date;
  /** Who produced it — `AMIT_xxxx` / `ADMIN_xxxx`, never an email or a name. */
  generatedBy: string;
}

function writeCoverNotes(sheet: Worksheet, meta: ExportMeta, rowCount: number): void {
  /**
   * A second sheet rather than banner rows above the table.
   *
   * The data sheet has to start at row 1 with the header, because the first thing anybody
   * does to it is filter or import it, and a title row above a header is precisely the
   * shape that makes an importer read the title as the header — a defect this project has
   * already had once, in the opposite direction, in `excelImportParser.ts`.
   */
  sheet.columns = [
    { header: 'Field', width: 22 },
    { header: 'Value', width: 90 },
  ];
  sheet.getRow(1).font = { bold: true };

  sheet.addRow(['Export', meta.description]);
  sheet.addRow(['Students in this file', rowCount]);
  sheet.addRow(['Generated at', meta.generatedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC']);
  sheet.addRow(['Generated by', meta.generatedBy]);
  sheet.addRow([
    'Payment status',
    'Derived from the student’s Razorpay entry-fee records at the moment this file was produced. ' +
      'Paid = a captured payment exists. Pending = an order was created and has not resolved. ' +
      'Failed = the latest attempt failed and none succeeded. Refunded = money was returned. ' +
      'Not started = the student has never opened a checkout.',
  ]);
  sheet.addRow([
    'Contains',
    'Registration and payment details only. No password, password hash, authentication token, ' +
      'API key or payment signature is exported.',
  ]);
  sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
}

/**
 * Builds the workbook.
 *
 * Two sheets: `Students` (the table, header in row 1, frozen and auto-filtered) and
 * `About this export` (what it is, when, by whom, and what "Paid" means). The second sheet
 * exists because this file leaves the platform — it gets emailed, filed and opened months
 * later by somebody who was not in the room, and a spreadsheet that cannot say what its
 * "Payment Status" column was derived from invites a wrong conclusion about the money.
 */
export async function buildStudentExportWorkbook(
  entries: StudentDirectoryEntry[],
  meta: ExportMeta,
): Promise<Buffer> {
  const workbook: Workbook = new exceljs.Workbook();
  workbook.creator = 'AMIT Maths Olympiad';
  workbook.created = meta.generatedAt;

  const sheet = workbook.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map((column) => ({ header: column.header, width: column.width }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };

  for (const entry of entries) {
    // `null` for an absent value rather than an empty string, so a blank cell stays blank
    // rather than becoming a zero-length string that a filter counts as a value.
    sheet.addRow(COLUMNS.map((column) => column.value(entry) ?? null));
  }

  // Number formats are applied per column after the rows exist. Dates written as real
  // dates sort and filter as dates; money written as a real number sums.
  COLUMNS.forEach((column, index) => {
    if (!column.kind) return;
    const target = sheet.getColumn(index + 1);
    if (column.kind === 'date') target.numFmt = 'yyyy-mm-dd';
    if (column.kind === 'datetime') target.numFmt = 'yyyy-mm-dd hh:mm';
    // Rupees to two places. `#,##0.00` rather than a `₹` prefix baked into the format, so
    // the Currency column stays the authority on what the number is denominated in.
    if (column.kind === 'money') target.numFmt = '#,##0.00';
  });

  // An auto-filter over the header, because the first thing a competition desk does with
  // this file is narrow it. Only added when there is something to filter.
  if (entries.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  }

  writeCoverNotes(workbook.addWorksheet('About this export'), meta, entries.length);

  /**
   * `writeBuffer()` is typed as exceljs's own `Buffer` alias, which under this project's
   * `@types/node` is structurally `ArrayBuffer` rather than Node's `Buffer<ArrayBufferLike>`.
   * Going via `Uint8Array` is the one conversion true of both at runtime — the same note
   * applies in `services/excelImportParser.ts`.
   */
  const written = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
  return Buffer.from(written);
}

/**
 * The most students one export may contain.
 *
 * A bound on memory and on time inside a serverless function, not a product rule: the whole
 * result set is held in an in-memory workbook, and a free-tier function has neither the RAM
 * nor the seconds for an unbounded one. Twenty thousand is far above any plausible cohort
 * for this competition and low enough to fail before the platform does. Exceeding it is
 * **refused with a message**, never quietly truncated — see the export route.
 */
export const EXPORT_MAX_ROWS = 20_000;

/**
 * One plain sentence saying what this file contains, written onto the cover sheet.
 *
 * It exists because the export leaves the platform. Somebody opening
 * `students-export-2026-08-28.xlsx` in November has no idea whether it is everybody or
 * just Class 8 who paid, and a filtered export mistaken for a complete one is a wrong
 * headcount in whatever it gets pasted into.
 */
export function describeExport(scope: 'filtered' | 'all', filters: StudentDirectoryFilters): string {
  if (scope === 'all') return 'Every registered student, with no filters applied.';

  const applied: string[] = [];
  if (filters.search) applied.push(`matching “${filters.search}”`);
  if (filters.classLevel) applied.push(filters.classLevel);
  if (filters.paymentState) applied.push(`payment status “${PAYMENT_STATE_LABELS[filters.paymentState]}”`);
  if (filters.status) applied.push(`account status “${filters.status}”`);
  if (filters.role) applied.push(`role “${filters.role}”`);
  if (filters.verified) applied.push(filters.verified === 'true' ? 'email verified' : 'email not verified');
  if (filters.registeredFrom) applied.push(`registered on or after ${filters.registeredFrom.toISOString().slice(0, 10)}`);
  if (filters.registeredTo) applied.push(`registered on or before ${filters.registeredTo.toISOString().slice(0, 10)}`);

  // No filters and `scope: 'filtered'` really is everybody, and says so — rather than
  // "Students matching:" trailing off into nothing.
  if (applied.length === 0) return 'Every registered student (no filters were applied).';
  return `Students filtered by: ${applied.join('; ')}.`;
}

/**
 * The filename the browser saves it as: `students-export-YYYY-MM-DD.xlsx`.
 *
 * Dated rather than versioned, because two exports taken on different days are genuinely
 * different documents and the one thing anybody needs to tell them apart is when it was
 * taken.
 */
export function studentExportFilename(generatedAt: Date): string {
  return `students-export-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
}

/** The column headings, exported so a test can assert what the file does and does not carry. */
export const STUDENT_EXPORT_HEADERS = COLUMNS.map((column) => column.header);
