import { describe, expect, it } from 'vitest';
import { dayKeyOf, dayStartsAt, istDayBounds, nextDayStartsAt, secondsUntilNextDay } from '../src/lib/competitionDay';
import { challengeStreakOf } from '../src/services/dailyChallengeService';
import {
  classesInRange,
  classRangeLabel,
  describeWinnerRule,
  hashIp,
  newOptionId,
  parseClassRange,
  parseQuizDay,
  prizeEligibility,
  quizPhaseAt,
  quizQuestionProblem,
  quizWindow,
  rankCandidates,
  seededOrder,
  sharedIpCounts,
  shuffleSeed,
  WINNER_RULES,
  type EligibilityRequirement,
  type WinnerCandidate,
} from '../src/lib/dailyQuiz';
import { parseCsv, jsonToTable } from '../src/services/tabularImportParsers';

/**
 * Milestone 30, Phase 2 — the Daily Quiz's rules that need no database (brief §6.8,
 * "Unit"). Every rule here is decided by a pure function in `lib/dailyQuiz.ts`, so each
 * is tested at its boundary rather than through a server.
 */

// ===========================================================================
// IST day bounds and the quiz's phase
// ===========================================================================

describe('IST day bounds', () => {
  it('opens at 00:00:00 IST, which is 18:30 UTC the evening before', () => {
    const { start, end } = istDayBounds('2026-11-08');
    expect(start.toISOString()).toBe('2026-11-07T18:30:00.000Z');
    // Exclusive: the next day starts exactly one day later.
    expect(end.toISOString()).toBe('2026-11-08T18:30:00.000Z');
  });

  it('files 23:59:59 IST under the day and 00:00:00 IST under the next', () => {
    // 23:59:59 IST on the 8th is 18:29:59 UTC on the 8th.
    expect(dayKeyOf(new Date('2026-11-08T18:29:59.000Z'))).toBe('2026-11-08');
    // 00:00:00 IST on the 9th is 18:30:00 UTC on the 8th — the UTC date has not changed.
    expect(dayKeyOf(new Date('2026-11-08T18:30:00.000Z'))).toBe('2026-11-09');
  });

  it('derives opensAt, closesAt and revealAt from the day alone, revealing at the close', () => {
    const window = quizWindow('2026-11-08');
    expect(window.opensAt.toISOString()).toBe('2026-11-07T18:30:00.000Z');
    expect(window.closesAt.toISOString()).toBe('2026-11-08T18:30:00.000Z');
    expect(window.revealAt.getTime()).toBe(window.closesAt.getTime());
  });

  it('is upcoming before 00:00 IST, open through 23:59:59.999 IST and revealed from the next midnight', () => {
    expect(quizPhaseAt('2026-11-08', new Date('2026-11-07T18:29:59.999Z'))).toBe('upcoming');
    expect(quizPhaseAt('2026-11-08', new Date('2026-11-07T18:30:00.000Z'))).toBe('open');
    expect(quizPhaseAt('2026-11-08', new Date('2026-11-08T18:29:59.999Z'))).toBe('open');
    expect(quizPhaseAt('2026-11-08', new Date('2026-11-08T18:30:00.000Z'))).toBe('revealed');
  });
});

describe('the day boundary helpers', () => {
  it('places the day boundary at IST midnight, not UTC midnight', () => {
    expect(dayStartsAt('2026-08-12').toISOString()).toBe('2026-08-11T18:30:00.000Z');
    // 20:00 UTC on the 11th is 01:30 IST on the 12th, so the next change is 18:30 UTC on the 12th.
    expect(nextDayStartsAt(new Date('2026-08-11T20:00:00.000Z')).toISOString()).toBe('2026-08-12T18:30:00.000Z');
    expect(nextDayStartsAt(new Date('2026-08-11T18:29:00.000Z')).toISOString()).toBe('2026-08-11T18:30:00.000Z');
  });

  it('counts whole seconds to the boundary and never reports zero before it', () => {
    expect(secondsUntilNextDay(new Date('2026-08-11T18:29:00.000Z'))).toBe(60);
    expect(secondsUntilNextDay(new Date('2026-08-11T18:29:59.500Z'))).toBe(1);
    expect(secondsUntilNextDay(new Date('2026-08-11T18:30:00.000Z'))).toBe(24 * 60 * 60);
  });

  it('counts a quiz streak in whole IST days, alive while yesterday still counts', () => {
    const today = '2026-08-12';
    expect(challengeStreakOf([], today)).toEqual({ current: 0, longest: 0 });
    expect(challengeStreakOf(['2026-08-12'], today)).toEqual({ current: 1, longest: 1 });
    expect(challengeStreakOf(['2026-08-10', '2026-08-11', '2026-08-12'], today)).toEqual({ current: 3, longest: 3 });
    // Ending yesterday: still alive, because today is not lost until it passes.
    expect(challengeStreakOf(['2026-08-10', '2026-08-11'], today)).toEqual({ current: 2, longest: 2 });
    expect(challengeStreakOf(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-11'], today)).toEqual({
      current: 1,
      longest: 3,
    });
    expect(challengeStreakOf(['2026-08-01', '2026-08-02'], today)).toEqual({ current: 0, longest: 2 });
  });
});

// ===========================================================================
// Class ranges
// ===========================================================================

describe('class ranges', () => {
  it('lists every class in an inclusive range, and refuses a backwards or out-of-list one', () => {
    expect(classesInRange(9, 12)).toEqual(['Class 9', 'Class 10', 'Class 11', 'Class 12']);
    expect(classesInRange(6, 6)).toEqual(['Class 6']);
    expect(() => classesInRange(8, 6)).toThrow();
    expect(() => classesInRange(2, 5)).toThrow();
  });

  it('labels a range the way the pages print it', () => {
    expect(classRangeLabel(3, 12)).toBe('All classes');
    expect(classRangeLabel(9, 9)).toBe('Class 9');
    expect(classRangeLabel(6, 8)).toBe('Classes 6–8');
  });

  it('reads a range as people write it in a spreadsheet', () => {
    expect(parseClassRange('9-12')).toEqual({ min: 9, max: 12 });
    expect(parseClassRange('9–12')).toEqual({ min: 9, max: 12 });
    expect(parseClassRange('Classes 6 to 8')).toEqual({ min: 6, max: 8 });
    expect(parseClassRange('Class 9 - Class 12')).toEqual({ min: 9, max: 12 });
    expect(parseClassRange('9th')).toEqual({ min: 9, max: 9 });
    expect(parseClassRange('All')).toEqual({ min: 3, max: 12 });
    expect(parseClassRange('all classes')).toEqual({ min: 3, max: 12 });
  });

  it('never guesses at a range it cannot read', () => {
    expect(parseClassRange('')).toBeNull();
    expect(parseClassRange('12-9')).toBeNull();
    expect(parseClassRange('1-5')).toBeNull();
    expect(parseClassRange('9-13')).toBeNull();
    expect(parseClassRange('senior')).toBeNull();
  });
});

describe('quiz days as written in a file', () => {
  it('reads ISO dates, spreadsheet timestamps and day-first dates', () => {
    expect(parseQuizDay('2026-11-08')).toBe('2026-11-08');
    expect(parseQuizDay('2026-11-08T00:00:00.000Z')).toBe('2026-11-08');
    expect(parseQuizDay('08/11/2026')).toBe('2026-11-08');
    expect(parseQuizDay('8-11-2026')).toBe('2026-11-08');
    expect(parseQuizDay('08.11.2026')).toBe('2026-11-08');
  });

  it('reads 03/04/2026 day-first, as the 3rd of April', () => {
    expect(parseQuizDay('03/04/2026')).toBe('2026-04-03');
  });

  it('refuses a date that does not exist, and anything that is not a date', () => {
    expect(parseQuizDay('2026-02-30')).toBeNull();
    expect(parseQuizDay('31/11/2026')).toBeNull();
    expect(parseQuizDay('tomorrow')).toBeNull();
    expect(parseQuizDay('')).toBeNull();
  });
});

// ===========================================================================
// Options: ids and the per-student order
// ===========================================================================

describe('option ids and the shuffle', () => {
  it('mints opaque ids that say nothing about position', () => {
    const ids = Array.from({ length: 50 }, () => newOptionId());
    for (const id of ids) expect(id).toMatch(/^o[0-9a-f]{10}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives one student the same order every time', () => {
    const options = ['oa', 'ob', 'oc', 'od'];
    const seed = shuffleSeed('student-1', 'quiz-1');
    const first = seededOrder(options, seed);
    for (let i = 0; i < 5; i += 1) expect(seededOrder(options, seed)).toEqual(first);
    expect([...first].sort()).toEqual([...options].sort());
  });

  it('does not give every student the same order', () => {
    const options = ['oa', 'ob', 'oc', 'od'];
    const orders = new Set(
      Array.from({ length: 40 }, (_, n) => seededOrder(options, shuffleSeed(`student-${n}`, 'quiz-1')).join(',')),
    );
    // 24 permutations exist; forty students landing on one or two would mean no shuffle.
    expect(orders.size).toBeGreaterThan(5);
  });

  it('does not mutate what it was given', () => {
    const options = ['oa', 'ob', 'oc', 'od'];
    seededOrder(options, 'x');
    expect(options).toEqual(['oa', 'ob', 'oc', 'od']);
  });
});

// ===========================================================================
// Winners
// ===========================================================================

function candidate(overrides: Partial<WinnerCandidate> & { studentId: string }): WinnerCandidate {
  return {
    attemptId: `attempt-${overrides.studentId}`,
    solveTimeMs: 30_000,
    submittedAt: new Date('2026-11-08T05:00:00.000Z'),
    eligible: true,
    disqualified: false,
    ...overrides,
  };
}

describe('the winner rule', () => {
  it('FASTEST_CORRECT: the shortest server-measured solve time wins', () => {
    const ranked = rankCandidates(
      [
        candidate({ studentId: 'slow', solveTimeMs: 60_000 }),
        candidate({ studentId: 'fast', solveTimeMs: 12_000 }),
        candidate({ studentId: 'middle', solveTimeMs: 30_000 }),
      ],
      'FASTEST_CORRECT',
    );
    expect(ranked.map((c) => c.studentId)).toEqual(['fast', 'middle', 'slow']);
  });

  it('FASTEST_CORRECT: an equal solve time goes to the earlier submission', () => {
    const ranked = rankCandidates(
      [
        candidate({ studentId: 'later', solveTimeMs: 20_000, submittedAt: new Date('2026-11-08T09:00:00.000Z') }),
        candidate({ studentId: 'earlier', solveTimeMs: 20_000, submittedAt: new Date('2026-11-08T03:00:00.000Z') }),
      ],
      'FASTEST_CORRECT',
    );
    expect(ranked[0]!.studentId).toBe('earlier');
  });

  it('FIRST_CORRECT: the earliest submission wins, however long it took', () => {
    const ranked = rankCandidates(
      [
        candidate({ studentId: 'quick-but-late', solveTimeMs: 5_000, submittedAt: new Date('2026-11-08T10:00:00.000Z') }),
        candidate({ studentId: 'slow-but-early', solveTimeMs: 90_000, submittedAt: new Date('2026-11-07T19:00:00.000Z') }),
      ],
      'FIRST_CORRECT',
    );
    expect(ranked[0]!.studentId).toBe('slow-but-early');
  });

  it('skips the ineligible and the disqualified, whatever their time', () => {
    const ranked = rankCandidates(
      [
        candidate({ studentId: 'no-profile', solveTimeMs: 1_000, eligible: false }),
        candidate({ studentId: 'disqualified', solveTimeMs: 2_000, disqualified: true }),
        candidate({ studentId: 'winner', solveTimeMs: 40_000 }),
      ],
      'FASTEST_CORRECT',
    );
    expect(ranked.map((c) => c.studentId)).toEqual(['winner']);
  });

  it('puts a missing solve time last, and breaks a complete tie on the student id', () => {
    const same = { solveTimeMs: 10_000, submittedAt: new Date('2026-11-08T04:00:00.000Z') };
    const ranked = rankCandidates(
      [
        candidate({ studentId: 'unknown-time', solveTimeMs: null }),
        candidate({ studentId: 'b', ...same }),
        candidate({ studentId: 'a', ...same }),
      ],
      'FASTEST_CORRECT',
    );
    expect(ranked.map((c) => c.studentId)).toEqual(['a', 'b', 'unknown-time']);
  });

  it('prints how winners are chosen from the same settings the ranking uses', () => {
    expect(describeWinnerRule('FASTEST_CORRECT', 1)).toMatch(/fastest solve time/i);
    expect(describeWinnerRule('FASTEST_CORRECT', 1)).toMatch(/One winner is chosen/);
    expect(describeWinnerRule('FIRST_CORRECT', 2)).toMatch(/reached our server first/i);
    expect(describeWinnerRule('FIRST_CORRECT', 2)).toMatch(/2 winners are chosen/);
    expect(describeWinnerRule('MANUAL', 1)).toMatch(/organisers choose/i);
  });

  it('names every prize requirement a student can meet — the rules page lists them nowhere else', () => {
    // A Record, so a requirement added to prizeEligibility() fails the typecheck here until it
    // is named — the parent's consent went unmentioned for a while after Phase 6 added it.
    const phrase: Record<EligibilityRequirement, RegExp | null> = {
      'verified-email': /verified email address/,
      'active-account': null, // not a step a student takes: a suspended account cannot sign in
      name: /\bname\b/,
      class: /\bclass\b/,
      school: /\bschool\b/,
      city: /\bcity\b/,
      'guardian-phone': /parent or guardian’s phone number/,
      'guardian-consent': /parent or guardian’s consent/,
    };
    for (const rule of WINNER_RULES) {
      for (const pattern of Object.values(phrase)) {
        if (pattern) expect(describeWinnerRule(rule, 1)).toMatch(pattern);
      }
    }
  });
});

describe('prize eligibility', () => {
  const complete = {
    isEmailVerified: true,
    status: 'active',
    firstName: 'Asha',
    lastName: 'Verma',
    classLevel: 'Class 9',
    schoolName: 'Sunrise School',
    city: 'Jaipur',
    guardianPhone: '9876543210',
    guardianConsentAt: new Date('2026-10-01T10:00:00Z'),
  };

  it('is eligible with everything the organisers need to reach and verify a winner', () => {
    expect(prizeEligibility(complete)).toEqual({ eligible: true, missing: [] });
  });

  it('names exactly what is missing', () => {
    const result = prizeEligibility({ ...complete, isEmailVerified: false, city: '  ', guardianPhone: null });
    expect(result.eligible).toBe(false);
    expect(result.missing).toEqual(['verified-email', 'city', 'guardian-phone']);
  });

  it('refuses a suspended account', () => {
    expect(prizeEligibility({ ...complete, status: 'suspended' }).missing).toEqual(['active-account']);
  });

  it('needs a parent or guardian’s consent — an account made before the box was asked for lacks it', () => {
    expect(prizeEligibility({ ...complete, guardianConsentAt: null }).missing).toEqual(['guardian-consent']);
    expect(prizeEligibility({ ...complete, guardianConsentAt: undefined }).missing).toEqual(['guardian-consent']);
  });
});

describe('the shared-connection flag', () => {
  it('hashes an address with the server secret, and never returns the address', () => {
    const hash = hashIp('203.0.113.7', 'secret-one');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain('203');
    expect(hashIp('203.0.113.7', 'secret-two')).not.toBe(hash);
    expect(hashIp(null, 'secret-one')).toBeNull();
  });

  it('counts the OTHER attempts that share an address', () => {
    const counts = sharedIpCounts([
      { id: 'a', ipHash: 'h1' },
      { id: 'b', ipHash: 'h1' },
      { id: 'c', ipHash: 'h1' },
      { id: 'd', ipHash: 'h2' },
      { id: 'e', ipHash: null },
    ]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('d')).toBe(0);
    expect(counts.get('e')).toBe(0);
  });
});

describe('what a quiz question must look like', () => {
  const question = {
    type: 'single_choice',
    options: [{ isCorrect: false }, { isCorrect: true }, { isCorrect: false }, { isCorrect: false }],
    solution: 'Because.',
    classLevel: 'Class 9',
  };

  it('accepts a single-choice question with one correct option, a solution and a class in range', () => {
    expect(quizQuestionProblem(question, { min: 9, max: 12 })).toBeNull();
  });

  it('refuses each way it could fail, with words a person can act on', () => {
    expect(quizQuestionProblem({ ...question, type: 'numeric' }, { min: 9, max: 12 })).toMatch(/single choice/);
    expect(quizQuestionProblem({ ...question, options: [{ isCorrect: true }] }, { min: 9, max: 12 })).toMatch(/2 and 6/);
    expect(
      quizQuestionProblem({ ...question, options: [{ isCorrect: true }, { isCorrect: true }] }, { min: 9, max: 12 }),
    ).toMatch(/exactly one correct/);
    expect(quizQuestionProblem({ ...question, solution: '  ' }, { min: 9, max: 12 })).toMatch(/worked solution/);
    expect(quizQuestionProblem(question, { min: 3, max: 5 })).toMatch(/outside Classes 3–5/);
  });
});

// ===========================================================================
// The tabular readers behind the bulk import
// ===========================================================================

describe('CSV', () => {
  it('reads quoted fields holding commas, doubled quotes and line breaks', () => {
    const rows = parseCsv('Question,Solution\r\n"What is 1,000 + 1?","Add: ""1,001"".\nDone."\r\n');
    expect(rows).toEqual([
      ['Question', 'Solution'],
      ['What is 1,000 + 1?', 'Add: "1,001".\nDone.'],
    ]);
  });

  it('detects a semicolon- or tab-separated file from its header', () => {
    expect(parseCsv('Question;Answer\nWhat;B\n')).toEqual([
      ['Question', 'Answer'],
      ['What', 'B'],
    ]);
    expect(parseCsv('Question\tAnswer\nWhat\tB\n')).toEqual([
      ['Question', 'Answer'],
      ['What', 'B'],
    ]);
  });

  it('names the row of a quote that is never closed instead of swallowing the file', () => {
    expect(() => parseCsv('Question,Answer\nfine,A\n"broken,B\nnext,C\n')).toThrow(/row 3/);
  });
});

describe('JSON as a table', () => {
  it('turns an options array into option columns and an isCorrect flag into the answer letter', () => {
    const { rows, failures } = jsonToTable([
      { day: '2026-11-08', classes: '9-12', question: 'Q?', options: [{ text: '1' }, { text: '2', isCorrect: true }] },
    ]);
    expect(failures).toEqual([]);
    expect(rows[0]).toEqual(['day', 'classes', 'question', 'Option A', 'Option B', 'Correct Answer']);
    expect(rows[1]).toEqual(['2026-11-08', '9-12', 'Q?', '1', '2', 'B']);
  });

  it('lets a stated answer win over an isCorrect flag', () => {
    const { rows } = jsonToTable({ questions: [{ question: 'Q?', answer: 'A', options: [{ text: '1' }, { text: '2', isCorrect: true }] }] });
    expect(rows[0]).toEqual(['question', 'answer', 'Option A', 'Option B']);
    expect(rows[1]).toEqual(['Q?', 'A', '1', '2']);
  });

  it('reports an item that is not an object, and keeps every later row on its own number', () => {
    const { rows, failures } = jsonToTable([{ question: 'one' }, 'oops', { question: 'three' }]);
    expect(failures).toEqual([{ sourceRef: 'Question 2', reason: expect.stringMatching(/not an object/) }]);
    expect(rows.length).toBe(4);
    expect(rows[3]).toEqual(['three']);
  });

  it('refuses a document that holds no list of questions', () => {
    expect(() => jsonToTable({ title: 'nothing here' })).toThrow(/array of questions/);
  });
});
