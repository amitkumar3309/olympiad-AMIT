import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { uploadQuestionPicture } from '../api/questionImages'
import { PICTURE_ACCEPT_ATTRIBUTE } from '../lib/shrinkPicture'
import { Button, Field, Input } from './ui'
import styles from './QuestionPictureField.module.css'

/**
 * Attaching a picture to a question (Milestone 30 Phase 7b — picture questions, PLAN.md Q19):
 * the question as a picture, or its worked solution as one. Used by the question editor and the
 * picture import's review cards.
 *
 * A picture is uploaded **on its own** the moment it is chosen (`api/questionImages.ts`: shrunk in
 * the browser, then stored) and the question names it by key when it is saved. So saving a question
 * stays a small request, and a picture nobody saves is cleared by the server a day later. Uploading
 * writes no question.
 *
 * The description is asked for beside the picture, because for a student who cannot see it the
 * description **is** the question. It is required for the question's picture and optional for the
 * solution's; the server holds that rule, and this field only shows where to write it.
 */

/** A picture being authored: the stored file, and the description the author is writing. */
export interface PictureDraft {
  key: string
  url: string
  width: number
  height: number
  alt: string
}

export interface QuestionPictureFieldProps {
  /** "Picture of the question", "Picture of the worked solution". */
  label: string
  hint?: ReactNode
  value: PictureDraft | null
  onChange: (next: PictureDraft | null) => void
  /** Whether the description is required — it is for the question's picture. */
  describeRequired: boolean
  /** Guidance under the description. */
  describeHint?: ReactNode
  disabled?: boolean
}

export default function QuestionPictureField({
  label,
  hint,
  value,
  onChange,
  describeRequired,
  describeHint,
  disabled = false,
}: QuestionPictureFieldProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Cleared at once, so choosing the same file again (after an error) is still a change.
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    const result = await uploadQuestionPicture(file)
    setBusy(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    const { key, url, width, height } = result.image
    // A replaced picture keeps the description written for it: the author is usually swapping a
    // better scan of the same question.
    onChange({ key, url, width, height, alt: value?.alt ?? '' })
  }

  return (
    <fieldset className={styles.field} disabled={disabled}>
      <legend className={styles.legend}>{label}</legend>
      {hint && <p className={styles.hint}>{hint}</p>}

      {value && (
        <img
          className={styles.preview}
          src={value.url}
          alt={value.alt.trim() || 'The chosen picture, not yet described'}
          width={value.width}
          height={value.height}
        />
      )}

      <div className={styles.actions}>
        {/* Hidden, and opened by the button: one control for a reader, with the button's name. */}
        <input ref={fileInput} type="file" accept={PICTURE_ACCEPT_ATTRIBUTE} hidden onChange={(event) => void onChosen(event)} />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon="ph-image"
          loading={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? 'Uploading…' : value ? 'Replace the picture' : 'Choose a picture'}
        </Button>
        {value && !busy && (
          <Button type="button" variant="ghost" size="sm" icon="ph-trash" onClick={() => onChange(null)}>
            Remove the picture
          </Button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.hint}>JPEG, PNG or WebP. It is made smaller before it is uploaded, so a phone photograph is fine.</p>

      {value && (
        <Field
          label="Describe the picture"
          required={describeRequired}
          optional={!describeRequired}
          hint={describeHint ?? 'One line, read aloud instead of the picture.'}
        >
          <Input value={value.alt} maxLength={300} onChange={(event) => onChange({ ...value, alt: event.target.value })} />
        </Field>
      )}
    </fieldset>
  )
}
