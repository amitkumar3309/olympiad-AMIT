import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { Permission } from '../api/types'
import Spinner from './Spinner'
import Unauthorized from './Unauthorized'
import StudentShell from './StudentShell'
import EntryFeeRequired from './EntryFeeRequired'

/**
 * Route-level gates. These are the only place a page should be authorized; pages
 * themselves may read `state`/`can()` for conditional *rendering*, but must not
 * hand-roll their own gate (see CLAUDE.md "Frontend Conventions").
 *
 * None of this is a security boundary — it decides what the UI offers, nothing
 * more. Every one of these permissions is enforced again on the backend, so
 * editing client state or calling the API directly gains nothing.
 */

/** Requires a signed-in student account. */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { state } = useAuth()
  if (state.status === 'loading') return <Spinner label="Checking your session..." />
  if (state.status !== 'student') return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * Requires a specific permission.
 *
 * A guest is sent to `signInPath` to sign in, because there is a route they could
 * take to succeed. Someone already signed in is shown the unauthorized state
 * instead — bouncing them would just look broken.
 *
 * `signInPath` defaults to the **public** sign-in, which opens the one dialog every
 * user shares. It defaulted to `/admin` until Milestone 28, when that page stopped
 * carrying a sign-in form of its own — and once `/admin` itself became gated, that old
 * default would have sent a guest from `/admin` straight back to `/admin`, which is an
 * infinite redirect rather than a sign-in prompt.
 */
export function RequirePermission({
  permission,
  children,
  signInPath = '/#login',
  unauthorized,
}: {
  permission: Permission
  children: React.ReactNode
  signInPath?: string
  /**
   * Overrides the generic refusal for a route that can say something more useful.
   * `/admin` is the case it exists for: "this area is for administrators, here is
   * your dashboard" is worth more to a student who wandered in than "your account
   * does not hold the permission this page requires". That copy lived inside
   * `Admin.tsx` until Milestone 28 gated the route, and passing it here is what
   * stopped it being lost when the page's own guard was deleted.
   */
  unauthorized?: React.ReactNode
}) {
  const { state, can } = useAuth()
  if (state.status === 'loading') return <Spinner label="Checking your permissions..." />
  if (state.status === 'guest') return <Navigate to={signInPath} replace />
  if (!can(permission)) return <>{unauthorized ?? <Unauthorized />}</>
  return <>{children}</>
}

/**
 * Requires a paid entry fee, on top of a signed-in student account.
 *
 * A **second axis** from `RequirePermission`, not a replacement for it: a permission
 * says what a role may do and comes from a static table, while this says what this
 * account has bought and comes from the payment record. Wrapping rather than merging
 * them keeps each answerable on its own.
 *
 * As with every guard here, this is not a security boundary. The matching
 * `requireEntry` middleware refuses the request with a 402 whatever the browser
 * believes; this only decides whether the student is shown a paper or a pay button.
 */
export function RequirePaidEntry({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { state, hasPaid } = useAuth()
  if (state.status === 'loading') return <Spinner label="Checking your session..." />
  if (state.status !== 'student') return <Navigate to="/" replace />
  if (!hasPaid)
    return (
      <StudentShell title={feature} subtitle="Entry fee required">
        <EntryFeeRequired feature={feature} />
      </StudentShell>
    )
  return <>{children}</>
}
