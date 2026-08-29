import { createContext, useContext } from 'react'

/**
 * The wiring between a `Field` and the control inside it.
 *
 * It exists so that a caller writes this —
 *
 *     <Field label="Email address" hint="We send the verification link here" error={err}>
 *       <Input type="email" value={email} onChange={...} />
 *     </Field>
 *
 * — and gets a correctly associated `<label for>`, an `aria-describedby` naming both
 * the hint and the error, `aria-invalid` when there is an error, and `required` on the
 * control, without repeating four ids by hand at every one of the product's forms.
 * Doing it with `cloneElement` was the alternative and is worse: it breaks the moment
 * a caller wraps their input in anything.
 *
 * A separate file from `Field.tsx` on purpose — a module that exports both a component
 * and a hook defeats React Fast Refresh, which is what `react/only-export-components`
 * warns about.
 */
export interface FieldContextValue {
  /** The id the control must carry, so the label's `htmlFor` reaches it. */
  id: string
  /** Space-separated ids of the hint and error text, for `aria-describedby`. */
  describedBy?: string
  invalid: boolean
  required: boolean
}

export const FieldContext = createContext<FieldContextValue | null>(null)

/**
 * Returns the enclosing `Field`'s wiring, or `null` when a control is used on its own
 * — which is allowed. A standalone control simply keeps whatever id and ARIA
 * attributes its caller passed.
 */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext)
}
