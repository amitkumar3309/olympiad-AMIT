/**
 * Makes the site's icons and its share card (Milestone 30, Phase 6 — brief §10).
 *
 *   node scripts/make-brand-images.ts        # from frontend/; needs Microsoft Edge
 *
 * Writes into `public/`, and the files are committed — this runs when the brand changes,
 * not on every build:
 *
 *  - `favicon.ico` (16, 32 and 48 inside), `favicon-16.png`, `favicon-32.png`
 *  - `apple-touch-icon.png` (180) and `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
 *    for `manifest.json`
 *  - `og-image.jpg`, the 1200×630 card a shared link shows
 *  - `src/assets/logo-mark.webp` — the header and footer mark, 144px square (3× its 48px slot),
 *    from `logo-mark.png` (made by `crop-logo-mark.cjs`): the PNG is 56 KB at 256px
 *
 * Everything is drawn from the emblem in `src/assets/logo.png` and the words in
 * `src/lib/brand.ts`, in the self-hosted brand font, by the installed Edge (Playwright), so
 * nothing new is installed. The icons replaced a 1 MB PNG (`favicon.ico.png`, the whole
 * 1254px lockup) that every visit downloaded as its favicon.
 *
 * The share card says only what the homepage already says. It does not print the domain,
 * which is still to be confirmed (`SITE_URL` in brand.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { AMIT_COMPETITION_YEAR, AMIT_FULL_FORM, AMIT_OLYMPIAD, AMIT_TAGLINE } from '../src/lib/brand.ts'

const root = new URL('../', import.meta.url)
const publicFile = (name: string) => fileURLToPath(new URL(`public/${name}`, root))
const asDataUrl = (path: string, type: string) =>
  `data:${type};base64,${readFileSync(fileURLToPath(new URL(path, root))).toString('base64')}`

const LOGO = asDataUrl('src/assets/logo.png', 'image/png')
const MARK = asDataUrl('src/assets/logo-mark.png', 'image/png')
const MARK_SIZE = 144
const FONT = asDataUrl('public/fonts/plus-jakarta-sans-latin-wght-5.3.0.woff2', 'font/woff2')

/** The emblem's bounding box in the 1254×1254 `logo.png`, measured: everything above the wordmark. */
const EMBLEM = { x: 294, y: 56, width: 665, height: 627 }

// The brand's colours — tokens.css's `--ink-50` (the page), `--ink-900` (the ink),
// `--royal-600` (blue for words) and `--orange-500`. A script cannot read a CSS token.
const PAGE = '#f4f8fe'
const INK = '#0b1533'
const BLUE = '#154fd0'
const ORANGE = '#e8622f'

interface Icon {
  file: string
  size: number
  /** How much of the square the emblem's longer side takes. */
  fill: number
  /** Corner radius of the white tile, as a share of the size; 0 is a full square. */
  radius: number
}

const ICONS: Icon[] = [
  { file: 'favicon-16.png', size: 16, fill: 0.96, radius: 0.2 },
  { file: 'favicon-32.png', size: 32, fill: 0.94, radius: 0.2 },
  { file: 'favicon-48.png', size: 48, fill: 0.92, radius: 0.2 },
  // iOS draws its own rounded corners, so the touch icon is a full square.
  { file: 'apple-touch-icon.png', size: 180, fill: 0.8, radius: 0 },
  { file: 'icon-192.png', size: 192, fill: 0.84, radius: 0.18 },
  { file: 'icon-512.png', size: 512, fill: 0.84, radius: 0.18 },
  // Maskable: the platform crops to a shape inside the middle 80%, so the emblem stays well within it.
  { file: 'icon-maskable-512.png', size: 512, fill: 0.62, radius: 0 },
]

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const CARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Brand'; src: url('${FONT}') format('woff2'); font-weight: 200 800; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: ${PAGE}; font-family: 'Brand', sans-serif; color: ${INK};
  display: flex; align-items: center; gap: 56px; padding: 0 64px; }
.tile { flex: 0 0 340px; height: 340px; border-radius: 44px; background: #ffffff; border: 2px solid #e6ecf5;
  box-shadow: 0 24px 48px rgba(11, 21, 51, 0.10); display: grid; place-items: center; }
canvas { width: 290px; height: 290px; }
.text { display: grid; gap: 18px; min-width: 0; }
.name { font-size: 72px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.02; }
.name .year { color: ${BLUE}; }
.full { font-size: 28px; font-weight: 600; color: ${BLUE}; text-wrap: balance; }
.line { font-size: 24px; font-weight: 500; line-height: 1.35; text-wrap: balance; }
.tagline { margin-top: 10px; font-size: 22px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${ORANGE}; }
</style></head><body>
<div class="tile"><canvas id="emblem" width="640" height="640"></canvas></div>
<div class="text">
  <div class="name">${escapeHtml(AMIT_OLYMPIAD)} <span class="year">${escapeHtml(AMIT_COMPETITION_YEAR)}</span></div>
  <div class="full">${escapeHtml(AMIT_FULL_FORM)}</div>
  <div class="line">A national-level mathematics olympiad<br>for Class 3 to Class 12</div>
  <div class="line">Free practice, mock tests and a Daily Quiz with prizes</div>
  <div class="tagline">${escapeHtml(AMIT_TAGLINE)}</div>
</div>
</body></html>`

/** A `.ico` holding PNG images — every browser since IE 11 reads PNG entries. */
function packIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

const browser = await chromium.launch({ channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.setContent(CARD_HTML)

  // Every icon, drawn on a canvas from the emblem.
  const pngs = await page.evaluate(
    async ({ logo, emblem, icons }) => {
      const image = new Image()
      image.src = logo
      await image.decode()
      const drawn: Record<string, string> = {}
      for (const icon of icons) {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = icon.size
        const g = canvas.getContext('2d')!
        g.imageSmoothingQuality = 'high'
        g.fillStyle = '#ffffff'
        g.beginPath()
        g.roundRect(0, 0, icon.size, icon.size, icon.size * icon.radius)
        g.fill()
        const scale = (icon.size * icon.fill) / Math.max(emblem.width, emblem.height)
        const w = emblem.width * scale
        const h = emblem.height * scale
        g.drawImage(image, emblem.x, emblem.y, emblem.width, emblem.height, (icon.size - w) / 2, (icon.size - h) / 2, w, h)
        drawn[icon.file] = canvas.toDataURL('image/png').split(',')[1]!
      }
      // The share card's emblem, on the white tile already in the page.
      const card = document.getElementById('emblem') as HTMLCanvasElement
      const g = card.getContext('2d')!
      g.imageSmoothingQuality = 'high'
      const scale = card.width / Math.max(emblem.width, emblem.height)
      const w = emblem.width * scale
      const h = emblem.height * scale
      g.drawImage(image, emblem.x, emblem.y, emblem.width, emblem.height, (card.width - w) / 2, (card.height - h) / 2, w, h)
      return drawn
    },
    { logo: LOGO, emblem: EMBLEM, icons: ICONS },
  )

  const buffers = new Map(Object.entries(pngs).map(([file, base64]) => [file, Buffer.from(base64, 'base64')]))
  for (const [file, png] of buffers) {
    if (file === 'favicon-48.png') continue // only inside favicon.ico
    writeFileSync(publicFile(file), png)
  }
  writeFileSync(
    publicFile('favicon.ico'),
    packIco([16, 32, 48].map((size) => ({ size, png: buffers.get(`favicon-${size}.png`)! }))),
  )

  const mark = await page.evaluate(
    async ({ src, size }) => {
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const g = canvas.getContext('2d')!
      g.imageSmoothingQuality = 'high'
      g.drawImage(image, 0, 0, size, size)
      return canvas.toDataURL('image/webp', 0.9).split(',')[1]!
    },
    { src: MARK, size: MARK_SIZE },
  )
  writeFileSync(fileURLToPath(new URL('src/assets/logo-mark.webp', root)), Buffer.from(mark, 'base64'))

  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: publicFile('og-image.jpg'), type: 'jpeg', quality: 90 })

  console.log(`Wrote favicon.ico, ${ICONS.filter((icon) => icon.file !== 'favicon-48.png').map((icon) => icon.file).join(', ')} and og-image.jpg to public/, and src/assets/logo-mark.webp.`)
} finally {
  await browser.close()
}
