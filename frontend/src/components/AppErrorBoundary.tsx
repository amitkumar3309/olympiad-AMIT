import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, EmptyState } from './ui'
import { SUPPORT, SUPPORT_TEL_HREF } from '../lib/brand'
import styles from './AppErrorBoundary.module.css'

/**
 * The page a crash lands on — the branded "500" (Milestone 30, Phase 6 — brief §10).
 *
 * Without it, an exception thrown while rendering any route unmounted the whole app and left
 * a blank white page: no navigation, no message, nothing to press. Now the reader is told
 * plainly, can reload, can go home, and can reach a person.
 *
 * Two cases are told apart:
 *
 *  - **A page that could not be downloaded.** Every route but the homepage is a separate
 *    file (`lazy()`), and a deploy replaces those files — so a tab opened before a deploy
 *    asks for a chunk that no longer exists. That is not a fault anybody can fix by waiting;
 *    a reload fetches the new version, so the page says exactly that.
 *  - **Anything else** — a real defect. The error is logged to the console, which is where
 *    the link crawler and a developer's browser will see it.
 *
 * `resetKey` is the path: moving to another page clears the error, so one broken page does
 * not take the menu's other destinations down with it.
 *
 * Deliberately plain: only `ui/` primitives, no shell, no data. A fallback that depends on
 * the thing that crashed would crash too.
 */

interface Props {
  resetKey: string
  children: ReactNode
}

interface State {
  error: Error | null
  /** The `resetKey` (path) the state belongs to — a different one clears the error. */
  key: string
}

/** The messages Chrome, Firefox and Safari give when a dynamic `import()` fails. */
const STALE_CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  /**
   * Moving to another page clears the error before that page renders — derived here rather
   * than set in `componentDidUpdate`, which would render the broken page's fallback once more
   * and then render again.
   */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A page failed to render:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const stale = STALE_CHUNK.test(error.message)
    return (
      <main className={styles.wrap} id="main-content">
        <div className="container">
          <EmptyState
            icon={stale ? 'ph-arrows-clockwise' : 'ph-warning-circle'}
            titleAs="h1"
            title={stale ? 'A new version of the site is ready' : 'Something went wrong on this page'}
            description={
              stale
                ? 'This page changed since you opened the site. Reload to get the latest version — nothing you saved is lost.'
                : 'The page stopped working. Reloading usually fixes it. If it keeps happening, tell us what you were doing and we will look into it.'
            }
            action={
              <Button icon="ph-arrows-clockwise" onClick={() => window.location.reload()}>
                Reload the page
              </Button>
            }
            secondaryAction={
              // A full load rather than a router link: the app around this page may be the
              // part that is broken.
              <a className={styles.home} href="/">
                Go to the home page
              </a>
            }
          />
          {!stale && (
            <p className={styles.support}>
              Write to <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a> or call{' '}
              <a href={SUPPORT_TEL_HREF}>{SUPPORT.phone}</a>.
            </p>
          )}
        </div>
      </main>
    )
  }
}
