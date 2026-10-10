import {
  F,
  M,
  N,
  frac,
  gcd,
  int,
  inr,
  nCr,
  nPr,
  ordinal,
  pick,
  poly,
  shuffled,
  signed,
  termAfter,
  termFirst,
  type Template,
} from './practiceGen';

/**
 * The practice templates for Classes 8 to 12 (2026-10-10). Fifteen templates a class, ten questions
 * each, every answer computed from the numbers in the question. See `practiceGen.ts`.
 */

const TRIPLES = [
  [3, 4, 5],
  [5, 12, 13],
  [8, 15, 17],
  [7, 24, 25],
  [20, 21, 29],
  [9, 40, 41],
] as const;

/** Integers in brackets when negative, for a value substituted into an expression. */
const paren = (n: number): string => (n < 0 ? `(${n})` : String(n));

const rupees = (x: number): string => `₹${inr(x)}`;

/** A polynomial with a value substituted, e.g. [1, -1, 0, -6] at -3 → "(-3)^3 - (-3)^2 - 6". */
function substituted(coeffs: number[], v: number): string {
  const degree = coeffs.length - 1;
  let out = '';
  coeffs.forEach((c, i) => {
    if (c === 0) return;
    const p = degree - i;
    const power = p === 0 ? '' : p === 1 ? paren(v) : `${paren(v)}^${p}`;
    const size = Math.abs(c);
    const body = p === 0 ? String(size) : size === 1 ? power : `${size} \\times ${power}`;
    out += out === '' ? `${c < 0 ? '-' : ''}${body}` : ` ${c < 0 ? '-' : '+'} ${body}`;
  });
  return out || '0';
}

// =============================================================================================
// Class 8
// =============================================================================================

export const CLASS_8: Template[] = [
  {
    topic: 'Squares and Square Roots',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const n = int(rng, 11, 99);
      const sq = n * n;
      return {
        q: `What is $${n}^2$?`,
        a: N(sq),
        wrong: [sq + n, (n + 1) ** 2, (n - 1) ** 2, n * 2, sq + 10].map(N),
        s: `$${n}^2 = ${n} \\times ${n} = ${sq}$.`,
      };
    },
  },
  {
    topic: 'Squares and Square Roots',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const n = int(rng, 11, 60);
      return {
        q: `What is $\\sqrt{${n * n}}$?`,
        a: String(n),
        wrong: [n + 1, n - 1, n + 10, Math.floor((n * n) / 2)].map(String),
        s: `$${n} \\times ${n} = ${n * n}$, so $\\sqrt{${n * n}} = ${n}$.`,
      };
    },
  },
  {
    topic: 'Cubes and Cube Roots',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const n = int(rng, 2, 20);
      const cube = n ** 3;
      if (rng() < 0.5) {
        return {
          q: `What is $${n}^3$?`,
          a: N(cube),
          wrong: [n * 3, n * n, (n + 1) ** 3, cube + n].map(N),
          s: `$${n}^3 = ${n} \\times ${n} \\times ${n} = ${cube}$.`,
        };
      }
      return {
        q: `What is $\\sqrt[3]{${cube}}$?`,
        a: String(n),
        wrong: [n + 1, n - 1, n * 3, n + 2].filter((x) => x > 0).map(String),
        s: `$${n} \\times ${n} \\times ${n} = ${cube}$, so $\\sqrt[3]{${cube}} = ${n}$.`,
      };
    },
  },
  {
    topic: 'Exponents and Powers',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const b = int(rng, 2, 10);
      const e = int(rng, 1, 3);
      const p = b ** e;
      return {
        q: `What is the value of $${b}^{-${e}}$?`,
        a: `$\\frac{1}{${p}}$`,
        wrong: [`$-${p}$`, `$\\frac{1}{${b * e}}$`, `$-\\frac{1}{${p}}$`, `$${p}$`],
        s: `A negative power is the reciprocal of the positive one: $${b}^{-${e}} = \\frac{1}{${b}^{${e}}} = \\frac{1}{${p}}$.`,
      };
    },
  },
  {
    topic: 'Linear Equations',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const x = int(rng, -9, 12);
      const a = int(rng, 3, 9);
      let c = int(rng, 1, 8);
      while (c === a) c = int(rng, 1, 8);
      const b = int(rng, -20, 20) || 4;
      const d = a * x + b - c * x;
      return {
        q: `Solve: $${a}x ${signed(b)} = ${c === 1 ? '' : c}x ${signed(d)}$`,
        a: `$x = ${M(x)}$`,
        wrong: [x + 1, x - 1, -x || 3, x + 2].map((v) => `$x = ${M(v)}$`),
        s: `Collect the terms: $${a}x - ${c === 1 ? '' : c}x = ${M(d)} ${signed(-b)}$, so $${termFirst(a - c, 'x')} = ${M(d - b)}$ and $x = ${M(x)}$.`,
      };
    },
  },
  {
    topic: 'Comparing Quantities',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const rate = pick(rng, [5, 10, 20]);
      const step = rate === 5 ? 400 : rate === 10 ? 100 : 25;
      const P = Math.ceil(int(rng, 1000, 20000) / step) * step;
      const factor: [number, number] = rate === 5 ? [441, 400] : rate === 10 ? [121, 100] : [36, 25];
      const A = (P * factor[0]) / factor[1];
      const ci = A - P;
      const si = (P * rate * 2) / 100;
      if (rng() < 0.5) {
        return {
          q: `Find the compound interest on ₹${inr(P)} at ${rate}% per annum for 2 years, compounded annually.`,
          a: rupees(ci),
          wrong: [si, A, ci + 100, ci / 2].map(rupees),
          s: `Amount = $${P}\\left(1 + \\frac{${rate}}{100}\\right)^2 = ${A}$. Compound interest = ₹${inr(A)} − ₹${inr(P)} = ₹${inr(ci)}.`,
        };
      }
      return {
        q: `What amount will ₹${inr(P)} grow to in 2 years at ${rate}% per annum, compounded annually?`,
        a: rupees(A),
        wrong: [P + si, ci, A + 100, A - 100].map(rupees),
        s: `Amount = $${P}\\left(1 + \\frac{${rate}}{100}\\right)^2 = ${P} \\times \\frac{${factor[0]}}{${factor[1]}} = ${A}$, i.e. ₹${inr(A)}.`,
      };
    },
  },
  {
    topic: 'Algebraic Expressions and Identities',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const base = pick(rng, [40, 50, 60, 70, 80, 90, 100]);
      const a = int(rng, 1, 9);
      const form = int(rng, 0, 2);
      if (form === 0) {
        const v = (base + a) ** 2;
        return { q: `Use an identity to find $${base + a}^2$.`, a: N(v), wrong: [base * base + a * a, v + a, v - 2 * base * a + a, v + 10].map(N), s: `$(${base} + ${a})^2 = ${base}^2 + 2 \\times ${base} \\times ${a} + ${a}^2 = ${base * base} + ${2 * base * a} + ${a * a} = ${v}$.` };
      }
      if (form === 1) {
        const v = (base - a) ** 2;
        return { q: `Use an identity to find $${base - a}^2$.`, a: N(v), wrong: [base * base - a * a, v + a, v + 2 * base * a - a, v - 10].map(N), s: `$(${base} - ${a})^2 = ${base}^2 - 2 \\times ${base} \\times ${a} + ${a}^2 = ${base * base} - ${2 * base * a} + ${a * a} = ${v}$.` };
      }
      const v = base * base - a * a;
      return { q: `Use an identity to find $${base + a} \\times ${base - a}$.`, a: N(v), wrong: [base * base + a * a, base * base, v - a, v + 2 * a].map(N), s: `$(${base} + ${a})(${base} - ${a}) = ${base}^2 - ${a}^2 = ${base * base} - ${a * a} = ${v}$.` };
    },
  },
  {
    topic: 'Factorisation',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      let p = int(rng, -9, 9);
      let q = int(rng, -9, 9);
      while (p === 0 || q === 0 || p + q === 0 || p === q) {
        p = int(rng, -9, 9);
        q = int(rng, -9, 9);
      }
      const [s, t] = p < q ? [p, q] : [q, p];
      const factor = (k: number) => `(x ${signed(k)})`;
      const expr = poly([1, s + t, s * t]);
      return {
        q: `Factorise $${expr}$.`,
        a: `$${factor(s)}${factor(t)}$`,
        wrong: [`$${factor(-s)}${factor(-t)}$`, `$${factor(s)}${factor(-t)}$`, `$${factor(-s)}${factor(t)}$`, `$${factor(s * t)}(x + 1)$`],
        s: `Find two numbers whose product is ${M(s * t)} and whose sum is ${M(s + t)}: they are ${M(s)} and ${M(t)}. So $${expr} = ${factor(s)}${factor(t)}$.`,
      };
    },
  },
  {
    topic: 'Direct and Inverse Proportions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const perLitre = int(rng, 8, 20);
      const l1 = int(rng, 2, 9);
      let l2 = int(rng, 3, 15);
      while (l2 === l1) l2 = int(rng, 3, 15);
      const d1 = perLitre * l1;
      const d2 = perLitre * l2;
      return {
        q: `A car travels ${d1} km on ${l1} litres of petrol. How far will it travel on ${l2} litres?`,
        a: `${d2} km`,
        wrong: [d1 + l2, perLitre, d2 + perLitre, d1 * l2].map((v) => `${inr(v)} km`),
        s: `Distance is in direct proportion to petrol: ${d1} ÷ ${l1} = ${perLitre} km per litre, so ${l2} litres take it ${l2} × ${perLitre} = ${d2} km.`,
      };
    },
  },
  {
    topic: 'Direct and Inverse Proportions',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const total = pick(rng, [24, 36, 48, 60, 72, 90, 120, 144, 180]);
      const divisors = Array.from({ length: 30 }, (_, i) => i + 2).filter((x) => total % x === 0 && total / x >= 2);
      const w1 = pick(rng, divisors);
      let w2 = pick(rng, divisors);
      while (w2 === w1) w2 = pick(rng, divisors);
      const d1 = total / w1;
      const d2 = total / w2;
      return {
        q: `${w1} workers can build a wall in ${d1} days. How many days would ${w2} workers take, working at the same rate?`,
        a: `${d2} days`,
        wrong: [(d1 * w2) / w1, d1 + (w1 - w2), total, d2 + 1].filter((v) => Number.isInteger(v) && v > 0).map((v) => `${v} days`),
        s: `Workers and days are in inverse proportion: the job is ${w1} × ${d1} = ${total} worker-days, so ${w2} workers need ${total} ÷ ${w2} = ${d2} days.`,
      };
    },
  },
  {
    topic: 'Mensuration',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 4, 20);
      const b = int(rng, 4, 20);
      let h = int(rng, 3, 15);
      if (((a + b) * h) % 2 !== 0) h += 1;
      const area = ((a + b) * h) / 2;
      return {
        q: `A trapezium has parallel sides of ${a} cm and ${b} cm, and a height of ${h} cm. What is its area?`,
        a: `${area} square cm`,
        wrong: [(a + b) * h, a * b, (a + b) / 2 + h, area + h].filter((v) => Number.isInteger(v)).map((v) => `${v} square cm`),
        s: `Area = $\\frac{1}{2}$ × (sum of parallel sides) × height = $\\frac{1}{2} \\times ${a + b} \\times ${h} = ${area}$ square cm.`,
      };
    },
  },
  {
    topic: 'Mensuration',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      if (rng() < 0.5) {
        const s = int(rng, 2, 20);
        return {
          q: `What is the total surface area of a cube with edges of ${s} cm?`,
          a: `${inr(6 * s * s)} square cm`,
          wrong: [s ** 3, 4 * s * s, 6 * s, 12 * s].map((v) => `${inr(v)} square cm`),
          s: `A cube has 6 square faces: 6 × ${s}² = 6 × ${s * s} = ${inr(6 * s * s)} square cm.`,
        };
      }
      const l = int(rng, 3, 15);
      const w = int(rng, 2, 12);
      const h = int(rng, 2, 10);
      const sa = 2 * (l * w + w * h + h * l);
      return {
        q: `What is the total surface area of a cuboid ${l} cm long, ${w} cm wide and ${h} cm high?`,
        a: `${inr(sa)} square cm`,
        wrong: [l * w * h, l * w + w * h + h * l, 2 * (l + w) * h, sa + 2 * l * w].map((v) => `${inr(v)} square cm`),
        s: `Surface area = 2(lw + wh + hl) = 2(${l * w} + ${w * h} + ${h * l}) = ${inr(sa)} square cm.`,
      };
    },
  },
  {
    topic: 'Understanding Quadrilaterals',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [n, name] = pick(rng, [
        [5, 'pentagon'],
        [6, 'hexagon'],
        [8, 'octagon'],
        [9, 'nonagon'],
        [10, 'decagon'],
        [12, 'dodecagon'],
        [15, '15-sided polygon'],
        [18, '18-sided polygon'],
        [20, '20-sided polygon'],
      ] as const);
      if (rng() < 0.5) {
        const each = 180 - 360 / n;
        return {
          q: `What is each interior angle of a regular ${name}?`,
          a: `${each}°`,
          wrong: [360 / n, (n - 2) * 180, 180 - 180 / n, each + 10].filter((v) => Number.isInteger(v)).map((v) => `${inr(v)}°`),
          s: `Each exterior angle is 360° ÷ ${n} = ${360 / n}°, so each interior angle is 180° − ${360 / n}° = ${each}°.`,
        };
      }
      const sum = (n - 2) * 180;
      return {
        q: `What is the sum of the interior angles of ${n === 8 || n === 18 ? 'an' : 'a'} ${name}?`,
        a: `${inr(sum)}°`,
        wrong: [n * 180, (n - 1) * 180, 360, sum + 180].map((v) => `${inr(v)}°`),
        s: `Sum = (n − 2) × 180° = (${n} − 2) × 180° = ${inr(sum)}°.`,
      };
    },
  },
  {
    topic: 'Probability',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const r = int(rng, 1, 9);
      const b = int(rng, 1, 9);
      const g = int(rng, 1, 9);
      const total = r + b + g;
      const [colour, count] = pick(rng, [
        ['red', r],
        ['blue', b],
        ['green', g],
      ] as const);
      return {
        q: `A bag has ${r} red, ${b} blue and ${g} green balls. One ball is picked at random. What is the probability that it is ${colour}?`,
        a: F(count, total),
        wrong: [F(count, total - count), F(1, 3), F(total - count, total), F(count, total + 1)],
        s: `There are ${total} balls and ${count} of them are ${colour}, so the probability is $\\frac{${count}}{${total}}${frac(count, total) !== `\\frac{${count}}{${total}}` ? ` = ${frac(count, total)}` : ''}$.`,
      };
    },
  },
  {
    topic: 'Comparing Quantities',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const mp = int(rng, 10, 250) * 20;
      const d = pick(rng, [5, 10, 15, 20, 25, 30]);
      const off = (mp * d) / 100;
      const sp = mp - off;
      return {
        q: `A jacket marked ₹${inr(mp)} is sold at a ${d}% discount. What is the selling price?`,
        a: rupees(sp),
        wrong: [off, mp + off, mp - d, sp - off].map(rupees),
        s: `Discount = ${d}% of ₹${inr(mp)} = ₹${inr(off)}. Selling price = ₹${inr(mp)} − ₹${inr(off)} = ₹${inr(sp)}.`,
      };
    },
  },
];

// =============================================================================================
// Class 9
// =============================================================================================

const HERONIAN: Array<[number, number, number, number]> = [
  [13, 14, 15, 84],
  [5, 12, 13, 30],
  [9, 10, 17, 36],
  [6, 8, 10, 24],
  [7, 15, 20, 42],
  [10, 13, 13, 60],
  [13, 20, 21, 126],
  [11, 13, 20, 66],
  [12, 16, 20, 96],
  [15, 20, 25, 150],
  [8, 15, 17, 60],
  [17, 25, 28, 210],
  [5, 5, 6, 12],
  [10, 10, 12, 48],
];

export const CLASS_9: Template[] = [
  {
    topic: 'Number Systems',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const k = int(rng, 2, 9);
      const m = pick(rng, [2, 3, 5, 6, 7]);
      return {
        q: `Simplify $\\sqrt{${k * k * m}}$.`,
        a: `$${k}\\sqrt{${m}}$`,
        wrong: [`$${m}\\sqrt{${k}}$`, `$${k * k}\\sqrt{${m}}$`, `$${k}\\sqrt{${m * k}}$`, `$${k + 1}\\sqrt{${m}}$`],
        s: `$${k * k * m} = ${k * k} \\times ${m}$, so $\\sqrt{${k * k * m}} = \\sqrt{${k * k}} \\times \\sqrt{${m}} = ${k}\\sqrt{${m}}$.`,
      };
    },
  },
  {
    topic: 'Number Systems',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const b = pick(rng, [2, 3, 4, 5, 6]);
      const n = pick(rng, [2, 3]);
      const m = pick(rng, [1, 2, 3].filter((x) => x !== n));
      const base = b ** n;
      const ans = b ** m;
      return {
        q: `Find the value of $${base}^{\\frac{${m}}{${n}}}$.`,
        a: N(ans),
        wrong: [b * m, b ** (m + 1), Math.round((base * m) / n), ans + 1].map(N),
        s: `$${base} = ${b}^{${n}}$, so $${base}^{\\frac{${m}}{${n}}} = ${b}^{${n} \\times \\frac{${m}}{${n}}} = ${b}^{${m}} = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Polynomials',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, 1, 5);
      const b = int(rng, -9, 9);
      const c = int(rng, -9, 9);
      const v = int(rng, -4, 4) || 2;
      const p = (x: number) => a * x * x + b * x + c;
      return {
        q: `If $p(x) = ${poly([a, b, c])}$, find $p(${M(v)})$.`,
        a: `$${M(p(v))}$`,
        wrong: [p(-v), a * v + b * v + c, p(v) + a, c].map((x) => `$${M(x)}$`),
        s: `$p(${M(v)}) = ${substituted([a, b, c], v)} = ${M(p(v))}$.`,
      };
    },
  },
  {
    topic: 'Polynomials',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, -5, 5);
      const b = int(rng, -9, 9);
      const c = int(rng, -9, 9);
      const r = int(rng, -3, 3) || 1;
      const p = (x: number) => x ** 3 + a * x * x + b * x + c;
      const divisor = `x ${signed(-r)}`;
      return {
        q: `What is the remainder when $${poly([1, a, b, c])}$ is divided by $${divisor}$?`,
        a: `$${M(p(r))}$`,
        wrong: [p(-r), c, p(r) + 1, p(r) - r].map((x) => `$${M(x)}$`),
        s: `By the remainder theorem, the remainder is $p(${M(r)}) = ${substituted([1, a, b, c], r)} = ${M(p(r))}$.`,
      };
    },
  },
  {
    topic: 'Polynomials',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const r = int(rng, 1, 6);
      const k = int(rng, -9, 9) || 3;
      const c = -r * r - k * r;
      if (c === 0) return { q: '', a: '', wrong: [], s: '' };
      return {
        q: `For what value of $k$ is $(x - ${r})$ a factor of $x^2 + kx ${signed(c)}$?`,
        a: `$k = ${M(k)}$`,
        wrong: [-k, k + 1, c, k - 1].map((v) => `$k = ${M(v)}$`),
        s:
          r === 1
            ? `By the factor theorem $p(1) = 0$: $1 + k ${signed(c)} = 0$, so $k = ${M(k)}$.`
            : `By the factor theorem $p(${r}) = 0$: $${r * r} + ${r}k ${signed(c)} = 0$, so $${r}k = ${M(-r * r - c)}$ and $k = ${M(k)}$.`,
      };
    },
  },
  {
    topic: 'Linear Equations in Two Variables',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, 1, 6);
      const b = int(rng, 1, 6);
      const x = int(rng, -5, 8);
      const y = int(rng, -5, 8);
      const c = a * x + b * y;
      return {
        q: `The point $(${M(x)}, y)$ lies on the line $${a === 1 ? '' : a}x + ${b === 1 ? '' : b}y = ${M(c)}$. What is $y$?`,
        a: `$${M(y)}$`,
        wrong: [y + 1, -y || 2, x, y - 1].map((v) => `$${M(v)}$`),
        s:
          b === 1
            ? `$${a} \\times ${paren(x)} + y = ${M(c)}$, so $y = ${M(c - a * x)}$.`
            : `$${a} \\times ${paren(x)} + ${b}y = ${M(c)}$, so $${b}y = ${M(c - a * x)}$ and $y = ${M(y)}$.`,
      };
    },
  },
  {
    topic: 'Coordinate Geometry',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const x = (int(rng, 1, 9) * (rng() < 0.5 ? -1 : 1));
      const y = (int(rng, 1, 9) * (rng() < 0.5 ? -1 : 1));
      const q = x > 0 ? (y > 0 ? 'I' : 'IV') : y > 0 ? 'II' : 'III';
      return {
        q: `In which quadrant does the point $(${M(x)}, ${M(y)})$ lie?`,
        a: `Quadrant ${q}`,
        wrong: ['I', 'II', 'III', 'IV'].filter((v) => v !== q).map((v) => `Quadrant ${v}`),
        s: `$x$ is ${x > 0 ? 'positive' : 'negative'} and $y$ is ${y > 0 ? 'positive' : 'negative'}, so the point is in Quadrant ${q}.`,
      };
    },
  },
  {
    topic: "Heron's Formula",
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const [a, b, c, area] = pick(rng, HERONIAN);
      const s = (a + b + c) / 2;
      const product = s * (s - a) * (s - b) * (s - c);
      if (product !== area * area) throw new Error(`Heronian table wrong for ${a}, ${b}, ${c}`);
      return {
        q: `Find the area of a triangle with sides ${a} cm, ${b} cm and ${c} cm.`,
        a: `${area} square cm`,
        wrong: [a + b + c, 2 * area, s * (s - a), area + s].map((v) => `${v} square cm`),
        s: `$s = \\frac{${a} + ${b} + ${c}}{2} = ${s}$. Area $= \\sqrt{${s} \\times ${s - a} \\times ${s - b} \\times ${s - c}} = \\sqrt{${product}} = ${area}$ square cm.`,
      };
    },
  },
  {
    topic: 'Surface Areas and Volumes',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const l = int(rng, 4, 20);
      const w = int(rng, 3, 15);
      const h = int(rng, 2, 12);
      const sa = 2 * (l * w + w * h + h * l);
      return {
        q: `Find the total surface area of a box ${l} cm by ${w} cm by ${h} cm.`,
        a: `${inr(sa)} square cm`,
        wrong: [l * w * h, l * w + w * h + h * l, 2 * (l + w) * h, sa - 2 * l * w].map((v) => `${inr(v)} square cm`),
        s: `Total surface area = 2(lw + wh + hl) = 2(${l * w} + ${w * h} + ${h * l}) = ${inr(sa)} square cm.`,
      };
    },
  },
  {
    topic: 'Surface Areas and Volumes',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const r = pick(rng, [7, 14, 21]);
      const h = int(rng, 2, 20);
      const v = (22 * r * r * h) / 7;
      return {
        q: `Find the volume of a cylinder of radius ${r} cm and height ${h} cm. (Use $\\pi = \\frac{22}{7}$.)`,
        a: `${inr(v)} cubic cm`,
        wrong: [(44 * r * h) / 7, v / 3, 2 * v, (22 * r * h) / 7].map((x) => `${inr(x)} cubic cm`),
        s: `Volume = $\\pi r^2 h = \\frac{22}{7} \\times ${r} \\times ${r} \\times ${h} = ${v}$ cubic cm.`,
      };
    },
  },
  {
    topic: 'Surface Areas and Volumes',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const r = pick(rng, [7, 14, 21]);
      const h = int(rng, 1, 10) * 3;
      const v = (22 * r * r * h) / 21;
      return {
        q: `Find the volume of a cone of radius ${r} cm and height ${h} cm. (Use $\\pi = \\frac{22}{7}$.)`,
        a: `${inr(v)} cubic cm`,
        wrong: [3 * v, (22 * r * h) / 21, 2 * v, v + r].map((x) => `${inr(x)} cubic cm`),
        s: `Volume = $\\frac{1}{3}\\pi r^2 h = \\frac{1}{3} \\times \\frac{22}{7} \\times ${r} \\times ${r} \\times ${h} = ${v}$ cubic cm.`,
      };
    },
  },
  {
    topic: 'Statistics',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const n = int(rng, 5, 7);
      const mean = int(rng, 20, 80);
      const values: number[] = [];
      let total = 0;
      for (let i = 0; i < n - 1; i += 1) {
        const v = mean + int(rng, -15, 15);
        values.push(v);
        total += v;
      }
      values.push(mean * n - total);
      if (values.some((v) => v <= 0)) return { q: '', a: '', wrong: [], s: '' };
      return {
        q: `Find the mean of ${values.join(', ')}.`,
        a: String(mean),
        wrong: [mean + 1, mean - 1, mean * n, mean + 3].map(String),
        s: `Sum = ${mean * n}, and there are ${n} values: mean = ${mean * n} ÷ ${n} = ${mean}.`,
      };
    },
  },
  {
    topic: 'Statistics',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const set = new Set<number>();
      while (set.size < 6) set.add(int(rng, 10, 90));
      const list = shuffled(rng, [...set]);
      const sorted = [...list].sort((a, b) => a - b);
      const twice = sorted[2]! + sorted[3]!;
      const median = (h: number) => (h % 2 === 0 ? String(h / 2) : `${(h - 1) / 2}.5`);
      return {
        q: `Find the median of ${list.join(', ')}.`,
        a: median(twice),
        wrong: [String(sorted[2]), String(sorted[3]), median(list[2]! + list[3]!), median(twice + 2)],
        s: `In order: ${sorted.join(', ')}. With six values the median is the mean of the 3rd and 4th: (${sorted[2]} + ${sorted[3]}) ÷ 2 = ${median(twice)}.`,
      };
    },
  },
  {
    topic: 'Probability',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const n = pick(rng, [20, 25, 40, 50, 60, 80, 100, 120, 200]);
      const h = int(rng, Math.floor(n * 0.3), Math.floor(n * 0.7));
      return {
        q: `A coin is tossed ${n} times and shows heads ${h} times. What is the experimental probability of getting a tail?`,
        a: F(n - h, n),
        wrong: [F(h, n), F(1, 2), F(n - h, h), F(h, n - h)],
        s: `Tails came up ${n} − ${h} = ${n - h} times out of ${n}, so the experimental probability is $\\frac{${n - h}}{${n}} = ${frac(n - h, n)}$.`,
      };
    },
  },
  {
    topic: 'Lines and Angles',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const x = int(rng, 20, 160);
      if (rng() < 0.5) {
        return {
          q: `Two angles form a linear pair. One of them is ${x}°. What is the other?`,
          a: `${180 - x}°`,
          wrong: [x, 360 - x, Math.abs(90 - x) || 45, 180 - x + 10].map((v) => `${v}°`),
          s: `Angles in a linear pair add up to 180°: 180° − ${x}° = ${180 - x}°.`,
        };
      }
      return {
        q: `Two lines cross, and one of the angles formed is ${x}°. What is the angle vertically opposite to it?`,
        a: `${x}°`,
        wrong: [180 - x, 360 - x, x + 10, x / 2].filter((v) => Number.isInteger(v) && v !== x).map((v) => `${v}°`),
        s: `Vertically opposite angles are equal, so it is also ${x}°.`,
      };
    },
  },
];

// =============================================================================================
// Class 10
// =============================================================================================

const TRIG_VALUES: Array<{ expr: string; value: string; s: string }> = [
  { expr: '\\sin 30^\\circ + \\cos 60^\\circ', value: '1', s: '$\\frac{1}{2} + \\frac{1}{2} = 1$' },
  { expr: '\\sin^2 45^\\circ + \\cos^2 45^\\circ', value: '1', s: '$\\frac{1}{2} + \\frac{1}{2} = 1$' },
  { expr: '2\\sin 30^\\circ \\cos 30^\\circ', value: '\\frac{\\sqrt{3}}{2}', s: '$2 \\times \\frac{1}{2} \\times \\frac{\\sqrt{3}}{2} = \\frac{\\sqrt{3}}{2}$' },
  { expr: '\\tan 60^\\circ', value: '\\sqrt{3}', s: '$\\tan 60^\\circ = \\sqrt{3}$' },
  { expr: '\\cos^2 30^\\circ - \\sin^2 30^\\circ', value: '\\frac{1}{2}', s: '$\\frac{3}{4} - \\frac{1}{4} = \\frac{1}{2}$' },
  { expr: '\\tan^2 60^\\circ - 2', value: '1', s: '$3 - 2 = 1$' },
  { expr: '\\sec 60^\\circ', value: '2', s: '$\\sec 60^\\circ = \\frac{1}{\\cos 60^\\circ} = 2$' },
  { expr: '\\csc 30^\\circ', value: '2', s: '$\\csc 30^\\circ = \\frac{1}{\\sin 30^\\circ} = 2$' },
  { expr: '\\cot 45^\\circ + \\tan 45^\\circ', value: '2', s: '$1 + 1 = 2$' },
  { expr: '\\sin 90^\\circ + \\cos 0^\\circ', value: '2', s: '$1 + 1 = 2$' },
  { expr: '1 - 2\\sin^2 30^\\circ', value: '\\frac{1}{2}', s: '$1 - 2 \\times \\frac{1}{4} = \\frac{1}{2}$' },
  { expr: '\\tan 30^\\circ \\tan 60^\\circ', value: '1', s: '$\\frac{1}{\\sqrt{3}} \\times \\sqrt{3} = 1$' },
  { expr: '\\sin 60^\\circ \\cos 30^\\circ + \\cos 60^\\circ \\sin 30^\\circ', value: '1', s: '$\\frac{3}{4} + \\frac{1}{4} = 1$' },
  { expr: '\\cos 90^\\circ + \\sin 0^\\circ', value: '0', s: '$0 + 0 = 0$' },
  { expr: '\\sin 45^\\circ \\cos 45^\\circ', value: '\\frac{1}{2}', s: '$\\frac{1}{\\sqrt{2}} \\times \\frac{1}{\\sqrt{2}} = \\frac{1}{2}$' },
];
const TRIG_POOL = ['0', '\\frac{1}{2}', '1', '\\frac{\\sqrt{3}}{2}', '\\sqrt{3}', '2', '\\frac{1}{\\sqrt{2}}'];

export const CLASS_10: Template[] = [
  {
    topic: 'Real Numbers',
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
      const l = g * x * y;
      return {
        q: `The HCF of two numbers is ${g} and their LCM is ${l}. One of the numbers is ${a}. What is the other?`,
        a: String(b),
        wrong: [y, l - a, a + g, l / g].filter((v) => v !== b).map(String),
        s: `HCF × LCM = product of the numbers: ${g} × ${l} = ${g * l}, so the other number is ${g * l} ÷ ${a} = ${b}.`,
      };
    },
  },
  {
    topic: 'Quadratic Equations',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      let p = int(rng, -9, 9);
      let q = int(rng, -9, 9);
      while (p === 0 || q === 0 || p === q || p + q === 0) {
        p = int(rng, -9, 9);
        q = int(rng, -9, 9);
      }
      const [s, t] = p < q ? [p, q] : [q, p];
      const pair = (u: number, v: number) => {
        const [lo, hi] = u < v ? [u, v] : [v, u];
        return `$${M(lo)}$ and $${M(hi)}$`;
      };
      return {
        q: `What are the roots of $${poly([1, -(s + t), s * t])} = 0$?`,
        a: pair(s, t),
        wrong: [pair(-s, -t), pair(s, -t), pair(-s, t), pair(s + t, s * t)],
        s: `Two numbers with sum ${M(s + t)} and product ${M(s * t)} are ${M(s)} and ${M(t)}, so $(x ${signed(-s)})(x ${signed(-t)}) = 0$ and $x = ${M(s)}$ or $x = ${M(t)}$.`,
      };
    },
  },
  {
    topic: 'Quadratic Equations',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const kind = int(rng, 0, 2);
      let a = int(rng, 1, 4);
      let b = int(rng, -10, 10);
      let c = int(rng, -10, 10);
      const D = () => b * b - 4 * a * c;
      let guard = 0;
      while ((kind === 0 ? D() <= 0 : kind === 1 ? D() !== 0 : D() >= 0) || c === 0 || b === 0) {
        a = int(rng, 1, 4);
        b = int(rng, -10, 10);
        c = kind === 1 ? (b * b) / (4 * a) : int(rng, -10, 10);
        if (!Number.isInteger(c)) c = 0;
        guard += 1;
        if (guard > 500) return { q: '', a: '', wrong: [], s: '' };
      }
      const answers = ['Two distinct real roots', 'Two equal real roots', 'No real roots'];
      const ans = answers[kind]!;
      return {
        q: `What is the nature of the roots of $${poly([a, b, c])} = 0$?`,
        a: ans,
        wrong: [...answers.filter((v) => v !== ans), 'Infinitely many roots'],
        s: `$D = b^2 - 4ac = ${paren(b)}^2 - 4 \\times ${a} \\times ${paren(c)} = ${M(D())}$, which is ${kind === 0 ? 'positive' : kind === 1 ? 'zero' : 'negative'}: ${ans.toLowerCase()}.`,
      };
    },
  },
  {
    topic: 'Arithmetic Progressions',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = int(rng, -10, 20);
      const d = int(rng, -5, 9) || 3;
      const n = int(rng, 10, 30);
      const t = a + (n - 1) * d;
      return {
        q: `What is the ${ordinal(n)} term of the AP $${M(a)}, ${M(a + d)}, ${M(a + 2 * d)}, \\ldots$?`,
        a: `$${M(t)}$`,
        wrong: [a + n * d, a + (n - 2) * d, n * d, t + 1].map((v) => `$${M(v)}$`),
        s: `$a = ${M(a)}$, $d = ${M(d)}$: $a_{${n}} = a + (${n} - 1)d = ${M(a)} + ${n - 1} \\times ${paren(d)} = ${M(t)}$.`,
      };
    },
  },
  {
    topic: 'Arithmetic Progressions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 1, 15);
      const d = int(rng, 1, 7);
      const n = int(rng, 6, 20);
      const S = (n * (2 * a + (n - 1) * d)) / 2;
      if (!Number.isInteger(S)) return { q: '', a: '', wrong: [], s: '' };
      const last = a + (n - 1) * d;
      return {
        q: `Find the sum of the first ${n} terms of the AP ${a}, ${a + d}, ${a + 2 * d}, …`,
        a: N(S),
        wrong: [n * a + n * d, last, S - last, S + a].map(N),
        s: `$S_{${n}} = \\frac{${n}}{2}\\left[2 \\times ${a} + (${n} - 1) \\times ${d}\\right] = \\frac{${n}}{2} \\times ${2 * a + (n - 1) * d} = ${S}$.`,
      };
    },
  },
  {
    topic: 'Pair of Linear Equations',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const x = int(rng, -6, 9);
      const y = int(rng, -6, 9);
      const a1 = int(rng, 1, 5);
      const b1 = int(rng, 1, 5);
      const a2 = int(rng, 1, 5);
      const b2 = -int(rng, 1, 5);
      if (a1 * b2 - a2 * b1 === 0 || x === y) return { q: '', a: '', wrong: [], s: '' };
      const c1 = a1 * x + b1 * y;
      const c2 = a2 * x + b2 * y;
      const eq = (a: number, b: number, c: number) => `${a === 1 ? '' : a}x${termAfter(b, 'y')} = ${M(c)}`;
      const sol = (u: number, v: number) => `$x = ${M(u)}, y = ${M(v)}$`;
      return {
        q: `Solve: $${eq(a1, b1, c1)}$ and $${eq(a2, b2, c2)}$.`,
        a: sol(x, y),
        wrong: [sol(y, x), sol(x, -y || 1), sol(-x || 1, y), sol(x + 1, y)],
        s: `Check: $${a1} \\times ${paren(x)} + ${b1} \\times ${paren(y)} = ${M(c1)}$ and $${a2} \\times ${paren(x)} ${signed(b2)} \\times ${paren(y)} = ${M(c2)}$. Eliminating one variable gives $x = ${M(x)}$, $y = ${M(y)}$.`,
      };
    },
  },
  {
    topic: 'Coordinate Geometry',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [p, q, r] = pick(rng, TRIPLES);
      const k = int(rng, 1, 2);
      const [dx, dy, d] = rng() < 0.5 ? [p * k, q * k, r * k] : [q * k, p * k, r * k];
      const x1 = int(rng, -5, 5);
      const y1 = int(rng, -5, 5);
      const x2 = x1 + dx * (rng() < 0.5 ? -1 : 1);
      const y2 = y1 + dy * (rng() < 0.5 ? -1 : 1);
      return {
        q: `Find the distance between $(${M(x1)}, ${M(y1)})$ and $(${M(x2)}, ${M(y2)})$.`,
        a: String(d),
        wrong: [dx + dy, d * d, Math.abs(dx - dy), d + 1].map(String),
        s: `$d = \\sqrt{(${M(x2)} - ${paren(x1)})^2 + (${M(y2)} - ${paren(y1)})^2} = \\sqrt{${dx * dx} + ${dy * dy}} = \\sqrt{${d * d}} = ${d}$.`,
      };
    },
  },
  {
    topic: 'Coordinate Geometry',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const m = int(rng, 1, 3);
      const n = int(rng, 1, 3);
      const x = int(rng, -6, 6);
      const y = int(rng, -6, 6);
      const ux = int(rng, -4, 4);
      const uy = int(rng, -4, 4);
      // A = P − m·u, B = P + n·u divides AB at P in the ratio m : n.
      const A = [x - m * ux, y - m * uy];
      const B = [x + n * ux, y + n * uy];
      if (ux === 0 && uy === 0) return { q: '', a: '', wrong: [], s: '' };
      const pt = (u: number, v: number) => `$(${M(u)}, ${M(v)})$`;
      return {
        q: `Find the point that divides the line segment joining $(${M(A[0]!)}, ${M(A[1]!)})$ and $(${M(B[0]!)}, ${M(B[1]!)})$ internally in the ratio ${m} : ${n}.`,
        a: pt(x, y),
        wrong: [pt(y, x), pt(A[0]! + B[0]!, A[1]! + B[1]!), pt(-x, -y), pt(x + 1, y)],
        s: `$\\left(\\frac{${m} \\times ${paren(B[0]!)} + ${n} \\times ${paren(A[0]!)}}{${m + n}}, \\frac{${m} \\times ${paren(B[1]!)} + ${n} \\times ${paren(A[1]!)}}{${m + n}}\\right) = (${M(x)}, ${M(y)})$.`,
      };
    },
  },
  {
    topic: 'Introduction to Trigonometry',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const item = pick(rng, TRIG_VALUES);
      return {
        q: `Find the value of $${item.expr}$.`,
        a: `$${item.value}$`,
        wrong: shuffled(rng, TRIG_POOL.filter((v) => v !== item.value)).map((v) => `$${v}$`),
        s: `${item.s}.`,
      };
    },
  },
  {
    topic: 'Introduction to Trigonometry',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [p, q, r] = pick(rng, TRIPLES);
      const given = pick(rng, ['sin', 'cos'] as const);
      const asked = pick(rng, given === 'sin' ? (['cos', 'tan'] as const) : (['sin', 'tan'] as const));
      // Opposite p, adjacent q, hypotenuse r.
      const ratios = { sin: [p, r], cos: [q, r], tan: [p, q] } as const;
      const [gn, gd] = ratios[given];
      const [an, ad] = ratios[asked];
      return {
        q: `If $\\${given}\\theta = \\frac{${gn}}{${gd}}$ and $\\theta$ is acute, find $\\${asked}\\theta$.`,
        a: F(an, ad),
        wrong: [F(ad, an), F(gn, gd), F(gd, gn), F(p, r) === F(an, ad) ? F(q, p) : F(p, r)],
        s: `Take a right triangle with ${given === 'sin' ? 'opposite' : 'adjacent'} side ${gn} and hypotenuse ${gd}; the third side is $\\sqrt{${gd}^2 - ${gn}^2} = ${given === 'sin' ? q : p}$. So $\\${asked}\\theta = \\frac{${an}}{${ad}}$.`,
      };
    },
  },
  {
    topic: 'Applications of Trigonometry',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const angle = pick(rng, [30, 45, 60]);
      const d = int(rng, 2, 20) * 3;
      const ans = angle === 45 ? `$${d}$ m` : angle === 60 ? `$${d}\\sqrt{3}$ m` : `$${d / 3}\\sqrt{3}$ m`;
      const others = [`$${d}$ m`, `$${d}\\sqrt{3}$ m`, `$${d / 3}\\sqrt{3}$ m`, `$${2 * d}$ m`, `$${2 * d}\\sqrt{3}$ m`].filter((v) => v !== ans);
      const tanValue = angle === 45 ? '1' : angle === 60 ? '\\sqrt{3}' : '\\frac{1}{\\sqrt{3}}';
      return {
        q: `From a point ${d} m from the foot of a tower, the angle of elevation of its top is ${angle}°. How tall is the tower?`,
        a: ans,
        wrong: shuffled(rng, others),
        s: `$\\tan ${angle}^\\circ = \\frac{h}{${d}}$, and $\\tan ${angle}^\\circ = ${tanValue}$, so $h = ${d} \\times ${tanValue}$ = ${ans}.`,
      };
    },
  },
  {
    topic: 'Surface Areas and Volumes',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const r = pick(rng, [7, 14, 21]);
      if (rng() < 0.5) {
        const h = int(rng, 3, 20);
        const csa = (44 * r * h) / 7;
        return {
          q: `Find the curved surface area of a cylinder of radius ${r} cm and height ${h} cm. (Use $\\pi = \\frac{22}{7}$.)`,
          a: `${inr(csa)} square cm`,
          wrong: [(22 * r * r * h) / 7, csa / 2, csa + (44 * r * r) / 7, 2 * csa].map((v) => `${inr(v)} square cm`),
          s: `Curved surface area = $2\\pi rh = 2 \\times \\frac{22}{7} \\times ${r} \\times ${h} = ${csa}$ square cm.`,
        };
      }
      const l = int(rng, 8, 30);
      const csa = (22 * r * l) / 7;
      return {
        q: `Find the curved surface area of a cone of radius ${r} cm and slant height ${l} cm. (Use $\\pi = \\frac{22}{7}$.)`,
        a: `${inr(csa)} square cm`,
        wrong: [2 * csa, (22 * r * r) / 7 + csa, csa / 3, (22 * r * r * l) / 21].filter((v) => Number.isInteger(v)).map((v) => `${inr(v)} square cm`),
        s: `Curved surface area = $\\pi rl = \\frac{22}{7} \\times ${r} \\times ${l} = ${csa}$ square cm.`,
      };
    },
  },
  {
    topic: 'Probability',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const s = int(rng, 2, 12);
      const ways = 6 - Math.abs(7 - s);
      return {
        q: `Two dice are thrown together. What is the probability that the total is ${s}?`,
        a: F(ways, 36),
        wrong: [F(1, 11), F(ways, 12), F(ways + 1, 36), F(ways, 6)],
        s: `There are 36 equally likely outcomes, and ${ways} of them ${ways === 1 ? 'gives' : 'give'} a total of ${s}. So the probability is $\\frac{${ways}}{36}${frac(ways, 36) !== `\\frac{${ways}}{36}` ? ` = ${frac(ways, 36)}` : ''}$.`,
      };
    },
  },
  {
    topic: 'Statistics',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const n = int(rng, 5, 60);
      const kind = pick(rng, ['natural numbers', 'odd numbers', 'even numbers'] as const);
      const twice = kind === 'natural numbers' ? n + 1 : kind === 'odd numbers' ? 2 * n : 2 * n + 2;
      const show = (h: number) => (h % 2 === 0 ? String(h / 2) : `${(h - 1) / 2}.5`);
      return {
        q: `What is the mean of the first ${n} ${kind}?`,
        a: show(twice),
        wrong: [show(twice + 2), show(twice - 2), String(n * 2), show(twice + 1)],
        s:
          kind === 'natural numbers'
            ? `Their sum is $\\frac{${n} \\times ${n + 1}}{2}$, so the mean is $\\frac{${n + 1}}{2}$ = ${show(twice)}.`
            : kind === 'odd numbers'
              ? `The first ${n} odd numbers add up to $${n}^2$, so the mean is $${n}^2 \\div ${n} = ${n}$.`
              : `The first ${n} even numbers add up to $${n}(${n} + 1)$, so the mean is ${n} + 1 = ${n + 1}.`,
      };
    },
  },
  {
    topic: 'Circles',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [p, q, r] = pick(rng, TRIPLES);
      const k = int(rng, 1, 2);
      const [radius, tangent, dist] = rng() < 0.5 ? [p * k, q * k, r * k] : [q * k, p * k, r * k];
      return {
        q: `A point is ${dist} cm from the centre of a circle of radius ${radius} cm. How long is the tangent from the point to the circle?`,
        a: `${tangent} cm`,
        wrong: [dist - radius, dist + radius, tangent + 1, radius].filter((v) => v !== tangent).map((v) => `${v} cm`),
        s: `The tangent is perpendicular to the radius, so tangent² = ${dist}² − ${radius}² = ${dist * dist - radius * radius}, and the tangent is ${tangent} cm.`,
      };
    },
  },
];

// =============================================================================================
// Class 11
// =============================================================================================

const ALLIED: Array<{ expr: string; value: string; s: string }> = [
  { expr: '\\sin 150^\\circ', value: '\\frac{1}{2}', s: '$\\sin(180^\\circ - 30^\\circ) = \\sin 30^\\circ = \\frac{1}{2}$' },
  { expr: '\\cos 120^\\circ', value: '-\\frac{1}{2}', s: '$\\cos(180^\\circ - 60^\\circ) = -\\cos 60^\\circ = -\\frac{1}{2}$' },
  { expr: '\\tan 135^\\circ', value: '-1', s: '$\\tan(180^\\circ - 45^\\circ) = -\\tan 45^\\circ = -1$' },
  { expr: '\\sin 210^\\circ', value: '-\\frac{1}{2}', s: '$\\sin(180^\\circ + 30^\\circ) = -\\sin 30^\\circ = -\\frac{1}{2}$' },
  { expr: '\\cos 300^\\circ', value: '\\frac{1}{2}', s: '$\\cos(360^\\circ - 60^\\circ) = \\cos 60^\\circ = \\frac{1}{2}$' },
  { expr: '\\tan 225^\\circ', value: '1', s: '$\\tan(180^\\circ + 45^\\circ) = \\tan 45^\\circ = 1$' },
  { expr: '\\sin 240^\\circ', value: '-\\frac{\\sqrt{3}}{2}', s: '$\\sin(180^\\circ + 60^\\circ) = -\\sin 60^\\circ = -\\frac{\\sqrt{3}}{2}$' },
  { expr: '\\cos 150^\\circ', value: '-\\frac{\\sqrt{3}}{2}', s: '$\\cos(180^\\circ - 30^\\circ) = -\\cos 30^\\circ = -\\frac{\\sqrt{3}}{2}$' },
  { expr: '\\tan 300^\\circ', value: '-\\sqrt{3}', s: '$\\tan(360^\\circ - 60^\\circ) = -\\tan 60^\\circ = -\\sqrt{3}$' },
  { expr: '\\sin 330^\\circ', value: '-\\frac{1}{2}', s: '$\\sin(360^\\circ - 30^\\circ) = -\\sin 30^\\circ = -\\frac{1}{2}$' },
  { expr: '\\sin 135^\\circ', value: '\\frac{1}{\\sqrt{2}}', s: '$\\sin(180^\\circ - 45^\\circ) = \\sin 45^\\circ = \\frac{1}{\\sqrt{2}}$' },
  { expr: '\\cos 315^\\circ', value: '\\frac{1}{\\sqrt{2}}', s: '$\\cos(360^\\circ - 45^\\circ) = \\cos 45^\\circ = \\frac{1}{\\sqrt{2}}$' },
  { expr: '\\tan 120^\\circ', value: '-\\sqrt{3}', s: '$\\tan(180^\\circ - 60^\\circ) = -\\tan 60^\\circ = -\\sqrt{3}$' },
  { expr: '\\cos 225^\\circ', value: '-\\frac{1}{\\sqrt{2}}', s: '$\\cos(180^\\circ + 45^\\circ) = -\\cos 45^\\circ = -\\frac{1}{\\sqrt{2}}$' },
];
const ALLIED_POOL = ['\\frac{1}{2}', '-\\frac{1}{2}', '1', '-1', '\\frac{\\sqrt{3}}{2}', '-\\frac{\\sqrt{3}}{2}', '\\sqrt{3}', '-\\sqrt{3}', '\\frac{1}{\\sqrt{2}}', '-\\frac{1}{\\sqrt{2}}'];

/** Degrees as a multiple of π, e.g. 135 → "\frac{3\pi}{4}". */
function radians(deg: number): string {
  const g = gcd(deg, 180);
  const [n, d] = [deg / g, 180 / g];
  const top = n === 1 ? '\\pi' : `${n}\\pi`;
  return d === 1 ? top : `\\frac{${top}}{${d}}`;
}

export const CLASS_11: Template[] = [
  {
    topic: 'Sets',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const both = int(rng, 2, 15);
      const a = both + int(rng, 3, 30);
      const b = both + int(rng, 3, 30);
      const union = a + b - both;
      return {
        q: `If $n(A) = ${a}$, $n(B) = ${b}$ and $n(A \\cap B) = ${both}$, find $n(A \\cup B)$.`,
        a: String(union),
        wrong: [a + b, a + b + both, Math.abs(a - b) || union + 2, union - both].map(String),
        s: `$n(A \\cup B) = n(A) + n(B) - n(A \\cap B) = ${a} + ${b} - ${both} = ${union}$.`,
      };
    },
  },
  {
    topic: 'Sets',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const n = int(rng, 2, 10);
      const proper = rng() < 0.5;
      const ans = 2 ** n - (proper ? 1 : 0);
      return {
        q: `How many ${proper ? 'proper subsets' : 'subsets'} does a set with ${n} elements have?`,
        a: N(ans),
        wrong: [proper ? 2 ** n : 2 ** n - 1, n * n, 2 * n, 2 ** (n - 1)].map(N),
        s: `A set with $n$ elements has $2^n$ subsets${proper ? ', and all but one of them (the set itself) are proper' : ''}: $${proper ? `2^{${n}} - 1` : `2^{${n}}`} = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Trigonometric Functions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const deg = pick(rng, [15, 20, 30, 36, 40, 45, 60, 72, 75, 90, 105, 120, 135, 150, 210, 225, 240, 270, 300, 315, 330]);
      const wrongDegs = [deg + 15, deg + 30, deg * 2, Math.max(5, deg - 15)].map(radians);
      return {
        q: `Convert ${deg}° to radians.`,
        a: `$${radians(deg)}$`,
        wrong: wrongDegs.map((v) => `$${v}$`),
        s: `Multiply by $\\frac{\\pi}{180}$: $${deg} \\times \\frac{\\pi}{180} = ${radians(deg)}$.`,
      };
    },
  },
  {
    topic: 'Trigonometric Functions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const item = pick(rng, ALLIED);
      return {
        q: `Find the value of $${item.expr}$.`,
        a: `$${item.value}$`,
        wrong: shuffled(rng, ALLIED_POOL.filter((v) => v !== item.value)).map((v) => `$${v}$`),
        s: `${item.s}.`,
      };
    },
  },
  {
    topic: 'Complex Numbers',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const [p, q, r] = pick(rng, TRIPLES.slice(0, 4));
      const [x, y] = rng() < 0.5 ? [p, q] : [q, p];
      const a = x * (rng() < 0.5 ? -1 : 1);
      const b = y * (rng() < 0.5 ? -1 : 1);
      return {
        q: `What is the modulus of $${M(a)} ${b < 0 ? '-' : '+'} ${Math.abs(b)}i$?`,
        a: String(r),
        wrong: [Math.abs(a) + Math.abs(b), r * r, Math.abs(Math.abs(a) - Math.abs(b)), r + 1].map(String),
        s: `$|${M(a)} ${b < 0 ? '-' : '+'} ${Math.abs(b)}i| = \\sqrt{${paren(a)}^2 + ${paren(b)}^2} = \\sqrt{${a * a + b * b}} = ${r}$.`,
      };
    },
  },
  {
    topic: 'Complex Numbers',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const n = int(rng, 5, 103);
      const values = ['1', 'i', '-1', '-i'];
      const ans = values[n % 4]!;
      return {
        q: `What is $i^{${n}}$?`,
        a: `$${ans}$`,
        wrong: values.filter((v) => v !== ans).map((v) => `$${v}$`),
        s: `$${n} = 4 \\times ${Math.floor(n / 4)} + ${n % 4}$ and $i^4 = 1$, so $i^{${n}} = i^{${n % 4}} = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Permutations and Combinations',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const n = int(rng, 5, 10);
      const r = int(rng, 2, 4);
      const ans = nPr(n, r);
      return {
        q: `In how many ways can ${r} different prizes be given to ${r} of ${n} students, one prize each?`,
        a: N(ans),
        wrong: [nCr(n, r), n ** r, n * r, ans / 2].filter((v) => Number.isInteger(v)).map(N),
        s: `Order matters, so this is $^{${n}}P_{${r}} = \\frac{${n}!}{${n - r}!} = ${Array.from({ length: r }, (_, i) => n - i).join(' \\times ')} = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Permutations and Combinations',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const n = int(rng, 6, 15);
      const r = int(rng, 2, 5);
      const ans = nCr(n, r);
      return {
        q: `In how many ways can a committee of ${r} be chosen from ${n} people?`,
        a: N(ans),
        wrong: [nPr(n, r), n * r, nCr(n, r - 1), ans + n].map(N),
        s: `Order does not matter: $^{${n}}C_{${r}} = \\frac{${n}!}{${r}!\\,${n - r}!} = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Binomial Theorem',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const n = int(rng, 5, 12);
      const k = int(rng, 2, n - 2);
      const ans = nCr(n, k);
      return {
        q: `What is the coefficient of $x^{${k}}$ in the expansion of $(1 + x)^{${n}}$?`,
        a: N(ans),
        wrong: [nCr(n, k - 1), nCr(n - 1, k), n * k, ans + 1].map(N),
        s: `The term in $x^{${k}}$ is $^{${n}}C_{${k}}\\,x^{${k}}$, and $^{${n}}C_{${k}} = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Sequences and Series',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 1, 5);
      const r = int(rng, 2, 3);
      const n = int(rng, 5, 8);
      const t = a * r ** (n - 1);
      return {
        q: `What is the ${ordinal(n)} term of the GP ${a}, ${a * r}, ${a * r * r}, …?`,
        a: N(t),
        wrong: [a * r ** n, a * r ** (n - 2), a + (n - 1) * r, t + a].map(N),
        s: `$a = ${a}$, $r = ${r}$: $a_{${n}} = ar^{${n} - 1} = ${a} \\times ${r}^{${n - 1}} = ${t}$.`,
      };
    },
  },
  {
    topic: 'Straight Lines',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const x1 = int(rng, -6, 6);
      const y1 = int(rng, -6, 6);
      const x2 = int(rng, -6, 6);
      const y2 = int(rng, -6, 6);
      if (x1 === x2 || y1 === y2) return { q: '', a: '', wrong: [], s: '' };
      const dy = y2 - y1;
      const dx = x2 - x1;
      return {
        q: `Find the slope of the line through $(${M(x1)}, ${M(y1)})$ and $(${M(x2)}, ${M(y2)})$.`,
        a: F(dy, dx),
        wrong: [F(dx, dy), F(-dy, dx), F(dy + 1, dx), F(y2 + y1, x2 + x1 || 1)],
        s: `Slope $= \\frac{y_2 - y_1}{x_2 - x_1} = \\frac{${M(y2)} - ${paren(y1)}}{${M(x2)} - ${paren(x1)}} = \\frac{${dy}}{${dx}}${frac(dy, dx) === `\\frac{${dy}}{${dx}}` ? '' : ` = ${frac(dy, dx)}`}$.`,
      };
    },
  },
  {
    topic: 'Straight Lines',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [p, q, r] = pick(rng, TRIPLES.slice(0, 3));
      const [a, b] = rng() < 0.5 ? [p, q] : [q, p];
      const c = int(rng, 2, 40);
      return {
        q: `Find the distance of the origin from the line $${a}x + ${b}y = ${c}$.`,
        a: F(c, r),
        wrong: [F(c, a + b), F(c * 2, r), F(c, 1), F(c, r * r)],
        s: `Distance $= \\frac{|${a} \\times 0 + ${b} \\times 0 - ${c}|}{\\sqrt{${a}^2 + ${b}^2}} = \\frac{${c}}{${r}}${frac(c, r) !== `\\frac{${c}}{${r}}` ? ` = ${frac(c, r)}` : ''}$.`,
      };
    },
  },
  {
    topic: 'Limits and Derivatives',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 1, 5);
      const n = int(rng, 2, 5);
      const ans = n * a ** (n - 1);
      return {
        q: `Evaluate $\\lim_{x \\to ${a}} \\frac{x^{${n}} - ${a ** n}}{x - ${a}}$.`,
        a: N(ans),
        wrong: [a ** (n - 1), n * a ** n, 0, ans + n].map(N),
        s: `$\\lim_{x \\to a} \\frac{x^n - a^n}{x - a} = na^{n-1}$, so the limit is $${n} \\times ${a}^{${n - 1}} = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Limits and Derivatives',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 1, 4);
      const b = int(rng, -6, 6);
      const c = int(rng, -9, 9);
      const d = int(rng, -9, 9);
      const v = int(rng, -3, 3) || 2;
      const f = (x: number) => a * x ** 3 + b * x * x + c * x + d;
      const fp = (x: number) => 3 * a * x * x + 2 * b * x + c;
      return {
        q: `If $f(x) = ${poly([a, b, c, d])}$, find $f'(${M(v)})$.`,
        a: `$${M(fp(v))}$`,
        wrong: [f(v), 3 * a * v * v + b * v + c, fp(-v), fp(v) + d].map((x) => `$${M(x)}$`),
        s: `$f'(x) = ${poly([3 * a, 2 * b, c])}$, so $f'(${M(v)}) = ${M(fp(v))}$.`,
      };
    },
  },
  {
    topic: 'Statistics',
    count: 10,
    d: 'Hard',
    make: (rng) => {
      const n = pick(rng, [5, 7]);
      const d = int(rng, 1, 6);
      const a = int(rng, 1, 20);
      const values = Array.from({ length: n }, (_, i) => a + i * d);
      const variance = (d * d * (n * n - 1)) / 12;
      const mean = a + ((n - 1) / 2) * d;
      return {
        q: `Find the variance of ${values.join(', ')}.`,
        a: N(variance),
        wrong: [d * d, mean, variance * 2, variance + d].map(N),
        s: `Mean = ${mean}. The deviations are $${values.map((v) => M(v - mean)).join(', ')}$; their squares add up to ${n * variance}, so the variance is ${n * variance} ÷ ${n} = ${variance}.`,
      };
    },
  },
];

// =============================================================================================
// Class 12
// =============================================================================================

const pmatrix = (rows: number[][]): string => `\\begin{pmatrix} ${rows.map((r) => r.map(M).join(' & ')).join(' \\\\ ')} \\end{pmatrix}`;
const vmatrix = (rows: number[][]): string => `\\begin{vmatrix} ${rows.map((r) => r.map(M).join(' & ')).join(' \\\\ ')} \\end{vmatrix}`;

function vec(c: number[]): string {
  const units = ['\\hat{i}', '\\hat{j}', '\\hat{k}'];
  let out = '';
  c.forEach((k, i) => {
    if (k === 0) return;
    const size = Math.abs(k) === 1 ? '' : String(Math.abs(k));
    out += out === '' ? `${k < 0 ? '-' : ''}${size}${units[i]}` : ` ${k < 0 ? '-' : '+'} ${size}${units[i]}`;
  });
  return out;
}

const INVERSE: Array<{ expr: string; value: string }> = [
  { expr: '\\sin^{-1}\\left(\\frac{1}{2}\\right)', value: '\\frac{\\pi}{6}' },
  { expr: '\\cos^{-1}\\left(\\frac{1}{2}\\right)', value: '\\frac{\\pi}{3}' },
  { expr: '\\tan^{-1}(1)', value: '\\frac{\\pi}{4}' },
  { expr: '\\sin^{-1}\\left(-\\frac{1}{2}\\right)', value: '-\\frac{\\pi}{6}' },
  { expr: '\\cos^{-1}\\left(-\\frac{1}{2}\\right)', value: '\\frac{2\\pi}{3}' },
  { expr: '\\tan^{-1}(\\sqrt{3})', value: '\\frac{\\pi}{3}' },
  { expr: '\\tan^{-1}(-1)', value: '-\\frac{\\pi}{4}' },
  { expr: '\\sin^{-1}(1)', value: '\\frac{\\pi}{2}' },
  { expr: '\\cos^{-1}(-1)', value: '\\pi' },
  { expr: '\\sin^{-1}\\left(\\frac{\\sqrt{3}}{2}\\right)', value: '\\frac{\\pi}{3}' },
  { expr: '\\cos^{-1}\\left(\\frac{\\sqrt{3}}{2}\\right)', value: '\\frac{\\pi}{6}' },
  { expr: '\\tan^{-1}\\left(\\frac{1}{\\sqrt{3}}\\right)', value: '\\frac{\\pi}{6}' },
  { expr: '\\cos^{-1}\\left(-\\frac{\\sqrt{3}}{2}\\right)', value: '\\frac{5\\pi}{6}' },
  { expr: '\\cos^{-1}(0)', value: '\\frac{\\pi}{2}' },
];
const INVERSE_POOL = ['\\frac{\\pi}{6}', '\\frac{\\pi}{3}', '\\frac{\\pi}{4}', '\\frac{\\pi}{2}', '-\\frac{\\pi}{6}', '-\\frac{\\pi}{4}', '\\frac{2\\pi}{3}', '\\frac{5\\pi}{6}', '\\pi'];

const DIFF_EQS: Array<{ eq: string; order: number; degree: number }> = [
  { eq: '\\frac{d^2y}{dx^2} + 3\\frac{dy}{dx} + y = 0', order: 2, degree: 1 },
  { eq: '\\left(\\frac{dy}{dx}\\right)^3 + y = x', order: 1, degree: 3 },
  { eq: '\\frac{d^3y}{dx^3} + \\left(\\frac{d^2y}{dx^2}\\right)^2 = 0', order: 3, degree: 1 },
  { eq: '\\left(\\frac{d^2y}{dx^2}\\right)^3 + \\frac{dy}{dx} = 0', order: 2, degree: 3 },
  { eq: '\\frac{dy}{dx} = \\cos x', order: 1, degree: 1 },
  { eq: '\\left(\\frac{d^2y}{dx^2}\\right)^2 + \\left(\\frac{dy}{dx}\\right)^3 = x', order: 2, degree: 2 },
  { eq: '\\frac{d^4y}{dx^4} - \\sin x = 0', order: 4, degree: 1 },
  { eq: 'x\\frac{d^2y}{dx^2} + \\left(\\frac{dy}{dx}\\right)^2 = y', order: 2, degree: 1 },
  { eq: '\\left(\\frac{d^3y}{dx^3}\\right)^2 + y = 0', order: 3, degree: 2 },
  { eq: '\\left(\\frac{dy}{dx}\\right)^4 + 3y\\frac{d^2y}{dx^2} = 0', order: 2, degree: 1 },
  { eq: '\\left(\\frac{dy}{dx}\\right)^2 - 4y = 0', order: 1, degree: 2 },
];

const QUADRUPLES: Array<[number, number, number, number]> = [
  [1, 2, 2, 3],
  [2, 3, 6, 7],
  [1, 4, 8, 9],
  [4, 4, 7, 9],
  [2, 6, 9, 11],
  [6, 6, 7, 11],
  [3, 4, 12, 13],
  [2, 10, 11, 15],
  [1, 12, 12, 17],
  [8, 9, 12, 17],
];

export const CLASS_12: Template[] = [
  {
    topic: 'Determinants',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const [a, b, c, d] = [int(rng, -6, 9), int(rng, -6, 9), int(rng, -6, 9), int(rng, -6, 9)];
      const det = a * d - b * c;
      return {
        q: `Evaluate $${vmatrix([
          [a, b],
          [c, d],
        ])}$.`,
        a: `$${M(det)}$`,
        wrong: [a * d + b * c, a * c - b * d, -det || 1, det + 1].map((x) => `$${M(x)}$`),
        s: `$${M(a)} \\times ${paren(d)} - ${paren(b)} \\times ${paren(c)} = ${M(a * d)} - ${paren(b * c)} = ${M(det)}$.`,
      };
    },
  },
  {
    topic: 'Determinants',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const m = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => int(rng, -3, 5)));
      const [[a, b, c], [d, e, f], [g, h, i]] = m as [[number, number, number], [number, number, number], [number, number, number]];
      const minor1 = e * i - f * h;
      const minor2 = d * i - f * g;
      const minor3 = d * h - e * g;
      const det = a * minor1 - b * minor2 + c * minor3;
      return {
        q: `Evaluate $${vmatrix(m)}$.`,
        a: `$${M(det)}$`,
        wrong: [a * minor1 + b * minor2 + c * minor3, -det || 2, det + 2, a * e * i].map((x) => `$${M(x)}$`),
        s: `Along the first row: $${M(a)}(${M(minor1)}) - ${paren(b)}(${M(minor2)}) + ${paren(c)}(${M(minor3)}) = ${M(det)}$.`,
      };
    },
  },
  {
    topic: 'Matrices',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const A = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => int(rng, -3, 5)));
      const B = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => int(rng, -3, 5)));
      const i = int(rng, 0, 1);
      const j = int(rng, 0, 1);
      const ab = A[i]![0]! * B[0]![j]! + A[i]![1]! * B[1]![j]!;
      const ba = B[i]![0]! * A[0]![j]! + B[i]![1]! * A[1]![j]!;
      return {
        q: `If $A = ${pmatrix(A)}$ and $B = ${pmatrix(B)}$, find the entry in row ${i + 1}, column ${j + 1} of $AB$.`,
        a: `$${M(ab)}$`,
        wrong: [ba, A[i]![j]! * B[i]![j]!, A[i]![j]! + B[i]![j]!, ab + 1].map((x) => `$${M(x)}$`),
        s: `Row ${i + 1} of $A$ times column ${j + 1} of $B$: $${M(A[i]![0]!)} \\times ${paren(B[0]![j]!)} + ${paren(A[i]![1]!)} \\times ${paren(B[1]![j]!)} = ${M(ab)}$.`,
      };
    },
  },
  {
    topic: 'Inverse Trigonometric Functions',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const item = pick(rng, INVERSE);
      return {
        q: `Find the principal value of $${item.expr}$.`,
        a: `$${item.value}$`,
        wrong: shuffled(rng, INVERSE_POOL.filter((v) => v !== item.value)).map((v) => `$${v}$`),
        s: `The principal value is the angle in the principal range whose ratio is the given number: $${item.expr} = ${item.value}$.`,
      };
    },
  },
  {
    topic: 'Continuity and Differentiability',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 1, 3);
      const b = int(rng, -3, 3);
      const n = int(rng, 2, 4);
      const v = int(rng, 0, 2);
      const inner = a * v + b;
      const ans = n * a * inner ** (n - 1);
      const inside = b === 0 ? `${a === 1 ? '' : a}x` : `${a === 1 ? '' : a}x ${signed(b)}`;
      return {
        q: `If $f(x) = (${inside})^{${n}}$, find $f'(${v})$.`,
        a: `$${M(ans)}$`,
        wrong: [n * inner ** (n - 1), a * inner ** n, n * a * inner ** n, ans + a].map((x) => `$${M(x)}$`),
        s: `By the chain rule $f'(x) = ${n} \\times ${a}(${inside})${n - 1 === 1 ? '' : `^{${n - 1}}`}$, so $f'(${v}) = ${n * a} \\times ${paren(inner)}${n - 1 === 1 ? '' : `^{${n - 1}}`} = ${M(ans)}$.`,
      };
    },
  },
  {
    topic: 'Continuity and Differentiability',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const A = int(rng, 1, 5);
      const a = int(rng, 1, 5);
      const B = int(rng, 1, 5);
      const b = int(rng, 1, 5);
      const ans = A * a + B * b;
      const coef = (k: number) => (k === 1 ? '' : String(k));
      return {
        q: `If $f(x) = ${coef(A)}\\sin ${coef(a)}x + ${coef(B)}e^{${coef(b)}x}$, find $f'(0)$.`,
        a: `$${ans}$`,
        wrong: [A + B, A * a, B * b, A * a - B * b, ans + 1].filter((x) => x !== ans).map((x) => `$${M(x)}$`),
        s: `$f'(x) = ${A * a}\\cos ${coef(a)}x + ${B * b}e^{${coef(b)}x}$, and at $x = 0$: $${A * a} \\times 1 + ${B * b} \\times 1 = ${ans}$.`,
      };
    },
  },
  {
    topic: 'Applications of Derivatives',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = pick(rng, [-2, -1, 1, 2]);
      const x0 = int(rng, -5, 5) || 3;
      const b = -2 * a * x0;
      const c = int(rng, -10, 10);
      const value = a * x0 * x0 + b * x0 + c;
      const kind = a > 0 ? 'minimum' : 'maximum';
      return {
        q: `Find the ${kind} value of $f(x) = ${poly([a, b, c])}$.`,
        a: `$${M(value)}$`,
        wrong: [x0, c, value + a, -value || 5].map((x) => `$${M(x)}$`),
        s: `$f'(x) = ${poly([2 * a, b])} = 0$ at $x = ${M(x0)}$, and $f''(x) = ${2 * a}$ is ${a > 0 ? 'positive' : 'negative'}, so the ${kind} is $f(${M(x0)}) = ${M(value)}$.`,
      };
    },
  },
  {
    topic: 'Integrals',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = pick(rng, [3, 6, 9, -3]);
      const b = pick(rng, [2, 4, 6, -2, -4]);
      const c = int(rng, 1, 9);
      const plusC = (expr: string) => `$${expr} + C$`;
      return {
        q: `Find $\\int (${poly([a, b, c])})\\,dx$.`,
        a: plusC(poly([a / 3, b / 2, c, 0])),
        wrong: [plusC(poly([2 * a, b])), plusC(poly([a, b, c, 0])), plusC(poly([a / 3, b / 2, 0, 0])), plusC(poly([3 * a, 2 * b, c, 0]))],
        s: `Integrate term by term with $\\int x^n\\,dx = \\frac{x^{n+1}}{n+1}$: $${poly([a / 3, b / 2, c, 0])} + C$.`,
      };
    },
  },
  {
    topic: 'Integrals',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 1, 6) * 2;
      const b = int(rng, -5, 8);
      const k = int(rng, 1, 5);
      const ans = (a * k * k) / 2 + b * k;
      return {
        q: `Evaluate $\\int_0^{${k}} (${poly([a, b])})\\,dx$.`,
        a: `$${M(ans)}$`,
        wrong: [a * k + b, a * k * k + b * k, (a * k * k) / 2, ans + b].map((x) => `$${M(x)}$`),
        s: `$\\left[${poly([a / 2, b, 0])}\\right]_0^{${k}} = ${a / 2} \\times ${k * k} ${signed(b * k)} = ${M(ans)}$.`,
      };
    },
  },
  {
    topic: 'Applications of Integrals',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const a = int(rng, 1, 6);
      const p = pick(rng, [1, 2, 3]);
      const area = frac(a ** (p + 1), p + 1);
      return {
        q: `Find the area under the curve $y = ${p === 1 ? 'x' : `x^{${p}}`}$ between $x = 0$ and $x = ${a}$.`,
        a: `$${area}$`,
        wrong: [frac(a ** (p + 1), p), frac(a ** p, p + 1), frac(a ** (p + 1), 1), frac(a ** (p + 1) + 1, p + 1)].map((v) => `$${v}$`),
        s: `Area $= \\int_0^{${a}} ${p === 1 ? 'x' : `x^{${p}}`}\\,dx = \\left[\\frac{x^{${p + 1}}}{${p + 1}}\\right]_0^{${a}} = \\frac{${a ** (p + 1)}}{${p + 1}}${area === `\\frac{${a ** (p + 1)}}{${p + 1}}` ? '' : ` = ${area}`}$.`,
      };
    },
  },
  {
    topic: 'Differential Equations',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const item = pick(rng, DIFF_EQS);
      const label = (o: number, d: number) => `Order ${o}, degree ${d}`;
      const pool = [
        label(item.degree, item.order),
        label(item.order, item.degree + 1),
        label(item.order + 1, item.degree),
        label(Math.max(1, item.order - 1), item.degree),
        label(item.order, item.degree === 1 ? 2 : 1),
      ];
      return {
        q: `What are the order and degree of the differential equation $${item.eq}$?`,
        a: label(item.order, item.degree),
        wrong: pool,
        s: `The highest derivative is of order ${item.order}, and it appears to the power ${item.degree}, so the order is ${item.order} and the degree is ${item.degree}.`,
      };
    },
  },
  {
    topic: 'Vector Algebra',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const a = [int(rng, 1, 6) * (rng() < 0.3 ? -1 : 1), int(rng, 1, 6), int(rng, 1, 6) * (rng() < 0.3 ? -1 : 1)];
      const b = [int(rng, 1, 6), int(rng, 1, 6) * (rng() < 0.3 ? -1 : 1), int(rng, 1, 6)];
      const dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      return {
        q: `If $\\vec{a} = ${vec(a)}$ and $\\vec{b} = ${vec(b)}$, find $\\vec{a} \\cdot \\vec{b}$.`,
        a: `$${M(dot)}$`,
        wrong: [a[0]! + b[0]! + a[1]! + b[1]! + a[2]! + b[2]!, -dot || 3, dot + 1, a[0]! * b[0]!].map((x) => `$${M(x)}$`),
        s: `$\\vec{a} \\cdot \\vec{b} = ${M(a[0]!)} \\times ${paren(b[0]!)} + ${paren(a[1]!)} \\times ${paren(b[1]!)} + ${paren(a[2]!)} \\times ${paren(b[2]!)} = ${M(dot)}$.`,
      };
    },
  },
  {
    topic: 'Vector Algebra',
    count: 10,
    d: 'Easy',
    make: (rng) => {
      const [x, y, z, m] = pick(rng, QUADRUPLES);
      const parts = shuffled(rng, [x, y, z]).map((v) => v * (rng() < 0.3 ? -1 : 1));
      return {
        q: `Find $|\\vec{a}|$ where $\\vec{a} = ${vec(parts)}$.`,
        a: String(m),
        wrong: [x + y + z, m * m, m + 1, m - 1].map(String),
        s: `$|\\vec{a}| = \\sqrt{${parts.map((v) => `${paren(v)}^2`).join(' + ')}} = \\sqrt{${m * m}} = ${m}$.`,
      };
    },
  },
  {
    topic: 'Probability',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const y = int(rng, 6, 18);
      const x = int(rng, 1, y - 1);
      if (rng() < 0.5) {
        return {
          q: `If $P(B) = ${frac(y, 20)}$ and $P(A \\cap B) = ${frac(x, 20)}$, find $P(A \\mid B)$.`,
          a: F(x, y),
          wrong: [F(x * y, 400), F(x, 20), F(y - x, y), F(x, 20 - x)],
          s: `$P(A \\mid B) = \\frac{P(A \\cap B)}{P(B)} = \\frac{${x}/20}{${y}/20} = ${frac(x, y)}$.`,
        };
      }
      const p = int(rng, 1, 9);
      const q = int(rng, 1, 9);
      return {
        q: `$A$ and $B$ are independent, with $P(A) = ${frac(p, 10)}$ and $P(B) = ${frac(q, 10)}$. Find $P(A \\cap B)$.`,
        a: F(p * q, 100),
        wrong: [F(p + q, 10 + 10), F(p * q, 10), F(10 * p + 10 * q - p * q, 100), F(p * q + 1, 100)],
        s: `For independent events $P(A \\cap B) = P(A) \\times P(B) = ${frac(p, 10)} \\times ${frac(q, 10)} = ${frac(p * q, 100)}$.`,
      };
    },
  },
  {
    topic: 'Three-Dimensional Geometry',
    count: 10,
    d: 'Medium',
    make: (rng) => {
      const [x, y, z, m] = pick(rng, QUADRUPLES);
      const deltas = shuffled(rng, [x, y, z]).map((v) => v * (rng() < 0.5 ? -1 : 1));
      const P = [int(rng, -4, 4), int(rng, -4, 4), int(rng, -4, 4)];
      const Q = P.map((v, i) => v + deltas[i]!);
      const pt = (c: number[]) => `(${c.map(M).join(', ')})`;
      return {
        q: `Find the distance between the points $${pt(P)}$ and $${pt(Q)}$.`,
        a: String(m),
        wrong: [x + y + z, m * m, m + 2, m - 1].map(String),
        s: `$\\sqrt{${deltas.map((v) => `${paren(v)}^2`).join(' + ')}} = \\sqrt{${m * m}} = ${m}$.`,
      };
    },
  },
];

