/**
 * Compatibility re-export.
 *
 * The stat tile now lives in `components/ui/StatTile.tsx`, with the same
 * `{ icon, value, label }` props plus `hint` and `tone`.
 *
 * New code should import from `components/ui`.
 */
export { default } from './ui/StatTile'
export type { StatTileProps } from './ui/StatTile'
