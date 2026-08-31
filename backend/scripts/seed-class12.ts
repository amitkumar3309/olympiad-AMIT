import { runQuestionSeed } from './lib/seedQuestions';
import { CLASS12_MATHS } from './data/class12Maths';

/**
 * Publishes the Class 12 Mathematics question bank.
 *
 *   npx tsx scripts/seed-class12.ts            # report only, writes nothing
 *   npx tsx scripts/seed-class12.ts --write    # actually publish
 *
 * Run it from inside `backend/`, not the repo root.
 *
 * The seeding rules — report-only by default, idempotent by question text, validated
 * with the API's own schema, options deterministically shuffled, published rather than
 * drafted — all live in `lib/seedQuestions.ts`, shared with the Class 9 seed. This file
 * is the class level, the data and the label, and nothing else.
 *
 * **Mathematics only.** The Physics seed was removed in Milestone 21 Phase J: AMIT is a
 * mathematics olympiad, there is no user-facing subject, and seeding a second one put
 * Physics chapters into a "whole syllabus" mathematics paper. The architecture still
 * supports more than one subject internally — nothing here forbids adding one later —
 * but nothing seeds one.
 *
 * The class level was `Class 12 - Science` until Milestone 21 Phase J collapsed the three
 * Class 12 streams into one. `scripts/migrate-class-levels.ts` converts anything already
 * seeded under the old value.
 */
void runQuestionSeed({
  script: 'seed-class12.ts',
  classLevel: 'Class 12',
  data: CLASS12_MATHS,
  label: 'seed-class12',
  argv: process.argv,
});
