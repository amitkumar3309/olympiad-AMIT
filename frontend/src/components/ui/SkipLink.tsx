import styles from './SkipLink.module.css'

/**
 * "Skip to content" — the first thing a keyboard reaches on a page, hidden until it does
 * (Milestone 30, Phase 6 — brief §10).
 *
 * It points at `#main-content`, so the page must give its `<main>` that id: the link crawler
 * checks every page has both. It lived inside `AppShell` alone until this phase, so the public
 * pages — the homepage, registration, sign-in, the boards — had none, and a keyboard user
 * tabbed through the whole header to reach anything.
 */
export default function SkipLink({ target = 'main-content' }: { target?: string }) {
  return (
    <a href={`#${target}`} className={styles.skipLink}>
      Skip to content
    </a>
  )
}
