import { createHmac, randomBytes } from 'node:crypto';
import { CLASS_LEVELS, isClassLevel, type ClassLevel } from './classLevels';
import { isDayKey, istDayBounds, type DayKey } from './competitionDay';

/**
 * The Daily Quiz's rules that need no database (Milestone 30, Phase 2).
 *
 * Pure functions, like `lib/achievements.ts` and `lib/journey.ts`: every rule here can be
 * tested directly, at its boundary, without a server. The service layer
 * (`services/dailyChallengeService.ts`) supplies facts and stores results; it does not
 * decide any of what follows.
 *
 *  - **Class groups** — a quiz targets a range of classes.
 *  - **The window** — open from IST midnight to the next one; answer and solution
 *    revealed at that next midnight.
 *  - **Option ids and the shuffle** — opaque ids, and an order that differs per student
 *    but is stable for each one.
 *  - **Prize eligibility** — what a winner must have.
 *  - **Winner rules** — how the candidates are ordered, and the one sentence the public
 *    rules page prints about it.
 */

// ---------------------------------------------------------------------------
// Class groups
// ---------------------------------------------------------------------------

export const MIN_CLASS = 3;
export const MAX_CLASS = 12;

/** `'Class 9'` → 9. */
export function classNumber(level: ClassLevel): number {
  return Number(level.slice('Class '.length));
}

/** 9 → `'Class 9'`. Throws for a number outside the class list. */
export function classLevelOf(value: number): ClassLevel {
  const level = `Class ${value}`;
  if (!isClassLevel(level)) throw new RangeError(`There is no class ${value}.`);
  return level;
}

export function isClassNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_CLASS && value <= MAX_CLASS;
}

/** Every class in an inclusive range, in order. */
export function classesInRange(min: number, max: number): ClassLevel[] {
  if (!isClassNumber(min) || !isClassNumber(max) || min > max) {
    throw new RangeError(`Not a valid class range: ${min}–${max}.`);
  }
  return CLASS_LEVELS.filter((level) => {
    const n = classNumber(level);
    return n >= min && n <= max;
  });
}

/**
 * The three groups the launch brief proposes (§3), offered as presets. A custom range is
 * allowed too — these are a convenience, not a constraint.
 */
export const CLASS_GROUPS = [
  { key: '3-5', min: 3, max: 5 },
  { key: '6-8', min: 6, max: 8 },
  { key: '9-12', min: 9, max: 12 },
] as const;

/** "Class 9", "Classes 9–12", or "All classes". */
export function classRangeLabel(min: number, max: number): string {
  if (min === MIN_CLASS && max === MAX_CLASS) return 'All classes';
  if (min === max) return `Class ${min}`;
  return `Classes ${min}–${max}`;
}

/** What a question must look like to be a Daily Quiz — the facts `quizQuestionProblem()` reads. */
export interface QuizQuestionShape {
  type: string;
  options: ReadonlyArray<{ isCorrect: boolean }>;
  solution?: string | null;
  classLevel?: string | null;
}

/**
 * Why a question cannot be a Daily Quiz for this range, or `null` when it can — the content
 * rules, with no database. One function so the scheduler (checking a bank question) and the
 * bulk import (checking a row before it is a question) cannot disagree:
 *
 *  - **single choice** with **2–6 options** and **exactly one correct** — the brief's A–D quiz;
 *  - a **worked solution**, because unlocking it the next day is the point (R6);
 *  - for a class **inside the quiz's range**.
 *
 * Whether it is published or already used on another day needs the database, so the
 * scheduler checks those itself.
 */
export function quizQuestionProblem(question: QuizQuestionShape, range: { min: number; max: number }): string | null {
  if (question.type !== 'single_choice') {
    return 'A Daily Quiz question must be single choice (one correct option out of 2–6).';
  }
  if (question.options.length < 2 || question.options.length > 6) {
    return 'A Daily Quiz question needs between 2 and 6 options.';
  }
  if (question.options.filter((option) => option.isCorrect).length !== 1) {
    return 'A Daily Quiz question needs exactly one correct option.';
  }
  if (!question.solution || question.solution.trim().length === 0) {
    return 'Add a worked solution first — it unlocks for students the day after the quiz.';
  }
  if (!question.classLevel || !isClassLevel(question.classLevel)) return 'That question has no class.';
  const n = classNumber(question.classLevel);
  if (n < range.min || n > range.max) {
    return `That question is for ${question.classLevel}, outside ${classRangeLabel(range.min, range.max)}.`;
  }
  return null;
}

/**
 * A class range as a person writes it in a spreadsheet: `9-12`, `9–12`, `9 to 12`,
 * `Classes 9-12`, `Class 9`, `9th`, `All`, `All classes`.
 *
 * Forgiving about spelling and nothing else, on the rule `normaliseClassLevel()` follows:
 * anything it does not recognise is `null`, reported against its row, and never guessed —
 * a quiz filed for the wrong classes is a prize offered to the wrong children.
 */
export function parseClassRange(text: string): { min: number; max: number } | null {
  const value = text.trim().toLowerCase().replace(/\s+/gu, ' ');
  if (value.length === 0) return null;
  if (/^all(?: classes)?$/u.test(value)) return { min: MIN_CLASS, max: MAX_CLASS };

  const match =
    /^(?:classes|class|grades|grade|std)?\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|—|to)\s*(?:class\s*)?(\d{1,2})(?:st|nd|rd|th)?)?$/u.exec(
      value,
    );
  if (!match?.[1]) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  if (!isClassNumber(min) || !isClassNumber(max) || min > max) return null;
  return { min, max };
}

/**
 * A quiz day as a person writes it: `2026-11-08`, `08/11/2026`, `8-11-2026` or `08.11.2026`
 * (day first — the Indian convention), or the ISO timestamp a spreadsheet date cell reads as.
 *
 * Day-first is a decision, not a guess: `03/04/2026` is the 3rd of April here, as it is on
 * every form this owner fills in. A value that is not a real calendar date is `null`.
 */
export function parseQuizDay(text: string): DayKey | null {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/u.exec(value);
  if (iso) {
    const key = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isDayKey(key) ? key : null;
  }
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/u.exec(value);
  if (dayFirst) {
    const key = `${dayFirst[3]}-${dayFirst[2]!.padStart(2, '0')}-${dayFirst[1]!.padStart(2, '0')}`;
    return isDayKey(key) ? key : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

export interface QuizWindow {
  /** IST midnight at the start of the quiz's day. */
  opensAt: Date;
  /** The next IST midnight, **exclusive**: the quiz is open while `now < closesAt`. */
  closesAt: Date;
  /** When the correct answer and the worked solution unlock — the brief's R6. */
  revealAt: Date;
}

/**
 * A quiz's three instants, derived from its day alone — never stored, so they cannot
 * disagree with the day, and never computed by a browser.
 *
 * `revealAt` equals `closesAt` on purpose: the answer unlocks the moment nobody can
 * submit any more, which is "the next day" in the owner's words.
 */
export function quizWindow(day: DayKey): QuizWindow {
  const { start, end } = istDayBounds(day);
  return { opensAt: start, closesAt: end, revealAt: end };
}

export type QuizPhase = 'upcoming' | 'open' | 'revealed';

/** Where a quiz is at `at`. Derived from timestamps, so nothing has to run at midnight. */
export function quizPhaseAt(day: DayKey, at: Date): QuizPhase {
  const window = quizWindow(day);
  if (at.getTime() < window.opensAt.getTime()) return 'upcoming';
  if (at.getTime() < window.closesAt.getTime()) return 'open';
  return 'revealed';
}

// ---------------------------------------------------------------------------
// Option ids and the per-student order
// ---------------------------------------------------------------------------

/**
 * A fresh opaque option id: `o` and ten random hex digits.
 *
 * Opaque so that nothing about an id hints at the option's position or at which one is
 * correct — `a`, `b`, `c`, `d` would tell a reader the author's original order, and many
 * authors put the right answer in the same place.
 */
export function newOptionId(): string {
  return `o${randomBytes(5).toString('hex')}`;
}

/** 32-bit FNV-1a: small, stable and well spread — a seed, not a secret. */
function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32 — a tiny seeded PRNG, enough to shuffle four options fairly. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `items` in an order fixed by `seed` — a Fisher–Yates shuffle over a seeded PRNG.
 *
 * Deterministic: the same seed always gives the same order, so a student who reloads,
 * or opens a second tab, sees the options where they left them. The seed is the student
 * and the quiz together (`shuffleSeed`), so two students sitting side by side see
 * different letters and "the answer is B" carries nothing from one screen to the other.
 * The order is also stored on the student's start record, so it survives any later
 * change to this function.
 */
export function seededOrder<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const random = mulberry32(fnv1a(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function shuffleSeed(studentId: string, quizId: string): string {
  return `${studentId}:${quizId}`;
}

/** A–F, for painting a letter on the option in position `index`. Display only. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

// ---------------------------------------------------------------------------
// Network fingerprint, for the winner review
// ---------------------------------------------------------------------------

/**
 * A keyed hash of a client address — never the address itself.
 *
 * Stored per start and per submission so the winner review can flag correct answers that
 * came from one connection (several accounts, one person). Keyed with the server secret
 * so the column is useless to anybody who reads the database without it, and truncated
 * because it only ever needs to be compared for equality. A **flag for a human**, never a
 * disqualification: siblings and whole schools legitimately share one address.
 */
export function hashIp(ip: string | undefined | null, secret: string): string | null {
  if (!ip) return null;
  return createHmac('sha256', secret).update(`daily-quiz-ip:v1:${ip}`).digest('hex').slice(0, 32);
}

/** For each attempt, how many **other** attempts in the same set share its address hash. */
export function sharedIpCounts(attempts: ReadonlyArray<{ id: string; ipHash: string | null }>): Map<string, number> {
  const byHash = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.ipHash) byHash.set(attempt.ipHash, (byHash.get(attempt.ipHash) ?? 0) + 1);
  }
  return new Map(
    attempts.map((attempt) => [attempt.id, attempt.ipHash ? (byHash.get(attempt.ipHash) ?? 1) - 1 : 0]),
  );
}

// ---------------------------------------------------------------------------
// Prize eligibility
// ---------------------------------------------------------------------------

/** What a prize winner must have, by name, so a page can say exactly what is missing. */
export const ELIGIBILITY_REQUIREMENTS = [
  'verified-email',
  'active-account',
  'name',
  'class',
  'school',
  'city',
  'guardian-phone',
  'guardian-consent',
] as const;
export type EligibilityRequirement = (typeof ELIGIBILITY_REQUIREMENTS)[number];

export interface EligibilityFacts {
  isEmailVerified?: boolean | null;
  status?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  classLevel?: string | null;
  schoolName?: string | null;
  city?: string | null;
  guardianPhone?: string | null;
  /** When a parent or guardian agreed (Phase 6). Absent on accounts made before the box. */
  guardianConsentAt?: Date | null;
}

const present = (value: string | null | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

/**
 * Whether a student can be named a winner, and if not, what is missing (brief §6.6).
 *
 * The prize goes to a child, through their parent or guardian, after the organisers have
 * checked who they are — so a winner needs a verified email address, an active account
 * and a complete enough profile to be reached and verified: name, class, school, city and
 * a parent or guardian's phone number — and, since Phase 6, that parent or guardian's
 * recorded consent (an account made before the registration box gives it on its profile).
 * Playing never requires any of this; only winning does, and the quiz card tells a student
 * what to add before it matters.
 */
export function prizeEligibility(facts: EligibilityFacts): { eligible: boolean; missing: EligibilityRequirement[] } {
  const missing: EligibilityRequirement[] = [];
  if (facts.isEmailVerified !== true) missing.push('verified-email');
  if (facts.status !== 'active') missing.push('active-account');
  if (!present(facts.firstName) || !present(facts.lastName)) missing.push('name');
  if (!present(facts.classLevel)) missing.push('class');
  if (!present(facts.schoolName)) missing.push('school');
  if (!present(facts.city)) missing.push('city');
  if (!present(facts.guardianPhone)) missing.push('guardian-phone');
  if (!(facts.guardianConsentAt instanceof Date)) missing.push('guardian-consent');
  return { eligible: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Winner rules
// ---------------------------------------------------------------------------

/**
 * The prize desk's views. `outstanding` is what still needs a person: confirmed but not
 * yet announced, or announced with the prize not yet delivered.
 */
export const PRIZE_DESK_VIEWS = ['outstanding', 'published', 'disqualified', 'all'] as const;
export type PrizeDeskView = (typeof PRIZE_DESK_VIEWS)[number];

export const WINNER_RULES = ['FASTEST_CORRECT', 'FIRST_CORRECT', 'MANUAL'] as const;
export type WinnerRule = (typeof WINNER_RULES)[number];

export interface WinnerCandidate {
  attemptId: string;
  studentId: string;
  /** Server-measured, submit minus start. Null only for an attempt from before the Start step existed. */
  solveTimeMs: number | null;
  submittedAt: Date;
  eligible: boolean;
  disqualified: boolean;
}

/**
 * The eligible, not-disqualified candidates in winning order.
 *
 *  - `FASTEST_CORRECT` (the default) — shortest solve time; ties go to the earlier
 *    submission.
 *  - `FIRST_CORRECT` — earliest submission; ties go to the shorter solve time.
 *  - `MANUAL` — the organisers choose; the list is still offered fastest-first so they
 *    have a sensible order to choose from.
 *
 * The student id is the last key in every order, which makes it **total**: two
 * candidates can never be "equal", so recomputing never shuffles a tie into a different
 * winner. A missing solve time sorts last rather than first.
 */
export function rankCandidates(candidates: readonly WinnerCandidate[], rule: WinnerRule): WinnerCandidate[] {
  const solve = (c: WinnerCandidate) => c.solveTimeMs ?? Number.POSITIVE_INFINITY;
  const submitted = (c: WinnerCandidate) => c.submittedAt.getTime();
  const byId = (a: WinnerCandidate, b: WinnerCandidate) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0);

  const compare =
    rule === 'FIRST_CORRECT'
      ? (a: WinnerCandidate, b: WinnerCandidate) => submitted(a) - submitted(b) || solve(a) - solve(b) || byId(a, b)
      : (a: WinnerCandidate, b: WinnerCandidate) => solve(a) - solve(b) || submitted(a) - submitted(b) || byId(a, b);

  return candidates.filter((c) => c.eligible && !c.disqualified).sort(compare);
}

/**
 * The public, plain-English statement of how winners are chosen — **generated from the
 * same settings the code uses** (brief §6.6), so the rules page and the computation can
 * never disagree.
 */
export function describeWinnerRule(rule: WinnerRule, winnersPerQuiz: number): string {
  const count =
    winnersPerQuiz === 1
      ? 'One winner is chosen for each quiz.'
      : `${winnersPerQuiz} winners are chosen for each quiz.`;

  const how: Record<WinnerRule, string> = {
    FASTEST_CORRECT:
      'Among everyone who answers correctly, the winner is the student with the fastest solve time — measured by our server from the moment they press Start to the moment they submit. If two solve times are equal, the earlier submission wins.',
    FIRST_CORRECT:
      'Among everyone who answers correctly, the winner is the student whose correct answer reached our server first. If two arrive at the same moment, the faster solve time wins.',
    MANUAL: 'The organisers choose the winner from the students who answered correctly.',
  };

  return (
    `${how[rule]} ${count} ` +
    'To win, a student needs a verified email address and a complete profile — name, class, school, city and a parent or guardian’s phone number. ' +
    'The organisers check every winner before announcing them, the day after the quiz.'
  );
}
