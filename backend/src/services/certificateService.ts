import crypto from 'crypto';
import type { Types } from 'mongoose';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { config } from '../config';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import {
  Certificate,
  CERTIFICATE_TIER_TITLES,
  Exam,
  Result,
  Student,
  type CertificateDocument,
  type CertificateTier,
  type ExamDocument,
  type ResultDocument,
  type StudentDocument,
} from '../models';

/**
 * Certificates for the official Olympiad (Milestone 13).
 *
 * ## The one rule this file exists to enforce
 *
 * A certificate can only come from a **published `Result`**, which can only come from a
 * **submitted `ExamAttempt`** on an **official `Exam`**. There is no path from a mock
 * test, a practice session or a daily challenge, and no route anywhere lets a human —
 * student *or* administrator — nominate who gets one. `issueForExam()` is called by the
 * result-publication step and by nothing else.
 *
 * That is deliberate and it is the difference between this and what the product had
 * before: the old certificate page printed "For outstanding participation and
 * achievement" for anybody who was signed in, dated today, with their student ID as the
 * certificate number. The frontend cannot manufacture eligibility here because the
 * frontend is never asked — the PDF is rendered by the backend from a snapshot the
 * backend wrote.
 *
 * ## Tiers
 *
 * Everyone who submitted gets Participation. `meritThresholdPercent` and
 * `distinctionThresholdPercent` come off the **exam**, because papers differ in
 * difficulty, and are snapshotted onto the certificate so re-tuning next year's
 * thresholds cannot change what an old certificate claims.
 */

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * The tier a published result earns.
 *
 * Never returns `null`: sitting the paper is itself the qualification for
 * Participation. A student who scored badly still sat a national olympiad, and the
 * owner's choice was that this should be recognised rather than ignored. Exclusion
 * would also make the certificate library empty for most entrants, which is the
 * outcome the tiering was chosen to avoid.
 */
export function tierFor(percentage: number, exam: Pick<ExamDocument, 'meritThresholdPercent' | 'distinctionThresholdPercent'>): CertificateTier {
  if (percentage >= exam.distinctionThresholdPercent) return 'distinction';
  if (percentage >= exam.meritThresholdPercent) return 'merit';
  return 'participation';
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * The public verification code.
 *
 * 16 characters from a 32-symbol alphabet is ~80 bits — infeasible to guess. The
 * alphabet omits `0`/`O` and `1`/`I`/`L`, because this gets read off a printed
 * certificate and typed into a form by hand, and a code that is misread is a code that
 * makes a genuine certificate look forged.
 *
 * It is separate from `certificateId` on purpose: the serial is readable and
 * effectively guessable, so keying verification on it would let anybody walk the
 * numbers and harvest the name, school and rank of every entrant.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateVerificationCode(): string {
  let out = '';
  for (let i = 0; i < 16; i += 1) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  // Grouped for legibility when read aloud or copied off paper.
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12)}`;
}

/** `AMIT-CERT-2026-000123`. Readable, orderable, and printed prominently. */
function serialFor(year: number, sequence: number): string {
  return `AMIT-CERT-${year}-${String(sequence).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

export interface IssueOutcome {
  issued: number;
  /** Already held a certificate for this exam — the idempotent path, not an error. */
  skipped: number;
}

/**
 * Issues a certificate for one published result.
 *
 * Idempotent by the unique index on `{student, exam}`: republishing an exam's results
 * re-runs issuance and the second run is a duplicate-key error rather than a second
 * certificate for the same sitting. That is why the duplicate is swallowed and
 * reported as `skipped` rather than thrown.
 */
async function issueForResult(
  result: ResultDocument,
  exam: ExamDocument,
  student: StudentDocument,
  issuedBy: string,
  now: Date,
): Promise<CertificateDocument | null> {
  const year = now.getUTCFullYear();

  // The serial is derived from a count, which two concurrent publications could read
  // identically — so the unique index decides and we retry on collision, the same
  // pattern registration uses for `studentId`.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const used = await Certificate.countDocuments({ certificateId: new RegExp(`^AMIT-CERT-${year}-`) });
    try {
      return await Certificate.create({
        certificateId: serialFor(year, used + 1 + attempt),
        verificationCode: generateVerificationCode(),
        student: student._id,
        exam: exam._id,
        result: result._id,
        tier: tierFor(result.percentage, exam),

        // --- Snapshot. Frozen here; never re-joined at render time. ---
        studentName: student.fullName ?? student.studentId,
        studentIdLabel: student.studentId,
        classLevel: student.classLevel ?? exam.classLevel,
        schoolName: student.schoolName ?? null,
        examTitle: exam.title,
        examCode: exam.examCode,
        score: result.score,
        maxMarks: result.maxMarks,
        percentage: result.percentage,
        rank: result.rank,
        totalCandidates: result.totalCandidates,
        meritThresholdPercent: exam.meritThresholdPercent,
        distinctionThresholdPercent: exam.distinctionThresholdPercent,

        issuedAt: now,
        issuedBy,
      });
    } catch (err) {
      const duplicate = typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
      if (!duplicate) throw err;

      const keyPattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
      // A duplicate on {student, exam} is the idempotent case: this student already
      // holds a certificate for this sitting, which is correct and not an error.
      if ('student' in keyPattern || 'exam' in keyPattern) return null;
      // Otherwise it was the serial or the code, and the next iteration retries.
    }
  }

  logger.error({ studentId: student.studentId, examCode: exam.examCode }, 'Could not allocate a unique certificate id');
  throw ApiError.conflict('Could not allocate a certificate number. Please try again.');
}

/**
 * Issues certificates for every published result of one exam.
 *
 * The **only** issuance path in the product, called by result publication. Nothing
 * else in the codebase creates a `Certificate`.
 */
export async function issueForExam(exam: ExamDocument, issuedBy: string, now = new Date()): Promise<IssueOutcome> {
  const results = await Result.find({ exam: exam._id, isPublished: true });

  let issued = 0;
  let skipped = 0;

  for (const result of results) {
    const student = await Student.findById(result.student);
    if (!student) {
      // The account was deleted between publication and issuance. Nothing to print a
      // name on, so nothing is issued — and it is logged rather than guessed at.
      logger.warn({ resultId: String(result._id) }, 'Skipping certificate: the account no longer exists');
      skipped += 1;
      continue;
    }

    const certificate = await issueForResult(result, exam, student, issuedBy, now);
    if (certificate) issued += 1;
    else skipped += 1;
  }

  return { issued, skipped };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerificationResult {
  valid: boolean;
  status: 'valid' | 'revoked' | 'not-found';
  certificate?: {
    certificateId: string;
    tier: CertificateTier;
    title: string;
    studentName: string;
    studentIdLabel: string;
    classLevel: string;
    schoolName: string | null;
    examTitle: string;
    examCode: string;
    score: number;
    maxMarks: number;
    percentage: number;
    rank: number;
    totalCandidates: number;
    issuedAt: Date;
  };
  revokedAt?: Date | null;
  revokedReason?: string | null;
}

/**
 * Public verification, keyed on the verification code.
 *
 * A revoked certificate reports `revoked` rather than `not-found`, and that distinction
 * is the useful one: a printed copy exists in the world regardless of what the database
 * says, so somebody holding it needs to be told it has been withdrawn — not that it
 * never existed, which reads as a system fault.
 *
 * Everything returned is the certificate's own snapshot, so verification confirms the
 * document in somebody's hand rather than what the live records happen to say today.
 */
export async function verifyByCode(code: string): Promise<VerificationResult> {
  const normalised = code.trim().toUpperCase();
  const certificate = await Certificate.findOne({ verificationCode: normalised });

  if (!certificate) return { valid: false, status: 'not-found' };

  const snapshot = {
    certificateId: certificate.certificateId,
    tier: certificate.tier,
    title: CERTIFICATE_TIER_TITLES[certificate.tier],
    studentName: certificate.studentName,
    studentIdLabel: certificate.studentIdLabel,
    classLevel: certificate.classLevel,
    schoolName: certificate.schoolName ?? null,
    examTitle: certificate.examTitle,
    examCode: certificate.examCode,
    score: certificate.score,
    maxMarks: certificate.maxMarks,
    percentage: certificate.percentage,
    rank: certificate.rank,
    totalCandidates: certificate.totalCandidates,
    issuedAt: certificate.issuedAt,
  };

  if (certificate.revokedAt) {
    return {
      valid: false,
      status: 'revoked',
      certificate: snapshot,
      revokedAt: certificate.revokedAt,
      revokedReason: certificate.revokedReason ?? null,
    };
  }

  return { valid: true, status: 'valid', certificate: snapshot };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** #D4AF37 — the gold used for the border accents and the founder's signature. */
const GOLD = rgb(0.831, 0.686, 0.216);
const DEEP_GOLD = rgb(0.65, 0.51, 0.11);
const NAVY = rgb(0.05, 0.11, 0.24);
const INK = rgb(0.13, 0.22, 0.47);
const SLATE = rgb(0.35, 0.39, 0.45);

/** A4 landscape, in points. */
const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;

function centreText(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color = NAVY): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, size, font, color });
}

/**
 * The official AMIT OLYMPIAD seal, drawn rather than embedded.
 *
 * Generated from primitives so there is no image asset to lose, no binary in the
 * repository, and nothing to go stale — the seal is defined by this function and is
 * identical on every certificate. Concentric rings plus centred text reads
 * unmistakably as a stamp at print size, and drawing it means it stays crisp at any
 * scale, which a small embedded PNG would not.
 */
function drawSeal(page: PDFPage, cx: number, cy: number, bold: PDFFont, regular: PDFFont): void {
  page.drawCircle({ x: cx, y: cy, size: 52, borderColor: INK, borderWidth: 2.4, opacity: 0 });
  page.drawCircle({ x: cx, y: cy, size: 44, borderColor: INK, borderWidth: 0.9, opacity: 0 });

  // A ring of small marks, which is what makes it read as an impression rather than
  // as two plain circles.
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    page.drawCircle({
      x: cx + Math.cos(angle) * 48,
      y: cy + Math.sin(angle) * 48,
      size: 1.1,
      color: INK,
    });
  }

  const lines: Array<{ text: string; font: PDFFont; size: number; dy: number }> = [
    { text: 'A.M.I.T', font: bold, size: 14, dy: 12 },
    { text: 'OLYMPIAD', font: bold, size: 10, dy: -2 },
    { text: 'OFFICIAL SEAL', font: regular, size: 6.5, dy: -20 },
  ];

  for (const line of lines) {
    const width = line.font.widthOfTextAtSize(line.text, line.size);
    page.drawText(line.text, { x: cx - width / 2, y: cy + line.dy, size: line.size, font: line.font, color: INK });
  }

  // The rule between the name and the legend.
  page.drawLine({
    start: { x: cx - 26, y: cy - 9 },
    end: { x: cx + 26, y: cy - 9 },
    thickness: 0.8,
    color: INK,
  });
}

/**
 * Renders the certificate as a PDF, entirely from its own snapshot.
 *
 * Nothing here reads `Student`, `Exam` or `Result`. That is what makes the document
 * stable: correcting a name or re-tuning a threshold years later cannot alter a
 * certificate already in somebody's hands, and verification confirms the same text
 * that was printed.
 *
 * `pdf-lib` was chosen because it is pure JavaScript with no native binary and no
 * headless browser, so it works inside a Vercel serverless function on the free tier —
 * the ₹0 constraint in CLAUDE.md rules out both a rendering service and Puppeteer's
 * ~300 MB Chromium.
 */
export async function renderCertificatePdf(certificate: CertificateDocument): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${CERTIFICATE_TIER_TITLES[certificate.tier]} — ${certificate.studentName}`);
  doc.setAuthor('A.M.I.T Maths Olympiad');
  doc.setSubject(`${certificate.examTitle} (${certificate.examCode})`);
  doc.setProducer('A.M.I.T Olympiad platform');

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // --- Frame -------------------------------------------------------------
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(0.996, 0.992, 0.976) });
  page.drawRectangle({
    x: 18,
    y: 18,
    width: PAGE_WIDTH - 36,
    height: PAGE_HEIGHT - 36,
    borderColor: GOLD,
    borderWidth: 3,
    opacity: 0,
  });
  page.drawRectangle({
    x: 27,
    y: 27,
    width: PAGE_WIDTH - 54,
    height: PAGE_HEIGHT - 54,
    borderColor: DEEP_GOLD,
    borderWidth: 0.8,
    opacity: 0,
  });

  // --- Header ------------------------------------------------------------
  centreText(page, 'A.M.I.T MATHS OLYMPIAD', serifBold, 26, PAGE_HEIGHT - 88, NAVY);
  centreText(page, 'NATIONAL LEVEL MATHEMATICS OLYMPIAD', sans, 9, PAGE_HEIGHT - 106, SLATE);

  page.drawLine({
    start: { x: PAGE_WIDTH / 2 - 90, y: PAGE_HEIGHT - 120 },
    end: { x: PAGE_WIDTH / 2 + 90, y: PAGE_HEIGHT - 120 },
    thickness: 1.2,
    color: GOLD,
  });

  // --- Award -------------------------------------------------------------
  centreText(page, CERTIFICATE_TIER_TITLES[certificate.tier].toUpperCase(), serifBold, 30, PAGE_HEIGHT - 168, DEEP_GOLD);
  centreText(page, 'This is to certify that', serif, 12, PAGE_HEIGHT - 202, SLATE);

  centreText(page, certificate.studentName, serifBold, 32, PAGE_HEIGHT - 244, NAVY);
  page.drawLine({
    start: { x: PAGE_WIDTH / 2 - 190, y: PAGE_HEIGHT - 254 },
    end: { x: PAGE_WIDTH / 2 + 190, y: PAGE_HEIGHT - 254 },
    thickness: 0.6,
    color: GOLD,
  });

  const school = certificate.schoolName ? `, ${certificate.schoolName}` : '';
  centreText(page, `${certificate.studentIdLabel} · ${certificate.classLevel}${school}`, sans, 10, PAGE_HEIGHT - 274, SLATE);

  centreText(page, `sat the ${certificate.examTitle} (${certificate.examCode}) and was awarded`, serif, 12, PAGE_HEIGHT - 306, NAVY);
  centreText(
    page,
    `${certificate.score} out of ${certificate.maxMarks} marks — ${certificate.percentage}%`,
    serifBold,
    17,
    PAGE_HEIGHT - 336,
    NAVY,
  );
  centreText(
    page,
    `Rank ${certificate.rank} of ${certificate.totalCandidates} candidates`,
    sans,
    10,
    PAGE_HEIGHT - 356,
    SLATE,
  );

  // --- Signature (gold, bottom) ------------------------------------------
  const signatureX = PAGE_WIDTH - 300;
  const signatureBaseline = 108;

  // Times italic in gold reads as a signature without needing an embedded script
  // font — a font file would be another binary in the repository to keep and license.
  page.drawText('Amit Kumar', { x: signatureX, y: signatureBaseline + 14, size: 26, font: serifItalic, color: GOLD });
  page.drawLine({
    start: { x: signatureX - 6, y: signatureBaseline + 6 },
    end: { x: signatureX + 190, y: signatureBaseline + 6 },
    thickness: 0.9,
    color: DEEP_GOLD,
  });
  page.drawText('Amit Kumar', { x: signatureX, y: signatureBaseline - 8, size: 10, font: sansBold, color: NAVY });
  page.drawText('Founder, A.M.I.T Maths Olympiad', { x: signatureX, y: signatureBaseline - 21, size: 8.5, font: sans, color: SLATE });

  // --- Seal --------------------------------------------------------------
  drawSeal(page, 178, signatureBaseline + 18, sansBold, sans);

  // --- Verification ------------------------------------------------------
  const verifyUrl = `${config.publicAppUrl}/verify/${certificate.verificationCode}`;
  page.drawText(`Certificate No. ${certificate.certificateId}`, { x: 46, y: 58, size: 8.5, font: sansBold, color: NAVY });
  page.drawText(`Verification code: ${certificate.verificationCode}`, { x: 46, y: 46, size: 8, font: sans, color: SLATE });
  page.drawText(`Verify at ${verifyUrl}`, { x: 46, y: 34, size: 7.5, font: sans, color: SLATE });
  page.drawText(`Issued ${certificate.issuedAt.toISOString().slice(0, 10)}`, {
    x: PAGE_WIDTH - 148,
    y: 34,
    size: 7.5,
    font: sans,
    color: SLATE,
  });

  return doc.save();
}

/** The download filename a student sees. */
export function pdfFilenameFor(certificate: CertificateDocument): string {
  const safeName = certificate.studentName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${certificate.certificateId}-${safeName || 'certificate'}.pdf`;
}

/** The admin/student-facing view. Never the verification code for a listing. */
export function certificateView(certificate: CertificateDocument, options: { includeCode: boolean }) {
  return {
    id: String(certificate._id),
    certificateId: certificate.certificateId,
    // Only the holder and staff see this; it is what proves a certificate, so it is
    // not in a public listing.
    verificationCode: options.includeCode ? certificate.verificationCode : undefined,
    tier: certificate.tier,
    title: CERTIFICATE_TIER_TITLES[certificate.tier],
    studentName: certificate.studentName,
    studentIdLabel: certificate.studentIdLabel,
    classLevel: certificate.classLevel,
    schoolName: certificate.schoolName ?? null,
    examTitle: certificate.examTitle,
    examCode: certificate.examCode,
    score: certificate.score,
    maxMarks: certificate.maxMarks,
    percentage: certificate.percentage,
    rank: certificate.rank,
    totalCandidates: certificate.totalCandidates,
    issuedAt: certificate.issuedAt,
    issuedBy: certificate.issuedBy ?? null,
    revoked: Boolean(certificate.revokedAt),
    revokedAt: certificate.revokedAt ?? null,
    revokedReason: certificate.revokedReason ?? null,
  };
}

/** Resolves an exam by id for the publication routes, with a clear 404. */
export async function findExamOr404(id: string): Promise<ExamDocument> {
  const exam = await Exam.findById(id);
  if (!exam) throw ApiError.notFound('No exam with that id.');
  return exam;
}

export type { Types };
