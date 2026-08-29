import { useState } from 'react'
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import Icon from './Icon'
import { useFieldContext } from './fieldContext'
import styles from './Input.module.css'

/**
 * The form controls: `Input`, `Textarea`, `Select`, `Checkbox`, `SearchInput`.
 *
 * Every one of them is a real native element with a class on it. That is a deliberate
 * choice over a custom widget: the native controls already give a mobile keyboard
 * chosen from `type`/`inputMode`, the platform's own date and file pickers,
 * autofill, form validation, and correct behaviour under assistive technology. A
 * hand-built dropdown would have to re-earn all of it, and this product has no need
 * of one.
 *
 * Each control asks `useFieldContext()` for its id and ARIA wiring, so a control
 * inside a `Field` is labelled and described automatically, and a control used alone
 * keeps whatever its caller passed. An explicit prop always wins over the context.
 *
 * ## Mobile keyboards
 *
 * The one thing a caller must still choose is the keyboard. `type="number"` is
 * usually the wrong reach — it brings a spinner, drops leading zeros and rejects a
 * partially-typed value. For a phone number, an OTP or a marks field, prefer
 * `inputMode="numeric"` with `type="text"`, which asks for the numeric keypad and
 * leaves the value alone. `type="email"` and `type="tel"` are right and do give the
 * correct keyboards.
 */

type BaseInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'size'>

export interface InputProps extends BaseInputProps {
  /**
   * Forwarded to the `<input>`.
   *
   * Declared explicitly because React 19 passes `ref` to a function component as an
   * ordinary prop — no `forwardRef` needed — but `InputHTMLAttributes` does not include
   * it, so without this line the type rejects what the runtime accepts. Needed wherever
   * something outside has to focus the control: a dialog's `initialFocus`, an error
   * summary.
   */
  ref?: Ref<HTMLInputElement>
  /** Phosphor glyph drawn inside the control, on the leading edge. */
  icon?: string
  /** A short suffix inside the control — a unit, a currency, `%`. */
  suffix?: ReactNode
  invalid?: boolean
  className?: string
}

export function Input({ icon, suffix, invalid, className, ...rest }: InputProps) {
  const field = useFieldContext()
  const isInvalid = invalid ?? field?.invalid ?? false

  const control = (
    <input
      id={rest.id ?? field?.id}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      aria-invalid={isInvalid || undefined}
      required={rest.required ?? field?.required}
      className={[
        styles.control,
        icon ? styles.hasIcon : '',
        suffix ? styles.hasSuffix : '',
        isInvalid ? styles.invalid : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )

  if (!icon && !suffix) return control

  return (
    <span className={styles.wrap}>
      {icon && <Icon name={icon} size="sm" className={styles.leadingIcon} />}
      {control}
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </span>
  )
}

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  invalid?: boolean
  className?: string
}

export function Textarea({ invalid, className, rows = 4, ...rest }: TextareaProps) {
  const field = useFieldContext()
  const isInvalid = invalid ?? field?.invalid ?? false

  return (
    <textarea
      id={rest.id ?? field?.id}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      aria-invalid={isInvalid || undefined}
      required={rest.required ?? field?.required}
      rows={rows}
      className={[styles.control, styles.textarea, isInvalid ? styles.invalid : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  invalid?: boolean
  className?: string
  children: ReactNode
}

/**
 * A native `<select>` with the platform arrow replaced by our own glyph.
 *
 * `appearance: none` plus an absolutely positioned icon, rather than a scripted
 * dropdown: on a phone this still opens the OS picker, which is a far better control
 * than anything we would build — a full-height wheel, searchable, one-handed.
 */
export function Select({ invalid, className, children, ...rest }: SelectProps) {
  const field = useFieldContext()
  const isInvalid = invalid ?? field?.invalid ?? false

  return (
    <span className={styles.selectWrap}>
      <select
        id={rest.id ?? field?.id}
        aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
        aria-invalid={isInvalid || undefined}
        required={rest.required ?? field?.required}
        className={[styles.control, styles.select, isInvalid ? styles.invalid : '', className]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        {children}
      </select>
      <Icon name="ph-caret-down" weight="bold" size="sm" className={styles.caret} />
    </span>
  )
}

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'icon' | 'suffix'> {
  /** Overrides the toggle's accessible name. Defaults to "password". */
  describedAs?: string
}

/**
 * A password field with a show/hide toggle.
 *
 * The toggle is not a nicety on a phone. A password is typed on a soft keyboard with
 * no tactile feedback, into a field that shows nothing but dots, and every
 * registration form in this product asks for it twice — so the alternative to
 * revealing it is retyping both. Every mainstream sign-in form has one for that reason.
 *
 * It is a real `<button>` with `aria-pressed`, so its state is announced, and it never
 * submits the form (`type="button"`). Revealing the value does not change the input's
 * `autoComplete`, so password managers still recognise the field.
 */
export function PasswordInput({ describedAs = 'password', className, ...rest }: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false)
  const field = useFieldContext()
  const isInvalid = rest.invalid ?? field?.invalid ?? false

  return (
    <span className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <input
        {...rest}
        type={revealed ? 'text' : 'password'}
        id={rest.id ?? field?.id}
        aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
        aria-invalid={isInvalid || undefined}
        required={rest.required ?? field?.required}
        className={[styles.control, styles.hasSuffix, isInvalid ? styles.invalid : ''].filter(Boolean).join(' ')}
      />
      <button
        type="button"
        className={styles.reveal}
        onClick={() => setRevealed((current) => !current)}
        aria-pressed={revealed}
        aria-label={revealed ? `Hide ${describedAs}` : `Show ${describedAs}`}
      >
        <Icon name={revealed ? 'ph-eye-slash' : 'ph-eye'} size="sm" />
      </button>
    </span>
  )
}

export interface CheckboxProps extends Omit<BaseInputProps, 'type'> {
  label: ReactNode
  /** A second line under the label, for the consequence of ticking it. */
  description?: ReactNode
  className?: string
}

/**
 * A checkbox with its label.
 *
 * The whole row is the `<label>`, so the text is part of the target — which on a
 * phone is the difference between a 16px box and a comfortable tap. The box itself is
 * the native input, sized up, because a native checkbox announces its state correctly
 * and a styled `<div>` does not.
 */
export function Checkbox({ label, description, className, ...rest }: CheckboxProps) {
  return (
    <label className={[styles.checkRow, className].filter(Boolean).join(' ')}>
      <input type="checkbox" className={styles.checkbox} {...rest} />
      <span className={styles.checkText}>
        <span className={styles.checkLabel}>{label}</span>
        {description && <span className={styles.checkDescription}>{description}</span>}
      </span>
    </label>
  )
}

export interface SearchInputProps extends Omit<InputProps, 'icon' | 'type'> {
  /** Called by the clear button. Omit it and no clear button is rendered. */
  onClear?: () => void
  'aria-label'?: string
}

/**
 * The search box used by the admin listings.
 *
 * `type="search"` deliberately, so a mobile keyboard shows a Search key; the browser's
 * own clear affordance is suppressed in favour of one we can size for a thumb and
 * label for a screen reader.
 */
export function SearchInput({
  onClear,
  value,
  placeholder = 'Search',
  className,
  ...rest
}: SearchInputProps) {
  const showClear = Boolean(onClear) && Boolean(value)

  return (
    <span className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <Icon name="ph-magnifying-glass" size="sm" className={styles.leadingIcon} />
      <Input
        type="search"
        value={value}
        placeholder={placeholder}
        className={`${styles.hasIcon} ${showClear ? styles.hasSuffix : ''} ${styles.search}`}
        {...rest}
      />
      {showClear && (
        <button type="button" className={styles.clear} onClick={onClear} aria-label="Clear search">
          <Icon name="ph-x" weight="bold" size="xs" />
        </button>
      )}
    </span>
  )
}
