/**
 * A question's picture, made small enough to upload (Milestone 30 Phase 7b — picture questions).
 *
 * A phone photograph is 3–8 MB and 4,000 pixels across, and every student who meets the question
 * downloads whatever is stored — on the Daily Quiz, after their clock has started. So every picture
 * is redrawn here, at most `MAX_PICTURE_SIDE` pixels on its longer side, and re-encoded as WebP
 * (JPEG where the browser cannot write WebP): typically 50–150 KB. Redrawing also drops whatever
 * metadata rode inside the file; the server strips it again regardless (`backend/src/lib/imageFile.ts`),
 * because it does not trust that this ran.
 *
 * Drawn on a white page: a diagram saved with a transparent background would otherwise lose its
 * black lines against the dark theme's cards.
 *
 * The browser applies the orientation a phone records in the file when it decodes an `<img>`, so a
 * portrait photograph stays portrait once that record is gone.
 */

export const MAX_PICTURE_SIDE = 1600
/** The server's ceiling (`MAX_QUESTION_IMAGE_BYTES`, 1 MB). A stale copy can only be stricter. */
export const MAX_PICTURE_BYTES = 1024 * 1024
export const ACCEPTED_PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PICTURE_ACCEPT_ATTRIBUTE = ACCEPTED_PICTURE_TYPES.join(',')

/** What the upload sends: a `data:image/…;base64,…` URL, as every upload here does. */
export interface ShrunkPicture {
  dataUrl: string
  width: number
  height: number
  bytes: number
}

/** Smaller and smaller, until it fits: almost every picture fits at the first size. */
const SIDES = [MAX_PICTURE_SIDE, 1200, 900]

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The picture could not be read.'))
    reader.readAsDataURL(blob)
  })
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** One size: WebP where the browser writes it, JPEG where it does not (a WebP request answered with a PNG). */
async function encode(image: HTMLImageElement, width: number, height: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const webp = await toBlob(canvas, 'image/webp', 0.85)
  if (webp && webp.type === 'image/webp') return webp
  return toBlob(canvas, 'image/jpeg', 0.88)
}

/**
 * Reads a chosen file and returns it shrunk for upload — or a message for the two failures an
 * author can fix (the wrong kind of file, a picture still too large), to show beside the field.
 */
export async function shrinkPicture(file: File): Promise<{ picture: ShrunkPicture } | { error: string }> {
  if (!ACCEPTED_PICTURE_TYPES.includes(file.type)) {
    return { error: `${file.name} is not a JPEG, PNG or WebP picture.` }
  }

  let image: HTMLImageElement
  try {
    image = await decode(file)
  } catch {
    return { error: `${file.name} could not be opened as a picture. Save it again as a JPEG or PNG and choose that.` }
  }

  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (!naturalWidth || !naturalHeight) return { error: `${file.name} has no size — it may be damaged.` }

  for (const side of SIDES) {
    const scale = Math.min(1, side / Math.max(naturalWidth, naturalHeight))
    const width = Math.max(1, Math.round(naturalWidth * scale))
    const height = Math.max(1, Math.round(naturalHeight * scale))
    const blob = await encode(image, width, height)
    if (!blob) return { error: 'This browser could not prepare the picture. Try another browser.' }
    if (blob.size <= MAX_PICTURE_BYTES) {
      return { picture: { dataUrl: await readAsDataUrl(blob), width, height, bytes: blob.size } }
    }
  }
  return { error: `${file.name} is still over 1 MB once shrunk. Crop it closer to the question and choose it again.` }
}
