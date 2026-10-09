import { useState } from 'react'
import type { PictureView } from '../api/types'
import { Button, Modal } from './ui'
import styles from './QuestionPicture.module.css'

/**
 * A question's picture, wherever the question is shown (Milestone 30 Phase 7b — picture
 * questions, PLAN.md Q19): practice, mock tests, the Olympiad, the Daily Quiz, the archive, the
 * homepage's past problems and the staff pages.
 *
 * The width and height are the stored file's, so the box is reserved before the picture arrives
 * and nothing under it jumps when it does. The description is the `alt`: for a student who cannot
 * see the picture it **is** the question. A scanned question can be small at phone width, so it
 * can be enlarged — in a dialog, keeping the student's place on the page.
 *
 * It renders nothing for a question without a picture, so a caller can pass the field as it is.
 */
export interface QuestionPictureProps {
  picture: PictureView | null | undefined
  /** What it is, for the enlarge control and the dialog: "the question", "the solution". */
  name?: string
  /** Said instead of an empty description. Only a solution picture's description is optional. */
  fallbackAlt?: string
  /** Fetch at once (the question being answered) rather than when scrolled near (a solution below). */
  eager?: boolean
  className?: string
}

export default function QuestionPicture({
  picture,
  name = 'the picture',
  fallbackAlt = 'A picture with this question',
  eager = false,
  className,
}: QuestionPictureProps) {
  const [open, setOpen] = useState(false)
  if (!picture) return null

  const alt = picture.alt.trim() || fallbackAlt
  return (
    <div className={[styles.picture, className].filter(Boolean).join(' ')}>
      <img
        className={styles.image}
        src={picture.url}
        alt={alt}
        width={picture.width}
        height={picture.height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
      <Button type="button" variant="link" size="sm" icon="ph-magnifying-glass-plus" onClick={() => setOpen(true)}>
        Enlarge {name}
      </Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={`${name.charAt(0).toUpperCase()}${name.slice(1)}, enlarged`} size="lg">
          <div className={styles.enlarged}>
            <img src={picture.url} alt={alt} width={picture.width} height={picture.height} />
          </div>
        </Modal>
      )}
    </div>
  )
}
