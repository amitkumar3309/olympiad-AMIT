/**
 * Compatibility re-export.
 *
 * The button now lives in `components/ui/Button.tsx`. This file stays because forty
 * pages import `components/Button`, and the props they pass (`variant`, `fullWidth`)
 * are unchanged — so they pick up the redesigned control without being edited.
 *
 * New code should import from `components/ui`, which is also the only place
 * `ButtonLink` and the prop types are exported from — re-exporting a second name
 * here would make this file look like API worth importing, which it is not.
 */
export { default } from './ui/Button'
