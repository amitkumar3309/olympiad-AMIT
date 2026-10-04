/**
 * Where a verification link may send a student back to (Milestone 30, Phase 3 — brief §7.3).
 *
 * The Login Gate's "Create free account" carries `next=/daily-quiz`, and the brief asks
 * for the destination to survive registration **and** email verification. The link is
 * the only thing that crosses that gap, so the destination rides in it:
 * `/verify-email?token=…&next=/daily-quiz`.
 *
 * ## Why an exact list, and not "any path starting with /"
 *
 * Whatever goes in that link is sent **from our address to whatever email was typed** —
 * which need not be the typist's. A pattern check is how an open redirect gets written
 * (`//evil.example`, `/\evil.example`, an encoded scheme); an exact allow-list cannot be
 * argued with. These are the signed-in destinations a guest can be bounced from.
 *
 * A value outside the list is **ignored**, not refused: it is a navigation hint, and
 * losing somebody's registration over one would be worse than landing them on the
 * dashboard. Mirrored by `frontend/src/lib/nextPath.ts` — change both together.
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
] as const;

export type NextPath = (typeof NEXT_PATHS)[number];

export function isNextPath(value: unknown): value is NextPath {
  return typeof value === 'string' && (NEXT_PATHS as readonly string[]).includes(value);
}
