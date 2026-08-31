import zlib from 'node:zlib';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/db/connection';
import { assertConfiguredForWrites } from '../src/lib/envGuard';
import { hashPassword } from '../src/lib/password';
import { todayKey, shiftDay, type DayKey } from '../src/lib/competitionDay';
import {
  DailyChallenge,
  Payment,
  Question,
  Student,
  StudentPhoto,
  type QuestionDocument,
  type StudentDocument,
} from '../src/models';
import { getPaymentSettings } from '../src/services/paymentService';
import { resolveChallengeFor, scheduleChallenge } from '../src/services/dailyChallengeService';
import { grantReward } from '../src/services/rewardService';

/**
 * Provisions the Class 9 demo: one student account, and a deliberately chosen daily
 * challenge for their class (Milestone 24).
 *
 *   npx tsx scripts/seed-demo.ts                    # report only, writes nothing
 *   npx tsx scripts/seed-demo.ts --write            # provision it
 *   npx tsx scripts/seed-demo.ts --write --days=7   # pin a whole demo week (max 14)
 *   npx tsx scripts/seed-demo.ts --write --unpaid   # skip the entry-fee record
 *
 * Run it from inside `backend/`, not the repo root. Run `seed-class9.ts` first — this
 * script refuses rather than inventing a question, because a daily challenge may only
 * ever serve a **published** question for the student's own class.
 *
 * ## Why a script and not a fixture or a route
 *
 * There is no API that creates a verified, paid student, and there must not be: every
 * one of those steps is a real control. Email verification exists so a mistyped address
 * cannot yield a usable account; a captured `Payment` is the entitlement itself. A demo
 * needs an account that has been through all of it, so this writes the end state
 * directly — visibly, from a script an operator runs on purpose, with the target
 * database printed first.
 *
 * ## What it will not do
 *
 * **It does not fabricate history.** No practice sessions, no past challenge attempts,
 * no streak, no XP beyond the one `account_created` award that a real registration also
 * grants. A streak of 4 that nobody earned is the fabricated-data problem Milestone 5
 * spent a follow-up pass deleting, and it would be visible on the leaderboard next to
 * real children.
 *
 * **It does not send email.** The account is written with `isEmailVerified: true`
 * rather than going through the verification flow, so nothing is queued and nothing is
 * delivered. `backend/.env` holds working SMTP credentials, and a script that mailed a
 * stranger has happened here before.
 *
 * **The photograph is a flat colour, not a face.** Registration requires a photo, so
 * the account needs one to be a valid account — but a demo must not carry a real
 * child's image, and a stock face implies a person who did not consent. A generated
 * flat-colour PNG is honest about being a placeholder.
 */

const WRITE = process.argv.includes('--write');
const UNPAID = process.argv.includes('--unpaid');

/** `--days=3` pins today plus the next two. Defaults to today only. */
const DAYS = (() => {
  const raw = process.argv.find((arg) => arg.startsWith('--days='))?.slice('--days='.length);
  const parsed = Number(raw ?? 1);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 14) return 1;
  return parsed;
})();

function flag(name: string, fallback: string): string {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

/**
 * The demo account.
 *
 * The address is on the reserved `.test` TLD, which by RFC 2606 can never resolve — so
 * even if some future path did try to email this account, there is no real inbox at the
 * other end. The mobile number is in the same spirit: a valid Indian format that is not
 * dialled by anything in this product (there is no SMS integration at all).
 */
const DEMO = {
  email: flag('email', 'demo.class9@amit.test'),
  password: flag('password', 'Demo@1234'),
  mobile: flag('mobile', '9000000009'),
  firstName: 'Aarav',
  lastName: 'Sharma',
  fatherName: 'Rajesh Sharma',
  motherName: 'Sunita Sharma',
  dateOfBirth: new Date('2011-06-14T00:00:00.000Z'),
  classLevel: 'Class 9' as const,
  schoolName: 'Sunrise Public School, Jaipur',
  address: '14 Vidya Marg, Jaipur, Rajasthan 302001',
} as const;

const ACTOR = { id: null, label: 'seed-demo' };

// ---------------------------------------------------------------------------
// A placeholder photograph
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A square flat-colour PNG, built here rather than checked in as a binary.
 *
 * Written by hand because the project carries no image library and will not add one for
 * this (₹0 and one fewer dependency). It is four chunks: the signature, an IHDR saying
 * 8-bit truecolour, a zlib-deflated raw scanline block, and IEND. Each scanline is
 * prefixed with filter byte 0 — "no filtering" — which is what makes the pixel data
 * plain RGB triples.
 */
function flatColourPng(size: number, rgb: readonly [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  // 10..12 are compression, filter and interlace methods: 0, 0, 0 — the only values
  // the PNG specification defines for a non-interlaced image.

  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = rgb[0];
      raw[at + 1] = rgb[1];
      raw[at + 2] = rgb[2];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The account
// ---------------------------------------------------------------------------

function generateStudentId(): string {
  // Same namespace and shape as registration's own allocator: AMIT_0000–AMIT_9999 is
  // the competitor numbering, and this account is a competitor.
  return `AMIT_${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`;
}

async function ensureStudent(): Promise<StudentDocument | null> {
  const existing = await Student.findOne({ email: DEMO.email.toLowerCase() });
  if (existing) {
    console.log(`  = account already exists: ${existing.studentId} (${existing.email})`);
    if (existing.classLevel !== DEMO.classLevel) {
      console.log(`  ! it is in ${existing.classLevel}, not ${DEMO.classLevel}`);
    }
    if (WRITE) {
      // Re-assert only what a demo depends on, and say so. The password is reset because
      // the whole point of the account is being able to sign in to it, and an operator
      // re-running this script is asking for exactly that.
      existing.passwordHash = await hashPassword(DEMO.password);
      existing.isEmailVerified = true;
      existing.status = 'active';
      existing.failedLoginAttempts = 0;
      existing.lockedUntil = null;
      existing.mustChangePassword = false;
      await existing.save();
      console.log('  ~ password reset, email marked verified, account active');
    }
    return existing;
  }

  if (!WRITE) {
    console.log(`  (would create ${DEMO.classLevel} student ${DEMO.email})`);
    return null;
  }

  let student: StudentDocument | null = null;
  for (let attempt = 0; attempt < 5 && !student; attempt += 1) {
    try {
      student = await Student.create({
        firstName: DEMO.firstName,
        lastName: DEMO.lastName,
        fatherName: DEMO.fatherName,
        motherName: DEMO.motherName,
        dateOfBirth: DEMO.dateOfBirth,
        classLevel: DEMO.classLevel,
        schoolName: DEMO.schoolName,
        address: DEMO.address,
        mobile: DEMO.mobile,
        email: DEMO.email,
        passwordHash: await hashPassword(DEMO.password),
        studentId: generateStudentId(),
        // Verified directly: see the note at the top on why this does not go through
        // the email flow.
        isEmailVerified: true,
        status: 'active',
      });
    } catch (err) {
      const duplicate = typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
      const field = duplicate ? Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0] : '';
      if (duplicate && field === 'studentId') continue; // collision — try another number
      if (duplicate && field === 'mobile') {
        console.error(`  ✗ the mobile number ${DEMO.mobile} already belongs to another account.`);
        console.error('    Re-run with --mobile=9000000008 (any unused 10-digit number).');
        return null;
      }
      throw err;
    }
  }

  if (!student) {
    console.error('  ✗ could not allocate a free AMIT_xxxx student id after five attempts.');
    return null;
  }

  console.log(`  + account ${student.studentId} (${student.email})`);

  // The photo is mandatory for an account to be valid, so a failure here leaves a
  // half-registered student — removed again, exactly as the registration route does.
  const photo = flatColourPng(240, [37, 99, 235]);
  try {
    await StudentPhoto.create({
      student: student._id as mongoose.Types.ObjectId,
      contentType: 'image/png',
      size: photo.length,
      data: photo,
    });
    console.log(`  + placeholder photograph (${photo.length} bytes, flat colour)`);
  } catch (err) {
    await Student.deleteOne({ _id: student._id });
    console.error('  ✗ could not store the placeholder photo; the account was removed again.', err);
    return null;
  }

  // The same first award a real registration grants, through the one reward engine.
  // Nothing else is granted: see "It does not fabricate history" above.
  await grantReward({ student: student._id as mongoose.Types.ObjectId, event: 'account_created' });

  return student;
}

// ---------------------------------------------------------------------------
// The entry fee
// ---------------------------------------------------------------------------

/**
 * Records a captured entry-fee payment, so the demo account can reach the official
 * Olympiad rather than the paywall.
 *
 * `statusSource: 'manual'` is an existing, honest value — this payment did not come
 * from a checkout or a webhook, and the record says so. `razorpayPaymentId` and
 * `razorpaySignature` stay **null**: no money moved and no signature was verified, and
 * writing a plausible-looking one would make a demo row indistinguishable from a real
 * capture in the payments console. The amount is the live fee, so the invoice PDF this
 * produces states what the deployment actually charges.
 */
async function ensurePayment(student: StudentDocument): Promise<void> {
  const studentObjectId = student._id as mongoose.Types.ObjectId;
  const already = await Payment.findOne({
    student: studentObjectId,
    purpose: 'olympiad_entry',
    status: 'captured',
  });
  if (already) {
    console.log(`  = entry fee already recorded as captured (₹${(already.amount / 100).toFixed(2)})`);
    return;
  }

  const settings = await getPaymentSettings();
  if (!WRITE) {
    console.log(`  (would record a captured ₹${(settings.olympiadEntryFee / 100).toFixed(2)} entry fee)`);
    return;
  }

  await Payment.create({
    student: studentObjectId,
    purpose: 'olympiad_entry',
    amount: settings.olympiadEntryFee,
    currency: settings.currency,
    // Unique per account and obviously not a Razorpay id, so nobody reconciling a
    // statement mistakes it for one.
    razorpayOrderId: `order_demo_${student.studentId.toLowerCase()}`,
    status: 'captured',
    statusSource: 'manual',
    method: 'demo',
    capturedAt: new Date(),
  });
  console.log(`  + captured entry fee ₹${(settings.olympiadEntryFee / 100).toFixed(2)} (manual demo record)`);
}

// ---------------------------------------------------------------------------
// The daily challenge
// ---------------------------------------------------------------------------

/**
 * Chooses the run of questions the demo week will show.
 *
 * **A week of challenges is a spread, not the top of the bank** — the same rule
 * `suggestPaper()` follows for a whole-syllabus paper, and for the same reason. Taking
 * whatever comes first by `_id` produced, on its first outing, three coordinate-geometry
 * questions on consecutive days, two of them near-identical ("every point on the
 * $x$-axis has…" and "in which quadrant does $(x,y)$ lie when…"). Nothing was *wrong*
 * with that week; it just showed one chapter and one question type, which is the
 * opposite of what a week of challenges is for.
 *
 * So: round-robin the chapters, least-used first, and within the chosen chapter prefer a
 * question type the previous day did not use. Stable tie-breaks on chapter and question
 * id throughout, so a re-run against the same bank plans the same week — a seed that
 * shuffled would make "what will Thursday show?" unanswerable before Thursday.
 */
class WeekPlanner {
  /** Candidates grouped by chapter, each list in a stable order. */
  private readonly byChapter = new Map<string, QuestionDocument[]>();
  /** How many days each chapter has already supplied, so the next pick can level it. */
  private readonly chapterUses = new Map<string, number>();
  private lastType: string | null = null;

  private constructor(candidates: QuestionDocument[], used: Set<string>) {
    for (const question of candidates) {
      if (used.has(String(question._id))) continue;
      const chapter = String(question.topic ?? 'unfiled');
      const list = this.byChapter.get(chapter);
      if (list) list.push(question);
      else this.byChapter.set(chapter, [question]);
    }
    for (const chapter of this.byChapter.keys()) this.chapterUses.set(chapter, 0);
  }

  /** Only published questions carrying a worked solution are ever offered. */
  static async load(classLevel: typeof DEMO.classLevel, used: Set<string>): Promise<WeekPlanner> {
    const candidates = await Question.find({
      classLevel,
      status: 'published',
      solution: { $ne: null },
    }).sort({ _id: 1 });
    return new WeekPlanner(candidates, used);
  }

  /**
   * Counts a day that was **already** pinned before this run against its chapter.
   *
   * Without this the plan levels only its own picks, so a re-run that extends an
   * existing week can repeat a chapter the week already used — which is exactly what
   * happened on the first seven-day run: Polynomials on the 2nd (pinned earlier) and
   * again on the 5th. The type is recorded too, so the next pick still prefers a
   * different format from the day before it.
   */
  note(question: QuestionDocument): void {
    const chapter = String(question.topic ?? 'unfiled');
    this.chapterUses.set(chapter, (this.chapterUses.get(chapter) ?? 0) + 1);
    this.lastType = question.type;
  }

  /** The next day's question, or null once the bank is exhausted. */
  next(): QuestionDocument | null {
    // Least-used chapter wins; ties break on the chapter id, so the order is total.
    const chapters = [...this.byChapter.entries()]
      .filter(([, list]) => list.length > 0)
      .sort((a, b) => (this.chapterUses.get(a[0])! - this.chapterUses.get(b[0])!) || (a[0] < b[0] ? -1 : 1));
    const chosen = chapters[0];
    if (!chosen) return null;

    const [chapter, list] = chosen;
    // A different question type from yesterday when this chapter can offer one — it is a
    // preference, not a constraint, because chapter spread matters more than variety of
    // format and some chapters are all one type.
    const index = Math.max(
      0,
      list.findIndex((question) => question.type !== this.lastType),
    );
    const [question] = list.splice(index, 1);
    if (!question) return null;

    this.chapterUses.set(chapter, this.chapterUses.get(chapter)! + 1);
    this.lastType = question.type;
    return question;
  }
}

async function ensureChallenges(): Promise<void> {
  const today = todayKey();
  // Every question any pinned day already uses, so a week never repeats one and a
  // re-run extends the run rather than duplicating it.
  const used = new Set<string>(
    (await DailyChallenge.find({ classLevel: DEMO.classLevel }).select('question')).map((challenge) =>
      String(challenge.question),
    ),
  );
  const planner = await WeekPlanner.load(DEMO.classLevel, used);

  for (let offset = 0; offset < DAYS; offset += 1) {
    // `shiftDay` counts *backwards*, so a negative value moves forward. Getting this the
    // wrong way round is a documented trap (see lib/competitionDay.ts).
    const day: DayKey = shiftDay(today, -offset);

    const existing = await DailyChallenge.findOne({ day, classLevel: DEMO.classLevel });
    if (existing) {
      const question = await Question.findById(existing.question).select('questionText topic type');
      if (question) planner.note(question);
      console.log(
        `  = ${day} already set (${existing.source}): ${question?.questionText.slice(0, 60) ?? '(missing question)'}…`,
      );
      continue;
    }

    const question = planner.next();
    if (!question) {
      console.error(`  ✗ no unused published ${DEMO.classLevel} question left for ${day}.`);
      return;
    }

    if (!WRITE) {
      console.log(`  (would schedule ${day}: ${question.questionText.slice(0, 60)}…)`);
      continue;
    }

    // Through the service, so the rules that make a question schedulable — it exists, it
    // is published, it is for this class, the day is not in the past — are the same ones
    // the admin console is held to.
    const challenge = await scheduleChallenge(
      { day, classLevel: DEMO.classLevel, questionId: String(question._id) },
      ACTOR,
    );
    console.log(`  + ${day} scheduled (${challenge.marks} marks): ${question.questionText.slice(0, 60)}…`);
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Provisioning the Class 9 demo.');
  assertConfiguredForWrites({ script: 'seed-demo.ts', allowLocal: process.argv.includes('--local') });
  console.log(
    WRITE
      ? 'Mode: WRITE — the account, the entry fee and the challenge will be written.\n'
      : 'Mode: report only. Re-run with --write to provision.\n',
  );

  await connectDB();

  const published = await Question.countDocuments({ classLevel: DEMO.classLevel, status: 'published' });
  console.log(`Published ${DEMO.classLevel} questions: ${published}`);
  if (published === 0) {
    console.error(
      [
        '',
        `REFUSING TO RUN — there is no published ${DEMO.classLevel} question to set as a challenge.`,
        '',
        '  A daily challenge only ever serves a published question for the student’s own',
        '  class, so this would provision an account whose challenge page is empty.',
        '',
        '  Publish the Class 9 bank first:',
        '      npx tsx scripts/seed-class9.ts --write',
        '',
      ].join('\n'),
    );
    await disconnectDB();
    process.exit(2);
  }

  console.log('\nStudent account');
  const student = await ensureStudent();

  if (student) {
    console.log('\nEntry fee');
    if (UNPAID) {
      console.log('  - skipped (--unpaid): the account will meet the real paywall on the Olympiad.');
    } else {
      await ensurePayment(student);
    }
  }

  console.log(`\nDaily challenge (${DAYS} day${DAYS === 1 ? '' : 's'} from today)`);
  await ensureChallenges();

  /**
   * What the demo actually resolves to.
   *
   * In write mode this goes through the same service a student's request does, so the
   * line reports the product's answer rather than the script's. In report-only mode it
   * **must not**: `resolveChallengeFor()` pins an automatic challenge when none exists,
   * which is a write — a dry run did exactly that on its first outing, and a dry run
   * that writes is a dry run nobody can trust (the same trap the taxonomy half of
   * `lib/seedQuestions.ts` documents).
   */
  const resolved = WRITE
    ? await resolveChallengeFor(DEMO.classLevel, todayKey())
    : await DailyChallenge.findOne({ day: todayKey(), classLevel: DEMO.classLevel });
  const resolvedQuestion = resolved ? await Question.findById(resolved.question).select('questionText type') : null;

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Today (IST)        : ${todayKey()}`);
  console.log(`Today’s challenge  : ${resolvedQuestion ? `${resolvedQuestion.type} · ${resolvedQuestion.questionText.slice(0, 50)}…` : '(none)'}`);
  if (student) {
    console.log(`Sign in with       : ${student.email}  /  ${DEMO.password}`);
    console.log(`  (mobile also works: ${student.mobile})`);
    console.log(`Student ID         : ${student.studentId}`);
    console.log(`Class              : ${student.classLevel}`);
  }
  if (!WRITE) console.log('\nNothing was written. Re-run with --write.');

  await disconnectDB();
}

main().catch(async (err) => {
  console.error('Provisioning failed:', err);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
