import { FireworksDriver, type FireworksMessage } from './driver'
import { Fireworks } from './engine'

/**
 * The fireworks' own thread (the Diwali edition). The page hands it its canvas once
 * (`transferControlToOffscreen`) and then only says when the screen changes size, when to pause,
 * hold and go on, and when to fire a salute — so all of the physics and drawing happen here, and
 * a tap on the page never waits behind a frame of sparks being worked out.
 */

/** What a worker's global scope offers this file — typed here because the app's types are the page's. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FireworksMessage>) => void) | null
  requestAnimationFrame?: (callback: (time: number) => void) => number
}

function nextFrame(callback: (time: number) => void): void {
  if (scope.requestAnimationFrame) scope.requestAnimationFrame(callback)
  else setTimeout(() => callback(performance.now()), 16)
}

let driver: FireworksDriver | null = null

scope.onmessage = (event) => {
  const message = event.data
  if (message.type !== 'init') {
    driver?.handle(message)
    return
  }
  const ctx = message.canvas.getContext('2d')
  if (!ctx) return
  const engine = new Fireworks(ctx, (w, h) => new OffscreenCanvas(w, h), message.canvas, { budget: message.budget })
  engine.resize(message.width, message.height, message.dpr)
  driver = new FireworksDriver(engine, nextFrame, { running: message.running })
}
