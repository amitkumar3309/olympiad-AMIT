/**
 * The platform's own name (Milestone 22, Phase D).
 *
 * ## Why this is a constant rather than four string literals
 *
 * Until 2026-08-28 the expansion of **A.M.I.T** was recorded nowhere — not in the code,
 * not in any of the thirteen documents in the repository root, not in the certificate it
 * prints on a child's award. The brand appeared only as the four letters, and the founder
 * being named "Amit Kumar" made it genuinely ambiguous whether it was an acronym at all.
 * It was asked for rather than guessed, and the owner supplied it.
 *
 * **It is shown once, as a name, and never explained.** The owner's instruction on
 * 2026-08-28 was explicit: the full form belongs under the wordmark at the top of the
 * landing page, set as part of the logotype — with no letter-by-letter breakdown, no
 * paragraph about what it means, and no second copy further down the page. A revision that
 * had all three was rejected.
 *
 * So there is exactly one on-screen use, and this constant exists anyway: it is what keeps
 * the visible name and the page metadata from drifting apart, and it is the one place to
 * change if the wording is ever corrected.
 *
 * ## The page's title is written from here at build time
 *
 * `frontend/index.html` is served before any JavaScript runs, so its title, description,
 * share tags and structured data must be in the file itself. Until Milestone 30 Phase 6 it
 * spelled the name out literally, as a second copy to keep in step; since then the Vite
 * plugin `vite.seo.ts` writes them in from these constants when the site is built, so this
 * file is the only frontend copy. (The backend's is `backend/src/lib/brand.ts`.)
 */

/**
 * The four letters, punctuated the way the launch mockups punctuate them — **with** the
 * trailing stop (PLAN.md Q10, Milestone 30). It was `A.M.I.T` until then, while the hero
 * and the navbar already wrote `A.M.I.T.`; one constant is what stops that drifting again.
 *
 * The printed certificate's `A.M.I.T MATHS OLYMPIAD` does not use this and is deliberately
 * left alone: it is a record of what was handed to somebody.
 */
export const AMIT_SHORT = 'A.M.I.T.'

/** The name in running text and on the homepage: "A.M.I.T. Olympiad". */
export const AMIT_OLYMPIAD = `${AMIT_SHORT} Olympiad`

/** The line under the wordmark in the header and footer (the mockups' "THINK • SOLVE • GROW"). */
export const AMIT_TAGLINE = 'Think • Solve • Grow'

/**
 * The official expansion, owner-supplied on 2026-08-28.
 *
 * Title case, because it is an organisation's name in running prose. Where a surface wants
 * it shouting, that surface applies `text-transform` — the value itself stays readable, so
 * it can be dropped into a sentence without looking like an error.
 */
export const AMIT_FULL_FORM = 'Advance Mathematics and Intelligence Test'

/**
 * The year of the competition, owner-supplied on 2026-08-29.
 *
 * **Nothing in the backend knows this.** A sitting's dates come from the `Exam` window an
 * administrator announces, and the certificate the product prints carries no year at all —
 * its serial uses whatever year it was *issued* in (`AMIT-CERT-<year>-<n>`). So this is a
 * marketing fact with no source of truth behind it, which is exactly why it lives here and
 * not inline: when the sitting moves, this line is the whole change.
 *
 * Milestone 23 Phase F removed it from the hero for that reason and flagged it rather than
 * deciding; the owner supplied it the next day. If it is ever unclear again, ask — do not
 * infer one from a certificate serial or from the current date.
 */
export const AMIT_COMPETITION_YEAR = '2027'

/**
 * How a reader reaches a human, and the one place either value lives.
 *
 * Both were local constants in `components/Footer.tsx` until Milestone 25 Phase C, which
 * is fine while a footer is the only surface that needs them. It stopped being true the
 * moment the verification screens had to carry them: **the address a student can no longer
 * receive mail at is exactly the problem those screens cannot solve themselves.** Changing
 * the email on an account is deliberately not built — see `validation/profileSchemas.ts`,
 * where it is absent because a self-service address change without a confirm-at-the-new-
 * address step is an account-takeover primitive — so "write to us" is the honest next
 * action, not a placeholder for one.
 *
 * The backend publishes the same two facts from `INVOICE_ORG_EMAIL` / `INVOICE_ORG_PHONE`
 * (see `config.support`). That is a genuine duplication across the frontend/backend split,
 * like the product name (`backend/src/lib/brand.ts`), and it is the reason these are
 * constants rather than literals: one place per app to change.
 */
export const SUPPORT = {
  email: 'support@amitolympiad.me',
  // Owner-supplied, 2026-10-04, in exactly this format — print it as written.
  phone: '+91-97828-70716',
} as const

/**
 * The helpline as a `tel:` href — digits and the leading `+` only. RFC 3966 tolerates the
 * dashes, but not every dialer does, and the displayed format is the owner's, not a dialer's.
 */
export const SUPPORT_TEL_HREF = `tel:${SUPPORT.phone.replace(/[^\d+]/g, '')}`

/**
 * The site's public address — no trailing slash (Milestone 30, Phase 6).
 *
 * The one place the domain lives in the frontend. It is the base of every canonical link,
 * the share card's `og:image`, the organisation's structured data, and the URLs in the
 * generated `sitemap.xml` and `robots.txt` (`vite.seo.ts`).
 *
 * **Owner-confirmed on 2026-10-08: the live site is `www.amitolympiad.me`** (it was inferred
 * as the bare domain until then). It must match the backend's `FRONTEND_URL` exactly — that
 * variable builds the link in every email, and it is the one origin the backend's CORS
 * allow-list and CSRF check accept — which is also why the bare `amitolympiad.me` should
 * *redirect* here rather than serve the site itself: a sign-in from it would be refused.
 */
export const SITE_URL = 'https://www.amitolympiad.me'

/**
 * Who built the site, and where to find them.
 *
 * Rendered by `components/DeveloperCredit.tsx` in the public footer and at the foot of the
 * signed-in navigation. Here rather than inline for the same reason as everything else in
 * this file: it is a fact that appears on screen and has no source of truth in the
 * database, so it needs exactly one place to live.
 */
export const DEVELOPER = {
  name: 'Sachin Kukkar',
  url: 'https://sachinkukkar.tech',
} as const
