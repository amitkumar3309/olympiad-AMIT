import type { CSSProperties } from 'react'
import { ButtonLink, Card, Icon, IconTile, Section } from '../../components/ui'
import ResetPanel, { type ResetScope } from '../../components/ResetPanel'
import Unauthorized from '../../components/Unauthorized'
import { useAuth } from '../../context/AuthContext'
import AdminShell from './AdminShell'
import styles from './System.module.css'

/**
 * The super administrator's own console (Milestone 26).
 *
 * ## Why this exists
 *
 * Before it, the super administrator had **no area of their own**. The things only
 * they can do were scattered: `content:reset` appeared as a "danger zone" footer at
 * the bottom of the Question Bank, Mock Tests, Daily Challenges and Chapters;
 * `users:role:write` and `users:delete` were controls buried in a row menu on
 * `/admin/users`. An ordinary administrator and a super administrator saw the same
 * seven navigation groups, and the difference between the two roles was discoverable
 * only by scrolling to the bottom of four unrelated pages.
 *
 * ## The reset panels moved here, and that is the point
 *
 * They were contextual before — the reset for questions sat under the questions. That
 * reads well and it is the wrong shape for a destructive act: it puts the button that
 * empties a collection at the end of the page somebody uses to *edit* that
 * collection, four times over, on four pages an administrator scrolls every day.
 * Gathering them gives the act one home, shows the dependency order in the order they
 * are listed, and makes this a page a reader arrives at deliberately.
 *
 * **The order below is the order the API requires.** A reset that would orphan rows is
 * refused with its blockers named, and the chain runs daily challenges → mock tests →
 * questions → chapters. Working down the page is the sequence that succeeds.
 *
 * ## What is deliberately not here
 *
 * No "system configuration". The settings this product has are real and each lives
 * beside the thing it affects — the XP award table on its own page, the entry fee on
 * the payments console next to the money it prices. A settings page gathering them
 * would be a second place to change a number that already has one, and the navigation
 * has never carried an entry for a page that does not exist.
 */

/** In the order the API accepts them: each reset's blockers are resolved by the one above. */
const RESET_SCOPES: Array<{ scope: ResetScope; note: string }> = [
  { scope: 'daily-challenges', note: 'Nothing depends on a scheduled day, so this one is never blocked.' },
  { scope: 'mock-tests', note: 'Blocked while a daily challenge is set from a question in a paper.' },
  { scope: 'questions', note: 'Blocked while a mock test or a daily challenge still uses a question.' },
  { scope: 'chapters', note: 'Blocked while any question is still filed under a chapter.' },
]

export default function System() {
  const { can } = useAuth()

  /*
    Gated on `content:reset` rather than on a role name, like every other gate in this
    product — the permission list comes from the server, so this cannot drift from what
    the API will allow. `content:reset` is super-admin-only, which is what makes this
    the super administrator's page.
  */
  if (!can('content:reset')) {
    return (
      <Unauthorized
        title="This area is for the super administrator"
        detail="Resetting a collection and changing who holds a role are restricted to the super administrator account. Everything else in the admin area is available to you from the menu."
      />
    )
  }

  return (
    <AdminShell
      title="System"
      subtitle="The acts only the super administrator can perform. Everything here is audited."
    >
      <div className="stack" style={{ '--stack-gap': 'var(--block-gap)' } as CSSProperties}>
        <Section
          eyebrow="Accounts"
          eyebrowIcon="ph-user-gear"
          title="Roles and access"
          lead="Promoting an account to administrator, and removing an account entirely, are restricted to this role. Both happen on the student directory, against the account they affect."
          size="compact"
        >
          <div className={styles.linkGrid}>
            <Card as="article" className={styles.linkCard} padding="md" interactive>
              <IconTile icon="ph-users-three" tone="blue" size="md" />
              <h3 className={styles.linkTitle}>Student directory</h3>
              <p className={styles.linkBody}>
                Search every account, grant or revoke administrator, suspend, reactivate and delete. A role
                change ends that account&rsquo;s sessions immediately.
              </p>
              <ButtonLink to="/admin/users" variant="secondary" size="sm" iconAfter="ph-arrow-right">
                Open the directory
              </ButtonLink>
            </Card>

            <Card as="article" className={styles.linkCard} padding="md" interactive>
              <IconTile icon="ph-scroll" tone="purple" size="md" />
              <h3 className={styles.linkTitle}>Audit trail</h3>
              <p className={styles.linkBody}>
                Every role change, status change and reset, with who did it and when — including privileged
                requests that were <em>refused</em>, and the permission that was missing.
              </p>
              <ButtonLink to="/admin/audit-log" variant="secondary" size="sm" iconAfter="ph-arrow-right">
                Open the audit log
              </ButtonLink>
            </Card>
          </div>
        </Section>

        <Section
          eyebrow="Destructive"
          eyebrowIcon="ph-warning-octagon"
          title="Reset a collection"
          lead="Each of these empties a collection permanently. Nothing happens on the first press: you will be shown the real counts, what survives, and — where a reset would orphan rows — what has to be cleared first."
          size="compact"
        >
          {/*
            Stated once, at the top, rather than repeated in four dialogs. These are the
            two questions staff actually hesitate over, and a person who has read the
            answer presses the right button instead of avoiding the page.
          */}
          <Card tone="sunken" padding="md" className={styles.rules}>
            <ul>
              <li>
                <Icon name="ph-shield-check" weight="bold" className={styles.ruleIcon} />
                <span>
                  <strong>No student loses XP.</strong> Attempts go with the paper they belong to, because an
                  attempt with no paper cannot be rendered — but the activity log behind every student&rsquo;s
                  XP, level and streak is a record of something that really happened, and is never deleted.
                </span>
              </li>
              <li>
                <Icon name="ph-lock-key" weight="bold" className={styles.ruleIcon} />
                <span>
                  <strong>The official Olympiad cannot be reset.</strong> Its results and the certificates
                  issued from them are permanent, and there is deliberately no path here that touches them.
                </span>
              </li>
            </ul>
          </Card>

          <div className={styles.resets}>
            {RESET_SCOPES.map(({ scope, note }) => (
              <div key={scope} className={styles.resetRow}>
                <p className={styles.resetNote}>{note}</p>
                <ResetPanel scope={scope} />
              </div>
            ))}
          </div>
        </Section>
      </div>
    </AdminShell>
  )
}
