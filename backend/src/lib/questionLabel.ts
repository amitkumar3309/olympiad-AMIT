/**
 * How a question is named where one line of text has to stand for it — an audit entry, a row in
 * a staff table, a bulk-change report.
 *
 * Its text, as it always was; for a picture question with no text (Milestone 30 Phase 7b), the
 * picture's description, marked as one so nobody reads it as the question's wording.
 */
export function questionLabel(
  question: { questionText?: string | null; image?: { alt?: string | null } | null },
  max = 80,
): string {
  const text = (question.questionText ?? '').trim();
  if (text) return text.slice(0, max);
  const alt = question.image?.alt?.trim();
  return alt ? `[Picture] ${alt}`.slice(0, max) : '';
}
