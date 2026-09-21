/*
 * Builds `assets/logo-mark.png` — the navbar's circular mark — from `assets/logo.png`.
 *
 * Measured bands in logo.png (1254x1254), top to bottom:
 *   y   56- 682  the emblem            <- the only band that survives
 *   y  704- 940  the "AMIT" wordmark
 *   y  981-1017  "ADVANCED MATHEMATICS & INTELLIGENCE TEST"
 *   y 1054-1071  the divider rule
 *   y 1097-1159  "Think Beyond Numbers"
 *
 * Only the first band is kept, because none of the other four is legible at the ~48px
 * the navbar renders it at — the wordmark would be 8px tall and the expansion about one.
 * The navbar pairs this mark with real text instead. `logo.png` itself is untouched and
 * is still what the printed certificate uses.
 *
 * ## Why this PADS rather than crops
 *
 * The navbar clips the mark to a circle (`border-radius: 50%`), so every drawn pixel has
 * to sit inside the inscribed circle or it is sliced off. Measured, the emblem's minimal
 * enclosing circle is **radius 371 about (622, 372)** — wider than the ring itself, whose
 * equator at y=382..386 spans x 294..958, because the star clears the ring at the top
 * right and the book clears it at the bottom. A square crop tight to the emblem would
 * therefore cut both.
 *
 * So the emblem is composited onto a larger white square: CANVAS is sized from that
 * measured radius plus a margin, which leaves the ring at ~85% of the plate diameter —
 * the artwork's own circle sitting inside the plate's circle like a coin, and nothing
 * touching the edge. A tighter canvas clips; a looser one shrinks the mark for nothing.
 *
 * Deliberately dependency-free (node's own zlib, a hand-rolled PNG reader/writer) so
 * regenerating the asset does not add a build-time image library to a frontend that has
 * none. **`.cjs`, not `.js`** — `frontend/package.json` sets `"type": "module"`, which
 * applies to every `.js` file under it however it is invoked, and `require` is a syntax
 * error there. Run from the repo root:
 *
 *   node frontend/scripts/crop-logo-mark.cjs frontend/src/assets/logo.png \
 *        frontend/src/assets/logo-mark.png
 */
const fs = require('fs')
const zlib = require('zlib')

const SRC = process.argv[2]
const OUT = process.argv[3]
const OUT_SIZE = 256

/** The emblem's bounding box in the source, measured. */
const EMB = { x0: 294, y0: 56, x1: 958, y1: 682 }
/** The centre of its minimal enclosing circle, measured (radius 371). */
const CIRCLE = { cx: 622, cy: 372, r: 371 }
/**
 * Clear air between the outermost ink and the plate edge, as a multiple of the
 * measured circle. 1.08 leaves ~1.8px of white at the 48px the navbar draws it at:
 * enough that the star tip reads as inside the plate rather than touching it, without
 * shrinking the mark — the ring still lands at 83% of the plate, the same on-screen
 * size the square version had at 95% of a smaller plate.
 */
const CANVAS = Math.round(CIRCLE.r * 2 * 1.08)

// --- decode ---------------------------------------------------------------
const b = fs.readFileSync(SRC)
const W = b.readUInt32BE(16)
const H = b.readUInt32BE(20)
if (b[24] !== 8 || b[25] !== 2) throw new Error('expected 8-bit RGB')
let p = 8
const idat = []
while (p < b.length) {
  const len = b.readUInt32BE(p)
  const type = b.toString('ascii', p + 4, p + 8)
  if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len))
  p += 12 + len
}
const rawz = zlib.inflateSync(Buffer.concat(idat))
const bpp = 3
const stride = W * bpp
const img = Buffer.alloc(H * stride)
let o = 0
for (let y = 0; y < H; y++) {
  const f = rawz[o++]
  const line = rawz.subarray(o, o + stride)
  o += stride
  const cur = img.subarray(y * stride, (y + 1) * stride)
  const prev = y ? img.subarray((y - 1) * stride, y * stride) : null
  for (let x = 0; x < stride; x++) {
    const A = x >= bpp ? cur[x - bpp] : 0
    const B = prev ? prev[x] : 0
    const C = x >= bpp && prev ? prev[x - bpp] : 0
    let v = line[x]
    if (f === 1) v += A
    else if (f === 2) v += B
    else if (f === 3) v += (A + B) >> 1
    else if (f === 4) {
      const pa = Math.abs(B - C), pb = Math.abs(A - C), pc = Math.abs(A + B - 2 * C)
      v += pa <= pb && pa <= pc ? A : pb <= pc ? B : C
    }
    cur[x] = v & 255
  }
}

// --- composite the emblem onto a white square, centred on the circle ------
const cStride = CANVAS * 3
const canvas = Buffer.alloc(CANVAS * cStride, 0xff)
const half = CANVAS / 2
// Offset so the measured circle centre lands on the canvas centre.
const dx = Math.round(half - (CIRCLE.cx - EMB.x0))
const dy = Math.round(half - (CIRCLE.cy - EMB.y0))
if (dx < 0 || dy < 0 || dx + (EMB.x1 - EMB.x0) >= CANVAS || dy + (EMB.y1 - EMB.y0) >= CANVAS) {
  throw new Error('emblem does not fit the canvas — CANVAS is too small')
}
for (let y = EMB.y0; y <= EMB.y1; y++) {
  const srcOff = y * stride + EMB.x0 * 3
  const dstOff = (y - EMB.y0 + dy) * cStride + (dx * 3)
  img.copy(canvas, dstOff, srcOff, srcOff + (EMB.x1 - EMB.x0 + 1) * 3)
}

// --- box-filter downsample -------------------------------------------------
const out = Buffer.alloc(OUT_SIZE * OUT_SIZE * 3)
const scale = CANVAS / OUT_SIZE
for (let oy = 0; oy < OUT_SIZE; oy++) {
  const sy0 = Math.floor(oy * scale)
  const sy1 = Math.min(CANVAS - 1, Math.floor((oy + 1) * scale) - 1)
  for (let ox = 0; ox < OUT_SIZE; ox++) {
    const sx0 = Math.floor(ox * scale)
    const sx1 = Math.min(CANVAS - 1, Math.floor((ox + 1) * scale) - 1)
    let r = 0, g = 0, bl = 0, n = 0
    for (let sy = sy0; sy <= sy1; sy++) {
      for (let sx = sx0; sx <= sx1; sx++) {
        const i = sy * cStride + sx * 3
        r += canvas[i]; g += canvas[i + 1]; bl += canvas[i + 2]; n++
      }
    }
    const j = (oy * OUT_SIZE + ox) * 3
    out[j] = Math.round(r / n); out[j + 1] = Math.round(g / n); out[j + 2] = Math.round(bl / n)
  }
}

// --- encode ----------------------------------------------------------------
const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(OUT_SIZE, 0); ihdr.writeUInt32BE(OUT_SIZE, 4)
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
const oStride = OUT_SIZE * 3
const scan = Buffer.alloc(OUT_SIZE * (oStride + 1))
for (let y = 0; y < OUT_SIZE; y++) {
  scan[y * (oStride + 1)] = 0
  out.copy(scan, y * (oStride + 1) + 1, y * oStride, (y + 1) * oStride)
}
fs.writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(scan, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]))

// --- report: nothing may fall outside the inscribed circle -----------------
let worst = 0
const c = (OUT_SIZE - 1) / 2
for (let y = 0; y < OUT_SIZE; y++) {
  for (let x = 0; x < OUT_SIZE; x++) {
    const i = (y * OUT_SIZE + x) * 3
    if (out[i] < 230 || out[i + 1] < 230 || out[i + 2] < 230) {
      const d = Math.hypot(x - c, y - c)
      if (d > worst) worst = d
    }
  }
}
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes,', OUT_SIZE + 'x' + OUT_SIZE)
console.log('canvas', CANVAS, '| furthest ink from centre', worst.toFixed(1), 'of', c.toFixed(1),
  '=', ((worst / c) * 100).toFixed(1) + '% of the radius', worst <= c ? '(fits)' : '(CLIPPED)')
