import { useId, type ReactNode } from 'react'
import Icon from './Icon'
import { FieldContext } from './fieldContext'
import styles from './Field.module.css'

/**
 * A labelled form field: label, control, hint, error.
 *
 * ## Why a component rather than a convention
 *
 * "Every form must have proper labels, required-field indicators, validation and
 * clear errors" is a rule that cannot be enforced by review across twenty-nine pages.
 * Here it is enforced by construction: `label` is a required prop, so a field cannot
 * be built without one. A placeholder is not a label — it disappears the moment
 * anybody types, which leaves a partially-filled form with no way to tell what the
 * boxes were for.
 *
 * ## The required marker
 *
 * A red asterisk alone is colour-only information and unpronounceable. The marker
 * carries a visually-hidden "(required)" for a screen reader, and the control itself
 * gets a real `required` attribute through the field context — so the browser, the
 * assistive technology and the eye all get told the same thing.
 *
 * `optional` renders the inverse hint, for the case worth being explicit about: a form
 * where most fields are required and one is not.
 */

export interface FieldProps {
  label: ReactNode
  children: ReactNode
  /**
   * A fixed id for the control, instead of the generated one.
   *
   * Needed when something outside the field has to reach it — an error summary that
   * focuses the first invalid field, a "jump to" link. It replaces the generated id
   * everywhere at once (the label's `htmlFor`, the context the control reads), so the
   * association cannot come apart: passing an `id` to the control directly *would*
   * break it, because the label would still point at the generated one.
   */
  id?: string
  /** Guidance shown under the control. Persistent, unlike a placeholder. */
  hint?: ReactNode
  /** A validation message. Its presence is what makes the field invalid. */
  error?: ReactNode
  required?: boolean
  optional?: boolean
  /** Hide the label visually but keep it for assistive technology. Use sparingly —
      a search box with an adjacent icon is the honest case. */
  hideLabel?: boolean
  className?: string
}

export default function Field({
  label,
  children,
  hint,
  error,
  required,
  optional,
  hideLabel,
  className,
  id,
}: FieldProps) {
  const generated = useId()
  const base = id ?? generated
  const controlId = id ?? `${generated}-control`
  const hintId = `${base}-hint`
  const errorId = `${base}-error`

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <FieldContext.Provider
      value={{
        id: controlId,
        describedBy: describedBy || undefined,
        invalid: Boolean(error),
        required: Boolean(required),
      }}
    >
      <div className={[styles.field, className].filter(Boolean).join(' ')}>
        <label className={hideLabel ? styles.labelHidden : styles.label} htmlFor={controlId}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          )}
          {required && <span className="sr-only"> (required)</span>}
          {optional && <span className={styles.optional}>optional</span>}
        </label>

        {children}

        {hint && (
          <p className={styles.hint} id={hintId}>
            {hint}
          </p>
        )}

        {/*
          The error is a polite live region rather than an assertive one. A form
          typically reveals several at once on submit; three assertive regions
          interrupt each other and the reader hears fragments of each.
        */}
        {error && (
          <p className={styles.error} id={errorId} aria-live="polite">
            <Icon name="ph-warning-circle" weight="bold" size="sm" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}
