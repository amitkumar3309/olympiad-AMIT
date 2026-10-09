import type { Fireworks } from './engine'

/** What the page tells the fireworks — by message to a worker, or directly on the page's own thread. */
export type FireworksMessage =
  | { type: 'init'; canvas: OffscreenCanvas; width: number; height: number; dpr: number; budget: number; running: boolean }
  | { type: 'resize'; width: number; height: number; dpr: number }
  /** The tab is hidden, or the intro covers the page: stop, and clear. */
  | { type: 'pause' }
  | { type: 'resume' }
  /** The intro has handed the page over. */
  | { type: 'salute' }
  /** A tap or a key is waiting for its answer to be drawn: draw nothing until it has been. */
  | { type: 'hold' }
  | { type: 'release' }

/** The longest a tap may hold the fireworks still, should the page never say its frame was drawn. */
const HOLD_MS = 400

/**
 * Thirty frames a second, not sixty: soft points of light with trails lose nothing a reader can
 * see, and the whole browser's work drops by a tenth to a third — measured, motion on, on the
 * homepage during the edition: 205–209% of a core at 390px and 306–315% at 1280px at sixty;
 * 157–188% and 220–282% at thirty. A week of a phone's battery is what that buys back.
 */
const FRAME_MS = 1000 / 30

/**
 * Runs the fireworks' frames (the Diwali edition): never while they are paused or held, never two
 * loops at once, and never more than thirty a second. The same in a worker and on the page's
 * thread, so the two cannot behave differently.
 */
export class FireworksDriver {
  private readonly engine: Fireworks
  private readonly nextFrame: (callback: (time: number) => void) => void
  private paused: boolean
  private held = false
  private looping = false
  /** Which loop is the live one: a frame asked for by a stopped loop finds itself stale. */
  private run = 0
  private holdTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    engine: Fireworks,
    nextFrame: (callback: (time: number) => void) => void,
    options: { running: boolean },
  ) {
    this.engine = engine
    this.nextFrame = nextFrame
    this.paused = !options.running
    this.update()
  }

  handle(message: Exclude<FireworksMessage, { type: 'init' }>): void {
    switch (message.type) {
      case 'resize':
        this.engine.resize(message.width, message.height, message.dpr)
        break
      case 'pause':
        this.paused = true
        this.engine.clear()
        break
      case 'resume':
        this.paused = false
        break
      case 'salute':
        this.engine.salute()
        this.paused = false
        break
      case 'hold':
        this.held = true
        clearTimeout(this.holdTimer)
        this.holdTimer = setTimeout(() => this.handle({ type: 'release' }), HOLD_MS)
        break
      case 'release':
        this.held = false
        clearTimeout(this.holdTimer)
        break
    }
    this.update()
  }

  private update(): void {
    if (this.paused || this.held) {
      this.looping = false
      return
    }
    if (this.looping) return
    this.looping = true
    const mine = ++this.run
    let last = 0
    const loop = (time: number) => {
      if (!this.looping || mine !== this.run) return
      // A frame that comes too soon is skipped, not drawn (2 ms of slack for a timer's jitter).
      if (last && time - last < FRAME_MS - 2) {
        this.nextFrame(loop)
        return
      }
      this.engine.frame(last ? (time - last) / 1000 : 1 / 60)
      last = time
      this.nextFrame(loop)
    }
    this.nextFrame(loop)
  }
}
