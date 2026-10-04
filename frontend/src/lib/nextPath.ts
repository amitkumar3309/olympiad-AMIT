/**
 * Where to take somebody after they sign in (Milestone 30, Phase 3 — brief §7.3).
 *
 * The Login Gate sends a guest to sign in or register *on the way to* the Daily Quiz, and
 * a guest who opens any signed-in page is sent to sign in on the way to that page. Either
 * way the destination travels as `?next=`, and it may only ever be one of these **exact**
 * paths: a pattern check ("starts with /") is how an open redirect gets written —
 * `//evil.example`, `/\evil.example` — and the same value is put into the verification
 * email, which is sent from our address to whatever address was typed.
 *
 * **Mirrors `backend/src/lib/nextPaths.ts` exactly** — change both together. The backend
 * drops anything else from the email link; this drops anything else from the redirect.
 */
export const NEXT_PATHS = [
  '/daily-quiz',
  '/dashboard',
  '/practice',
  '/mock-tests',
  '/profile',
  '/payment',
  '/referrals',
  '/rewards',
  '/analytics',
  '/notifications',
  '/my-certificates',
  '/exam',
] as const

export type NextPath = (typeof NEXT_PATHS)[number]

/** The value if it is exactly one of `NEXT_PATHS`, otherwise null. Nothing is normalised. */
export function safeNext(raw: string | null | undefined): NextPath | null {
  return raw && (NEXT_PATHS as readonly string[]).includes(raw) ? (raw as NextPath) : null
}

/** The homepage with the sign-in dialog open and the destination kept: `/?next=%2Fdaily-quiz#login`. */
export function signInHref(next?: NextPath | null): string {
  return next ? `/?next=${encodeURIComponent(next)}#login` : '/#login'
}

/** The registration page, keeping the destination and any referral code. */
export function registerHref(next?: NextPath | null, ref?: string | null): string {
  const params = new URLSearchParams()
  if (ref) params.set('ref', ref)
  if (next) params.set('next', next)
  const query = params.toString()
  return query ? `/register?${query}` : '/register'
}
