import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { Certificate, type CertificateTier } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { recordAudit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import {
  certificateView,
  pdfFilenameFor,
  renderCertificatePdf,
  verifyByCode,
} from '../../services/certificateService';
import {
  listCertificatesQuerySchema,
  revokeCertificateSchema,
  verificationParamSchema,
  examIdParamSchema,
  type ListCertificatesQuery,
  type RevokeCertificateInput,
} from '../../validation/examSchemas';

/**
 * Certificates: the student's library, the PDF, public verification, and administration
 * (Milestone 13).
 *
 * **There is no issuance route here, deliberately.** Certificates are minted only by
 * `POST /admin/exams/:id/publish-results`, from a graded attempt on an official exam.
 * No student and no administrator can nominate a recipient, which is what makes a
 * certificate a statement about a result rather than about somebody's opinion — and it
 * is why the frontend cannot manufacture eligibility: it is never asked.
 */
const router = Router();

// ---------------------------------------------------------------------------
// Public verification
// ---------------------------------------------------------------------------

/**
 * Verifies a certificate from the code printed on it. **Public and unauthenticated** —
 * the point of verification is that a school, a parent or an employer can check a
 * document without an account.
 *
 * Keyed on `verificationCode`, never on the readable `certificateId`. The serial is
 * effectively guessable, so keying on it would let anybody walk the numbers and harvest
 * the name, school and rank of every entrant. 16 symbols of `crypto` randomness is not
 * walkable.
 *
 * Everything returned is the certificate's own **snapshot**, so this confirms the
 * document in somebody's hand rather than whatever the live records say today.
 */
router.get(
  '/verify/:code',
  validate({ params: verificationParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const outcome = await verifyByCode(String(req.params.code));

      // A revoked certificate is reported as revoked, not as missing: a printed copy
      // exists in the world regardless, and its holder needs to be told it has been
      // withdrawn rather than that it never existed.
      sendSuccess(res, 200, { ...outcome } as Record<string, unknown>);
    } catch (err) {
      logger.error({ err }, 'Certificate verification failed');
      sendError(res, 500, 'Could not verify that certificate right now.');
    }
  },
);

// ---------------------------------------------------------------------------
// The student's library
// ---------------------------------------------------------------------------

/**
 * The caller's own certificates. An identity gate (`requireAuth()`), like the rest of
 * `/me`: your library is yours because it is yours.
 *
 * The verification code **is** included here — the holder needs it to prove their own
 * certificate, and it is printed on their PDF anyway.
 */
router.get('/me/certificates', requireAuth(), ensureDb, async (req: Request, res: Response) => {
  try {
    const certificates = await Certificate.find({ student: req.user!.sub }).sort({ issuedAt: -1 });
    sendSuccess(res, 200, {
      certificates: certificates.map((certificate) => certificateView(certificate, { includeCode: true })),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load certificates');
    sendError(res, 500, 'Could not load your certificates right now.');
  }
});

/**
 * Downloads one of the caller's certificates as a PDF.
 *
 * Rendered server-side from the certificate's snapshot, so the file is authoritative:
 * the frontend supplies nothing but an id, and ownership is part of the query.
 *
 * A **revoked** certificate cannot be downloaded. Continuing to hand out fresh copies
 * of a withdrawn document would undermine the revocation entirely.
 */
router.get(
  '/me/certificates/:id/download',
  requireAuth(),
  validate({ params: examIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const certificate = await Certificate.findOne({ _id: req.params.id, student: req.user!.sub });
      if (!certificate) {
        sendError(res, 404, 'No certificate of yours with that id.');
        return;
      }
      if (certificate.revokedAt) {
        sendError(res, 409, 'This certificate has been revoked and can no longer be downloaded.');
        return;
      }

      const pdf = await renderCertificatePdf(certificate);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfFilenameFor(certificate)}"`);
      res.setHeader('Content-Length', String(pdf.length));
      // Personal data behind an authorization check: a shared cache must never hand
      // one student's certificate to another.
      res.setHeader('Cache-Control', 'private, max-age=0, no-store');
      res.send(Buffer.from(pdf));
    } catch (err) {
      logger.error({ err }, 'Failed to render a certificate');
      sendError(res, 500, 'Could not produce that certificate. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

router.get(
  '/admin/certificates',
  requirePermission('certificates:write'),
  validate({ query: listCertificatesQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, tier, examCode, revoked, search } = req.query as unknown as ListCertificatesQuery;

      // Built field by field from validated values only, so nothing from req.query
      // can reach Mongo as an operator object.
      const filter: {
        tier?: CertificateTier;
        examCode?: string;
        revokedAt?: null | { $ne: null };
        $or?: Array<Record<string, RegExp>>;
      } = {};
      if (tier) filter.tier = tier;
      if (examCode) filter.examCode = examCode.toUpperCase();
      if (revoked) filter.revokedAt = revoked === 'true' ? { $ne: null } : null;
      if (search) {
        const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ studentName: pattern }, { studentIdLabel: pattern }, { certificateId: pattern }];
      }

      const [certificates, total] = await Promise.all([
        Certificate.find(filter)
          .sort({ issuedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Certificate.countDocuments(filter),
      ]);

      sendSuccess(res, 200, {
        certificates: certificates.map((certificate) => certificateView(certificate, { includeCode: true })),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list certificates');
      sendError(res, 500, 'Could not load the certificates. Please try again.');
    }
  },
);

/**
 * Revokes a certificate. **Never deletes one.**
 *
 * The row stays so verification can answer "issued, and since withdrawn" instead of "no
 * such certificate" — a printed copy exists in the world whatever the database says, and
 * telling its holder it never existed reads as a system fault rather than as a decision
 * somebody made. A reason is mandatory for the same purpose.
 */
router.post(
  '/admin/certificates/:id/revoke',
  requirePermission('certificates:write'),
  validate({ params: examIdParamSchema, body: revokeCertificateSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { reason } = req.body as RevokeCertificateInput;
      const certificate = await Certificate.findById(req.params.id);
      if (!certificate) {
        sendError(res, 404, 'No certificate with that id.');
        return;
      }
      if (certificate.revokedAt) {
        sendSuccess(res, 200, { changed: false, certificate: certificateView(certificate, { includeCode: true }) });
        return;
      }

      certificate.revokedAt = new Date();
      certificate.revokedBy = req.user?.studentId ?? req.user?.email ?? 'unknown';
      certificate.revokedReason = reason;
      await certificate.save();

      await recordAudit(req, {
        action: 'certificate.revoked',
        targetType: 'certificate',
        targetId: certificate.certificateId,
        targetLabel: certificate.studentName,
        metadata: { studentId: certificate.studentIdLabel, examCode: certificate.examCode, reason },
      });

      logger.warn(
        { certificateId: certificate.certificateId, actor: certificate.revokedBy },
        'Certificate revoked',
      );

      sendSuccess(res, 200, { changed: true, certificate: certificateView(certificate, { includeCode: true }) });
    } catch (err) {
      logger.error({ err }, 'Failed to revoke a certificate');
      sendError(res, 500, 'Could not revoke that certificate. Please try again.');
    }
  },
);

/** Staff download of any certificate, for reissue and support. */
router.get(
  '/admin/certificates/:id/download',
  requirePermission('certificates:write'),
  validate({ params: examIdParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const certificate = await Certificate.findById(req.params.id);
      if (!certificate) {
        sendError(res, 404, 'No certificate with that id.');
        return;
      }

      const pdf = await renderCertificatePdf(certificate);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfFilenameFor(certificate)}"`);
      res.setHeader('Content-Length', String(pdf.length));
      res.setHeader('Cache-Control', 'private, max-age=0, no-store');
      res.send(Buffer.from(pdf));
    } catch (err) {
      logger.error({ err }, 'Failed to render a certificate for staff');
      sendError(res, 500, 'Could not produce that certificate. Please try again.');
    }
  },
);

export default router;
