import type { Difficulty } from '../../models/Question';

/**
 * The machinery behind the generated questions (2026-10-10): a seeded random source, number
 * formatting, and the template shape. Two users: the practice bank (`scripts/data/practiceMaths.ts`,
 * which builds 150 a class with `buildBank()`) and the automatic Daily Quiz
 * (`services/dailyQuizAuto.ts`, which draws one a day per class with `quizDraftFor()`). The
 * templates are `junior.ts` (Classes 3–7) and `senior.ts` (Classes 8–12); `index.ts` maps a class
 * to its fifteen.
 *
 * **Never change a template's output casually.** The practice bank in production was seeded from
 * exactly these texts, and the seed identifies a question by its text: a changed template makes a
 * re-run add its new questions beside the old. `tests/practiceSeed.test.ts` pins the whole bank.
 *
 * ## Why generated, and why that is safe
 *
 * The owner asked for 150 questions per class, Classes 3 to 12. Written by hand, 1,500 answer keys
 * would carry a few wrong ones, and a wrong key is a real mark against a child. Here every question
 * is produced by a template whose **answer is computed** from the same numbers the question shows,
 * so the key cannot disagree with the question, and every worked solution states the computation.
 *
 * ## Deterministic
 *
 * The random source is seeded from the class, so the same bank comes out every time: the seed
 * runner identifies a question by its text, and a re-run must find the same texts to skip them.
 * Changing a template changes its questions — which adds new ones beside the old on the next run.
 */

export type Rng = () => number;

/** mulberry32, seeded from a string. Small, fast and well spread. */
export function rngFor(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export const lcm = (a: number, b: number): number => Math.abs(a * b) / gcd(a, b);
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d += 1) if (n % d === 0) return false;
  return true;
}
export function factorial(n: number): number {
  let out = 1;
  for (let i = 2; i <= n; i += 1) out *= i;
  return out;
}
export function nCr(n: number, r: number): number {
  let out = 1;
  for (let i = 1; i <= r; i += 1) out = (out * (n - r + i)) / i;
  return Math.round(out);
}
export const nPr = (n: number, r: number): number => factorial(n) / factorial(n - r);

/**
 * A fraction already in lowest terms, its denominator between `dLo` and `dHi` (at least 2): proper
 * unless `maxNumerator` allows more. A question never shows a child 3/12 or 8/2 to work with.
 */
export function lowestTerms(rng: Rng, dLo: number, dHi: number, maxNumerator?: number): [number, number] {
  for (;;) {
    const d = int(rng, dLo, dHi);
    const n = int(rng, 1, maxNumerator ?? d - 1);
    if (n !== d && gcd(n, d) === 1) return [n, d];
  }
}

// ---------------------------------------------------------------------------------------------
// Formatting — every number a child reads goes through one of these
// ---------------------------------------------------------------------------------------------

/** Indian digit grouping for a whole number: 1,23,456. No sign. */
export function inr(n: number): string {
  const s = String(Math.abs(Math.trunc(n)));
  if (s.length <= 3) return s;
  const last = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last}`;
}

/** A whole number as prose: grouped, and in maths mode when negative, so the sign is a real minus. */
export function N(n: number): string {
  return n < 0 ? `$-${inr(-n)}$` : inr(n);
}

/** A whole number inside maths: bare digits, the sign a minus. */
export function M(n: number): string {
  return n < 0 ? `-${Math.abs(n)}` : String(n);
}

/** `+ 3` / `- 3` — the next term of an expression, inside maths. */
export function signed(n: number): string {
  return n < 0 ? `- ${Math.abs(n)}` : `+ ${n}`;
}

/** A term `kx` inside an expression after the first: `+ 3x`, `- x`, or nothing for 0. */
export function termAfter(k: number, v: string): string {
  if (k === 0) return '';
  const size = Math.abs(k) === 1 ? '' : String(Math.abs(k));
  return ` ${k < 0 ? '-' : '+'} ${size}${v}`;
}

/** The leading term `kx`: `3x`, `-x`, `x`. */
export function termFirst(k: number, v: string): string {
  if (k === 1) return v;
  if (k === -1) return `-${v}`;
  return `${k}${v}`;
}

/** A polynomial in maths: coefficients from the highest power down, e.g. [2, -3, 0, 5] → 2x^3 - 3x^2 + 5. */
export function poly(coeffs: number[], v = 'x'): string {
  const degree = coeffs.length - 1;
  let out = '';
  coeffs.forEach((c, i) => {
    const p = degree - i;
    if (c === 0) return;
    const unit = p === 0 ? '' : p === 1 ? v : `${v}^{${p}}`;
    if (out === '') {
      out = p === 0 ? M(c) : termFirst(c, unit);
    } else if (p === 0) {
      out += ` ${signed(c)}`;
    } else {
      out += termAfter(c, unit);
    }
  });
  return out || '0';
}

/** A reduced fraction inside maths: `\frac{3}{4}`, `-\frac{3}{4}`, or a whole number. */
export function frac(n: number, d: number): string {
  if (d === 0) throw new Error('zero denominator');
  // A decimal here would print as a fraction of two 16-digit numbers.
  if (!Number.isInteger(n) || !Number.isInteger(d)) throw new Error(`not a whole-number fraction: ${n}/${d}`);
  if (d < 0) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1;
  const [a, b] = [n / g, d / g];
  if (b === 1) return M(a);
  return a < 0 ? `-\\frac{${-a}}{${b}}` : `\\frac{${a}}{${b}}`;
}

/** The same, as an option or in prose. */
export const F = (n: number, d: number): string => `$${frac(n, d)}$`;

/** Hundredths as a decimal: 345 → "3.45", 120 → "1.2", 300 → "3". */
export function dec(hundredths: number): string {
  const neg = hundredths < 0;
  const h = Math.abs(Math.round(hundredths));
  const whole = Math.trunc(h / 100);
  const part = String(h % 100).padStart(2, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${inr(whole)}${part ? `.${part}` : ''}`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  return `${n}${suffix[n % 10] ?? 'th'}`;
}

// ---------------------------------------------------------------------------------------------
// Templates and the builder
// ---------------------------------------------------------------------------------------------

/** One question as a template makes it: the text, the right option, the wrong ones, the working. */
export interface Draft {
  q: string;
  a: string;
  /** Candidate wrong options, best first. The builder takes the first three that differ from the
      answer and from each other. */
  wrong: string[];
  s: string;
}

export interface Template {
  topic: string;
  /** How many questions this template contributes. */
  count: number;
  d: Difficulty;
  make: (rng: Rng) => Draft;
}
