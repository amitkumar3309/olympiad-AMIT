import { api } from './client'
import type { StoredQuestionImage } from './types'
import { humanizeError } from '../lib/errors'
import { shrinkPicture } from '../lib/shrinkPicture'

/**
 * Stores one picture for a question (Milestone 30 Phase 7b — picture questions): shrunk in the
 * browser first (`lib/shrinkPicture.ts`), then `POST /admin/question-images`. Writes no question —
 * a question names the picture by its key when it is saved, and a picture nothing names is removed
 * by the server a day later.
 *
 * The question editor and the picture import both upload through this, so a picture is prepared
 * the same way whichever door it comes in by. A message rather than a throw for anything an author
 * can fix, to show beside the field or against the file.
 */
export async function uploadQuestionPicture(file: File): Promise<{ image: StoredQuestionImage } | { error: string }> {
  const shrunk = await shrinkPicture(file)
  if ('error' in shrunk) return shrunk
  try {
    const res = await api.post<{ image: StoredQuestionImage }>('/admin/question-images', { image: shrunk.picture.dataUrl })
    return { image: res.image }
  } catch (err) {
    return { error: humanizeError(err, { fallback: `${file.name} could not be uploaded. Please try again.` }) }
  }
}
