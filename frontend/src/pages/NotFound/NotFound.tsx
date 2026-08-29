import { useLocation } from 'react-router-dom'
import { ButtonLink, EmptyState } from '../../components/ui'
import styles from './NotFound.module.css'

/**
 * The page for an address this app does not answer.
 *
 * There was no catch-all route until now, and React Router renders **nothing** when no
 * path matches — so a mistyped address, a stale bookmark or an old link produced a blank
 * white page indistinguishable from a crash. It is not a hypothetical: every referral
 * link the backend generated pointed at `/register`, which was not a declared route, and
 * so every one of them was blank until the route was added.
 *
 * It deliberately does not guess where you meant to go. It names the path that did not
 * resolve — the one fact that lets somebody spot their own typo — and offers the two
 * places anybody can reach without knowing which kind of account is signed in.
 */
export default function NotFound() {
  const { pathname } = useLocation()

  return (
    <main className={styles.wrap}>
      <div className="container">
        <EmptyState
          icon="ph-compass"
          title="This page does not exist"
          description={`Nothing is published at ${pathname}. It may be a typo, or a link to something that has since moved.`}
          action={
            <ButtonLink to="/" icon="ph-house">
              Go to the home page
            </ButtonLink>
          }
          secondaryAction={
            <ButtonLink to="/dashboard" variant="ghost">
              My dashboard
            </ButtonLink>
          }
        />
      </div>
    </main>
  )
}
