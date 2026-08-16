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
 */
export function RequirePermission({
  permission,
  children,
  signInPath = '/admin',
}: {
  permission: Permission
  children: React.ReactNode
  signInPath?: string
}) {
  const { state, can } = useAuth()
  if (state.status === 'loading') return <Spinner label="Checking your permissions..." />
  if (state.status === 'guest') return <Navigate to={signInPath} replace />
  if (!can(permission)) return <Unauthorized />
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
