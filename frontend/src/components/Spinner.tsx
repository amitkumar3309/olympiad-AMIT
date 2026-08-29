/**
 * Compatibility re-export.
 *
 * The spinner now lives in `components/ui/Spinner.tsx`, with the same `{ label }`
 * prop. Forty-five pages import `components/Spinner`; they keep working.
 *
 * New code should import from `components/ui` — and should usually reach for a
 * `Skeleton` instead, which does not reflow the page when the data arrives.
 */
export { default } from './ui/Spinner'
export type { SpinnerProps } from './ui/Spinner'
