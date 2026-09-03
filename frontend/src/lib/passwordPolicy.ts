/**
 * The password rules, mirrored from the server so a reader can see what is required
 * *while they type* rather than after submitting.
 *
 * **The server is the authority.** `backend/src/validation/authSchemas.ts` holds the
 * real policy and is what actually refuses a password; this file exists so the form can
 * be honest in advance. If the two ever disagree, the server wins and this file is the
 * bug — so change them together.
 *
 * Owner's decision (2026-09-02): at least eight characters, and at least one lowercase
 * letter, one uppercase letter, one number and one special character.
 *
 * Every rule is evaluated on every keystroke and **all** unmet ones are shown, not just
 * the first. Revealing requirements one at a time is the pattern that makes people try
 * five passwords in a row; it is also the client half of the rule that a form reports
 * every problem at once.
 */

export const PASSWORD_MIN_LENGTH = 8

export interface PasswordRule {
  /** Stable key, used as a React key and in tests. */
  id: 'length' | 'lowercase' | 'uppercase' | 'number' | 'special'
  /** Written as a requirement, so the list reads the same met or unmet. */
  label: string
  met: (value: string) => boolean
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    met: (v) => v.length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'lowercase', label: 'One lowercase letter', met: (v) => /[a-z]/.test(v) },
  { id: 'uppercase', label: 'One uppercase letter', met: (v) => /[A-Z]/.test(v) },
  { id: 'number', label: 'One number', met: (v) => /\d/.test(v) },
  {
    id: 'special',
    label: 'One special character (! ? @ # …)',
    // Anything that is not a letter or a digit, which is what the server checks.
    met: (v) => /[^A-Za-z0-9]/.test(v),
  },
]

/** The rules this password does not yet satisfy, in the order they are displayed. */
export function unmetPasswordRules(value: string): PasswordRule[] {
  return PASSWORD_RULES.filter((rule) => !rule.met(value))
}

/**
 * A single message naming everything that is missing, for the field's `error` and for
 * the summary at the top of a long form.
 *
 * `null` when the password is acceptable, so a caller can use it directly as the
 * field's error value.
 */
export function passwordProblem(value: string): string | null {
  const unmet = unmetPasswordRules(value)
  if (unmet.length === 0) return null

  const missing = unmet.map((rule) => rule.label.toLowerCase())
  const last = missing.pop()!
  const list = missing.length > 0 ? `${missing.join(', ')} and ${last}` : last
  return `Your password still needs: ${list}.`
}
