/**
 * Checks every "Can you crack this?" question on the homepage (Milestone 30, Phase 3).
 *
 *     npm run verify:samples               # verify; exits 1 on any problem
 *     npm run verify:samples -- --markdown # also print the owner's review sheet
 *
 * Each question's answer is recomputed here **independently of the data file** — by
 * arithmetic, by trying every arrangement, by searching every sequence of moves — and the
 * marked option must be the one, and the only one, that is right. A verifier also pins the
 * option texts it understands, so reordering or rewording a question without updating its
 * check fails loudly instead of passing by accident.
 *
 * Runs on Node's built-in TypeScript support (Node 23.6+); no dependency.
 */
import {
  MIN_PER_TAB,
  SAMPLE_CATEGORIES,
  SAMPLE_QUESTIONS,
  type SampleQuestion,
} from '../src/pages/Landing/sampleQuestions.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

/** The one index whose value equals `target`. Zero or several matches is a defect. */
function onlyIndex(values: readonly number[], target: number): number {
  const hits = values.flatMap((value, index) => (close(value, target) ? [index] : []))
  if (hits.length !== 1) throw new Error(`${hits.length} options equal ${target}`)
  return hits[0]!
}

/** The one index whose flag is set. */
function onlyTrue(flags: readonly boolean[]): number {
  const hits = flags.flatMap((flag, index) => (flag ? [index] : []))
  if (hits.length !== 1) throw new Error(`${hits.length} options are correct, expected exactly one`)
  return hits[0]!
}

/** "$\frac{115}{7}$" → 115/7, "24" → 24, "3 km" → 3, "Day 8" → 8. */
function numberOf(option: string): number {
  const fraction = option.match(/\\frac\{(-?\d+)\}\{(\d+)\}/)
  if (fraction) return Number(fraction[1]) / Number(fraction[2])
  const plain = option.match(/-?\d+(?:\.\d+)?/)
  if (!plain) throw new Error(`no number in option "${option}"`)
  return Number(plain[0])
}

/** A verifier that only understands one wording pins it. */
function expectOptions(q: SampleQuestion, expected: readonly string[]): void {
  if (q.options.join('|') !== expected.join('|')) {
    throw new Error(`the options changed — update this question's check too.\n    now:      ${q.options.join(' | ')}\n    expected: ${expected.join(' | ')}`)
  }
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()]
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]))
}

const choose = (n: number, k: number): number => (k < 0 || k > n ? 0 : k === 0 ? 1 : (choose(n - 1, k - 1) * n) / k)

// ---------------------------------------------------------------------------
// One independent check per question: returns the index of the correct option
// ---------------------------------------------------------------------------

const CHECKS: Record<string, (q: SampleQuestion) => number> = {
  // ---- Mathematics
  'math-power-sum': (q) => {
    // Exactly, by the power-sum recurrence, and numerically from the real root.
    const s1 = 3
    const s2 = s1 * s1 - 2
    const s3 = s1 * s2 - s1
    const s5 = s2 * s3 - s1
    const x = (3 + Math.sqrt(5)) / 2
    if (!close(x + 1 / x, 3)) throw new Error('the root does not satisfy the premise')
    const numeric = (x ** 5 + x ** -5) / (x ** 2 + x ** -2)
    if (!close(numeric, s5 / s2)) throw new Error('recurrence and numeric value disagree')
    return onlyIndex(q.options.map(numberOf), s5 / s2)
  },
  'math-odd-sum': (q) => {
    let sum = 0
    for (let i = 0; i < 20; i += 1) sum += 2 * i + 1
    return onlyIndex(q.options.map(numberOf), sum)
  },
  'math-divisors': (q) => {
    let count = 0
    for (let d = 1; d <= 360; d += 1) if (360 % d === 0) count += 1
    return onlyIndex(q.options.map(numberOf), count)
  },
  'math-area-change': (q) => {
    expectOptions(q, ['It stays the same', 'It decreases by 4%', 'It increases by 4%', 'It decreases by 20%'])
    const changePercent = Math.round((1.2 * 0.8 - 1) * 100 * 1e6) / 1e6
    return onlyIndex([0, -4, 4, -20], changePercent)
  },
  'math-last-digit': (q) => onlyIndex(q.options.map(numberOf), Number(7n ** 2026n % 10n)),
  'math-average': (q) => onlyIndex(q.options.map(numberOf), 5 * 12 - 4 * 10),
  'math-marbles': (q) => {
    const fits = []
    for (let aman = 0; aman <= 48; aman += 1) if (aman + 3 * aman === 48) fits.push(3 * aman)
    if (fits.length !== 1) throw new Error('the premise does not fix one answer')
    return onlyIndex(q.options.map(numberOf), fits[0]!)
  },

  // ---- Logic
  'logic-syllogism': (q) => {
    expectOptions(q, ['All lazzies are bloops', 'All bloops are lazzies', 'Some razzies are not bloops', 'No lazzie is a bloop'])
    // Every world of three things where bloops ⊆ razzies ⊆ lazzies; each thing is in
    // none, L, R+L or B+R+L. A statement "must be true" if it holds in all of them.
    const kinds = [
      { b: false, r: false, l: false },
      { b: false, r: false, l: true },
      { b: false, r: true, l: true },
      { b: true, r: true, l: true },
    ]
    const statements = [
      (w: typeof kinds) => w.every((t) => !t.l || t.b),
      (w: typeof kinds) => w.every((t) => !t.b || t.l),
      (w: typeof kinds) => w.some((t) => t.r && !t.b),
      (w: typeof kinds) => w.every((t) => !t.l || !t.b),
    ]
    const worlds: Array<typeof kinds> = []
    for (const a of kinds) for (const b of kinds) for (const c of kinds) worlds.push([a, b, c])
    return onlyTrue(statements.map((holds) => worlds.every(holds)))
  },
  'logic-knights': (q) => {
    expectOptions(q, ['Both are knights', 'A is a knight, B is a knave', 'A is a knave, B is a knight', 'Both are knaves'])
    const cases = [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const
    // Consistent when each speaker's statement is true exactly when they are a knight.
    return onlyTrue(cases.map(([a, b]) => (!b) === a && (a === b) === b))
  },
  'logic-boxes': (q) => {
    expectOptions(q, ['The box labelled Apples', 'The box labelled Oranges', 'The box labelled Mixed', 'No single fruit is enough'])
    const labels = ['apples', 'oranges', 'mixed'] as const
    const worlds = permutations([...labels]).filter((contents) => contents.every((c, i) => c !== labels[i]))
    const draws = (content: string) => (content === 'mixed' ? ['apple', 'orange'] : [content === 'apples' ? 'apple' : 'orange'])
    // A box works if every fruit it could yield leaves only one possible world.
    const works = labels.map((_, box) =>
      ['apple', 'orange'].every((fruit) => worlds.filter((w) => draws(w[box]!).includes(fruit)).length <= 1),
    )
    return onlyTrue([...works, !works.some(Boolean)])
  },
  'logic-rain': (q) => {
    expectOptions(q, ['It rained', 'It did not rain', 'It rained, but the match went ahead', 'Nothing can be concluded'])
    const worlds = [
      { rain: true, cancelled: true },
      { rain: true, cancelled: false },
      { rain: false, cancelled: true },
      { rain: false, cancelled: false },
    ].filter((w) => (!w.rain || w.cancelled) && !w.cancelled)
    const entailed = [
      worlds.every((w) => w.rain),
      worlds.every((w) => !w.rain),
      worlds.every((w) => w.rain && !w.cancelled),
    ]
    return onlyTrue([...entailed, !entailed.some(Boolean)])
  },
  'logic-heights': (q) => {
    expectOptions(q, ['Asha', 'Bina', 'Chetan', 'Dev'])
    // Every order of the four, shortest first, that fits all three clues.
    const orders = permutations(['Asha', 'Bina', 'Chetan', 'Dev']).filter((order) => {
      const h = (name: string) => order.indexOf(name)
      return h('Asha') > h('Bina') && h('Chetan') < h('Bina') && h('Dev') > h('Asha')
    })
    const shortest = new Set(orders.map((order) => order[0]))
    if (orders.length === 0 || shortest.size !== 1) throw new Error('the clues do not fix one shortest person')
    return onlyTrue(q.options.map((name) => shortest.has(name)))
  },
  'logic-one-true': (q) => {
    expectOptions(q, ['Box 1', 'Box 2', 'Box 3', 'It cannot be decided'])
    const fits = [1, 2, 3].map((box) => [box === 1, box !== 2, box !== 1].filter(Boolean).length === 1)
    const decided = fits.filter(Boolean).length === 1
    return onlyTrue([...fits.map((fit) => decided && fit), !decided])
  },

  // ---- Reasoning
  'reasoning-series': (q) => {
    const given = [2, 6, 12, 20, 30]
    const gaps = given.slice(1).map((v, i) => v - given[i]!)
    const steps = gaps.slice(1).map((g, i) => g - gaps[i]!)
    if (!steps.every((s) => s === steps[0])) throw new Error('the gaps do not grow evenly')
    const next = given.at(-1)! + gaps.at(-1)! + steps[0]!
    if (!given.every((v, i) => v === (i + 1) * (i + 2))) throw new Error('n(n+1) does not fit the given terms')
    if (next !== 6 * 7) throw new Error('the two rules disagree')
    return onlyIndex(q.options.map(numberOf), next)
  },
  'reasoning-code': (q) => {
    const shifts = [...'CAT'].map((c, i) => 'DBU'.charCodeAt(i) - c.charCodeAt(0))
    if (!shifts.every((s) => s === shifts[0])) throw new Error('the example is not a single shift')
    const coded = [...'DOG'].map((c) => String.fromCharCode(c.charCodeAt(0) + shifts[0]!)).join('')
    return onlyTrue(q.options.map((option) => option === coded))
  },
  'reasoning-odd-one': (q) => {
    const isSquare = (n: number) => Number.isInteger(Math.sqrt(n))
    return onlyTrue(q.options.map((option) => !isSquare(numberOf(option))))
  },
  'reasoning-directions': (q) => {
    // North, then two right turns: north → east → south.
    const legs = [
      [0, 4],
      [3, 0],
      [0, -4],
    ]
    const x = legs.reduce((sum, [dx]) => sum + dx!, 0)
    const y = legs.reduce((sum, [, dy]) => sum + dy!, 0)
    return onlyIndex(q.options.map(numberOf), Math.hypot(x, y))
  },
  'reasoning-calendar': (q) => {
    const weekday = (y: number, m: number, d: number) =>
      ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    if (weekday(2026, 1, 1) !== 'Thursday') throw new Error('the premise is wrong: 1 January 2026 is not a Thursday')
    return onlyTrue(q.options.map((option) => option === weekday(2026, 3, 1)))
  },
  'reasoning-pattern': (q) => {
    const rule = (a: number, b: number) => a * a + b * b
    if (rule(3, 4) !== 25 || rule(5, 12) !== 169) throw new Error('the rule does not fit the examples')
    return onlyIndex(q.options.map(numberOf), rule(6, 8))
  },

  // ---- Brainstorming
  'brain-chess-squares': (q) => {
    let count = 0
    for (let size = 1; size <= 8; size += 1) count += (9 - size) ** 2
    return onlyIndex(q.options.map(numberOf), count)
  },
  'brain-jugs': (q) => {
    // Breadth-first search over (3-litre, 5-litre) contents: the first time the 5-litre
    // jug holds 4 is the fewest steps.
    const key = (a: number, b: number) => `${a},${b}`
    const seen = new Set([key(0, 0)])
    let frontier: Array<[number, number]> = [[0, 0]]
    for (let steps = 1; steps <= 20; steps += 1) {
      const next: Array<[number, number]> = []
      for (const [a, b] of frontier) {
        const intoB = Math.min(a, 5 - b)
        const intoA = Math.min(b, 3 - a)
        const moves: Array<[number, number]> = [
          [3, b],
          [a, 5],
          [0, b],
          [a, 0],
          [a - intoB, b + intoB],
          [a + intoA, b - intoA],
        ]
        for (const [na, nb] of moves) {
          if (nb === 4) return onlyIndex(q.options.map(numberOf), steps)
          if (!seen.has(key(na, nb))) {
            seen.add(key(na, nb))
            next.push([na, nb])
          }
        }
      }
      frontier = next
    }
    throw new Error('no sequence reaches 4 litres')
  },
  'brain-sevens': (q) => {
    let count = 0
    for (let n = 1; n <= 100; n += 1) count += [...String(n)].filter((d) => d === '7').length
    return onlyIndex(q.options.map(numberOf), count)
  },
  'brain-snail': (q) => {
    let height = 0
    for (let day = 1; day <= 100; day += 1) {
      height += 3
      if (height >= 10) return onlyIndex(q.options.map(numberOf), day)
      height -= 2
    }
    throw new Error('the snail never gets out')
  },
  'brain-cake': (q) => {
    // The most pieces n plane cuts can make of a cake (the "cake numbers"): the fewest
    // cuts is the first n that can reach 8 — and 3 perpendicular cuts do make 8 equal ones.
    const most = (n: number) => choose(n, 3) + choose(n, 2) + choose(n, 1) + choose(n, 0)
    let cuts = 0
    while (most(cuts) < 8) cuts += 1
    return onlyIndex(q.options.map(numberOf), cuts)
  },
  'brain-handshakes': (q) => {
    let count = 0
    for (let i = 0; i < 10; i += 1) for (let j = i + 1; j < 10; j += 1) count += 1
    return onlyIndex(q.options.map(numberOf), count)
  },
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const problems: string[] = []
const ids = new Set<string>()

for (const q of SAMPLE_QUESTIONS) {
  const where = `${q.id} (${q.category})`
  if (ids.has(q.id)) problems.push(`${where}: duplicate id`)
  ids.add(q.id)
  if (q.options.length !== 4) problems.push(`${where}: needs exactly four options`)
  if (new Set(q.options).size !== q.options.length) problems.push(`${where}: two options are the same`)
  if (!q.explanation.trim()) problems.push(`${where}: no explanation`)
  if (/\b(option|answer) [A-D]\b/i.test(q.explanation)) problems.push(`${where}: the explanation names a letter, not the value`)

  const check = CHECKS[q.id]
  if (!check) {
    problems.push(`${where}: has no independent check in this script`)
    continue
  }
  try {
    const correct = check(q)
    if (correct !== q.answer) {
      problems.push(`${where}: marked "${q.options[q.answer]}", but the check finds "${q.options[correct]}"`)
    }
  } catch (err) {
    problems.push(`${where}: ${(err as Error).message}`)
  }
}

for (const id of Object.keys(CHECKS)) {
  if (!ids.has(id)) problems.push(`${id}: a check exists for a question that does not`)
}

for (const category of SAMPLE_CATEGORIES) {
  const total = SAMPLE_QUESTIONS.filter((q) => q.category === category.id).length
  if (total < MIN_PER_TAB) problems.push(`${category.label}: ${total} questions, needs at least ${MIN_PER_TAB}`)
}

if (process.argv.includes('--markdown')) {
  const letters = ['A', 'B', 'C', 'D']
  const lines = [
    '# "Can you crack this?" — sample questions for review',
    '',
    '_Generated by `npm run verify:samples -- --markdown` in `frontend/` from',
    '`frontend/src/pages/Landing/sampleQuestions.ts`. Do not edit by hand — edit the data file and regenerate._',
    '',
    'Every answer below was recomputed independently by `frontend/scripts/verify-sample-questions.ts`',
    '(arithmetic, trying every arrangement, or searching every sequence of moves). A tab appears on',
    `the homepage only once it has at least ${MIN_PER_TAB} questions marked **reviewed** by the owner.`,
    '',
    '**To approve a question:** tell Claude "approve" with its id, or change `reviewed: false` to',
    '`reviewed: true` in the data file. To change one, say what should change.',
    '',
  ]
  for (const category of SAMPLE_CATEGORIES) {
    const questions = SAMPLE_QUESTIONS.filter((q) => q.category === category.id)
    const reviewed = questions.filter((q) => q.reviewed).length
    const live = reviewed >= MIN_PER_TAB
    lines.push(`## ${category.label} — ${live ? 'live on the homepage' : 'awaiting the owner’s review (not shown)'}`, '')
    lines.push(`${reviewed} of ${questions.length} reviewed.`, '')
    questions.forEach((q, index) => {
      lines.push(`### ${index + 1}. \`${q.id}\` ${q.reviewed ? '— reviewed' : '— **needs review**'}`, '')
      lines.push(q.question, '')
      q.options.forEach((option, i) => lines.push(`- ${letters[i]}. ${option}${i === q.answer ? ' **← correct**' : ''}`))
      lines.push('', `**Why:** ${q.explanation}`, '')
    })
  }
  console.log(lines.join('\n'))
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) in the sample questions:\n`)
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

if (!process.argv.includes('--markdown')) {
  const live = SAMPLE_CATEGORIES.filter((c) => SAMPLE_QUESTIONS.filter((q) => q.category === c.id && q.reviewed).length >= MIN_PER_TAB)
  console.log(`✓ ${SAMPLE_QUESTIONS.length} sample questions verified — every marked answer is the only correct one.`)
  console.log(`  Live tabs: ${live.map((c) => c.label).join(', ') || 'none'}.`)
}
