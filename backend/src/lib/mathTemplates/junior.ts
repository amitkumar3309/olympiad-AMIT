import {
  F,
  M,
  N,
  dec,
  frac,
  gcd,
  int,
  inr,
  lcm,
  lowestTerms,
  pick,
  shuffled,
  signed,
  type Rng,
  type Template,
} from './engine';

/**
 * The practice templates for Classes 3 to 7 (2026-10-10). Fifteen templates a class, ten questions
 * each, every answer computed from the numbers in the question. See `engine.ts`.
 */

const PLACE_NAMES = ['ones', 'tens', 'hundreds', 'thousands', 'ten thousands', 'lakhs'] as const;

/** A number with distinct digits (the first non-zero), so "the digit 7" names one place. */
function distinctDigits(rng: Rng, length: number): number[] {
  const digits = shuffled(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, length);
  if (digits[0] === 0) [digits[0], digits[1]] = [digits[1]!, digits[0]!];
  return digits;
}

/** A 12-hour clock reading from minutes after midnight, e.g. 615 → "10:15". */
function clock(minutes: number): string {
  const m = ((minutes % 720) + 720) % 720;
  const h = Math.floor(m / 60);
  return `${h === 0 ? 12 : h}:${String(m % 60).padStart(2, '0')}`;
}

/** The place-value template, shared by Classes 3, 4 and 5 with a different number of digits. */
function placeValue(length: number): (rng: Rng) => { q: string; a: string; wrong: string[]; s: string } {
  return (rng) => {
    const digits = distinctDigits(rng, length);
    const n = Number(digits.join(''));
    const positions = digits.map((d, i) => ({ d, p: length - 1 - i })).filter((x) => x.d !== 0);
    const chosen = pick(rng, positions);
    const value = chosen.d * 10 ** chosen.p;
    const others = [0, 1, 2, 3, 4, 5].filter((p) => p !== chosen.p && p < length).map((p) => inr(chosen.d * 10 ** p));
    return {
      q: `What is the place value of ${chosen.d} in ${inr(n)}?`,
      a: inr(value),
      wrong: shuffled(rng, others),
      s: `In ${inr(n)}, the digit ${chosen.d} is in the ${PLACE_NAMES[chosen.p]} place, so its value is ${chosen.d} × ${inr(10 ** chosen.p)} = ${inr(value)}.`,
    };
  };
}

// =============================================================================================
// Class 3
// =============================================================================================

export const CLASS_3: Template[] = [
  {
    topic: 'Addition and Subtraction',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, 100, 499);
      const b = int(rng, 100, 499);
      const s = a + b;
      return { q: `What is ${a} + ${b}?`, a: N(s), wrong: [s + 10, s - 10, s + 100, s + 1].map(N), s: `Add the ones, then the tens, then the hundreds, carrying where needed: ${a} + ${b} = ${s}.` };
    },
  },
  {
    topic: 'Addition and Subtraction',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 400, 999);
      const b = int(rng, 100, a - 50);
      const d = a - b;
      return { q: `What is ${a} − ${b}?`, a: N(d), wrong: [d + 10, d - 10, d + 100, d + 1].map(N), s: `${a} − ${b} = ${d}. Check: ${d} + ${b} = ${a}.` };
    },
  },
  {
    topic: 'Multiplication',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, 2, 10);
      const b = int(rng, 2, 10);
      const p = a * b;
      return { q: `What is $${a} \\times ${b}$?`, a: N(p), wrong: [a * (b + 1), a * (b - 1), (a + 1) * b, a + b, p + 2].map(N), s: `$${a} \\times ${b}$ means ${b} groups of ${a}: ${p}.` };
    },
  },
  {
    topic: 'Multiplication',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 12, 49);
      const b = int(rng, 3, 9);
      const p = a * b;
      const tens = a - (a % 10);
      const ones = a % 10;
      return {
        q: `What is $${a} \\times ${b}$?`,
        a: N(p),
        wrong: [p + b, p - b, p + 10, tens * b + ones].map(N),
        s:
          ones === 0
            ? `$${a} \\times ${b} = ${tens / 10} \\times ${b} \\times 10 = ${(tens / 10) * b} \\times 10 = ${p}$.`
            : `$${a} \\times ${b} = ${tens} \\times ${b} + ${ones} \\times ${b} = ${tens * b} + ${ones * b} = ${p}$.`,
      };
    },
  },
  {
    topic: 'Division',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const b = int(rng, 2, 9);
      const q = int(rng, 2, 12);
      const n = b * q;
      return { q: `What is $${n} \\div ${b}$?`, a: N(q), wrong: [q + 1, q - 1, q + 2, b, n - b].filter((x) => x > 0).map(N), s: `$${b} \\times ${q} = ${n}$, so $${n} \\div ${b} = ${q}$.` };
    },
  },
  { topic: 'Numbers', count: 10, d: 'Medium', make: placeValue(4) },
  {
    topic: 'Numbers',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const th = int(rng, 1, 9);
      const h = int(rng, 1, 9);
      const t = rng() < 0.5 ? 0 : int(rng, 1, 9);
      const o = int(rng, 1, 9);
      const n = th * 1000 + h * 100 + t * 10 + o;
      const parts = [th * 1000, h * 100, t * 10, o].filter((x) => x > 0);
      const expr = parts.map(inr).join(' + ');
      return {
        q: `Which number is ${expr}?`,
        a: inr(n),
        wrong: [th * 1000 + h * 100 + o * 10 + t, Number(`${th}${h}${o}`), n + 10, n + 100, th * 1000 + t * 100 + h * 10 + o].map(inr),
        s: `${expr} = ${inr(n)}${t === 0 ? ' — there are no tens, so the tens digit is 0' : ''}.`,
      };
    },
  },
  {
    topic: 'Fractions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const k = pick(rng, [2, 3, 4, 5]);
      const m = int(rng, 2, 12);
      const n = k * m;
      return {
        q: `What is $\\frac{1}{${k}}$ of ${n}?`,
        a: N(m),
        wrong: [m + 1, m - 1, n - m, m * 2, k].map(N),
        s: `$\\frac{1}{${k}}$ of ${n} means ${n} shared into ${k} equal parts: $${n} \\div ${k} = ${m}$.`,
      };
    },
  },
  {
    topic: 'Money',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const item = pick(rng, ['pencil box', 'notebook', 'eraser pack', 'ruler', 'pen']);
      const p = int(rng, 5, 50);
      const c = int(rng, 2, 9);
      const t = p * c;
      const rupees = (x: number) => `₹${inr(x)}`;
      return {
        q: `One ${item} costs ₹${p}. What do ${c} of them cost?`,
        a: rupees(t),
        wrong: [t + p, t - p, p + c, t + 10].map(rupees),
        s: `${c} × ₹${p} = ₹${t}.`,
      };
    },
  },
  {
    topic: 'Time',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const start = int(rng, 1, 10) * 60 + int(rng, 0, 11) * 5;
      const dur = pick(rng, [15, 20, 25, 30, 35, 40, 45, 50, 55, 75, 90]);
      const end = start + dur;
      return {
        q: `A cartoon starts at ${clock(start)} and lasts ${dur} minutes. At what time does it end?`,
        a: clock(end),
        wrong: [end + 10, end - 10, end + 60, end - 5, start + dur + 30].map(clock),
        s: `${clock(start)} + ${dur} minutes = ${clock(end)}.`,
      };
    },
  },
  {
    topic: 'Measurement',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const m = int(rng, 2, 9);
      const cm = int(rng, 1, 19) * 5;
      const total = m * 100 + cm;
      return {
        q: `How many centimetres are there in ${m} m ${cm} cm?`,
        a: `${inr(total)} cm`,
        wrong: [m * 10 + cm, m * 1000 + cm, m * 100, total + 100].map((x) => `${inr(x)} cm`),
        s: `1 m = 100 cm${m === 1 ? '' : `, so ${m} m = ${m * 100} cm`}, and ${m * 100} + ${cm} = ${total} cm.`,
      };
    },
  },
  {
    topic: 'Patterns',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, 2, 30);
      const d = int(rng, 2, 12);
      const next = a + 4 * d;
      return {
        q: `What comes next? ${a}, ${a + d}, ${a + 2 * d}, ${a + 3 * d}, …`,
        a: N(next),
        wrong: [next + 1, next - 1, a + 5 * d, next + 2].map(N),
        s: `Each number is ${d} more than the one before: ${a + 3 * d} + ${d} = ${next}.`,
      };
    },
  },
  {
    topic: 'Shapes',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const [shape, n] = pick(rng, [
        ['triangle', 3],
        ['square', 4],
        ['rectangle', 4],
        ['pentagon', 5],
        ['hexagon', 6],
        ['octagon', 8],
      ] as const);
      const kind = pick(rng, ['sides', 'corners'] as const);
      const article = shape === 'octagon' ? 'an' : 'a';
      return {
        q: `How many ${kind} does ${article} ${shape} have?`,
        a: String(n),
        wrong: shuffled(rng, [3, 4, 5, 6, 8].filter((x) => x !== n)).map(String),
        s: `${article === 'an' ? 'An' : 'A'} ${shape} has ${n} sides and ${n} corners.`,
      };
    },
  },
  {
    topic: 'Numbers',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const hundreds = int(rng, 1, 9);
      const set = new Set<number>();
      while (set.size < 4) set.add(hundreds * 100 + int(rng, 0, 99));
      const list = shuffled(rng, [...set]);
      const greatest = rng() < 0.5;
      const ans = greatest ? Math.max(...list) : Math.min(...list);
      return {
        q: `Which is the ${greatest ? 'greatest' : 'smallest'} of ${list.join(', ')}?`,
        a: String(ans),
        wrong: list.filter((x) => x !== ans).map(String),
        s: `All four have ${hundreds} hundreds, so compare the tens and then the ones: the ${greatest ? 'greatest' : 'smallest'} is ${ans}.`,
      };
    },
  },
  {
    topic: 'Multiplication',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const r = int(rng, 3, 9);
      const c = int(rng, 4, 12);
      const t = r * c;
      return {
        q: `There are ${r} rows of chairs with ${c} chairs in each row. How many chairs are there?`,
        a: N(t),
        wrong: [r + c, t + r, t - c, t + 10].map(N),
        s: `${r} rows × ${c} chairs = ${t} chairs.`,
      };
    },
  },
];

// =============================================================================================
// Class 4
// =============================================================================================

export const CLASS_4: Template[] = [
  {
    topic: 'Addition and Subtraction',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, 1000, 4999);
      const b = int(rng, 1000, 4999);
      const s = a + b;
      return { q: `What is ${inr(a)} + ${inr(b)}?`, a: N(s), wrong: [s + 100, s - 100, s + 1000, s + 10].map(N), s: `Add place by place, carrying where needed: ${inr(a)} + ${inr(b)} = ${inr(s)}.` };
    },
  },
  {
    topic: 'Addition and Subtraction',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 3000, 9999);
      const b = int(rng, 1000, a - 100);
      const d = a - b;
      return { q: `What is ${inr(a)} − ${inr(b)}?`, a: N(d), wrong: [d + 100, d - 100, d + 1000, d + 10].map(N), s: `${inr(a)} − ${inr(b)} = ${inr(d)}. Check: ${inr(d)} + ${inr(b)} = ${inr(a)}.` };
    },
  },
  {
    topic: 'Multiplication',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 12, 49);
      const b = int(rng, 11, 29);
      const p = a * b;
      const tens = b - (b % 10);
      const ones = b % 10;
      return {
        q: `What is $${a} \\times ${b}$?`,
        a: N(p),
        wrong: [p + a, p - a, a * ones + a * (tens / 10), p + 10].map(N),
        s:
          ones === 0
            ? `$${a} \\times ${b} = ${a} \\times ${tens / 10} \\times 10 = ${a * (tens / 10)} \\times 10 = ${p}$.`
            : `$${a} \\times ${b} = ${a} \\times ${tens} + ${a} \\times ${ones} = ${a * tens} + ${a * ones} = ${p}$.`,
      };
    },
  },
  {
    topic: 'Division',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const b = int(rng, 3, 9);
      const q = int(rng, 10, 40);
      const r = int(rng, 1, b - 1);
      const n = b * q + r;
      return {
        q: `What is the remainder when ${n} is divided by ${b}?`,
        a: String(r),
        wrong: [r + 1 < b ? r + 1 : r - 2, r - 1 >= 0 ? r - 1 : r + 2, q, b, 0].filter((x) => x >= 0).map(String),
        s: `${b} × ${q} = ${b * q}, and ${n} − ${b * q} = ${r}, which is less than ${b}. So the remainder is ${r}.`,
      };
    },
  },
  { topic: 'Large Numbers', count: 10, d: 'Medium', make: placeValue(5) },
  {
    topic: 'Rounding',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const unit = pick(rng, [10, 100]);
      let n = int(rng, 1001, 9998);
      while (n % unit === 0 || n % unit === unit / 2) n += 1;
      const down = Math.floor(n / unit) * unit;
      const up = down + unit;
      const ans = n % unit > unit / 2 ? up : down;
      const other = unit === 10 ? 100 : 10;
      const otherRound = Math.round(n / other) * other;
      const digit = unit === 10 ? n % 10 : Math.floor((n % 100) / 10);
      return {
        q: `What is ${inr(n)} rounded to the nearest ${unit}?`,
        a: inr(ans),
        wrong: [ans === up ? down : up, otherRound, ans + unit, ans - unit].map(inr),
        s: `Look at the ${unit === 10 ? 'ones' : 'tens'} digit, ${digit}: it is ${digit >= 5 ? '5 or more, so round up' : 'less than 5, so round down'}. ${inr(n)} rounds to ${inr(ans)}.`,
      };
    },
  },
  {
    topic: 'Fractions',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const b = int(rng, 2, 9);
      let a = int(rng, 1, b - 1);
      while (gcd(a, b) !== 1) a = int(rng, 1, b - 1);
      const k = int(rng, 2, 6);
      return {
        q: `$\\frac{${a}}{${b}} = \\frac{?}{${b * k}}$. What number goes in place of ?`,
        a: String(a * k),
        wrong: [a * k + 1, a + k, b * k - a * k, a * k - 1, a].map(String),
        s: `The denominator ${b} was multiplied by ${k} to make ${b * k}, so multiply the numerator by ${k} too: ${a} × ${k} = ${a * k}.`,
      };
    },
  },
  {
    topic: 'Fractions',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const d = int(rng, 5, 12);
      let a = int(rng, 1, d - 2);
      let b = int(rng, 1, d - 1 - a);
      while (gcd(a, d) !== 1 || gcd(b, d) !== 1) {
        a = int(rng, 1, d - 2);
        b = int(rng, 1, d - 1 - a);
      }
      const sum = frac(a + b, d);
      const unreduced = `\\frac{${a + b}}{${d}}`;
      return {
        q: `What is $\\frac{${a}}{${d}} + \\frac{${b}}{${d}}$?`,
        a: `$${sum}$`,
        wrong: [F(a + b, 2 * d), F(a * b, d), F(Math.abs(a - b) || a + b + 1, d), F(a + b + 1, d)],
        s: `The denominators are the same, so add the numerators: $\\frac{${a} + ${b}}{${d}} = ${unreduced}${sum !== unreduced ? ` = ${sum}` : ''}$.`,
      };
    },
  },
  {
    topic: 'Perimeter and Area',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const l = int(rng, 5, 30);
      const w = int(rng, 3, l - 1);
      const p = 2 * (l + w);
      return {
        q: `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter?`,
        a: `${p} cm`,
        wrong: [l * w, l + w, 2 * l + w, p + 2].map((x) => `${x} cm`),
        s: `Perimeter = 2 × (length + width) = 2 × (${l} + ${w}) = ${p} cm.`,
      };
    },
  },
  {
    topic: 'Perimeter and Area',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const l = int(rng, 5, 30);
      const w = int(rng, 3, l - 1);
      const area = l * w;
      return {
        q: `A rectangle is ${l} cm long and ${w} cm wide. What is its area?`,
        a: `${area} square cm`,
        wrong: [2 * (l + w), l + w, area + l, area - w].map((x) => `${x} square cm`),
        s: `Area = length × width = ${l} × ${w} = ${area} square cm.`,
      };
    },
  },
  {
    topic: 'Time',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const start = int(rng, 7, 10) * 60 + int(rng, 0, 11) * 5;
      const dur = int(rng, 7, 36) * 5;
      const end = start + dur;
      const h = Math.floor(dur / 60);
      const m = dur % 60;
      return {
        q: `A class starts at ${clock(start)} and ends at ${clock(end)}. How many minutes long is it?`,
        a: `${dur} minutes`,
        wrong: [dur + 60, dur - 10, dur + 10, dur + 40, dur - 40].filter((x) => x > 0).map((x) => `${x} minutes`),
        s: `From ${clock(start)} to ${clock(end)} is ${h > 0 ? `${h} hour${h > 1 ? 's' : ''} ` : ''}${m > 0 ? `${m} minutes` : ''} = ${dur} minutes.`,
      };
    },
  },
  {
    topic: 'Money',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const c = int(rng, 2, 6);
      const p = int(rng, 8, 45);
      const cost = c * p;
      const note = [100, 200, 500].find((x) => x > cost) ?? 500;
      const change = note - cost;
      const rupees = (x: number) => `₹${inr(x)}`;
      return {
        q: `Arjun buys ${c} notebooks at ₹${p} each and pays with a ₹${note} note. How much change does he get?`,
        a: rupees(change),
        wrong: [cost, note - p, change + 10, change - 10].filter((x) => x > 0).map(rupees),
        s: `Cost = ${c} × ₹${p} = ₹${cost}. Change = ₹${note} − ₹${cost} = ₹${change}.`,
      };
    },
  },
  {
    topic: 'Measurement',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const [big, small] = pick(rng, [
        ['kg', 'g'],
        ['L', 'mL'],
      ] as const);
      const k = int(rng, 1, 9);
      const g = int(rng, 1, 19) * 50;
      const total = k * 1000 + g;
      const word = small === 'g' ? 'grams' : 'millilitres';
      return {
        q: `How many ${word} are there in ${k} ${big} ${g} ${small}?`,
        a: `${inr(total)} ${small}`,
        wrong: [k * 100 + g, k + g, total + 100, k * 1000].map((x) => `${inr(x)} ${small}`),
        s: `1 ${big} = 1,000 ${small}${k === 1 ? '' : `, so ${k} ${big} = ${inr(k * 1000)} ${small}`}, and ${inr(k * 1000)} + ${g} = ${inr(total)} ${small}.`,
      };
    },
  },
  {
    topic: 'Factors and Multiples',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const k = int(rng, 3, 9);
      const m = k * int(rng, 3, 12);
      const wrong = new Set<number>();
      while (wrong.size < 3) {
        const x = m + int(rng, -9, 9);
        if (x > 0 && x % k !== 0) wrong.add(x);
      }
      const list = shuffled(rng, [m, ...wrong]);
      return {
        q: `Which of ${list.join(', ')} is a multiple of ${k}?`,
        a: String(m),
        wrong: [...wrong].map(String),
        s: `${m} = ${k} × ${m / k}, so it is a multiple of ${k}. Each of the others leaves a remainder when divided by ${k}.`,
      };
    },
  },
  {
    topic: 'Patterns',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 1, 9);
      const r = int(rng, 2, 3);
      const t = [a, a * r, a * r * r, a * r ** 3];
      const next = a * r ** 4;
      return {
        q: `What comes next? ${t.join(', ')}, …`,
        a: N(next),
        wrong: [t[3]! + (t[3]! - t[2]!), next + 1, a * r ** 5, next - a].map(N),
        s: `Each number is ${r} times the one before: ${t[3]} × ${r} = ${next}.`,
      };
    },
  },
];

// =============================================================================================
// Class 5
// =============================================================================================

export const CLASS_5: Template[] = [
  { topic: 'Large Numbers', count: 10, d: 'Medium', make: placeValue(6) },
  {
    topic: 'Multiplication',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 101, 499);
      const b = int(rng, 11, 39);
      const p = a * b;
      const tens = b - (b % 10);
      const ones = b % 10;
      return {
        q: `What is $${a} \\times ${b}$?`,
        a: N(p),
        wrong: [p + a, p - a, p + 100, a * ones + a * (tens / 10)].map(N),
        s:
          ones === 0
            ? `$${a} \\times ${b} = ${a} \\times ${tens / 10} \\times 10 = ${a * (tens / 10)} \\times 10 = ${p}$.`
            : `$${a} \\times ${b} = ${a} \\times ${tens} + ${a} \\times ${ones} = ${a * tens} + ${a * ones} = ${p}$.`,
      };
    },
  },
  {
    topic: 'Division',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const b = int(rng, 11, 25);
      const q = int(rng, 12, 60);
      const n = b * q;
      return { q: `What is $${n} \\div ${b}$?`, a: N(q), wrong: [q + 1, q - 1, q + 10, q - 10].map(N), s: `$${b} \\times ${q} = ${n}$, so $${n} \\div ${b} = ${q}$.` };
    },
  },
  {
    topic: 'Factors and Multiples',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const g = int(rng, 2, 12);
      let x = int(rng, 2, 9);
      let y = int(rng, 2, 9);
      while (x === y || gcd(x, y) !== 1) {
        x = int(rng, 2, 9);
        y = int(rng, 2, 9);
      }
      const a = g * x;
      const b = g * y;
      return {
        q: `What is the HCF of ${a} and ${b}?`,
        a: String(g),
        wrong: [g * 2, lcm(a, b), Math.min(a, b), 1, g + 1].map(String),
        s: `${a} = ${g} × ${x} and ${b} = ${g} × ${y}. ${x} and ${y} have no common factor other than 1, so the HCF is ${g}.`,
      };
    },
  },
  {
    topic: 'Factors and Multiples',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      let a = int(rng, 2, 15);
      let b = int(rng, 2, 15);
      while (a === b || lcm(a, b) > 200 || a % b === 0 || b % a === 0) {
        a = int(rng, 2, 15);
        b = int(rng, 2, 15);
      }
      const l = lcm(a, b);
      const g = gcd(a, b);
      return {
        q: `What is the LCM of ${a} and ${b}?`,
        a: String(l),
        wrong: [l * 2, a * b === l ? l + a : a * b, g, a + b, l - a].map(String),
        s: `LCM = (${a} × ${b}) ÷ HCF = ${a * b} ÷ ${g} = ${l}.`,
      };
    },
  },
  {
    topic: 'Fractions',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const [a, b] = lowestTerms(rng, 2, 9);
      let [c, d] = lowestTerms(rng, 2, 9);
      while (d === b) [c, d] = lowestTerms(rng, 2, 9);
      const L = lcm(b, d);
      const num = a * (L / b) + c * (L / d);
      const sum = frac(num, L);
      const raw = `\\frac{${num}}{${L}}`;
      return {
        q: `What is $\\frac{${a}}{${b}} + \\frac{${c}}{${d}}$?`,
        a: `$${sum}$`,
        wrong: [F(a + c, b + d), F(a * c, b * d), F(num + 1, L), F(a + c, L)],
        s: `The LCM of ${b} and ${d} is ${L}: $\\frac{${a * (L / b)}}{${L}} + \\frac{${c * (L / d)}}{${L}} = ${raw}${sum !== raw ? ` = ${sum}` : ''}$.`,
      };
    },
  },
  {
    topic: 'Fractions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const b = int(rng, 3, 9);
      let a = int(rng, 2, b - 1);
      while (gcd(a, b) !== 1) a = int(rng, 1, b - 1);
      const n = b * int(rng, 3, 15);
      const part = n / b;
      const ans = part * a;
      return {
        q: `What is $\\frac{${a}}{${b}}$ of ${n}?`,
        a: N(ans),
        wrong: [part, ans + part, n - ans, n * a].map(N),
        s: `$\\frac{1}{${b}}$ of ${n} is $${n} \\div ${b} = ${part}$, so $\\frac{${a}}{${b}}$ of ${n} is $${part} \\times ${a} = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Decimals',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const x = int(rng, 105, 2099);
      const y = int(rng, 105, 2099);
      const s = x + y;
      return {
        q: `What is ${dec(x)} + ${dec(y)}?`,
        a: dec(s),
        wrong: [s + 10, s - 10, s + 100, s + 1].map(dec),
        s: `Line up the decimal points and add: ${dec(x)} + ${dec(y)} = ${dec(s)}.`,
      };
    },
  },
  {
    topic: 'Decimals',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const x = int(rng, 101, 999);
      const k = pick(rng, [10, 100, 1000]);
      const places = Math.log10(k);
      const others = [10, 100, 1000].filter((v) => v !== k).map((v) => dec(x * v));
      return {
        q: `What is ${dec(x)} × ${inr(k)}?`,
        a: dec(x * k),
        wrong: [...others, dec(x * k + 100)],
        s: `Multiplying by ${inr(k)} moves the decimal point ${places} place${places > 1 ? 's' : ''} to the right: ${dec(x)} × ${inr(k)} = ${dec(x * k)}.`,
      };
    },
  },
  {
    topic: 'Percentage',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const p = pick(rng, [10, 20, 25, 50, 75]);
      const n = int(rng, 2, 25) * 20;
      const ans = (n * p) / 100;
      const others = [10, 20, 25, 50, 75].filter((v) => v !== p).map((v) => (n * v) / 100);
      return {
        q: `What is ${p}% of ${inr(n)}?`,
        a: N(ans),
        wrong: [...shuffled(rng, others), n - ans].map(N),
        s: `${p}% of ${inr(n)} = $\\frac{${p}}{100} \\times ${n} = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Perimeter and Area',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const s = int(rng, 4, 25);
      const asksArea = rng() < 0.5;
      const ans = asksArea ? s * s : 4 * s;
      const unit = asksArea ? 'square cm' : 'cm';
      return {
        q: `What is the ${asksArea ? 'area' : 'perimeter'} of a square with sides of ${s} cm?`,
        a: `${ans} ${unit}`,
        wrong: (asksArea ? [4 * s, 2 * s, s * s + s, s * s - s] : [s * s, 2 * s, 3 * s, 4 * s + 4]).map((x) => `${x} ${unit}`),
        s: asksArea ? `Area of a square = side × side = ${s} × ${s} = ${ans} square cm.` : `Perimeter of a square = 4 × side = 4 × ${s} = ${ans} cm.`,
      };
    },
  },
  {
    topic: 'Volume',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const l = int(rng, 2, 12);
      const w = int(rng, 2, 12);
      const h = int(rng, 2, 12);
      const v = l * w * h;
      return {
        q: `A box is ${l} cm long, ${w} cm wide and ${h} cm high. What is its volume?`,
        a: `${inr(v)} cubic cm`,
        wrong: [l + w + h, 2 * (l * w + w * h + h * l), l * w + h, v + l * w].map((x) => `${inr(x)} cubic cm`),
        s: `Volume = length × width × height = ${l} × ${w} × ${h} = ${inr(v)} cubic cm.`,
      };
    },
  },
  {
    topic: 'Angles',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const x = pick(rng, [15, 25, 35, 40, 55, 65, 75, 85, 90, 95, 110, 125, 135, 150, 165, 175, 180, 200, 240, 300]);
      const type = x < 90 ? 'an acute angle' : x === 90 ? 'a right angle' : x < 180 ? 'an obtuse angle' : x === 180 ? 'a straight angle' : 'a reflex angle';
      const rule =
        x < 90 ? 'less than 90°' : x === 90 ? 'exactly 90°' : x < 180 ? 'between 90° and 180°' : x === 180 ? 'exactly 180°' : 'between 180° and 360°';
      const all = ['an acute angle', 'a right angle', 'an obtuse angle', 'a straight angle', 'a reflex angle'];
      return {
        q: `An angle of ${x}° is:`,
        a: type,
        wrong: shuffled(rng, all.filter((t) => t !== type)),
        s: `${x}° is ${rule}, so it is ${type}.`,
      };
    },
  },
  {
    topic: 'Speed, Distance and Time',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const speed = int(rng, 4, 16) * 5;
      const time = int(rng, 2, 6);
      const distance = speed * time;
      if (rng() < 0.5) {
        return {
          q: `A bus travels at ${speed} km per hour. How far does it go in ${time} hours?`,
          a: `${distance} km`,
          wrong: [speed + time, distance + speed, distance - speed, speed * (time + 2)].map((x) => `${x} km`),
          s: `Distance = speed × time = ${speed} × ${time} = ${distance} km.`,
        };
      }
      return {
        q: `A car travels ${distance} km at ${speed} km per hour. How many hours does the journey take?`,
        a: `${time} hours`,
        wrong: [time + 1, time + 2, time - 1, speed / 5].filter((x) => x > 0 && x !== time).map((x) => `${x} hours`),
        s: `Time = distance ÷ speed = ${distance} ÷ ${speed} = ${time} hours.`,
      };
    },
  },
  {
    topic: 'Data Handling',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const n = int(rng, 3, 5);
      const mean = int(rng, 15, 60);
      const values: number[] = [];
      let total = 0;
      for (let i = 0; i < n - 1; i += 1) {
        const v = mean + int(rng, -12, 12);
        values.push(v);
        total += v;
      }
      values.push(mean * n - total);
      if (values.some((v) => v <= 0)) return { q: '', a: '', wrong: [], s: '' };
      const sum = mean * n;
      return {
        q: `What is the average of ${values.join(', ')}?`,
        a: String(mean),
        wrong: [mean + 1, mean - 1, sum, mean + 2].map(String),
        s: `Sum = ${values.join(' + ')} = ${sum}. Average = ${sum} ÷ ${n} = ${mean}.`,
      };
    },
  },
];

// =============================================================================================
// Class 6
// =============================================================================================

/** An integer for an expression: negative ones in brackets after an operator. */
const paren = (n: number): string => (n < 0 ? `(${n})` : String(n));

export const CLASS_6: Template[] = [
  {
    topic: 'Integers',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, -50, 50) || 7;
      let b = int(rng, -50, -1);
      if (rng() < 0.3) b = -b;
      const s = a + b;
      return {
        q: `What is $${M(a)} + ${paren(b)}$?`,
        a: `$${M(s)}$`,
        wrong: [a - b, -s, Math.abs(a) + Math.abs(b), s + 10].map((x) => `$${M(x)}$`),
        s: `$${M(a)} + ${paren(b)} = ${M(s)}$. Adding a negative number is the same as subtracting its size.`,
      };
    },
  },
  {
    topic: 'Integers',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, -40, 40) || -9;
      const b = int(rng, -40, 40) || 6;
      const d = a - b;
      return {
        q: `What is $${M(a)} - ${paren(b)}$?`,
        a: `$${M(d)}$`,
        wrong: [a + b, b - a, -a - b, d + 2].map((x) => `$${M(x)}$`),
        s: `Subtracting $${M(b)}$ is the same as adding $${M(-b)}$: $${M(a)} + ${paren(-b)} = ${M(d)}$.`,
      };
    },
  },
  {
    topic: 'Factors and Multiples',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const g = int(rng, 2, 20);
      let x = int(rng, 2, 15);
      let y = int(rng, 2, 15);
      while (x === y || gcd(x, y) !== 1) {
        x = int(rng, 2, 15);
        y = int(rng, 2, 15);
      }
      const a = g * x;
      const b = g * y;
      return {
        q: `Find the HCF of ${a} and ${b}.`,
        a: String(g),
        wrong: [g * 2, lcm(a, b), g + 1, Math.min(x, y), 1].map(String),
        s: `${a} = ${g} × ${x} and ${b} = ${g} × ${y}, and ${x} and ${y} share no factor but 1. So HCF = ${g}.`,
      };
    },
  },
  {
    topic: 'Factors and Multiples',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      let a = int(rng, 6, 30);
      let b = int(rng, 6, 30);
      while (a === b || lcm(a, b) > 500 || a % b === 0 || b % a === 0 || gcd(a, b) === 1) {
        a = int(rng, 6, 30);
        b = int(rng, 6, 30);
      }
      const l = lcm(a, b);
      const g = gcd(a, b);
      return {
        q: `Find the LCM of ${a} and ${b}.`,
        a: String(l),
        wrong: [a * b, l * 2, g, l + g].map(String),
        s: `HCF of ${a} and ${b} is ${g}, so LCM = (${a} × ${b}) ÷ ${g} = ${a * b} ÷ ${g} = ${l}.`,
      };
    },
  },
  {
    topic: 'Factors and Multiples',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const primes = [23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
      const composites: Array<[number, string]> = [
        [21, '3 × 7'], [27, '3 × 9'], [33, '3 × 11'], [39, '3 × 13'], [49, '7 × 7'], [51, '3 × 17'], [57, '3 × 19'],
        [63, '7 × 9'], [69, '3 × 23'], [77, '7 × 11'], [81, '9 × 9'], [87, '3 × 29'], [91, '7 × 13'], [93, '3 × 31'],
      ];
      const p = pick(rng, primes);
      const wrong = shuffled(rng, composites).slice(0, 3);
      const list = shuffled(rng, [p, ...wrong.map((w) => w[0])]);
      return {
        q: `Which of these is a prime number: ${list.join(', ')}?`,
        a: String(p),
        wrong: wrong.map((w) => String(w[0])),
        s: `${p} has exactly two factors, 1 and ${p}, so it is prime. The others are not: ${wrong.map((w) => `${w[0]} = ${w[1]}`).join(', ')}.`,
      };
    },
  },
  {
    topic: 'Factors and Multiples',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const k = pick(rng, [3, 9]);
      const digitSum = (n: number) => String(n).split('').reduce((s, d) => s + Number(d), 0);
      let yes = int(rng, 1000, 9999);
      while (yes % k !== 0) yes += 1;
      const wrong = new Set<number>();
      while (wrong.size < 3) {
        const x = int(rng, 1000, 9999);
        if (x % 3 !== 0) wrong.add(x);
      }
      const list = shuffled(rng, [yes, ...wrong]);
      return {
        q: `Which of these numbers is divisible by ${k}: ${list.map(inr).join(', ')}?`,
        a: inr(yes),
        wrong: [...wrong].map(inr),
        s: `A number is divisible by ${k} when the sum of its digits is. ${inr(yes)} has digit sum ${digitSum(yes)}, which is divisible by ${k}; the digit sums of the others are ${[...wrong].map(digitSum).join(', ')}, which are not.`,
      };
    },
  },
  {
    topic: 'Fractions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const set = new Map<string, [number, number]>();
      while (set.size < 4) {
        const d = int(rng, 2, 12);
        const n = int(rng, 1, d - 1);
        const g = gcd(n, d);
        set.set(`${n / g}/${d / g}`, [n / g, d / g]);
      }
      const list = shuffled(rng, [...set.values()]);
      const greatest = list.reduce((m, f) => (f[0] / f[1] > m[0] / m[1] ? f : m));
      const L = list.reduce((acc, f) => lcm(acc, f[1]), 1);
      return {
        q: `Which is the greatest: ${list.map(([n, d]) => F(n, d)).join(', ')}?`,
        a: F(greatest[0], greatest[1]),
        wrong: list.filter((f) => f !== greatest).map(([n, d]) => F(n, d)),
        s: `Write them over ${L}: ${list.map(([n, d]) => `$\\frac{${n * (L / d)}}{${L}}$`).join(', ')}. The largest numerator is ${greatest[0] * (L / greatest[1])}, so ${F(greatest[0], greatest[1])} is the greatest.`,
      };
    },
  },
  {
    topic: 'Decimals',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const x = int(rng, 12, 99);
      const y = int(rng, 2, 9);
      const p = x * y;
      const tenths = (n: number) => dec(n * 10);
      return {
        q: `What is ${tenths(x)} × ${y}?`,
        a: tenths(p),
        wrong: [dec(p * 100), dec(p), tenths(p + y), tenths(p + 10)],
        s: `${x} × ${y} = ${p}. ${tenths(x)} has one decimal place, so the answer has one too: ${tenths(p)}.`,
      };
    },
  },
  {
    topic: 'Ratio and Proportion',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const g = int(rng, 2, 12);
      let x = int(rng, 1, 9);
      let y = int(rng, 1, 9);
      while (x === y || gcd(x, y) !== 1) {
        x = int(rng, 1, 9);
        y = int(rng, 1, 9);
      }
      return {
        q: `Write ${g * x} : ${g * y} in its simplest form.`,
        a: `${x} : ${y}`,
        wrong: [`${y} : ${x}`, `${x + 1} : ${y}`, `${x} : ${y + 1}`, `${g} : ${x}`].filter((r) => r !== `${x} : ${y}`),
        s: `The HCF of ${g * x} and ${g * y} is ${g}. ${g * x} ÷ ${g} : ${g * y} ÷ ${g} = ${x} : ${y}.`,
      };
    },
  },
  {
    topic: 'Ratio and Proportion',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const item = pick(rng, ['pens', 'notebooks', 'apples', 'chocolates', 'candles']);
      const n1 = int(rng, 3, 9);
      const u = int(rng, 4, 40);
      let n2 = int(rng, 2, 15);
      while (n2 === n1) n2 = int(rng, 2, 15);
      const c1 = n1 * u;
      const c2 = n2 * u;
      const rupees = (x: number) => `₹${inr(x)}`;
      return {
        q: `If ${n1} ${item} cost ₹${c1}, how much do ${n2} ${item} cost?`,
        a: rupees(c2),
        wrong: [c1 + n2, u, c2 + u, c2 - u].filter((x) => x > 0).map(rupees),
        s: `One costs ₹${c1} ÷ ${n1} = ₹${u}, so ${n2} cost ${n2} × ₹${u} = ₹${c2}.`,
      };
    },
  },
  {
    topic: 'Algebra',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, 2, 9);
      const b = int(rng, 1, 20);
      const x = int(rng, 2, 10);
      const v = a * x + b;
      return {
        q: `Find the value of $${a}x + ${b}$ when $x = ${x}$.`,
        a: String(v),
        wrong: [a + x + b, a * (x + b), a * x - b, v + a].map(String),
        s: `$${a} \\times ${x} + ${b} = ${a * x} + ${b} = ${v}$.`,
      };
    },
  },
  {
    topic: 'Algebra',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const form = int(rng, 0, 2);
      const x = int(rng, 2, 25);
      const a = int(rng, 2, 12);
      if (form === 0) {
        const b = x + a;
        return { q: `Solve: $x + ${a} = ${b}$`, a: `$x = ${x}$`, wrong: [b + a, b, x + 1, a].map((v) => `$x = ${v}$`), s: `Subtract ${a} from both sides: $x = ${b} - ${a} = ${x}$.` };
      }
      if (form === 1) {
        const b = a * x;
        return { q: `Solve: $${a}x = ${b}$`, a: `$x = ${x}$`, wrong: [b - a, b * a, x + 1, b + a].map((v) => `$x = ${v}$`), s: `Divide both sides by ${a}: $x = ${b} \\div ${a} = ${x}$.` };
      }
      const b = x - a;
      return { q: `Solve: $x - ${a} = ${M(b)}$`, a: `$x = ${x}$`, wrong: [b - a, Math.abs(b), x + 1, a].map((v) => `$x = ${M(v)}$`), s: `Add ${a} to both sides: $x = ${M(b)} + ${a} = ${x}$.` };
    },
  },
  {
    topic: 'Mensuration',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const l = int(rng, 6, 25);
      const w = int(rng, 3, 20);
      const area = l * w;
      return {
        q: `A rectangle has an area of ${area} square cm and a length of ${l} cm. What is its width?`,
        a: `${w} cm`,
        wrong: [area - l, w + 1, w + 2, l].filter((x) => x > 0 && x !== w).map((x) => `${x} cm`),
        s: `Width = area ÷ length = ${area} ÷ ${l} = ${w} cm.`,
      };
    },
  },
  {
    topic: 'Basic Geometry',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const supplement = rng() < 0.5;
      const x = supplement ? int(rng, 10, 170) : int(rng, 10, 80);
      const ans = (supplement ? 180 : 90) - x;
      return {
        q: `What is the ${supplement ? 'supplement' : 'complement'} of ${x}°?`,
        a: `${ans}°`,
        wrong: [(supplement ? 90 : 180) - x, 360 - x, x, ans + 10].filter((v) => v > 0).map((v) => `${v}°`),
        s: supplement ? `Supplementary angles add up to 180°: 180° − ${x}° = ${ans}°.` : `Complementary angles add up to 90°: 90° − ${x}° = ${ans}°.`,
      };
    },
  },
  {
    topic: 'Data Handling',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const n = pick(rng, [5, 7]);
      const set = new Set<number>();
      while (set.size < n) set.add(int(rng, 10, 60));
      const list = shuffled(rng, [...set]);
      const sorted = [...list].sort((a, b) => a - b);
      const median = sorted[(n - 1) / 2]!;
      return {
        q: `What is the median of ${list.join(', ')}?`,
        a: String(median),
        wrong: [list[(n - 1) / 2]!, sorted[0]!, sorted[n - 1]!, sorted[(n - 1) / 2 + 1]!].map(String),
        s: `In order: ${sorted.join(', ')}. The middle value is ${median}.`,
      };
    },
  },
];

// =============================================================================================
// Class 7
// =============================================================================================

export const CLASS_7: Template[] = [
  {
    topic: 'Integers',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, 2, 15) * (rng() < 0.5 ? -1 : 1);
      const b = int(rng, 2, 12) * (rng() < 0.5 ? -1 : 1);
      if (rng() < 0.5) {
        const p = a * b;
        return { q: `What is $${M(a)} \\times ${paren(b)}$?`, a: `$${M(p)}$`, wrong: [-p, a + b, p + a, -(a + b)].map((x) => `$${M(x)}$`), s: `$${Math.abs(a)} \\times ${Math.abs(b)} = ${Math.abs(p)}$, and ${(a < 0) === (b < 0) ? 'two signs the same give a positive' : 'opposite signs give a negative'}: $${M(p)}$.` };
      }
      const n = a * b;
      return { q: `What is $${M(n)} \\div ${paren(b)}$?`, a: `$${M(a)}$`, wrong: [-a, n - b, b, a + 1].map((x) => `$${M(x)}$`), s: `$${Math.abs(n)} \\div ${Math.abs(b)} = ${Math.abs(a)}$, and ${(n < 0) === (b < 0) ? 'the same signs give a positive' : 'opposite signs give a negative'}: $${M(a)}$.` };
    },
  },
  {
    topic: 'Fractions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [a, b] = lowestTerms(rng, 2, 9, 8);
      const [c, d] = lowestTerms(rng, 2, 9, 8);
      const product = frac(a * c, b * d);
      const unreduced = `\\frac{${a * c}}{${b * d}}`;
      return {
        q: `What is $\\frac{${a}}{${b}} \\times \\frac{${c}}{${d}}$?`,
        a: F(a * c, b * d),
        wrong: [F(a + c, b + d), F(a * d, b * c), F(a * c + 1, b * d), F(a + c, b * d)],
        s: `Multiply the numerators and the denominators: $\\frac{${a} \\times ${c}}{${b} \\times ${d}} = ${unreduced}${product !== unreduced ? ` = ${product}` : ''}$.`,
      };
    },
  },
  {
    topic: 'Fractions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [a, b] = lowestTerms(rng, 2, 9, 8);
      const [c, d] = lowestTerms(rng, 2, 9, 8);
      return {
        q: `What is $\\frac{${a}}{${b}} \\div \\frac{${c}}{${d}}$?`,
        a: F(a * d, b * c),
        wrong: [F(a * c, b * d), F(b * c, a * d), F(a * d + 1, b * c), F(a + d, b + c)],
        s: `Dividing by $\\frac{${c}}{${d}}$ is multiplying by $${c === 1 ? d : `\\frac{${d}}{${c}}`}$: $\\frac{${a} \\times ${d}}{${b} \\times ${c}} = ${frac(a * d, b * c)}$.`,
      };
    },
  },
  {
    topic: 'Rational Numbers',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [a, b] = lowestTerms(rng, 2, 9);
      let [c, d] = lowestTerms(rng, 2, 9);
      while (d === b) [c, d] = lowestTerms(rng, 2, 9);
      const L = lcm(b, d);
      const num = -a * (L / b) + c * (L / d);
      return {
        q: `What is $-\\frac{${a}}{${b}} + \\frac{${c}}{${d}}$?`,
        a: F(num, L),
        wrong: [F(-num, L), F(a * (L / b) + c * (L / d), L), F(c - a, b + d), F(num + 1, L)],
        s: `Over the common denominator ${L}: $-\\frac{${a * (L / b)}}{${L}} + \\frac{${c * (L / d)}}{${L}} = ${num < 0 ? '-' : ''}\\frac{${Math.abs(num)}}{${L}}${gcd(num, L) === 1 ? '' : ` = ${frac(num, L)}`}$.`,
      };
    },
  },
  {
    topic: 'Simple Equations',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 2, 9);
      const x = int(rng, -10, 12);
      const b = int(rng, -20, 20) || 5;
      const c = a * x + b;
      return {
        q: `Solve: $${a}x ${signed(b)} = ${M(c)}$`,
        a: `$x = ${M(x)}$`,
        wrong: [x + 1, x - 1, -x || 2, x + 2].map((v) => `$x = ${M(v)}$`),
        s: `$${a}x = ${M(c)} ${signed(-b)} = ${M(c - b)}$, so $x = ${M(c - b)} \\div ${a} = ${M(x)}$.`,
      };
    },
  },
  {
    topic: 'Comparing Quantities',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const p = pick(rng, [10, 20, 25, 50]);
      const o = int(rng, 2, 15) * 20;
      const n = o + (o * p) / 100;
      return {
        q: `A price rises from ₹${o} to ₹${n}. What is the percentage increase?`,
        a: `${p}%`,
        wrong: [...[10, 20, 25, 50].filter((v) => v !== p), n - o].map((v) => `${v}%`),
        s: `Increase = ₹${n - o}. Percentage increase = (${n - o} ÷ ${o}) × 100 = ${p}%.`,
      };
    },
  },
  {
    topic: 'Comparing Quantities',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const cp = int(rng, 5, 50) * 20;
      const p = pick(rng, [5, 10, 15, 20, 25]);
      const profit = rng() < 0.5;
      const diff = (cp * p) / 100;
      const sp = profit ? cp + diff : cp - diff;
      const kind = profit ? 'profit' : 'loss';
      return {
        q: `An article bought for ₹${inr(cp)} is sold for ₹${inr(sp)}. Find the ${kind} per cent.`,
        a: `${p}%`,
        wrong: [...[5, 10, 15, 20, 25].filter((v) => v !== p)].map((v) => `${v}%`),
        s: `${kind[0]!.toUpperCase()}${kind.slice(1)} = ₹${inr(diff)}. ${kind[0]!.toUpperCase()}${kind.slice(1)} % = (${diff} ÷ ${cp}) × 100 = ${p}%.`,
      };
    },
  },
  {
    topic: 'Comparing Quantities',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const P = int(rng, 2, 20) * 500;
      const R = pick(rng, [4, 5, 6, 8, 10, 12]);
      const T = int(rng, 2, 5);
      const si = (P * R * T) / 100;
      const rupees = (x: number) => `₹${inr(x)}`;
      return {
        q: `Find the simple interest on ₹${inr(P)} at ${R}% per annum for ${T} years.`,
        a: rupees(si),
        wrong: [P + si, si / T, (P * R * (T + 1)) / 100, si * 2].map(rupees),
        s: `SI = (P × R × T) ÷ 100 = (${inr(P)} × ${R} × ${T}) ÷ 100 = ₹${inr(si)}.`,
      };
    },
  },
  {
    topic: 'Exponents and Powers',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      let b = int(rng, 2, 9);
      let e = int(rng, 2, 5);
      while (b ** e > 100000) {
        b = int(rng, 2, 9);
        e = int(rng, 2, 5);
      }
      const v = b ** e;
      return {
        q: `What is the value of $${b}^{${e}}$?`,
        a: N(v),
        wrong: [b * e, b ** (e - 1), e ** b, v + b].map(N),
        s: `$${b}^{${e}}$ is ${e} factors of ${b} multiplied together: ${Array(e).fill(b).join(' × ')} = ${inr(v)}.`,
      };
    },
  },
  {
    topic: 'Exponents and Powers',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const b = int(rng, 2, 9);
      const m = int(rng, 3, 9);
      const n = int(rng, 2, m - 1);
      if (rng() < 0.5) {
        return {
          q: `Simplify $${b}^{${m}} \\times ${b}^{${n}}$.`,
          a: `$${b}^{${m + n}}$`,
          wrong: [`$${b}^{${m * n}}$`, `$${b * b}^{${m + n}}$`, `$${b}^{${m - n}}$`, `$${b * b}^{${m * n}}$`],
          s: `Same base, multiplying: add the powers. $${b}^{${m} + ${n}} = ${b}^{${m + n}}$.`,
        };
      }
      return {
        q: `Simplify $${b}^{${m}} \\div ${b}^{${n}}$.`,
        a: `$${b}^{${m - n}}$`,
        wrong: [`$${b}^{${m + n}}$`, `$${b * b}^{${m - n}}$`, `$${b}^{${m * n}}$`, `$${b}^{${n - m}}$`],
        s: `Same base, dividing: subtract the powers. $${b}^{${m} - ${n}} = ${b}^{${m - n}}$.`,
      };
    },
  },
  {
    topic: 'Triangles',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, 30, 90);
      const b = int(rng, 20, 140 - a);
      const c = 180 - a - b;
      return {
        q: `Two angles of a triangle are ${a}° and ${b}°. What is the third angle?`,
        a: `${c}°`,
        wrong: [a + b, 90 - Math.min(a, b), c + 10, 360 - a - b].map((v) => `${v}°`),
        s: `The angles of a triangle add up to 180°: 180° − ${a}° − ${b}° = ${c}°.`,
      };
    },
  },
  {
    topic: 'Triangles',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 25, 80);
      const b = int(rng, 25, 80);
      const e = a + b;
      return {
        q: `An exterior angle of a triangle has interior opposite angles of ${a}° and ${b}°. What is the exterior angle?`,
        a: `${e}°`,
        wrong: [180 - e, 180 - a, Math.abs(a - b) || e + 10, e + 10].map((v) => `${v}°`),
        s: `An exterior angle equals the sum of the two interior opposite angles: ${a}° + ${b}° = ${e}°.`,
      };
    },
  },
  {
    topic: 'Triangles',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [p, q, r] = pick(rng, [
        [3, 4, 5],
        [5, 12, 13],
        [8, 15, 17],
        [7, 24, 25],
        [20, 21, 29],
      ] as const);
      const k = int(rng, 1, 3);
      const [a, b, c] = [p * k, q * k, r * k];
      if (rng() < 0.5) {
        return {
          q: `The two shorter sides of a right triangle are ${a} cm and ${b} cm. How long is the hypotenuse?`,
          a: `${c} cm`,
          wrong: [a + b, c + 1, c - 1, b + 1].filter((v) => v !== c).map((v) => `${v} cm`),
          s: `By Pythagoras, hypotenuse² = ${a}² + ${b}² = ${a * a} + ${b * b} = ${c * c}, so the hypotenuse is ${c} cm.`,
        };
      }
      return {
        q: `A right triangle has a hypotenuse of ${c} cm and one side of ${a} cm. How long is the other side?`,
        a: `${b} cm`,
        wrong: [c - a, b + 1, b - 1, c + a].filter((v) => v !== b && v > 0).map((v) => `${v} cm`),
        s: `By Pythagoras, side² = ${c}² − ${a}² = ${c * c} − ${a * a} = ${b * b}, so the side is ${b} cm.`,
      };
    },
  },
  {
    topic: 'Perimeter and Area',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const r = pick(rng, [7, 14, 21, 28, 35, 42]);
      const byDiameter = rng() < 0.5;
      const area = (22 * r * r) / 7;
      return {
        q: `Find the area of a circle ${byDiameter ? `of diameter ${2 * r} cm` : `of radius ${r} cm`}. (Use $\\pi = \\frac{22}{7}$.)`,
        a: `${inr(area)} square cm`,
        wrong: [(44 * r) / 7, 2 * area, 4 * area, (22 * r) / 7].map((v) => `${inr(v)} square cm`),
        s: `${byDiameter ? `Radius = ${2 * r} ÷ 2 = ${r} cm. ` : ''}Area = $\\pi r^2 = \\frac{22}{7} \\times ${r} \\times ${r} = ${area}$ square cm.`,
      };
    },
  },
  {
    topic: 'Perimeter and Area',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const r = pick(rng, [7, 14, 21, 28, 35, 42]);
      const byDiameter = rng() < 0.5;
      const c = (44 * r) / 7;
      return {
        q: `Find the circumference of a circle ${byDiameter ? `of diameter ${2 * r} cm` : `of radius ${r} cm`}. (Use $\\pi = \\frac{22}{7}$.)`,
        a: `${c} cm`,
        wrong: [(22 * r) / 7, (22 * r * r) / 7, 2 * c, c + 7].map((v) => `${inr(v)} cm`),
        s: `${byDiameter ? `Radius = ${2 * r} ÷ 2 = ${r} cm. ` : ''}Circumference = $2\\pi r = 2 \\times \\frac{22}{7} \\times ${r} = ${c}$ cm.`,
      };
    },
  },
];

