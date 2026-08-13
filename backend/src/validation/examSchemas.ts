import { z } from 'zod';
import { CLASS_LEVELS } from '../lib/classLevels';
import { CERTIFICATE_TIERS, EXAM_STATUSES } from '../models';

/**
 * Query params arrive as strings, and a repeated key still yields an array. Everything
 * that reaches a Mongoose filter is parsed here first, so no operator object from
 * `req.query` can get through. See SECURITY.md.
 */
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const objectId = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, 'That is not a valid id');

export const examIdParamSchema = z.object({ id: objectId });
export const attemptIdParamSchema = z.object({ attemptId: objectId });
export const examQuestionParamSchema = z.object({ attemptId: objectId, questionId: objectId });

/**
 * The verification code as printed: 16 symbols in four groups. Accepted with or
 * without the dashes and in any case, because it is read off paper and typed by hand —
 * rejecting a correctly-remembered code over punctuation would make a genuine
 * certificate look forged.
 */
export const verificationParamSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .pipe(z.string().regex(/^[A-Z0-9]{16}$/, 'That is not a valid verification code'))
    .transform((v) => `${v.slice(0, 4)}-${v.slice(4, 8)}-${v.slice(8, 12)}-${v.slice(12)}`),
});

// ---------------------------------------------------------------------------
// Exam authoring
// ---------------------------------------------------------------------------

const examQuestionRef = z.object({
  question: objectId,
  order: z.coerce.number().int().min(1),
  marks: z.coerce.number().min(0.25).max(100),
  negativeMarks: z.coerce.number().min(0).max(100).default(0),
});

/** `AMIT-2026-C9` — letters, digits and dashes, so it is safe in a filename and a URL. */
const examCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/, 'An exam code looks like AMIT-2026-C9');

const isoDate = z
  .string()
  .trim()
  .datetime({ offset: true, message: 'Use an ISO date-time, e.g. 2026-11-20T09:00:00Z' })
  .transform((v) => new Date(v));

const examBody = {
  title: z.string().trim().min(3, 'Give the exam a title').max(200),
  examCode,
  description: z.string().trim().max(2000).optional(),
  instructions: z.string().trim().max(5000).optional(),
  classLevel: z.enum(CLASS_LEVELS, { message: 'Select a class' }),
  durationMinutes: z.coerce.number().int().min(1).max(600),
  /**
   * Both mandatory, unlike a mock test's nullable window: the organisers announce the
   * timeline in advance, so an official exam with no window is not an exam.
   */
  opensAt: isoDate,
  closesAt: isoDate,
  meritThresholdPercent: z.coerce.number().min(1).max(100).default(60),
  distinctionThresholdPercent: z.coerce.number().min(1).max(100).default(85),
  questions: z.array(examQuestionRef).max(200).default([]),
};

/**
 * Cross-field rules, checked here rather than in the handler so the two fields cannot
 * disagree by the time anything is written.
 *
 * Both are expressed as plain predicates rather than a shared generic wrapper: zod's
 * inference does not survive being passed through one, and losing the inferred input
 * type is worse than repeating two `refine` calls.
 */
const closesAfterOpens = (body: { opensAt?: Date; closesAt?: Date }): boolean =>
  !body.opensAt || !body.closesAt || body.closesAt.getTime() > body.opensAt.getTime();

/**
 * Distinction must not be *easier* to reach than merit — otherwise every distinction
 * would also qualify as merit and the two tiers would be incoherent.
 */
const distinctionAtLeastMerit = (body: {
  meritThresholdPercent?: number;
  distinctionThresholdPercent?: number;
}): boolean =>
  body.meritThresholdPercent === undefined ||
  body.distinctionThresholdPercent === undefined ||
  body.distinctionThresholdPercent >= body.meritThresholdPercent;

export const createExamSchema = z
  .object(examBody)
  .refine(closesAfterOpens, { message: 'The exam must close after it opens', path: ['closesAt'] })
  .refine(distinctionAtLeastMerit, {
    message: 'Distinction must be at least as high as merit',
    path: ['distinctionThresholdPercent'],
  });
export type CreateExamInput = z.infer<typeof createExamSchema>;

export const updateExamSchema = z
  .object({
    title: examBody.title.optional(),
    examCode: examCode.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    instructions: z.string().trim().max(5000).nullable().optional(),
    classLevel: z.enum(CLASS_LEVELS).optional(),
    durationMinutes: z.coerce.number().int().min(1).max(600).optional(),
    opensAt: isoDate.optional(),
    closesAt: isoDate.optional(),
    meritThresholdPercent: z.coerce.number().min(1).max(100).optional(),
    distinctionThresholdPercent: z.coerce.number().min(1).max(100).optional(),
    questions: z.array(examQuestionRef).max(200).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update')
  .refine(closesAfterOpens, { message: 'The exam must close after it opens', path: ['closesAt'] })
  .refine(distinctionAtLeastMerit, {
    message: 'Distinction must be at least as high as merit',
    path: ['distinctionThresholdPercent'],
  });
export type UpdateExamInput = z.infer<typeof updateExamSchema>;

export const examStatusSchema = z.object({
  status: z.enum(EXAM_STATUSES),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type ExamStatusInput = z.infer<typeof examStatusSchema>;

export const listExamsQuerySchema = z.object({
  ...pagination,
  status: z.enum(EXAM_STATUSES).optional(),
  classLevel: z.enum(CLASS_LEVELS).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListExamsQuery = z.infer<typeof listExamsQuerySchema>;

// ---------------------------------------------------------------------------
// Sitting
// ---------------------------------------------------------------------------

/**
 * One answer. **No time field of any kind** — not an elapsed duration, not a client
 * timestamp, not a remaining-seconds value. The server owns the clock, and accepting
 * any of those would be handing it to the browser.
 */
export const examAnswerSchema = z
  .object({
    selectedOptionKeys: z.array(z.string().trim().min(1).max(8)).max(10).optional(),
    numericResponse: z.number().finite().nullable().optional(),
    booleanResponse: z.boolean().nullable().optional(),
  })
  .refine(
    (body) =>
      body.selectedOptionKeys !== undefined || body.numericResponse !== undefined || body.booleanResponse !== undefined,
    'Send an answer for this question',
  );
export type ExamAnswerBody = z.infer<typeof examAnswerSchema>;

export const publishResultsSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});
export type PublishResultsInput = z.infer<typeof publishResultsSchema>;

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

export const listCertificatesQuerySchema = z.object({
  ...pagination,
  tier: z.enum(CERTIFICATE_TIERS).optional(),
  examCode: z.string().trim().min(1).max(40).optional(),
  revoked: z.enum(['true', 'false']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListCertificatesQuery = z.infer<typeof listCertificatesQuerySchema>;

export const revokeCertificateSchema = z.object({
  reason: z.string().trim().min(3, 'Say why it is being revoked').max(500),
});
export type RevokeCertificateInput = z.infer<typeof revokeCertificateSchema>;
