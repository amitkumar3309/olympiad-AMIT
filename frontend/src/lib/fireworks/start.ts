import { FireworksDriver, type FireworksMessage } from './driver'
import { Fireworks } from './engine'

/**
 * Starts the fireworks on a fresh canvas and returns how to stop them (the Diwali edition).
 *
 * In a worker wherever the browser lets a worker draw (`transferControlToOffscreen` — every
 * current browser on a phone), so none of it runs on the page's thread. Elsewhere, on the page's
 * thread at a smaller budget. Either way:
 *
 *  - **not while the intro plays** — it covers everything; the fireworks open with a salute as it
 *    hands the page over;
 *  - **not in a hidden tab** — paused and cleared, resumed when the tab is seen again;
 *  - **not while a tap is being answered** — from the moment a finger or a key goes down until
 *    the page has drawn its next frame, the fireworks hold still, so that frame never waits
 *    behind one of theirs. Measured on a slowed phone with motion on (the INP test's method):
 *    the slowest tap was 490–740 ms with the fireworks drawing straight through, about 290 ms
 *    with the hold — level with the night sky and no fireworks at all (230–280 ms). On a phone
 *    the hold lasts a frame or two, too short to see;
 *  - **the screen's size followed** — a phone's address bar changes it; drawn at no more than
 *    1.25 pixels to the point on a phone, 1.5 elsewhere: soft points of light lose nothing by it.
 *
 * Called from an effect only: it reads `window` and `document`, which a render may not.
 */
export function startFireworks(canvas: HTMLCanvasElement): () => void {
  const root = document.documentElement
  const small = Math.min(window.innerWidth, window.innerHeight) < 600
  const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.5)
  const size = () => ({ width: window.innerWidth, height: window.innerHeight, dpr })
  const introPlaying = () => root.hasAttribute('data-intro')
  const visible = () => document.visibilityState === 'visible'
  const running = visible() && !introPlaying()

  let send: (message: Exclude<FireworksMessage, { type: 'init' }>) => void
  let stopEngine: () => void

  if ('transferControlToOffscreen' in canvas && typeof Worker !== 'undefined') {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const offscreen = canvas.transferControlToOffscreen()
    const init: FireworksMessage = { type: 'init', canvas: offscreen, ...size(), budget: small ? 450 : 900, running }
    worker.postMessage(init, [offscreen])
    send = (message) => worker.postMessage(message)
    stopEngine = () => worker.terminate()
  } else {
    const ctx = canvas.getContext('2d')
    if (!ctx) return () => undefined
    const makeCanvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })
    const engine = new Fireworks(ctx, makeCanvas, canvas, { budget: small ? 220 : 420 })
    engine.resize(window.innerWidth, window.innerHeight, dpr)
    const driver = new FireworksDriver(engine, (callback) => requestAnimationFrame(callback), { running })
    send = (message) => driver.handle(message)
    stopEngine = () => driver.handle({ type: 'pause' })
  }

  let resizeTimer = 0
  const onResize = () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => send({ type: 'resize', ...size() }), 150)
  }
  const onVisibility = () => {
    if (introPlaying()) return
    send({ type: visible() ? 'resume' : 'pause' })
  }
  // Leaving the page stops the drawing first. Closing a page whose fireworks were still running took
  // 2–42 s in the browser tests (a tenth of a second without them); this brought the median from
  // about 9 s to about 3 s. A reader's reload was never slow (a quarter of a second). A page kept for
  // the back button goes on where it stopped when it is shown again.
  const onPageHide = () => send({ type: 'pause' })
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && visible() && !introPlaying()) send({ type: 'resume' })
  }
  // While an intro covers the page the fireworks wait, and its ending is the cue for the salute.
  // Watched throughout: the student area's intro begins after the fireworks have.
  const intro = new MutationObserver(() => {
    if (introPlaying()) send({ type: 'pause' })
    else if (visible()) send({ type: 'salute' })
  })
  intro.observe(root, { attributes: true, attributeFilter: ['data-intro'] })
  window.addEventListener('resize', onResize)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  document.addEventListener('visibilitychange', onVisibility)

  // Released once the page's next frame is drawn — an animation frame, then a task after it.
  // Should that frame never come (a tab that is not being drawn), the hold ends by itself.
  const inputs = ['pointerdown', 'pointerup', 'keydown', 'keyup'] as const
  const onInput = () => {
    send({ type: 'hold' })
    requestAnimationFrame(() => setTimeout(() => send({ type: 'release' }), 0))
  }
  for (const name of inputs) window.addEventListener(name, onInput, { capture: true, passive: true })

  return () => {
    window.clearTimeout(resizeTimer)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
    document.removeEventListener('visibilitychange', onVisibility)
    for (const name of inputs) window.removeEventListener(name, onInput, true)
    intro.disconnect()
    stopEngine()
  }
}
