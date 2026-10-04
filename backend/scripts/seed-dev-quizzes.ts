import type { Types } from 'mongoose';
import { connectDB, disconnectDB } from '../src/db/connection';
import { config } from '../src/config';
import { assertConfiguredForWrites } from '../src/lib/envGuard';
import { dayKeyOf, shiftDay, type DayKey } from '../src/lib/competitionDay';
import { classesInRange, CLASS_GROUPS } from '../src/lib/dailyQuiz';
import { slugify } from '../src/lib/slug';
import { DailyChallenge, Subject, Topic } from '../src/models';
import { scheduleQuiz } from '../src/services/dailyChallengeService';
import { createQuestion, toQuestionContent } from '../src/services/questionService';
import { findImplicitSubject } from '../src/services/taxonomyService';
import { createQuestionSchema } from '../src/validation/questionSchemas';

/**
 * A few Daily Quizzes for a **local development** database (Milestone 30, Phase 2).
 *
 *   npx tsx scripts/seed-dev-quizzes.ts                   # report only, writes nothing
 *   npx tsx scripts/seed-dev-quizzes.ts --write --local   # today and the next two days
 *   npx tsx scripts/seed-dev-quizzes.ts --write --local --days=1
 *
 * ## It refuses anything but a local database
 *
 * The brief is explicit: never invent production questions — the owner supplies them
 * (§6.8). A Daily Quiz carries a real prize, so this script will not write to any URI that
 * is not localhost, whatever flag is passed. It exists so the quiz page, the admin console
 * and the end-to-end suite have something real to show on a developer's machine.
 *
 * ## Every answer is checked by the script before anything is written
 *
 * Each fixture states its question, its options and which option is correct — and also
 * computes the answer in code. The script refuses to run if any marked option disagrees
 * with the computation. A wrong answer key in a quiz is a child marked wrong for being
 * right, and "a person typed it carefully" is not a check.
 */

const WRITE = process.argv.includes('--write');
const DAYS = (() => {
  const raw = process.argv.find((arg) => arg.startsWith('--days='))?.slice('--days='.length);
  const parsed = Number(raw ?? 3);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 3 ? parsed : 3;
})();

const ACTOR = { id: null, label: 'seed-dev-quizzes' };

interface Fixture {
  group: (typeof CLASS_GROUPS)[number]['key'];
  questionText: string;
  options: string[];
  /** Index of the option marked correct. */
  correct: number;
  /** The answer, computed — compared against the marked option before anything is written. */
  compute: () => number;
  solution: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
}

const FIXTURES: Fixture[] = [
  {
    group: '3-5',
    questionText: 'A box has 6 rows of 7 chocolates. How many chocolates are in the box?',
    options: ['13', '42', '48', '36'],
    correct: 1,
    compute: () => 6 * 7,
    solution: '6 rows of 7 is $6 \\times 7 = 42$ chocolates.',
    difficulty: 'Easy',
  },
  {
    group: '3-5',
    questionText: 'What is $125 + 278$?',
    options: ['393', '403', '413', '503'],
    correct: 1,
    compute: () => 125 + 278,
    solution: '$125 + 278 = 403$: $5 + 8 = 13$ (write 3, carry 1), $2 + 7 + 1 = 10$ (write 0, carry 1), $1 + 2 + 1 = 4$.',
    difficulty: 'Easy',
  },
  {
    group: '3-5',
    questionText: 'Which number is 1000 less than 7050?',
    options: ['6050', '6950', '7040', '6000'],
    correct: 0,
    compute: () => 7050 - 1000,
    solution: '$7050 - 1000 = 6050$ — only the thousands digit changes.',
    difficulty: 'Easy',
  },
  {
    group: '6-8',
    questionText: 'What is $\\frac{3}{4}$ of $96$?',
    options: ['64', '72', '76', '84'],
    correct: 1,
    compute: () => (3 / 4) * 96,
    solution: '$\\frac{96}{4} = 24$, and $3 \\times 24 = 72$.',
    difficulty: 'Easy',
  },
  {
    group: '6-8',
    questionText: 'What is the average of 12, 15 and 21?',
    options: ['15', '16', '17', '18'],
    correct: 1,
    compute: () => (12 + 15 + 21) / 3,
    solution: 'The sum is $12 + 15 + 21 = 48$, and $48 \\div 3 = 16$.',
    difficulty: 'Medium',
  },
  {
    group: '6-8',
    questionText: 'What is the value of $2^6 - 2^4$?',
    options: ['32', '48', '52', '60'],
    correct: 1,
    compute: () => 2 ** 6 - 2 ** 4,
    solution: '$2^6 = 64$ and $2^4 = 16$, so $64 - 16 = 48$.',
    difficulty: 'Medium',
  },
  {
    group: '9-12',
    questionText: 'If $3x - 7 = 11$, what is the value of $x$?',
    options: ['4', '5', '6', '7'],
    correct: 2,
    compute: () => (11 + 7) / 3,
    solution: 'Add 7 to both sides: $3x = 18$. Divide by 3: $x = 6$.',
    difficulty: 'Easy',
  },
  {
    group: '9-12',
    questionText: 'What is the sum of the interior angles of a hexagon, in degrees?',
    options: ['540', '720', '900', '1080'],
    correct: 1,
    compute: () => (6 - 2) * 180,
    solution: 'A polygon with $n$ sides has interior angles summing to $(n-2) \\times 180^\\circ$. For a hexagon, $(6-2) \\times 180^\\circ = 720^\\circ$.',
    difficulty: 'Medium',
  },
  {
    group: '9-12',
    questionText: 'What is the product of the roots of $x^2 - 5x + 6 = 0$?',
    options: ['5', '6', '-5', '-6'],
    correct: 1,
    compute: () => 6 / 1,
    solution: 'For $ax^2 + bx + c = 0$ the product of the roots is $\\frac{c}{a} = \\frac{6}{1} = 6$. (The roots are 2 and 3.)',
    difficulty: 'Medium',
  },
];

function isLocal(uri: string): boolean {
  return /(?:\/\/|@)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])[:/]/.test(uri);
}

function verifyFixtures(): void {
  for (const fixture of FIXTURES) {
    const computed = fixture.compute();
    const marked = Number(fixture.options[fixture.correct]);
    if (!Number.isFinite(computed) || marked !== computed) {
      throw new Error(`Answer check failed: "${fixture.questionText}" marks ${fixture.options[fixture.correct]} but computes ${computed}.`);
    }
    const matches = fixture.options.filter((option) => Number(option) === computed).length;
    if (matches !== 1) throw new Error(`Answer check failed: "${fixture.questionText}" has ${matches} options equal to ${computed}.`);
  }
  console.log(`Answer check: all ${FIXTURES.length} fixtures agree with their computed answers.`);
}

async function chapterFor(): Promise<{ subject: string; topic: string }> {
  const subjectId: Types.ObjectId =
    (await findImplicitSubject()) ??
    ((await Subject.create({ name: 'Mathematics', slug: 'mathematics', status: 'active' }))._id as Types.ObjectId);
  const name = 'Arithmetic and Algebra';
  const topic =
    (await Topic.findOne({ subject: subjectId, parent: null, slug: slugify(name) })) ??
    (await Topic.create({ subject: subjectId, name, slug: slugify(name), parent: null, depth: 0 }));
  return { subject: String(subjectId), topic: String(topic._id) };
}

async function main(): Promise<void> {
  console.log('Seeding development Daily Quizzes.');
  assertConfiguredForWrites({ script: 'seed-dev-quizzes.ts', allowLocal: process.argv.includes('--local') });
  if (!isLocal(config.mongoUri)) {
    console.error('REFUSING TO RUN — this script writes only to a local development database. Daily Quiz questions for a real database come from the owner.');
    process.exit(2);
  }
  verifyFixtures();

  await connectDB();
  const today = dayKeyOf(new Date());
  const { subject, topic } = WRITE ? await chapterFor() : { subject: '', topic: '' };

  for (let offset = 0; offset < DAYS; offset += 1) {
    const day: DayKey = shiftDay(today, -offset);
    for (const group of CLASS_GROUPS) {
      const taken = await DailyChallenge.exists({ day, classLevel: { $in: classesInRange(group.min, group.max) } });
      if (taken) {
        console.log(`  = ${day} ${group.key}: already scheduled`);
        continue;
      }
      const fixture = FIXTURES.filter((f) => f.group === group.key)[offset];
      if (!fixture) continue;
      if (!WRITE) {
        console.log(`  (would schedule ${day} ${group.key}: ${fixture.questionText})`);
        continue;
      }
      const parsed = createQuestionSchema.parse({
        questionText: fixture.questionText,
        type: 'single_choice',
        options: fixture.options.map((text, index) => ({ text, isCorrect: index === fixture.correct })),
        solution: fixture.solution,
        subject,
        topic,
        classLevel: `Class ${group.min}`,
        difficulty: fixture.difficulty,
        marks: 1,
        negativeMarks: 0,
        tags: ['dev-seed'],
      });
      const question = await createQuestion(toQuestionContent(parsed), ACTOR);
      await scheduleQuiz({ day, classMin: group.min, classMax: group.max, questionId: String(question._id) }, ACTOR);
      console.log(`  + ${day} ${group.key}: ${fixture.questionText}`);
    }
  }

  if (!WRITE) console.log('\nNothing was written. Re-run with --write --local.');
  await disconnectDB();
}

main().catch(async (err: unknown) => {
  console.error('Seeding failed:', err);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
