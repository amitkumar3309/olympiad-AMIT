/**
 * A load test of the API on a throwaway, in-memory database (2026-10-10).
 *
 *   npm run load-test --prefix backend                 # 1,000 students, the default mix
 *   npx tsx scripts/load-test.ts --students 2000 --concurrency 100 --seconds 8
 *
 * It answers the two questions that decide whether 1,000 students can use the site at once:
 *
 *  1. **How fast is each page's API** under many simultaneous requests — requests a second, and
 *     the median and 95th-percentile time to answer.
 *  2. **How many database operations each request costs.** The free MongoDB Atlas tier allows
 *     about 100 operations a second, so this — not CPU — is the ceiling on the live site, and
 *     the figure every cache exists to lower.
 *
 * Like `scripts/e2e-server.ts`, it can never touch a real database: everything is set before the
 * app is imported, `NODE_ENV=test` means `backend/.env` is not read at all, and MongoDB is
 * `mongodb-memory-server`. The rate limiters are off in that mode, which is right here — a load
 * test measures the work, not the limiter. Nothing is sent anywhere: SMTP points at a dead port.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { AddressInfo } from 'node:net';

interface Options {
  students: number;
  activitiesPerStudent: number;
  questions: number;
  sessions: number;
  concurrency: number;
  seconds: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: number): number => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback;
  };
  return {
    students: get('students', 1000),
    activitiesPerStudent: get('activities', 60),
    questions: get('questions', 120),
    sessions: get('sessions', 200),
    concurrency: get('concurrency', 50),
    seconds: get('seconds', 5),
  };
}

const ORIGIN = 'http://localhost:5199';
const PASSWORD = 'Load-Test-Pass-9';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'amit-olympiad-load' } });

  process.env.MONGO_URI = mongod.getUri('amit-olympiad-load');
  process.env.NODE_ENV = 'test';
  // The read cache is off under NODE_ENV=test (tests write and read back at once); the site runs
  // with it on, so the load test does too.
  process.env.CACHE_ENABLED = process.env.CACHE_ENABLED ?? 'true';
  process.env.FRONTEND_URL = ORIGIN;
  process.env.JWT_SECRET = 'load-test-only-secret-not-used-anywhere-else';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = '1025';

  const mongoose = (await import('mongoose')).default;
  const { connectDB, disconnectDB } = await import('../src/db/connection.js');
  // Typed by hand: under this package's CommonJS settings a dynamic import's `default` is the
  // module object to the compiler, while tsx hands over the app itself.
  const app = (await import('../src/app.js')).default as unknown as import('express').Express;
  const models = await import('../src/models/index.js');
  const { hashPassword } = await import('../src/lib/password.js');
  const { createQuestionSchema } = await import('../src/validation/questionSchemas.js');
  const { createQuestion, toQuestionContent } = await import('../src/services/questionService.js');
  const { scheduleQuiz } = await import('../src/services/dailyChallengeService.js');
  const { dayKeyOf, shiftDay } = await import('../src/lib/competitionDay.js');
  const { now } = await import('../src/lib/clock.js');

  await connectDB();

  // ---- every database operation, counted ------------------------------------------------
  let dbOps = 0;
  mongoose.set('debug', () => {
    dbOps += 1;
  });

  // ---- seed --------------------------------------------------------------------------------
  const started = Date.now();
  const actor = { id: null, label: 'load-test' };
  const subject = await models.Subject.create({ name: 'Mathematics', slug: 'mathematics', status: 'active' });
  const chapters = await Promise.all(
    ['Algebra', 'Geometry', 'Number Systems', 'Mensuration', 'Probability'].map((name) =>
      models.Topic.create({ subject: subject._id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), parent: null, depth: 0 }),
    ),
  );

  const questionIds: string[] = [];
  for (let i = 0; i < options.questions; i += 1) {
    const parsed = createQuestionSchema.parse({
      questionText: `Load question ${i}: what is $${i} + ${i}$?`,
      type: 'single_choice',
      options: [
        { text: `$${2 * i}$`, isCorrect: true },
        { text: `$${2 * i + 1}$`, isCorrect: false },
        { text: `$${2 * i + 2}$`, isCorrect: false },
        { text: `$${2 * i + 3}$`, isCorrect: false },
      ],
      solution: `$${i} + ${i} = ${2 * i}$.`,
      topic: String(chapters[i % chapters.length]!._id),
      classLevel: 'Class 9',
      difficulty: 'Medium',
      marks: 4,
      negativeMarks: 1,
      tags: [],
    });
    const question = await createQuestion(toQuestionContent(parsed), actor);
    // All but the last are published for practice; the last is today's quiz, which must not be.
    if (i < options.questions - 1) await models.Question.updateOne({ _id: question._id }, { status: 'published' });
    questionIds.push(String(question._id));
  }
  const today = dayKeyOf(now());
  await scheduleQuiz({ day: today, classMin: 9, classMax: 12, questionId: questionIds[questionIds.length - 1]! }, actor, now());

  const passwordHash = await hashPassword(PASSWORD);
  const studentDocs = Array.from({ length: options.students }, (_, i) => ({
    firstName: `Student${i}`,
    lastName: 'Load',
    fatherName: 'Parent',
    motherName: 'Parent',
    dateOfBirth: new Date('2011-06-14T00:00:00.000Z'),
    classLevel: 'Class 9',
    schoolName: `School ${i % 120}`,
    address: '1 Test Street, Test City',
    city: `City ${i % 40}`,
    mobile: String(9000000000 + i),
    email: `load${i}@amit.test`,
    passwordHash,
    studentId: `AMIT_${String(i).padStart(4, '0')}`,
    isEmailVerified: true,
    status: 'active',
  }));
  const students = await models.Student.insertMany(studentDocs);

  const kinds = ['daily_visit', 'practice_completed', 'mock_test_completed'] as const;
  const xp = { daily_visit: 5, practice_completed: 25, mock_test_completed: 50 } as const;
  const activities: Array<Record<string, unknown>> = [];
  for (const student of students) {
    for (let a = 0; a < options.activitiesPerStudent; a += 1) {
      const type = kinds[a % kinds.length]!;
      const day = shiftDay(today, Math.floor(a / kinds.length));
      activities.push({ student: student._id, type, xpAwarded: xp[type], occurredOn: day, dedupeKey: day, createdAt: new Date(`${day}T06:00:00.000Z`) });
    }
  }
  for (let i = 0; i < activities.length; i += 10_000) {
    await models.StudentActivity.insertMany(activities.slice(i, i + 10_000), { ordered: false });
  }
  console.log(
    `Seeded ${options.students} students, ${activities.length} activity rows and ${options.questions} questions in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );

  // ---- serve ------------------------------------------------------------------------------
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // ---- sign some students in ----------------------------------------------------------------
  const cookies: string[] = [];
  const sessionCount = Math.min(options.sessions, students.length);
  for (let i = 0; i < sessionCount; i += 1) {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ identifier: `load${i}@amit.test`, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`Sign-in ${i} failed: ${res.status} ${await res.text()}`);
    const jar = res.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
    cookies.push(jar);
  }
  const studentIdOf = (index: number) => `AMIT_${String(index % sessionCount).padStart(4, '0')}`;

  // ---- the measurements -----------------------------------------------------------------------
  interface Target {
    name: string;
    path: (client: number) => string;
    signedIn: boolean;
  }
  const targets: Target[] = [
    { name: 'guest   /auth/session', path: () => '/api/v1/auth/session', signedIn: false },
    { name: 'guest   /public/stats', path: () => '/api/v1/public/stats', signedIn: false },
    { name: 'guest   /leaderboard?limit=5', path: () => '/api/v1/leaderboard?limit=5', signedIn: false },
    { name: 'guest   /daily-quiz/past', path: () => '/api/v1/daily-quiz/past', signedIn: false },
    { name: 'guest   /daily-quiz/info', path: () => '/api/v1/daily-quiz/info', signedIn: false },
    { name: 'student /auth/session', path: () => '/api/v1/auth/session', signedIn: true },
    { name: 'student /auth/me', path: () => '/api/v1/auth/me', signedIn: true },
    { name: 'student /me/dashboard', path: () => '/api/v1/me/dashboard', signedIn: true },
    { name: 'student /me/daily-quiz', path: () => '/api/v1/me/daily-quiz', signedIn: true },
    { name: 'student /me/notifications/unread-count', path: () => '/api/v1/me/notifications/unread-count', signedIn: true },
    { name: 'student /practice/options', path: () => '/api/v1/practice/options', signedIn: true },
    { name: 'student /leaderboard?limit=50', path: () => '/api/v1/leaderboard?limit=50', signedIn: true },
    { name: 'student /me/rewards', path: () => '/api/v1/me/rewards', signedIn: true },
    { name: 'student /analytics/:id', path: (client) => `/api/v1/analytics/${studentIdOf(client)}`, signedIn: true },
  ];
  const only = process.env.LOAD_ONLY;
  const chosen = only ? targets.filter((target) => target.name.includes(only)) : targets;

  console.log(`\n${options.concurrency} clients at once, ${options.seconds} s per endpoint.\n`);
  console.log('endpoint'.padEnd(40) + 'req/s'.padStart(8) + 'p50 ms'.padStart(9) + 'p95 ms'.padStart(9) + 'db ops/req'.padStart(12) + '  status');

  for (const target of chosen) {
    const latencies: number[] = [];
    const statuses = new Map<number, number>();
    const opsBefore = dbOps;
    const deadline = Date.now() + options.seconds * 1000;
    let requests = 0;

    await Promise.all(
      Array.from({ length: options.concurrency }, async (_, client) => {
        let n = 0;
        while (Date.now() < deadline) {
          const index = client + n * options.concurrency;
          const headers: Record<string, string> = { Origin: ORIGIN };
          if (target.signedIn) headers.Cookie = cookies[index % cookies.length]!;
          const t0 = performance.now();
          const res = await fetch(`${base}${target.path(index)}`, { headers });
          await res.arrayBuffer();
          latencies.push(performance.now() - t0);
          statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
          requests += 1;
          n += 1;
        }
      }),
    );

    latencies.sort((a, b) => a - b);
    const ops = (dbOps - opsBefore) / Math.max(1, requests);
    const status = [...statuses.entries()].map(([code, count]) => `${code}×${count}`).join(' ');
    console.log(
      target.name.padEnd(40) +
        (requests / options.seconds).toFixed(0).padStart(8) +
        percentile(latencies, 50).toFixed(0).padStart(9) +
        percentile(latencies, 95).toFixed(0).padStart(9) +
        ops.toFixed(1).padStart(12) +
        `  ${status}`,
    );
  }

  server.close();
  await disconnectDB();
  await mongod.stop();
}

main().catch((err: unknown) => {
  console.error('[load-test] failed:', err);
  process.exit(1);
});
