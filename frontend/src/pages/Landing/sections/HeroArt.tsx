import type { ReactNode, RefObject } from 'react'
import { Quote } from 'lucide-react'
import { FOUNDER } from '../../../lib/brand'
import { PICTURES_OF_THE_DAY, type PictureOfTheDay } from '../../../lib/pictureOfTheDay'
import { HERO_QUOTE } from '../../../lib/siteConfig'
import styles from './HeroArt.module.css'
import symmetry from '../../../assets/figures/symmetry.webp'
import congruentFigures from '../../../assets/figures/congruent-figures.webp'
import shortestPath from '../../../assets/figures/shortest-path.webp'
import circleEquation from '../../../assets/figures/circle-equation.webp'
import continuity from '../../../assets/figures/continuity.webp'
import triangleInequality from '../../../assets/figures/triangle-inequality.webp'
import fairDivision from '../../../assets/figures/fair-division.webp'
import infinity from '../../../assets/figures/infinity.webp'
import isoperimetric from '../../../assets/figures/isoperimetric.webp'

/**
 * The hero's artwork (redrawn 2026-10-09 — the owner: "The think grow solve picture doesn't look
 * good on the hero page, I want something more better … generate one by yourself").
 *
 * ## A figure of the day, not a scene
 *
 * One card, "Today's figure": a piece of real mathematics drawn exactly — compound growth, the
 * Fibonacci spiral, Pythagoras, Gauss's staircase, doubling, the primes, a triangle's angles — on
 * graph paper, with its formula and one line that is **true as written** (CLAUDE.md: nothing on the
 * homepage may claim what is not so). Geometry is what a hand-written SVG does precisely; cartoon
 * scenes are what made the earlier pictures look home-made. The owner's brief for the picture — "a
 * positive and motivational one … updated regularly" — is kept: each line is about getting better,
 * and there is a new figure every day.
 *
 * ## Chosen before the first paint
 *
 * All sixteen are in the page and CSS shows today's, which `public/boot.js` names on `<html
 * data-picture>` from the India date — the homepage is drawn at build time for everybody, so a
 * choice made in React would draw one and swap to another when the app took over. The nine that are
 * pictures load lazily, and a lazy image inside a hidden day is never fetched: a visitor downloads
 * today's picture only (3–13 KB), or none on a drawn day.
 *
 * ## The owner's nine (2026-10-10)
 *
 * From 335 designs the owner made, the nine whose drawing shows its own topic and whose words are
 * correct. Only the drawing is the picture — cropped from the design and stored in
 * `src/assets/figures/` — while its name, formula and line are text here: legible on a phone, the
 * same card as the seven, and the design's own label, number and quote not repeated.
 *
 * ## Depth
 *
 * The card and the founder's quote are separate layers (`layers`), which the homepage's motion
 * moves a little with the pointer on a desktop (`pages/Landing/motion.ts`). Nothing here moves on
 * its own, and nothing starts hidden: the drawn page shows the finished picture.
 *
 * Decoration: the figure is hidden from assistive technology. The founder's quote is real text.
 */

export interface HeroArtProps {
  /** The two layers the pointer moves — the figure's card, and the quote over it. */
  layers?: { card: RefObject<HTMLDivElement | null>; quote: RefObject<HTMLDivElement | null> }
}

export default function HeroArt({ layers }: HeroArtProps) {
  return (
    <div className={styles.stage}>
      <div className={styles.glow} aria-hidden="true" />
      <div ref={layers?.card} className={styles.layer}>
        <div className={styles.card} aria-hidden="true">
          <p className={styles.eyebrow}>Today’s figure</p>
          {PICTURES_OF_THE_DAY.map((name, index) => {
            const figure = FIGURES[name]
            return (
              <div key={name} className={styles.day} data-picture-index={index}>
                <p className={styles.name}>{figure.name}</p>
                <div className={styles.canvas}>
                  {'picture' in figure ? (
                    <img
                      src={figure.picture.src}
                      width={figure.picture.width}
                      height={figure.picture.height}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <svg viewBox="0 0 320 200" focusable="false">
                      <figure.Drawing />
                    </svg>
                  )}
                </div>
                <p className={styles.formula}>{figure.formula}</p>
                <p className={styles.caption}>{figure.line}</p>
              </div>
            )
          })}
        </div>
      </div>
      <div ref={layers?.quote} className={`${styles.layer} ${styles.quoteLayer}`}>
        <figure className={styles.quote}>
          <Quote aria-hidden="true" className={styles.quoteMark} />
          <blockquote>{HERO_QUOTE}</blockquote>
          <figcaption>— {FOUNDER}</figcaption>
        </figure>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// The figures — each drawn on a 320 × 200 page, with its geometry worked out once, here
// ---------------------------------------------------------------------------------------------

type Figure = {
  name: string
  formula: ReactNode
  line: string
} & (
  | { Drawing: () => ReactNode }
  /** One of the owner's designs: the drawing alone, 920 px wide, at its own proportions. */
  | { picture: { src: string; width: number; height: number } }
)

const fixed = (value: number) => Number(value.toFixed(1))

/** A filled sector from `from` to `to` degrees, clockwise on screen, about (cx, cy). */
function sector(cx: number, cy: number, r: number, from: number, to: number): string {
  const sweep = (((to - from) % 360) + 360) % 360
  const at = (angle: number) => [fixed(cx + r * Math.cos((angle * Math.PI) / 180)), fixed(cy + r * Math.sin((angle * Math.PI) / 180))]
  const [x1, y1] = at(from)
  const [x2, y2] = at(to)
  return `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2} Z`
}

/** Where a label sits inside a sector: on its bisector, `r` from the centre. */
function insideSector(cx: number, cy: number, r: number, from: number, to: number): { x: number; y: number } {
  const sweep = (((to - from) % 360) + 360) % 360
  const middle = ((from + sweep / 2) * Math.PI) / 180
  return { x: fixed(cx + r * Math.cos(middle)), y: fixed(cy + r * Math.sin(middle)) }
}

// ---------- compound growth: 1.01 a day for a year, against 1.00 ----------

const GROWTH = (() => {
  const left = 30
  const right = 292
  const floor = 166
  const top = 1.01 ** 365 // 37.78…
  const x = (day: number) => fixed(left + (day / 365) * (right - left))
  const y = (value: number) => fixed(floor - ((value - 1) / (top - 1)) * 134)
  const points: string[] = []
  for (let day = 0; day <= 365; day += 5) points.push(`${x(day)} ${y(1.01 ** day)}`)
  const curve = `M${points.join(' L')}`
  return { left, right, floor, curve, area: `${curve} L${right} ${floor} L${left} ${floor} Z`, end: { x: x(365), y: y(top) } }
})()

function Growth() {
  const g = GROWTH
  return (
    <>
      <path className={styles.areaBlue} d={g.area} />
      <line className={styles.axis} x1={g.left} y1={178} x2={g.right} y2={178} />
      <line className={styles.dash} x1={g.left} y1={g.floor} x2={g.right} y2={g.floor} />
      <text className={styles.label} x={g.right} y={g.floor - 7} textAnchor="end" fontSize={10}>
        1.00 a day: still 1
      </text>
      <path className={styles.curve} d={g.curve} />
      <circle className={styles.goldDot} cx={g.end.x} cy={g.end.y} r={6} />
      <text className={styles.labelStrong} x={g.end.x - 12} y={g.end.y + 4} textAnchor="end" fontSize={13}>
        37.8 ×
      </text>
      <text className={styles.label} x={g.left} y={192} fontSize={10}>
        Day 1
      </text>
      <text className={styles.label} x={g.right} y={192} textAnchor="end" fontSize={10}>
        Day 365
      </text>
    </>
  )
}

// ---------- the Fibonacci spiral: squares 1, 1, 2, 3, 5, 8 and the arcs through them ----------

const FIBONACCI = (() => {
  const unit = 17
  const x0 = (320 - 13 * unit) / 2
  const y0 = (200 - 8 * unit) / 2
  const at = (x: number, y: number) => `${fixed(x0 + x * unit)} ${fixed(y0 + y * unit)}`
  const arc = (size: number, x: number, y: number) => `A${size * unit} ${size * unit} 0 0 1 ${at(x, y)}`
  const squares = [
    { x: 0, y: 0, size: 8, tone: 'tone1' },
    { x: 8, y: 0, size: 5, tone: 'tone4' },
    { x: 10, y: 5, size: 3, tone: 'tone3' },
    { x: 8, y: 6, size: 2, tone: 'tone2' },
    { x: 8, y: 5, size: 1, tone: 'tone5' },
    { x: 9, y: 5, size: 1, tone: 'tone5' },
  ] as const
  const spiral = `M${at(0, 8)} ${arc(8, 8, 0)} ${arc(5, 13, 5)} ${arc(3, 10, 8)} ${arc(2, 8, 6)} ${arc(1, 9, 5)} ${arc(1, 10, 6)}`
  return { unit, x0, y0, squares, spiral }
})()

function Fibonacci() {
  const f = FIBONACCI
  return (
    <>
      {f.squares.map((square) => (
        <rect
          key={`${square.x}-${square.y}`}
          className={`${styles[square.tone]} ${styles.cell}`}
          x={fixed(f.x0 + square.x * f.unit)}
          y={fixed(f.y0 + square.y * f.unit)}
          width={square.size * f.unit}
          height={square.size * f.unit}
        />
      ))}
      {f.squares
        .filter((square) => square.size > 1)
        .map((square) => (
          <text
            key={`label-${square.x}-${square.y}`}
            className={styles.label}
            x={fixed(f.x0 + (square.x + square.size / 2) * f.unit)}
            y={fixed(f.y0 + (square.y + square.size / 2) * f.unit + 4)}
            textAnchor="middle"
            fontSize={square.size >= 5 ? 14 : 11}
          >
            {square.size}
          </text>
        ))}
      <path className={styles.curve} d={f.spiral} />
    </>
  )
}

// ---------- Pythagoras: 3² + 4² = 5², as squares of cells on the three sides ----------

const PYTHAGORAS = (() => {
  const unit = 16
  const c = { x: 128, y: 124 }
  const a = { x: c.x, y: c.y - 3 * unit }
  const b = { x: c.x + 4 * unit, y: c.y }
  const out = { x: 3 * unit, y: -4 * unit } // perpendicular to the hypotenuse, away from the triangle
  const b2 = { x: b.x + out.x, y: b.y + out.y }
  const a2 = { x: a.x + out.x, y: a.y + out.y }
  const lerp = (p: { x: number; y: number }, q: { x: number; y: number }, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
  const grid: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (let k = 1; k < 3; k += 1) {
    grid.push({ x1: c.x - k * unit, y1: a.y, x2: c.x - k * unit, y2: c.y })
    grid.push({ x1: c.x - 3 * unit, y1: a.y + k * unit, x2: c.x, y2: a.y + k * unit })
  }
  for (let k = 1; k < 4; k += 1) {
    grid.push({ x1: c.x + k * unit, y1: c.y, x2: c.x + k * unit, y2: c.y + 4 * unit })
    grid.push({ x1: c.x, y1: c.y + k * unit, x2: b.x, y2: c.y + k * unit })
  }
  for (let k = 1; k < 5; k += 1) {
    const along = lerp(a, b, k / 5)
    const up = { x: a.x + (out.x * k) / 5, y: a.y + (out.y * k) / 5 }
    grid.push({ x1: along.x, y1: along.y, x2: along.x + out.x, y2: along.y + out.y })
    grid.push({ x1: up.x, y1: up.y, x2: up.x + (b.x - a.x), y2: up.y + (b.y - a.y) })
  }
  const points = (...ps: Array<{ x: number; y: number }>) => ps.map((p) => `${fixed(p.x)},${fixed(p.y)}`).join(' ')
  return {
    unit,
    c,
    small: { x: c.x - 3 * unit, y: a.y, size: 3 * unit },
    middle: { x: c.x, y: c.y, size: 4 * unit },
    large: points(a, b, b2, a2),
    triangle: points(a, b, c),
    grid: grid.map((line) => ({ x1: fixed(line.x1), y1: fixed(line.y1), x2: fixed(line.x2), y2: fixed(line.y2) })),
    labels: [
      { text: '9', x: c.x - 1.5 * unit, y: c.y - 1.5 * unit },
      { text: '16', x: c.x + 2 * unit, y: c.y + 2 * unit },
      { text: '25', x: (a.x + b.x + b2.x + a2.x) / 4, y: (a.y + b.y + b2.y + a2.y) / 4 },
    ],
  }
})()

function Pythagoras() {
  const p = PYTHAGORAS
  return (
    <>
      <rect className={`${styles.tone2} ${styles.cell}`} x={p.small.x} y={p.small.y} width={p.small.size} height={p.small.size} />
      <rect className={`${styles.tone1} ${styles.cell}`} x={p.middle.x} y={p.middle.y} width={p.middle.size} height={p.middle.size} />
      <polygon className={`${styles.tone3} ${styles.cell}`} points={p.large} />
      {p.grid.map((line, i) => (
        <line key={i} className={styles.hair} {...line} />
      ))}
      <polygon className={styles.stroke} points={p.triangle} />
      <path className={styles.hair} d={`M${p.c.x} ${p.c.y - 8} H${p.c.x + 8} V${p.c.y}`} />
      {p.labels.map((label) => (
        <text key={label.text} className={styles.labelStrong} x={fixed(label.x)} y={fixed(label.y + 5)} textAnchor="middle" fontSize={14}>
          {label.text}
        </text>
      ))}
    </>
  )
}

// ---------- Gauss's staircase: 1 + 2 + … + 10, and the same staircase turned over ----------

const STAIRCASE = (() => {
  const cell = 13
  const columns = 10
  const rows = 11
  const x0 = (320 - columns * cell) / 2
  const y0 = 20
  return {
    cell,
    x0,
    y0,
    width: columns * cell,
    height: rows * cell,
    columns: Array.from({ length: columns }, (_, i) => ({
      x: x0 + i * cell,
      low: { y: y0 + (rows - (i + 1)) * cell, height: (i + 1) * cell },
      high: { y: y0, height: (rows - (i + 1)) * cell },
    })),
    verticals: Array.from({ length: columns - 1 }, (_, i) => x0 + (i + 1) * cell),
    horizontals: Array.from({ length: rows - 1 }, (_, i) => y0 + (i + 1) * cell),
  }
})()

function Staircase() {
  const s = STAIRCASE
  return (
    <>
      {s.columns.map((column) => (
        <g key={column.x}>
          <rect className={styles.stairLow} x={column.x} y={column.low.y} width={s.cell} height={column.low.height} />
          {column.high.height > 0 && <rect className={styles.stairHigh} x={column.x} y={column.high.y} width={s.cell} height={column.high.height} />}
        </g>
      ))}
      {s.verticals.map((x) => (
        <line key={`v${x}`} className={styles.gap} x1={x} y1={s.y0} x2={x} y2={s.y0 + s.height} />
      ))}
      {s.horizontals.map((y) => (
        <line key={`h${y}`} className={styles.gap} x1={s.x0} y1={y} x2={s.x0 + s.width} y2={y} />
      ))}
      <text className={styles.label} x={s.x0 + s.cell / 2} y={s.y0 + s.height + 14} textAnchor="middle" fontSize={10}>
        1
      </text>
      <text className={styles.label} x={s.x0 + s.width - s.cell / 2} y={s.y0 + s.height + 14} textAnchor="middle" fontSize={10}>
        10
      </text>
      <text className={styles.label} x={s.x0 + s.width + 10} y={s.y0 + s.height / 2 + 4} fontSize={10}>
        11
      </text>
    </>
  )
}

// ---------- doubling: 1, 2, 4, 8 ----------

const DOUBLING = (() => {
  const left = 40
  const right = 268
  const rows = [34, 78, 122, 166]
  const radius = [11, 9.5, 8, 7]
  const nodes = rows.flatMap((y, level) =>
    Array.from({ length: 2 ** level }, (_, i) => ({
      level,
      i,
      x: fixed(left + ((i + 0.5) * (right - left)) / 2 ** level),
      y,
      r: radius[level]!,
    })),
  )
  const edges = nodes
    .filter((node) => node.level > 0)
    .map((node) => {
      const parent = nodes.find((candidate) => candidate.level === node.level - 1 && candidate.i === Math.floor(node.i / 2))!
      return { x1: parent.x, y1: parent.y + parent.r, x2: node.x, y2: node.y - node.r }
    })
  return { nodes, edges, rows }
})()

function Doubling() {
  const d = DOUBLING
  return (
    <>
      {d.edges.map((edge, i) => (
        <line key={i} className={styles.strokeSoft} {...edge} />
      ))}
      {d.nodes.map((node) => (
        <circle
          key={`${node.level}-${node.i}`}
          className={node.level === 0 ? styles.dot : node.level === 3 ? styles.goldDot : styles.ring}
          cx={node.x}
          cy={node.y}
          r={node.r}
        />
      ))}
      {d.rows.map((y, level) => (
        <text key={y} className={styles.labelStrong} x={300} y={y + 4} textAnchor="end" fontSize={12}>
          {2 ** level}
        </text>
      ))}
    </>
  )
}

// ---------- the primes up to 100, on a hundred square ----------

const PRIMES = (() => {
  const cell = 17
  const x0 = (320 - 10 * cell) / 2
  const y0 = (200 - 10 * cell) / 2
  const isPrime = (n: number) => {
    if (n < 2) return false
    for (let divisor = 2; divisor * divisor <= n; divisor += 1) if (n % divisor === 0) return false
    return true
  }
  const marks = Array.from({ length: 100 }, (_, i) => i + 1)
    .filter(isPrime)
    .map((n) => ({ n, x: x0 + ((n - 1) % 10) * cell + cell / 2, y: y0 + Math.floor((n - 1) / 10) * cell + cell / 2 }))
  return { cell, x0, y0, marks }
})()

function Primes() {
  const p = PRIMES
  return (
    <>
      <defs>
        <pattern id="hero-figure-sieve" x={p.x0} y={p.y0} width={p.cell} height={p.cell} patternUnits="userSpaceOnUse">
          <circle className={styles.faintDot} cx={p.cell / 2} cy={p.cell / 2} r={1.7} />
        </pattern>
      </defs>
      <rect x={p.x0} y={p.y0} width={p.cell * 10} height={p.cell * 10} fill="url(#hero-figure-sieve)" />
      {p.marks.map((mark) => (
        <g key={mark.n}>
          <circle className={styles.dot} cx={mark.x} cy={mark.y} r={7.2} />
          <text className={styles.onDot} x={mark.x} y={mark.y + 2.7} textAnchor="middle" fontSize={7.5}>
            {mark.n}
          </text>
        </g>
      ))}
    </>
  )
}

// ---------- a triangle's angles, and the same three on a straight line ----------

const ANGLES = (() => {
  const a = { x: 36, y: 168 }
  const b = { x: 168, y: 168 }
  const c = { x: 118, y: 52 }
  const towards = (p: { x: number; y: number }, q: { x: number; y: number }) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI
  // The inside of each corner, as a clockwise sweep from one side to the other.
  const corners = [
    { name: 'a', at: a, from: towards(a, c), to: towards(a, b), tone: 'wedge1' },
    { name: 'b', at: b, from: towards(b, a), to: towards(b, c), tone: 'wedge2' },
    { name: 'c', at: c, from: towards(c, b), to: towards(c, a), tone: 'wedge3' },
  ] as const
  const sweep = (corner: (typeof corners)[number]) => (((corner.to - corner.from) % 360) + 360) % 360
  const line = { x: 250, y: 168, r: 36 }
  // On the line: a, then c, then b — from pointing left (180°) round to pointing right (360°).
  let start = 180
  const laid = [corners[0], corners[2], corners[1]].map((corner) => {
    const from = start
    start += sweep(corner)
    return { ...corner, from, to: start }
  })
  return {
    triangle: `${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`,
    corners: corners.map((corner) => ({
      ...corner,
      path: sector(corner.at.x, corner.at.y, 22, corner.from, corner.to),
      label: insideSector(corner.at.x, corner.at.y, 14, corner.from, corner.to),
    })),
    line,
    laid: laid.map((corner) => ({
      ...corner,
      path: sector(line.x, line.y, line.r, corner.from, corner.to),
      label: insideSector(line.x, line.y, line.r * 0.62, corner.from, corner.to),
    })),
  }
})()

function Angles() {
  const g = ANGLES
  return (
    <>
      {g.corners.map((corner) => (
        <path key={`corner-${corner.name}`} className={styles[corner.tone]} d={corner.path} />
      ))}
      <polygon className={styles.stroke} points={g.triangle} />
      {g.laid.map((corner) => (
        <path key={`laid-${corner.name}`} className={styles[corner.tone]} d={corner.path} />
      ))}
      <line className={styles.axis} x1={g.line.x - 54} y1={g.line.y} x2={g.line.x + 54} y2={g.line.y} />
      {[...g.corners, ...g.laid].map((corner, i) => (
        <text key={i} className={styles.labelStrong} x={corner.label.x} y={corner.label.y + 4} textAnchor="middle" fontSize={11} fontStyle="italic">
          {corner.name}
        </text>
      ))}
      <text className={styles.label} x={g.line.x} y={g.line.y + 18} textAnchor="middle" fontSize={10}>
        a straight line: 180°
      </text>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// The sixteen, by name — every one of `PICTURES_OF_THE_DAY` must have its drawing (or picture) and
// its words
// ---------------------------------------------------------------------------------------------

const FIGURES: Record<PictureOfTheDay, Figure> = {
  growth: {
    name: 'Compound growth',
    formula: (
      <>
        1.01<sup>365</sup> = 37.78…
      </>
    ),
    line: 'Get one per cent better every day.',
    Drawing: Growth,
  },
  fibonacci: {
    name: 'The Fibonacci spiral',
    formula: '1, 1, 2, 3, 5, 8, 13, …',
    line: 'Each step builds on the two before it.',
    Drawing: Fibonacci,
  },
  pythagoras: {
    name: 'Pythagoras',
    formula: (
      <>
        3<sup>2</sup> + 4<sup>2</sup> = 5<sup>2</sup>
      </>
    ),
    line: 'Two squares fill the third exactly.',
    Drawing: Pythagoras,
  },
  staircase: {
    name: 'Gauss’s staircase',
    formula: '1 + 2 + … + 100 = 5,050',
    line: 'Pair the first with the last, and the sum appears.',
    Drawing: Staircase,
  },
  doubling: {
    name: 'Doubling',
    formula: (
      <>
        2<sup>10</sup> = 1,024
      </>
    ),
    line: 'Ten doublings take one past a thousand.',
    Drawing: Doubling,
  },
  primes: {
    name: 'The primes',
    formula: '2, 3, 5, 7, 11, 13, …',
    line: 'There is no largest prime. Keep going.',
    Drawing: Primes,
  },
  angles: {
    name: 'A triangle’s angles',
    formula: 'a + b + c = 180°',
    line: 'Three corners always make a straight line.',
    Drawing: Angles,
  },

  // The owner's nine, in their own words (designs 31, 71, 97, 130, 138, 161, 244, 266 and 300).
  symmetry: {
    name: 'Symmetry',
    formula: 'Mirror halves match',
    line: 'A line of symmetry divides a figure into matching mirror images.',
    picture: { src: symmetry, width: 920, height: 367 },
  },
  'congruent-figures': {
    name: 'Congruent figures',
    formula: 'Same shape and same size',
    line: 'Congruent figures can be matched exactly by rigid motions.',
    picture: { src: congruentFigures, width: 920, height: 367 },
  },
  'shortest-path': {
    name: 'Shortest path',
    formula: 'Minimise total edge weight',
    line: 'A shortest-path problem finds the least-cost route through a network.',
    picture: { src: shortestPath, width: 920, height: 424 },
  },
  'circle-equation': {
    name: 'The circle’s equation',
    formula: (
      <>
        (x − h)<sup>2</sup> + (y − k)<sup>2</sup> = r<sup>2</sup>
      </>
    ),
    line: 'A circle consists of points at distance r from its centre (h, k).',
    picture: { src: circleEquation, width: 920, height: 575 },
  },
  continuity: {
    name: 'Continuity',
    formula: 'No jump at the point',
    line: 'A continuous function has no break at the point under consideration.',
    picture: { src: continuity, width: 920, height: 249 },
  },
  'triangle-inequality': {
    name: 'The triangle inequality',
    formula: 'a + b > c',
    line: 'The sum of any two side lengths of a triangle must exceed the third.',
    picture: { src: triangleInequality, width: 920, height: 367 },
  },
  'fair-division': {
    name: 'Fair division',
    formula: 'Allocate without envy when possible',
    line: 'Fair-division methods aim to divide resources according to explicit fairness criteria.',
    picture: { src: fairDivision, width: 920, height: 575 },
  },
  infinity: {
    name: 'Infinity',
    formula: '∞ is not an ordinary number',
    line: 'Infinity describes unboundedness or infinite size, depending on context.',
    picture: { src: infinity, width: 920, height: 575 },
  },
  isoperimetric: {
    name: 'The isoperimetric idea',
    formula: 'Circle maximises area for fixed perimeter',
    line: 'Among plane shapes with a given perimeter, the circle encloses the greatest area.',
    picture: { src: isoperimetric, width: 920, height: 575 },
  },
}
