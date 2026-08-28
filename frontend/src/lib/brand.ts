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
 * ## The one copy that cannot import this
 *
 * `frontend/index.html` is a static file served before any JavaScript runs, so the title
 * and meta description spell the name out literally. **If you change it here, change it
 * there too** — that is the single duplication, and it is deliberate: putting the page
 * title behind a script would cost every visitor a render for a string that never changes.
 */

/** The four letters, punctuated the way the rest of the product punctuates them. */
export const AMIT_SHORT = 'A.M.I.T'

/**
 * The official expansion, owner-supplied on 2026-08-28.
 *
 * Title case, because it is an organisation's name in running prose. Where a surface wants
 * it shouting, that surface applies `text-transform` — the value itself stays readable, so
 * it can be dropped into a sentence without looking like an error.
 */
export const AMIT_FULL_FORM = 'Advance Mathematics and Intelligence Test'
