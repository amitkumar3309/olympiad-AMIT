/**
 * The Diwali edition's fireworks (owner, 2026-10-09: "more realistic and dynamic", popping "at
 * different random places", not the same spot every time).
 *
 * Rockets climb from the bottom of the screen at random places, slow as they rise, and burst at
 * random heights — a peony, a chrysanthemum that streaks, a ring seen at an angle, or a gold willow
 * that droops — then every spark falls under gravity, slows in the air, twinkles and fades. Two
 * colours to a burst now and then, a flash at the moment it opens, a crackle after some.
 *
 * Pure physics and drawing on a 2D canvas context, with no DOM: it runs in a worker on an
 * `OffscreenCanvas` (`worker.ts`), so it never takes time from the page's own thread, or on that
 * thread at a smaller budget where workers cannot draw (`start.ts`). Units are CSS pixels and
 * seconds; the context is scaled to the device's pixel ratio.
 */

export type FireworksContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Drawable = OffscreenCanvas | HTMLCanvasElement
export type MakeCanvas = (width: number, height: number) => Drawable

type Kind = 'peony' | 'chrysanthemum' | 'ring' | 'willow'

/** The festive colours, as hue/saturation/lightness — gold leads, as the diyas do. */
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [43, 96, 62], // gold
  [28, 96, 58], // marigold
  [352, 90, 62], // red
  [328, 88, 68], // pink
  [276, 82, 72], // violet
  [205, 92, 66], // blue
  [176, 82, 60], // cyan
  [130, 70, 60], // green
  [48, 40, 94], // white
]
const GOLD = 0
const WHITE = PALETTE.length - 1

/** How fast the trails left on the canvas fade: the share of a frame's light gone per 60th of a second. */
const TRAIL_FADE = 0.26
const ROCKET_GRAVITY = 250

interface Particle {
  x: number
  y: number
  /** Where it was last frame — a streaking spark is drawn there too. */
  px: number
  py: number
  vx: number
  vy: number
  age: number
  life: number
  /** Seconds before it appears at all — a crackle's pops wait for the burst to spread. */
  delay: number
  sprite: number
  size: number
  /** Air resistance: the share of speed lost per second, exponentially. */
  drag: number
  gravity: number
  twinkle: boolean
  streak: boolean
}

interface Rocket {
  x: number
  y: number
  vx: number
  vy: number
  delay: number
  kind: Kind
  colours: [number, number]
  sparkClock: number
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

/** A soft point of light in one colour: white at the core, the colour round it, fading out. */
function makeSprite(makeCanvas: MakeCanvas, [h, s, l]: readonly [number, number, number]): Drawable {
  const size = 64
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d') as FireworksContext | null
  if (!ctx) return canvas
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  glow.addColorStop(0, 'hsla(0, 0%, 100%, 1)')
  glow.addColorStop(0.18, `hsla(${h}, ${s}%, ${Math.min(l + 18, 96)}%, 1)`)
  glow.addColorStop(0.42, `hsla(${h}, ${s}%, ${l}%, 0.55)`)
  glow.addColorStop(1, `hsla(${h}, ${s}%, ${l}%, 0)`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  return canvas
}

export class Fireworks {
  private readonly ctx: FireworksContext
  private readonly canvas: { width: number; height: number }
  private readonly sprites: Drawable[]
  private rockets: Rocket[] = []
  private particles: Particle[] = []
  private width = 0
  private height = 0
  private untilLaunch = 0.4
  private budget: number
  private slowFrames = 0

  constructor(ctx: FireworksContext, makeCanvas: MakeCanvas, canvas: { width: number; height: number }, options: { budget: number }) {
    this.ctx = ctx
    this.canvas = canvas
    this.sprites = PALETTE.map((colour) => makeSprite(makeCanvas, colour))
    this.budget = options.budget
  }

  /** The screen's size in CSS pixels and the pixel ratio to draw at. Clears what was drawn. */
  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.canvas.width = Math.max(1, Math.round(width * dpr))
    this.canvas.height = Math.max(1, Math.round(height * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** A volley in quick succession — the salute as the intro hands the page over. */
  salute(count = 5): void {
    for (let i = 0; i < count; i++) this.launch(i * 0.22)
    this.untilLaunch = count * 0.22 + 0.8
  }

  /** Clears the canvas — when the tab is hidden, nothing should be left frozen on it. */
  clear(): void {
    this.rockets = []
    this.particles = []
    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.clearRect(0, 0, this.width, this.height)
  }

  /** One frame: `dt` seconds of physics, then drawing. Adapts its own budget to a slow device. */
  frame(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.05)
    // Thirty slow frames in a row — under ~22 a second, against the thirty it is driven at
    // (`driver.ts`) — and it draws fewer sparks.
    this.slowFrames = dt > 0.045 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1)
    if (this.slowFrames > 30) {
      this.budget = Math.max(200, Math.round(this.budget * 0.75))
      this.slowFrames = 0
    }
    this.update(step)
    this.draw(step)
  }

  private launch(delay = 0): void {
    if (this.width === 0) return
    const startY = this.height + 8
    // Bursts in the upper part of the screen, where a night sky is; anywhere across it.
    const apex = this.height * rand(0.1, 0.46)
    const first = Math.random() < 0.3 ? GOLD : Math.floor(Math.random() * PALETTE.length)
    const second = Math.random() < 0.35 ? Math.floor(Math.random() * PALETTE.length) : first
    const kind = pick<Kind>(['peony', 'peony', 'chrysanthemum', 'ring', 'willow'])
    this.rockets.push({
      x: this.width * rand(0.08, 0.92),
      y: startY,
      vx: rand(-24, 24),
      vy: -Math.sqrt(2 * ROCKET_GRAVITY * (startY - apex)),
      delay,
      kind,
      colours: kind === 'willow' ? [GOLD, GOLD] : [first, second],
      sparkClock: 0,
    })
  }

  private spark(particle: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'vx' | 'vy' | 'life' | 'sprite' | 'size'>): void {
    this.particles.push({
      px: particle.x,
      py: particle.y,
      age: 0,
      delay: 0,
      drag: 1.2,
      gravity: 70,
      twinkle: false,
      streak: false,
      ...particle,
    })
  }

  private burst(rocket: Rocket): void {
    const room = this.budget - this.particles.length
    if (room < 30) return
    const scale = Math.min(1, room / 110) * (this.width < 600 ? 0.72 : 1)
    const { x, y, kind } = rocket
    const colourOf = (i: number) => (i % 2 === 0 ? rocket.colours[0] : rocket.colours[1])

    // The flash at the moment it opens — brief, and no bigger than the burst's own heart.
    this.spark({ x, y, vx: 0, vy: 0, life: 0.15, sprite: WHITE, size: this.width < 600 ? 13 : 17, gravity: 0, drag: 0 })

    if (kind === 'ring') {
      const n = Math.round(54 * scale)
      const tilt = rand(0.35, 0.9)
      const speed = rand(120, 165)
      const turn = rand(0, Math.PI)
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2
        const rx = Math.cos(angle) * speed
        const ry = Math.sin(angle) * speed * tilt
        this.spark({
          x,
          y,
          vx: rx * Math.cos(turn) - ry * Math.sin(turn),
          vy: rx * Math.sin(turn) + ry * Math.cos(turn),
          life: rand(1.1, 1.5),
          sprite: colourOf(i),
          size: 2,
          drag: 1.0,
          gravity: 48,
          twinkle: Math.random() < 0.3,
        })
      }
      return
    }

    const shape = {
      peony: { n: 84, min: 30, max: 175, life: [1.1, 1.7], drag: 1.3, gravity: 72, size: 2.2, streak: false },
      chrysanthemum: { n: 66, min: 60, max: 190, life: [1.3, 1.9], drag: 1.1, gravity: 60, size: 1.8, streak: true },
      willow: { n: 72, min: 30, max: 125, life: [2.4, 3.2], drag: 2.0, gravity: 36, size: 1.9, streak: true },
    }[kind]
    const n = Math.round(shape.n * scale)
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2
      // The square root spreads the sparks through the sphere rather than piling them on its rim.
      const speed = shape.min + (shape.max - shape.min) * Math.sqrt(Math.random())
      this.spark({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: rand(shape.life[0]!, shape.life[1]!),
        sprite: colourOf(i),
        size: shape.size,
        drag: shape.drag,
        gravity: shape.gravity,
        twinkle: kind !== 'willow' && Math.random() < 0.35,
        streak: shape.streak,
      })
    }

    // A crackle after some: small white pops where the sparks have spread to.
    if (kind === 'peony' && Math.random() < 0.3) {
      const pops = Math.round(18 * scale)
      for (let i = 0; i < pops; i++) {
        const angle = Math.random() * Math.PI * 2
        const reach = rand(50, 120)
        this.spark({
          x: x + Math.cos(angle) * reach,
          y: y + Math.sin(angle) * reach + 30,
          vx: 0,
          vy: 0,
          life: 0.14,
          delay: rand(0.7, 1.05),
          sprite: WHITE,
          size: 2.6,
          gravity: 0,
          drag: 0,
        })
      }
    }
  }

  private update(dt: number): void {
    this.untilLaunch -= dt
    if (this.untilLaunch <= 0) {
      if (this.particles.length < this.budget * 0.8) {
        this.launch()
        // Now and then two go up together.
        if (Math.random() < 0.18) this.launch(rand(0.1, 0.35))
      }
      this.untilLaunch = rand(0.5, 1.45)
    }

    const climbing: Rocket[] = []
    for (const rocket of this.rockets) {
      if (rocket.delay > 0) {
        rocket.delay -= dt
        climbing.push(rocket)
        continue
      }
      rocket.vy += ROCKET_GRAVITY * dt
      rocket.x += rocket.vx * dt
      rocket.y += rocket.vy * dt
      // Its trail: small, short-lived gold sparks shed behind it.
      rocket.sparkClock += dt
      while (rocket.sparkClock > 1 / 55) {
        rocket.sparkClock -= 1 / 55
        this.spark({
          x: rocket.x + rand(-1.5, 1.5),
          y: rocket.y + rand(0, 4),
          vx: rand(-12, 12),
          vy: rand(10, 40),
          life: rand(0.3, 0.55),
          sprite: Math.random() < 0.5 ? GOLD : WHITE,
          size: 1.3,
          gravity: 50,
          drag: 2.5,
        })
      }
      if (rocket.vy >= -18) this.burst(rocket)
      else climbing.push(rocket)
    }
    this.rockets = climbing

    const alive: Particle[] = []
    for (const p of this.particles) {
      if (p.delay > 0) {
        p.delay -= dt
        alive.push(p)
        continue
      }
      p.age += dt
      if (p.age >= p.life) continue
      const slow = Math.exp(-p.drag * dt)
      p.px = p.x
      p.py = p.y
      p.vx *= slow
      p.vy = p.vy * slow + p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      alive.push(p)
    }
    this.particles = alive
  }

  private draw(dt: number): void {
    const c = this.ctx
    // Fade what is already there, so each spark leaves a short trail rather than a line.
    c.globalCompositeOperation = 'destination-out'
    c.globalAlpha = 1
    c.fillStyle = `rgba(0, 0, 0, ${1 - Math.pow(1 - TRAIL_FADE, dt * 60)})`
    c.fillRect(0, 0, this.width, this.height)

    // Light adds to light, as it does in a real sky.
    c.globalCompositeOperation = 'lighter'
    for (const p of this.particles) {
      if (p.delay > 0) continue
      const t = p.age / p.life
      let alpha = Math.pow(1 - t, 1.3)
      if (p.twinkle && t > 0.5) alpha *= 0.3 + Math.random() * 0.7
      if (alpha < 0.02) continue
      const sprite = this.sprites[p.sprite]!
      const size = p.size * 3.4 * (p.streak ? 1 : 1 - t * 0.35)
      c.globalAlpha = alpha
      c.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size)
      if (p.streak) {
        const tail = size * 0.7
        c.globalAlpha = alpha * 0.45
        c.drawImage(sprite, p.px - tail / 2, p.py - tail / 2, tail, tail)
      }
    }
    for (const rocket of this.rockets) {
      if (rocket.delay > 0) continue
      c.globalAlpha = 1
      c.drawImage(this.sprites[WHITE]!, rocket.x - 4, rocket.y - 4, 8, 8)
    }
    c.globalAlpha = 1
  }
}
