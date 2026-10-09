/**
 * The parts of Motion (motion.dev, formerly Framer Motion) the homepage uses — and only these, so
 * the chunk `pages/Landing/motion.ts` loads after the page is up stays small. `animate` drives
 * `transform` and `opacity` through the browser's own animation engine (off the main thread) and
 * runs springs for anything else; `stagger` times a group.
 */
export { animate, stagger } from 'motion'
