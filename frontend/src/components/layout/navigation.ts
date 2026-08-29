import type { Permission } from '../../api/types'

/**
 * THE navigation model for the whole application (Milestone 23, Phase B).
 *
 * Data, not JSX: the student sidebar, the student mobile drawer, the student bottom
 * bar and the admin drawer are all rendered from these arrays by one `AppShell`, so
 * "what is in this product" is stated once. Before this, the student list lived in
 * `StudentShell.tsx` and the admin list in `AdminShell.tsx`, each with its own copy of
 * the drawer, the topbar and the active-item logic.
 *
 * ## Two rules about what may appear here
 *
 * **Every entry points at a route that exists and a feature that is built.** There are
 * no placeholders and no "coming soon" items. Two consequences worth writing down,
 * because both look like omissions:
 *
 *  - There is **no admin "Practice"** item. Practice is student-initiated — a question
 *    becomes practice content by being *published*, and there is deliberately no
 *    `PracticeSet` collection to curate (see the Milestone 21 Phase G ADR). The
 *    equivalent administrative act is bulk-publishing in the Question Bank, which is
 *    where it lives.
 *  - There is **no admin "Settings"** page, so the group holds the settings that
 *    genuinely exist — the XP award table, and the entry fee, which is edited on the
 *    payments console beside the money it affects.
 *
 * **Grouping is by what the reader came to do**, not by which milestone built it. A
 * flat list of sixteen student links and twenty admin links is a search task; five or
 * six named groups is a choice.
 */

export interface NavItem {
  to: string
  label: string
  /** Phosphor glyph name. Verified to exist — a name that is not in the loaded
   *  stylesheets renders an invisible glyph rather than falling back. */
  icon: string
  /** Hidden entirely for anyone who does not hold it. */
  permission?: Permission
  /**
   * Needs a paid entry fee, and shows a padlock until it is. **Only the official
   * Olympiad qualifies**: practice, mock tests and the daily challenge are free
   * (owner decision, 2026-08-17).
   */
  paid?: boolean
  /** Shows the unread-notification count. */
  badge?: 'unread'
  /**
   * Extra path prefixes that should also mark this item as the current page — the
   * runner under a listing, the editor under a bank. The longest matching prefix
   * wins, so `/admin/questions/import` selects Bulk Import rather than Question Bank.
   */
  match?: string[]
}

export interface NavGroup {
  /** Omitted for the first group, which is the one item above the dividers. */
  label?: string
  items: NavItem[]
}

/**
 * The student area.
 *
 * Ordered to the brief's priorities: Dashboard, then preparation, then how it is
 * going, then the competition itself, then the account.
 */
export const STUDENT_NAV: NavGroup[] = [
  {
    items: [{ to: '/dashboard', label: 'Dashboard', icon: 'ph-squares-four' }],
  },
  {
    label: 'Prepare',
    items: [
      // The session runner lives under this path, so it keeps the item selected while
      // a paper is open.
      { to: '/practice', label: 'Practice Zone', icon: 'ph-target', match: ['/practice'] },
      { to: '/mock-tests', label: 'Mock Tests', icon: 'ph-exam', match: ['/mock-tests'] },
      { to: '/daily-challenge', label: 'Daily Challenge', icon: 'ph-dice-five' },
    ],
  },
  {
    label: 'My progress',
    items: [
      { to: '/analytics', label: 'Performance', icon: 'ph-chart-line-up' },
      { to: '/report', label: 'Printable report', icon: 'ph-file-text' },
      { to: '/rewards', label: 'XP & badges', icon: 'ph-trophy' },
      { to: '/leaderboard', label: 'Leaderboard', icon: 'ph-ranking' },
      { to: '/hall-of-fame', label: 'Hall of Fame', icon: 'ph-crown' },
    ],
  },
  {
    label: 'The Olympiad',
    items: [
      /*
        Added in Phase B. The official sitting has existed since Milestone 13 and was
        reachable only from the dashboard — the one thing the product is named after
        was missing from its own navigation, and the `paid` padlock this file has
        always described was consequently dead code.
      */
      { to: '/exam', label: 'Official Olympiad', icon: 'ph-graduation-cap', paid: true, match: ['/exam'] },
      { to: '/payment', label: 'Entry fee & receipts', icon: 'ph-currency-inr' },
      { to: '/result', label: 'Result', icon: 'ph-seal-check' },
      { to: '/my-certificates', label: 'Certificates', icon: 'ph-medal' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/referrals', label: 'Refer & Earn', icon: 'ph-share-network' },
      { to: '/notifications', label: 'Notifications', icon: 'ph-bell', badge: 'unread' },
      { to: '/profile', label: 'My Profile', icon: 'ph-user-circle' },
    ],
  },
]

/**
 * The four destinations in the student bottom bar, plus a fifth slot the shell fills
 * with "More".
 *
 * Four, not six: a 320px screen divided six ways gives 53px per target, and the
 * whole point of a bottom bar is that it is comfortable for a thumb. Everything else
 * is one tap away behind More, which sits in the bottom bar rather than as a burger in
 * the top-left corner — the least reachable part of a phone held one-handed.
 */
export const STUDENT_BOTTOM_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: 'ph-squares-four' },
  { to: '/practice', label: 'Practice', icon: 'ph-target', match: ['/practice'] },
  { to: '/mock-tests', label: 'Tests', icon: 'ph-exam', match: ['/mock-tests'] },
  { to: '/daily-challenge', label: 'Challenge', icon: 'ph-dice-five' },
]

/**
 * The administrative area. Every item declares the permission it needs and is simply
 * absent for anyone who does not hold it, so an administrator never follows a link
 * that greets them with an error. The permissions come from the array the backend
 * sent, never from a role name, so this cannot drift from what the API will allow.
 */
export const ADMIN_NAV: NavGroup[] = [
  {
    items: [{ to: '/admin', label: 'Dashboard', icon: 'ph-squares-four' }],
  },
  {
    label: 'Students',
    items: [
      { to: '/admin/users', label: 'All Students', icon: 'ph-users-three', permission: 'students:read' },
      { to: '/admin/payments', label: 'Payments', icon: 'ph-currency-inr', permission: 'students:read' },
      { to: '/admin/referrals', label: 'Referrals', icon: 'ph-share-network', permission: 'students:read' },
    ],
  },
  {
    label: 'Question bank',
    items: [
      {
        to: '/admin/questions',
        label: 'Question Bank',
        icon: 'ph-list-checks',
        permission: 'questions:write',
        // The editor, but not `/admin/questions/import`, which is longer and so wins.
        match: ['/admin/questions'],
      },
      { to: '/ai-generator', label: 'AI Question Generator', icon: 'ph-sparkle', permission: 'questions:write' },
      {
        to: '/admin/questions/import',
        label: 'Bulk Import',
        icon: 'ph-upload-simple',
        permission: 'questions:write',
      },
      { to: '/admin/taxonomy', label: 'Chapters', icon: 'ph-tree-structure', permission: 'taxonomy:write' },
    ],
  },
  {
    label: 'Assessments',
    items: [
      { to: '/admin/mock-tests', label: 'Mock Tests', icon: 'ph-exam', permission: 'mocktests:write', match: ['/admin/mock-tests'] },
      { to: '/admin/daily-challenges', label: 'Daily Challenge', icon: 'ph-dice-five', permission: 'challenges:write' },
      { to: '/admin/exams', label: 'Official Exam', icon: 'ph-graduation-cap', permission: 'exam:write' },
      { to: '/admin/certificates', label: 'Certificates', icon: 'ph-medal', permission: 'certificates:write' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/admin/analytics', label: 'Analytics', icon: 'ph-chart-line-up', permission: 'analytics:read:any' },
      { to: '/admin/performance', label: 'Question performance', icon: 'ph-target', permission: 'analytics:read:any' },
      { to: '/admin/standings', label: 'Standings & Rewards', icon: 'ph-ranking', permission: 'students:read' },
      { to: '/admin/audit-log', label: 'Audit Log', icon: 'ph-scroll', permission: 'audit:read' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { to: '/admin/notifications', label: 'Notifications', icon: 'ph-megaphone', permission: 'notifications:write' },
      {
        to: '/admin/email-deliveries',
        label: 'Email delivery',
        icon: 'ph-paper-plane-tilt',
        permission: 'notifications:write',
      },
      { to: '/admin/gallery', label: 'Event Gallery', icon: 'ph-images', permission: 'gallery:write' },
    ],
  },
  {
    label: 'Settings',
    items: [{ to: '/admin/reward-settings', label: 'XP awards', icon: 'ph-sliders-horizontal', permission: 'rewards:write' }],
  },
]

/**
 * Which item is the current page.
 *
 * **Longest prefix wins**, and that is the whole reason this is a function rather than
 * `pathname === item.to`. Two cases the naive version gets wrong: an exact comparison
 * highlights nothing at all while a practice session or a question editor is open, and
 * a plain `startsWith` highlights *both* Question Bank and Bulk Import on
 * `/admin/questions/import` — and Dashboard on every `/admin/*` page.
 */
export function findActiveItem(pathname: string, groups: NavGroup[]): NavItem | null {
  let best: NavItem | null = null
  let bestLength = -1

  for (const group of groups) {
    for (const item of group.items) {
      for (const prefix of [item.to, ...(item.match ?? [])]) {
        const matches = pathname === prefix || pathname.startsWith(`${prefix.replace(/\/$/, '')}/`)
        if (matches && prefix.length > bestLength) {
          best = item
          bestLength = prefix.length
        }
      }
    }
  }

  return best
}

/** Drops the items this account may not use. Groups left empty are dropped too. */
export function visibleGroups(groups: NavGroup[], can: (permission: Permission) => boolean): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.permission || can(item.permission)) }))
    .filter((group) => group.items.length > 0)
}
