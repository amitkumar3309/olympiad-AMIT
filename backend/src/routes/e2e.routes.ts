import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { config } from '../config';
import { sendError, sendSuccess } from '../lib/apiResponse';
import { clockOffset, now, resetClock, setClockOffset } from '../lib/clock';
import { CLASS_LEVELS } from '../lib/classLevels';
import { dayKeyOf } from '../lib/competitionDay';
import { logger } from '../lib/logger';
import { hashPassword } from '../lib/password';
import { slugify } from '../lib/slug';
import { EmailOutbox, Student, Subject, Topic } from '../models';
import { groupIdOf, scheduleQuiz } from '../services/dailyChallengeService';
import { createQuestion, toQuestionContent } from '../services/questionService';
import { createQuestionSchema } from '../validation/questionSchemas';
import { validate } from '../middleware/validate';
import { ensureDb } from '../middleware/ensureDb';
import { resetRateLimits } from '../middleware/rateLimiter';

/**
 * Hooks for the browser end-to-end suite (Milestone 30, Phase 2) — never part of the
 * product.
 *
 * The suite needs three things a real user can never do: move the server's clock (to see
 * the answer unlock "the next day" without waiting for one), empty the database between
 * runs, and seed a student and a quiz. Each of those is dangerous anywhere but a throwaway
 * database, so this router is behind **three** locks:
 *
 *  1. `app.ts` mounts it only when `config.e2e.hooksEnabled` — `E2E_TEST_HOOKS=true`;
 *  2. which `config` forces to `false` whenever `NODE_ENV=production`;
 *  3. and every hook refuses unless the **connected** database's name ends in `-e2e`,
 *     checked per request, because a mis-set `MONGO_URI` is the failure this guards.
 *
 * The clock moves only the `lib/clock.ts` offset, which the Daily Quiz reads; access
 * tokens and every other expiry still run on the real clock, so a session survives a
 * day's jump.
 *
 * The seeded question is a fixture for a disposable database, verified here like any
 * other: 2⁵ = 32.
 */
const router = Router();

const E2E_DB_SUFFIX = '-e2e';

/** The third lock: the database this process is really connected to. */
function onE2eDatabase(res: Response): boolean {
  const name = mongoose.connection.db?.databaseName ?? '';
  if (!name.endsWith(E2E_DB_SUFFIX)) {
    sendError(res, 403, `Refused: the connected database "${name}" is not an end-to-end database (its name must end in "${E2E_DB_SUFFIX}").`);
    return false;
  }
  return true;
}

const clockSchema = z
  .object({
    /** Absolute offset from real time, in milliseconds. */
    offsetMs: z.number().int().finite().optional(),
    /** Or: move forward from the current offset by this many days. */
    advanceDays: z.number().int().min(-30).max(30).optional(),
  })
  .refine((value) => value.offsetMs !== undefined || value.advanceDays !== undefined, {
    message: 'Send offsetMs or advanceDays.',
  });

router.post('/__e2e/clock', validate({ body: clockSchema }), ensureDb, (req: Request, res: Response) => {
  if (!onE2eDatabase(res)) return;
  const body = req.body as z.infer<typeof clockSchema>;
  const next = body.offsetMs ?? clockOffset() + (body.advanceDays ?? 0) * 24 * 60 * 60 * 1000;
  setClockOffset(next);
  logger.warn({ offsetMs: next }, 'E2E: server clock moved');
  sendSuccess(res, 200, { offsetMs: clockOffset(), now: now().toISOString(), today: dayKeyOf(now()) });
});

/** Empties every collection (keeping the indexes), puts the clock back and empties the rate limiters. */
router.post('/__e2e/reset', ensureDb, async (_req: Request, res: Response) => {
  try {
    if (!onE2eDatabase(res)) return;
    resetClock();
    await resetRateLimits();
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
    sendSuccess(res, 200, { reset: true, collections: collections.length });
  } catch (err) {
    logger.error({ err }, 'E2E reset failed');
    sendError(res, 500, 'E2E reset failed.');
  }
});

const seedSchema = z.object({
  student: z.object({
    email: z.string().trim().toLowerCase().email(),
    mobile: z.string().trim().regex(/^\d{10}$/),
    password: z.string().min(8).max(200),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    classLevel: z.enum(CLASS_LEVELS),
  }),
  quiz: z.object({
    classMin: z.number().int().min(3).max(12),
    classMax: z.number().int().min(3).max(12),
  }),
});

/**
 * One verified student and today's quiz for their class range. Written directly, the way
 * `scripts/seed-demo.ts` writes its account: there is no API that creates a verified
 * account, and there must not be one.
 */
router.post('/__e2e/seed', validate({ body: seedSchema }), ensureDb, async (req: Request, res: Response) => {
  try {
    if (!onE2eDatabase(res)) return;
    const body = req.body as z.infer<typeof seedSchema>;
    const actor = { id: null, label: 'e2e-seed' };

    const subject =
      (await Subject.findOne({ slug: 'mathematics' })) ??
      (await Subject.create({ name: 'Mathematics', slug: 'mathematics', status: 'active' }));
    const topic =
      (await Topic.findOne({ subject: subject._id, parent: null, slug: slugify('Algebra') })) ??
      (await Topic.create({ subject: subject._id, name: 'Algebra', slug: slugify('Algebra'), parent: null, depth: 0 }));

    const parsed = createQuestionSchema.parse({
      questionText: 'What is the value of $2^5$?',
      type: 'single_choice',
      options: [
        { text: '16', isCorrect: false },
        { text: '25', isCorrect: false },
        { text: '32', isCorrect: true },
        { text: '64', isCorrect: false },
      ],
      solution: '$2^5 = 2 \\times 2 \\times 2 \\times 2 \\times 2 = 32$.',
      subject: String(subject._id),
      topic: String(topic._id),
      classLevel: `Class ${body.quiz.classMin}`,
      difficulty: 'Easy',
      marks: 1,
      negativeMarks: 0,
      tags: [],
    });
    const question = await createQuestion(toQuestionContent(parsed), actor);

    const docs = await scheduleQuiz(
      { day: dayKeyOf(now()), classMin: body.quiz.classMin, classMax: body.quiz.classMax, questionId: String(question._id) },
      actor,
      now(),
    );

    const student = await Student.create({
      firstName: body.student.firstName,
      lastName: body.student.lastName,
      fatherName: 'E2E Parent',
      motherName: 'E2E Parent',
      dateOfBirth: new Date('2011-06-14T00:00:00.000Z'),
      classLevel: body.student.classLevel,
      schoolName: 'E2E Test School',
      address: '1 Test Street, Test City',
      mobile: body.student.mobile,
      email: body.student.email,
      passwordHash: await hashPassword(body.student.password),
      studentId: `AMIT_${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
      isEmailVerified: true,
      status: 'active',
    });

    sendSuccess(res, 201, {
      studentId: student.studentId,
      quiz: { groupId: String(groupIdOf(docs[0]!)), day: docs[0]!.day, correctOptionText: '32' },
    });
  } catch (err) {
    logger.error({ err }, 'E2E seed failed');
    sendError(res, 500, `E2E seed failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
});

const lastLinkQuerySchema = z.object({ to: z.string().trim().toLowerCase().email() });

/**
 * The link in the newest verification email to an address (Milestone 30, Phase 3) — so
 * the suite can walk "register → verify → quiz" the way a student does, reading the link
 * a real inbox would receive. The e2e server's SMTP is a dead port, so the email exists
 * only as its outbox row; nothing is sent anywhere.
 */
router.get('/__e2e/last-link', validate({ query: lastLinkQuerySchema }), ensureDb, async (req: Request, res: Response) => {
  try {
    if (!onE2eDatabase(res)) return;
    const { to } = req.query as unknown as z.infer<typeof lastLinkQuerySchema>;
    const mail = await EmailOutbox.findOne({ to, subject: /verify/i }).sort({ _id: -1 });
    const link = mail?.text.match(/https?:\/\/\S+\/verify-email\?\S+/)?.[0] ?? null;
    if (!link) {
      sendError(res, 404, `No verification link has been queued for ${to}.`);
      return;
    }
    sendSuccess(res, 200, { link });
  } catch (err) {
    logger.error({ err }, 'E2E last-link failed');
    sendError(res, 500, 'E2E last-link failed.');
  }
});

/** Whether the hooks may be mounted at all — the first two locks. */
export function e2eHooksEnabled(): boolean {
  return config.e2e.hooksEnabled && !config.isProd;
}

export default router;
