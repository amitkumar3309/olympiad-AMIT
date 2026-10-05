import { PASSWORD_RULES } from '../lib/passwordPolicy'
import { Icon } from './ui'
import styles from './PasswordRules.module.css'

/**
 * The password requirements, ticked off as they are met — the one list under every field
 * that sets a password: registration, the reset link, the forced change and the profile's
 * change (Milestone 30, Phase 5). Before, registration and the reset link each had a copy,
 * and the other two forms printed an old rule ("a letter and a number") that the server had
 * stopped accepting on its own (audit D3).
 *
 * It reads `lib/passwordPolicy.ts`, which mirrors the server's policy — a display, never the
 * authority. Shown always rather than after a failed submit: a reader should know what is
 * being asked before choosing a password. `aria-live="polite"`, so a screen-reader user
 * hears a rule being satisfied, and every rule keeps its words — the icon is never the only
 * carrier of meaning.
 */
export default function PasswordRules({ value, className }: { value: string; className?: string }) {
  return (
    <ul className={[styles.rules, className].filter(Boolean).join(' ')} aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.met(value)
        return (
          <li key={rule.id} className={met ? styles.met : styles.unmet}>
            <Icon
              name={met ? 'ph-check-circle' : 'ph-circle'}
              weight="bold"
              size="sm"
              label={met ? 'Met:' : 'Still needed:'}
            />
            <span>{rule.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
