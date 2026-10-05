/**
 * The product's name as the backend writes it to people — email, notifications, achievement and
 * board descriptions, a refusal message (Milestone 30, Phase 6 — brief §10: "consistent names").
 *
 * Before this the backend spelled it four ways ("AMIT Olympiad", "A.M.I.T Maths Olympiad",
 * "AMIT Maths Olympiad", "A.M.I.T"), none of them the owner's `A.M.I.T. Olympiad`. The frontend's
 * copy is `frontend/src/lib/brand.ts` (`AMIT_OLYMPIAD`); the two apps share no package, so this is
 * a deliberate second copy, like the contact details (`config.support`) — change one, change both.
 *
 * Two things do not use it, on purpose: the printed certificate, which is a record of what a child
 * was handed (CLAUDE.md), and the invoice's issuer name, a business fact set by `INVOICE_ORG_NAME`.
 */
export const PRODUCT_NAME = 'A.M.I.T. Olympiad';

/** The four letters with their stops — the wordmark in an email's header. */
export const PRODUCT_SHORT = 'A.M.I.T.';
