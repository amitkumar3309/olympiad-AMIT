import type { Role } from '../api/types'

/**
 * Where a session belongs the moment it is created.
 *
 * ## Why this exists at all
 *
 * Before Milestone 28 every caller of `login()` hardcoded `navigate('/dashboard')` and
 * threw the role away — `LoginDialog` called `onSignedIn?.()` with no argument, so an
 * administrator signing in through the one public form landed on the *student*
 * dashboard and had to know to type `/admin` themselves. Merging the two sign-in forms
 * (`88d41fb`) is what made that reachable: while staff had their own door, the door
 * decided the destination.
 *
 * So the destination is derived from the role instead, in one place, and every caller
 * uses it. Two of them would eventually disagree, and the one that disagreed would be
 * the one a promoted admin happened to use.
 *
 * ## Where the role comes from
 *
 * The **server**, on the session response — `role` is read off the account document,
 * not off anything the browser holds or could set. This function only chooses a path
 * from a value it is given; it is navigation, not authorization. `/admin` is gated
 * independently by `RequirePermission`, which re-reads the role from the database on
 * every privileged request, so sending somebody here who should not be admitted does
 * not admit them — it just shows them the unauthorized state.
 *
 * That division is deliberate: this is allowed to be a plain role comparison precisely
 * *because* it decides nothing. A capability question still goes through `can()`, and
 * the role → permission table is never reimplemented on the frontend.
 */
export function roleHome(role: Role): string {
  return role === 'student' ? '/dashboard' : '/admin'
}
