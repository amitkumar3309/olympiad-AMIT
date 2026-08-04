/**
 * Turns a display name into a URL- and query-safe identifier.
 *
 * Slugs exist so a subject or topic has a stable handle that does not change when
 * someone fixes the capitalisation of its name, and so the admin UI can key on
 * something short. They are *not* used for authorization or as a primary key —
 * `_id` is — so a collision is a usability problem, not a security one, and the
 * unique index is there to surface it as a clean 409.
 */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      // Strip combining marks so "Bhinn" and "Bhinn" with a diacritic do not
      // become two different slugs.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      // Anything that is not a latin letter, digit or space becomes a separator.
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/[\s-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item'
  );
}
