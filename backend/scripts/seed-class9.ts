import { runQuestionSeed } from './lib/seedQuestions';
import { CLASS9_MATHS } from './data/class9Maths';

/**
 * Publishes the Class 9 Mathematics question bank (Milestone 24).
 *
 *   npx tsx scripts/seed-class9.ts            # report only, writes nothing
 *   npx tsx scripts/seed-class9.ts --write    # actually publish
 *
 * Run it from inside `backend/`, not the repo root.
 *
 * Why Class 9 specifically: it is the class the demo student sits in, and a daily
 * challenge can only ever serve a **published** question for the student's own class. An
 * empty Class 9 bank does not produce an error anywhere — it produces a challenge page
 * that honestly says nothing has been published yet, which is the correct behaviour and
 * the wrong demo.
 *
 * Every rule about how a seed writes lives in `lib/seedQuestions.ts`, shared with the
 * Class 12 seed. This file is the class level, the data and the label.
 */
void runQuestionSeed({
  script: 'seed-class9.ts',
  classLevel: 'Class 9',
  data: CLASS9_MATHS,
  label: 'seed-class9',
  argv: process.argv,
});
