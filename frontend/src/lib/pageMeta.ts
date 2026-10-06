// The `.ts` extension is deliberate: `vite.seo.ts` imports this file under Node's module
// resolution, where a relative import must name its file.
import { AMIT_FULL_FORM, AMIT_OLYMPIAD, AMIT_SHORT, SITE_URL } from './brand.ts'

/**
 * What every route says about itself to a browser tab and a search engine (Milestone 30,
 * Phase 6 — brief §10, "SEO and sharing").
 *
 * One table, read twice:
 *
 *  - in the browser by `components/PageMeta`, which sets the tab title, the description,
 *    the canonical link and `robots` on every navigation; and
 *  - at build time by the Vite plugin in `vite.seo.ts`, which writes `sitemap.xml` (every
 *    `index: true` page) and `robots.txt` (every private area) from it.
 *
 * So a page cannot be in the sitemap and `noindex` at once, and a new public page is listed
 * by adding one row here. **No React and no browser API in this file** — the build imports
 * it too.
 *
 * A page is `index: true` only if a signed-out visitor sees the same thing as anyone else.
 * Everything signed-in, every staff page and every page reached from an email is `noindex`:
 * the brief asks for that, and a child's dashboard has no business in a search result.
 */

export interface PageMeta {
  /** The tab title, before " — A.M.I.T. Olympiad". */
  title: string
  /** The search snippet. Public pages write their own; the rest share the default. */
  description?: string
  /** Listed in the sitemap and indexable. Absent means `noindex`. */
  index?: boolean
}

/** The site in one sentence — the description of every page that has none of its own, and the share card's. */
export const DEFAULT_DESCRIPTION =
  'A national-level mathematics olympiad for Class 3 to Class 12, open to every school board. Practice, mock tests and the Daily Quiz are free.'

/**
 * The homepage's title and description — the same words `index.html` serves before any
 * script runs, so the tab does not change as the app starts.
 */
export const HOME_TITLE = `${AMIT_OLYMPIAD} — ${AMIT_FULL_FORM} | National Level Maths Competition`
export const HOME_DESCRIPTION = `${AMIT_SHORT} — the ${AMIT_FULL_FORM} — is a national-level mathematics olympiad for students in Class 3 to Class 12, open to every school board. Free practice, mock tests and a Daily Quiz with prizes; pay once to sit the official Olympiad.`

/**
 * Most specific first: the first pattern that matches wins. `:name` matches one path
 * segment, as in the route table.
 */
const ROUTES: ReadonlyArray<readonly [string, PageMeta]> = [
  // Public, indexed — the sitemap.
  ['/', { title: AMIT_OLYMPIAD, description: HOME_DESCRIPTION, index: true }],
  [
    '/leaderboard',
    {
      title: 'Leaderboard',
      description: `Who leads the ${AMIT_OLYMPIAD}: XP rankings for every student and for each class — today, the last 7 days, the last 30 days and all time.`,
      index: true,
    },
  ],
  [
    '/hall-of-fame',
    {
      title: 'Hall of Fame',
      description: `The students who earned their place in the ${AMIT_OLYMPIAD} Hall of Fame. Nothing on the page is seeded or sampled.`,
      index: true,
    },
  ],
  ['/gallery', { title: 'Event gallery', description: `Photographs from ${AMIT_OLYMPIAD} events.`, index: true }],
  [
    '/register',
    {
      title: 'Register',
      description: `Create a free ${AMIT_OLYMPIAD} account for Class 3 to Class 12. Practice, mock tests and the Daily Quiz are free.`,
      index: true,
    },
  ],
  ['/result', { title: 'Check a result', description: `Look up an official ${AMIT_OLYMPIAD} result.`, index: true }],
  [
    '/verify',
    {
      title: 'Verify a certificate',
      description: `Check that an ${AMIT_OLYMPIAD} certificate is genuine from the code printed on it.`,
      index: true,
    },
  ],
  [
    '/rewards/rules',
    {
      title: 'Daily Quiz & Rewards Rules',
      description: `How the ${AMIT_OLYMPIAD} Daily Quiz works, how winners are chosen and how prizes reach them.`,
      index: true,
    },
  ],
  ['/privacy', { title: 'Privacy Policy', description: `How the ${AMIT_OLYMPIAD} handles students' information.`, index: true }],
  ['/terms', { title: 'Terms of Use', description: `The terms for using the ${AMIT_OLYMPIAD} website.`, index: true }],
  ['/refunds', { title: 'Refund & Cancellation Policy', description: `Refunds and cancellations for the ${AMIT_OLYMPIAD} entry fee.`, index: true }],
  ['/contact', { title: 'Contact us', description: `Reach the ${AMIT_OLYMPIAD} team by phone or email.`, index: true }],

  // Reached from an email, or personal to one certificate.
  ['/verify/:code', { title: 'Certificate check' }],
  ['/verify-email', { title: 'Verify your email' }],
  ['/forgot-password', { title: 'Forgot your password' }],
  ['/reset-password', { title: 'Choose a new password' }],

  // The student area.
  ['/dashboard', { title: 'Dashboard' }],
  ['/daily-quiz', { title: 'Daily Quiz' }],
  ['/daily-challenge', { title: 'Daily Quiz' }],
  ['/practice', { title: 'Practice' }],
  ['/practice/:sessionId', { title: 'Practice' }],
  ['/mock-tests', { title: 'Mock Tests' }],
  ['/mock-tests/attempts/:attemptId', { title: 'Mock Test' }],
  ['/analytics', { title: 'My Progress' }],
  ['/rewards', { title: 'Achievements' }],
  ['/my-certificates', { title: 'Certificates' }],
  ['/certificate', { title: 'Certificates' }],
  ['/profile', { title: 'My Profile' }],
  ['/exam', { title: 'Official Olympiad' }],
  ['/exam/:attemptId', { title: 'Official Olympiad' }],
  ['/payment', { title: 'Entry fee & receipts' }],
  ['/notifications', { title: 'Notifications' }],
  ['/activity', { title: 'Activity' }],
  ['/report', { title: 'Printable report' }],
  ['/referrals', { title: 'Refer & Earn' }],

  // Staff.
  ['/admin', { title: 'Admin' }],
  ['/admin/users', { title: 'Admin · Students' }],
  ['/admin/payments', { title: 'Admin · Payments' }],
  ['/admin/referrals', { title: 'Admin · Referrals' }],
  ['/admin/questions', { title: 'Admin · Question Bank' }],
  ['/admin/questions/new', { title: 'Admin · New question' }],
  ['/admin/questions/import', { title: 'Admin · Bulk import' }],
  ['/admin/questions/:id/edit', { title: 'Admin · Edit question' }],
  ['/ai-generator', { title: 'Admin · AI Question Generator' }],
  ['/admin/taxonomy', { title: 'Admin · Chapters' }],
  ['/admin/mock-tests', { title: 'Admin · Mock Tests' }],
  ['/admin/mock-tests/new', { title: 'Admin · New mock test' }],
  ['/admin/mock-tests/:id/edit', { title: 'Admin · Edit mock test' }],
  ['/admin/mock-tests/:id/results', { title: 'Admin · Mock test results' }],
  ['/admin/daily-quiz', { title: 'Admin · Daily Quiz' }],
  ['/admin/daily-quiz/:groupId', { title: 'Admin · Daily Quiz' }],
  ['/admin/daily-challenges', { title: 'Admin · Daily Quiz' }],
  ['/admin/exams', { title: 'Admin · Official exam' }],
  ['/admin/certificates', { title: 'Admin · Certificates' }],
  ['/admin/analytics', { title: 'Admin · Analytics' }],
  ['/admin/performance', { title: 'Admin · Question performance' }],
  ['/admin/standings', { title: 'Admin · Standings & Rewards' }],
  ['/admin/notifications', { title: 'Admin · Notifications' }],
  ['/admin/email-deliveries', { title: 'Admin · Email delivery' }],
  ['/admin/gallery', { title: 'Admin · Event Gallery' }],
  ['/admin/reward-settings', { title: 'Admin · XP awards' }],
  ['/admin/system', { title: 'Admin · System' }],
  ['/admin/audit-log', { title: 'Admin · Audit log' }],

  // Development only — absent from a production build.
  ['/design-system', { title: 'Design system' }],
  ['/dev/ui', { title: 'Design system' }],
]

/** A path that matches no route is the 404 page. */
const NOT_FOUND: PageMeta = { title: 'Page not found' }

function matches(pattern: string, path: string): boolean {
  const want = pattern.split('/')
  const have = path.split('/')
  if (want.length !== have.length) return false
  return want.every((segment, i) => (segment.startsWith(':') ? (have[i] ?? '').length > 0 : segment === have[i]))
}

/** The trailing slash is not a different page: `/leaderboard/` is `/leaderboard`. */
export function normalisePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export interface ResolvedPageMeta {
  title: string
  description: string
  index: boolean
  /** The absolute canonical URL — for an indexed page only. */
  canonical: string | null
}

export function pageMetaFor(pathname: string): ResolvedPageMeta {
  const path = normalisePath(pathname)
  const meta = ROUTES.find(([pattern]) => matches(pattern, path))?.[1] ?? NOT_FOUND
  const index = meta.index === true
  return {
    title: path === '/' ? HOME_TITLE : `${meta.title} — ${AMIT_OLYMPIAD}`,
    description: meta.description ?? DEFAULT_DESCRIPTION,
    index,
    canonical: index ? `${SITE_URL}${path === '/' ? '/' : path}` : null,
  }
}

/** Every indexable path — the sitemap. */
export const INDEXED_PATHS: readonly string[] = ROUTES.filter(([, meta]) => meta.index === true).map(([pattern]) => pattern)

/**
 * The areas `robots.txt` closes to crawlers (brief §10: "disallowing admin, dashboard and API
 * routes"), as path prefixes. The rest of the private pages are `noindex` through `PageMeta`;
 * these are the ones no crawler should even fetch.
 */
export const DISALLOWED_PREFIXES: readonly string[] = [
  '/api/',
  '/admin',
  '/ai-generator',
  '/dashboard',
  '/daily-quiz',
  '/practice',
  '/mock-tests',
  '/analytics',
  '/my-certificates',
  '/profile',
  '/exam',
  '/payment',
  '/notifications',
  '/activity',
  '/report',
  '/referrals',
  '/verify-email',
  '/reset-password',
  '/verify/',
  '/design-system',
  '/dev/',
]
