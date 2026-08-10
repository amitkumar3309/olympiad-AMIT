/**
 * Reading and pre-validating a chosen photo file.
 *
 * The registration wizard and the profile page both need this, and both must apply
 * the *same* limits as the backend or the student meets a server error where a clear
 * message belongs. These constants are deliberately duplicated from
 * `backend/src/models/StudentPhoto.ts` rather than fetched: the backend's check is
 * the one that actually enforces anything (it also verifies the file's magic bytes,
 * which a browser cannot be trusted to report), so a stale copy here can only ever
 * make the client stricter, never the API looser.
 */

/** Kept in step with the backend's `MAX_PHOTO_BYTES`. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024
export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PHOTO_ACCEPT_ATTRIBUTE = ACCEPTED_PHOTO_TYPES.join(',')

export interface SelectedPhoto {
  /** A `data:image/...;base64,...` URL, which is what the API expects in JSON. */
  dataUrl: string
  name: string
  size: number
}

/** Reads a chosen file into the base64 data URL the API expects. */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Validates and reads a file chosen from an `<input type="file">`.
 *
 * Returns a message instead of throwing for the two failures a student can actually
 * cause and fix — wrong type, too large — so the caller can put it straight on the
 * form next to the field.
 */
export async function readPhotoFile(file: File): Promise<{ photo: SelectedPhoto } | { error: string }> {
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
    return { error: 'The photo must be a JPEG, PNG or WebP image.' }
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: `The photo must be ${Math.round(MAX_PHOTO_BYTES / 1024)} KB or smaller.` }
  }

  try {
    const dataUrl = await readAsDataUrl(file)
    return { photo: { dataUrl, name: file.name, size: file.size } }
  } catch {
    return { error: 'Could not read that file. Please choose it again.' }
  }
}

/** Human-readable file size, for showing what was selected. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
